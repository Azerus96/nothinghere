// ════════════════════════════════════════════════════════════════════════
// tests/test_regression_icm.cpp — [Module 4, V8] Tournament ICM engine
// regression suite (Malmuth-Harville + bubble factor + node propagation)
// ════════════════════════════════════════════════════════════════════════
// Verifies:
//   1. compute_icm_payouts exact closed-form values (2-max chip-ratio,
//      symmetric stacks, winner-take-all).
//   2. Conservation: Σ equities == Σ payouts for 2..8 players.
//   3. Monotonicity: larger stack => larger ICM equity.
//   4. Bubble factor: exactly 1.0 for 2-max winner-take-all (risk-neutral);
//      > 1 on a 3-way bubble; capped path is finite and sane.
//   5. TreeConfig::bubble_factor propagates into EVERY PostFlopNode and
//      mirrors into GpuMemory at init.
//   6. Terminal evaluators scale the loss term: a fold EV doubles when the
//      bubble factor doubles (wins untouched).
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
#include "icm_math.hpp"

using namespace postflop;
using postflop::icm::compute_icm_payouts;
using postflop::icm::compute_bubble_factor;

static int pass = 0, fail = 0;
static void check(bool ok, const std::string& name) {
    std::printf("  %s: %s\n", ok ? "PASS" : "FAIL", name.c_str());
    if (ok) ++pass; else ++fail;
}

