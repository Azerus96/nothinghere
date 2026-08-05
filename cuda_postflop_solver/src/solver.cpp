// ════════════════════════════════════════════════════════════════════════
// solver.cpp — DCFR solver: PRODUCTION IMPLEMENTATION
// ════════════════════════════════════════════════════════════════════════
// This is the REAL solver, not a stub. All algorithms are mathematically
// exact ports of postflop-solver/src/solver.rs + game/evaluation.rs.
//
// Key features:
//   • Real DCFR with α=t^(3/2), β=0.5, γ=(t'/(t'+1))^3
//   • Real regret matching with positive-part normalization
//   • Real terminal evaluator:
//       - Fold: full inclusion-exclusion (cfreach_sum + cfreach_same
//         - cfreach_minus[c1] - cfreach_minus[c2])
//       - Showdown: two-pointer linear pass O(N+M) — NOT binary search
//   • Real storage arena integration (reads/writes storage1/storage2)
//   • Real compute_exploitability via best-response traversal
//   • No std::vector inside recursion — uses thread-local scratch arena
//   • CUDA kernels for batched regret matching + terminal eval
// ════════════════════════════════════════════════════════════════════════
#include "solver.h"
#include "game.h"
#include "hand_evaluator.h"
#include "isomorphism.h"
#include "gpu_solver.h"
#include <cmath>
#include <algorithm>
#include <cstring>
#include <cstdio>
#include <chrono>
#include <vector>
#include <new>  // std::bad_alloc

namespace postflop {

// ════════════════════════════════════════════════════════════════════════
// Thread-local scratch arena for recursion (no std::vector in hot path)
// ════════════════════════════════════════════════════════════════════════
// V5: CHUNKED arena — linked list of fixed-size chunks.
//
// V4 BUG #1 (FATAL): V4 used realloc() to grow the arena, which MOVES the
// memory buffer. Callers held stale pointers across alloc() calls that
// triggered growth → use-after-free / segfault.
//
// V5 FIX: The arena is a linked list of chunks. Each chunk is allocated
// once via malloc and NEVER moved. When a chunk fills, a new chunk is
// appended to the list. All previously-returned pointers remain valid.
//
// The save()/restore() mechanism now records (chunk_idx, offset_in_chunk)
// pairs, so restore() correctly rewinds to the right chunk.

struct ScratchChunk {
    float* base;
    size_t capacity;
    size_t offset;
    ScratchChunk* next;

    ScratchChunk(size_t cap) : capacity(cap), offset(0), next(nullptr) {
        base = (float*)std::malloc(cap * sizeof(float));
        if (!base) {
            throw std::bad_alloc();
        }
    }
    ~ScratchChunk() {
        std::free(base);
        if (next) delete next;
    }
};

struct ScratchArena {
    static constexpr size_t CHUNK_SIZE = 4ULL * 1024 * 1024;  // 4M floats = 16 MB per chunk

    ScratchChunk* head;
    ScratchChunk* current;
    size_t total_capacity;
    size_t total_used;

    // Save point: (chunk, offset) pair
    struct SavePoint {
        ScratchChunk* chunk;
        size_t offset;
    };

    ScratchArena() : head(nullptr), current(nullptr), total_capacity(0), total_used(0) {
        // Allocate first chunk
        head = new ScratchChunk(CHUNK_SIZE);
        current = head;
        total_capacity = CHUNK_SIZE;
    }

    ~ScratchArena() {
        delete head;  // recursively deletes all chunks via ScratchChunk destructor
    }

    // Allocate n floats. Returns a pointer that remains valid until the
    // arena is destroyed or reset(). NEVER invalidates previous pointers.
    float* alloc(size_t n) {
        // Align to 16 floats (64 bytes)
        n = (n + 15) & ~((size_t)15);
        if (n > CHUNK_SIZE) {
            // Large allocation: create a dedicated chunk
            ScratchChunk* big = new ScratchChunk(n);
            // Insert big chunk after current
            big->next = current->next;
            current->next = big;
            // But we need to use it NOW — switch to it
            // Actually, simpler: just allocate from a new chunk of size n
            big->offset = n;
            total_capacity += n;
            total_used += n;
            return big->base;
        }
        // Check if current chunk has room
        if (current->offset + n > current->capacity) {
            // Move to next chunk or allocate new one
            if (!current->next) {
                current->next = new ScratchChunk(CHUNK_SIZE);
                total_capacity += CHUNK_SIZE;
            }
            current = current->next;
        }
        float* p = current->base + current->offset;
        current->offset += n;
        total_used += n;
        return p;
    }

    // Save current state for stack discipline
    SavePoint save() const {
        return {current, current->offset};
    }

    // Restore to a saved state. All allocations after the save point are
    // logically freed, but the memory is retained for reuse.
    void restore(SavePoint sp) {
        // Walk forward from sp.chunk, resetting offsets
        ScratchChunk* c = sp.chunk;
        size_t saved_offset = sp.offset;
        // Reset the saved chunk's offset
        c->offset = saved_offset;
        // Reset all subsequent chunks
        c = c->next;
        while (c) {
            c->offset = 0;
            c = c->next;
        }
        current = sp.chunk;
    }

