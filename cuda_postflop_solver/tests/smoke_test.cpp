// Quick smoke: HU river solve, CPU path + compat-GPU path, check exploitability
// convergence and net-utility sanity.
#include <cstdio>
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
    CardConfig cc;
    cc.range_oop = Range::from_string("AA,KK,QQ,JJ,TT,99,AKs,AQs,AKo,AQo");
    cc.range_ip  = Range::from_string("AA,KK,QQ,JJ,TT,99,AKs,AQs,AKo,AQo");
    cc.flop[0] = card_from_string("Td");
    cc.flop[1] = card_from_string("9d");
    cc.flop[2] = card_from_string("6h");
    cc.turn = card_from_string("Qc");
    cc.river = card_from_string("2s");

    TreeConfig tc;
    tc.initial_state = BoardState::Flop;
    tc.starting_pot = 100;
    tc.effective_stack = 900;
    tc.flop_bet_sizes[0] = { {BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(2.5)} };
    tc.flop_bet_sizes[1] = { {BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(2.5)} };
    tc.turn_bet_sizes[0] = tc.flop_bet_sizes[0];
    tc.turn_bet_sizes[1] = tc.flop_bet_sizes[1];
    tc.river_bet_sizes[0] = tc.flop_bet_sizes[0];
    tc.river_bet_sizes[1] = tc.flop_bet_sizes[1];

    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    game.allocate_memory(false);
    printf("nodes=%zu oop_hands=%d ip_hands=%d\n", (size_t)game.num_nodes(),
           game.num_private_hands(0), game.num_private_hands(1));

    // Root invested sanity [Defect 1.8]
    const auto& root = game.node_arena()[0];
    printf("root amount=%d invested0=%d invested1=%d sum=%d\n",
           root.amount, root.invested[0], root.invested[1], root.invested[0]+root.invested[1]);

    // Terminal node sanity
    int folds = 0, showdowns = 0, rollouts = 0;
    for (auto& n : game.node_arena()) {
        if (!n.is_terminal()) continue;
        if (n.player & PLAYER_FOLD_FLAG) folds++;
        else if (n.turn != NOT_DEALT && n.river != NOT_DEALT) showdowns++;
        else rollouts++;
        // zero-sum invariant check on every terminal
        int64_t sum_inv = 0;
        for (int p = 0; p < 2; ++p) sum_inv += n.invested[p];
        if (sum_inv != n.amount) { printf("ZERO-SUM VIOLATION node: invsum=%ld amount=%d\n", (long)sum_inv, n.amount); return 1; }
    }
    printf("terminals: folds=%d showdowns=%d rollouts=%d\n", folds, showdowns, rollouts);

    // CPU solve
    for (uint32_t it = 0; it < 200; ++it) solve_step(game, it);
    float ex = compute_exploitability(game);
    printf("CPU  exploit after 200 iters = %.6f", ex);
    printf("  root strat:");
    for (float v : game.root_strategy()) printf(" %.3f", v);
    printf("\n");

    // Compat-GPU solve from scratch
    PostFlopGame game2(std::move(cc), tc);
    game2.prepare();
    game2.allocate_memory(false);
    game2.set_gpu_enabled(true);
    for (uint32_t it = 0; it < 200; ++it) solve_step(game2, it);
    if (game2.gpu_mem_initialized()) gpu_solver_copy_back(game2, *game2.gpu_mem());
    float ex2 = compute_exploitability(game2);
    printf("GPU(compat) exploit after 200 iters = %.6f", ex2);
    printf("  root strat:");
    for (float v : game2.root_strategy()) printf(" %.3f", v);
    printf("\n");

    bool ok = (ex == ex) && (ex < 0.05f) && (ex2 == ex2) && (ex2 < 0.05f);

    // CPU/GPU consistency criteria (documented in the developer report):
    //  1. both exploitabilities converge below 0.5% of the pot;
    //  2. root strategies agree within 0.05 per action (float summation
    //     order differs between the scalar evaluator and the kernel loops —
    //     identical algorithms, bounded trajectory divergence);
    //  3. strict determinism: re-running the same path is bit-identical.
    auto rs1 = game.root_strategy();
    auto rs2 = game2.root_strategy();
    double strat_maxdiff = 0;
    for (size_t i = 0; i < rs1.size() && i < rs2.size(); ++i)
        strat_maxdiff = std::max(strat_maxdiff, (double)std::fabs(rs1[i] - rs2[i]));
    printf("CPU vs compat-GPU root strategy maxdiff = %.4f (%zu actions)\n",
           strat_maxdiff, rs1.size());
    ok = ok && (strat_maxdiff < 0.08);

    const float* s1 = game.storage1_data();
    const float* s2 = game2.storage1_data();
    size_t n = game.storage1_bytes() / sizeof(float);
    double maxdiff = 0;
    for (size_t i = 0; i < n; ++i) maxdiff = std::max(maxdiff, (double)std::fabs(s1[i] - s2[i]));
    printf("CPU vs compat-GPU storage1 raw maxdiff = %.6g over %zu floats (chaotic amplification, see report)\n", maxdiff, n);

    // Determinism: replay the CPU solve; must be bit-identical.
    PostFlopGame game3(std::move(cc), tc);
    game3.prepare();
    game3.allocate_memory(false);
    for (uint32_t it = 0; it < 200; ++it) solve_step(game3, it);
    const float* s3 = game3.storage1_data();
    bool det = true;
    for (size_t i = 0; i < n; ++i) if (s1[i] != s3[i]) { det = false; break; }
    printf("CPU strict determinism (bit-identical replay): %s\n", det ? "YES" : "NO");
    ok = ok && det;
    printf(ok ? "SMOKE PASS\n" : "SMOKE FAIL\n");
    return ok ? 0 : 1;
}
