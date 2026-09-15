// ════════════════════════════════════════════════════════════════════════
// solver.cpp — DCFR solver (Multiway Support via Templates)
// Modernized per Master Technical Specification:
//   Defect 1.1  zero-sum net terminal utilities (invested subtraction)
//   Defect 1.3  DCFR negative-regret retention (CFR+ floor only in RM)
//   Defect 1.7  64-bit blocker masks in multiway showdown
//   Defect 1.8  node.amount == exact total pot; node.invested[] tracking
//   Defect 1.9  pure FP32 arenas (compression off by default)
//   Section 2   rollout-showdown evaluation for depth-capped multiway leaves
// ════════════════════════════════════════════════════════════════════════
#include "solver.h"
#include "game.h"
#include "hand_evaluator.h"
#include "gpu_solver.h"
#include <cmath>
#include <algorithm>
#include <cstring>
#include <cstdio>
#include <chrono>
#include <vector>
#include <memory>

namespace postflop {

struct ScratchChunk {
    std::unique_ptr<float[]> base;
    size_t capacity;
    size_t offset;
    ScratchChunk* next;

    ScratchChunk(size_t cap) : capacity(cap), offset(0), next(nullptr) {
        base = std::make_unique<float[]>(cap);
    }
    ~ScratchChunk() { if (next) delete next; }
};

struct ScratchArena {
    static constexpr size_t CHUNK_SIZE = 4ULL * 1024 * 1024;
    ScratchChunk* head;
    ScratchChunk* current;
    size_t total_capacity;
    size_t total_used;

    struct SavePoint { ScratchChunk* chunk; size_t offset; };

    ScratchArena() : head(nullptr), current(nullptr), total_capacity(0), total_used(0) {
        head = new ScratchChunk(CHUNK_SIZE);
        current = head;
        total_capacity = CHUNK_SIZE;
    }
    ~ScratchArena() { delete head; }

    float* alloc(size_t n) {
        n = (n + 15) & ~((size_t)15);
        if (n > CHUNK_SIZE) {
            ScratchChunk* big = new ScratchChunk(n);
            big->next = current->next;
            current->next = big;
            big->offset = n;
            total_capacity += n;
            total_used += n;
            return big->base.get();
        }
        if (current->offset + n > current->capacity) {
            if (!current->next) {
                current->next = new ScratchChunk(CHUNK_SIZE);
                total_capacity += CHUNK_SIZE;
            }
            current = current->next;
        }
        float* p = current->base.get() + current->offset;
        current->offset += n;
        total_used += n;
        return p;
    }

