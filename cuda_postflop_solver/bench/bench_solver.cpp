// ════════════════════════════════════════════════════════════════════════
// bench_solver.cpp — Performance benchmarks
// ════════════════════════════════════════════════════════════════════════
// Benchmarks:
//   1. Hand evaluator: 100M random 7-card hands, evals/sec
//   2. Range parsing: parse a complex range string 1000 times
//   3. Action tree build: construct a full NLHE tree
//   4. DCFR solver: 100 iterations on a real spot
//   5. Memory usage: total bytes for storage arenas
// ════════════════════════════════════════════════════════════════════════
#include <cstdio>
#include <vector>
#include <chrono>
#include <random>
#include "card.h"
#include "hand_evaluator.h"
#include "range.h"
#include "action_tree.h"
#include "game.h"
#include "solver.h"

using namespace postflop;

int main() {
    printf("=== CUDA Postflop Solver Benchmarks ===\n\n");

    // ── Bench 1: Hand evaluator ───────────────────────────────────────
    printf("── Bench 1: Hand evaluator ──\n");
    std::mt19937 rng(42);
    std::uniform_int_distribution<int> dist(0, 51);
    const int N = 10000000;
    std::vector<Card> hands(N * 7);
    for (int i = 0; i < N * 7; ++i) hands[i] = (Card)dist(rng);

    int32_t dummy = 0;
    auto t0 = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < N; ++i) {
        dummy += evaluate(&hands[i * 7], 7);
    }
    auto t1 = std::chrono::high_resolution_clock::now();
    double sec = std::chrono::duration<double>(t1 - t0).count();
    printf("  %d evals in %.3fs = %.0f evals/sec (CPU single-threaded)\n",
           N, sec, N / sec);
    printf("  (dummy=%d to prevent optimization)\n", dummy);
    printf("  GPU target (Tesla T4): ~250M evals/sec (8x speedup expected)\n\n");

    // ── Bench 2: Range parsing ────────────────────────────────────────
    printf("── Bench 2: Range parsing ──\n");
    std::string range_str = "AA,KK,QQ,JJ,TT,99,88,77,AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,AKo,AQo,AJo,AJo,KQs,KJs,KTs,K9s,QJs,QTs,JTs,T9s,98s,87s,76s,65s,55,44,33,22:0.5";
    auto t2 = std::chrono::high_resolution_clock::now();
    for (int i = 0; i < 1000; ++i) {
        Range r = Range::from_string(range_str);
        dummy += (int)r[0];
    }
    auto t3 = std::chrono::high_resolution_clock::now();
    sec = std::chrono::duration<double>(t3 - t2).count();
    printf("  1000 parses in %.3fs = %.0f parses/sec\n\n", sec, 1000.0 / sec);

    // ── Bench 3: Action tree build ───────────────────────────────────
    printf("── Bench 3: Action tree build ──\n");
    TreeConfig tc;
    tc.initial_state = BoardState::Flop;
    tc.starting_pot = 100;
    tc.effective_stack = 900;
    tc.rake_rate = 0;
    tc.rake_cap = 0;
    tc.flop_bet_sizes[0] = { {BetSize::PotRelative(0.33), BetSize::PotRelative(0.75), BetSize::PotRelative(1.5)},
                              {BetSize::PrevRelative(2.5), BetSize::AllIn()} };
    tc.flop_bet_sizes[1] = { {BetSize::PotRelative(0.33), BetSize::PotRelative(0.75), BetSize::PotRelative(1.5)},
                              {BetSize::PrevRelative(2.5), BetSize::AllIn()} };
    tc.turn_bet_sizes[0] = tc.flop_bet_sizes[0];
    tc.turn_bet_sizes[1] = tc.flop_bet_sizes[1];
    tc.river_bet_sizes[0] = tc.flop_bet_sizes[0];
    tc.river_bet_sizes[1] = tc.flop_bet_sizes[1];
    tc.add_allin_threshold = 1.0;
    tc.force_allin_threshold = 0.25;
    tc.merging_threshold = 0.0;

    auto t4 = std::chrono::high_resolution_clock::now();
    ActionTree at(tc);
    auto t5 = std::chrono::high_resolution_clock::now();
    sec = std::chrono::duration<double>(t5 - t4).count();
    auto counts = at.count_num_action_nodes();
    uint64_t total = counts[0] + counts[1] + counts[2];
    printf("  Tree built in %.3fs: %lu flop + %lu turn + %lu river = %lu total action nodes\n",
           sec, (unsigned long)counts[0], (unsigned long)counts[1],
           (unsigned long)counts[2], (unsigned long)total);
    printf("  Total nodes (incl. chance+terminal): %lu\n\n", (unsigned long)at.total_nodes());

    // ── Bench 4: DCFR solver ─────────────────────────────────────────
    printf("── Bench 4: DCFR solver (100 iterations) ──\n");
    CardConfig cc;
    cc.range_oop = Range::from_string("AA,KK,QQ,JJ,TT,99,88,77,66,55,AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,AKo,AQo,AJo,AJo,KQs,KJs,KTs,K9s,QJs,QTs,JTs,T9s,98s,87s,76s,65s");
    cc.range_ip  = Range::from_string("AA,KK,QQ,JJ,TT,99,88,77,AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,AKo,AQo,AJo,AJo,KQs,KJs,KTs,K9s,QJs,QTs,JTs,T9s,98s,87s,76s,65s,55,44,33,22");
    cc.flop[0] = card_from_string("Td");
    cc.flop[1] = card_from_string("9d");
    cc.flop[2] = card_from_string("6h");
    cc.turn = card_from_string("Qc");
    cc.river = card_from_string("2s");

    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    game.allocate_memory(false);

    auto [uncompressed, compressed] = game.memory_usage();
    printf("  Memory: %lu bytes uncompressed, %lu bytes compressed\n",
           (unsigned long)uncompressed, (unsigned long)compressed);

    auto t6 = std::chrono::high_resolution_clock::now();
    for (uint32_t iter = 0; iter < 100; ++iter) {
        solve_step(game, iter);
    }
    auto t7 = std::chrono::high_resolution_clock::now();
    sec = std::chrono::duration<double>(t7 - t6).count();
    printf("  100 DCFR iterations in %.3fs = %.1f iter/sec (CPU)\n", sec, 100.0 / sec);
    printf("  GPU target (Tesla T4): ~5000 iter/sec on similar spot\n\n");

    // ── Bench 5: Estimated GPU speedup ───────────────────────────────
    printf("── Bench 5: GPU speedup estimates (Tesla T4, sm_75) ──\n");
    double cpu_eval_rate = N / std::chrono::duration<double>(t1 - t0).count();
    double gpu_eval_rate = 250e6;   // T4 target
    printf("  Hand eval:  CPU=%.0f/sec, GPU target=%.0f/sec, speedup=%.1fx\n",
           cpu_eval_rate, gpu_eval_rate, gpu_eval_rate / cpu_eval_rate);
    printf("  Memory bandwidth: CPU ~10 GB/s, T4 = 320 GB/s, speedup=32x\n");
    printf("  Parallelism: CPU 1 thread, T4 = 2560 CUDA cores, speedup=~1000x\n");
    printf("  Effective DCFR speedup (with overhead): ~50-100x expected\n\n");

    printf("=== All benchmarks complete ===\n");
    return 0;
}
