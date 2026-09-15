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

// ── [Module 5, V8] Dynamic HUD node-locking ──────────────────────────────
// Binds CONTINUOUS empirical action frequencies to the semantic Action::Type
// of every decision node owned by lock.player_idx. Distribution construction
// per node (mirrors the documented semantics exactly):
//   1. For each PRESENT action a with target_for(type(a)) >= 0: t_a = target.
//   2. If sum(t) > 1 (over-constrained): renormalize proportionally; all
//      unconstrained actions receive 0.
//   3. Else: residual = 1 - sum(t) flows to the passive anchor — Check when
//      present, otherwise Call (Check/Call are mutually exclusive at any
//      node: to_call == 0 -> Check, to_call > 0 -> Fold/Call). Aggressive
//      unconstrained actions (Bet/Raise/AllIn) and unconstrained Fold get 0.
//      A specified-but-ABSENT type's mass is never dropped: only actions
//      present at the node contribute their targets to sum(t), so the
//      absent mass lands in the residual by construction.
// The derived distribution is written into the strategy-sum and regret
// arenas in exactly the regret_matching-reproducible form (identical to
// apply_node_locking_profile), and the player's bit is set in the lock mask
// so both solve paths freeze it.
void apply_dynamic_node_lock(PostFlopGame& game, const DynamicActionLock& lock) {
    // No-op semantics: nothing specified, or seat outside the game.
    if (lock.player_idx < 0 || lock.player_idx >= game.num_players()) return;
    if (!lock.any_specified()) return;

    auto& arena = const_cast<std::vector<PostFlopNode>&>(game.node_arena());
    float* storage1 = game.storage1_data_mut();
    float* storage2 = game.storage2_data_mut();
    int nh = game.num_private_hands(lock.player_idx);

    for (auto& node : arena) {
        if (node.is_terminal() || node.is_chance()) continue;
        if (node.get_player() != lock.player_idx) continue;

        int na = node.num_actions();
        if (na < 1) continue;

        // ── 1) semantic per-action targets over PRESENT actions ─────────
        std::vector<float> strat_vals((size_t)na, 0.0f);
        double target_sum = 0.0;
        int passive_anchor = -1;    // Check preferred, else Call
        for (int a = 0; a < na; ++a) {
            Action::Type type = (Action::Type)node.action_type(a);
            if (type == Action::Type::Check) passive_anchor = a;
            else if (type == Action::Type::Call && passive_anchor < 0) passive_anchor = a;

            float t = lock.target_for((uint8_t)type);
            if (t >= 0.0f) {
                strat_vals[a] = t;
                target_sum += (double)t;
            }
        }

        if (target_sum > 1.0 + 1e-9) {
            // ── 2) over-constrained: proportional renormalization ───────
            double inv = 1.0 / target_sum;
            for (float& v : strat_vals) v = (float)(v * inv);
        } else {
            // ── 3) passive residual absorption ──────────────────────────
            // Absent specified types contributed nothing to target_sum, so
            // their mass is part of the residual by construction.
            if (passive_anchor >= 0) {
                double residual = 1.0 - target_sum;
                strat_vals[passive_anchor] =
                    (float)((double)strat_vals[passive_anchor] + residual);
            } else if (target_sum > 1e-9) {
                // Defensive: no passive anchor exists (not reachable in
                // valid trees — Fold implies Call is available). Distribute
                // the residual uniformly to keep the distribution a proper
                // probability vector.
                double each = (1.0 - target_sum) / na;
                for (float& v : strat_vals) v = (float)((double)v + each);
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

        // ── 4) write arenas: all-positive regrets in exactly these ratios ─
        for (int a = 0; a < na; ++a) {
            float regret_val = strat_vals[a] * 100.0f;
            for (int h = 0; h < nh; ++h) {
                int idx = node.storage1_offset + a * nh + h;
                storage1[idx] = strat_vals[a] * 100.0f;
                storage2[idx] = regret_val;
            }
        }
    }

    // Freeze the locked strategy on both solve paths.
    game.set_locked_players_mask(game.locked_players_mask() |
                                 (uint8_t)(1u << lock.player_idx));
}

} // namespace postflop
