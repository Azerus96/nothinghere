// ════════════════════════════════════════════════════════════════════════
// card.h — Card representation, encoding, deck manipulation
// ════════════════════════════════════════════════════════════════════════
// 52-card deck encoded as u8 (0..51):
//   card = rank * 4 + suit
//   rank: 2=>0, 3=>1, ..., K=>11, A=>12
//   suit: club=>0, diamond=>1, heart=>2, spade=>3
//
// Bitboard encoding (u64): bit (rank*4 + suit) set if card is in hand.
// Two-hole-card hand: 2 bits set. Board: 3, 4, or 5 bits set.
// Full 7-card hand: 7 bits set, unique 64-bit identifier.
//
// Card pair index (1326 unique combos):
//   sort so c1 < c2, then index = c1*(101-c1)/2 + (c2-1)
//   range [0, 1326), inverse via closed-form.
// ════════════════════════════════════════════════════════════════════════
#ifndef CARD_H
#define CARD_H

#include <cstdint>
#include <array>
#include <string>
#include <algorithm>
#include "cuda_compat.h"

namespace postflop {

// ── Constants ───────────────────────────────────────────────────────────
constexpr int NUM_CARDS      = 52;
constexpr int NUM_RANKS      = 13;
constexpr int NUM_SUITS      = 4;
constexpr int NUM_COMBOS_2   = 1326;      // C(52,2) = 1326

constexpr uint8_t NOT_DEALT  = 255;       // Card sentinel

// Card = rank * 4 + suit
// rank: 2=0, 3=1, ..., K=11, A=12
// suit: c=0, d=1, h=2, s=3
using Card = uint8_t;

__device__ __host__ __forceinline__
int card_rank(Card c) { return c >> 2; }            // 0..12

__device__ __host__ __forceinline__
int card_suit(Card c) { return c & 3; }             // 0..3

__device__ __host__ __forceinline__
Card make_card(int rank, int suit) { return (Card)((rank << 2) | (suit & 3)); }

// Bitboard helpers
__device__ __host__ __forceinline__
uint64_t card_to_bit(Card c) { return 1ULL << c; }

__device__ __host__ __forceinline__
uint64_t cards_to_bitmask(Card c0, Card c1) {
    return card_to_bit(c0) | card_to_bit(c1);
}

__device__ __host__ __forceinline__
uint64_t cards_to_bitmask(Card c0, Card c1, Card c2) {
    return card_to_bit(c0) | card_to_bit(c1) | card_to_bit(c2);
}

__device__ __host__ __forceinline__
uint64_t cards_to_bitmask(Card c0, Card c1, Card c2, Card c3, Card c4) {
    return card_to_bit(c0) | card_to_bit(c1) | card_to_bit(c2)
         | card_to_bit(c3) | card_to_bit(c4);
}

// ── Card pair indexing (1326 unique 2-card hands) ──────────────────────
// Sort so c1 < c2, then index = c1*(101-c1)/2 + (c2-1), range [0, 1326)
__device__ __host__ __forceinline__
int card_pair_to_index(Card c1, Card c2) {
    if (c1 > c2) { Card t = c1; c1 = c2; c2 = t; }
    return (int)c1 * (101 - (int)c1) / 2 + ((int)c2 - 1);
}

// Inverse: index → (c1, c2).  c1 = (103 - ceil(sqrt(103²-8·idx)))/2
// Uses integer Newton-Raphson sqrt (no floating-point).
__device__ __host__ __forceinline__
int isqrt_u64(uint64_t n) {
    if (n == 0) return 0;
    uint64_t x = n;
    uint64_t y = (x + 1) / 2;
    while (y < x) { x = y; y = (x + n / x) / 2; }
    return (int)x;
}

__device__ __host__ __forceinline__
std::pair<Card, Card> index_to_card_pair(int index) {
    // Solve c1*(101-c1)/2 = idx for c1, take largest c1 such that c1*(101-c1)/2 <= idx
    // Use ceil(integer_sqrt(103² - 8·idx))
    int s = 103 * 103 - 8 * index;        // 10609 - 8*idx, s ∈ [449, 10609]
    int isq = isqrt_u64((uint64_t)s);
    if (isq * isq < s) ++isq;              // ceil
    int c1 = (103 - isq) / 2;
    if (c1 < 0) c1 = 0;
    int base = c1 * (101 - c1) / 2;
    int c2 = index - base + 1;
    if (c2 < 0) c2 = 0;
    return { (Card)c1, (Card)c2 };
}

// ── String conversion ──────────────────────────────────────────────────
__host__ inline std::string card_to_string(Card c) {
    if (c == NOT_DEALT) return "-";
    static const char* RANKS = "23456789TJQKA";
    static const char* SUITS = "cdhs";
    return std::string(1, RANKS[card_rank(c)]) + std::string(1, SUITS[card_suit(c)]);
}

__host__ inline Card card_from_string(const std::string& s) {
    if (s.empty() || s == "-") return NOT_DEALT;
    char r = std::toupper(s[0]);
    char su = std::tolower(s[1]);
    static const char* RANKS = "23456789TJQKA";
    static const char* SUITS = "cdhs";
    const char* rp = std::strchr(RANKS, r);
    const char* sp = std::strchr(SUITS, su);
    if (!rp || !sp) return NOT_DEALT;
    return make_card((int)(rp - RANKS), (int)(sp - SUITS));
}

// ── Full deck ──────────────────────────────────────────────────────────
__host__ inline std::array<Card, 52> full_deck() {
    std::array<Card, 52> d{};
    for (int i = 0; i < 52; ++i) d[i] = (Card)i;
    return d;
}

} // namespace postflop

#endif // CARD_H
