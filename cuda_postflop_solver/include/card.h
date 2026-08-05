// ════════════════════════════════════════════════════════════════════════
// card.h — Card representation, encoding, deck manipulation
// ════════════════════════════════════════════════════════════════════════
#ifndef CARD_H
#define CARD_H

#include <cstdint>
#include <array>
#include <string>
#include <algorithm>
#include <cstring>
#include <cctype>
#include "cuda_compat.h"

namespace postflop {

constexpr int NUM_CARDS      = 52;
constexpr int NUM_RANKS      = 13;
constexpr int NUM_SUITS      = 4;
constexpr int NUM_COMBOS_2   = 1326;      
constexpr uint8_t NOT_DEALT  = 255;       

using Card = uint8_t;

__device__ __host__ __forceinline__
int card_rank(Card c) { return c >> 2; }            

__device__ __host__ __forceinline__
int card_suit(Card c) { return c & 3; }             

__device__ __host__ __forceinline__
Card make_card(int rank, int suit) { return (Card)((rank << 2) | (suit & 3)); }

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

__device__ __host__ __forceinline__
int card_pair_to_index(Card c1, Card c2) {
    if (c1 > c2) { Card t = c1; c1 = c2; c2 = t; }
    return (int)c1 * (101 - (int)c1) / 2 + ((int)c2 - 1);
}

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
    int s = 103 * 103 - 8 * index;        
    int isq = isqrt_u64((uint64_t)s);
    if (isq * isq < s) ++isq;              
    int c1 = (103 - isq) / 2;
    if (c1 < 0) c1 = 0;
    int base = c1 * (101 - c1) / 2;
    int c2 = index - base + 1;
    if (c2 < 0) c2 = 0;
    return { (Card)c1, (Card)c2 };
}

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
    const char* rp = strchr(RANKS, r);
    const char* sp = strchr(SUITS, su);
    if (!rp || !sp) return NOT_DEALT;
    return make_card((int)(rp - RANKS), (int)(sp - SUITS));
}

__host__ inline std::array<Card, 52> full_deck() {
    std::array<Card, 52> d{};
    for (int i = 0; i < 52; ++i) d[i] = (Card)i;
    return d;
}

} // namespace postflop

#endif // CARD_H
