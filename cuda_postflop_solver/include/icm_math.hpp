// ════════════════════════════════════════════════════════════════════════
// icm_math.hpp — [Module 4, V8] Tournament ICM engine (header-only)
// ════════════════════════════════════════════════════════════════════════
// Malmuth-Harville Independent Chip Model:
//   P(player i finishes 1st) = s_i / Σ s_j
//   P(i finishes k-th) is computed recursively over the remaining-field
//   subsets — an EXACT evaluation (no Monte Carlo) for up to MAX_PLAYERS=8
//   players via subset recursion over the 2^n elimination masks.
//
// Bubble factor (risk premium):
//   BF = (ICM equity lost when losing a confrontation)
//      / (ICM equity gained when winning the same confrontation)
//   BF > 1 near bubbles (chips lost are worth more than chips won);
//   BF = 1 at the final table's chip-EV limit; BF = 2 when a lost pot
//   eliminates hero outright (capped at 2.5 in extreme scenarios).
//
// Usage: header-only, no TU to link. Consumed by live_solver (JSON-driven
// stack/payout payloads) and by the regression suite (exact hand-checkable
// values for 2- and 3-player payouts).
// ════════════════════════════════════════════════════════════════════════
#ifndef ICM_MATH_HPP
#define ICM_MATH_HPP

#include <cstdint>   // uint8_t elimination mask (missing from the original
                     // spec listing — latent defect fixed in V8: the header
                     // previously relied on transitive includes)
#include <vector>
#include <cmath>
#include <numeric>

namespace postflop::icm {

inline std::vector<double> compute_icm_payouts(const std::vector<double>& stacks,
                                              const std::vector<double>& payouts)
{
    int n = (int)stacks.size();
    int m = (int)payouts.size();
    std::vector<double> equity(n, 0.0);
    double total_chips = std::accumulate(stacks.begin(), stacks.end(), 0.0);
    if (total_chips <= 0.0) return equity;

    auto recurse = [&](auto self, int rank, uint8_t used_mask, double prob_prefix) -> void {
        if (rank >= m || used_mask == ((1 << n) - 1)) return;

        double remaining_chips = 0.0;
        for (int i = 0; i < n; ++i) {
            if (!(used_mask & (1 << i))) remaining_chips += stacks[i];
        }
        if (remaining_chips <= 0.0) return;

        for (int i = 0; i < n; ++i) {
            if (used_mask & (1 << i)) continue;
            double p_i = prob_prefix * (stacks[i] / remaining_chips);
            equity[i] += p_i * payouts[rank];
            self(self, rank + 1, used_mask | (1 << i), p_i);
        }
    };

    recurse(recurse, 0, 0, 1.0);
    return equity;
}

inline double compute_bubble_factor(const std::vector<double>& stacks,
                                    const std::vector<double>& payouts,
                                    int hero_idx, int villain_idx)
{
    double call_amount = stacks[hero_idx] < stacks[villain_idx] ? stacks[hero_idx] : stacks[villain_idx];

    auto base_eq = compute_icm_payouts(stacks, payouts);

    auto win_stacks = stacks;
    win_stacks[hero_idx] += call_amount;
    win_stacks[villain_idx] -= call_amount;
    auto win_eq = compute_icm_payouts(win_stacks, payouts);

    auto lose_stacks = stacks;
    lose_stacks[hero_idx] -= call_amount;
    lose_stacks[villain_idx] += call_amount;
    auto lose_eq = compute_icm_payouts(lose_stacks, payouts);

    double eq_gain = win_eq[hero_idx] - base_eq[hero_idx];
    double eq_loss = base_eq[hero_idx] - lose_eq[hero_idx];

    if (eq_gain <= 1e-9) return 2.5; // Cap in extreme bubble scenarios
    return eq_loss / eq_gain;
}

} // namespace postflop::icm

#endif // ICM_MATH_HPP
