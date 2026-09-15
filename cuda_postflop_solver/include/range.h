// ════════════════════════════════════════════════════════════════════════
// range.h — Player range: 1326 f32 weights
// ════════════════════════════════════════════════════════════════════════
// Each player's range is a length-1326 vector of f32 weights, indexed by
// card_pair_to_index(c1, c2). Weight 0 = hand not in range.
//
// Parsing: accepts strings like "AA,AKs,AQo-ATo,KQs:0.5,55+,87s-54s"
//   - Pairs:    AA, KK, QQ-99, 22+
//   - Suited:   AKs, A2s+, K9s-K5s
//   - Offsuit:  AKo, A2o+, T9o-65o
//   - Compound: AhAs-QhQs (specific suits), AhKh
//   - Weights:  AKs:0.5 (50% weight)
//   - Pluses:   88+ (all pairs 88 and higher), ATs+ (ATs, AJs, AQs, AKs)
//   - Ranges:   QQ-88 (QQ through 88), A9s-A5s
//
// Internally we use Rust's exact parsing logic.
// ════════════════════════════════════════════════════════════════════════
#ifndef RANGE_H
#define RANGE_H

#include <cstdint>
#include <array>
#include <string>
#include <vector>
#include <cstring>
#include "cuda_compat.h"
#include "card.h"

namespace postflop {

class Range {
public:
    Range() : data_{} {}            // all zeros
    static Range ones() { Range r; r.data_.fill(1.0f); return r; }

    // Parse "AA, AKs, KQs-65s:0.25" style range string.
    // Throws std::invalid_argument on parse error.
    static Range from_string(const std::string& s);

    // Access raw data
    const float* raw_data() const { return data_.data(); }
    float* raw_data_mut() { return data_.data(); }
    float operator[](int idx) const { return data_[idx]; }
    float& operator[](int idx) { return data_[idx]; }

    bool is_empty() const {
        for (float v : data_) if (v != 0.0f) return false;
        return true;
    }

    // Get weight by 2-card combo
    float get_weight(Card c1, Card c2) const {
        return data_[card_pair_to_index(c1, c2)];
    }
    void set_weight(Card c1, Card c2, float w) {
        data_[card_pair_to_index(c1, c2)] = w;
    }

    // Get weight by rank-pair (averaged over all suit combos for that rank pair).
    // For pairs: avg over 6 suited-combos. For suited: avg over 4. For offsuit: avg over 12.
    float get_weight_pair(int rank) const {
        float sum = 0; int n = 0;
        for (int s1 = 0; s1 < 4; ++s1)
            for (int s2 = s1+1; s2 < 4; ++s2) {
                sum += get_weight(make_card(rank, s1), make_card(rank, s2));
                ++n;
            }
        return sum / n;
    }
    float get_weight_suited(int r1, int r2) const {
        float sum = 0;
        for (int s = 0; s < 4; ++s) sum += get_weight(make_card(r1, s), make_card(r2, s));
        return sum / 4;
    }
    float get_weight_offsuit(int r1, int r2) const {
        float sum = 0; int n = 0;
        for (int s1 = 0; s1 < 4; ++s1)
            for (int s2 = 0; s2 < 4; ++s2)
                if (s1 != s2) { sum += get_weight(make_card(r1, s1), make_card(r2, s2)); ++n; }
        return sum / n;
    }

    // Get the list of (hole_cards, weight) pairs with positive weight that
    // don't conflict with `dead_cards_mask`. Sorted lexicographically by (c1, c2).
    struct HandWeight { Card c1, c2; float weight; };
    std::vector<HandWeight> get_hands_weights(uint64_t dead_cards_mask = 0) const;

    // Two ranges are "suit isomorphic" iff swapping suits s1<->s2 leaves both invariant.
    bool is_suit_isomorphic(int s1, int s2) const;

    // Validate: all weights in [0, 1]
    bool is_valid() const {
        for (float v : data_) if (v < 0.0f || v > 1.0f) return false;
        return true;
    }

    // Compact string representation (best-effort)
    std::string to_string() const;

private:
    std::array<float, NUM_COMBOS_2> data_;

    // Helpers for parsing
    static int rank_from_char(char c) {
        switch (c) {
            case 'A': case 'a': return 12;
            case 'K': case 'k': return 11;
            case 'Q': case 'q': return 10;
            case 'J': case 'j': return 9;
            case 'T': case 't': return 8;
            case '9': return 7;
            case '8': return 6;
            case '7': return 5;
            case '6': return 4;
            case '5': return 3;
            case '4': return 2;
            case '3': return 1;
            case '2': return 0;
            default: return -1;
        }
    }
    static char char_from_rank(int r) {
        static const char* RANKS = "23456789TJQKA";
        return RANKS[r];
    }

    // Parse "AA", "AKs", "AKo", "AhKh" → list of (Card, Card) combos
    static std::vector<std::pair<Card, Card>> parse_combo(const std::string& s);

    // Parse "AA+", "AKs+", "QQ-88" → list of (Card, Card) combos
    static std::vector<std::pair<Card, Card>> expand_plus_or_range(
        const std::string& head, const std::string& tail);
};

} // namespace postflop

#endif // RANGE_H
