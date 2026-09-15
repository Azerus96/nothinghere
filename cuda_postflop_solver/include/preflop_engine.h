// ════════════════════════════════════════════════════════════════════════
// preflop_engine.h — Module 3.1: Preflop 169x169x3 RVR Push/Fold Engine
// ════════════════════════════════════════════════════════════════════════
// When effective stacks are <= 12 BB, postflop game trees are bypassed: the
// optimal preflop decision is an O(1) lookup into a precomputed binary
// matrix (preflop_table.bin, 685 KB, 169*169*3 doubles).
//
// Class layout (169 buckets, EXACT bijection onto [0..168]):
//   [0..12]   pairs        22 -> 0, 33 -> 1, ..., AA -> 12
//   [13..90]  suited       13 + triangular_index
//   [91..168] offsuit      91 + triangular_index
// Suit variants (3rd dimension): 0/1/2 shared suits between the two hands.
//
// SCRUTINY NOTE: the specification's formulas contain two defects:
//   1. the triangular index pair_idx = a*12 - a*(a-1)/2 + (b-a-1) collides
//      (e.g. A3s and KQs both map to 33) and overflows for 32o (offsuit
//      index 169 > 168);
//   2. the pair mapping 14 - rank places 22 at class 14, colliding with
//      the suited block [13..90] (KQs).
// The corrected bijection used here:
//     pairs    : 12 - rank                       -> [0..12]
//     non-pairs: pair_idx = (a-2)*(27-a)/2 + (b-a-1),  a in [2,13], b in [a+1,14]
//                suited 13 + pair_idx, offsuit 91 + pair_idx
// is verified to be a full bijection onto [0,168] (regression-tested).
// ════════════════════════════════════════════════════════════════════════
#ifndef PREFLOP_ENGINE_H
#define PREFLOP_ENGINE_H

#include <cstdint>
#include <string>
#include <vector>
#include <array>
#include "card.h"

namespace postflop::preflop {

constexpr std::size_t NUM_CLASSES = 169;
constexpr std::size_t NUM_SUIT_VARIANTS = 3;
constexpr std::size_t EQUITY_TABLE_SIZE = NUM_CLASSES * NUM_CLASSES * NUM_SUIT_VARIANTS;

// Map two ranks + suited flag to a combo class ID in [0, 168].
inline std::uint16_t class_index(std::uint8_t rank_hi, std::uint8_t rank_lo, bool suited) {
    if (rank_hi < rank_lo) std::swap(rank_hi, rank_lo);
    if (rank_hi == rank_lo) return static_cast<std::uint16_t>(12 - rank_hi);   // pairs: 0..12
    const auto a = 14 - std::max(rank_hi, rank_lo);
    const auto b = 14 - std::min(rank_hi, rank_lo);
    const std::size_t pair_idx = (std::size_t)(a - 2) * (27 - a) / 2 + (std::size_t)(b - a - 1);
    return static_cast<std::uint16_t>((suited ? 13 : 91) + pair_idx);
}

// Classify shared suit overlap (0, 1, or 2 shared suits) between two 2-card
// hands, per the specification.
std::size_t classify_suit_variant(const std::pair<Card, Card>& hero,
                                  const std::pair<Card, Card>& villain);

// ── Equity table ────────────────────────────────────────────────────────
// Binary format (little endian):
//   magic    : 4 bytes  "PFTB"
//   version  : uint32   = 1
//   classes  : uint32   = 169
//   variants : uint32   = 3
//   dtype    : uint32   = 8 (double)
//   data     : 169*169*3 doubles (row-major: [hero][villain][variant])
// Entries for impossible suit variants are stored as the nearest achievable
// variant (documented); queries with such card pairs are clamped.

struct PreflopEquityTable {
    std::vector<double> data;   // EQUITY_TABLE_SIZE doubles
    bool loaded = false;

    // Loads the table from `path`; returns false if missing/corrupt.
    bool load(const std::string& path);

    // Saves the table (generator side).
    bool save(const std::string& path) const;

    // O(1) equity lookup: probability hero wins + half ties, all-in preflop.
    double equity(std::uint16_t hero_class, std::uint16_t villain_class,
                  std::size_t suit_variant) const {
        if (hero_class >= NUM_CLASSES || villain_class >= NUM_CLASSES) return 0.5;
        if (suit_variant >= NUM_SUIT_VARIANTS) suit_variant = NUM_SUIT_VARIANTS - 1;
        return data[(hero_class * NUM_CLASSES + villain_class) * NUM_SUIT_VARIANTS + suit_variant];
    }

    // Convenience: equity from concrete cards.
    double equity_cards(const std::pair<Card, Card>& hero,
                        const std::pair<Card, Card>& villain) const {
        int hr1 = card_rank(hero.first), hr2 = card_rank(hero.second);
        int vr1 = card_rank(villain.first), vr2 = card_rank(villain.second);
        bool hero_suited = card_suit(hero.first) == card_suit(hero.second);
        bool villain_suited = card_suit(villain.first) == card_suit(villain.second);
        std::uint16_t hc = class_index((uint8_t)std::max(hr1, hr2), (uint8_t)std::min(hr1, hr2), hero_suited);
        std::uint16_t vc = class_index((uint8_t)std::max(vr1, vr2), (uint8_t)std::min(vr1, vr2), villain_suited);
        std::size_t variant = classify_suit_variant(hero, villain);
        return equity(hc, vc, variant);
    }

