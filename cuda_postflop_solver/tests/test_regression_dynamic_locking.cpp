// ════════════════════════════════════════════════════════════════════════
// tests/test_regression_dynamic_locking.cpp — [Module 5, V8] dynamic HUD
// node-locking regression suite
// ════════════════════════════════════════════════════════════════════════
// Verifies:
//   1. apply_dynamic_node_lock binds EXACT empirical frequencies to the
//      semantic Action::Type (fold 0.72 / call 0.20 / raise 0.08 HUD row).
//   2. Passive residual absorption: distributions sum to exactly 1.0 on
//      any action set; absent types contribute their mass to the residual.
//   3. Over-constrained payloads renormalize proportionally.
//   4. regret_matching reproduces the target distribution exactly; the
//      strategy is uniform across hands.
//   5. locked_players_mask gains the player's bit and the solver freezes
//      the locked strategy across iterations (CPU path).
//   6. Unconstrained payloads are a no-op; multiway seat indices work.
// ════════════════════════════════════════════════════════════════════════
#include <cstdio>
#include <cmath>
#include <vector>
#include <string>
#include "card.h"
#include "hand_evaluator.h"
#include "range.h"
#include "action_tree.h"
#include "game.h"
#include "solver.h"
#include "node_locking.h"

using namespace postflop;

static int pass = 0, fail = 0;
static void check(bool ok, const std::string& name) {
    std::printf("  %s: %s\n", ok ? "PASS" : "FAIL", name.c_str());
    if (ok) ++pass; else ++fail;
}

static std::unique_ptr<PostFlopGame> build_game(int num_players = 2) {
    CardConfig cc;
    cc.num_players = num_players;
    cc.ranges.push_back(Range::from_string("AA,KK,QQ,AKs,AKo"));
    for (int p = 1; p < num_players; ++p) cc.ranges.push_back(Range::from_string("AA,KK,QQ,AKs"));
    cc.flop[0] = card_from_string("As");
    cc.flop[1] = card_from_string("Kd");
    cc.flop[2] = card_from_string("2c");
    cc.turn = card_from_string("7h");
    cc.river = card_from_string("2d");

    TreeConfig tc;
    tc.num_players = num_players;
    tc.initial_state = BoardState::Flop;
    tc.starting_pot = 100;
    tc.effective_stack = 500;
    tc.flop_bet_sizes[0] = { {BetSize::PotRelative(0.50), BetSize::AllIn()}, {} };
    for (int i = 1; i < num_players; ++i) tc.flop_bet_sizes[i] = tc.flop_bet_sizes[0];
    tc.turn_bet_sizes[0] = tc.flop_bet_sizes[0];
    tc.river_bet_sizes[0] = tc.flop_bet_sizes[0];

    auto g = std::make_unique<PostFlopGame>(std::move(cc), tc);
    g->prepare();
    g->allocate_memory(false);
    return g;
}

// Locate a decision node owned by `player` whose action set contains
// exactly the given semantic types (one entry per required type).
static int find_node(const PostFlopGame& game, int player,
                     const std::vector<Action::Type>& required,
                     const std::vector<Action::Type>& forbidden) {
    for (size_t i = 0; i < game.num_nodes(); ++i) {
        const PostFlopNode& n = game.node_arena()[i];
        if (n.is_terminal() || n.is_chance()) continue;
        if (n.get_player() != player) continue;
        bool has_all = true;
        for (auto t : required) {
            bool found = false;
            for (int a = 0; a < n.num_actions(); ++a) {
                if ((Action::Type)n.action_type(a) == t) found = true;
            }
            if (!found) has_all = false;
        }
        bool none_forbidden = true;
        for (auto t : forbidden) {
            for (int a = 0; a < n.num_actions(); ++a) {
                if ((Action::Type)n.action_type(a) == t) none_forbidden = false;
            }
        }
        if (has_all && none_forbidden) return (int)i;
    }
    return -1;
}

static float type_prob(const PostFlopGame& game, int node_idx, int player, Action::Type t) {
    auto strat = locked_strategy_at_node(game, node_idx, player);
    const PostFlopNode& n = game.node_arena()[node_idx];
    float total = 0.0f;
    for (int a = 0; a < n.num_actions(); ++a) {
        if ((Action::Type)n.action_type(a) == t) total += strat[a][0];
    }
    return total;
}

