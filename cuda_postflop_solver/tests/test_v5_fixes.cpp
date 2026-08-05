// ════════════════════════════════════════════════════════════════════════
// test_v5_fixes.cpp — Validate V5 bug fixes
// ════════════════════════════════════════════════════════════════════════
// BUG#1: ScratchArena use-after-free — trigger arena growth, verify pointers
//        remain valid after growth.
// BUG#2: apply_added_lines pointer corruption — add lines, verify tree
//        structure is correct.
// BUG#3: solve_step GPU dispatch — verify is_gpu_enabled() is checked.
// ════════════════════════════════════════════════════════════════════════
#include <cstdio>
#include <vector>
#include <string>
#include <cstring>
#include "card.h"
#include "hand_evaluator.h"
#include "range.h"
#include "action_tree.h"
#include "game.h"
#include "solver.h"
#include "gpu_solver.h"
#include <functional>

using namespace postflop;

// ── Test BUG#1 fix: ScratchArena chunked design ─────────────────────────
// We can't access ScratchArena directly (it's in an anonymous namespace),
// but we CAN trigger arena growth by running a large solver that allocates
// more than the initial 16MB chunk. If the arena is broken (use-after-free),
// the solver will crash or produce NaN.
bool test_arena_growth() {
    printf("── Test BUG#1: ScratchArena chunked growth ──\n");

    // Create a game with many hands and deep tree to trigger arena growth
    CardConfig cc;
    // Full range — maximizes num_hands
    cc.range_oop = Range::ones();
    cc.range_ip  = Range::ones();
    cc.flop[0] = card_from_string("Td");
    cc.flop[1] = card_from_string("9d");
    cc.flop[2] = card_from_string("6h");
    cc.turn = card_from_string("Qc");
    cc.river = card_from_string("2s");

    TreeConfig tc;
    tc.initial_state = BoardState::Flop;
    tc.starting_pot = 100;
    tc.effective_stack = 900;
    tc.rake_rate = 0; tc.rake_cap = 0;
    tc.flop_bet_sizes[0] = { {BetSize::PotRelative(0.33), BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(2.5)} };
    tc.flop_bet_sizes[1] = { {BetSize::PotRelative(0.33), BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(2.5)} };
    tc.turn_bet_sizes[0] = tc.flop_bet_sizes[0];
    tc.turn_bet_sizes[1] = tc.flop_bet_sizes[1];
    tc.river_bet_sizes[0] = tc.flop_bet_sizes[0];
    tc.river_bet_sizes[1] = tc.flop_bet_sizes[1];

    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    game.allocate_memory(false);

    printf("  OOP hands: %d, IP hands: %d, nodes: %zu\n",
           game.num_private_hands(0), game.num_private_hands(1),
           (size_t)game.num_nodes());

    // Run many iterations — each allocates cfv_actions buffers.
    // With ~1300 hands × 3 actions × 4 bytes = 15.6 KB per node allocation.
    // A tree with 100+ nodes at depth 5+ will allocate >1MB per iteration.
    // After 100 iterations × 2 players = 200 calls, total allocations
    // will exceed the initial 16MB chunk if pointers are held across calls.
    for (uint32_t iter = 0; iter < 100; ++iter) {
        solve_step(game, iter);
    }

    float expl = compute_exploitability(game);
    printf("  After 100 iterations: exploit=%.6f\n", expl);

    // If arena had use-after-free, exploit would be NaN or the solver
    // would have crashed. Check for finite value.
    bool ok = (expl == expl) && (expl > -1e10) && (expl < 1e10);
    printf("  %s: Arena growth did not cause use-after-free\n", ok ? "PASS" : "FAIL");
    return ok;
}

