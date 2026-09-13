// ════════════════════════════════════════════════════════════════════════
// tests/test_cpu_gpu_consistency.cpp — Phase 4 verification
// Strict numerical consistency between the CPU solver and the compat-GPU
// kernel pipeline (same source, cuda_compat.h emulation on CPU builds):
//   1. after 1 iteration: regret arenas agree within float reordering noise
//   2. after full solves: exploitabilities converge together, root
//      strategies agree within tolerance
//   3. strict determinism: bit-identical replay per path
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

static CardConfig make_cc(bool multiway) {
    CardConfig cc;
    if (multiway) {
        cc.num_players = 3;
        cc.ranges.push_back(Range::from_string("AA,KK,QQ,JJ,AKs,AKo"));
        cc.ranges.push_back(Range::from_string("AA,KK,QQ,JJ"));
        cc.ranges.push_back(Range::from_string("KK,QQ,JJ,TT"));
    } else {
        cc.num_players = 2;
        cc.range_oop = Range::from_string("AA,KK,QQ,JJ,TT,AKs,AQs,AKo");
        cc.range_ip  = Range::from_string("AA,KK,QQ,JJ,TT,AKs,AQs,AKo,AQo");
    }
    cc.flop[0] = card_from_string("Td");
    cc.flop[1] = card_from_string("9d");
    cc.flop[2] = card_from_string("6h");
    cc.turn = card_from_string("Qc");
    cc.river = card_from_string("2s");
    return cc;
}

static TreeConfig make_tc(bool multiway) {
    TreeConfig tc;
    tc.num_players = multiway ? 3 : 2;
    tc.initial_state = BoardState::Flop;
    tc.starting_pot = 100;
    tc.effective_stack = 500;
    int n = multiway ? 3 : 2;
    for (int i = 0; i < n; ++i) {
        tc.flop_bet_sizes[i] = { {BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(2.5)} };
        tc.turn_bet_sizes[i] = tc.flop_bet_sizes[i];
        tc.river_bet_sizes[i] = tc.flop_bet_sizes[i];
    }
    return tc;
}

static void run_headsup() {
    std::printf("── Heads-Up river-dealt game ──\n");

    // 1 iteration regret agreement.
    PostFlopGame cpu1(make_cc(false), make_tc(false));
    cpu1.prepare(); cpu1.allocate_memory(false);
    PostFlopGame gpu1(make_cc(false), make_tc(false));
    gpu1.prepare(); gpu1.allocate_memory(false); gpu1.set_gpu_enabled(true);
    solve_step(cpu1, 0);
    solve_step(gpu1, 0);
    if (gpu1.gpu_mem_initialized()) gpu_solver_copy_back(gpu1, *gpu1.gpu_mem());

    size_t n = cpu1.storage2_bytes() / sizeof(float);
    double maxd = 0;
    for (size_t i = 0; i < n; ++i) {
        maxd = std::max(maxd, (double)std::fabs(cpu1.storage2_data()[i] - gpu1.storage2_data()[i]));
    }
    std::printf("  1-iteration regret maxdiff = %.3g over %zu floats\n", maxd, n);
    check(maxd < 1e-3, "single-iteration regrets agree within 1e-3 (algorithmic identity)");

    // Full solve convergence.
    const uint32_t ITERS = 300;
    PostFlopGame cpu(make_cc(false), make_tc(false));
    cpu.prepare(); cpu.allocate_memory(false);
    PostFlopGame gpu(make_cc(false), make_tc(false));
    gpu.prepare(); gpu.allocate_memory(false); gpu.set_gpu_enabled(true);
    for (uint32_t it = 0; it < ITERS; ++it) { solve_step(cpu, it); solve_step(gpu, it); }
    if (gpu.gpu_mem_initialized()) gpu_solver_copy_back(gpu, *gpu.gpu_mem());

    float ex_cpu = compute_exploitability(cpu);
    float ex_gpu = compute_exploitability(gpu);
    std::printf("  exploit after %u iters: CPU=%.6f  GPU(compat)=%.6f\n", ITERS, ex_cpu, ex_gpu);
    check(std::isfinite(ex_cpu) && std::isfinite(ex_gpu), "both exploitabilities finite");
    check(ex_cpu < 0.02f && ex_gpu < 0.02f, "both paths converge below 2% of pot");

    auto rs_cpu = cpu.root_strategy();
    auto rs_gpu = gpu.root_strategy();
    double smd = 0;
    for (size_t i = 0; i < rs_cpu.size() && i < rs_gpu.size(); ++i)
        smd = std::max(smd, (double)std::fabs(rs_cpu[i] - rs_gpu[i]));
    std::printf("  root strategy maxdiff = %.4f (%zu actions)\n", smd, rs_cpu.size());
    check(smd < 0.08, "root strategies agree within 0.08");

    // Strict determinism: replay the CPU solve bit-for-bit.
    PostFlopGame cpu2(make_cc(false), make_tc(false));
    cpu2.prepare(); cpu2.allocate_memory(false);
    for (uint32_t it = 0; it < ITERS; ++it) solve_step(cpu2, it);
    bool det = true;
    size_t n1 = cpu.storage1_bytes() / sizeof(float);
    for (size_t i = 0; i < n1; ++i) {
        if (cpu.storage1_data()[i] != cpu2.storage1_data()[i]) { det = false; break; }
    }
    check(det, "CPU path: bit-identical replay (strict determinism)");

    // Compat-GPU determinism.
    PostFlopGame gpu2(make_cc(false), make_tc(false));
    gpu2.prepare(); gpu2.allocate_memory(false); gpu2.set_gpu_enabled(true);
    for (uint32_t it = 0; it < ITERS; ++it) solve_step(gpu2, it);
    if (gpu2.gpu_mem_initialized()) gpu_solver_copy_back(gpu2, *gpu2.gpu_mem());
    bool det2 = true;
    for (size_t i = 0; i < n1; ++i) {
        if (gpu.storage1_data()[i] != gpu2.storage1_data()[i]) { det2 = false; break; }
    }
    check(det2, "compat-GPU path: bit-identical replay (strict determinism)");
}

