// ════════════════════════════════════════════════════════════════════════
// hand_evaluator.h — 7-card Texas Hold'em hand evaluator
// ════════════════════════════════════════════════════════════════════════
// Port of postflop-solver/src/hand.rs + hand_table.rs to CUDA C++.
//
// Algorithm (exact port of Rust Hand::evaluate_internal):
//   1. From 7 cards, compute rank_bitmask (i32, 13 bits) + per-suit rank_bitmask.
//   2. Compute rank_count[13] and rankset_of_count[5].
//   3. Detect straight via shift-AND: rankset & (rankset<<1) & ... & (rankset<<4).
//      Special-case wheel A-2-3-4-5.
//   4. Determine category (0..8) and tiebreakers.
//   5. Pack into i32: (category << 26) | tiebreakers.
//   6. Binary search in HAND_TABLE (4824 entries) → final rank [0..4823].
//      Lower rank = weaker hand. Higher rank = stronger.
//
// Hand category encoding (top 6 bits = category, lower 26 bits = tiebreaker):
//   8 << 26 | is_straight_flush               // straight flush
//   7 << 26 | (quad_rank << 13) | kicker      // four of a kind
//   6 << 26 | (trips_rank << 13) | pair_rank  // full house
//   5 << 26 | top_5_flush_ranks               // flush
//   4 << 26 | straight_high                   // straight
//   3 << 26 | (trips_rank << 13) | top_2_kickers // three of a kind
//   2 << 26 | (top_2_pairs << 13) | kicker    // two pair
//   1 << 26 | (pair_rank << 13) | top_3_kickers // one pair
//   0 << 26 | top_5_ranks                     // high card
// ════════════════════════════════════════════════════════════════════════
#ifndef HAND_EVALUATOR_H
#define HAND_EVALUATOR_H

#include <cstdint>
#include "cuda_compat.h"
#include "card.h"