int main() {
    std::printf("=== [V8] Regression: dynamic HUD node-locking (Module 5) ===\n\n");

    // ── 1. The spec's reference HUD row ─────────────────────────────────
    std::printf("── Reference HUD payload: fold 0.72 / call 0.20 / raise 0.08 ──\n");
    {
        auto game = build_game();
        int facing = find_node(*game, 1,
                               {Action::Type::Fold, Action::Type::Call},
                               {});
        check(facing >= 0, "facing-bet node [Fold, Call, ...] located");
        if (facing >= 0) {
            DynamicActionLock lock;
            lock.player_idx = 1;
            lock.fold  = 0.72f;
            lock.call  = 0.20f;
            lock.raise = 0.08f;    // no Raise at this node -> residual mass
            apply_dynamic_node_lock(*game, lock);

            float p_fold = type_prob(*game, facing, 1, Action::Type::Fold);
            float p_call = type_prob(*game, facing, 1, Action::Type::Call);
            float p_allin = type_prob(*game, facing, 1, Action::Type::AllIn);
            std::printf("    facing-bet node: Fold=%.4f Call=%.4f AllIn=%.4f\n",
                        p_fold, p_call, p_allin);
            check(std::fabs(p_fold - 0.72f) < 1e-4, "Fold locked at the exact HUD frequency 0.72");
            check(std::fabs(p_call - 0.28f) < 1e-4,
                  "Call absorbs the residual (0.20 + 0.08 absent-Raise mass = 0.28)");
            check(p_allin <= 1e-4, "unconstrained aggressive actions receive zero mass");
            check(std::fabs(p_fold + p_call + p_allin - 1.0f) < 1e-4,
                  "distribution sums to exactly 1.0");
        }

        // Unopened node: [Check, Bet, AllIn] — Fold/Call/Raise all absent,
        // the full mass flows to the passive anchor (Check).
        int unopened = find_node(*game, 1, {Action::Type::Check},
                                 {Action::Type::Fold, Action::Type::Call});
        check(unopened >= 0, "unopened node [Check, Bet, AllIn] located");
        if (unopened >= 0) {
            float p_check = type_prob(*game, unopened, 1, Action::Type::Check);
            float p_bet = type_prob(*game, unopened, 1, Action::Type::Bet);
            std::printf("    unopened node: Check=%.4f Bet=%.4f\n", p_check, p_bet);
            check(std::fabs(p_check - 1.0f) < 1e-4,
                  "absent-type mass flows to the passive anchor (Check = 1.0)");
            check(p_bet <= 1e-4, "unconstrained Bet receives zero mass");
        }

        // Uniformity across hands (arena written identically per hand).
        if (facing >= 0) {
            auto strat = locked_strategy_at_node(*game, facing, 1);
            int nh = game->num_private_hands(1);
            bool uniform = true;
            for (int a = 0; a < (int)strat.size(); ++a) {
                for (int h = 1; h < nh; ++h) {
                    if (std::fabs(strat[a][h] - strat[a][0]) > 1e-5f) uniform = false;
                }
            }
            check(uniform, "locked strategy constant across all hands");
        }

        // Lock mask frozen across iterations (CPU path honors the mask).
        check((game->locked_players_mask() & (1u << 1)) != 0,
              "locked_players_mask gains player 1's bit");
        std::vector<float> before;
        {
            const PostFlopNode& n = game->node_arena()[facing >= 0 ? facing : 0];
            const float* s2 = game->storage2_data() + n.storage2_offset;
            int na = n.num_actions(), nh = game->num_private_hands(1);
            for (int i = 0; i < na * nh; ++i) before.push_back(s2[i]);
        }
        for (uint32_t it = 0; it < 5; ++it) solve_step(*game, it);
        bool frozen = true;
        {
            const PostFlopNode& n = game->node_arena()[facing >= 0 ? facing : 0];
            const float* s2 = game->storage2_data() + n.storage2_offset;
            int na = n.num_actions(), nh = game->num_private_hands(1);
            for (int i = 0; i < na * nh && i < (int)before.size(); ++i) {
                if (std::fabs(s2[i] - before[i]) > 1e-6f) frozen = false;
            }
        }
        check(frozen, "locked regrets frozen across 5 solve iterations (CPU path)");
    }

    // ── 2. Over-constrained payload: proportional renormalization ──────
    std::printf("\n── Over-constrained payload (fold 0.9 + call 0.9) ──\n");
    {
        auto game = build_game();
        int facing = find_node(*game, 1, {Action::Type::Fold, Action::Type::Call}, {});
        if (facing >= 0) {
            DynamicActionLock lock;
            lock.player_idx = 1;
            lock.fold = 0.9f;
            lock.call = 0.9f;
            apply_dynamic_node_lock(*game, lock);
            float p_fold = type_prob(*game, facing, 1, Action::Type::Fold);
            float p_call = type_prob(*game, facing, 1, Action::Type::Call);
            std::printf("    Fold=%.4f Call=%.4f (expect 0.5 / 0.5)\n", p_fold, p_call);
            check(std::fabs(p_fold - 0.5f) < 1e-4 && std::fabs(p_call - 0.5f) < 1e-4,
                  "over-constrained targets renormalize proportionally (0.5 / 0.5)");
            check(std::fabs(p_fold + p_call - 1.0f) < 1e-4, "renormalized distribution sums to 1");
        }
    }

    // ── 3. No-op semantics ─────────────────────────────────────────────
    std::printf("\n── Unconstrained payload is a no-op ──\n");
    {
        auto game = build_game();
        uint8_t mask_before = game->locked_players_mask();
        DynamicActionLock lock;              // player_idx = -1, all fields -1
        apply_dynamic_node_lock(*game, lock);
        check(game->locked_players_mask() == mask_before,
              "empty lock (no player) leaves the mask untouched");

        DynamicActionLock lock2;
        lock2.player_idx = 1;                // valid seat, no specified field
        apply_dynamic_node_lock(*game, lock2);
        check(game->locked_players_mask() == mask_before,
              "all-negative payload (pure GTO) leaves the mask untouched");
    }

    // ── 4. Multiway lock + legacy coexistence ──────────────────────────
    std::printf("\n── Multiway dynamic lock (3-way) ──\n");
    {
        auto game = build_game(3);
        int node3 = find_node(*game, 2, {Action::Type::Fold, Action::Type::Call}, {});
        check(node3 >= 0, "3-way facing-bet node for seat 2 located");
        if (node3 >= 0) {
            DynamicActionLock lock;
            lock.player_idx = 2;
            lock.fold = 0.60f;
            lock.call = 0.40f;
            apply_dynamic_node_lock(*game, lock);
            float p_fold = type_prob(*game, node3, 2, Action::Type::Fold);
            float p_call = type_prob(*game, node3, 2, Action::Type::Call);
            std::printf("    seat 2: Fold=%.4f Call=%.4f\n", p_fold, p_call);
            check(std::fabs(p_fold - 0.60f) < 1e-4 && std::fabs(p_call - 0.40f) < 1e-4,
                  "seat 2 locked at the exact empirical frequencies");
            check((game->locked_players_mask() & (1u << 2)) != 0,
                  "locked_players_mask gains seat 2's bit (multiway)");
        }

        // target_for mapping sanity.
        DynamicActionLock probe;
        probe.fold = 0.1f; probe.check = 0.2f; probe.call = 0.3f;
        probe.bet = 0.4f; probe.raise = 0.5f; probe.allin = 0.6f;
        bool mapping_ok =
            probe.target_for((uint8_t)Action::Type::Fold)   == 0.1f &&
            probe.target_for((uint8_t)Action::Type::Check)  == 0.2f &&
            probe.target_for((uint8_t)Action::Type::Call)   == 0.3f &&
            probe.target_for((uint8_t)Action::Type::Bet)    == 0.4f &&
            probe.target_for((uint8_t)Action::Type::Raise)  == 0.5f &&
            probe.target_for((uint8_t)Action::Type::AllIn)  == 0.6f &&
            probe.target_for((uint8_t)Action::Type::Chance) == -1.0f;
        check(mapping_ok, "DynamicActionLock::target_for maps every semantic Action::Type");
    }

    std::printf("\n=== [V8] dynamic-locking Summary: %d passed, %d failed ===\n", pass, fail);
    return fail == 0 ? 0 : 1;
}
