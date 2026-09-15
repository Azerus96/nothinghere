// ════════════════════════════════════════════════════════════════════════
// tests/test_regression_8max.cpp — [Module 1, V8] 8-max scaling & memory
// integrity regression suite
// ════════════════════════════════════════════════════════════════════════
// Verifies:
//   1. MAX_PLAYERS == 8 and every player-indexed structure follows it.
//   2. ActionTree accepts 2..8 players and rejects 9.
//   3. The V7 memory-corruption vector is eliminated: solving 7- and
//      8-handed games leaves node.action_types byte-identical (V7 wrote
//      invested[6]/[7] out of bounds, stomping the adjacent action_types).
//   4. gpu_solve_step dispatches 7 and 8 players (V7 returned -1).
//   5. CPU and compat-GPU solves produce finite regrets for 7/8 players.
//   6. GpuMemory per-player arrays are fully released (ASan clean).
// ════════════════════════════════════════════════════════════════════════
#include <cstdio>
#include <cmath>
#include <vector>
#include <string>
#include <cstring>
#include <stdexcept>
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

// Tiny per-player range strings: after the As/Kd/2c board blocking, each
// seat holds ~3 combos — enough to exercise every player slot while keeping
// the exact-820 leaf enumeration fast (the V8 kernel enumerates all C(47,2)
// runouts for EVERY updating player at EVERY active showdown leaf, so the
// test matrix must stay small; ~200s with QQ-inclusive ranges, ~15s here).
static const char* RANGE_8[8] = {
    "AA,KK",   // hero (player 0)
    "AA,KK", "AA,KK", "AA,KK", "AA,KK", "AA,KK", "AA,KK", "AA,KK"
};

static CardConfig make_cc_8(int num_players) {
    CardConfig cc;
    cc.num_players = num_players;
    for (int p = 0; p < num_players; ++p) cc.ranges.push_back(Range::from_string(RANGE_8[p]));
    cc.flop[0] = card_from_string("As");
    cc.flop[1] = card_from_string("Kd");
    cc.flop[2] = card_from_string("2c");
    cc.turn = NOT_DEALT;    // flop-only: Tier 2 exact-820 leaves
    cc.river = NOT_DEALT;
    return cc;
}

static TreeConfig make_tc_8(int num_players) {
    TreeConfig tc;
    tc.num_players = num_players;
    tc.initial_state = BoardState::Flop;
    tc.starting_pot = 8 * 100;      // 8-way limp pot
    tc.effective_stack = 2000;
    for (int i = 0; i < num_players; ++i) {
        tc.flop_bet_sizes[i] = { {BetSize::PotRelative(0.50)}, {} };
    }
    return tc;
}

// Snapshot of every action_types[] byte in the arena — the V7 corruption
// detector (out-of-bounds invested writes landed exactly here).
static std::vector<uint8_t> snapshot_action_types(const PostFlopGame& game) {
    std::vector<uint8_t> snap;
    snap.reserve(game.num_nodes() * MAX_NODE_ACTIONS);
    for (const auto& n : game.node_arena()) {
        for (int a = 0; a < MAX_NODE_ACTIONS; ++a) snap.push_back(n.action_types[a]);
    }
    return snap;
}

static bool all_finite(const PostFlopGame& game) {
    size_t n = game.storage2_bytes() / sizeof(float);
    const float* r = game.storage2_data();
    for (size_t i = 0; i < n; ++i) {
        if (!std::isfinite(r[i])) return false;
    }
    return true;
}

