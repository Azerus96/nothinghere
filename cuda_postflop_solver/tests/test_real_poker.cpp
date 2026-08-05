// ════════════════════════════════════════════════════════════════════════
// test_real_poker.cpp — Real poker spot: simple flop call/fold
// ════════════════════════════════════════════════════════════════════════
// Test 1: Verify hand evaluator correctness on real poker hands.
// Test 2: Build a simple action tree (1 bet size, no donk).
// Test 3: Allocate memory and run a few DCFR iterations.
// Test 4: Verify range parsing and equality.
// ════════════════════════════════════════════════════════════════════════
#include <cstdio>
#include <vector>
#include <string>
#include <chrono>
#include "card.h"
#include "hand_evaluator.h"
#include "range.h"
#include "action_tree.h"
#include "game.h"
#include "solver.h"
#include "gospers.h"
#include "zobrist.h"
#include "isomorphism.h"

using namespace postflop;

int main() {
    int pass = 0, fail = 0;
    auto check = [&](bool ok, const std::string& name) {
        if (ok) { printf("  PASS: %s\n", name.c_str()); pass++; }
        else    { printf("  FAIL: %s\n", name.c_str()); fail++; }
    };

    printf("=== Test 1: Hand evaluator on real poker hands ===\n");
    // Royal flush
    Card As = make_card(12, 3), Ks = make_card(11, 3), Qs = make_card(10, 3);
    Card Js = make_card(9, 3), Ts = make_card(8, 3);
    Card _2h = make_card(0, 2), _3d = make_card(1, 1);
    int32_t royal = evaluate7(As, Ks, Qs, Js, Ts, _2h, _3d);
    check(royal > 4800, "Royal flush strength > 4800");

    // Quad aces
    Card Ah = make_card(12, 2), Ad = make_card(12, 1), Ac = make_card(12, 0);
    Card Kh = make_card(11, 2);
    int32_t quad = evaluate7(Ah, Ad, Ac, As, Kh, _2h, _3d);
    check(quad > 4700 && quad < royal, "Quad aces strength in range");

    // Full house
    Card Kd = make_card(11, 1), Kc = make_card(11, 0);
    int32_t fh = evaluate7(Ah, Ad, Ac, Kh, Kd, _2h, _3d);
    check(fh > 4400 && fh < quad, "Full house aces full of kings");

    // Flush
    Card _2s = make_card(0, 3), _3s = make_card(1, 3), _5s = make_card(3, 3);
    int32_t flush = evaluate7(As, Ks, Qs, _5s, _3s, _2h, _3d);
    check(flush > 4000 && flush < fh, "Ace flush");

    // Straight
    Card _9h = make_card(7, 2), _8d = make_card(6, 1), _7c = make_card(5, 0);
    Card _6h = make_card(4, 2), _5d = make_card(3, 1);
    int32_t straight = evaluate7(_9h, _8d, _7c, _6h, _5d, _2h, _3d);
    check(straight > 3000 && straight < flush, "9-high straight");

    printf("\n=== Test 2: Range parsing ===\n");
    Range r1 = Range::from_string("AA,KK,QQ,AKs");
    check(r1.get_weight_pair(12) == 1.0f, "AA weight = 1.0");
    check(r1.get_weight_pair(11) == 1.0f, "KK weight = 1.0");
    check(r1.get_weight_pair(10) == 1.0f, "QQ weight = 1.0");
    check(r1.get_weight_suited(12, 11) == 1.0f, "AKs weight = 1.0");
    check(r1.get_weight_offsuit(12, 11) == 0.0f, "AKo weight = 0 (not in range)");
    check(r1.get_weight_pair(0) == 0.0f, "22 not in range");

    Range r2 = Range::from_string("88+,A2s+,KQ");
    check(r2.get_weight_pair(7) == 1.0f, "88 in 88+");
    check(r2.get_weight_pair(8) == 1.0f, "99 in 88+");
    check(r2.get_weight_pair(12) == 1.0f, "AA in 88+");
    check(r2.get_weight_pair(5) == 0.0f, "77 not in 88+");  // 77 is rank 5
    check(r2.get_weight_suited(12, 0) == 1.0f, "A2s in A2s+");
    check(r2.get_weight_suited(12, 11) == 1.0f, "AKs in A2s+");
    check(r2.get_weight_offsuit(11, 10) == 1.0f, "KQo in KQ");
    check(r2.get_weight_suited(11, 10) == 1.0f, "KQs in KQ");

    printf("\n=== Test 3: Suit isomorphism ===\n");
    Range uniform = Range::ones();
    check(uniform.is_suit_isomorphic(0, 1), "Uniform range: clubs ~ diamonds");
    check(uniform.is_suit_isomorphic(0, 2), "Uniform range: clubs ~ hearts");
    check(uniform.is_suit_isomorphic(0, 3), "Uniform range: clubs ~ spades");

    printf("\n=== Test 4: Gosper's hack (k-subset enumeration) ===\n");
    int count = enumerate_k_subsets(13, 5, [](uint64_t){});
    check(count == 1287, "C(13,5) = 1287");

    printf("\n=== Test 5: Zobrist hashing (deterministic) ===\n");
    ZobristKeys z1 = zobrist_generate(0xABCDEF1234567890ULL);
    ZobristKeys z2 = zobrist_generate(0xABCDEF1234567890ULL);
    check(z1.keys[0][0] == z2.keys[0][0], "Same seed → same keys");

    printf("\n=== Test 6: Action tree construction ===\n");
    TreeConfig tc;
    tc.initial_state = BoardState::Flop;
    tc.starting_pot = 100;
    tc.effective_stack = 900;
    tc.rake_rate = 0;
    tc.rake_cap = 0;
    tc.flop_bet_sizes[0] = { {BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(3.0)} };
    tc.flop_bet_sizes[1] = { {BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(3.0)} };
    tc.turn_bet_sizes[0] = { {BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(3.0)} };
    tc.turn_bet_sizes[1] = { {BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(3.0)} };
    tc.river_bet_sizes[0] = { {BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(3.0)} };
    tc.river_bet_sizes[1] = { {BetSize::PotRelative(0.75)}, {BetSize::PrevRelative(3.0)} };
    tc.add_allin_threshold = 1.0;
    tc.force_allin_threshold = 0.25;
    tc.merging_threshold = 0.0;

    ActionTree at(tc);
    auto counts = at.count_num_action_nodes();
    printf("  Action nodes: flop=%lu turn=%lu river=%lu\n",
           (unsigned long)counts[0], (unsigned long)counts[1], (unsigned long)counts[2]);
    check(counts[0] > 0, "Flop action nodes > 0");

    printf("\n=== Test 7: PostFlopGame setup ===\n");
    CardConfig cc;
    cc.range_oop = Range::from_string("AA,KK,QQ,JJ,AKs,AKo,AQs,AQo");
    cc.range_ip  = Range::from_string("AA,KK,QQ,JJ,AKs,AKo,AQs,AQo,KQs,88+,77");
    cc.flop[0] = card_from_string("Td");
    cc.flop[1] = card_from_string("9d");
    cc.flop[2] = card_from_string("6h");
    cc.turn = card_from_string("Qc");
    cc.river = card_from_string("2s");

    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    printf("  OOP private hands: %d\n", game.num_private_hands(0));
    printf("  IP  private hands: %d\n", game.num_private_hands(1));
    printf("  Total nodes: %lu\n", (unsigned long)game.num_nodes());
    check(game.num_private_hands(0) > 0, "OOP has private hands");
    check(game.num_private_hands(1) > 0, "IP has private hands");

    auto [uncompressed, compressed] = game.memory_usage();
    printf("  Memory: uncompressed=%lu bytes, compressed=%lu bytes\n",
           (unsigned long)uncompressed, (unsigned long)compressed);

    printf("\n=== Test 8: Run DCFR solver (10 iterations) ===\n");
    game.allocate_memory(false);

    auto t0 = std::chrono::high_resolution_clock::now();
    for (uint32_t iter = 0; iter < 10; ++iter) {
        solve_step(game, iter);
        if (iter % 2 == 0) {
            printf("  iter %u done\n", iter);
        }
    }
    auto t1 = std::chrono::high_resolution_clock::now();
    double sec = std::chrono::duration<double>(t1 - t0).count();
    printf("  10 iterations in %.3fs (%.1f iter/sec)\n", sec, 10.0 / sec);

    printf("\n=== Test 9: Hand evaluator benchmark ===\n");
    // Benchmark: evaluate 1M random 7-card hands
    std::vector<Card> hands(7 * 1000000);
    for (size_t i = 0; i < hands.size(); ++i) hands[i] = (Card)(i * 7919 % 52);
    auto te0 = std::chrono::high_resolution_clock::now();
    int32_t sum = 0;
    for (size_t i = 0; i < 1000000; ++i) {
        sum += evaluate(&hands[i * 7], 7);
    }
    auto te1 = std::chrono::high_resolution_clock::now();
    double esec = std::chrono::duration<double>(te1 - te0).count();
    printf("  1M evaluations in %.3fs = %.0f evals/sec (sum=%d)\n",
           esec, 1000000.0 / esec, sum);

    printf("\n=== Summary: %d passed, %d failed ===\n", pass, fail);
    return fail == 0 ? 0 : 1;
}