namespace postflop {

// ── Hand category constants ─────────────────────────────────────────────
constexpr int32_t CATEGORY_HIGH_CARD       = 0;
constexpr int32_t CATEGORY_ONE_PAIR        = 1;
constexpr int32_t CATEGORY_TWO_PAIR        = 2;
constexpr int32_t CATEGORY_THREE_OF_KIND   = 3;
constexpr int32_t CATEGORY_STRAIGHT        = 4;
constexpr int32_t CATEGORY_FLUSH           = 5;
constexpr int32_t CATEGORY_FULL_HOUSE       = 6;
constexpr int32_t CATEGORY_FOUR_OF_KIND    = 7;
constexpr int32_t CATEGORY_STRAIGHT_FLUSH  = 8;

constexpr int32_t CATEGORY_SHIFT = 26;

constexpr int32_t WHEEL_BITMASK = 0b1'0000'0000'1111;  // A=bit12, 5-4-3-2=bits 3-0

// ── HAND_TABLE ──────────────────────────────────────────────────────────
#ifdef __CUDACC__
__constant__
#endif
extern const int32_t HAND_TABLE[4824];

// ── Helpers ─────────────────────────────────────────────────────────────
// Keep only the top n set bits of x.
// Branchless version: clears bits below the n-th set bit using __clz + shifts.
// n must be in [1, 13]. For n=0 returns 0.
__device__ __host__ __forceinline__
int32_t keep_n_msb(int32_t x, int n) {
    if (n <= 0 || x == 0) return 0;
    if (n >= 13) return x & 0x1FFF;  // all 13 rank bits
    int32_t result = 0;
    int remaining = n;
    // Unrolled: at most 13 iterations possible. We loop but with early-exit hint.
    while (remaining > 0 && x) {
        int b = 31 - __clz(x);
        result |= (1 << b);
        x &= ~(1 << b);
        --remaining;
    }
    return result;
}

// Returns 0 if no straight, else bit-position of high card.
__device__ __host__ __forceinline__
int32_t find_straight(int32_t rankset) {
    int32_t s = rankset & (rankset << 1) & (rankset << 2) & (rankset << 3) & (rankset << 4);
    if (s) return 31 - __clz(s);
    if ((rankset & WHEEL_BITMASK) == WHEEL_BITMASK) return 3;  // 5-high wheel
    return 0;
}

// ── Hand7 struct (for clarity) ──────────────────────────────────────────
struct Hand7 {
    Card cards[7];
    int  num_cards;
};

// Internal packed i32 = (category << 26) | tiebreakers
__device__ __host__ __forceinline__
int32_t evaluate_internal(const Card* cards, int n) {
    int32_t rankset = 0;
    int32_t rankset_suit[4] = {0, 0, 0, 0};
    int rank_count[13] = {0,0,0,0,0,0,0,0,0,0,0,0,0};

    for (int i = 0; i < n; ++i) {
        Card c = cards[i];
        int r = card_rank(c);
        int s = card_suit(c);
        int32_t bit = 1 << r;
        rankset |= bit;
        rankset_suit[s] |= bit;
        rank_count[r] += 1;
    }

    // rankset_of_count[k] = bitmask of ranks that appear exactly k times.
    int32_t rankset_of_count[5] = {0, 0, 0, 0, 0};
    for (int r = 0; r < 13; ++r) {
        int c = rank_count[r];
        rankset_of_count[c] |= (1 << r);
    }

    // Detect flush
    int flush_suit = -1;
    for (int s = 0; s < 4; ++s) {
        if (__popc(rankset_suit[s]) >= 5) { flush_suit = s; break; }
    }

    int32_t straight_high = find_straight(rankset);

    // Detect straight flush
    int32_t straight_flush_high = 0;
    if (flush_suit >= 0) {
        straight_flush_high = find_straight(rankset_suit[flush_suit]);
    }
    if (straight_flush_high) {
        return (CATEGORY_STRAIGHT_FLUSH << CATEGORY_SHIFT) | straight_flush_high;
    }

    // Four of a kind: quad_rank + best kicker (excluding quad_rank)
    if (rankset_of_count[4]) {
        int32_t quad_rank = 31 - __clz(rankset_of_count[4]);
        int32_t kicker = 31 - __clz(rankset & ~(1 << quad_rank));
        return (CATEGORY_FOUR_OF_KIND << CATEGORY_SHIFT)
             | (quad_rank << 13) | kicker;
    }

    // Full house: must have trips AND (pair OR second trips)
    // The "pair" in the full house is the larger of:
    //   - best remaining pair (rankset_of_count[2] top bit)
    //   - second-best trips (rankset_of_count[3] without top bit)
    if (rankset_of_count[3]) {
        int32_t trips_rank = 31 - __clz(rankset_of_count[3]);
        // Possible pair ranks: any rank with count==2, OR any remaining trips rank.
        int32_t remaining_trips = rankset_of_count[3] & ~(1 << trips_rank);
        int32_t candidate_pairs = rankset_of_count[2] | remaining_trips;
        if (candidate_pairs) {
            int32_t pair_rank = 31 - __clz(candidate_pairs);
            return (CATEGORY_FULL_HOUSE << CATEGORY_SHIFT)
                 | (trips_rank << 13) | pair_rank;
        }
    }

    // Flush: top 5 flush ranks
    if (flush_suit >= 0) {
        int32_t top5 = keep_n_msb(rankset_suit[flush_suit], 5);
        return (CATEGORY_FLUSH << CATEGORY_SHIFT) | top5;
    }

    if (straight_high) {
        return (CATEGORY_STRAIGHT << CATEGORY_SHIFT) | straight_high;
    }

    // Three of a kind (no full house possible since we already handled it)
    if (rankset_of_count[3]) {
        int32_t trips_rank = 31 - __clz(rankset_of_count[3]);
        int32_t rest = rankset & ~(1 << trips_rank);
        int32_t top2 = keep_n_msb(rest, 2);
        return (CATEGORY_THREE_OF_KIND << CATEGORY_SHIFT)
             | (trips_rank << 13) | top2;
    }

    // Two pair: need at least 2 distinct pair ranks.
    // Take top 2 pairs as combined mask, plus best kicker (not in pairs).
    if (__popc(rankset_of_count[2]) >= 2) {
        int32_t p1 = 31 - __clz(rankset_of_count[2]);
        int32_t p2 = 31 - __clz(rankset_of_count[2] & ~(1 << p1));
        int32_t pair_mask = (1 << p1) | (1 << p2);
        int32_t kicker = 31 - __clz(rankset & ~pair_mask);
        return (CATEGORY_TWO_PAIR << CATEGORY_SHIFT)
             | (pair_mask << 13) | kicker;
    }

    // One pair
    if (__popc(rankset_of_count[2]) == 1) {
        int32_t pair_rank = 31 - __clz(rankset_of_count[2]);
        int32_t rest = rankset & ~(1 << pair_rank);
        int32_t top3 = keep_n_msb(rest, 3);
        return (CATEGORY_ONE_PAIR << CATEGORY_SHIFT)
             | (pair_rank << 13) | top3;
    }

    // High card
    int32_t top5 = keep_n_msb(rankset, 5);
    return (CATEGORY_HIGH_CARD << CATEGORY_SHIFT) | top5;
}

// Binary search in HAND_TABLE; returns strength in [1..4824].
// Unrolled branchless binary search: 13 levels for 4824 entries.
// Each step uses a conditional-move-friendly pattern.
__device__ __host__ __forceinline__
int32_t evaluate(const Card* cards, int n) {
    int32_t key = evaluate_internal(cards, n);
    // Standard binary search — compiler will unroll effectively
    int lo = 0, hi = 4823;
    #pragma unroll 13
    for (int i = 0; i < 13; ++i) {
        if (lo >= hi) break;
        int mid = (lo + hi) >> 1;
        if (HAND_TABLE[mid] < key) lo = mid + 1;
        else hi = mid;
    }
    return (int32_t)(lo + 1);  // strength = rank+1 (0 = sentinel)
}

// Convenience: evaluate 5-card hand
__device__ __host__ __forceinline__
int32_t evaluate5(Card c0, Card c1, Card c2, Card c3, Card c4) {
    Card cards[5] = {c0, c1, c2, c3, c4};
    return evaluate(cards, 5);
}

// Convenience: evaluate 7-card hand
__device__ __host__ __forceinline__
int32_t evaluate7(Card h0, Card h1, Card b0, Card b1, Card b2, Card b3, Card b4) {
    Card cards[7] = {h0, h1, b0, b1, b2, b3, b4};
    return evaluate(cards, 7);
}

} // namespace postflop

#endif // HAND_EVALUATOR_H
