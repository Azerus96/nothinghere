// ════════════════════════════════════════════════════════════════════════
// test_evaluator.cpp — Validate hand evaluator against known counts
// ════════════════════════════════════════════════════════════════════════
// Iterates all C(52,7) = 133,784,560 seven-card hands, categorizes each,
// and verifies the distribution matches the known poker hand frequencies:
//
//   Straight flush: 41,584
//   Four of a Kind: 224,848
//   Full house:     3,473,184
//   Flush:          4,047,644
//   Straight:       6,180,020
//   Three of Kind:  6,461,620
//   Two Pair:       31,433,400
//   One Pair:       58,627,800
//   High Card:      23,294,460
//   TOTAL:          133,784,560
//
// Source: postflop-solver/src/hand.rs test_all_hands
// ════════════════════════════════════════════════════════════════════════
#include <cstdio>
#include <cstdint>
#include <array>
#include <chrono>
#include "../include/hand_evaluator.h"

using namespace postflop;

int main() {
    printf("=== Hand Evaluator Validation ===\n");
    printf("Enumerating all C(52,7) = 133,784,560 7-card hands...\n");
    fflush(stdout);

    int counts[9] = {0,0,0,0,0,0,0,0,0};
    long long total = 0;

    auto t0 = std::chrono::high_resolution_clock::now();

    // Iterate all C(52,7) combinations
    Card cards[7];
    for (int c0 = 0;   c0 < 52; ++c0) {
      cards[0] = c0;
      for (int c1 = c0+1; c1 < 52; ++c1) {
        cards[1] = c1;
        for (int c2 = c1+1; c2 < 52; ++c2) {
          cards[2] = c2;
          for (int c3 = c2+1; c3 < 52; ++c3) {
            cards[3] = c3;
            for (int c4 = c3+1; c4 < 52; ++c4) {
              cards[4] = c4;
              for (int c5 = c4+1; c5 < 52; ++c5) {
                cards[5] = c5;
                for (int c6 = c5+1; c6 < 52; ++c6) {
                  cards[6] = c6;
                  int32_t packed = evaluate_internal(cards, 7);
                  int cat = packed >> 26;
                  counts[cat]++;
                  total++;
                }
              }
            }
          }
        }
      }
      if ((c0 % 5) == 0) {
        printf("  progress: c0=%d/51, total=%lld\n", c0, total);
        fflush(stdout);
      }
    }

    auto t1 = std::chrono::high_resolution_clock::now();
    double sec = std::chrono::duration<double>(t1 - t0).count();

    static const char* NAMES[9] = {
        "High Card", "One Pair", "Two Pair", "Three of Kind",
        "Straight", "Flush", "Full House", "Four of Kind", "Straight Flush"
    };
    long long expected[9] = {
        23294460, 58627800, 31433400, 6461620,
        6180020, 4047644, 3473184, 224848, 41584
    };

    printf("\nResults (%.2fs, %.0f evals/sec):\n", sec, total / sec);
    printf("%-20s %12s %12s %8s\n", "Category", "Actual", "Expected", "Status");
    printf("%-20s %12s %12s %8s\n", "--------", "------", "--------", "------");

    bool all_ok = true;
    for (int i = 0; i < 9; ++i) {
        bool ok = counts[i] == expected[i];
        if (!ok) all_ok = false;
        printf("%-20s %12d %12lld %8s\n",
               NAMES[i], counts[i], expected[i],
               ok ? "OK" : "*** MISMATCH ***");
    }
    printf("%-20s %12lld %12lld\n", "TOTAL", total, 133784560LL);

    if (all_ok && total == 133784560LL) {
        printf("\n✓ Evaluator PASSES all distribution tests.\n");
        return 0;
    } else {
        printf("\n✗ Evaluator FAILS distribution tests.\n");
        return 1;
    }
}