int main() {
    std::printf("=== [V8] Regression: tournament ICM engine (Module 4) ===\n\n");

    // ── 1. Exact closed-form values ────────────────────────────────────
    std::printf("── Malmuth-Harville exact values ──\n");
    {
        // 2-max, winner-take-all: equity == chip share (closed form).
        auto eq = compute_icm_payouts({2000.0, 1000.0}, {1.0});
        std::printf("    2-max [2000,1000] WTA: %.9f / %.9f (expect 2/3, 1/3)\n", eq[0], eq[1]);
        check(std::fabs(eq[0] - 2.0 / 3.0) < 1e-12 && std::fabs(eq[1] - 1.0 / 3.0) < 1e-12,
              "2-max WTA reduces to exact chip ratio (Harville)");

        // Symmetric stacks: equal equity regardless of payouts.
        auto eq3 = compute_icm_payouts({1000.0, 1000.0, 1000.0}, {0.5, 0.3, 0.2});
        check(std::fabs(eq3[0] - 1.0 / 3.0) < 1e-12 &&
              std::fabs(eq3[1] - 1.0 / 3.0) < 1e-12 &&
              std::fabs(eq3[2] - 1.0 / 3.0) < 1e-12,
              "symmetric 3-way stacks: equity = 1/3 each (any payout ladder)");

        // Two-handed with a second place: P2 = (1 - s1/(s1+s2)) exactly.
        auto eq2 = compute_icm_payouts({3000.0, 1000.0}, {0.65, 0.35});
        double p1_first = 0.75;                      // 3000/4000
        double p1_eq = p1_first * 0.65 + (1.0 - p1_first) * 0.35;
        std::printf("    2-max [3000,1000] payouts[.65,.35]: %.9f / %.9f (expect %.9f / %.9f)\n",
                    eq2[0], eq2[1], p1_eq, 1.0 - p1_eq);
        check(std::fabs(eq2[0] - p1_eq) < 1e-12 && std::fabs(eq2[1] - (1.0 - p1_eq)) < 1e-12,
              "2-max with min-cash: exact hand-derived probabilities");
    }

    // ── 2. Conservation & monotonicity for 2..8 players ────────────────
    std::printf("\n── Conservation & monotonicity (2..8 players) ──\n");
    {
        const std::vector<double> payouts = {0.50, 0.30, 0.20, 0.10, 0.05, 0.03, 0.015, 0.005};
        bool conserved = true, monotone = true;
        for (int n = 2; n <= 8; ++n) {
            std::vector<double> stacks;
            for (int i = 0; i < n; ++i) stacks.push_back(1000.0 * (i + 1));   // strictly increasing
            std::vector<double> pays(payouts.begin(), payouts.begin() + n - 1);
            auto eq = compute_icm_payouts(stacks, pays);
            double pay_sum = 0.0;
            for (double p : pays) pay_sum += p;
            double eq_sum = 0.0;
            for (double e : eq) eq_sum += e;
            if (std::fabs(eq_sum - pay_sum) > 1e-9) conserved = false;
            for (int i = 1; i < n; ++i) {
                if (!(eq[i] > eq[i - 1])) monotone = false;
            }
        }
        check(conserved, "Σ ICM equities == Σ payouts for every player count 2..8");
        check(monotone, "ICM equity strictly increasing in stack size (2..8 players)");
    }

    // ── 3. Bubble factor semantics ─────────────────────────────────────
    std::printf("\n── Bubble factor ──\n");
    {
        // Risk-neutral: 2-max winner-take-all, equal stacks.
        double bf_wta = compute_bubble_factor({1000.0, 1000.0}, {1.0}, 0, 1);
        std::printf("    2-max WTA equal stacks: BF = %.9f (expect 1.0)\n", bf_wta);
        check(std::fabs(bf_wta - 1.0) < 1e-9,
              "2-max winner-take-all: bubble factor exactly 1.0 (risk-neutral)");

        // Classic full-stack confrontation: 3 equal stacks, lopsided ladder.
        // Hand-derived: base = 1/3 each; win (2/3, 0, 1/3 stacks) gives
        // eq0 = 2/3*0.5 + 1/3*0.3 = 13/30 -> gain = 1/10; lose eliminates
        // hero -> loss = 1/3. BF = (1/3)/(1/10) = 10/3 EXACTLY.
        double bf_bubble = compute_bubble_factor({1000.0, 1000.0, 1000.0},
                                                 {0.50, 0.30, 0.20}, 0, 1);
        std::printf("    3-way equal stacks, ladder [.5 .3 .2]: BF = %.9f (expect 10/3)\n", bf_bubble);
        check(std::fabs(bf_bubble - 10.0 / 3.0) < 1e-9,
              "3-way equal-stack confrontation: BF = 10/3 exactly (hand-derived)");

        // 2-max with a min-cash is ALWAYS risk-neutral: Harville equity is
        // linear in the stack share for n=2, so gain == loss symmetrically.
        double bf_hu2 = compute_bubble_factor({3000.0, 1000.0}, {0.70, 0.30}, 0, 1);
        std::printf("    2-max min-cash [3000,1000] ladder [.7 .3]: BF = %.9f (expect 1)\n", bf_hu2);
        check(std::fabs(bf_hu2 - 1.0) < 1e-9,
              "any 2-max ladder: BF = 1 exactly (Harville is linear for n=2)");

        // Elimination scenario: hero risks his entire (short) stack — the
        // loss side forfeits the near-guaranteed 3rd-place mass, so BF is
        // large but finite (the 2.5 cap only applies when eq_gain <= 1e-9).
        double bf_elim = compute_bubble_factor({100.0, 5000.0, 5000.0},
                                                {0.50, 0.30, 0.20}, 0, 1);
        std::printf("    short-stack elimination: BF = %.6f\n", bf_elim);
        check(std::isfinite(bf_elim) && bf_elim > 3.0,
              "short-stack elimination: BF large and finite (loss drops P3 mass)");

        // Cap path: a zero-stack hero has zero equity gain -> capped at 2.5.
        double bf_cap = compute_bubble_factor({0.0, 1000.0, 1000.0},
                                               {0.50, 0.30, 0.20}, 0, 1);
        std::printf("    zero-stack hero: BF = %.6f (expect the 2.5 cap)\n", bf_cap);
        check(std::fabs(bf_cap - 2.5) < 1e-9,
              "extreme bubble scenario capped at exactly 2.5");
    }

    // ── 4. bubble_factor propagation through the game tree ─────────────
    std::printf("\n── TreeConfig → PostFlopNode → GpuMemory propagation ──\n");
    {
        auto build = [](float bf) {
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
            tc.bubble_factor = bf;                        // [Module 4, V8]
            auto g = std::make_unique<PostFlopGame>(std::move(cc), tc);
            g->prepare();
            g->allocate_memory(false);
            return g;
        };

        auto g = build(1.5f);
        bool all_nodes = true;
        for (const auto& n : g->node_arena()) {
            if (std::fabs((double)n.bubble_factor - 1.5) > 1e-6) { all_nodes = false; break; }
        }
        check(all_nodes, "every PostFlopNode carries bubble_factor == 1.5");

        // Default: 1.0 (pure Chip-EV, cash semantics).
        auto g_def = build(1.0f);
        check(std::fabs((double)g_def->node_arena()[0].bubble_factor - 1.0) < 1e-6,
              "default bubble_factor is 1.0 (Chip-EV backward compatibility)");

        // GpuMemory mirror at init (compat pipeline).
        GpuMemory gpu;
        bool init_ok = gpu_solver_init(*g, gpu);
        check(init_ok, "compat-GPU init succeeds with bubble factor set");
        if (init_ok) {
            check(std::fabs((double)gpu.bubble_factor - 1.5) < 1e-6,
                  "GpuMemory::bubble_factor mirrors TreeConfig (1.5)");
            gpu_solver_cleanup(gpu);
        }

        // ── 5. Terminal loss-term scaling ──────────────────────────────
        // Fold EV of the folding player must scale linearly with BF while
        // the winner's EV stays fixed.
        auto g1 = build(1.0f);
        auto g2 = build(2.0f);

        // Find a fold terminal owned by player 1 (IP folds somewhere).
        int fold_node = -1;
        for (size_t i = 0; i < g1->num_nodes(); ++i) {
            const PostFlopNode& n = g1->node_arena()[i];
            if (n.is_terminal() && (n.player & PLAYER_FOLD_FLAG) &&
                (n.player & PLAYER_MASK) == 1) {
                fold_node = (int)i;
                break;
            }
        }
        check(fold_node >= 0, "fold terminal owned by player 1 located");
        if (fold_node >= 0) {
            int nh = g1->num_private_hands(1);
            std::vector<float> r1(nh), r2(nh);
            std::vector<const float*> reaches(2);
            reaches[0] = g1->initial_weights(0).data();
            reaches[1] = g1->initial_weights(1).data();
            const PostFlopNode& node = g1->node_arena()[fold_node];

            evaluate_terminal(r1.data(), *g1, node, 1, reaches[0]);
            const PostFlopNode& node2 = g2->node_arena()[fold_node];
            evaluate_terminal(r2.data(), *g2, node2, 1, reaches[0]);

            // Folding player's utility: -invested * BF * reach.
            double scale_max_dev = 0.0;
            for (int h = 0; h < nh; ++h) {
                double a = (double)r1[h];
                double b = (double)r2[h];
                double expect_b = 2.0 * a;   // BF 2 doubles the loss term
                double dev = std::fabs(b - expect_b);
                if (a != 0.0 || b != 0.0) scale_max_dev = std::max(scale_max_dev, dev);
            }
            std::printf("    fold EV (BF=1 vs BF=2) max deviation from exact 2x scaling: %.3g\n",
                        scale_max_dev);
            check(scale_max_dev < 1e-3,
                  "fold EV scales exactly with bubble_factor (loss term risk-weighted)");

            // Winner (player 0) EV must be UNCHANGED by BF.
            std::vector<float> w1(g1->num_private_hands(0)), w2(g2->num_private_hands(0));
            evaluate_terminal(w1.data(), *g1, node, 0, reaches[1]);
            evaluate_terminal(w2.data(), *g2, node2, 0, reaches[1]);
            double win_dev = 0.0;
            for (size_t h = 0; h < w1.size(); ++h) {
                win_dev = std::max(win_dev, std::fabs((double)w1[h] - (double)w2[h]));
            }
            check(win_dev < 1e-6, "win-by-fold EV independent of bubble_factor (wins unscaled)");
        }
    }

    std::printf("\n=== [V8] ICM Summary: %d passed, %d failed ===\n", pass, fail);
    return fail == 0 ? 0 : 1;
}