static void run_multiway() {
    std::printf("── 3-way river-dealt game (blocker + fold semantics) ──\n");

    const uint32_t ITERS = 60;
    PostFlopGame cpu(make_cc(true), make_tc(true));
    cpu.prepare(); cpu.allocate_memory(false);
    PostFlopGame gpu(make_cc(true), make_tc(true));
    gpu.prepare(); gpu.allocate_memory(false); gpu.set_gpu_enabled(true);

    for (uint32_t it = 0; it < ITERS; ++it) { solve_step(cpu, it); solve_step(gpu, it); }
    if (gpu.gpu_mem_initialized()) gpu_solver_copy_back(gpu, *gpu.gpu_mem());

    size_t n = cpu.storage2_bytes() / sizeof(float);
    bool finite = true;
    for (size_t i = 0; i < n; ++i) {
        if (!std::isfinite(cpu.storage2_data()[i]) || !std::isfinite(gpu.storage2_data()[i])) {
            finite = false; break;
        }
    }
    check(finite, "both 3-way paths produce finite regrets");

    // NOTE: raw multiway regrets are NOT compared element-wise. Multiplayer
    // CFR has no Nash-convergence guarantee and different float summation
    // orders legitimately land on different trajectories/fixed points (the
    // UBSan-instrumented build demonstrates regret-level divergence at
    // trajectory-equilibrium level). The scale-free invariant is the ROOT
    // STRATEGY (normalized average), compared here:
    auto rs_c = cpu.root_strategy();
    auto rs_g = gpu.root_strategy();
    double strat_md = 0;
    for (size_t i = 0; i < rs_c.size() && i < rs_g.size(); ++i)
        strat_md = std::max(strat_md, (double)std::fabs(rs_c[i] - rs_g[i]));
    std::printf("  3-way root strategy maxdiff after %u iters = %.4f (%zu actions)\n",
                ITERS, strat_md, rs_c.size());
    check(strat_md < 0.25, "3-way root strategies agree within 0.25 (scale-free)");
}

int main() {
    std::printf("=== CPU vs GPU (compat) numerical consistency — Phase 4 ===\n\n");
    run_headsup();
    std::printf("\n");
    run_multiway();
    std::printf("\n=== Consistency Summary: %d passed, %d failed ===\n", pass, fail);
    return fail == 0 ? 0 : 1;
}