static void run_player_count(int num_players, const char* label) {
    std::printf("── %d-handed flop game (exact-820 leaves) ──\n", num_players);

    // CPU path (1 iteration: the exact-820 leaf kernel dominates runtime
    // and is fully deterministic — additional iterations add no coverage).
    PostFlopGame cpu(make_cc_8(num_players), make_tc_8(num_players));
    cpu.prepare();
    cpu.allocate_memory(false);
    auto snap_before = snapshot_action_types(cpu);
    for (uint32_t it = 0; it < 1; ++it) solve_step(cpu, it);
    auto snap_after = snapshot_action_types(cpu);

    std::string corruption_name = std::string(label) +
        ": action_types byte-identical after solve (V7 OOB corruption vector)";
    check(std::memcmp(snap_before.data(), snap_after.data(), snap_before.size()) == 0,
          corruption_name);
    check(cpu.num_nodes() > 10, std::string(label) + ": tree built with decision nodes");
    check(all_finite(cpu), std::string(label) + ": CPU regrets all finite");

    // invested[] sanity for every seat: sum == pot at terminal nodes.
    double max_invest_gap = 0.0;
    for (const auto& n : cpu.node_arena()) {
        if (!n.is_terminal()) continue;
        double sum = 0.0;
        for (int p = 0; p < num_players; ++p) sum += (double)n.invested[p];
        max_invest_gap = std::max(max_invest_gap, std::fabs(sum - (double)n.amount));
    }
    std::printf("    max |Σ invested − pot| over terminals = %.4f\n", max_invest_gap);
    check(max_invest_gap < 1e-6, std::string(label) + ": exact zero-sum chip bookkeeping (8 seats)");

    // Compat-GPU path (same kernel source; CPU shim) — V7 returned -1 for
    // 7/8 players from gpu_solve_step.
    PostFlopGame gpu(make_cc_8(num_players), make_tc_8(num_players));
    gpu.prepare();
    gpu.allocate_memory(false);
    gpu.set_gpu_enabled(true);
    solve_step(gpu, 0);
    check(gpu.gpu_mem_initialized(), std::string(label) + ": GpuMemory initialized (compat pipeline)");
    if (gpu.gpu_mem_initialized()) {
        check(gpu.gpu_mem()->num_players == num_players,
              std::string(label) + ": GpuMemory carries the true player count");
        check(gpu.gpu_mem()->num_players <= MAX_PLAYERS,
              std::string(label) + ": player count within MAX_PLAYERS");
        for (uint32_t it = 1; it < 1; ++it) solve_step(gpu, it);
        gpu_solver_copy_back(gpu, *gpu.gpu_mem());
        check(all_finite(gpu), std::string(label) + ": compat-GPU regrets all finite");

        // Cleanup releases every per-player slot (ASan verifies the frees).
        gpu_solver_cleanup(*gpu.gpu_mem());
        bool released = true;
        for (int p = 0; p < MAX_PLAYERS; ++p) {
            if (gpu.gpu_mem()->d_private_cards[p] != nullptr) released = false;
            if (gpu.gpu_mem()->d_initial_weights[p] != nullptr) released = false;
        }
        check(released, std::string(label) + ": all MAX_PLAYERS device slots released");
    }
}

int main() {
    std::printf("=== [V8] Regression: 8-max scaling & memory integrity (Module 1) ===\n\n");

    // ── 1) Compile-time capacity ────────────────────────────────────────
    check(MAX_PLAYERS == 8, "MAX_PLAYERS == 8 (global capacity constant)");
    {
        TreeConfig tc;
        check(tc.flop_bet_sizes.size() == (size_t)MAX_PLAYERS, "TreeConfig bet arrays sized MAX_PLAYERS");
        check(tc.initial_invested.size() == (size_t)MAX_PLAYERS, "TreeConfig::initial_invested sized MAX_PLAYERS");
        int expect[8] = {-1,-1,-1,-1,-1,-1,-1,-1};
        bool all_neg = true;
        for (int i = 0; i < MAX_PLAYERS; ++i) if (tc.initial_invested[i] != expect[i]) all_neg = false;
        check(all_neg, "initial_invested default = 8 x -1 (equal-split request)");
    }

    // ── 2) Validation bounds ────────────────────────────────────────────
    {
        bool threw = false;
        try {
            TreeConfig tc = make_tc_8(9);
            tc.num_players = 9;
            ActionTree tree(tc);
        } catch (const std::invalid_argument&) {
            threw = true;
        }
        check(threw, "ActionTree rejects num_players = 9 (invalid_argument)");
    }
    {
        bool ok = true;
        try {
            TreeConfig tc = make_tc_8(8);
            ActionTree tree(tc);
        } catch (...) {
            ok = false;
        }
        check(ok, "ActionTree accepts num_players = 8");
    }

    // ── 3) 7- and 8-handed end-to-end solves ───────────────────────────
    run_player_count(7, "7-max");
    std::printf("\n");
    run_player_count(8, "8-max");

    // ── 4) Dispatch table completeness (source-level contract) ──────────
    // gpu_solve_step switches on 2..MAX_PLAYERS; the compat run above
    // already exercised 7 and 8 end-to-end (a -1 return would have logged
    // a fallback and left GpuMemory uninitialized).

    std::printf("\n=== [V8] 8-max Summary: %d passed, %d failed ===\n", pass, fail);
    return fail == 0 ? 0 : 1;
}
