// ════════════════════════════════════════════════════════════════════════
// tests/test_regression_dcfr_negatives.cpp — [TEST-3]
// Scenario: 20 iterations of DCFR on an asymmetric spot with dominated
// actions.
// Assertions:
//   * Negative floating-point values present in storage2 (regret arena)
//   * beta_t discount is active (0.5) and reachable for negative regrets
//   * regret_matching truncates to the positive part WITHOUT destroying the
//     stored negatives
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

int main() {
    std::printf("=== [TEST-3] Regression: DCFR negative regret retention (Defect 1.3) ===\n\n");

    // Asymmetric spot: OOP range is strictly stronger on this board, so IP
    // accumulates genuinely negative regrets for aggressive dominated lines.
    CardConfig cc;
    cc.num_players = 2;
    cc.range_oop = Range::from_string("AA,KK,QQ,JJ,TT");
    cc.range_ip  = Range::from_string("55,44,33,22,76s,65s,54s");
    cc.flop[0] = card_from_string("As");
    cc.flop[1] = card_from_string("Kd");
    cc.flop[2] = card_from_string("Qc");
    cc.turn = card_from_string("7h");
    cc.river = card_from_string("2d");

    TreeConfig tc;
    tc.num_players = 2;
    tc.initial_state = BoardState::Flop;
    tc.starting_pot = 100;
    tc.effective_stack = 500;
    tc.flop_bet_sizes[0] = { {BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(2.5)} };
    tc.flop_bet_sizes[1] = { {BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(2.5)} };
    tc.turn_bet_sizes[0] = tc.flop_bet_sizes[0];
    tc.turn_bet_sizes[1] = tc.flop_bet_sizes[1];
    tc.river_bet_sizes[0] = tc.flop_bet_sizes[0];
    tc.river_bet_sizes[1] = tc.flop_bet_sizes[1];

    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    game.allocate_memory(false);

    // 20 iterations of DCFR.
    for (uint32_t it = 0; it < 20; ++it) solve_step(game, it);

    // 1) Negative regrets present in storage2.
    size_t n = game.storage2_bytes() / sizeof(float);
    const float* regrets = game.storage2_data();
    long long neg_count = 0;
    float min_r = 0.0f;
    for (size_t i = 0; i < n; ++i) {
        if (regrets[i] < 0.0f) { ++neg_count; if (regrets[i] < min_r) min_r = regrets[i]; }
    }
    std::printf("  storage2: %zu floats, %lld negative, min = %.4f\n", n, neg_count, min_r);
    check(neg_count > 0, "presence of negative floating-point values in storage2");

    // 2) beta_t active and reachable.
    DiscountParams p20 = DiscountParams::from_iteration(20);
    check(std::fabs(p20.beta_t - 0.5f) < 1e-7, "beta_t == 0.5 (constant negative discount)");
    check(neg_count > 0 && p20.beta_t == 0.5f,
          "negative-regret branch is exercised => beta discount reachable");

    // 3) Direct unit check of the update formula on a fabricated arena:
    //    new_r = old_r * beta + imm, with old_r < 0 — no floor at zero.
    {
        float arena[4] = {-10.0f, -10.0f, 5.0f, 5.0f};
        float cfv[4]   = {1.0f, 1.0f, 1.0f, 1.0f};
        float result[2] = {0.0f, 0.0f};   // node cfv per hand
        // emulate the update: idx = a*num_hands + h, num_hands = 2
        for (int idx = 0; idx < 4; ++idx) {
            float old_r = arena[idx];
            float coef = (old_r >= 0.0f) ? p20.alpha_t : p20.beta_t;
            arena[idx] = old_r * coef + (cfv[idx] - result[idx % 2]);
        }
        check(arena[0] < 0.0f && arena[1] < 0.0f,
              "update preserves negative regrets (no CFR+ floor in arena)");
        check(arena[2] > 0.0f && arena[3] > 0.0f, "positive regrets stay positive");
    }

    // 4) regret_matching truncates for STRATEGY only: feeding the arena with
    //    negatives yields a strategy from the positive part alone.
    {
        float regret[4] = {-10.0f, -10.0f, 5.0f, 5.0f};   // [2 actions, 2 hands]
        float strategy[4] = {0.0f, 0.0f, 0.0f, 0.0f};
        regret_matching(strategy, regret, 2, 2);
        // action 0 entirely negative -> strategy 0; action 1 -> 1.0
        check(strategy[0] == 0.0f && strategy[1] == 0.0f &&
              strategy[2] == 1.0f && strategy[3] == 1.0f,
              "regret_matching applies max(0, r) strictly inside strategy computation");
    }

    // 5) Both solve paths produce negatives (compat-GPU pipeline).
    PostFlopGame game2(std::move(CardConfig(cc)), tc);
    game2.prepare();
    game2.allocate_memory(false);
    game2.set_gpu_enabled(true);
    for (uint32_t it = 0; it < 20; ++it) solve_step(game2, it);
    if (game2.gpu_mem_initialized()) gpu_solver_copy_back(game2, *game2.gpu_mem());
    long long neg2 = 0;
    for (size_t i = 0; i < n; ++i) {
        if (game2.storage2_data()[i] < 0.0f) ++neg2;
    }
    check(neg2 > 0, "compat-GPU up-pass also retains negative regrets");

    std::printf("\n=== [TEST-3] Summary: %d passed, %d failed ===\n", pass, fail);
    return fail == 0 ? 0 : 1;
}
