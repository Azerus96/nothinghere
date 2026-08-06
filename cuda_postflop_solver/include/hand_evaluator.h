// ════════════════════════════════════════════════════════════════════════
// hand_evaluator.h — 7-card Texas Hold'em hand evaluator
// ════════════════════════════════════════════════════════════════════════
#ifndef HAND_EVALUATOR_H
#define HAND_EVALUATOR_H

#include <cstdint>
#include "cuda_compat.h"
#include "card.h"

namespace postflop {

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
constexpr int32_t WHEEL_BITMASK = 0b1'0000'0000'1111;  

// Таблица на CPU (в RAM)
extern const int32_t HAND_TABLE[4824];

#ifdef __CUDACC__
// Таблица на GPU (в VRAM constant memory)
extern __constant__ int32_t HAND_TABLE_DEVICE[4824];

int init_hand_table_on_gpu(const int32_t* host_table = nullptr);
#endif

__device__ __host__ __forceinline__
int host_device_clz(unsigned int x) {
#if defined(__CUDA_ARCH__)
    return __clz(x);
#else
    return x == 0 ? 32 : __builtin_clz(x);
#endif
}

__device__ __host__ __forceinline__
int host_device_popc(unsigned int x) {
#if defined(__CUDA_ARCH__)
    return __popc(x);
#else
    return __builtin_popcount(x);
#endif
}

__device__ __host__ __forceinline__
int32_t keep_n_msb(int32_t x, int n) {
    if (n <= 0 || x == 0) return 0;
    if (n >= 13) return x & 0x1FFF;  
    int32_t result = 0;
    int remaining = n;
    while (remaining > 0 && x) {
        int b = 31 - host_device_clz((unsigned int)x);
        result |= (1 << b);
        x &= ~(1 << b);
        --remaining;
    }
    return result;
}

__device__ __host__ __forceinline__
int32_t find_straight(int32_t rankset) {
    int32_t s = rankset & (rankset << 1) & (rankset << 2) & (rankset << 3) & (rankset << 4);
    if (s) return 31 - host_device_clz((unsigned int)s);
    if ((rankset & WHEEL_BITMASK) == WHEEL_BITMASK) return 3;  
    return 0;
}

struct Hand7 {
    Card cards[7];
    int  num_cards;
};

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

    int32_t rankset_of_count[5] = {0, 0, 0, 0, 0};
    for (int r = 0; r < 13; ++r) {
        int c = rank_count[r];
        rankset_of_count[c] |= (1 << r);
    }

    int flush_suit = -1;
    for (int s = 0; s < 4; ++s) {
        if (host_device_popc((unsigned int)rankset_suit[s]) >= 5) { flush_suit = s; break; }
    }

    int32_t straight_high = find_straight(rankset);

    int32_t straight_flush_high = 0;
    if (flush_suit >= 0) {
        straight_flush_high = find_straight(rankset_suit[flush_suit]);
    }
    if (straight_flush_high) {
        return (CATEGORY_STRAIGHT_FLUSH << CATEGORY_SHIFT) | straight_flush_high;
    }

    if (rankset_of_count[4]) {
        int32_t quad_rank = 31 - host_device_clz((unsigned int)rankset_of_count[4]);
        int32_t kicker = 31 - host_device_clz((unsigned int)(rankset & ~(1 << quad_rank)));
        return (CATEGORY_FOUR_OF_KIND << CATEGORY_SHIFT)
             | (quad_rank << 13) | kicker;
    }

    if (rankset_of_count[3]) {
        int32_t trips_rank = 31 - host_device_clz((unsigned int)rankset_of_count[3]);
        int32_t remaining_trips = rankset_of_count[3] & ~(1 << trips_rank);
        int32_t candidate_pairs = rankset_of_count[2] | remaining_trips;
        if (candidate_pairs) {
            int32_t pair_rank = 31 - host_device_clz((unsigned int)candidate_pairs);
            return (CATEGORY_FULL_HOUSE << CATEGORY_SHIFT)
                 | (trips_rank << 13) | pair_rank;
        }
    }

    if (flush_suit >= 0) {
        int32_t top5 = keep_n_msb(rankset_suit[flush_suit], 5);
        return (CATEGORY_FLUSH << CATEGORY_SHIFT) | top5;
    }

    if (straight_high) {
        return (CATEGORY_STRAIGHT << CATEGORY_SHIFT) | straight_high;
    }

    if (rankset_of_count[3]) {
        int32_t trips_rank = 31 - host_device_clz((unsigned int)rankset_of_count[3]);
        int32_t rest = rankset & ~(1 << trips_rank);
        int32_t top2 = keep_n_msb(rest, 2);
        return (CATEGORY_THREE_OF_KIND << CATEGORY_SHIFT)
             | (trips_rank << 13) | top2;
    }

    if (host_device_popc((unsigned int)rankset_of_count[2]) >= 2) {
        int32_t p1 = 31 - host_device_clz((unsigned int)rankset_of_count[2]);
        int32_t p2 = 31 - host_device_clz((unsigned int)(rankset_of_count[2] & ~(1 << p1)));
        int32_t pair_mask = (1 << p1) | (1 << p2);
        int32_t kicker = 31 - host_device_clz((unsigned int)(rankset & ~pair_mask));
        return (CATEGORY_TWO_PAIR << CATEGORY_SHIFT)
             | (pair_mask << 13) | kicker;
    }

    if (host_device_popc((unsigned int)rankset_of_count[2]) == 1) {
        int32_t pair_rank = 31 - host_device_clz((unsigned int)rankset_of_count[2]);
        int32_t rest = rankset & ~(1 << pair_rank);
        int32_t top3 = keep_n_msb(rest, 3);
        return (CATEGORY_ONE_PAIR << CATEGORY_SHIFT)
             | (pair_rank << 13) | top3;
    }

    int32_t top5 = keep_n_msb(rankset, 5);
    return (CATEGORY_HIGH_CARD << CATEGORY_SHIFT) | top5;
}

__device__ __host__ __forceinline__
int32_t evaluate(const Card* cards, int n) {
    int32_t key = evaluate_internal(cards, n);
    int lo = 0, hi = 4823;
    for (int i = 0; i < 13; ++i) {
        if (lo >= hi) break;
        int mid = (lo + hi) >> 1;
#if defined(__CUDA_ARCH__)
        if (HAND_TABLE_DEVICE[mid] < key) lo = mid + 1;
#else
        if (HAND_TABLE[mid] < key) lo = mid + 1;
#endif
        else hi = mid;
    }
    return (int32_t)(lo + 1);  
}

__device__ __host__ __forceinline__
int32_t evaluate5(Card c0, Card c1, Card c2, Card c3, Card c4) {
    Card cards[5] = {c0, c1, c2, c3, c4};
    return evaluate(cards, 5);
}

__device__ __host__ __forceinline__
int32_t evaluate7(Card h0, Card h1, Card b0, Card b1, Card b2, Card b3, Card b4) {
    Card cards[7] = {h0, h1, b0, b1, b2, b3, b4};
    return evaluate(cards, 7);
}

} // namespace postflop

#endif // HAND_EVALUATOR_H