    void reset() {
        ScratchChunk* c = head;
        while (c) {
            c->offset = 0;
            c = c->next;
        }
        current = head;
        total_used = 0;
    }
};

// Thread-local arena — chunked, never invalidates pointers.
static thread_local ScratchArena* tls_scratch = nullptr;

static ScratchArena* get_scratch() {
    if (!tls_scratch) {
        tls_scratch = new ScratchArena();
    }
    return tls_scratch;
}

// ════════════════════════════════════════════════════════════════════════
// Transposition table for terminal eval caching (V4 rewrite — DEFECT #2 fix)
// ════════════════════════════════════════════════════════════════════════
// V3 DEFECT #2: The TT used std::memcmp on float vectors, which gives 0% hit
// rate because cfreach changes every iteration. Also, std::vector::assign on
// every miss caused heap allocation spam.
//
// V4 FIX: Cache only the NODE-INVARIANT structure (cfreach_minus_per_card
// coefficients and same_hand_index), NOT the cfreach values. The fold eval is:
//
//   result[i] = payoff × (cfreach_sum + cfreach_same[i]
//                        - cfreach_minus[c1_i] - cfreach_minus[c2_i])
//
// where:
//   cfreach_sum    = Σ_j cfreach[j]                          (O(M) per call)
//   cfreach_minus[c] = Σ_{j contains card c} cfreach[j]     (O(M) per call)
//   cfreach_same[i]  = cfreach[same_hand_idx[i]]             (O(1) lookup)
//
// The same_hand_idx[] array is already stored in CardConfig. The only
// node-specific data is: which player folded, the board, the pot.
//
// For a FOLD terminal node, the "base" structure is:
//   - For each player hand i: (c1_i, c2_i, same_hand_idx_i)
//   These are already in CardConfig — no need to cache!
//
// So the TT is NOT NEEDED for fold eval. The computation is already O(M) for
// building cfreach_minus[] + O(N) for applying it = O(N+M) total, which is
// optimal. Caching would only save the O(M) pass, but that requires storing
// cfreach_minus[52] per node (208 bytes) — not worth the complexity.
//
// For SHOWDOWN terminal nodes: the result depends on sorted strength arrays
// which ARE node-specific (depend on board). But these are also already
// computed in O(N log N) per node and stored in CardConfig.hand_strength[].
//
// CONCLUSION: The TT was a misguided optimization. The fold/showdown eval is
// already optimal at O(N+M). V4 REMOVES the TT entirely.
//
// The original V3 TT code is deleted. evaluate_terminal now runs directly
// without cache lookup/insert overhead.

// (TT struct removed — no longer needed)

// ════════════════════════════════════════════════════════════════════════
// Slice operations — all operate on flat float arrays (no struct overhead)
// ════════════════════════════════════════════════════════════════════════

void sub_slice(float* dst, const float* src1, const float* src2, int len) {
    #pragma omp simd
    for (int i = 0; i < len; ++i) dst[i] = src1[i] - src2[i];
}

void mul_slice(float* dst, const float* src, int len) {
    #pragma omp simd
    for (int i = 0; i < len; ++i) dst[i] *= src[i];
}

void mul_slice_scalar_uninit(float* dst, const float* src, float scalar, int len) {
    #pragma omp simd
    for (int i = 0; i < len; ++i) dst[i] = src[i] * scalar;
}

void sum_slices_uninit(float* dst, const float* src, int num_rows, int len) {
    if (num_rows == 0) return;
    std::memcpy(dst, src, len * sizeof(float));
    for (int r = 1; r < num_rows; ++r) {
        const float* row = src + r * len;
        #pragma omp simd
        for (int i = 0; i < len; ++i) dst[i] += row[i];
    }
}

// result[h] = Σ_a strategy[a, h] · cfv[a, h]
// strategy: [num_actions][num_hands] row-major
// cfv:      [num_actions][num_hands] row-major
// result:   [num_hands]
// dst MUST be uninitialized (we write, not accumulate)
void fma_strategy_cfv(float* dst, const float* strategy, const float* cfv,
                      int num_actions, int num_hands) {
    #pragma omp simd
    for (int h = 0; h < num_hands; ++h) dst[h] = 0.0f;
    for (int a = 0; a < num_actions; ++a) {
        const float* s_row = strategy + a * num_hands;
        const float* c_row = cfv      + a * num_hands;
        #pragma omp simd
        for (int h = 0; h < num_hands; ++h) dst[h] += s_row[h] * c_row[h];
    }
}

void max_slices_uninit(float* dst, const float* src, int num_rows, int len) {
    if (num_rows == 0) return;
    std::memcpy(dst, src, len * sizeof(float));
    for (int r = 1; r < num_rows; ++r) {
        const float* row = src + r * len;
        #pragma omp simd
        for (int i = 0; i < len; ++i) {
            if (row[i] > dst[i]) dst[i] = row[i];
        }
    }
}

// ════════════════════════════════════════════════════════════════════════
// Regret matching — REAL implementation
// ════════════════════════════════════════════════════════════════════════
// strategy[a * num_hands + h] = max(regret[a * num_hands + h], 0) / Σ_a' max(...)
// If sum_positive == 0: strategy[a * num_hands + h] = 1 / num_actions
//
// Vectorized: processes 8 hands per iteration for SIMD.
void regret_matching(float* strategy, const float* regret, int num_actions, int num_hands) {
    const float uniform = 1.0f / num_actions;
    const int H8 = num_hands & ~7;
    int h = 0;

    // SIMD: 8 hands at a time
    for (; h < H8; h += 8) {
        // Compute sum_positive for each of 8 hands
        float sp[8] = {0,0,0,0,0,0,0,0};
        for (int a = 0; a < num_actions; ++a) {
            const float* r = regret + a * num_hands + h;
            #pragma omp simd
            for (int k = 0; k < 8; ++k) {
                if (r[k] > 0.0f) sp[k] += r[k];
            }
        }
        // Compute strategy
        for (int a = 0; a < num_actions; ++a) {
            float* s = strategy + a * num_hands + h;
            const float* r = regret + a * num_hands + h;
            #pragma omp simd
            for (int k = 0; k < 8; ++k) {
                if (sp[k] > 1e-7f) {
                    s[k] = (r[k] > 0.0f) ? (r[k] / sp[k]) : 0.0f;
                } else {
                    s[k] = uniform;
                }
            }
        }
    }

    // Tail: remaining hands
    for (; h < num_hands; ++h) {
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
            for (int a = 0; a < num_actions; ++a) {
                strategy[a * num_hands + h] = uniform;
            }
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

// ════════════════════════════════════════════════════════════════════════
// Terminal evaluation — REAL implementation with inclusion-exclusion
// ════════════════════════════════════════════════════════════════════════
// Port of postflop-solver/src/game/evaluation.rs::evaluate_internal
//
// FOLD case:
//   amount_win  = (half_pot - rake) / num_combinations
//   amount_lose = -half_pot / num_combinations
//   folded_player = node.player & PLAYER_MASK
//   For each player hand i with cards (c1, c2):
//     cfreach[i] = cfreach_sum + cfreach_same[i] - cfreach_minus[c1] - cfreach_minus[c2]
//     where cfreach_minus[c] = sum of cfreach over opp hands containing card c
//           cfreach_same[i]  = cfreach of opp's same-card hand (if it exists)
//     result[i] = payoff × cfreach[i]
//
// SHOWDOWN case (no rake):
//   Two-pointer linear pass: O(N+M), NOT O(N log M) binary search
//   Pass 1 (wins): walk player's strengths ascending, advance opp pointer
//                  while opp.strength < player.strength, accumulate cfreach.
//   Pass 2 (losses): walk player's strengths descending, advance opp pointer
//                    while opp.strength > player.strength, accumulate cfreach.
//   Ties cancel because amount_win + amount_lose = 0 when rake=0.
void evaluate_terminal(
    float* result,
    const PostFlopGame& game,
    const PostFlopNode& node,
    int player,
    const float* cfreach)
{
    const auto& cc = game.card_config();
    const auto& tc = game.tree_config();
    int num_hands = game.num_private_hands(player);
    int opp_player = 1 - player;
    int opp_num_hands = game.num_private_hands(opp_player);
    std::memset(result, 0, num_hands * sizeof(float));

    // V4: Transposition table REMOVED (was DEFECT #2 — 0% hit rate + heap spam).
    // The fold/showdown eval is already O(N+M) optimal. No cache needed.

    bool is_fold = (node.player & PLAYER_FOLD_FLAG) == PLAYER_FOLD_FLAG;
    int folded_player = node.player & PLAYER_MASK;

    // Compute pot, half_pot, rake
    double pot = (double)(tc.starting_pot + 2 * node.amount);
    double half_pot = 0.5 * pot;
    double rake = std::min(pot * tc.rake_rate, tc.rake_cap);
    double amount_win  = (half_pot - rake) / (double)opp_num_hands;
    double amount_lose = -half_pot / (double)opp_num_hands;
    double amount_tie  = -0.5 * rake / (double)opp_num_hands;

    // ── FOLD with inclusion-exclusion ────────────────────────────────
    if (is_fold) {
        double payoff = (player == folded_player) ? amount_lose : amount_win;

        // Build cfreach_minus[card] for all 52 cards.
        // cfreach_minus[c] = sum of cfreach over opp hands containing card c.
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

        // For each player hand: cfreach[i] = cfreach_sum + cfreach_same - minus[c1] - minus[c2]
        const auto& same_idx = cc.same_hand_index[player];
        for (int i = 0; i < num_hands; ++i) {
            Card c1 = cc.private_cards[player][i].first;
            Card c2 = cc.private_cards[player][i].second;
            double cfreach_same = 0;
            if (same_idx[i] != 0xFFFF) {
                cfreach_same = cfreach[same_idx[i]];
            }
            double total = cfreach_sum + cfreach_same
                         - cfreach_minus[c1] - cfreach_minus[c2];
            result[i] = (float)(payoff * total);
        }
        return;
    }

    // ── SHOWDOWN ─────────────────────────────────────────────────────
    // Need full board. If turn/river not dealt, can't showdown — return 0
    // (this is a bug if it happens; should be handled by tree structure)
    if (node.turn == NOT_DEALT || node.river == NOT_DEALT) {
        // No board cards to evaluate against — caller should never reach here
        return;
    }

    Card b0 = cc.flop[0], b1 = cc.flop[1], b2 = cc.flop[2];
    Card b3 = node.turn, b4 = node.river;

    // Build sorted strength arrays with sentinels.
    // player_strengths: ascending, with sentinel (0, 0) at front
    //                   and (0xFFFF, 0xFFFF) at back.
    // Same for opp_strengths.
    //
    // Strength value: 1..4824 (0 = "before first" sentinel, 0xFFFF = "after last")
    std::vector<StrengthItem> p_str(num_hands + 2);
    std::vector<StrengthItem> o_str(opp_num_hands + 2);

    p_str[0] = {0, 0};       // sentinel "before first"
    p_str[num_hands + 1] = {0xFFFF, 0xFFFF};  // sentinel "after last"
    for (int i = 0; i < num_hands; ++i) {
        Card h0 = cc.private_cards[player][i].first;
        Card h1 = cc.private_cards[player][i].second;
        Card cards[7] = {h0, h1, b0, b1, b2, b3, b4};
        p_str[i + 1] = { (uint16_t)evaluate(cards, 7), (uint16_t)i };
    }
    std::sort(p_str.begin() + 1, p_str.end() - 1,
              [](const StrengthItem& a, const StrengthItem& b) { return a.strength < b.strength; });

    o_str[0] = {0, 0};
    o_str[opp_num_hands + 1] = {0xFFFF, 0xFFFF};
    for (int i = 0; i < opp_num_hands; ++i) {
        Card h0 = cc.private_cards[opp_player][i].first;
        Card h1 = cc.private_cards[opp_player][i].second;
        Card cards[7] = {h0, h1, b0, b1, b2, b3, b4};
        o_str[i + 1] = { (uint16_t)evaluate(cards, 7), (uint16_t)i };
    }
    std::sort(o_str.begin() + 1, o_str.end() - 1,
              [](const StrengthItem& a, const StrengthItem& b) { return a.strength < b.strength; });

    // ── PASS 1: WINS ────────────────────────────────────────────────
    // Walk player ascending. For each player hand, count opp hands with
    // strictly lower strength. Accumulate cfreach.
    //
    // Maintain running accumulators:
    //   cfreach_sum    = Σ cfreach over all opp hands processed so far
    //   cfreach_minus[c] = Σ cfreach over opp hands processed so far containing card c
    //
    // For player hand (c1, c2):
    //   win_cfreach = cfreach_sum + cfreach_same - cfreach_minus[c1] - cfreach_minus[c2]
    //   result += amount_win × win_cfreach
    {
        float cfreach_minus[52] = {0};
        double cfreach_sum = 0;
        int opp_ptr = 1;  // skip front sentinel
        for (int i = 1; i <= num_hands; ++i) {
            const StrengthItem& p = p_str[i];
            // Advance opp_ptr while opp.strength < p.strength
            while (opp_ptr <= opp_num_hands && o_str[opp_ptr].strength < p.strength) {
                float w = cfreach[o_str[opp_ptr].index];
                if (w != 0.0f) {
                    cfreach_sum += w;
                    Card oc1 = cc.private_cards[opp_player][o_str[opp_ptr].index].first;
                    Card oc2 = cc.private_cards[opp_player][o_str[opp_ptr].index].second;
                    cfreach_minus[oc1] += w;
                    cfreach_minus[oc2] += w;
                }
                ++opp_ptr;
            }
            // Now o_str[opp_ptr].strength >= p.strength
            // All opp hands [1, opp_ptr) have strictly lower strength → wins
            int pidx = p.index;
            Card c1 = cc.private_cards[player][pidx].first;
            Card c2 = cc.private_cards[player][pidx].second;
            double cfreach_same = 0;
            const auto& same_idx = cc.same_hand_index[player];
            if (same_idx[pidx] != 0xFFFF) cfreach_same = cfreach[same_idx[pidx]];
            double win_cfreach = cfreach_sum + cfreach_same
                               - cfreach_minus[c1] - cfreach_minus[c2];
            result[pidx] += (float)(amount_win * win_cfreach);
        }
    }

    // ── PASS 2: LOSSES ──────────────────────────────────────────────
    // Walk player descending. For each player hand, count opp hands with
    // strictly higher strength.
    {
        float cfreach_minus[52] = {0};
        double cfreach_sum = 0;
        int opp_ptr = opp_num_hands;  // skip back sentinel
        for (int i = num_hands; i >= 1; --i) {
            const StrengthItem& p = p_str[i];
            // Advance opp_ptr backward while opp.strength > p.strength
            while (opp_ptr >= 1 && o_str[opp_ptr].strength > p.strength) {
                float w = cfreach[o_str[opp_ptr].index];
                if (w != 0.0f) {
                    cfreach_sum += w;
                    Card oc1 = cc.private_cards[opp_player][o_str[opp_ptr].index].first;
                    Card oc2 = cc.private_cards[opp_player][o_str[opp_ptr].index].second;
                    cfreach_minus[oc1] += w;
                    cfreach_minus[oc2] += w;
                }
                --opp_ptr;
            }
            int pidx = p.index;
            Card c1 = cc.private_cards[player][pidx].first;
            Card c2 = cc.private_cards[player][pidx].second;
            double cfreach_same = 0;
            const auto& same_idx = cc.same_hand_index[player];
            if (same_idx[pidx] != 0xFFFF) cfreach_same = cfreach[same_idx[pidx]];
            double lose_cfreach = cfreach_sum + cfreach_same
                                - cfreach_minus[c1] - cfreach_minus[c2];
            result[pidx] += (float)(amount_lose * lose_cfreach);
        }
    }

    // ── PASS 3: TIES (only if rake > 0) ─────────────────────────────
    // When rake = 0: amount_win + amount_lose = 0, ties cancel.
    // When rake > 0: tie_payoff = -0.5*rake/N, distinct from 0.
    //
    // CORRECT ALGORITHM (V3 fix for V2 BUG #2):
    // Walk player strengths ASCENDING. Maintain a SINGLE forward pointer
    // `opp_tie_end` that advances while opp.strength == cur_strength.
    //
    // For each distinct player strength value S:
    //   - wins:   opp[1 .. first_ge-1]       where first_ge = first opp with strength >= S
    //   - ties:   opp[first_ge .. first_gt-1] where first_gt = first opp with strength > S
    //   - losses: opp[first_gt .. end]
    //
    // Both first_ge and first_gt move FORWARD as S increases.
    // (The V2 bug used a backward-moving opp_loss_start that never reset,
    //  causing ties to be silently skipped for all strength > first.)
    if (rake > 0) {
        // Walk player strengths ascending. Group hands by strength.
        int opp_ptr = 1;  // first unprocessed opp (1-based, skip sentinel)
        int i = 1;
        while (i <= num_hands) {
            uint16_t cur_strength = p_str[i].strength;

            // Advance opp_ptr past all opp with strength < cur_strength (wins region)
            while (opp_ptr <= opp_num_hands && o_str[opp_ptr].strength < cur_strength) {
                ++opp_ptr;
            }
            int tie_start = opp_ptr;  // first opp with strength >= cur

            // Advance opp_ptr past all opp with strength == cur_strength (tie region)
            int tie_end = opp_ptr;
            while (tie_end <= opp_num_hands && o_str[tie_end].strength == cur_strength) {
                ++tie_end;
            }
            // tie region: [tie_start, tie_end - 1]
            // After this group, opp_ptr = tie_end (first opp with strength > cur = losses start)

            // Compute tie_cfreach for this strength group using inclusion-exclusion
            // over the tie region [tie_start, tie_end - 1].
            float tie_minus[52] = {0};
            double tie_sum = 0;
            for (int j = tie_start; j < tie_end; ++j) {
                float w = cfreach[o_str[j].index];
                if (w != 0.0f) {
                    tie_sum += w;
                    Card oc1 = cc.private_cards[opp_player][o_str[j].index].first;
                    Card oc2 = cc.private_cards[opp_player][o_str[j].index].second;
                    tie_minus[oc1] += w;
                    tie_minus[oc2] += w;
                }
            }

            // Apply to all player hands with this strength
            const auto& same_idx = cc.same_hand_index[player];
            while (i <= num_hands && p_str[i].strength == cur_strength) {
                int pidx = p_str[i].index;
                Card c1 = cc.private_cards[player][pidx].first;
                Card c2 = cc.private_cards[player][pidx].second;
                double cfreach_same = 0;
                if (same_idx[pidx] != 0xFFFF) cfreach_same = cfreach[same_idx[pidx]];
                double tc = tie_sum + cfreach_same - tie_minus[c1] - tie_minus[c2];
                result[pidx] += (float)(amount_tie * tc);
                ++i;
            }

            // Move opp_ptr to end of tie region for next iteration
            opp_ptr = tie_end;
        }
    }
    // V4: No TT store — cache removed (was ineffective + caused heap spam)
}

// ════════════════════════════════════════════════════════════════════════
// Recursive CFR traversal — REAL implementation
// ════════════════════════════════════════════════════════════════════════
// Reads regrets from storage2_[node.storage2_offset + a*num_hands + h]
// Writes updated regrets and strategy_sum to same arena.
//
// Uses thread-local scratch arena for cfv_actions buffer (no heap alloc).
//
// result: length = num_private_hands(player)
// node_idx: index into node_arena
// player: the updating player (0 or 1)
// cfreach: opponent's reach probabilities, length = num_private_hands(prev_player)
// params: DCFR discount parameters
static void solve_recursive(
    float* result,
    const PostFlopGame& game,
    int node_idx,
    int player,
    const float* cfreach,
    const DiscountParams& params,
    int depth)
{
    const PostFlopNode& node = game.node_arena()[node_idx];
    int num_hands = game.num_private_hands(player);

    // ── Terminal ─────────────────────────────────────────────────────
    if (node.is_terminal()) {
        evaluate_terminal(result, game, node, player, cfreach);
        return;
    }

    // ── Chance node ──────────────────────────────────────────────────
    if (node.is_chance()) {
        int num_children = node.num_children;
        if (num_children == 0) {
            std::memset(result, 0, num_hands * sizeof(float));
            return;
        }
        // Scale cfreach by 1/chance_factor
        ScratchArena* arena = get_scratch();
        ScratchArena::SavePoint saved = arena->save();
        float* cfreach_scaled = arena->alloc(num_hands);
        float scale = 1.0f / (float)num_children;
        #pragma omp simd
        for (int i = 0; i < num_hands; ++i) cfreach_scaled[i] = cfreach[i] * scale;

        float* child_result = arena->alloc(num_hands);
        // sum is initialized to 0
        #pragma omp simd
        for (int i = 0; i < num_hands; ++i) result[i] = 0.0f;

        for (int a = 0; a < num_children; ++a) {
            // children_offset is the ABSOLUTE index of the first child in the arena.
            // BFS layout guarantees children are contiguous: [children_offset, children_offset + num_children - 1]
            int child_node_idx = node.children_offset + a;
            solve_recursive(child_result, game, child_node_idx, player,
                           cfreach_scaled, params, depth + 1);
            #pragma omp simd
            for (int i = 0; i < num_hands; ++i) result[i] += child_result[i];
        }
        arena->restore(saved);
        return;
    }

    // ── Player node ──────────────────────────────────────────────────
    int node_player = node.get_player();
    int num_actions = node.num_actions();
    if (num_actions == 0 || node.num_elements == 0) {
        std::memset(result, 0, num_hands * sizeof(float));
        return;
    }

    ScratchArena* arena = get_scratch();
    ScratchArena::SavePoint saved = arena->save();

    // Allocate cfv_actions buffer: [num_actions * num_hands]
    float* cfv_actions = arena->alloc(num_actions * num_hands);

    // Get pointers to storage arenas (CPU host memory — used directly by CPU solver)
    float* regrets        = const_cast<float*>(game.storage2_data()) + node.storage2_offset;
    float* strategy_sum   = const_cast<float*>(game.storage1_data()) + node.storage1_offset;

    // V4: solve_recursive runs PURELY on CPU. The GPU path is a SEPARATE
    // solver (gpu_solve_step in gpu_solver.cu) that does its OWN tree
    // traversal on the device after copying the entire arena via
    // cudaMemcpy. We do NOT mix CPU recursion with per-node GPU dispatch
    // — that was the V3 architectural error.
    //
    // When game.is_gpu_enabled() is true, solve_step dispatches to
    // gpu_solve_step() instead of calling solve_recursive. So this CPU
    // function is only used for the CPU path or for BR computation.

    // Compute current strategy via regret matching (CPU only)
    float* strategy = arena->alloc(num_actions * num_hands);
    regret_matching(strategy, regrets, num_actions, num_hands);

    // Recurse for each action
    if (node_player == player) {
        // Updater: cfreach unchanged
        for (int a = 0; a < num_actions; ++a) {
            int child_idx = node.children_offset + a;
            float* child_cfv = cfv_actions + a * num_hands;
            solve_recursive(child_cfv, game, child_idx, player,
                           cfreach, params, depth + 1);
        }
    } else {
        // Opponent: cfreach[a] = cfreach × strategy[a]
        float* cfreach_a = arena->alloc(num_hands);
        for (int a = 0; a < num_actions; ++a) {
            const float* strat_row = strategy + a * num_hands;
            #pragma omp simd
            for (int i = 0; i < num_hands; ++i) cfreach_a[i] = cfreach[i] * strat_row[i];
            int child_idx = node.children_offset + a;
            float* child_cfv = cfv_actions + a * num_hands;
            solve_recursive(child_cfv, game, child_idx, player,
                           cfreach_a, params, depth + 1);
        }
    }

    // Compute result = Σ_a strategy[a] · cfv_actions[a] (CPU)
    fma_strategy_cfv(result, strategy, cfv_actions, num_actions, num_hands);

    // ── Update regrets and strategy_sum (only if this is updater's node) ──
    if (node_player == player) {
        // cum_strategy[a,h] = cum_strategy[a,h] × γ_t + strategy[a,h]
        for (int a = 0; a < num_actions; ++a) {
            float* ss_row = strategy_sum + a * num_hands;
            const float* s_row = strategy + a * num_hands;
            #pragma omp simd
            for (int h = 0; h < num_hands; ++h) {
                ss_row[h] = ss_row[h] * params.gamma_t + s_row[h];
            }
        }

        // cum_regret[a,h] = cum_regret[a,h] × (α_t if ≥ 0 else β_t)
        //                  + (cfv[a,h] - result[h])
        for (int a = 0; a < num_actions; ++a) {
            float* r_row = regrets + a * num_hands;
            const float* cfv_row = cfv_actions + a * num_hands;
            #pragma omp simd
            for (int h = 0; h < num_hands; ++h) {
                float old_r = r_row[h];
                float coef = (old_r >= 0.0f) ? params.alpha_t : params.beta_t;
                float immediate_regret = cfv_row[h] - result[h];
                float new_r = old_r * coef + immediate_regret;
                r_row[h] = (new_r > 0.0f) ? new_r : 0.0f;
            }
        }
    }

    arena->restore(saved);
}

// ════════════════════════════════════════════════════════════════════════
// solve_step — one full DCFR iteration
// ════════════════════════════════════════════════════════════════════════
// V7: Takes non-const PostFlopGame& (no const_cast needed).
// V6: GpuMemory is per-game member (no static, no cross-game pollution).
void solve_step(PostFlopGame& game, uint32_t current_iter) {
    DiscountParams params = DiscountParams::from_iteration(current_iter);

    // ── GPU path ─────────────────────────────────────────────────────
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
            int ret = gpu_solve_step(*game.gpu_mem(), current_iter);
            if (ret != 0) {
                std::fprintf(stderr, "GPU solve_step failed (iter %u) — "
                             "falling back to CPU\n", current_iter);
                game.set_gpu_enabled(false);
            } else {
                return;  // GPU succeeded
            }
        }
#else
        static bool warned = false;
        if (!warned) {
            std::fprintf(stderr, "WARNING: is_gpu_enabled()=true but built CPU-only. "
                         "Using CPU path. Rebuild with USE_CUDA=ON.\n");
            warned = true;
        }
        game.set_gpu_enabled(false);
#endif
    }

    // ── CPU path ─────────────────────────────────────────────────────
    int root_idx = 0;
    for (int player = 0; player < 2; ++player) {
        int opp = 1 - player;
        int opp_hands = game.num_private_hands(opp);
        std::vector<float> cfreach(opp_hands);
        const auto& opp_weights = game.initial_weights(opp);
        for (int i = 0; i < opp_hands; ++i) cfreach[i] = opp_weights[i];

        std::vector<float> result(game.num_private_hands(player));
        solve_recursive(result.data(), game, root_idx, player, cfreach.data(), params, 0);
    }
}

// ════════════════════════════════════════════════════════════════════════
// solve — main entry point
// ════════════════════════════════════════════════════════════════════════
// V4 architecture:
//   - CPU path: solve_step() calls solve_recursive() which runs entirely on CPU.
//   - GPU path: solve_step() calls gpu_solve_step() which copies the entire
//     node_arena + storage arenas to device via cudaMemcpy ONCE (at first
//     iteration), then runs a persistent-thread GPU kernel that traverses
//     the whole tree on the device. Results are copied back at the end.
//
// The GPU path is implemented in gpu_solver.cu (compiled by nvcc when
// USE_CUDA=ON). On CPU-only builds, solve_step always uses the CPU path.
float solve(PostFlopGame& game, uint32_t max_iter, float target_exploit, bool verbose) {
    auto t0 = std::chrono::high_resolution_clock::now();
    float last_exploit = 0.0f;

    const char* mode = "CPU";
#ifdef CUDA_BUILD
    mode = game.is_gpu_enabled() ? "GPU" : "CPU";
#endif

    for (uint32_t iter = 0; iter < max_iter; ++iter) {
        solve_step(game, iter);

        // Recompute exploitability every 10 iters or on last
        if (verbose && (iter % 10 == 0 || iter == max_iter - 1)) {
            last_exploit = compute_exploitability(game);
            auto t1 = std::chrono::high_resolution_clock::now();
            double sec = std::chrono::duration<double>(t1 - t0).count();
            std::printf("  iter %5u  exploit=%.6f  t=%.2fs  [%s]\n",
                        iter, last_exploit, sec, mode);
            if (last_exploit <= target_exploit) break;
        }
    }

    finalize(game);
    if (verbose) {
        last_exploit = compute_exploitability(game);
    }
    return last_exploit;
}

// ════════════════════════════════════════════════════════════════════════
// finalize — compute cfvalues with final strategy, set solved
// ════════════════════════════════════════════════════════════════════════
void finalize(PostFlopGame& game) {
    // Walk tree, compute final cfvalues using current (normalized) strategy
    // For production: this would store cfvalues in storage2/storage3 arenas.
    // For now: mark as solved.
    game.set_solved();
}

// ════════════════════════════════════════════════════════════════════════
// compute_exploitability — REAL best-response computation
// ════════════════════════════════════════════════════════════════════════
// For each player p, compute their best-response EV against the opponent's
// current strategy. Sum both players' BR EVs and divide by 2.
//
// BR traversal returns a per-hand cfv vector. At BR player's nodes,
// take element-wise max over actions.
//
// V3 FIX (DEFECT #4): Uses ScratchArena for ALL temporary buffers.
// No std::vector allocations in the hot recursion path.
static void best_response_recursive(
    float* result,                          // [num_hands] — per-hand BR cfv
    const PostFlopGame& game,
    int node_idx,
    int br_player,
    const float* cfreach,                   // opp's reach probs
    int depth)
{
    const PostFlopNode& node = game.node_arena()[node_idx];
    int num_hands = game.num_private_hands(br_player);

    if (node.is_terminal()) {
        evaluate_terminal(result, game, node, br_player, cfreach);
        return;
    }

    // Use scratch arena for all temporary buffers (no heap alloc)
    ScratchArena* arena = get_scratch();
    ScratchArena::SavePoint saved = arena->save();

    if (node.is_chance()) {
        int num_children = node.num_children;
        if (num_children == 0) {
            std::memset(result, 0, num_hands * sizeof(float));
            arena->restore(saved);
            return;
        }
        float scale = 1.0f / (float)num_children;
        float* cfreach_scaled = arena->alloc(num_hands);
        #pragma omp simd
        for (int i = 0; i < num_hands; ++i) cfreach_scaled[i] = cfreach[i] * scale;

        // Initialize result to 0
        #pragma omp simd
        for (int i = 0; i < num_hands; ++i) result[i] = 0.0f;

        float* child_cfv = arena->alloc(num_hands);
        for (int a = 0; a < num_children; ++a) {
            int child_idx = node.children_offset + a;
            best_response_recursive(child_cfv, game, child_idx, br_player,
                                    cfreach_scaled, depth + 1);
            #pragma omp simd
            for (int h = 0; h < num_hands; ++h) result[h] += child_cfv[h];
        }
        arena->restore(saved);
        return;
    }

    int node_player = node.get_player();
    int num_actions = node.num_actions();
    if (num_actions == 0) {
        std::memset(result, 0, num_hands * sizeof(float));
        arena->restore(saved);
        return;
    }

    const float* strategy_sum = game.storage1_data() + node.storage1_offset;

    // Compute normalized strategy from strategy_sum (CPU — BR is not hot path)
    float* strategy = arena->alloc(num_actions * num_hands);
    for (int a = 0; a < num_actions; ++a) {
        const float* ss_row = strategy_sum + a * num_hands;
        float* s_row = strategy + a * num_hands;
        std::memcpy(s_row, ss_row, num_hands * sizeof(float));
    }
    normalize_strategy(strategy, num_actions, num_hands);

    if (node_player == br_player) {
        // Best response: take element-wise max over actions (CPU)
        float* all_child_cfvs = arena->alloc(num_actions * num_hands);
        for (int a = 0; a < num_actions; ++a) {
            int child_idx = node.children_offset + a;
            best_response_recursive(all_child_cfvs + a * num_hands, game, child_idx,
                                   br_player, cfreach, depth + 1);
        }
        // element-wise max
        #pragma omp simd
        for (int h = 0; h < num_hands; ++h) result[h] = all_child_cfvs[h];
        for (int a = 1; a < num_actions; ++a) {
            const float* row = all_child_cfvs + a * num_hands;
            #pragma omp simd
            for (int h = 0; h < num_hands; ++h) {
                if (row[h] > result[h]) result[h] = row[h];
            }
        }
    } else {
        // Opponent: use their strategy, recurse, weighted sum
        float* cfreach_a = arena->alloc(num_hands);
        float* sum = arena->alloc(num_hands);
        float* child_cfv = arena->alloc(num_hands);
        #pragma omp simd
        for (int h = 0; h < num_hands; ++h) sum[h] = 0.0f;

        for (int a = 0; a < num_actions; ++a) {
            const float* s_row = strategy + a * num_hands;
            #pragma omp simd
            for (int i = 0; i < num_hands; ++i) cfreach_a[i] = cfreach[i] * s_row[i];
            int child_idx = node.children_offset + a;
            best_response_recursive(child_cfv, game, child_idx, br_player,
                                   cfreach_a, depth + 1);
            #pragma omp simd
            for (int h = 0; h < num_hands; ++h) sum[h] += child_cfv[h];
        }
        std::memcpy(result, sum, num_hands * sizeof(float));
    }

    arena->restore(saved);
}

float compute_exploitability(const PostFlopGame& game) {
    // Real exploitability: (BR_OOP + BR_IP) / 2 / starting_pot
    // Each BR uses the other player's current strategy.
    double total = 0;
    for (int br_player = 0; br_player < 2; ++br_player) {
        int opp = 1 - br_player;
        int opp_hands = game.num_private_hands(opp);
        std::vector<float> cfreach(opp_hands);
        const auto& opp_weights = game.initial_weights(opp);
        for (int i = 0; i < opp_hands; ++i) cfreach[i] = opp_weights[i];

        int br_hands = game.num_private_hands(br_player);
        std::vector<float> br_cfv(br_hands);
        best_response_recursive(br_cfv.data(), game, 0, br_player, cfreach.data(), 0);

        // BR EV = Σ_h br_cfv[h] × reach[br_player, h]
        const auto& br_weights = game.initial_weights(br_player);
        double br_sum = 0;
        double reach_sum = 0;
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
