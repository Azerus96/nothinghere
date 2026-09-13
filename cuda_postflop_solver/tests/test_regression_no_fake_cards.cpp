// ════════════════════════════════════════════════════════════════════════
// tests/test_regression_no_fake_cards.cpp — [TEST-2]
// Scenario: Flop board input (6 characters, e.g. AsKd2c).
// Assertions:
//   * cc.turn == 255 (NOT_DEALT), cc.river == 255
//   * Zero invocations of find_unused_card (function eliminated; behavior
//     verified structurally: HU routes to chance expansion with 49 turn
//     outcomes, multiway routes to depth-capped rollout leaves).
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
    std::printf("=== [TEST-2] Regression: no dummy card falsification (Defect 1.2) ===\n\n");

    CardConfig cc;
    cc.num_players = 2;
    cc.range_oop = Range::from_string("AA,KK,QQ,AKs");
    cc.range_ip  = Range::from_string("AA,KK,QQ,AKs");
    cc.flop[0] = card_from_string("As");
    cc.flop[1] = card_from_string("Kd");
    cc.flop[2] = card_from_string("2c");
    // NOTE: turn/river intentionally NOT set — 6-character flop input.
    cc.turn = NOT_DEALT;
    cc.river = NOT_DEALT;

    TreeConfig tc;
    tc.num_players = 2;
    tc.initial_state = BoardState::Flop;
    tc.starting_pot = 100;
    tc.effective_stack = 1000;
    tc.flop_bet_sizes[0] = { {BetSize::PotRelative(0.50), BetSize::AllIn()}, {} };
    tc.flop_bet_sizes[1] = tc.flop_bet_sizes[0];
    tc.turn_bet_sizes[0] = { {BetSize::PotRelative(0.67), BetSize::AllIn()}, {} };
    tc.turn_bet_sizes[1] = tc.turn_bet_sizes[0];
    tc.river_bet_sizes[0] = { {BetSize::PotRelative(0.75), BetSize::AllIn()}, {} };
    tc.river_bet_sizes[1] = tc.river_bet_sizes[0];

    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    game.allocate_memory(false);

    // 1) The card config keeps the pending streets undealt.
    check(game.card_config().turn == 255 && game.card_config().river == 255,
          "cc.turn == 255 && cc.river == 255 after prepare() on flop input");

    // 2) HU routing: chance expansion over 49 unseen turn cards.
    int turn_chance_49 = 0, river_chance_48 = 0, chance_total = 0;
    for (const auto& n : game.node_arena()) {
        if (!n.is_chance()) continue;
        ++chance_total;
        if (n.num_children == 49) ++turn_chance_49;
        if (n.num_children == 48) ++river_chance_48;
    }
    std::printf("  chance nodes: %d (49-child turn: %d, 48-child river: %d)\n",
                chance_total, turn_chance_49, river_chance_48);
    check(chance_total > 0, "HU flop input routes to CHANCE NODE expansion (Tier 1)");
    check(turn_chance_49 > 0, "turn chance nodes enumerate exactly 49 runouts");
    check(river_chance_48 > 0, "river chance nodes enumerate exactly 48 runouts");

    // 3) Terminal showdown nodes carry concrete per-node board cards.
    int complete_showdowns = 0;
    for (const auto& n : game.node_arena()) {
        if (n.is_terminal() && !(n.player & PLAYER_FOLD_FLAG) &&
            n.turn != NOT_DEALT && n.river != NOT_DEALT) {
            ++complete_showdowns;
        }
    }
    check(complete_showdowns > 0,
          "showdown terminals receive concrete turn/river from chance actions");

    // 4) Multiway routing: depth-capped rollout leaves (no fake cards).
    CardConfig cc3;
    cc3.num_players = 3;
    cc3.ranges.push_back(Range::from_string("AA,KK,QQ,AKs"));
    cc3.ranges.push_back(Range::from_string("AA,KK,QQ"));
    cc3.ranges.push_back(Range::from_string("AA,KK,QQ"));
    cc3.flop[0] = card_from_string("As");
    cc3.flop[1] = card_from_string("Kd");
    cc3.flop[2] = card_from_string("2c");
    cc3.turn = NOT_DEALT;
    cc3.river = NOT_DEALT;

    TreeConfig tc3;
    tc3.num_players = 3;
    tc3.initial_state = BoardState::Flop;
    tc3.starting_pot = 100;
    tc3.effective_stack = 1000;
    tc3.flop_bet_sizes[0] = { {BetSize::PotRelative(0.50)}, {} };
    tc3.flop_bet_sizes[1] = tc3.flop_bet_sizes[0];
    tc3.flop_bet_sizes[2] = tc3.flop_bet_sizes[0];

    PostFlopGame game3(std::move(cc3), tc3);
    game3.prepare();
    game3.allocate_memory(false);

    check(game3.tree_config().max_depth == 1, "multiway tree forced to max_depth = 1 (Tier 2)");

    int rollout_leaves = 0, chance3 = 0;
    for (const auto& n : game3.node_arena()) {
        if (n.is_chance()) ++chance3;
        if (n.is_terminal() && !(n.player & PLAYER_FOLD_FLAG) &&
            (n.turn == NOT_DEALT || n.river == NOT_DEALT)) {
            ++rollout_leaves;
        }
    }
    std::printf("  3-way flop tree: %zu nodes, %d rollout leaves, %d chance nodes\n",
                (size_t)game3.num_nodes(), rollout_leaves, chance3);
    check(rollout_leaves > 0 && chance3 == 0,
          "multiway street-ends become ROLLOUT leaves (no synthetic board cards)");

    // 5) The rollout evaluation produces finite, deterministic values.
    std::vector<const float*> reaches(3);
    reaches[0] = game3.initial_weights(0).data();
    reaches[1] = game3.initial_weights(1).data();
    reaches[2] = game3.initial_weights(2).data();
    int leaf_idx = -1;
    for (size_t i = 0; i < game3.node_arena().size(); ++i) {
        const auto& n = game3.node_arena()[i];
        if (n.is_terminal() && !(n.player & PLAYER_FOLD_FLAG) &&
            (n.turn == NOT_DEALT || n.river == NOT_DEALT)) {
            leaf_idx = (int)i;
            break;
        }
    }
    if (leaf_idx >= 0) {
        // Rollout evaluation runs through solve_step (CPU or compat-GPU);
        // results must be finite and the solve must not touch the board.
        for (uint32_t it = 0; it < 2; ++it) solve_step(game3, it);
        bool finite = true;
        size_t n2 = game3.storage2_bytes() / sizeof(float);
        const float* r2 = game3.storage2_data();
        for (size_t i = 0; i < n2; ++i) {
            if (!std::isfinite(r2[i])) { finite = false; break; }
        }
        check(finite, "rollout leaf evaluation produces finite regrets");
        check(game3.card_config().turn == 255 && game3.card_config().river == 255,
              "multiway solve leaves the pending streets undealt (no fake cards)");
    }

    std::printf("\n=== [TEST-2] Summary: %d passed, %d failed ===\n", pass, fail);
    return fail == 0 ? 0 : 1;
}