// ── Test BUG#2 fix: apply_added_lines ───────────────────────────────────
bool test_added_lines() {
    printf("\n── Test BUG#2: apply_added_lines pointer integrity ──\n");

    CardConfig cc;
    cc.range_oop = Range::from_string("AA,KK,QQ,JJ,AKs,AKo");
    cc.range_ip  = Range::from_string("AA,KK,QQ,JJ,AKs,AKo");
    cc.flop[0] = card_from_string("Td");
    cc.flop[1] = card_from_string("9d");
    cc.flop[2] = card_from_string("6h");
    cc.turn = card_from_string("Qc");
    cc.river = card_from_string("2s");

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

    // Add a custom line: Bet 75% → Raise 2.5x → Call
    std::vector<std::vector<Action>> added_lines;
    Action b75; b75.type = Action::Type::Bet; b75.amount = 75;
    Action r250; r250.type = Action::Type::Raise; r250.amount = 250;
    Action call; call.type = Action::Type::Call;
    added_lines.push_back({b75, r250, call});

    // Add another line that goes deeper: Bet 75% → Call → Check → Bet 75%
    Action check; check.type = Action::Type::Check;
    added_lines.push_back({b75, call, check, b75});

    PostFlopGame game(std::move(cc), tc, added_lines);
    game.prepare();
    game.allocate_memory(false);

    // Verify tree was built correctly — all nodes reachable from root
    const auto& arena = game.node_arena();
    std::vector<bool> visited(arena.size(), false);
    std::function<void(int)> walk = [&](int idx) {
        if (idx < 0 || idx >= (int)arena.size() || visited[idx]) return;
        visited[idx] = true;
        const PostFlopNode& n = arena[idx];
        for (uint32_t c = 0; c < n.num_children; ++c) {
            walk(n.children_offset + c);
        }
    };
    walk(0);

    int reachable = 0;
    for (bool v : visited) if (v) reachable++;

    // Also verify BFS layout: all children contiguous and in-bounds
    int layout_ok = 0, layout_fail = 0;
    for (size_t i = 0; i < arena.size(); ++i) {
        const PostFlopNode& n = arena[i];
        if (n.num_children == 0) continue;
        uint32_t last = n.children_offset + n.num_children - 1;
        if (last >= arena.size()) { layout_fail++; continue; }
        layout_ok++;
    }

    printf("  Arena: %zu nodes, %d reachable, layout OK=%d FAIL=%d\n",
           arena.size(), reachable, layout_ok, layout_fail);

    // Run solver — if tree is corrupted, it will crash or produce NaN
    for (uint32_t iter = 0; iter < 20; ++iter) {
        solve_step(game, iter);
    }
    float expl = compute_exploitability(game);
    printf("  After 20 iterations with added_lines: exploit=%.6f\n", expl);

    bool ok = (reachable == (int)arena.size()) && (layout_fail == 0) &&
              (expl == expl) && (expl > -1e10) && (expl < 1e10);
    printf("  %s: apply_added_lines produces valid tree\n", ok ? "PASS" : "FAIL");
    return ok;
}

// ── Test BUG#3 fix: solve_step GPU dispatch ─────────────────────────────
bool test_gpu_dispatch() {
    printf("\n── Test BUG#3: solve_step GPU dispatch check ──\n");

    CardConfig cc;
    cc.range_oop = Range::from_string("AA,KK,QQ,AKs");
    cc.range_ip  = Range::from_string("AA,KK,QQ,AKs");
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

    // Test 1: CPU path (default)
    printf("  Test 3a: CPU path (is_gpu_enabled=false)\n");
    game.set_gpu_enabled(false);
    solve_step(game, 0);
    float cpu_expl = compute_exploitability(game);
    printf("  CPU exploit: %.6f\n", cpu_expl);

    // Test 2: GPU path — on CPU-only build, should fall back gracefully
    printf("  Test 3b: GPU path (is_gpu_enabled=true)\n");
    game.set_gpu_enabled(true);
    solve_step(game, 1);  // Should try GPU, fall back to CPU on CPU-only build
    // After fallback, is_gpu_enabled should be false
    bool ok = true;
#ifdef CPU_ONLY
    // On CPU-only build, is_gpu_enabled should have been reset to false
    ok = !game.is_gpu_enabled();
    printf("  After GPU attempt on CPU-only build: is_gpu_enabled=%d (expect 0)\n",
           game.is_gpu_enabled());
#else
    // On CUDA build, GPU should have run (or fallen back on error)
    printf("  CUDA build: GPU path attempted\n");
#endif

    // Verify solver still works after GPU attempt
    solve_step(game, 2);
    float final_expl = compute_exploitability(game);
    printf("  Final exploit: %.6f\n", final_expl);
    ok = ok && (final_expl == final_expl);  // not NaN

    printf("  %s: solve_step GPU dispatch check\n", ok ? "PASS" : "FAIL");
    return ok;
}

int main() {
    int pass = 0, fail = 0;
    if (test_arena_growth()) pass++; else fail++;
    if (test_added_lines()) pass++; else fail++;
    if (test_gpu_dispatch()) pass++; else fail++;

    printf("\n=== Summary: %d passed, %d failed ===\n", pass, fail);
    return fail == 0 ? 0 : 1;
}
