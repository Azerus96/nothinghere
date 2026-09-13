// ════════════════════════════════════════════════════════════════════════
// tests/test_regression_payoffs.cpp — [TEST-1]
// Scenario: River, pot = 100, villain all-in = 1000, hero holds a 0%-equity
// bluff-catcher (2c3c) vs a range that always holds the royal flush.
// Assertions:
//   * CFV(Fold) == -node.invested            [Defect 1.1]
//   * CFV(Call)  <  CFV(Fold)
//   * Strategy(Fold) == 1.0f after convergence
// Verified on BOTH the CPU evaluator and the compat-GPU kernel pipeline.
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
#include "gpu_solver.h"

using namespace postflop;

static int pass = 0, fail = 0;
static void check(bool ok, const std::string& name) {
    std::printf("  %s: %s\n", ok ? "PASS" : "FAIL", name.c_str());
    if (ok) ++pass; else ++fail;
}

// Board As Ks Qs Js 2d — any hand containing Ts has the royal flush.
static const char* ROYAL_RANGE = "Ts2s,Ts3s,Ts4s,Ts5s,Ts6s,Ts7s,Ts8s,Ts9s";

static CardConfig make_cc() {
    CardConfig cc;
    cc.num_players = 2;
    cc.range_oop = Range::from_string(ROYAL_RANGE);   // villain (OOP) shoves
    cc.range_ip  = Range::from_string("2c3c");        // hero bluff-catcher
    cc.flop[0] = card_from_string("As");
    cc.flop[1] = card_from_string("Ks");
    cc.flop[2] = card_from_string("Qs");
    cc.turn = card_from_string("Js");
    cc.river = card_from_string("2d");
    return cc;
}

static TreeConfig make_tc() {
    TreeConfig tc;
    tc.num_players = 2;
    tc.initial_state = BoardState::River;
    tc.starting_pot = 100;      // preflop pot
    tc.effective_stack = 1000;  // villain all-in size
    tc.river_bet_sizes[0] = { {BetSize::AllIn()}, {} };   // villain (OOP) shoves
    tc.river_bet_sizes[1] = { {}, {} };                   // hero only reacts
    return tc;
}

int main() {
    std::printf("=== [TEST-1] Regression: terminal net payoffs (Defect 1.1) ===\n\n");

    PostFlopGame game(make_cc(), make_tc());
    game.prepare();
    game.allocate_memory(false);

    // Locate the hero decision node (IP, actions [Fold, Call]) and its
    // two terminal children.
    int hero_node = -1, fold_child = -1, call_child = -1;
    for (size_t i = 0; i < game.node_arena().size(); ++i) {
        const PostFlopNode& n = game.node_arena()[i];
        if (n.is_terminal() || n.is_chance()) continue;
        if (n.get_player() == 1 && n.num_actions() == 2) {
            hero_node = (int)i;
            for (int a = 0; a < 2; ++a) {
                const PostFlopNode& c = game.node_arena()[n.children_offset + a];
                if (c.player & PLAYER_FOLD_FLAG) fold_child = (int)n.children_offset + a;
                else call_child = (int)n.children_offset + a;
            }
            break;
        }
    }
    check(hero_node >= 0 && fold_child >= 0 && call_child >= 0,
          "hero fold/call decision node located");

    const PostFlopNode& fold_node = game.node_arena()[fold_child];
    const PostFlopNode& call_node = game.node_arena()[call_child];

    // Zero-sum invariant on every node [Defect 1.8].
    bool zerosum_ok = true;
    for (const auto& n : game.node_arena()) {
        int64_t s = 0;
        for (int p = 0; p < 2; ++p) s += n.invested[p];
        if (s != n.amount) { zerosum_ok = false; break; }
    }
    check(zerosum_ok, "invested[0]+invested[1] == amount (exact zero-sum bookkeeping)");

    // Villain's normalized reach (initial weights).
    std::vector<float> vreach = game.initial_weights(0);

    // ── CPU evaluator assertions ─────────────────────────────────────────
    std::vector<float> cfv_fold(game.num_private_hands(1));
    evaluate_terminal(cfv_fold.data(), game, fold_node, 1, vreach.data());

    // compat = 1 exactly: villain's 8 Ts-combos contain neither 2c nor 3c.
    double expected_fold = -(double)fold_node.invested[1];
    double got_fold = cfv_fold[0];
    std::printf("  CFV(Fold) = %.6f (expected -invested = %.6f), pot=%d inv1=%d\n",
                got_fold, expected_fold, fold_node.amount, fold_node.invested[1]);
    check(std::fabs(got_fold - expected_fold) < 1e-3,
          "CFV(Fold) == -node.invested (CPU evaluator)");

    std::vector<float> cfv_call(game.num_private_hands(1));
    evaluate_terminal(cfv_call.data(), game, call_node, 1, vreach.data());
    std::printf("  CFV(Call) = %.6f (0%% equity: pot*0 - invested_total)\n", cfv_call[0]);
    check(cfv_call[0] < cfv_fold[0], "CFV(Call) < CFV(Fold)");
    check(cfv_call[0] < -1000.0, "CFV(Call) reflects the full 1000-chip call investment");

    // ── Compat-GPU kernel pipeline assertions ────────────────────────────
    // CPU reference solve first (same iteration count).
    for (uint32_t it = 0; it < 200; ++it) solve_step(game, it);

    PostFlopGame game2(make_cc(), make_tc());
    game2.prepare();
    game2.allocate_memory(false);
    game2.set_gpu_enabled(true);
    for (uint32_t it = 0; it < 200; ++it) solve_step(game2, it);
    check(game2.gpu_mem_initialized(), "compat-GPU pipeline initialized");
    if (game2.gpu_mem_initialized()) {
        gpu_solver_copy_back(game2, *game2.gpu_mem());
    }

    // Hero's converged strategy at the decision node: fold = 1.0.
    auto read_strategy = [](PostFlopGame& g, int node) {
        const PostFlopNode& n = g.node_arena()[node];
        int na = n.num_actions();
        int nh = g.num_private_hands(1);
        std::vector<float> s((size_t)na * nh, 0.0f);
        const float* src = g.storage1_data() + n.storage1_offset;
        std::memcpy(s.data(), src, sizeof(float) * s.size());
        normalize_strategy(s.data(), na, nh);
        return s;
    };
    std::vector<float> strat_cpu = read_strategy(game, hero_node);
    std::vector<float> strat_gpu = read_strategy(game2, hero_node);

    // Actions are sorted: Fold (type 1) < Call (type 3).
    check(strat_cpu[0] > 0.999f, "Strategy(Fold) == 1.0 (CPU solve)");
    check(strat_gpu[0] > 0.999f, "Strategy(Fold) == 1.0 (compat-GPU solve)");
    check(std::fabs(strat_cpu[0] - strat_gpu[0]) < 0.02,
          "CPU and compat-GPU fold strategies agree");

    // DCFR regret sanity: the call regret must be strictly negative.
    const PostFlopNode& hn = game.node_arena()[hero_node];
    int nh1 = game.num_private_hands(1);
    float call_regret = game.storage2_data()[hn.storage2_offset + 1 * nh1 + 0];
    check(call_regret < 0.0f, "call regret strictly negative (negative retention, Defect 1.3)");

    std::printf("\n=== [TEST-1] Summary: %d passed, %d failed ===\n", pass, fail);
    return fail == 0 ? 0 : 1;
}