    bool is_loaded() const { return loaded; }
};

// Global table instance (loaded once by live_solver / tests).
PreflopEquityTable& global_preflop_table();

// Search order for the table file: $POSTFLOP_TABLE_PATH, then exe dir,
// then ./preflop_table.bin.
std::string default_table_path();

// ── [Module 3, V8] 3-way preflop tensor (169^3 x 3 floats) ───────────────
// Exact HU equities answer 2-player questions; 3-way all-in spots (the
// critical MTT confrontation: hero vs two live opponents) need a separate
// tensor of per-player win probabilities:
//     data[(c0 * 169 + c1) * 169 + c2] * 3 + player_idx
// The full artifact is ~57.9 MB (4,826,809 triplet cells x 3 floats) —
// generated ONCE on the staging GPU cluster by tools/gen_preflop_3way
// (deterministic 5000-sample Monte Carlo per cell; exact enumeration would
// cost ~8.26e13 operations) and shipped alongside the solver. O(1) queries,
// sub-millisecond, with graceful 1/3 fallbacks for out-of-range inputs.
//
// Binary format (little endian, "P3TB"):
//   magic    : 4 bytes
//   version  : uint32 = 1
//   classes  : uint32 = 169
//   players  : uint32 = 3
//   dtype    : uint32 = 4 (float)
//   data     : 169*169*169*3 floats
constexpr std::size_t TENSOR_3WAY_FLOATS =
    NUM_CLASSES * NUM_CLASSES * NUM_CLASSES * 3;

// [Module 3, V8] tensor shape constants (generator + loader vocabulary).
constexpr std::size_t NUM_3WAY_TRIPLETS =
    NUM_CLASSES * NUM_CLASSES * NUM_CLASSES;   // 4,826,809 triplet cells
constexpr std::size_t NUM_3WAY_PLAYERS = 3;

struct Preflop3WayEquityTable {
    std::vector<float> data;   // TENSOR_3WAY_FLOATS floats
    bool loaded = false;

    // Loads the tensor from `path`; returns false if missing/corrupt.
    bool load(const std::string& path);

    // Saves the tensor (generator side).
    bool save(const std::string& path) const;

    // O(1) equity lookup for player_idx (0/1/2) of the (c0,c1,c2) triplet.
    // Out-of-range classes or player indices fall back to the uniform 1/3.
    float equity(std::uint16_t c0, std::uint16_t c1, std::uint16_t c2,
                 int player_idx) const {
        if (c0 >= NUM_CLASSES || c1 >= NUM_CLASSES || c2 >= NUM_CLASSES) return 1.0f / 3.0f;
        if (player_idx < 0 || player_idx > 2) return 1.0f / 3.0f;
        size_t base = ((size_t)c0 * NUM_CLASSES + c1) * NUM_CLASSES + c2;
        return data[base * 3 + (size_t)player_idx];
    }

    // Convenience: equity for player_idx from concrete card pairs (ranks +
    // suitedness classify each hand into its 169-class; suit interplay is
    // absorbed by the class abstraction — the representative-combo error is
    // bounded by the documented MC standard error of the generator).
    float equity_cards_3way(const std::pair<Card, Card>& h0,
                            const std::pair<Card, Card>& h1,
                            const std::pair<Card, Card>& h2,
                            int player_idx) const;

    bool is_loaded() const { return loaded; }
};

// Global 3-way tensor instance (loaded once by live_solver / tests; queries
// before load() return the uniform 1/3 fallback).
Preflop3WayEquityTable& global_preflop_3way_table();

// Search order for the tensor file: $POSTFLOP_3WAY_PATH, then
// ./preflop_3way.bin.
std::string default_3way_table_path();

// ── Push/Fold decision (<= 12 BB) ───────────────────────────────────────
// Facing an all-in shove of `to_call` chips into `pot_before` chips with an
// effective stack of `stack_bb` big blinds: CALL iff equity >= required.
struct PushFoldDecision {
    bool     should_call;    // true -> call the shove
    double   equity;         // hero's all-in equity vs villain range class
    double   required;       // break-even equity for the call
    double   ev_call;        // EV of calling in chips (net)
};

PushFoldDecision push_fold_call_decision(const std::pair<Card, Card>& hero,
                                         const std::pair<Card, Card>& villain_range_rep,
                                         int32_t pot_before, int32_t to_call);

// Shove/fold recommendation for an unopened pot at <= 12 BB (RVR chart
// heuristic driven by the equity matrix against a calling-range blend).
bool should_shove(const std::pair<Card, Card>& hero, double stack_bb,
                  double open_threshold_equity = 0.52);

} // namespace postflop::preflop

#endif // PREFLOP_ENGINE_H
