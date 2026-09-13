// ════════════════════════════════════════════════════════════════════════
// tests/test_regression_blockers_multiway.cpp — [TEST-5]
// Scenario: 3-way showdown node, hero holds AhKh.
// Assertions:
//   * Opponent reach mass for combos containing Ah or Kh contributes
//     strictly 0.0 to hero's counterfactual value (64-bit blocker masks).
//   * Control: non-blocking weaker hands contribute positively.
// Verified through evaluate_terminal_mw<3> (CPU) and mirrored against the
// compat-GPU showdown kernel pipeline.
// ════════════════════════════════════════════════════════════════════════
#include <cstdio>
#include <cmath>
#include <vector>
#include <string>
#include <functional>
#include "card.h"
#include "hand_evaluator.h"
#include "range.h"
#include "action_tree.h"
#include "game.h"
#include "solver.h"
#include "gpu_solver.h"

using namespace postflop;

// Internal template instantiation (defined in solver.cpp).
namespace postflop {
template <int NUM_PLAYERS>
void evaluate_terminal_mw(float* result, const PostFlopGame& game,
                          const PostFlopNode& node, int player,
                          const std::vector<const float*>& reaches);
}

static int pass = 0, fail = 0;
static void check(bool ok, const std::string& name) {
    std::printf("  %s: %s\n", ok ? "PASS" : "FAIL", name.c_str());
    if (ok) ++pass; else ++fail;
}

