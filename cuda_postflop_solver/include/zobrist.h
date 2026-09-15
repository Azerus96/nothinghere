// ════════════════════════════════════════════════════════════════════════
// zobrist.h — Zobrist hashing for transposition table keys
// ════════════════════════════════════════════════════════════════════════
// 64-bit Zobrist hash for game states (board + action history).
//
// Initialize: z[card_index][slot_index] = random u64
//   - slot 0..1: player hole cards (2 cards × 2 players = 4 slots)
//   - slot 2..6: board cards (5 slots)
//   - slot 7+:   action history (Fold/Check/Call/Bet/Raise/AllIn at each node)
//
// Update: hash ^= z[card][slot]  (XOR is self-inverse)
//
// Used for transposition table keys when caching terminal node evaluations
// across iterations (same hand+board combo reaches same terminal node many
// times during CFR).
// ════════════════════════════════════════════════════════════════════════
#ifndef ZOBRIST_H
#define ZOBRIST_H

#include <cstdint>
#include <array>
#include "cuda_compat.h"
#include "card.h"

namespace postflop {

// Compile-time SplitMix64 for Zobrist key generation.
// Produces deterministic, well-distributed 64-bit values from a seed.
struct SplitMix64 {
    uint64_t state;
    __device__ __host__ __forceinline__
    SplitMix64(uint64_t s) : state(s) {}

    __device__ __host__ __forceinline__
    uint64_t next() {
        uint64_t z = (state += 0x9E3779B97F4A7C15ULL);
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
        return z ^ (z >> 31);
    }
};

// Number of slots in our Zobrist scheme.
//   0..1   : OOP hole cards (2 slots)
//   2..3   : IP hole cards (2 slots)
//   4..8   : flop (3) + turn (1) + river (1) = 5 board slots
//   9..40  : action history (32 deep — typical NLHE tree max depth)
constexpr int ZOBRIST_SLOTS = 41;

// 52 cards × 41 slots = 2,132 u64 keys = 17,056 bytes.
// Fits comfortably in __constant__ memory.
struct ZobristKeys {
    uint64_t keys[NUM_CARDS][ZOBRIST_SLOTS];
    uint64_t action_seed;  // Action history XORs use this base.
    uint64_t turn_seed;    // Boundary between streets.
};

// Global Zobrist key table (host-initialized, copied to __constant__ on GPU).
__host__
inline ZobristKeys zobrist_generate(uint64_t seed = 0xABCDEF1234567890ULL) {
    ZobristKeys z;
    SplitMix64 rng(seed);
    for (int c = 0; c < NUM_CARDS; ++c)
        for (int s = 0; s < ZOBRIST_SLOTS; ++s)
            z.keys[c][s] = rng.next();
    z.action_seed = rng.next();
    z.turn_seed   = rng.next();
    return z;
}

// Compute Zobrist hash for a (board, action_history) tuple.
// Hole cards are NOT included (they vary across combos — terminal eval cache
// is keyed by board+action only, since same board+action gives same payoff
// per combo-up-to-card-removal).
__host__ __device__ __forceinline__
uint64_t zobrist_board(
    Card flop0, Card flop1, Card flop2, Card turn, Card river,
    const ZobristKeys& z)
{
    uint64_t h = 0;
    h ^= z.keys[flop0][4];
    h ^= z.keys[flop1][5];
    h ^= z.keys[flop2][6];
    if (turn != NOT_DEALT)   h ^= z.keys[turn][7];
    if (river != NOT_DEALT)  h ^= z.keys[river][8];
    return h;
}

} // namespace postflop

#endif // ZOBRIST_H
