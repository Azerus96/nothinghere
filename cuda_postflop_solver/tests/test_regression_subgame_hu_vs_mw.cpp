// ════════════════════════════════════════════════════════════════════════
// tests/test_regression_subgame_hu_vs_mw.cpp — [TEST-6]
// Scenario A (Heads-Up): full Flop-to-River tree with the Tier 1 sizing
//   grid (5 flop sizes: Check + 25%/50%/75% + All-In; 2 turn sizes:
//   67% + All-In; 2 river sizes: 75% + All-In).
//   Assertions: total nodes >= 300,000.
// Scenario B (Multiway 3-Player): max_depth == 1, total nodes <= 500,
//   memory <= 20 MB.
// ════════════════════════════════════════════════════════════════════════
#include <cstdio>
#include <cmath>
#include <vector>
#include <string>
#include <chrono>
#include "card.h"
#include "hand_evaluator.h"
#include "range.h"
#include "action_tree.h"
#include "game.h"
#include "solver.h"

using namespace postflop;

static int pass = 0, fail = 0;
static void check(bool ok, const std::string& name) {
    std::printf("  %s: %s\n", ok ? "PASS" : "FAIL", name.c_str());
    if (ok) ++pass; else ++fail;
}

int main() {
    std::printf("=== [TEST-6] Regression: two-tier subgame architecture (Section 2) ===\n\n");

    // ── Scenario A: Heads-Up full tree ───────────────────────────────────
    std::printf("  Scenario A: Heads-Up full Flop->Turn->River tree\n");
    {
        TreeConfig tc;
        tc.num_players = 2;
        tc.initial_state = BoardState::Flop;
        tc.starting_pot = 100;
        tc.effective_stack = 1000;
        // Tier 1 grid per spec.
        tc.flop_bet_sizes[0] = { {BetSize::PotRelative(0.25), BetSize::PotRelative(0.50),
                                  BetSize::PotRelative(0.75), BetSize::AllIn()}, {} };
        tc.flop_bet_sizes[1] = tc.flop_bet_sizes[0];
        tc.turn_bet_sizes[0] = { {BetSize::PotRelative(0.67), BetSize::AllIn()}, {} };
        tc.turn_bet_sizes[1] = tc.turn_bet_sizes[0];
        tc.river_bet_sizes[0] = { {BetSize::PotRelative(0.75), BetSize::AllIn()}, {} };
        tc.river_bet_sizes[1] = tc.river_bet_sizes[0];
        tc.board[0] = card_from_string("As");
        tc.board[1] = card_from_string("Kd");
        tc.board[2] = card_from_string("2c");
        // Flop input: turn/river NOT dealt -> chance expansion 49 x 48.

        auto t0 = std::chrono::high_resolution_clock::now();
        ActionTree tree(tc);
        auto t1 = std::chrono::high_resolution_clock::now();
        uint64_t nodes = tree.total_nodes();
        auto counts = tree.count_num_action_nodes();
        std::printf("    HU total nodes = %llu (decision: %llu/%llu/%llu by street) built in %.2fs\n",
                    (unsigned long long)nodes,
                    (unsigned long long)counts[0], (unsigned long long)counts[1],
                    (unsigned long long)counts[2],
                    std::chrono::duration<double>(t1 - t0).count());
        check(nodes >= 300000, "HU full tree: total nodes >= 300,000");
        check(counts[2] > 0 && counts[1] > 0 && counts[0] > 0,
              "HU tree spans flop, turn and river decision nodes");
        check(tc.max_depth != 1, "HU tree is NOT depth-capped (full expansion)");
    }

    // ── Scenario B: Multiway 3-player street-bounded search ─────────────
    std::printf("\n  Scenario B: Multiway (3 players) street-bounded search\n");
    {
        CardConfig cc;
        cc.num_players = 3;
        cc.ranges.push_back(Range::from_string("22+, A2s+, K8s+, Q9s+, ATo+, KJo+"));
        cc.ranges.push_back(Range::from_string("55+, A8s+, KJs+, AJo+"));
        cc.ranges.push_back(Range::from_string("88+, ATs+, AQo+"));
        cc.flop[0] = card_from_string("As");
        cc.flop[1] = card_from_string("Kd");
        cc.flop[2] = card_from_string("2c");
        cc.turn = NOT_DEALT;
        cc.river = NOT_DEALT;

        TreeConfig tc;
        tc.num_players = 3;
        tc.initial_state = BoardState::Flop;
        tc.starting_pot = 100;
        tc.effective_stack = 1000;
        tc.max_depth = 1;
        for (int i = 0; i < 3; ++i) {
            tc.flop_bet_sizes[i] = { {BetSize::PotRelative(0.50), BetSize::AllIn()}, {} };
        }

        PostFlopGame game(std::move(cc), tc);
        game.prepare();
        game.allocate_memory(false);

        uint64_t nodes = game.num_nodes();
        auto mem = game.memory_usage();
        uint64_t mem_bytes = mem.first;   // uncompressed FP32 [Defect 1.9]
        std::printf("    MW nodes = %llu, memory = %.2f MB (FP32 uncompressed)\n",
                    (unsigned long long)nodes, (double)mem_bytes / 1048576.0);
        check(game.tree_config().max_depth == 1, "MW tree: max_depth == 1");
        check(nodes <= 500, "MW tree: total nodes <= 500");
        check(mem_bytes <= 20ULL * 1024 * 1024, "MW tree: memory <= 20 MB");

        // Structural: no chance nodes (street transitions capped), rollout
        // leaves present and pending-board.
        int chance = 0, rollout_leaves = 0;
        for (const auto& n : game.node_arena()) {
            if (n.is_chance()) ++chance;
            if (n.is_terminal() && !(n.player & PLAYER_FOLD_FLAG) &&
                (n.turn == NOT_DEALT || n.river == NOT_DEALT)) ++rollout_leaves;
        }
        std::printf("    chance nodes = %d, rollout leaves = %d\n", chance, rollout_leaves);
        check(chance == 0, "MW tree contains no chance transitions (street-bounded)");
        check(rollout_leaves > 0, "MW street-ends are rollout showdown leaves");

        // Compressed (INT16) path remains available but is OFF by default
        // [Defect 1.9]; the arenas must be pure FP32 in this configuration.
        check(!game.is_compression_enabled(), "FP32 precision: compression disabled by default");
        size_t expect_floats = 0;
        for (const auto& n : game.node_arena()) {
            if (!n.is_terminal() && !n.is_chance()) expect_floats += n.num_elements;
        }
        check(game.storage1_bytes() == expect_floats * sizeof(float) &&
              game.storage2_bytes() == expect_floats * sizeof(float),
              "storage arenas are exactly FP32-sized (no INT16 quantization)");
    }

    std::printf("\n=== [TEST-6] Summary: %d passed, %d failed ===\n", pass, fail);
    return fail == 0 ? 0 : 1;
}
