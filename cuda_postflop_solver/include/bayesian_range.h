// ════════════════════════════════════════════════════════════════════════
// bayesian_range.h — Module 3.2: Bayesian Range Belief Tracking
// ════════════════════════════════════════════════════════════════════════
// Upon transitioning to the Turn or River, opponent range weights are
// updated with Bayes' rule from the action probabilities observed on the
// previous street:
//     P(h | a) = P(h) * sigma(a | h) / sum_h' P(h') * sigma(a | h')
// ════════════════════════════════════════════════════════════════════════
#ifndef BAYESIAN_RANGE_H
#define BAYESIAN_RANGE_H

#include <vector>
#include <cstdint>

namespace postflop {

// Apply one Bayesian observation to a weight vector (in place).
//   weights[in,out]     : prior/posterior per-hand range weights
//   action_probabilities: sigma(a | h) per hand (likelihood of the observed
//                         action sequence given that hand)
//   num_hands           : length of both arrays
// Zero/negative weights stay zero (combos already excluded). The posterior
// is renormalized to the prior's total mass (or to 1 when the prior is a
// probability vector).
void apply_bayesian_observation(std::vector<float>& weights,
                                const float* action_probabilities,
                                int num_hands);

// Convenience overload for raw buffers.
void apply_bayesian_observation(float* weights,
                                const float* action_probabilities,
                                int num_hands);

// Total mass of a weight vector (diagnostics / tests).
double range_mass(const float* weights, int num_hands);

} // namespace postflop

#endif // BAYESIAN_RANGE_H