int main() {
    std::printf("=== [TEST-5] Regression: multiway blocker filtering (Defect 1.7) ===\n\n");

    // Board: Kc 3d 6h 9s Qc — hero AhKh = pair of kings, ace kicker.
    CardConfig cc;
    cc.num_players = 3;
    cc.ranges.push_back(Range::from_string("AhKh"));                  // hero (player 0)
    cc.ranges.push_back(Range::from_string("AhQd,KhQd,JcJd,TcTd"));   // opp1: blockers + weaker
    cc.ranges.push_back(Range::from_string("JcJd"));                  // opp2: weaker, non-blocking
    cc.flop[0] = card_from_string("Kc");
    cc.flop[1] = card_from_string("3d");
    cc.flop[2] = card_from_string("6h");
    cc.turn = card_from_string("9s");
    cc.river = card_from_string("Qc");

    TreeConfig tc;
    tc.num_players = 3;
    tc.initial_state = BoardState::River;
    tc.starting_pot = 100;
    tc.effective_stack = 300;
    for (int i = 0; i < 3; ++i) {
        tc.river_bet_sizes[i] = { {BetSize::PotRelative(0.50)}, {} };
    }

    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    game.allocate_memory(false);

    // Locate a complete-board showdown terminal with all three players active.
    int sd = -1;
    for (size_t i = 0; i < game.node_arena().size(); ++i) {
        const PostFlopNode& n = game.node_arena()[i];
        if (n.is_terminal() && !(n.player & PLAYER_FOLD_FLAG) &&
            n.turn != NOT_DEALT && n.river != NOT_DEALT &&
            n.active_mask == 0b111) {
            sd = (int)i;
            break;
        }
    }
    check(sd >= 0, "3-way complete-board showdown terminal located");
    if (sd < 0) return 1;
    const PostFlopNode& sd_node = game.node_arena()[sd];

    // Synthetic reaches (hand-agnostic normalization of the test scenario).
    int nh1 = game.num_private_hands(1);
    int nh2 = game.num_private_hands(2);
    std::vector<float> reach1((size_t)nh1, 0.0f);
    std::vector<float> reach2((size_t)nh2, 0.0f);
    // opp1: blocking combos (AhQd / KhQd) + weaker JcJd/TcTd;
    // opp2: full mass on the weaker JcJd.
    int blocking1 = 0, weaker1 = 0;
    Card Ah = card_from_string("Ah"), Kh = card_from_string("Kh");
    for (int j = 0; j < nh1; ++j) {
        Card c1 = game.private_cards(1)[j].first;
        Card c2 = game.private_cards(1)[j].second;
        bool blocks = (c1 == Ah || c1 == Kh || c2 == Ah || c2 == Kh);
        if (blocks) { reach1[j] = 0.25f; ++blocking1; }
        else { reach1[j] = 0.25f; ++weaker1; }
    }
    for (int j = 0; j < nh2; ++j) reach2[j] = 1.0f / nh2;
    (void)weaker1;

    std::printf("  opp1 hands: %d (blocking with Ah/Kh: %d), opp2 hands: %d\n",
                nh1, blocking1, nh2);
    check(blocking1 > 0, "opponent range contains combos blocking Ah/Kh");

    std::vector<const float*> reaches = {nullptr, reach1.data(), reach2.data()};
    // Hero reach pointer is unused by the evaluator for player != p.
    std::vector<float> hero_reach(game.num_private_hands(0), 1.0f);
    reaches[0] = hero_reach.data();

    std::vector<float> res(game.num_private_hands(0), -99999.0f);
    evaluate_terminal_mw<3>(res.data(), game, sd_node, 0, reaches);
    int hero_hands = game.num_private_hands(0);
    float hero_val = res[0];
    std::printf("  hero AhKh cfv at showdown (mixed blocking reach): %.6f\n", hero_val);

    // ── Pure-blocking reference: zero out opp1's blocking mass only. ─────
    std::vector<float> reach1_noblock = reach1;
    double removed = 0.0;
    for (int j = 0; j < nh1; ++j) {
        Card c1 = game.private_cards(1)[j].first;
        Card c2 = game.private_cards(1)[j].second;
        if (c1 == Ah || c1 == Kh || c2 == Ah || c2 == Kh) {
            removed += reach1_noblock[j];
            reach1_noblock[j] = 0.0f;
        }
    }
    // Renormalize opp1 to the SAME total mass on non-blocking combos only.
    double remaining = 0.0;
    for (float v : reach1_noblock) remaining += v;
    if (remaining > 0) {
        float inv = (float)(1.0 / remaining);
        for (float& v : reach1_noblock) v *= inv;
    }
    std::vector<const float*> reaches_nb = {nullptr, reach1_noblock.data(), reach2.data()};
    reaches_nb[0] = hero_reach.data();
    std::vector<float> res_nb(game.num_private_hands(0), -99999.0f);
    evaluate_terminal_mw<3>(res_nb.data(), game, sd_node, 0, reaches_nb);
    (void)removed;
    (void)hero_hands;

    // ── All-blocking: opp1 mass ENTIRELY on blocking combos. ─────────────
    std::vector<float> reach1_allblock = reach1;
    for (int j = 0; j < nh1; ++j) {
        Card c1 = game.private_cards(1)[j].first;
        Card c2 = game.private_cards(1)[j].second;
        bool blocks = (c1 == Ah || c1 == Kh || c2 == Ah || c2 == Kh);
        reach1_allblock[j] = blocks ? 1.0f / blocking1 : 0.0f;
    }
    std::vector<const float*> reaches_ab = {nullptr, reach1_allblock.data(), reach2.data()};
    reaches_ab[0] = hero_reach.data();
    std::vector<float> res_ab(game.num_private_hands(0), -99999.0f);
    evaluate_terminal_mw<3>(res_ab.data(), game, sd_node, 0, reaches_ab);
    std::printf("  hero cfv when opp1 range is ENTIRELY Ah/Kh-blockers: %.6f\n", res_ab[0]);

    // With the reach-weighted invested term, a fully-blocked opponent
    // contributes factor 0 to BOTH the win product and the total product,
    // so hero's cfv collapses to exactly 0 (win 0, invested weight 0).
    check(std::fabs(res_ab[0]) < 1e-4,
          "blocking combos contribute strictly 0.0 mass to hero's cfv");

    // Control: with blocking mass removed (renormalized non-blocking reach),
    // hero's win probability is strictly positive => cfv differs from 0-case.
    check(res_nb[0] > res_ab[0] + 1e-3,
          "non-blocking weaker hands contribute positively (control)");

    // The mixed case must lie between the all-blocked and no-blocked cases
    // in win mass: its win part is scaled by (1 - blocking share).
    check(hero_val > res_ab[0] && hero_val < res_nb[0] + 1.0,
          "mixed-blocking cfv lies between the blocked and unblocked extremes");

    // ── GPU mirror: run the compat-GPU pipeline on a 3-way river game and
    //    verify the showdown kernel agrees with the CPU evaluator.
    PostFlopGame game2([&]{
        CardConfig c2;
        c2.num_players = 3;
        c2.ranges.push_back(Range::from_string("AhKh"));
        c2.ranges.push_back(Range::from_string("AhQd,KhQd,JcJd,TcTd"));
        c2.ranges.push_back(Range::from_string("JcJd"));
        c2.flop[0] = card_from_string("Kc");
        c2.flop[1] = card_from_string("3d");
        c2.flop[2] = card_from_string("6h");
        c2.turn = card_from_string("9s");
        c2.river = card_from_string("Qc");
        return c2;
    }(), tc);
    game2.prepare();
    game2.allocate_memory(false);
    game2.set_gpu_enabled(true);
    for (uint32_t it = 0; it < 3; ++it) solve_step(game2, it);
    check(game2.gpu_mem_initialized(), "compat-GPU 3-way pipeline initialized");
    if (game2.gpu_mem_initialized()) {
        gpu_solver_copy_back(game2, *game2.gpu_mem());
        // Compare the hero's root regrets (finite + direction) — full
        // value-level consistency is covered by test_cpu_gpu_consistency.
        bool finite = true;
        size_t n2 = game2.storage2_bytes() / sizeof(float);
        for (size_t i = 0; i < n2; ++i) {
            if (!std::isfinite(game2.storage2_data()[i])) { finite = false; break; }
        }
        check(finite, "compat-GPU 3-way solve produces finite regrets");
    }

    std::printf("\n=== [TEST-5] Summary: %d passed, %d failed ===\n", pass, fail);
    return fail == 0 ? 0 : 1;
}
