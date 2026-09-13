// ════════════════════════════════════════════════════════════════════════
// bayesian_range.cpp — Module 3.2 implementation
// ════════════════════════════════════════════════════════════════════════
#include "bayesian_range.h"

namespace postflop {

void apply_bayesian_observation(std::vector<float>& weights,
                                const float* action_probabilities,
                                int num_hands) {
    if ((int)weights.size() < num_hands) return;
    apply_bayesian_observation(weights.data(), action_probabilities, num_hands);
}

void apply_bayesian_observation(float* weights,
                                const float* action_probabilities,
                                int num_hands) {
    if (weights == nullptr || action_probabilities == nullptr || num_hands <= 0) return;

    double prior_mass = 0.0;
    double posterior_mass = 0.0;
    for (int i = 0; i < num_hands; ++i) {
        if (weights[i] <= 0.0f) continue;
        prior_mass += (double)weights[i];
        posterior_mass += (double)weights[i] * (double)action_probabilities[i];
    }
    // Degenerate observation (no hand explains the action): keep the prior.
    if (posterior_mass <= 1e-12 || prior_mass <= 0.0) return;

    // Renormalize the posterior to the prior's total mass so downstream
    // consumers see a probability vector of the same scale.
    double scale = prior_mass / posterior_mass;
    for (int i = 0; i < num_hands; ++i) {
        if (weights[i] <= 0.0f) continue;
        weights[i] = (float)((double)weights[i] * (double)action_probabilities[i] * scale);
    }
}

double range_mass(const float* weights, int num_hands) {
    double m = 0.0;
    for (int i = 0; i < num_hands; ++i) m += (double)weights[i];
    return m;
}

} // namespace postflop
