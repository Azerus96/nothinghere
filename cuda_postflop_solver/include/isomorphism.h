// ════════════════════════════════════════════════════════════════════════
// isomorphism.h — Suit isomorphism + hand canonicalization
// ════════════════════════════════════════════════════════════════════════
// Two suits are "isomorphic" if swapping them everywhere (in ranges, board,
// and hole cards) produces an equivalent game. This is true when:
//   - Both players' ranges are symmetric under the swap
//   - The flop's rank-set is identical in both suits
//   - The turn card's rank (if dealt) matches
//   - The river card's rank (if dealt) matches
//
// Canonicalization: a 7-card hand can be "canonicalized" by remapping suits
// so the first-seen suit becomes 0, the second becomes 1, etc. This makes
// AsQh = QhAs = AdQc (all canonicalize to "rank_high, rank_low, suits 0,1").
//
// For terminal eval cache: we only need BOARD canonicalization (since
// hand-strength ranking already handles suit permutations correctly via
// the HAND_TABLE). For node-equivalence detection we need full
// (board + action-tree) isomorphism — handled by Zobrist hashing.
// ════════════════════════════════════════════════════════════════════════
#ifndef ISOMORPHISM_H
#define ISOMORPHISM_H

#include <cstdint>
#include "cuda_compat.h"
#include "card.h"

namespace postflop {

// ── Suit canonicalization ──────────────────────────────────────────────
// Remap suits in a 7-card hand so the first-seen suit becomes 0, the second
// becomes 1, etc. Returns a 64-bit canonical key (independent of original
// suit assignment).
//
// Example: AsQh, Ks2h, 7c → all canonicalize to the same key as AhQd Kd2c 7s
// (since the suit-assignment pattern is identical: 2 cards in suit 0,
// 2 cards in suit 1, 1 card in suit 2).
__device__ __host__ __forceinline__
uint64_t canonical_suit_key(Card c0, Card c1) {
    // For 2-card hand, canonical form: higher rank in slot 0, suit remapped
    int r0 = card_rank(c0), r1 = card_rank(c1);
    int s0 = card_suit(c0), s1 = card_suit(c1);
    if (r0 < r1) { int t = r0; r0 = r1; r1 = t; t = s0; s0 = s1; s1 = t; }
    // Pair: same rank, suits don't matter for canonical
    if (r0 == r1) return ((uint64_t)r0 << 32) | 0xFFFFFFFF;  // pair
    // Suited: s0 == s1
    int suited = (s0 == s1) ? 1 : 0;
    return ((uint64_t)r0 << 40) | ((uint64_t)r1 << 32) | (suited << 31);
}

// Canonical key for a 5-card board (3 flop + turn + river).
// Returns a 64-bit key independent of suit permutation.
// Uses branchless sorting networks for the small fixed-size sorts.
__device__ __host__ __forceinline__
uint64_t canonical_board_key(Card flop0, Card flop1, Card flop2, Card turn, Card river) {
    // Branchless 3-element sort (sorting network for flop0, flop1, flop2)
    Card a = flop0, b = flop1, c = flop2;
    if (a > b) { Card t = a; a = b; b = t; }
    if (b > c) { Card t = b; b = c; c = t; }
    if (a > b) { Card t = a; a = b; b = t; }

    // Build canonical key: rank set (13 bits), then per-suit rank sets (4×13 bits)
    Card all[5] = {a, b, c, turn, river};
    int suit_count[4] = {0,0,0,0};
    int suit_rankset[4] = {0,0,0,0};
    int rankset = 0;
    for (int i = 0; i < 5; ++i) {
        Card cc = all[i];
        int r = card_rank(cc), s = card_suit(cc);
        rankset |= (1 << r);
        suit_count[s]++;
        suit_rankset[s] |= (1 << r);
    }

    // Branchless 4-element sort of suits by (count desc, rankset desc).
    // Sorting network: 6 comparators for 4 elements.
    int idx[4] = {0,1,2,3};
    int cnt[4] = {suit_count[0], suit_count[1], suit_count[2], suit_count[3]};
    int rks[4] = {suit_rankset[0], suit_rankset[1], suit_rankset[2], suit_rankset[3]};
    #define SWAP_IF(i, j) do { \
        int ki=idx[i], kj=idx[j]; \
        bool less = (cnt[ki] < cnt[kj]) || \
                    (cnt[ki] == cnt[kj] && rks[ki] < rks[kj]); \
        if (less) { idx[i]=kj; idx[j]=ki; } \
    } while(0)
    SWAP_IF(0, 1); SWAP_IF(2, 3); SWAP_IF(0, 2); SWAP_IF(1, 3); SWAP_IF(1, 2);
    #undef SWAP_IF

