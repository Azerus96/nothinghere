// ════════════════════════════════════════════════════════════════════════
// bet_translation.h — Module 3.3: Pseudo-Harmonic Action Translation
// ════════════════════════════════════════════════════════════════════════
// Handles arbitrary off-grid bet sizes observed in live games:
//     d(x, y) = 2|x - y| / (x + y)
// If the distance between the observed size and the nearest configured grid
// size exceeds 0.15, the exact observed size is flagged for injection into
// the action tree (local expansion, TreeConfig::custom_injected_bets).
// ════════════════════════════════════════════════════════════════════════
#ifndef BET_TRANSLATION_H
#define BET_TRANSLATION_H

#include <vector>
#include <cstdint>
#include <cmath>

namespace postflop {

// Pseudo-harmonic distance, per the specification. Degenerate inputs are
// handled deterministically: sum <= 0 yields 0 for equal inputs and 2.0
// (maximal distance) otherwise.
inline double pseudo_harmonic_distance(double left, double right) noexcept {
    const auto sum = left + right;
    if (sum <= 0.0) return (left == right ? 0.0 : 2.0);
    return 2.0 * std::fabs(left - right) / sum;
}

// Significance threshold for off-grid deviations (spec: 0.15).
constexpr double PSEUDO_HARMONIC_THRESHOLD = 0.15;

// Given an observed bet size (as a fraction of pot, in [0,1]-ish scale)
// and the configured grid (fractions of pot), decide whether the observed
// size deviates enough to require local tree expansion.
inline bool needs_local_expansion(double observed_pct, double nearest_grid_pct) noexcept {
    return pseudo_harmonic_distance(observed_pct, nearest_grid_pct) > PSEUDO_HARMONIC_THRESHOLD;
}

// Nearest grid point (fractions of pot) to an observed size.
inline double nearest_grid_point(double observed_pct, const std::vector<double>& grid) noexcept {
    double best = 0.0, best_d = 1e30;
    for (double g : grid) {
        double d = pseudo_harmonic_distance(observed_pct, g);
        if (d < best_d) { best_d = d; best = g; }
    }
    return best;
}

// Convert an observed chip bet into the exact injected size for the tree:
// returns the chip amount when the deviation from `grid` (fractions of pot)
// exceeds the threshold, or -1 when the nearest grid point is close enough.
inline int32_t translate_observed_bet(int32_t observed_chips, int32_t pot_chips,
                                      const std::vector<double>& grid_fractions) {
    if (pot_chips <= 0 || observed_chips <= 0) return -1;
    double obs_pct = (double)observed_chips / (double)pot_chips;
    double near_pct = nearest_grid_point(obs_pct, grid_fractions);
    if (!needs_local_expansion(obs_pct, near_pct)) return -1;
    return observed_chips;
}

} // namespace postflop

#endif // BET_TRANSLATION_H
