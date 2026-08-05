// ════════════════════════════════════════════════════════════════════════
// test_v6_multi_game.cpp — Verify no cross-game state pollution (BUG#1 fix)
// ════════════════════════════════════════════════════════════════════════
// V5 BUG: static GpuMemory in solve_step was shared across all games.
// Solving Game B after Game A would reuse Game A's device pointers.
//
// V6 FIX: GpuMemory is per-game (member of PostFlopGame).
//
// This test:
//   1. Creates Game A (small range, board Td9d6h Qc 2s)
//   2. Creates Game B (different range, board AhKhQh Jc 3s)
//   3. Solves Game A for 10 iterations
//   4. Solves Game B for 10 iterations
//   5. Verifies Game A's strategy is DIFFERENT from Game B's
//   6. Verifies re-solving Game A produces SAME result (deterministic)
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

using namespace postflop;

int main() {
    int pass = 0, fail = 0;
    auto check = [&](bool ok, const std::string& name) {
        if (ok) { printf("  PASS: %s\n", name.c_str()); pass++; }
        else    { printf("  FAIL: %s\n", name.c_str()); fail++; }
    };

    printf("=== Test V6: Multi-Game State Isolation (BUG#1 fix) ===\n\n");

    // Common tree config
    TreeConfig tc;
    tc.initial_state = BoardState::Flop;
    tc.starting_pot = 100;
    tc.effective_stack = 900;
    tc.rake_rate = 0; tc.rake_cap = 0;
    tc.flop_bet_sizes[0] = { {BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(2.5)} };
    tc.flop_bet_sizes[1] = { {BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(2.5)} };
    tc.turn_bet_sizes[0] = tc.flop_bet_sizes[0];
    tc.turn_bet_sizes[1] = tc.flop_bet_sizes[1];
    tc.river_bet_sizes[0] = tc.flop_bet_sizes[0];
    tc.river_bet_sizes[1] = tc.flop_bet_sizes[1];

    // ── Game A: tight range, board Td9d6h Qc 2s ───────────────────────
    CardConfig cc_a;
    cc_a.range_oop = Range::from_string("AA,KK,QQ,JJ,TT,AKs,AKo");
    cc_a.range_ip  = Range::from_string("AA,KK,QQ,JJ,TT,AKs,AKo");
    cc_a.flop[0] = card_from_string("Td");
    cc_a.flop[1] = card_from_string("9d");
    cc_a.flop[2] = card_from_string("6h");
    cc_a.turn = card_from_string("Qc");
    cc_a.river = card_from_string("2s");

    // ── Game B: wide range, board AhKhQh Jc 3s ───────────────────────
    CardConfig cc_b;
    cc_b.range_oop = Range::from_string("AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,AKo,AQo,AJo,ATo,KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s,76s,65s,54s,43s,32s");
    cc_b.range_ip  = Range::from_string("AA,KK,QQ,JJ,TT,99,88,77,66,55,44,33,22,AKs,AQs,AJs,ATs,A9s,A8s,A7s,A6s,A5s,A4s,A3s,A2s,AKo,AQo,AJo,ATo,KQs,KJs,KTs,QJs,QTs,JTs,T9s,98s,87s,76s,65s,54s,43s,32s");
    cc_b.flop[0] = card_from_string("Ah");
    cc_b.flop[1] = card_from_string("Kh");
    cc_b.flop[2] = card_from_string("Qh");
    cc_b.turn = card_from_string("Jc");
    cc_b.river = card_from_string("3s");

    // ── Create and prepare both games ────────────────────────────────
    PostFlopGame game_a(std::move(cc_a), tc);
    game_a.prepare();
    game_a.allocate_memory(false);

    PostFlopGame game_b(std::move(cc_b), tc);
    game_b.prepare();
    game_b.allocate_memory(false);

    printf("  Game A: %d OOP hands, %d nodes\n",
           game_a.num_private_hands(0), (int)game_a.num_nodes());
    printf("  Game B: %d OOP hands, %d nodes\n",
           game_b.num_private_hands(0), (int)game_b.num_nodes());
    check(game_a.num_private_hands(0) != game_b.num_private_hands(0),
          "Games A and B have different hand counts");

    // ── Solve Game A for 10 iterations ───────────────────────────────
    printf("\n  Solving Game A (10 iterations)...\n");
    for (uint32_t iter = 0; iter < 10; ++iter) {
        solve_step(game_a, iter);
    }
    float expl_a = compute_exploitability(game_a);
    auto strat_a = game_a.root_strategy();
    printf("  Game A exploit: %.6f, strategy size: %zu\n", expl_a, strat_a.size());

    // ── Solve Game B for 10 iterations ───────────────────────────────
    printf("  Solving Game B (10 iterations)...\n");
    for (uint32_t iter = 0; iter < 10; ++iter) {
        solve_step(game_b, iter);
    }
    float expl_b = compute_exploitability(game_b);
    auto strat_b = game_b.root_strategy();
    printf("  Game B exploit: %.6f, strategy size: %zu\n", expl_b, strat_b.size());

    // ── Verify games produced different results ──────────────────────
    check(expl_a != expl_b, "Game A and B have different exploitability");
    check(strat_a.size() != strat_b.size() ||
          strat_a[0] != strat_b[0],
          "Game A and B have different strategies");

    // ── Re-solve Game A to verify determinism ────────────────────────
    printf("\n  Re-solving Game A (determinism check)...\n");
    // Create a fresh Game A with same config
    CardConfig cc_a2;
    cc_a2.range_oop = Range::from_string("AA,KK,QQ,JJ,TT,AKs,AKo");
    cc_a2.range_ip  = Range::from_string("AA,KK,QQ,JJ,TT,AKs,AKo");
    cc_a2.flop[0] = card_from_string("Td");
    cc_a2.flop[1] = card_from_string("9d");
    cc_a2.flop[2] = card_from_string("6h");
    cc_a2.turn = card_from_string("Qc");
    cc_a2.river = card_from_string("2s");
    PostFlopGame game_a2(std::move(cc_a2), tc);
    game_a2.prepare();
    game_a2.allocate_memory(false);
    for (uint32_t iter = 0; iter < 10; ++iter) {
        solve_step(game_a2, iter);
    }
    float expl_a2 = compute_exploitability(game_a2);
    printf("  Game A (re-solve) exploit: %.6f\n", expl_a2);

    check(std::abs(expl_a - expl_a2) < 1e-3f,
          "Game A deterministic: same exploit on re-solve");

    // ── Verify Game A's gpu_mem is independent from Game B's ─────────
    // (On CPU-only build, both are nullptr, which is correct)
    check(!game_a.gpu_mem_initialized() || game_a.gpu_mem() != game_b.gpu_mem(),
          "Game A and B have independent GpuMemory (no shared state)");

    printf("\n=== Summary: %d passed, %d failed ===\n", pass, fail);
    return fail == 0 ? 0 : 1;
}
