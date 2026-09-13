// ════════════════════════════════════════════════════════════════════════
// node_locking.cpp — Defect 1.5 implementation
// ════════════════════════════════════════════════════════════════════════
#include "node_locking.h"
#include "solver.h"
#include <vector>
#include <algorithm>

namespace postflop {

void apply_node_locking_profile(PostFlopGame& game, int player_idx, OpponentProfile profile) {
    if (profile == OpponentProfile::GTO) return;

    auto& arena = const_cast<std::vector<PostFlopNode>&>(game.node_arena());
    float* storage1 = game.storage1_data_mut();
    float* storage2 = game.storage2_data_mut();
    int nh = game.num_private_hands(player_idx);

    for (auto& node : arena) {
        if (node.is_terminal() || node.is_chance()) continue;
        if (node.get_player() != player_idx) continue;

        int na = node.num_actions();
        if (na < 2) continue;

        // ── 1) semantic per-action probabilities ────────────────────────
        // Fixed caps per Action::Type; passive actions absorb the residual
        // mass so the distribution sums to exactly 1 for ANY action set
        // (e.g. an unopened pot node has no Fold action — its 0.10 mass
        // flows to Check, never to Bet).
        std::vector<float> strat_vals((size_t)na, 0.0f);
        double fixed_mass = 0.0;      // mass already assigned to capped actions
        int passive_count = 0;

        for (int a = 0; a < na; ++a) {
            Action::Type type = (Action::Type)node.action_type(a);
            switch (profile) {
                case OpponentProfile::CALLING_STATION:
                    if (type == Action::Type::Fold)          { strat_vals[a] = 0.10f; fixed_mass += 0.10; }
                    else if (type == Action::Type::Bet ||
                             type == Action::Type::Raise ||
                             type == Action::Type::AllIn)    { strat_vals[a] = 0.05f; fixed_mass += 0.05; }
                    else                                      { passive_count++; }   // Check / Call
                    break;
                case OpponentProfile::OVERFOLDER: {
                    bool passive = (type == Action::Type::Fold || type == Action::Type::Check ||
                                    type == Action::Type::Call);
                    if (passive) {
                        passive_count++;
                    } else {
                        strat_vals[a] = 0.0f;   // aggressive share assigned below
                    }
                    break;
                }
                case OpponentProfile::MANIAC: {
                    if (type == Action::Type::Bet || type == Action::Type::Raise ||
                        type == Action::Type::AllIn) {
                        // fixed share below
                    } else {
                        passive_count++;
                    }
                    break;
                }
                default: break;
            }
        }

        if (profile == OpponentProfile::OVERFOLDER) {
            // 85% to the passive block (Fold anchors when facing bets;
            // Check/Call anchor otherwise), 15% split over aggressive lines.
            double passive_mass = 0.85;
            if (passive_count > 0) {
                double each = passive_mass / passive_count;
                int aggressive = na - passive_count;
                double aggressive_each = (aggressive > 0) ? 0.15 / aggressive : 0.0;
                for (int a = 0; a < na; ++a) {
                    Action::Type type = (Action::Type)node.action_type(a);
                    bool passive = (type == Action::Type::Fold || type == Action::Type::Check ||
                                    type == Action::Type::Call);
                    strat_vals[a] = (float)(passive ? each : aggressive_each);
                }
            }
        } else if (profile == OpponentProfile::MANIAC) {
            // 75% split over aggressive lines, 25% over the rest.
            int aggressive = na - passive_count;
            double aggressive_each = (aggressive > 0) ? 0.75 / aggressive : 0.0;
            double passive_each = (passive_count > 0) ? 0.25 / passive_count : 0.0;
            for (int a = 0; a < na; ++a) {
                Action::Type type = (Action::Type)node.action_type(a);
                bool aggressive_type = (type == Action::Type::Bet || type == Action::Type::Raise ||
                                        type == Action::Type::AllIn);
                strat_vals[a] = (float)(aggressive_type ? aggressive_each : passive_each);
            }
        } else if (profile == OpponentProfile::CALLING_STATION) {
            // Passive actions absorb the residual (1 - fixed_mass).
            if (passive_count > 0) {
                double each = (1.0 - fixed_mass) / passive_count;
                for (int a = 0; a < na; ++a) {
                    Action::Type type = (Action::Type)node.action_type(a);
                    if (type == Action::Type::Check || type == Action::Type::Call) {
                        strat_vals[a] = (float)each;
                    }
                }
            }
        }

        // Exact renormalization guard (float rounding only).
        double sum = 0.0;
        for (float v : strat_vals) sum += v;
        if (sum > 1e-6) {
            float inv = (float)(1.0 / sum);
            for (float& v : strat_vals) v *= inv;
        } else {
            for (float& v : strat_vals) v = 1.0f / na;
        }

        // ── 2) write arenas: all-positive regrets in exactly these ratios ─
        for (int a = 0; a < na; ++a) {
            float regret_val = strat_vals[a] * 100.0f;
            for (int h = 0; h < nh; ++h) {
                int idx = node.storage1_offset + a * nh + h;
                storage1[idx] = strat_vals[a] * 100.0f;
                storage2[idx] = regret_val;
            }
        }
    }
}

std::vector<std::vector<float>> locked_strategy_at_node(const PostFlopGame& game,
                                                        int node_idx, int player_idx) {
    const PostFlopNode& node = game.node_arena()[node_idx];
    int na = node.num_actions();
    int nh = game.num_private_hands(player_idx);
    std::vector<std::vector<float>> out((size_t)na, std::vector<float>((size_t)nh, 0.0f));
    if (na == 0 || nh == 0) return out;

    std::vector<float> strategy((size_t)na * nh, 0.0f);
    const float* regrets = game.storage2_data() + node.storage2_offset;
    regret_matching(strategy.data(), regrets, na, nh);
    for (int a = 0; a < na; ++a)
        for (int h = 0; h < nh; ++h)
            out[a][h] = strategy[(size_t)a * nh + h];
    return out;
}

} // namespace postflop
