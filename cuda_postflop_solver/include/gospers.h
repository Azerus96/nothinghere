// ════════════════════════════════════════════════════════════════════════
// gospers.h — Gosper's hack for enumerating k-bit subsets of an n-bit word
// ════════════════════════════════════════════════════════════════════════
// Used to enumerate all C(13, k) rank subsets (e.g. for hand category
// enumeration, straight detection, kicker selection).
//
// Gosper's hack: given a u64 with k bits set, produces the next-larger
// integer with the same number of set bits.
//
//   unsigned int v;            // current value with k bits set
//   unsigned int t = v | (v - 1);
//   unsigned int w = (t + 1) | (((~t & -~t) - 1) >> (__builtin_ctz(v) + 1));
//   v = w;
// ════════════════════════════════════════════════════════════════════════
#ifndef GOSPERS_H
#define GOSPERS_H

#include <cstdint>
#include "cuda_compat.h"

namespace postflop {

// Compute the next k-bit subset of a u64 (Gosper's hack, 64-bit version).
// Returns false if `v` is the largest such subset (no successor).
__device__ __host__ __forceinline__
bool gospers_next(uint64_t& v) {
    uint64_t t = v | (v - 1);
    uint64_t next = (t + 1)
                  | (((~t & -~t) - 1) >> (__ffsll(v) ));
    if (next <= v) return false;
    v = next;
    return true;
}

// Initial k-bit subset: lowest k bits set.
__device__ __host__ __forceinline__
uint64_t gospers_first(int k) {
    return (k >= 64) ? ~0ULL : ((1ULL << k) - 1);
}

// Enumerate all k-bit subsets of an n-bit mask (typically n=13 for ranks).
// Calls `op` for each subset. Returns count.
template <typename OP>
__host__
int enumerate_k_subsets(int n, int k, OP op) {
    if (k <= 0 || k > n) return 0;
    uint64_t full = (n >= 64) ? ~0ULL : ((1ULL << n) - 1);
    uint64_t v = gospers_first(k);
    int count = 0;
    while (true) {
        if ((v & ~full) == 0) {
            op(v);
            ++count;
        }
        if (!gospers_next(v)) break;
        if (v > full) break;
    }
    return count;
}

// Number of combinations C(n, k).
__host__
inline long long binomial(int n, int k) {
    if (k < 0 || k > n) return 0;
    if (k > n - k) k = n - k;
    long long r = 1;
    for (int i = 0; i < k; ++i) {
        r = r * (n - i) / (i + 1);
    }
    return r;
}

} // namespace postflop

#endif // GOSPERS_H