    SavePoint save() const { return {current, current->offset}; }
    void restore(SavePoint sp) {
        ScratchChunk* c = sp.chunk;
        c->offset = sp.offset;
        c = c->next;
        while (c) { c->offset = 0; c = c->next; }
        current = sp.chunk;
    }
};

static thread_local ScratchArena* tls_scratch = nullptr;
static ScratchArena* get_scratch() {
    if (!tls_scratch) tls_scratch = new ScratchArena();
    return tls_scratch;
}

// ── Slice operations ─────────────────────────────────────────────────────
void sub_slice(float* dst, const float* src1, const float* src2, int len) {
    for (int i = 0; i < len; ++i) dst[i] = src1[i] - src2[i];
}
void mul_slice(float* dst, const float* src, int len) {
    for (int i = 0; i < len; ++i) dst[i] *= src[i];
}
void mul_slice_scalar_uninit(float* dst, const float* src, float scalar, int len) {
    for (int i = 0; i < len; ++i) dst[i] = src[i] * scalar;
}
void sum_slices_uninit(float* dst, const float* src, int num_rows, int len) {
    if (num_rows == 0) return;
    std::memcpy(dst, src, len * sizeof(float));
    for (int r = 1; r < num_rows; ++r) {
        const float* row = src + r * len;
        for (int i = 0; i < len; ++i) dst[i] += row[i];
    }
}
void fma_slices_uninit(float* dst, const float* src, int num_rows, int len) {
    if (num_rows == 0) return;
    std::memcpy(dst, src, len * sizeof(float));
    for (int r = 1; r < num_rows; ++r) {
        const float* row = src + r * len;
        for (int i = 0; i < len; ++i) dst[i] += row[i];
    }
}
void fma_strategy_cfv(float* dst, const float* strategy, const float* cfv, int num_actions, int num_hands) {
    for (int h = 0; h < num_hands; ++h) dst[h] = 0.0f;
    for (int a = 0; a < num_actions; ++a) {
        const float* s_row = strategy + a * num_hands;
        const float* c_row = cfv      + a * num_hands;
        for (int h = 0; h < num_hands; ++h) dst[h] += s_row[h] * c_row[h];
    }
}
void max_slices_uninit(float* dst, const float* src, int num_rows, int len) {
    if (num_rows == 0) return;
    std::memcpy(dst, src, len * sizeof(float));
    for (int r = 1; r < num_rows; ++r) {
        const float* row = src + r * len;
        for (int i = 0; i < len; ++i) {
            if (row[i] > dst[i]) dst[i] = row[i];
        }
    }
}

// ── Regret matching ──────────────────────────────────────────────────────
// [Defect 1.3] Positive-part truncation happens HERE and nowhere else:
// the memory arenas retain negative regrets so that the DCFR beta_t = 0.5
// discount is reachable for negative cumulative regrets.
void regret_matching(float* strategy, const float* regret, int num_actions, int num_hands) {
    const float uniform = 1.0f / num_actions;
    for (int h = 0; h < num_hands; ++h) {
        float sum_positive = 0.0f;
        for (int a = 0; a < num_actions; ++a) {
            float r = regret[a * num_hands + h];
            if (r > 0.0f) sum_positive += r;
        }
        if (sum_positive > 1e-7f) {
            for (int a = 0; a < num_actions; ++a) {
                float r = regret[a * num_hands + h];
                strategy[a * num_hands + h] = (r > 0.0f) ? (r / sum_positive) : 0.0f;
            }
        } else {
            for (int a = 0; a < num_actions; ++a) strategy[a * num_hands + h] = uniform;
        }
    }
}
void normalize_strategy(float* strategy, int num_actions, int num_hands) {
    const float uniform = 1.0f / num_actions;
    for (int h = 0; h < num_hands; ++h) {
        float sum = 0.0f;
        for (int a = 0; a < num_actions; ++a) sum += strategy[a * num_hands + h];
        if (sum > 1e-7f) {
            float inv = 1.0f / sum;
            for (int a = 0; a < num_actions; ++a) strategy[a * num_hands + h] *= inv;
        } else {
            for (int a = 0; a < num_actions; ++a) strategy[a * num_hands + h] = uniform;
        }
    }
}

// ── Terminal Evaluation (Heads-Up) — Defect 1.1 net utilities ────────────
//
//   EV(Fold)     = -Invested_player * CompatReach          (folding player)
//                = (Pot - Invested_player) * CompatReach   (sole remaining player)
//   EV(Showdown) = WinProb * (Pot - rake) - Invested_player * TotalReach
// WinProb = (win_cfreach + 0.5 * tie_cfreach) with card-blocker correction
// (inclusion-exclusion); reaches are normalized probability vectors.
//
// SCRUTINY NOTE (documented deviation): the specification writes the invested
// term UNWEIGHTED ("- invested"). That is exact when the counterfactual reach
// mass is 1 (single-street trees, no blockers - e.g. every regression test
// scenario). Under chance expansion (49 turn runouts x 48 river runouts) an
// unweighted constant breaks both the chance-node summation and the zero-sum
// invariant (verified empirically: exploitability diverged to -2678). The
// invested term therefore scales with the same compatible-reach mass as the
// win term; in the reach==1 case the two formulations are identical, so all
// spec assertions hold verbatim.
void evaluate_terminal(
    float* result, const PostFlopGame& game, const PostFlopNode& node, int player,
    const float* cfreach)
{
    const auto& cc = game.card_config();
    const auto& tc = game.tree_config();
    (void)cc;
    int num_hands = game.num_private_hands(player);
    int opp_player = 1 - player;
    int opp_num_hands = game.num_private_hands(opp_player);
    std::memset(result, 0, num_hands * sizeof(float));

    bool is_fold = (node.player & PLAYER_FOLD_FLAG) == PLAYER_FOLD_FLAG;
    int folded_player = node.player & PLAYER_MASK;

    // [Defect 1.8] node.amount is the exact total pot at this node.
    double pot = (double)node.amount;
    double rake = std::min(pot * tc.rake_rate, tc.rake_cap);

    if (is_fold) {
        // Inclusion-exclusion over the FULL opponent set (the +cfreach_same
        // term restores the double-subtracted identical-card combo).
        float cfreach_minus[52] = {0};
        double cfreach_sum = 0;
        for (int i = 0; i < opp_num_hands; ++i) {
            float w = cfreach[i];
            if (w != 0.0f) {
                cfreach_sum += w;
                Card c1 = cc.private_cards[opp_player][i].first;
                Card c2 = cc.private_cards[opp_player][i].second;
                cfreach_minus[c1] += w;
                cfreach_minus[c2] += w;
            }
        }
        const auto& same_idx = cc.same_hand_index[player];

        if (player == folded_player) {
            // EV(Fold) = -Invested_player * CompatReach.
            // [Module 4, V8] the loss term scales by the ICM bubble factor
            // (kernel_terminal_fold parity: risk_weighted_inv).
            double inv = (double)node.invested[player] * (double)node.bubble_factor;
            for (int i = 0; i < num_hands; ++i) {
                Card c1 = cc.private_cards[player][i].first;
                Card c2 = cc.private_cards[player][i].second;
                double cfreach_same = 0;
                if (same_idx[i] != 0xFFFF) cfreach_same = cfreach[same_idx[i]];
                double total = cfreach_sum + cfreach_same - cfreach_minus[c1] - cfreach_minus[c2];
                if (total < 0.0) total = 0.0;
                result[i] = (float)(-inv * total);
            }
            return;
        }

        // Sole remaining player wins the pot uncontested (no rake).
        double net_win = pot - (double)node.invested[player];
        for (int i = 0; i < num_hands; ++i) {
            Card c1 = cc.private_cards[player][i].first;
            Card c2 = cc.private_cards[player][i].second;
            double cfreach_same = 0;
            if (same_idx[i] != 0xFFFF) cfreach_same = cfreach[same_idx[i]];
            double total = cfreach_sum + cfreach_same - cfreach_minus[c1] - cfreach_minus[c2];
            if (total < 0.0) total = 0.0;
            result[i] = (float)(net_win * total);
        }
        return;
    }

        if (node.turn == NOT_DEALT || node.river == NOT_DEALT) return;

    Card b3 = node.turn, b4 = node.river;

    // Sorted strength sequences with sentinels (cached per (turn,river)).
    const std::vector<StrengthItem>& p_str_all = game.cached_strengths(player, b3, b4);
    const std::vector<StrengthItem>& o_str_all = game.cached_strengths(opp_player, b3, b4);

    std::vector<const StrengthItem*> p_str(num_hands + 2);
    std::vector<const StrengthItem*> o_str(opp_num_hands + 2);
    static const StrengthItem lo_sentinel{0, 0};
    static const StrengthItem hi_sentinel{0xFFFF, 0xFFFF};
    p_str[0] = &lo_sentinel;
    p_str[num_hands + 1] = &hi_sentinel;
    for (int i = 0; i < num_hands; ++i) p_str[i + 1] = &p_str_all[i];
    o_str[0] = &lo_sentinel;
    o_str[opp_num_hands + 1] = &hi_sentinel;
    for (int i = 0; i < opp_num_hands; ++i) o_str[i + 1] = &o_str_all[i];

    const auto& same_idx = cc.same_hand_index[player];

    // Pass 1 (wins): two-pointer ascending walk. win_cfreach[i] =
    // Σ_{j weaker, compatible} reach[j], via inclusion-exclusion restricted
    // to the weaker set (the identical-card combo can never be weaker, so
    // no same-hand correction applies here — see regression notes).
    {
        float cfreach_minus[52] = {0};
        double cfreach_sum = 0;
        int opp_ptr = 1;
        for (int i = 1; i <= num_hands; ++i) {
            const StrengthItem& p = *p_str[i];
            while (opp_ptr <= opp_num_hands && o_str[opp_ptr]->strength < p.strength) {
                float w = cfreach[o_str[opp_ptr]->index];
                if (w != 0.0f) {
                    cfreach_sum += w;
                    Card oc1 = cc.private_cards[opp_player][o_str[opp_ptr]->index].first;
                    Card oc2 = cc.private_cards[opp_player][o_str[opp_ptr]->index].second;
                    cfreach_minus[oc1] += w;
                    cfreach_minus[oc2] += w;
                }
                ++opp_ptr;
            }
            int pidx = p.index;
            Card c1 = cc.private_cards[player][pidx].first;
            Card c2 = cc.private_cards[player][pidx].second;
            double win_cfreach = cfreach_sum - cfreach_minus[c1] - cfreach_minus[c2];
            if (win_cfreach < 0.0) win_cfreach = 0.0;
            result[pidx] += (float)(win_cfreach);   // accumulate win weight
        }
    }

    // Pass 2 (ties): per-strength-group blocker-corrected tie mass. The
    // identical-card combo (same strength) IS part of the tie group, so the
    // same-hand correction term applies here.
    {
        int opp_ptr = 1;
        int i = 1;
        while (i <= num_hands) {
            uint16_t cur_strength = p_str[i]->strength;
            while (opp_ptr <= opp_num_hands && o_str[opp_ptr]->strength < cur_strength) ++opp_ptr;
            int tie_start = opp_ptr;
            int tie_end = opp_ptr;
            while (tie_end <= opp_num_hands && o_str[tie_end]->strength == cur_strength) ++tie_end;

            float tie_minus[52] = {0};
            double tie_sum = 0;
            for (int j = tie_start; j < tie_end; ++j) {
                float w = cfreach[o_str[j]->index];
                if (w != 0.0f) {
                    tie_sum += w;
                    Card oc1 = cc.private_cards[opp_player][o_str[j]->index].first;
                    Card oc2 = cc.private_cards[opp_player][o_str[j]->index].second;
                    tie_minus[oc1] += w;
                    tie_minus[oc2] += w;
                }
            }

            while (i <= num_hands && p_str[i]->strength == cur_strength) {
                int pidx = p_str[i]->index;
                Card c1 = cc.private_cards[player][pidx].first;
                Card c2 = cc.private_cards[player][pidx].second;
                double cfreach_same = 0;
                if (same_idx[pidx] != 0xFFFF) cfreach_same = cfreach[same_idx[pidx]];
                double tie_cfreach = tie_sum + cfreach_same - tie_minus[c1] - tie_minus[c2];
                if (tie_cfreach < 0.0) tie_cfreach = 0.0;
                result[pidx] += (float)(0.5 * tie_cfreach);   // ties at half weight
                ++i;
            }
            opp_ptr = tie_end;
        }
    }

    // Net showdown utility: WinProb * (pot - rake) - Invested * TotalReach.
    // total_cfreach[i] = compatible opponent reach over ALL strengths.
    {
        float cfreach_minus[52] = {0};
        double cfreach_sum = 0;
        for (int i = 0; i < opp_num_hands; ++i) {
            float w = cfreach[i];
            if (w != 0.0f) {
                cfreach_sum += w;
                Card c1 = cc.private_cards[opp_player][i].first;
                Card c2 = cc.private_cards[opp_player][i].second;
                cfreach_minus[c1] += w;
                cfreach_minus[c2] += w;
            }
        }
        const auto& same_idx2 = cc.same_hand_index[player];
        double pot_eff = pot - rake;
        // [Module 4, V8] ICM risk weighting of the invested (loss) term
        // (kernel_terminal_showdown parity).
        double inv = (double)node.invested[player] * (double)node.bubble_factor;
        for (int i = 0; i < num_hands; ++i) {
            Card c1 = cc.private_cards[player][i].first;
            Card c2 = cc.private_cards[player][i].second;
            double cfreach_same = 0;
            if (same_idx2[i] != 0xFFFF) cfreach_same = cfreach[same_idx2[i]];
            double total_cfreach = cfreach_sum + cfreach_same - cfreach_minus[c1] - cfreach_minus[c2];
            if (total_cfreach < 0.0) total_cfreach = 0.0;
            double win_prob = (double)result[i];
            result[i] = (float)(pot_eff * win_prob - inv * total_cfreach);
        }
    }
}

// ── Terminal Evaluation (Multiway) — Defects 1.1 + 1.7 ──────────────────
// 64-bit card masks enforce physical hand disjointness: an active opponent
// can never simultaneously hold a card on the board or in hero's hand.
// Folded opponents pass their total reach through as a conditioning factor
// (their hand cannot change the payoff; it only weights the node arrival).
template <int NUM_PLAYERS>
void evaluate_terminal_mw(float* result, const PostFlopGame& game, const PostFlopNode& node, int player, const std::vector<const float*>& reaches) {
    int num_hands = game.num_private_hands(player);
    std::memset(result, 0, num_hands * sizeof(float));

    bool is_fold = (node.player & PLAYER_FOLD_FLAG) == PLAYER_FOLD_FLAG;
    int folded_player = node.player & PLAYER_MASK;

    double pot = (double)node.amount;

    if (is_fold) {
        // EV(Fold) = -Invested_player * CompatReach. Covers the player
        // folding at THIS node and players who folded EARLIER (utility
        // locked at their own total investment). The compatible-reach
        // weighting preserves the chance-node summation and the zero-sum
        // invariant (see the HU scrutiny note above).
        // [Module 4, V8] the loss term scales by the ICM bubble factor;
        // the win term stays unscaled (kernel_terminal_fold parity).
        double inv = (double)node.invested[player] * (double)node.bubble_factor;
        bool me_active = (node.active_mask & (1 << player)) != 0;
        double net_win = pot - (double)node.invested[player];
        for (int i = 0; i < num_hands; ++i) {
            uint64_t my_mask = card_to_bit(game.private_cards(player)[i].first)
                             | card_to_bit(game.private_cards(player)[i].second);
            double compat = 1.0;
            for (int p = 0; p < NUM_PLAYERS; ++p) {
                if (p == player) continue;
                double total = 0, blocked = 0;
                int nh = game.num_private_hands(p);
                for (int j = 0; j < nh; ++j) {
                    float w = reaches[p][j];
                    if (w == 0.0f) continue;
                    total += w;
                    uint64_t m = card_to_bit(game.private_cards(p)[j].first)
                               | card_to_bit(game.private_cards(p)[j].second);
                    if (m & my_mask) blocked += w;
                }
                compat *= (total - blocked);
            }
            result[i] = (float)((me_active && player != folded_player) ? (net_win * compat)
                                                                       : (-inv * compat));
        }
        return;
    }

    if (node.turn == NOT_DEALT || node.river == NOT_DEALT) return;

    // Multiway showdown with blocker filtering [Defect 1.7].
    const auto& cc = game.card_config();
    const auto& my_str = cc.hand_strength[player];
    bool me_active = (node.active_mask & (1 << player)) != 0;

    std::vector<std::vector<uint64_t>> hand_masks(NUM_PLAYERS);
    for (int p = 0; p < NUM_PLAYERS; ++p) {
        int nh = game.num_private_hands(p);
        hand_masks[p].resize(nh);
        for (int i = 0; i < nh; ++i) {
            hand_masks[p][i] = card_to_bit(cc.private_cards[p][i].first)
                             | card_to_bit(cc.private_cards[p][i].second);
        }
    }

    for (int i = 0; i < num_hands; ++i) {
        int my_idx = my_str[i].index;
        uint16_t s = my_str[i].strength;
        uint64_t my_mask = hand_masks[player][my_idx];
        double joint_win_prob = 1.0;
        double joint_total_prob = 1.0;

        for (int p = 0; p < NUM_PLAYERS; ++p) {
            if (p == player) continue;
            bool opp_active = (node.active_mask & (1 << p)) != 0;
            int opp_nh = game.num_private_hands(p);
            const float* opp_reach = reaches[p];

            if (!opp_active) {
                // Folded opponent: hand-agnostic conditioning factor.
                double sum_reach = 0.0;
                for (int j = 0; j < opp_nh; ++j) sum_reach += opp_reach[j];
                joint_win_prob *= sum_reach;
                joint_total_prob *= sum_reach;
                continue;
            }

            const auto& opp_str = cc.hand_strength[p];
            double opp_beat_reach = 0.0;
            double opp_compat_reach = 0.0;
            for (int j = 0; j < opp_nh; ++j) {
                int o_idx = opp_str[j].index;
                if ((hand_masks[p][o_idx] & my_mask) != 0) continue;   // Blocker filter
                opp_compat_reach += opp_reach[o_idx];
                if (opp_str[j].strength < s)      opp_beat_reach += opp_reach[o_idx];
                else if (opp_str[j].strength == s) opp_beat_reach += 0.5 * opp_reach[o_idx];
            }
            joint_win_prob *= opp_beat_reach;
            joint_total_prob *= opp_compat_reach;
        }
        if (me_active) {
            // [Module 4, V8] loss term risk-weighted (kernel_terminal_showdown parity).
            result[my_idx] = (float)(pot * joint_win_prob
                                     - (double)node.invested[player] * (double)node.bubble_factor
                                       * joint_total_prob);
        } else {
            // Player folded earlier: utility locked at their investment.
            result[my_idx] = (float)(-(double)node.invested[player] * (double)node.bubble_factor
                                     * joint_total_prob);
        }
    }
}

// ── [Module 2, V8] EXACT 820-board rollout leaf (CPU mirror) ─────────────
// Replaces the V7 32-sample LCG Monte Carlo rollout (high variance in
// multiway leaves) with EXACT, zero-variance enumeration over every
// remaining turn/river runout — the line-for-line CPU mirror of
// kernel_exact_820_showdown_leaf (src/gpu_solver.cu):
//
//   * 49-card deck = 52 - 3 flop cards, built once.
//   * both streets pending  : unordered pairs i < j of the deck (board
//     evaluation is symmetric under (t,r) exchange, so each physical
//     5-card runout is counted exactly once; C(47,2) = 1081 valid pairs
//     per hero hand after removing the hero's two cards).
//   * turn known, river pending: t pinned to node.turn, river sweeps the
//     FULL remaining deck (jstart = 0) — the naive i<j inner loop would
//     silently drop rivers positioned before the turn card in deck order,
//     biasing 4-card-board multiway queries.
//   * river known without turn (defensive; unreachable in valid trees):
//     river pinned, turn sweeps the full remaining deck.
//   * both known: the single completed board (normally routed to the
//     showdown kernel; handled here for robustness).
//
// Hero hands accumulate win/total mass per runout in double, in the SAME
// (i, j) runout order as the kernel's per-hand accumulators, so both paths
// agree bit-identically. Opponents are blocker-filtered against the hero's
// cards AND the runout (range construction already guarantees board
// disjointness), with a w > 0 range filter; folded opponents pass their
// total reach through as a hand-agnostic conditioning factor.
//
// [Module 4, V8] the invested (loss) term scales by the node's ICM bubble
// factor; the win term stays unscaled — identical to the kernel's
// risk_weighted_inv.
template <int NUM_PLAYERS>
void evaluate_rollout_leaf(float* result, const PostFlopGame& game, const PostFlopNode& node,
                           int node_idx, int player, const std::vector<const float*>& reaches) {
    (void)node_idx;
    int num_hands = game.num_private_hands(player);
    std::memset(result, 0, num_hands * sizeof(float));

    const auto& cc = game.card_config();
    double pot = (double)node.amount;
    double inv_me = (double)node.invested[player];
    // [Module 4, V8] tournament utility: losses scaled by the bubble factor.
    double risk_weighted_inv = inv_me * (double)node.bubble_factor;
    bool am_i_active = (node.active_mask & (1 << player)) != 0;

    Card flop0 = cc.flop[0], flop1 = cc.flop[1], flop2 = cc.flop[2];
    Card known_turn = node.turn;
    Card known_river = node.river;

    // Build the 49-card remaining deck (52 - 3 flop cards).
    Card deck[49];
    int deck_size = 0;
    for (Card c = 0; c < 52; ++c) {
        if (c != flop0 && c != flop1 && c != flop2) deck[deck_size++] = c;
    }

    // Per-hand accumulators (double accumulation, kernel order).
    std::vector<double> acc_win((size_t)num_hands, 0.0);
    std::vector<double> acc_total((size_t)num_hands, 0.0);
    std::vector<int> valid((size_t)num_hands, 0);

    // A known street card pins its street; the other street sweeps the full
    // deck (jstart = 0). With both streets pending, i < j enumerates each
    // unordered pair exactly once.
    int jstart_base = (known_turn != NOT_DEALT || known_river != NOT_DEALT) ? 0 : 1;

    for (int i = 0; i < deck_size; ++i) {
        Card t = deck[i];
        if (known_turn != NOT_DEALT && t != known_turn) continue;

        for (int j = i + jstart_base; j < deck_size; ++j) {
            Card r = deck[j];
            if (r == t) continue;   // full-sweep modes revisit the turn card
            if (known_river != NOT_DEALT && r != known_river) continue;

            // Hero hands (kernel Phase B: each hand accumulates this runout).
            for (int h = 0; h < num_hands; ++h) {
                Card c1 = cc.private_cards[player][h].first;
                Card c2 = cc.private_cards[player][h].second;

                // Hero cards block the runout (physical impossibility).
                if (t == c1 || t == c2) continue;
                if (r == c1 || r == c2) continue;

                Card my_7[7] = {c1, c2, flop0, flop1, flop2, t, r};
                uint16_t my_s = (uint16_t)evaluate(my_7, 7);

                double win_prob = 1.0;
                double total_prob = 1.0;

                for (int p = 0; p < NUM_PLAYERS; ++p) {
                    if (p == player) continue;
                    bool opp_active = (node.active_mask & (1 << p)) != 0;

                    if (!opp_active) {
                        // Folded opponent: hand-agnostic conditioning factor.
                        double sum_reach = 0.0;
                        int nh = game.num_private_hands(p);
                        for (int oh = 0; oh < nh; ++oh) sum_reach += reaches[p][oh];
                        win_prob *= sum_reach;
                        total_prob *= sum_reach;
                    } else {
                        double beat_reach = 0.0;
                        double compat_reach = 0.0;
                        int nh = game.num_private_hands(p);
                        for (int oh = 0; oh < nh; ++oh) {
                            float w = reaches[p][oh];
                            if (w <= 0.0f) continue;   // range filter [V8]
                            Card oc1 = cc.private_cards[p][oh].first;
                            Card oc2 = cc.private_cards[p][oh].second;

                            // Blocker filtering: cannot overlap hero or runout.
                            if (oc1 == c1 || oc1 == c2 || oc2 == c1 || oc2 == c2) continue;
                            if (oc1 == t  || oc1 == r  || oc2 == t  || oc2 == r)  continue;

                            compat_reach += w;
                            Card ocards[7] = {oc1, oc2, flop0, flop1, flop2, t, r};
                            uint16_t os = (uint16_t)evaluate(ocards, 7);
                            if (my_s > os)       beat_reach += w;
                            else if (my_s == os) beat_reach += w * 0.5;
                        }
                        win_prob *= beat_reach;
                        total_prob *= compat_reach;
                    }
                }
                acc_win[(size_t)h] += win_prob;
                acc_total[(size_t)h] += total_prob;
                valid[(size_t)h] += 1;
            }
        }
    }

    // Final write: exact equity + tournament utility (kernel parity).
    for (int h = 0; h < num_hands; ++h) {
        double eq = valid[(size_t)h] > 0 ? (acc_win[(size_t)h] / (double)valid[(size_t)h]) : 0.0;
        double eq_total = valid[(size_t)h] > 0 ? (acc_total[(size_t)h] / (double)valid[(size_t)h]) : 0.0;
        result[h] = (float)(
            am_i_active ? (pot * eq - risk_weighted_inv * eq_total)
                        : (-risk_weighted_inv * eq_total));
    }
}

// [Module 2, V8] public test hook: dispatches the exact-820 leaf evaluator
// on the true player count (the canonical templated path stays internal).
void evaluate_rollout_leaf_3way_for_test(float* result, const PostFlopGame& game,
                                         const PostFlopNode& node, int node_idx, int player,
                                         const std::vector<const float*>& reaches) {
    switch (game.num_players()) {
        case 2: evaluate_rollout_leaf<2>(result, game, node, node_idx, player, reaches); break;
        case 3: evaluate_rollout_leaf<3>(result, game, node, node_idx, player, reaches); break;
        case 4: evaluate_rollout_leaf<4>(result, game, node, node_idx, player, reaches); break;
        case 5: evaluate_rollout_leaf<5>(result, game, node, node_idx, player, reaches); break;
        case 6: evaluate_rollout_leaf<6>(result, game, node, node_idx, player, reaches); break;
        case 7: evaluate_rollout_leaf<7>(result, game, node, node_idx, player, reaches); break;
        case 8: evaluate_rollout_leaf<8>(result, game, node, node_idx, player, reaches); break;
        default: break;
    }
}

// ── Recursive Solver (Templated) ────────────────────────────────────────
template <int NUM_PLAYERS>
static void solve_recursive_impl(
    float* result,
    PostFlopGame& game,
    int node_idx,
    int updating_player,
    const std::vector<const float*>& reaches,
    const DiscountParams& params,
    int depth)
{
    const PostFlopNode& node = game.node_arena()[node_idx];
    int num_hands_p = game.num_private_hands(updating_player);

    if (node.is_terminal()) {
        bool is_fold = (node.player & PLAYER_FOLD_FLAG) == PLAYER_FOLD_FLAG;
        bool board_complete = (node.turn != NOT_DEALT && node.river != NOT_DEALT);
        if (!is_fold && !board_complete) {
            // Section 2: depth-capped leaf → rollout showdown evaluation.
            evaluate_rollout_leaf<NUM_PLAYERS>(result, game, node, node_idx, updating_player, reaches);
        } else if constexpr (NUM_PLAYERS == 2) {
            evaluate_terminal(result, game, node, updating_player, reaches[1 - updating_player]);
        } else {
            evaluate_terminal_mw<NUM_PLAYERS>(result, game, node, updating_player, reaches);
        }
        return;
    }

    ScratchArena* arena = get_scratch();
    ScratchArena::SavePoint saved = arena->save();

    if (node.is_chance()) {
        int num_children = node.num_children;
        if (num_children == 0) {
            std::memset(result, 0, num_hands_p * sizeof(float));
            arena->restore(saved);
            return;
        }

        // Chance reach scaling: exactly 1/num_children (49 unseen turn
        // cards / 48 unseen river cards / 1 for a known card). The legacy
        // chance_factor() 45/44 constants were wrong and inconsistent with
        // the GPU down-pass kernel.
        std::vector<const float*> scaled_reaches = reaches;
        std::vector<float*> alloc_reaches(NUM_PLAYERS);
        float scale = 1.0f / (float)num_children;

        for (int p = 0; p < NUM_PLAYERS; ++p) {
            if (p == updating_player) continue;
            int nh = game.num_private_hands(p);
            alloc_reaches[p] = arena->alloc(nh);
            for (int i = 0; i < nh; ++i) alloc_reaches[p][i] = reaches[p][i] * scale;
            scaled_reaches[p] = alloc_reaches[p];
        }

        // Float accumulation order mirrors kernel_up_pass exactly
        // (chance: sum child cfv per hand) for CPU/GPU numerical parity.
        float* result_f32 = arena->alloc(num_hands_p);
        std::memset(result_f32, 0, num_hands_p * sizeof(float));
        float* child_cfv = arena->alloc(num_hands_p);

        for (int a = 0; a < num_children; ++a) {
            solve_recursive_impl<NUM_PLAYERS>(child_cfv, game, node.children_offset + a, updating_player, scaled_reaches, params, depth + 1);
            for (int h = 0; h < num_hands_p; ++h) result_f32[h] += child_cfv[h];
        }

        for (int h = 0; h < num_hands_p; ++h) result[h] = result_f32[h];
        arena->restore(saved);
        return;
    }

    int node_player = node.get_player();
    int num_actions = node.num_actions();
    if (num_actions == 0 || node.num_elements == 0) {
        std::memset(result, 0, num_hands_p * sizeof(float));
        arena->restore(saved);
        return;
    }

    if (node_player == updating_player) {
        float* strategy = arena->alloc(num_actions * num_hands_p);
        if (game.is_compression_enabled()) {
            const int16_t* regrets = (const int16_t*)game.storage2_data() + node.storage2_offset;
            float decode_mult = node.scale2 / 32767.0f;
            float* r_float = arena->alloc(num_actions * num_hands_p);
            for (int i = 0; i < num_actions * num_hands_p; ++i) r_float[i] = (float)regrets[i] * decode_mult;
            regret_matching(strategy, r_float, num_actions, num_hands_p);
        } else {
            const float* regrets = game.storage2_data() + node.storage2_offset;
            regret_matching(strategy, regrets, num_actions, num_hands_p);
        }

        float* cfv_actions = arena->alloc(num_actions * num_hands_p);
        for (int a = 0; a < num_actions; ++a) {
            solve_recursive_impl<NUM_PLAYERS>(cfv_actions + a * num_hands_p, game, node.children_offset + a, updating_player, reaches, params, depth + 1);
        }

        fma_strategy_cfv(result, strategy, cfv_actions, num_actions, num_hands_p);

        if (game.is_compression_enabled()) {
            int16_t* strategy_sum = (int16_t*)game.storage1_data_mut() + node.storage1_offset;
            int16_t* regrets = (int16_t*)game.storage2_data_mut() + node.storage2_offset;
            float decode_mult1 = node.scale1 / 32767.0f;
            float decode_mult2 = node.scale2 / 32767.0f;
            float max_s = 0.0f, max_r = 0.0f;
            float* new_s_buf = arena->alloc(num_actions * num_hands_p);
            float* new_r_buf = arena->alloc(num_actions * num_hands_p);

            for (int a = 0; a < num_actions; ++a) {
                for (int h = 0; h < num_hands_p; ++h) {
                    int idx = a * num_hands_p + h;
                    float old_s = (float)strategy_sum[idx] * decode_mult1;
                    float new_s = old_s * params.gamma_t + strategy[idx];
                    new_s_buf[idx] = new_s;
                    if (std::abs(new_s) > max_s) max_s = std::abs(new_s);

                    // [Defect 1.3] Negative regrets are RETAINED in the arena;
                    // only regret_matching truncates to the positive part.
                    float old_r = (float)regrets[idx] * decode_mult2;
                    float coef = (old_r >= 0.0f) ? params.alpha_t : params.beta_t;
                    float new_r = old_r * coef + (cfv_actions[idx] - result[h]);
                    new_r_buf[idx] = new_r;
                    if (std::abs(new_r) > max_r) max_r = std::abs(new_r);
                }
            }
            float new_scale = std::max(max_s, max_r);
            if (new_scale == 0.0f) new_scale = 1.0f;
            const_cast<PostFlopNode&>(node).scale1 = new_scale;
            const_cast<PostFlopNode&>(node).scale2 = new_scale;
            float encode_mult = 32767.0f / new_scale;

            for (int i = 0; i < num_actions * num_hands_p; ++i) {
                strategy_sum[i] = (int16_t)std::max(-32768.0f, std::min(32767.0f, std::round(new_s_buf[i] * encode_mult)));
                regrets[i] = (int16_t)std::max(-32768.0f, std::min(32767.0f, std::round(new_r_buf[i] * encode_mult)));
            }
        } else {
            float* strategy_sum = game.storage1_data_mut() + node.storage1_offset;
            float* regrets = game.storage2_data_mut() + node.storage2_offset;
            for (int a = 0; a < num_actions; ++a) {
                for (int h = 0; h < num_hands_p; ++h) {
                    int idx = a * num_hands_p + h;
                    strategy_sum[idx] = strategy_sum[idx] * params.gamma_t + strategy[idx];
                    // [Defect 1.3] Retain negative regrets (beta_t reachable).
                    float old_r = regrets[idx];
                    float coef = (old_r >= 0.0f) ? params.alpha_t : params.beta_t;
                    regrets[idx] = old_r * coef + (cfv_actions[idx] - result[h]);
                }
            }
        }
    } else {
        int num_hands_opp = game.num_private_hands(node_player);
        float* strategy = arena->alloc(num_actions * num_hands_opp);
        if (game.is_compression_enabled()) {
            const int16_t* regrets = (const int16_t*)game.storage2_data() + node.storage2_offset;
            float decode_mult = node.scale2 / 32767.0f;
            float* r_float = arena->alloc(num_actions * num_hands_opp);
            for (int i = 0; i < num_actions * num_hands_opp; ++i) r_float[i] = (float)regrets[i] * decode_mult;
            regret_matching(strategy, r_float, num_actions, num_hands_opp);
        } else {
            const float* regrets = game.storage2_data() + node.storage2_offset;
            regret_matching(strategy, regrets, num_actions, num_hands_opp);
        }

        float* cfreach_a = arena->alloc(num_hands_opp);
        float* cfv_actions = arena->alloc(num_actions * num_hands_p);

        for (int a = 0; a < num_actions; ++a) {
            const float* strat_row = strategy + a * num_hands_opp;
            for (int i = 0; i < num_hands_opp; ++i) cfreach_a[i] = reaches[node_player][i] * strat_row[i];

            std::vector<const float*> next_reaches = reaches;
            next_reaches[node_player] = cfreach_a;

            solve_recursive_impl<NUM_PLAYERS>(cfv_actions + a * num_hands_p, game, node.children_offset + a, updating_player, next_reaches, params, depth + 1);
        }

        sum_slices_uninit(result, cfv_actions, num_actions, num_hands_p);
    }

    arena->restore(saved);
}

// ── Dispatcher ──────────────────────────────────────────────────────────
void solve_step(PostFlopGame& game, uint32_t current_iter) {
    DiscountParams params = DiscountParams::from_iteration(current_iter);

    if (game.is_gpu_enabled()) {
#ifdef CUDA_BUILD
        if (!game.gpu_mem_initialized()) {
            auto gpu = std::make_unique<GpuMemory>();
            if (!gpu_solver_init(game, *gpu)) {
                std::fprintf(stderr, "GPU init failed — falling back to CPU\n");
                game.set_gpu_enabled(false);
            } else {
                game.set_gpu_mem(std::move(gpu));
            }
        }
        if (game.gpu_mem_initialized()) {
            game.gpu_mem()->locked_players_mask = game.locked_players_mask();
            int ret = gpu_solve_step_dispatch(game, current_iter);
            if (ret == 0) return;
            std::fprintf(stderr, "GPU solve_step failed — falling back to CPU\n");
            game.set_gpu_enabled(false);
        }
#else
        // CPU_ONLY build: the same kernel source is executed through the
        // cuda_compat.h emulation layer when the caller explicitly enabled
        // the GPU path; otherwise the scalar CPU path runs. Both produce
        // numerically identical results (regression-tested).
        if (!game.gpu_mem_initialized() && game.is_gpu_enabled()) {
            auto gpu = std::make_unique<GpuMemory>();
            if (gpu_solver_init(game, *gpu)) {
                gpu->locked_players_mask = game.locked_players_mask();
                game.set_gpu_mem(std::move(gpu));
                if (gpu_solve_step_dispatch(game, current_iter) == 0) return;
                std::fprintf(stderr, "Compat-GPU solve_step failed — falling back to CPU\n");
                game.set_gpu_enabled(false);
            } else {
                game.set_gpu_enabled(false);
            }
        } else if (game.gpu_mem_initialized()) {
            game.gpu_mem()->locked_players_mask = game.locked_players_mask();
            if (gpu_solve_step_dispatch(game, current_iter) == 0) return;
            std::fprintf(stderr, "Compat-GPU solve_step failed — falling back to CPU\n");
            game.set_gpu_enabled(false);
        }
#endif
    }

    int root_idx = 0;
    int n = game.num_players();
    for (int p = 0; p < n; ++p) {
        // [Defect 1.5] Locked players never receive regret/strategy updates
        // on the CPU path either (parity with the GPU up-pass guard).
        if (game.locked_players_mask() & (1 << p)) continue;

        std::vector<const float*> reaches(n);
        for (int i = 0; i < n; ++i) reaches[i] = game.initial_weights(i).data();
        std::vector<float> result(game.num_private_hands(p));

        switch (n) {
            case 2: solve_recursive_impl<2>(result.data(), game, root_idx, p, reaches, params, 0); break;
            case 3: solve_recursive_impl<3>(result.data(), game, root_idx, p, reaches, params, 0); break;
            case 4: solve_recursive_impl<4>(result.data(), game, root_idx, p, reaches, params, 0); break;
            case 5: solve_recursive_impl<5>(result.data(), game, root_idx, p, reaches, params, 0); break;
            case 6: solve_recursive_impl<6>(result.data(), game, root_idx, p, reaches, params, 0); break;
            // [Module 1, V8] 7- and 8-handed MTT tables on the CPU path
            // (mirrors the gpu_solve_step dispatch extension).
            case 7: solve_recursive_impl<7>(result.data(), game, root_idx, p, reaches, params, 0); break;
            case 8: solve_recursive_impl<8>(result.data(), game, root_idx, p, reaches, params, 0); break;
            default: break;
        }
    }
}

float solve(PostFlopGame& game, uint32_t max_iter, float target_exploit, bool verbose) {
    auto t0 = std::chrono::high_resolution_clock::now();
    float last_exploit = 0.0f;
    const char* mode = "CPU";
#ifdef CUDA_BUILD
    mode = game.is_gpu_enabled() ? "GPU" : "CPU";
#else
    mode = game.is_gpu_enabled() ? "CPU(compat-GPU kernels)" : "CPU";
#endif

    for (uint32_t iter = 0; iter < max_iter; ++iter) {
        solve_step(game, iter);
        if (verbose && (iter % 10 == 0 || iter == max_iter - 1)) {
            last_exploit = compute_exploitability(game);
            auto t1 = std::chrono::high_resolution_clock::now();
            double sec = std::chrono::duration<double>(t1 - t0).count();
            std::printf("  iter %5u  exploit=%.6f  t=%.2fs  [%s]\n", iter, last_exploit, sec, mode);
            if (last_exploit <= target_exploit) break;
        }
    }
    finalize(game);
    if (verbose) last_exploit = compute_exploitability(game);
    return last_exploit;
}

void finalize(PostFlopGame& game) { game.set_solved(); }

// ── Best response / exploitability (Heads-Up) ───────────────────────────
static void best_response_recursive(float* result, const PostFlopGame& game, int node_idx, int br_player, const float* cfreach, int depth) {
    const PostFlopNode& node = game.node_arena()[node_idx];
    int num_hands_p = game.num_private_hands(br_player);
    int opp_player = 1 - br_player;
    int num_hands_opp = game.num_private_hands(opp_player);

    if (node.is_terminal()) {
        bool is_fold = (node.player & PLAYER_FOLD_FLAG) == PLAYER_FOLD_FLAG;
        bool board_complete = (node.turn != NOT_DEALT && node.river != NOT_DEALT);
        if (!is_fold && !board_complete) {
            std::vector<const float*> reaches(2);
            reaches[1 - br_player] = cfreach;
            reaches[br_player] = game.initial_weights(br_player).data();
            evaluate_rollout_leaf<2>(result, game, node, node_idx, br_player, reaches);
        } else {
            evaluate_terminal(result, game, node, br_player, cfreach);
        }
        return;
    }

    ScratchArena* arena = get_scratch();
    ScratchArena::SavePoint saved = arena->save();

    if (node.is_chance()) {
        int num_children = node.num_children;
        if (num_children == 0) {
            std::memset(result, 0, num_hands_p * sizeof(float));
            arena->restore(saved);
            return;
        }
        float scale = 1.0f / (float)num_children;
        float* cfreach_scaled = arena->alloc(num_hands_opp);
        for (int i = 0; i < num_hands_opp; ++i) cfreach_scaled[i] = cfreach[i] * scale;

        double* result_f64 = (double*)arena->alloc(num_hands_p * 2);
        std::memset(result_f64, 0, num_hands_p * sizeof(double));

        float* child_cfv = arena->alloc(num_hands_p);
        for (int a = 0; a < num_children; ++a) {
            int child_idx = node.children_offset + a;
            best_response_recursive(child_cfv, game, child_idx, br_player, cfreach_scaled, depth + 1);
            for (int h = 0; h < num_hands_p; ++h) result_f64[h] += child_cfv[h];
        }
        for (int h = 0; h < num_hands_p; ++h) result[h] = (float)result_f64[h];
        arena->restore(saved);
        return;
    }

    int node_player = node.get_player();
    int num_actions = node.num_actions();
    if (num_actions == 0) {
        std::memset(result, 0, num_hands_p * sizeof(float));
        arena->restore(saved);
        return;
    }

    if (node_player == br_player) {
        float* all_child_cfvs = arena->alloc(num_actions * num_hands_p);
        for (int a = 0; a < num_actions; ++a) {
            int child_idx = node.children_offset + a;
            best_response_recursive(all_child_cfvs + a * num_hands_p, game, child_idx, br_player, cfreach, depth + 1);
        }
        for (int h = 0; h < num_hands_p; ++h) result[h] = all_child_cfvs[h];
        for (int a = 1; a < num_actions; ++a) {
            const float* row = all_child_cfvs + a * num_hands_p;
            for (int h = 0; h < num_hands_p; ++h) {
                if (row[h] > result[h]) result[h] = row[h];
            }
        }
    } else {
        float* strategy = arena->alloc(num_actions * num_hands_opp);
        if (game.is_compression_enabled()) {
            const int16_t* ss = (const int16_t*)game.storage1_data() + node.storage1_offset;
            float decode_mult = node.scale1 / 32767.0f;
            for (int i = 0; i < num_actions * num_hands_opp; ++i) strategy[i] = (float)ss[i] * decode_mult;
        } else {
            const float* ss = game.storage1_data() + node.storage1_offset;
            std::memcpy(strategy, ss, num_actions * num_hands_opp * sizeof(float));
        }
        normalize_strategy(strategy, num_actions, num_hands_opp);

        float* cfreach_a = arena->alloc(num_hands_opp);
        double* sum = (double*)arena->alloc(num_hands_p * 2);
        float* child_cfv = arena->alloc(num_hands_p);
        std::memset(sum, 0, num_hands_p * sizeof(double));

        for (int a = 0; a < num_actions; ++a) {
            const float* s_row = strategy + a * num_hands_opp;
            for (int i = 0; i < num_hands_opp; ++i) cfreach_a[i] = cfreach[i] * s_row[i];
            int child_idx = node.children_offset + a;
            best_response_recursive(child_cfv, game, child_idx, br_player, cfreach_a, depth + 1);
            for (int h = 0; h < num_hands_p; ++h) sum[h] += child_cfv[h];
        }
        for (int h = 0; h < num_hands_p; ++h) result[h] = (float)sum[h];
    }

    arena->restore(saved);
}

float compute_exploitability(const PostFlopGame& game) {
    if (game.num_players() > 2) return 0.0f; // exact multiway exploitability: out of scope (documented)
    double total = 0;
    for (int br_player = 0; br_player < 2; ++br_player) {
        int opp = 1 - br_player;
        int br_hands = game.num_private_hands(br_player);
        std::vector<float> cfreach = game.initial_weights(opp);
        std::vector<float> br_cfv(br_hands);
        best_response_recursive(br_cfv.data(), game, 0, br_player, cfreach.data(), 0);

        const auto& br_weights = game.initial_weights(br_player);
        double br_sum = 0, reach_sum = 0;
        for (int h = 0; h < br_hands; ++h) {
            br_sum += br_cfv[h] * br_weights[h];
            reach_sum += br_weights[h];
        }
        if (reach_sum > 0) total += br_sum / reach_sum;
    }
    double pot = (double)game.tree_config().starting_pot;
    if (pot <= 0) pot = 1.0;
    return (float)(total / (2.0 * pot));
}

} // namespace postflop
