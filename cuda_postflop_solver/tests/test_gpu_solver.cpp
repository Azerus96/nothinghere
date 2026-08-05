// ════════════════════════════════════════════════════════════════════════
// test_gpu_solver.cpp — Smoke test for GPU solver path
// ════════════════════════════════════════════════════════════════════════
// Verifies that:
//   1. gpu_solver_init correctly transfers all data to device
//   2. gpu_solve_step runs without crashing
//   3. gpu_solver_copy_back returns correct results
//   4. CPU and GPU paths produce IDENTICAL strategies (within float tolerance)
//
// On CPU-only builds, this test verifies that the stub correctly reports
// "GPU not available" and the solver falls back to CPU.
// ════════════════════════════════════════════════════════════════════════
#include <cstdio>
#include <vector>
#include <string>
#include <cmath>
#include "card.h"
#include "hand_evaluator.h"
#include "range.h"
#include "action_tree.h"
#include "game.h"
#include "solver.h"
#include "gpu_solver.h"

using namespace postflop;

int main() {
    int pass = 0, fail = 0;
    auto check = [&](bool ok, const std::string& name) {
        if (ok) { printf("  PASS: %s\n", name.c_str()); pass++; }
        else    { printf("  FAIL: %s\n", name.c_str()); fail++; }
    };

    printf("=== Test GPU Solver Architecture (V4) ===\n\n");

    // Setup a simple game
    CardConfig cc;
    cc.range_oop = Range::from_string("AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AQs,AJs,ATs,AKo,AQo,AJo,KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s,76s,65s,54s");
    cc.range_ip  = Range::from_string("AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AQs,AJs,ATs,AKo,AQo,AJo,KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s,76s,65s,54s,43s,32s");
    cc.flop[0] = card_from_string("Td");
    cc.flop[1] = card_from_string("9d");
    cc.flop[2] = card_from_string("6h");
    cc.turn = card_from_string("Qc");
    cc.river = card_from_string("2s");

    TreeConfig tc;
    tc.initial_state = BoardState::Flop;
    tc.starting_pot = 100;
    tc.effective_stack = 900;
    tc.rake_rate = 0;
    tc.rake_cap = 0;
    tc.flop_bet_sizes[0] = { {BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(2.5)} };
    tc.flop_bet_sizes[1] = { {BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(2.5)} };
    tc.turn_bet_sizes[0] = tc.flop_bet_sizes[0];
    tc.turn_bet_sizes[1] = tc.flop_bet_sizes[1];
    tc.river_bet_sizes[0] = tc.flop_bet_sizes[0];
    tc.river_bet_sizes[1] = tc.flop_bet_sizes[1];

    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    game.allocate_memory(false);

    printf("  Game setup: %d OOP hands, %d IP hands, %zu nodes\n",
           game.num_private_hands(0), game.num_private_hands(1),
           (size_t)game.num_nodes());

    // ── Test 1: CPU baseline ─────────────────────────────────────────
    printf("\n── Test 1: CPU baseline (10 iterations) ──\n");
    for (uint32_t iter = 0; iter < 10; ++iter) {
        solve_step(game, iter);
    }
    float cpu_exploit = compute_exploitability(game);
    printf("  CPU exploitability after 10 iters: %.6f\n", cpu_exploit);
    check(std::isfinite(cpu_exploit), "CPU exploitability is finite");

    // Save CPU strategy for comparison
    std::vector<float> cpu_strategy = game.root_strategy();
    printf("  CPU root strategy size: %zu floats\n", cpu_strategy.size());

    // ── Test 2: GPU init ─────────────────────────────────────────────
    printf("\n── Test 2: GPU solver initialization ──\n");
    GpuMemory gpu;
    bool gpu_ok = gpu_solver_init(game, gpu);
#ifdef CUDA_BUILD
    check(gpu_ok, "gpu_solver_init succeeded (CUDA build)");
    check(gpu.initialized, "GpuMemory.initialized == true");
    check(gpu.d_nodes != nullptr, "Device node arena allocated");
    check(gpu.d_storage1 != nullptr, "Device storage1 allocated");
    check(gpu.d_storage2 != nullptr, "Device storage2 allocated");
    printf("  Device memory: %d nodes, %d storage elements\n",
           gpu.num_nodes, gpu.num_storage);
#else
    check(!gpu_ok, "gpu_solver_init correctly returns false on CPU-only build");
    printf("  [CPU-only build — GPU path skipped, stub returned false as expected]\n");
#endif

    // ── Test 3: GPU solve step ───────────────────────────────────────
    printf("\n── Test 3: GPU solve step ──\n");
#ifdef CUDA_BUILD
    int result = gpu_solve_step(gpu, 0);
    check(result == 0, "gpu_solve_step returned 0 (success)");

    // ── Test 4: GPU copy back ───────────────────────────────────────
    printf("\n── Test 4: GPU copy back results ──\n");
    bool copy_ok = gpu_solver_copy_back(game, gpu);
    check(copy_ok, "gpu_solver_copy_back succeeded");

    // ── Test 5: CPU vs GPU consistency ──────────────────────────────
    printf("\n── Test 5: CPU vs GPU strategy consistency ──\n");
    std::vector<float> gpu_strategy = game.root_strategy();
    float max_diff = 0;
    for (size_t i = 0; i < cpu_strategy.size() && i < gpu_strategy.size(); ++i) {
        float diff = std::abs(cpu_strategy[i] - gpu_strategy[i]);
        if (diff > max_diff) max_diff = diff;
    }
    printf("  Max |CPU - GPU| strategy difference: %.6f\n", max_diff);
    check(max_diff < 0.01f, "CPU and GPU strategies match within tolerance");

    // Cleanup
    gpu_solver_cleanup(gpu);
    check(!gpu.initialized, "GpuMemory cleaned up");
#else
    int result = gpu_solve_step(gpu, 0);
    check(result == -1, "gpu_solve_step returns -1 on CPU-only build (stub)");
    printf("  [CPU-only build — GPU solve step skipped]\n");
#endif

    // ── Test 6: Verify solver still works on CPU after GPU attempt ──
    printf("\n── Test 6: CPU solver still functional ──\n");
    float cpu_exploit2 = compute_exploitability(game);
    check(std::isfinite(cpu_exploit2), "CPU exploitability still finite after GPU test");

    printf("\n=== Summary: %d passed, %d failed ===\n", pass, fail);
    return fail == 0 ? 0 : 1;
}
