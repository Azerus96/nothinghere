// ════════════════════════════════════════════════════════════════════════
// tests/test_regression_locking_semantics.cpp — [TEST-4]
// Scenario: Apply CALLING_STATION profile at an unopened Flop node
// (to_call == 0, actions sorted [Check, Bet, (AllIn)]).
// Assertions:
//   * Strategy(Check) >= 0.85f
//   * Strategy(Bet)   <= 0.05f
// (The legacy index-based code assigned 0.85 to index 1 == Bet.)
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

int main() {
    std::printf("=== [TEST-4] Regression: node locking semantics (Defect 1.5) ===\n\n");

    CardConfig cc;
    cc.num_players = 2;
    cc.range_oop = Range::from_string("AA,KK,QQ,AKs,AKo");
    cc.range_ip  = Range::from_string("AA,KK,QQ,AKs,AKo");
    cc.flop[0] = card_from_string("As");
    cc.flop[1] = card_from_string("Kd");
    cc.flop[2] = card_from_string("2c");
    cc.turn = card_from_string("7h");
    cc.river = card_from_string("2d");

    TreeConfig tc;
    tc.num_players = 2;
    tc.initial_state = BoardState::Flop;
    tc.starting_pot = 100;
    tc.effective_stack = 500;
    tc.flop_bet_sizes[0] = { {BetSize::PotRelative(0.50), BetSize::AllIn()}, {} };
    tc.flop_bet_sizes[1] = tc.flop_bet_sizes[0];
    tc.turn_bet_sizes[0] = tc.flop_bet_sizes[0];
    tc.turn_bet_sizes[1] = tc.flop_bet_sizes[0];
    tc.river_bet_sizes[0] = tc.flop_bet_sizes[0];
    tc.river_bet_sizes[1] = tc.flop_bet_sizes[0];

    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    game.allocate_memory(false);

    // Lock player 1 (IP) as a Calling Station.
    apply_node_locking_profile(game, 1, OpponentProfile::CALLING_STATION);

    // Find an UNOPENED flop decision node owned by player 1 (to_call == 0):
    // its action set is [Check, Bet, AllIn] (sorted by Action::Type:
    // Check=2 < Bet=4 < AllIn=6).
    int target = -1;
    for (size_t i = 0; i < game.node_arena().size(); ++i) {
        const PostFlopNode& n = game.node_arena()[i];
        if (n.is_terminal() || n.is_chance()) continue;
        if (n.get_player() != 1) continue;
        bool has_check = false, has_bet = false, has_allin = false, has_fold_or_call = false;
        for (int a = 0; a < n.num_actions(); ++a) {
            Action::Type t = (Action::Type)n.action_type(a);
            if (t == Action::Type::Check) has_check = true;
            if (t == Action::Type::Bet) has_bet = true;
            if (t == Action::Type::AllIn) has_allin = true;
            if (t == Action::Type::Fold || t == Action::Type::Call) has_fold_or_call = true;
        }
        if (has_check && has_bet && !has_fold_or_call) {
            target = (int)i;
            std::printf("  unopened flop node %zu: %d actions [Check, Bet%s]\n",
                        i, n.num_actions(), has_allin ? ", AllIn" : "");
            break;
        }
    }
    check(target >= 0, "unopened flop node (Check vs Bet) located");

    if (target >= 0) {
        const PostFlopNode& n = game.node_arena()[target];
        auto strat = locked_strategy_at_node(game, target, 1);
        int nh = game.num_private_hands(1);

        float p_check = 0.0f, p_bet = 0.0f, p_allin = 0.0f;
        for (int a = 0; a < n.num_actions(); ++a) {
            Action::Type t = (Action::Type)n.action_type(a);
            if (t == Action::Type::Check)  p_check  = strat[a][0];
            if (t == Action::Type::Bet)    p_bet    = strat[a][0];
            if (t == Action::Type::AllIn)  p_allin  = strat[a][0];
        }
        // The strategy must be constant across hands (locked profile).
        bool uniform_across_hands = true;
        for (int a = 0; a < n.num_actions(); ++a) {
            for (int h = 1; h < nh; ++h) {
                if (std::fabs(strat[a][h] - strat[a][0]) > 1e-5f) { uniform_across_hands = false; }
            }
        }
        std::printf("  locked strategy: Check=%.4f  Bet=%.4f  AllIn=%.4f\n",
                    p_check, p_bet, p_allin);

        check(uniform_across_hands, "locked strategy constant across all hands");
        check(p_check >= 0.85f, "Strategy(Check) >= 0.85");
        check(p_bet <= 0.05f, "Strategy(Bet) <= 0.05");
        float total = p_check + p_bet + p_allin;
        check(std::fabs(total - 1.0f) < 1e-4, "locked strategy sums to 1");
    }

    // Facing-a-bet node (to_call > 0): [Fold, Call, AllIn] — the Calling
    // Station must CALL 85%, not fold/bet.
    int facing = -1;
    for (size_t i = 0; i < game.node_arena().size(); ++i) {
        const PostFlopNode& n = game.node_arena()[i];
        if (n.is_terminal() || n.is_chance()) continue;
        if (n.get_player() != 1) continue;
        bool has_fold = false, has_call = false;
        for (int a = 0; a < n.num_actions(); ++a) {
            Action::Type t = (Action::Type)n.action_type(a);
            if (t == Action::Type::Fold) has_fold = true;
            if (t == Action::Type::Call) has_call = true;
        }
        if (has_fold && has_call) { facing = (int)i; break; }
    }
    if (facing >= 0) {
        const PostFlopNode& n = game.node_arena()[facing];
        auto strat = locked_strategy_at_node(game, facing, 1);
        float p_fold = 0, p_call = 0;
        for (int a = 0; a < n.num_actions(); ++a) {
            Action::Type t = (Action::Type)n.action_type(a);
            if (t == Action::Type::Fold) p_fold = strat[a][0];
            if (t == Action::Type::Call) p_call = strat[a][0];
        }
        std::printf("  facing-bet node: Fold=%.4f Call=%.4f\n", p_fold, p_call);
        check(p_call >= 0.80f && p_fold <= 0.15f,
              "CALLING_STATION calls >= 80% when facing a bet (semantic binding)");
    }

    // OVERFOLDER and MANIAC sanity at the unopened node.
    auto fresh_game = [&]() -> std::unique_ptr<PostFlopGame> {
        CardConfig c;
        c.num_players = 2;
        c.range_oop = Range::from_string("AA,KK,QQ,AKs,AKo");
        c.range_ip  = Range::from_string("AA,KK,QQ,AKs,AKo");
        c.flop[0] = card_from_string("As");
        c.flop[1] = card_from_string("Kd");
        c.flop[2] = card_from_string("2c");
        c.turn = card_from_string("7h");
        c.river = card_from_string("2d");
        auto g = std::make_unique<PostFlopGame>(std::move(c), tc);
        g->prepare();
        g->allocate_memory(false);
        return g;
    };

    if (target >= 0) {
        {
            auto g = fresh_game();
            apply_node_locking_profile(*g, 1, OpponentProfile::OVERFOLDER);
            auto strat_of = locked_strategy_at_node(*g, target, 1);
            const PostFlopNode& n = g->node_arena()[target];
            float p_chk = 0, p_bt = 0;
            for (int a = 0; a < n.num_actions(); ++a) {
                Action::Type t = (Action::Type)n.action_type(a);
                if (t == Action::Type::Check) p_chk = strat_of[a][0];
                if (t == Action::Type::Bet) p_bt = strat_of[a][0];
            }
            std::printf("  OVERFOLDER at unopened node: Check=%.4f Bet=%.4f\n", p_chk, p_bt);
            check(p_chk >= 0.80f && p_bt <= 0.20f, "OVERFOLDER stays passive at unopened pots");
        }
        {
            auto g = fresh_game();
            apply_node_locking_profile(*g, 1, OpponentProfile::MANIAC);
            auto strat_m = locked_strategy_at_node(*g, target, 1);
            const PostFlopNode& n = g->node_arena()[target];
            float aggressive = 0;
            for (int a = 0; a < n.num_actions(); ++a) {
                Action::Type t = (Action::Type)n.action_type(a);
                if (t == Action::Type::Bet || t == Action::Type::Raise || t == Action::Type::AllIn)
                    aggressive += strat_m[a][0];
            }
            std::printf("  MANIAC at unopened node: aggressive total=%.4f\n", aggressive);
            check(aggressive >= 0.70f, "MANIAC stays aggressive at unopened pots");
        }
    }

    std::printf("\n=== [TEST-4] Summary: %d passed, %d failed ===\n", pass, fail);
    return fail == 0 ? 0 : 1;
}