    uint64_t key = (uint64_t)rankset;
    for (int i = 0; i < 4; ++i) {
        key = (key << 13) | (uint64_t)suit_rankset[idx[i]];
    }
    return key;
}

// ── Hand-strength sort key (for terminal eval ordering) ────────────────
// Returns a u16 strength value (1..4824) for a (hole, board) combo.
// This is what terminal evaluator uses to compare hands.
__device__ __host__ __forceinline__
uint16_t hand_strength(Card h0, Card h1, Card b0, Card b1, Card b2, Card b3, Card b4) {
    Card cards[7] = {h0, h1, b0, b1, b2, b3, b4};
    return (uint16_t)evaluate(cards, 7);
}

// ── Suit isomorphism detection between two ranges ──────────────────────
// Two suits s1, s2 are isomorphic (with respect to both ranges) iff
// swapping them produces identical range weight vectors.
// We check this by computing, for each suit pair, whether the range
// weights are invariant under s1<->s2 swap.
//
// Returns a 4-bit mask: bit s is set if suit s is "canonical" (lowest in
// its equivalence class).
__host__
inline uint8_t detect_suit_isomorphism(const float* range0, const float* range1) {
    // For each pair of suits, check if swapping them produces identical range.
    bool iso[4][4] = {{false}};
    for (int s1 = 0; s1 < 4; ++s1) iso[s1][s1] = true;
    for (int s1 = 0; s1 < 4; ++s1) {
        for (int s2 = s1+1; s2 < 4; ++s2) {
            bool same = true;
            // Iterate all 1326 hands, check invariance
            for (int c1 = 0; c1 < 52 && same; ++c1) {
                for (int c2 = c1+1; c2 < 52 && same; ++c2) {
                    int idx = card_pair_to_index((Card)c1, (Card)c2);
                    int r1 = card_rank((Card)c1), s1a = card_suit((Card)c1);
                    int r2 = card_rank((Card)c2), s2a = card_suit((Card)c2);
                    // Swap suits s1<->s2
                    int ns1 = (s1a == s1) ? s2 : (s1a == s2 ? s1 : s1a);
                    int ns2 = (s2a == s1) ? s2 : (s2a == s2 ? s1 : s2a);
                    Card nc1 = make_card(r1, ns1), nc2 = make_card(r2, ns2);
                    int nidx = card_pair_to_index(nc1, nc2);
                    if (range0[idx] != range0[nidx] || range1[idx] != range1[nidx]) {
                        same = false;
                    }
                }
            }
            iso[s1][s2] = same;
            iso[s2][s1] = same;
        }
    }
    // Canonical mask: a suit is canonical if it's the lowest in its class.
    uint8_t mask = 0;
    for (int s = 0; s < 4; ++s) {
        bool is_canonical = true;
        for (int s2 = 0; s2 < s; ++s2) {
            if (iso[s][s2]) { is_canonical = false; break; }
        }
        if (is_canonical) mask |= (1 << s);
    }
    return mask;
}

} // namespace postflop

#endif // ISOMORPHISM_H
