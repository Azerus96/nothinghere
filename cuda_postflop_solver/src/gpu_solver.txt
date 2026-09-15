// ════════════════════════════════════════════════════════════════════════
// gpu_solver.cu — GPU solver pipeline (dual-build: nvcc OR g++ CPU_ONLY=1)
// ════════════════════════════════════════════════════════════════════════
// Modernized per Master Technical Specification:
//   Defect 1.1  net zero-sum terminal utilities (invested subtraction)
//   Defect 1.3  negative regret retention in the up-pass update
//   Defect 1.4  per-iteration bulk cudaMemset on d_all_reaches REMOVED;
//               only the root reach row is re-seeded per updating player
//   Defect 1.9  pure FP32 arenas (is_compressed == false on 2x T4)
//   Module 3.4  kernel_rollout_showdown_leaf for multiway depth-1 leaves
//
// This translation unit compiles BOTH under nvcc (-DUSE_CUDA=ON, sm_75) and
// under plain g++ -std=c++20 -DCPU_ONLY=1 through include/cuda_compat.h,
// which emulates the CUDA thread/block/grid hierarchy deterministically.
// Kernel launches MUST use the KERNEL_LAUNCH / KERNEL_LAUNCH_SM macros.
// ════════════════════════════════════════════════════════════════════════
#include "gpu_solver.h"
#include "solver.h"
#include "hand_evaluator.h"
#include <cstdio>
#include <cmath>
#include <vector>

namespace postflop {

#define MAX_HANDS 1326

#define CUDA_CHECK(call)                                                          \
    do {                                                                          \
        cudaError_t _err = (call);                                                \
        if (_err != cudaSuccess) {                                                \
            fprintf(stderr, "[CUDA ERROR] %s:%d: %s -> %s\n",                     \
                    __FILE__, __LINE__, #call, cudaGetErrorString(_err));         \
        }                                                                         \
    } while (0)

// ── Down pass: propagate counterfactual reaches root→leaves ─────────────
template <int NUM_PLAYERS>
__global__
void kernel_down_pass(
    const int* __restrict__ d_nodes_at_depth,
    int num_nodes_this_depth,
    const PostFlopNode* __restrict__ d_nodes,
    const uint8_t* __restrict__ d_storage2,
    float* __restrict__ d_all_reaches,
    const int* __restrict__ d_num_hands,
    int updating_player,
    bool is_compressed,
    int total_num_nodes)
{
    int idx = blockIdx.x;
    if (idx >= num_nodes_this_depth) return;

    int node_idx = d_nodes_at_depth[idx];
    const PostFlopNode& node = d_nodes[node_idx];
    if (node.is_terminal()) return;

    int node_player = node.player & PLAYER_MASK;
    int num_actions = node.num_children;
    int tid = threadIdx.x;

    for (int p = 0; p < NUM_PLAYERS; ++p) {
        int hands_p = d_num_hands[p];
        float* p_reach_in = &d_all_reaches[p * (total_num_nodes * MAX_HANDS) + node_idx * MAX_HANDS];

        for (int h = tid; h < hands_p; h += blockDim.x) {
            float my_reach = p_reach_in[h];

            if (node.is_chance()) {
                // Chance scaling: exactly 1/num_children outcomes (49 turn
                // runouts / 48 river runouts / 1 known card).
                float scale = (num_actions > 0) ? (1.0f / (float)num_actions) : 1.0f;
                float scaled = my_reach * scale;
                for (int a = 0; a < num_actions; ++a) {
                    d_all_reaches[p * (total_num_nodes * MAX_HANDS) + (node.children_offset + a) * MAX_HANDS + h] = scaled;
                }
            } else if (node_player == p) {
                float sum_pos = 0.0f;
                float s2 = node.scale2; if (s2 == 0.0f) s2 = 1.0f;
                float decode_mult = is_compressed ? (s2 / 32767.0f) : 1.0f;

                for (int a = 0; a < num_actions; ++a) {
                    int mem_idx = node.storage2_offset + a * hands_p + h;
                    float r = is_compressed ? (float)((const int16_t*)d_storage2)[mem_idx] * decode_mult
                                            : ((const float*)d_storage2)[mem_idx];
                    if (r > 0.0f) sum_pos += r;   // [Defect 1.3] positive part HERE only
                }

                float inv = (sum_pos > 1e-7f) ? (1.0f / sum_pos) : 0.0f;
                float uniform = 1.0f / num_actions;

                for (int a = 0; a < num_actions; ++a) {
                    int mem_idx = node.storage2_offset + a * hands_p + h;
                    float r = is_compressed ? (float)((const int16_t*)d_storage2)[mem_idx] * decode_mult
                                            : ((const float*)d_storage2)[mem_idx];
                    float strat_val = (sum_pos > 1e-7f) ? ((r > 0.0f) ? (r / sum_pos) : 0.0f) : uniform;
                    d_all_reaches[p * (total_num_nodes * MAX_HANDS) + (node.children_offset + a) * MAX_HANDS + h] = my_reach * strat_val;
                }
            } else {
                for (int a = 0; a < num_actions; ++a) {
                    d_all_reaches[p * (total_num_nodes * MAX_HANDS) + (node.children_offset + a) * MAX_HANDS + h] = my_reach;
                }
            }
        }
    }
}

// ── Terminal fold: Defect 1.1 net utilities ─────────────────────────────
// Direct per-hand compatible-reach loops (mask semantics) — numerically
// IDENTICAL to the CPU inclusion-exclusion (sum + same - minus[c1] -
// minus[c2]): for each hero hand we sum the opponent reach of hands that
// share no card with hero. The identical-card combo is thereby excluded
// exactly once (no double subtraction), matching the CPU evaluator.
template <int NUM_PLAYERS>
__global__
void kernel_terminal_fold(
    const int* __restrict__ d_fold_nodes, int num_nodes,
    const PostFlopNode* __restrict__ d_nodes,
    const float* __restrict__ d_all_reaches, float* __restrict__ d_node_cfv,
    Card** d_private_cards,
    const int* __restrict__ d_num_hands,
    int updating_player,
    int total_num_nodes)
{
    int idx = blockIdx.x;
    if (idx >= num_nodes) return;
    int node_idx = d_fold_nodes[idx];
    const PostFlopNode& node = d_nodes[node_idx];

    int folded_player = node.player & PLAYER_MASK;
    int tid = threadIdx.x;
    int my_hands = d_num_hands[updating_player];

    bool am_i_active = (node.active_mask & (1 << updating_player)) != 0;

    // [Defect 1.1] EV(Fold) = -Invested_player * CompatReach; covers the
    // player folding at THIS node and players who folded earlier (locked
    // utility). EV(Win-by-fold) = (Pot - Invested) * CompatReach.
    double inv_me = (double)node.invested[updating_player];
    // [Defect 1.8] node.amount is the exact total pot.
    double pot = (double)node.amount;
    double net_win = pot - inv_me;
    bool i_am_winner = am_i_active && (updating_player != folded_player);

    for (int h = tid; h < my_hands; h += blockDim.x) {
        Card c1 = d_private_cards[updating_player][h * 2];
        Card c2 = d_private_cards[updating_player][h * 2 + 1];

        double compat = 1.0;
        for (int p = 0; p < NUM_PLAYERS; ++p) {
            if (p == updating_player) continue;
            const float* cfreach = &d_all_reaches[p * (total_num_nodes * MAX_HANDS) + node_idx * MAX_HANDS];
            int nh = d_num_hands[p];
            double compat_p = 0.0;
            for (int j = 0; j < nh; ++j) {
                float w = cfreach[j];
                if (w == 0.0f) continue;
                Card oc1 = d_private_cards[p][j * 2];
                Card oc2 = d_private_cards[p][j * 2 + 1];
                if (oc1 == c1 || oc1 == c2 || oc2 == c1 || oc2 == c2) continue;
                compat_p += w;
            }
            compat *= compat_p;
        }
        d_node_cfv[node_idx * MAX_HANDS + h] =
            (float)(i_am_winner ? (net_win * compat) : (-inv_me * compat));
    }
}

// ── Terminal showdown: Defect 1.1 net utilities + blockers ──────────────
template <int NUM_PLAYERS>
__global__
void kernel_terminal_showdown(
    const int* __restrict__ d_showdown_nodes, int num_nodes,
    const PostFlopNode* __restrict__ d_nodes,
    const float* __restrict__ d_all_reaches, float* __restrict__ d_node_cfv,
    Card** d_private_cards,
    const int* __restrict__ d_num_hands,
    Card flop0, Card flop1, Card flop2,
    int total_num_nodes, int updating_player,
    float rake_rate, float rake_cap)
{
    int idx = blockIdx.x;
    if (idx >= num_nodes) return;
    int node_idx = d_showdown_nodes[idx];
    const PostFlopNode& node = d_nodes[node_idx];

    Card turn = node.turn;
    Card river = node.river;
    int tid = threadIdx.x;
    int my_hands = d_num_hands[updating_player];

    // [Defect 1.8] node.amount is the exact total pot.
    double pot = (double)node.amount;
    double rake = pot * (double)rake_rate;
    if (rake > (double)rake_cap) rake = (double)rake_cap;
    double pot_eff = pot - rake;

    bool am_i_active = (node.active_mask & (1 << updating_player)) != 0;

    __shared__ uint16_t s_opp_str[6][MAX_HANDS];
    for (int p = 0; p < NUM_PLAYERS; ++p) {
        if (p == updating_player) continue;
        if ((node.active_mask & (1 << p)) != 0) {
            for (int oh = tid; oh < d_num_hands[p]; oh += blockDim.x) {
                Card oc1 = d_private_cards[p][oh*2];
                Card oc2 = d_private_cards[p][oh*2+1];
                Card ocards[7] = {oc1, oc2, flop0, flop1, flop2, turn, river};
                s_opp_str[p][oh] = (uint16_t)evaluate(ocards, 7);
            }
        }
    }
    __syncthreads();

    double inv_me = (double)node.invested[updating_player];

    for (int h = tid; h < my_hands; h += blockDim.x) {
        Card c1 = d_private_cards[updating_player][h*2];
        Card c2 = d_private_cards[updating_player][h*2+1];
        Card mcards[7] = {c1, c2, flop0, flop1, flop2, turn, river};
        uint16_t my_strength = (uint16_t)evaluate(mcards, 7);

        double win_prob = 1.0;
        double total_prob = 1.0;
        for (int p = 0; p < NUM_PLAYERS; ++p) {
            if (p == updating_player) continue;

            const float* cfreach = &d_all_reaches[p * (total_num_nodes * MAX_HANDS) + node_idx * MAX_HANDS];
            bool is_opp_active = (node.active_mask & (1 << p)) != 0;
            double beat_reach = 0.0;
            double compat_reach = 0.0;

            if (!is_opp_active) {
                // Folded opponent: hand-agnostic conditioning factor (total
                // reach pass-through — matches the CPU evaluator exactly).
                for (int oh = 0; oh < d_num_hands[p]; ++oh) {
                    beat_reach += cfreach[oh];
                }
                compat_reach = beat_reach;
            } else {
                for (int oh = 0; oh < d_num_hands[p]; ++oh) {
                    float w = cfreach[oh];
                    if (w > 0.0f) {
                        Card oc1 = d_private_cards[p][oh*2];
                        Card oc2 = d_private_cards[p][oh*2+1];
                        if (oc1 == c1 || oc1 == c2 || oc2 == c1 || oc2 == c2) continue;  // Blocker filter
                        compat_reach += w;

                        uint16_t opp_strength = s_opp_str[p][oh];
                        if (my_strength > opp_strength) {
                            beat_reach += w;
                        } else if (my_strength == opp_strength) {
                            beat_reach += w * 0.5;
                        }
                    }
                }
            }
            win_prob *= beat_reach;
            total_prob *= compat_reach;
        }
        // [Defect 1.1] EV(Showdown) = WinProb*(Pot-rake) - Invested*TotalReach.
        // Inactive updating player: utility locked at investment.
        d_node_cfv[node_idx * MAX_HANDS + h] = (float)(
            am_i_active ? (pot_eff * win_prob - inv_me * total_prob)
                        : (-inv_me * total_prob));
    }
}

// ── Module 3.4: GPU Rollout Showdown (multiway depth-1 leaf evaluator) ──
// Monte Carlo equity over pending runouts. Deterministic LCG seeded from
// (node_idx, hand) so CPU and GPU paths are byte-identical. 32 samples per
// hand; blockers enforced against board, hero cards and sampled runout.
template <int NUM_PLAYERS>
__global__
void kernel_rollout_showdown_leaf(
    const int* __restrict__ d_leaf_nodes, int num_leaves,
    const PostFlopNode* __restrict__ d_nodes,
    const float* __restrict__ d_all_reaches,
    float* __restrict__ d_node_cfv,
    Card** d_private_cards,
    const int* __restrict__ d_num_hands,
    Card flop0, Card flop1, Card flop2,
    int total_num_nodes, int updating_player)
{
    int idx = blockIdx.x;
    if (idx >= num_leaves) return;
    int node_idx = d_leaf_nodes[idx];
    const PostFlopNode& node = d_nodes[node_idx];

    int tid = threadIdx.x;
    int my_hands = d_num_hands[updating_player];
    double pot = (double)node.amount;

    bool am_i_active = (node.active_mask & (1 << updating_player)) != 0;

    Card known_turn = node.turn;
    Card known_river = node.river;

    for (int h = tid; h < my_hands; h += blockDim.x) {
        Card c1 = d_private_cards[updating_player][h * 2];
        Card c2 = d_private_cards[updating_player][h * 2 + 1];

        double accumulated_win = 0.0;
        double accumulated_total = 0.0;
        int valid_runouts = 0;
        uint32_t rng = (uint32_t)((uint32_t)node_idx * 1326u + (uint32_t)h) ^ 0x9E3779B9u;

        for (int sample = 0; sample < 32; ++sample) {
            rng = rng * 1664525U + 1013904223U;
            Card t = (Card)((rng >> 16) % 52);
            rng = rng * 1664525U + 1013904223U;
            Card r = (Card)((rng >> 16) % 52);

            // Condition on known street cards; the RNG stream stays aligned
            // with the unconditional draw sequence (draws consumed either way).
            if (known_turn  != NOT_DEALT) t = known_turn;
            if (known_river != NOT_DEALT) r = known_river;

            if (t == r || t == flop0 || t == flop1 || t == flop2 ||
                r == flop0 || r == flop1 || r == flop2 ||
                t == c1 || t == c2 || r == c1 || r == c2) continue;

            Card my_7[7] = {c1, c2, flop0, flop1, flop2, t, r};
            uint16_t my_s = (uint16_t)evaluate(my_7, 7);

            double win_prob = 1.0;
            double total_prob = 1.0;
            for (int p = 0; p < NUM_PLAYERS; ++p) {
                if (p == updating_player) continue;
                bool opp_active = (node.active_mask & (1 << p)) != 0;
                const float* cfreach = &d_all_reaches[p * (total_num_nodes * MAX_HANDS) + node_idx * MAX_HANDS];
                double beat_reach = 0.0;
                double compat_reach = 0.0;

                if (!opp_active) {
                    // Folded opponent: total reach pass-through.
                    for (int oh = 0; oh < d_num_hands[p]; ++oh) {
                        beat_reach += cfreach[oh];
                    }
                    compat_reach = beat_reach;
                } else {
                    for (int oh = 0; oh < d_num_hands[p]; ++oh) {
                        float w = cfreach[oh];
                        if (w <= 0.0f) continue;
                        Card oc1 = d_private_cards[p][oh * 2];
                        Card oc2 = d_private_cards[p][oh * 2 + 1];
                        // Blocker filter: opponent cannot hold hero's cards,
                        // board cards or the sampled runout.
                        if (oc1 == c1 || oc1 == c2 || oc2 == c1 || oc2 == c2) continue;
                        if (oc1 == t || oc1 == r || oc2 == t || oc2 == r) continue;
                        if (oc1 == flop0 || oc1 == flop1 || oc1 == flop2 ||
                            oc2 == flop0 || oc2 == flop1 || oc2 == flop2) continue;
                        compat_reach += w;

                        Card ocards[7] = {oc1, oc2, flop0, flop1, flop2, t, r};
                        uint16_t os = (uint16_t)evaluate(ocards, 7);
                        if (my_s > os)      beat_reach += w;
                        else if (my_s == os) beat_reach += w * 0.5;
                    }
                }
                win_prob *= beat_reach;
                total_prob *= compat_reach;
            }
            accumulated_win += win_prob;
            accumulated_total += total_prob;
            valid_runouts++;
        }
        double eq = valid_runouts > 0 ? (accumulated_win / valid_runouts) : 0.0;
        double eq_total = valid_runouts > 0 ? (accumulated_total / valid_runouts) : 0.0;
        d_node_cfv[node_idx * MAX_HANDS + h] = (float)(
            am_i_active ? (pot * eq - (double)node.invested[updating_player] * eq_total)
                        : (-(double)node.invested[updating_player] * eq_total));
    }
}

// ── Up pass: aggregate CFVs leaves→root + DCFR arena updates ────────────
template <int NUM_PLAYERS>
__global__
void kernel_up_pass(
    const int* __restrict__ d_nodes_at_depth,
    int num_nodes_this_depth,
    PostFlopNode* __restrict__ d_nodes,
    uint8_t* __restrict__ d_storage1,
    uint8_t* __restrict__ d_storage2,
    float* __restrict__ d_node_cfv,
    float alpha_t, float beta_t, float gamma_t,
    const int* __restrict__ d_num_hands,
    int updating_player, bool is_compressed)
{
    int idx = blockIdx.x;
    if (idx >= num_nodes_this_depth) return;

    int node_idx = d_nodes_at_depth[idx];
    PostFlopNode& node = d_nodes[node_idx];
    if (node.is_terminal()) return;

    int num_actions = node.num_children;
    int tid = threadIdx.x;
    int my_hands = d_num_hands[updating_player];

    for (int h = tid; h < my_hands; h += blockDim.x) {
        if (node.is_chance()) {
            float sum_cfv = 0.0f;
            for (int a = 0; a < num_actions; ++a) {
                sum_cfv += d_node_cfv[(node.children_offset + a) * MAX_HANDS + h];
            }
            d_node_cfv[node_idx * MAX_HANDS + h] = sum_cfv;
            continue;
        }

        int node_player = node.player & PLAYER_MASK;
        float my_cfv = 0.0f;

        if (node_player == updating_player) {
            float sum_pos = 0.0f;
            float s2 = node.scale2; if (s2 == 0.0f) s2 = 1.0f;
            float decode_mult = is_compressed ? (s2 / 32767.0f) : 1.0f;

            for (int a = 0; a < num_actions; ++a) {
                int mem_idx = node.storage2_offset + a * my_hands + h;
                float r = is_compressed ? (float)((const int16_t*)d_storage2)[mem_idx] * decode_mult
                                        : ((const float*)d_storage2)[mem_idx];
                if (r > 0.0f) sum_pos += r;
            }

            float inv = (sum_pos > 1e-7f) ? (1.0f / sum_pos) : 0.0f;
            float uniform = 1.0f / num_actions;

            for (int a = 0; a < num_actions; ++a) {
                int mem_idx = node.storage2_offset + a * my_hands + h;
                float r = is_compressed ? (float)((const int16_t*)d_storage2)[mem_idx] * decode_mult
                                        : ((const float*)d_storage2)[mem_idx];
                float strat_val = (sum_pos > 1e-7f) ? ((r > 0.0f) ? (r / sum_pos) : 0.0f) : uniform;

                float child_cfv = d_node_cfv[(node.children_offset + a) * MAX_HANDS + h];
                my_cfv += strat_val * child_cfv;
            }
        } else {
            for (int a = 0; a < num_actions; ++a) {
                my_cfv += d_node_cfv[(node.children_offset + a) * MAX_HANDS + h];
            }
        }

        d_node_cfv[node_idx * MAX_HANDS + h] = my_cfv;

        if (node_player == updating_player) {
            float s1 = node.scale1; if (s1 == 0.0f) s1 = 1.0f;
            float decode_mult1 = is_compressed ? (s1 / 32767.0f) : 1.0f;

            float sum_pos = 0.0f;
            float s2 = node.scale2; if (s2 == 0.0f) s2 = 1.0f;
            float decode_mult = is_compressed ? (s2 / 32767.0f) : 1.0f;
            for (int a = 0; a < num_actions; ++a) {
                int mem_idx = node.storage2_offset + a * my_hands + h;
                float r = is_compressed ? (float)((const int16_t*)d_storage2)[mem_idx] * decode_mult
                                        : ((const float*)d_storage2)[mem_idx];
                if (r > 0.0f) sum_pos += r;
            }
            float inv = (sum_pos > 1e-7f) ? (1.0f / sum_pos) : 0.0f;
            float uniform = 1.0f / num_actions;

            for (int a = 0; a < num_actions; ++a) {
                int mem_idx1 = node.storage1_offset + a * my_hands + h;
                int mem_idx2 = node.storage2_offset + a * my_hands + h;
                float child_cfv = d_node_cfv[(node.children_offset + a) * MAX_HANDS + h];

                float r = is_compressed ? (float)((const int16_t*)d_storage2)[mem_idx2] * decode_mult
                                        : ((const float*)d_storage2)[mem_idx2];
                float strat_val = (sum_pos > 1e-7f) ? ((r > 0.0f) ? (r / sum_pos) : 0.0f) : uniform;

                float old_s = is_compressed ? (float)((int16_t*)d_storage1)[mem_idx1] * decode_mult1 : ((float*)d_storage1)[mem_idx1];
                float new_s = old_s * gamma_t + strat_val;

                // [Defect 1.3] NEGATIVE REGRETS ARE RETAINED: the CFR+ floor
                // at zero was removed from the arena update; truncation to
                // the positive part happens exclusively in regret matching
                // (down pass / regret_matching), so beta_t = 0.5 is reachable.
                float old_r = is_compressed ? (float)((int16_t*)d_storage2)[mem_idx2] * decode_mult : ((float*)d_storage2)[mem_idx2];
                float coef = (old_r >= 0.0f) ? alpha_t : beta_t;
                float new_r = old_r * coef + (child_cfv - my_cfv);

                if (!is_compressed) {
                    ((float*)d_storage1)[mem_idx1] = new_s;
                    ((float*)d_storage2)[mem_idx2] = new_r;
                } else {
                    float enc_s = new_s / decode_mult1;
                    enc_s = enc_s > 32767.0f ? 32767.0f : (enc_s < -32767.0f ? -32767.0f : enc_s);
                    ((int16_t*)d_storage1)[mem_idx1] = (int16_t)lrintf(enc_s);

                    float enc_r = new_r / decode_mult;
                    enc_r = enc_r > 32767.0f ? 32767.0f : (enc_r < -32767.0f ? -32767.0f : enc_r);
                    ((int16_t*)d_storage2)[mem_idx2] = (int16_t)lrintf(enc_r);
                }
            }
        }
    }
}

// ── Host-side pipeline ──────────────────────────────────────────────────
bool gpu_solver_init(const PostFlopGame& game, GpuMemory& gpu, int device_id) {
    if (gpu.initialized) return true;

    int device_count = 0;
    cudaError_t d_err = cudaGetDeviceCount(&device_count);
    if (d_err != cudaSuccess || device_count == 0) {
        fprintf(stderr, "[GPU INIT ERROR] No CUDA devices found.\n");
        return false;
    }

    if (device_id >= 0 && device_id < device_count) {
        CUDA_CHECK(cudaSetDevice(device_id));
    }
    CUDA_CHECK(cudaDeviceSynchronize());

    int res_table = init_hand_table_on_gpu();
    if (res_table != 0) {
        fprintf(stderr, "[GPU INIT ERROR] Failed to init hand table constant memory on device.\n");
        return false;
    }

    const auto& arena = game.node_arena();
    gpu.num_nodes = (int)arena.size();
    gpu.num_storage = (int)game.storage1_bytes();
    gpu.num_players = game.num_players();

    for (int p = 0; p < gpu.num_players; ++p) {
        gpu.num_hands[p] = game.num_private_hands(p);
    }
    CUDA_CHECK(cudaMalloc(&gpu.d_num_hands, gpu.num_players * sizeof(int)));
    CUDA_CHECK(cudaMemcpy(gpu.d_num_hands, gpu.num_hands, gpu.num_players * sizeof(int), cudaMemcpyHostToDevice));

    gpu.starting_pot = game.tree_config().starting_pot;
    gpu.rake_rate = (float)game.tree_config().rake_rate;
    gpu.rake_cap = (float)game.tree_config().rake_cap;
    gpu.is_compressed = game.is_compression_enabled();
    const auto& cc = game.card_config();
    gpu.flop[0] = cc.flop[0]; gpu.flop[1] = cc.flop[1]; gpu.flop[2] = cc.flop[2];
    gpu.turn = cc.turn; gpu.river = cc.river;

    CUDA_CHECK(cudaMalloc(&gpu.d_nodes, gpu.num_nodes * sizeof(PostFlopNode)));
    CUDA_CHECK(cudaMemcpy(gpu.d_nodes, arena.data(), gpu.num_nodes * sizeof(PostFlopNode), cudaMemcpyHostToDevice));

    // [Defect 1.9] Pure FP32 arenas (compression disabled by default).
    CUDA_CHECK(cudaMalloc(&gpu.d_storage1, gpu.num_storage));
    CUDA_CHECK(cudaMemcpy(gpu.d_storage1, game.storage1_data(), gpu.num_storage, cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMalloc(&gpu.d_storage2, game.storage2_bytes()));
    CUDA_CHECK(cudaMemcpy(gpu.d_storage2, game.storage2_data(), game.storage2_bytes(), cudaMemcpyHostToDevice));

    Card* h_private_cards_ptrs[6];
    for (int p = 0; p < gpu.num_players; ++p) {
        int nh = gpu.num_hands[p];
        std::vector<Card> cards_flat((size_t)nh * 2);
        for (int i = 0; i < nh; ++i) {
            cards_flat[(size_t)i*2]   = cc.private_cards[p][i].first;
            cards_flat[(size_t)i*2+1] = cc.private_cards[p][i].second;
        }
        CUDA_CHECK(cudaMalloc(&gpu.d_private_cards[p], (size_t)nh * 2 * sizeof(Card)));
        CUDA_CHECK(cudaMemcpy(gpu.d_private_cards[p], cards_flat.data(), (size_t)nh * 2 * sizeof(Card), cudaMemcpyHostToDevice));
        h_private_cards_ptrs[p] = gpu.d_private_cards[p];

        CUDA_CHECK(cudaMalloc(&gpu.d_initial_weights[p], (size_t)nh * sizeof(float)));
        CUDA_CHECK(cudaMemcpy(gpu.d_initial_weights[p], cc.initial_weights[p].data(), (size_t)nh * sizeof(float), cudaMemcpyHostToDevice));
    }
    CUDA_CHECK(cudaMalloc(&gpu.d_private_cards_ptrs, 6 * sizeof(Card*)));
    CUDA_CHECK(cudaMemcpy(gpu.d_private_cards_ptrs, h_private_cards_ptrs, 6 * sizeof(Card*), cudaMemcpyHostToDevice));

    gpu.max_depth = game.max_tree_depth();
    gpu.level_sizes = new int[gpu.max_depth + 1];
    gpu.d_levels = new int*[gpu.max_depth + 1];
    for (int d = 0; d <= gpu.max_depth; ++d) {
        const auto& level_nodes = game.nodes_by_depth()[d];
        gpu.level_sizes[d] = (int)level_nodes.size();
        if (gpu.level_sizes[d] > 0) {
            CUDA_CHECK(cudaMalloc(&gpu.d_levels[d], (size_t)gpu.level_sizes[d] * sizeof(int)));
            CUDA_CHECK(cudaMemcpy(gpu.d_levels[d], level_nodes.data(), (size_t)gpu.level_sizes[d] * sizeof(int), cudaMemcpyHostToDevice));
        } else {
            gpu.d_levels[d] = nullptr;
        }
    }

    // Terminal node classification: fold / complete-board showdown /
    // pending-board rollout leaves (Section 2, Tier 2).
    std::vector<int> fold_nodes, showdown_nodes, rollout_nodes;
    for (int i = 0; i < gpu.num_nodes; ++i) {
        if (!arena[i].is_terminal()) continue;
        if ((arena[i].player & PLAYER_FOLD_FLAG) == PLAYER_FOLD_FLAG) {
            fold_nodes.push_back(i);
        } else if (arena[i].turn != NOT_DEALT && arena[i].river != NOT_DEALT) {
            showdown_nodes.push_back(i);
        } else {
            rollout_nodes.push_back(i);
        }
    }
    gpu.num_fold_nodes = (int)fold_nodes.size();
    gpu.num_showdown_nodes = (int)showdown_nodes.size();
    gpu.num_rollout_nodes = (int)rollout_nodes.size();
    if (gpu.num_fold_nodes > 0) {
        CUDA_CHECK(cudaMalloc(&gpu.d_fold_nodes, (size_t)gpu.num_fold_nodes * sizeof(int)));
        CUDA_CHECK(cudaMemcpy(gpu.d_fold_nodes, fold_nodes.data(), (size_t)gpu.num_fold_nodes * sizeof(int), cudaMemcpyHostToDevice));
    }
    if (gpu.num_showdown_nodes > 0) {
        CUDA_CHECK(cudaMalloc(&gpu.d_showdown_nodes, (size_t)gpu.num_showdown_nodes * sizeof(int)));
        CUDA_CHECK(cudaMemcpy(gpu.d_showdown_nodes, showdown_nodes.data(), (size_t)gpu.num_showdown_nodes * sizeof(int), cudaMemcpyHostToDevice));
    }
    if (gpu.num_rollout_nodes > 0) {
        CUDA_CHECK(cudaMalloc(&gpu.d_rollout_nodes, (size_t)gpu.num_rollout_nodes * sizeof(int)));
        CUDA_CHECK(cudaMemcpy(gpu.d_rollout_nodes, rollout_nodes.data(), (size_t)gpu.num_rollout_nodes * sizeof(int), cudaMemcpyHostToDevice));
    }

    CUDA_CHECK(cudaMalloc(&gpu.d_all_reaches, (size_t)gpu.num_players * gpu.num_nodes * MAX_HANDS * sizeof(float)));
    CUDA_CHECK(cudaMemset(gpu.d_all_reaches, 0, (size_t)gpu.num_players * gpu.num_nodes * MAX_HANDS * sizeof(float)));
    CUDA_CHECK(cudaMalloc(&gpu.d_node_cfv, (size_t)gpu.num_nodes * MAX_HANDS * sizeof(float)));
    CUDA_CHECK(cudaMemset(gpu.d_node_cfv, 0, (size_t)gpu.num_nodes * MAX_HANDS * sizeof(float)));

    gpu.initialized = true;
    return true;
}

template <int NUM_PLAYERS>
int gpu_solve_step_impl(GpuMemory& gpu, uint32_t current_iter) {
    DiscountParams params = DiscountParams::from_iteration(current_iter);

    for (int p = 0; p < NUM_PLAYERS; ++p) {
        // ── Defect 1.4 ──────────────────────────────────────────────────
        // The bulk cudaMemset of d_all_reaches (players × nodes × 1326 × 4B,
        // ~318 MB on production trees, ~1.3 TB of redundant traffic over a
        // 1024-iteration solve) has been REMOVED from the iteration loop.
        // kernel_down_pass unconditionally overwrites every child reach
        // buffer (each tree node has exactly one parent), so only the ROOT
        // row is re-seeded per updating player.
        for (int q = 0; q < NUM_PLAYERS; ++q) {
            CUDA_CHECK(cudaMemcpyAsync(
                gpu.d_all_reaches + (size_t)q * ((size_t)gpu.num_nodes * MAX_HANDS),
                gpu.d_initial_weights[q],
                (size_t)gpu.num_hands[q] * sizeof(float),
                cudaMemcpyDeviceToDevice, 0));
        }

        for (int d = 0; d <= gpu.max_depth; ++d) {
            if (gpu.level_sizes[d] == 0) continue;
            KERNEL_LAUNCH(
                kernel_down_pass<NUM_PLAYERS>, gpu.level_sizes[d], 256,
                gpu.d_levels[d], gpu.level_sizes[d], gpu.d_nodes, gpu.d_storage2, gpu.d_all_reaches,
                gpu.d_num_hands, p, gpu.is_compressed, gpu.num_nodes);
            CUDA_CHECK(cudaGetLastError());
        }

        if (gpu.num_fold_nodes > 0) {
            KERNEL_LAUNCH(
                kernel_terminal_fold<NUM_PLAYERS>, gpu.num_fold_nodes, 256,
                gpu.d_fold_nodes, gpu.num_fold_nodes, gpu.d_nodes, gpu.d_all_reaches, gpu.d_node_cfv,
                gpu.d_private_cards_ptrs,
                gpu.d_num_hands, p, gpu.num_nodes);
            CUDA_CHECK(cudaGetLastError());
        }
        if (gpu.num_showdown_nodes > 0) {
            KERNEL_LAUNCH(
                kernel_terminal_showdown<NUM_PLAYERS>, gpu.num_showdown_nodes, 256,
                gpu.d_showdown_nodes, gpu.num_showdown_nodes, gpu.d_nodes, gpu.d_all_reaches, gpu.d_node_cfv,
                gpu.d_private_cards_ptrs, gpu.d_num_hands,
                gpu.flop[0], gpu.flop[1], gpu.flop[2], gpu.num_nodes, p,
                gpu.rake_rate, gpu.rake_cap);
            CUDA_CHECK(cudaGetLastError());
        }
        if (gpu.num_rollout_nodes > 0) {
            KERNEL_LAUNCH(
                kernel_rollout_showdown_leaf<NUM_PLAYERS>, gpu.num_rollout_nodes, 256,
                gpu.d_rollout_nodes, gpu.num_rollout_nodes, gpu.d_nodes, gpu.d_all_reaches, gpu.d_node_cfv,
                gpu.d_private_cards_ptrs, gpu.d_num_hands,
                gpu.flop[0], gpu.flop[1], gpu.flop[2], gpu.num_nodes, p);
            CUDA_CHECK(cudaGetLastError());
        }

        // Frozen learning for node-locked players [Defect 1.5]: reaches and
        // terminal CFVs are still produced (their locked strategy drives the
        // conditioning), but no regret/strategy arena is updated.
        if ((gpu.locked_players_mask & (1 << p)) != 0) {
            continue;
        }

        for (int d = gpu.max_depth; d >= 0; --d) {
            if (gpu.level_sizes[d] == 0) continue;
            KERNEL_LAUNCH(
                kernel_up_pass<NUM_PLAYERS>, gpu.level_sizes[d], 256,
                gpu.d_levels[d], gpu.level_sizes[d], gpu.d_nodes, gpu.d_storage1, gpu.d_storage2, gpu.d_node_cfv,
                params.alpha_t, params.beta_t, params.gamma_t, gpu.d_num_hands, p, gpu.is_compressed);
            CUDA_CHECK(cudaGetLastError());
        }
    }
    CUDA_CHECK(cudaDeviceSynchronize());
    return 0;
}

int gpu_solve_step(GpuMemory& gpu, uint32_t current_iter) {
    if (!gpu.initialized) return -1;
    switch (gpu.num_players) {
        case 2: return gpu_solve_step_impl<2>(gpu, current_iter);
        case 3: return gpu_solve_step_impl<3>(gpu, current_iter);
        case 4: return gpu_solve_step_impl<4>(gpu, current_iter);
        case 5: return gpu_solve_step_impl<5>(gpu, current_iter);
        case 6: return gpu_solve_step_impl<6>(gpu, current_iter);
        default: return -1;
    }
}

int gpu_solve_step_dispatch(PostFlopGame& game, uint32_t current_iter) {
    GpuMemory* gpu = game.gpu_mem();
    if (!gpu || !gpu->initialized) return -1;
    return gpu_solve_step(*gpu, current_iter);
}

bool gpu_solver_copy_back(PostFlopGame& game, GpuMemory& gpu) {
    if (!gpu.initialized) return false;
    CUDA_CHECK(cudaMemcpy(game.storage1_data_mut(), gpu.d_storage1, gpu.num_storage, cudaMemcpyDeviceToHost));
    CUDA_CHECK(cudaMemcpy(game.storage2_data_mut(), gpu.d_storage2, game.storage2_bytes(), cudaMemcpyDeviceToHost));
    return true;
}

// Idempotent cleanup: frees every buffer AND nulls the pointers so the
// GpuMemory destructor (and any repeated explicit call) is safe.
void gpu_solver_cleanup(GpuMemory& gpu) {
    if (gpu.d_nodes) { cudaFree(gpu.d_nodes); gpu.d_nodes = nullptr; }
    if (gpu.d_storage1) { cudaFree(gpu.d_storage1); gpu.d_storage1 = nullptr; }
    if (gpu.d_storage2) { cudaFree(gpu.d_storage2); gpu.d_storage2 = nullptr; }
    if (gpu.d_all_reaches) { cudaFree(gpu.d_all_reaches); gpu.d_all_reaches = nullptr; }
    if (gpu.d_node_cfv) { cudaFree(gpu.d_node_cfv); gpu.d_node_cfv = nullptr; }
    if (gpu.d_fold_nodes) { cudaFree(gpu.d_fold_nodes); gpu.d_fold_nodes = nullptr; }
    if (gpu.d_showdown_nodes) { cudaFree(gpu.d_showdown_nodes); gpu.d_showdown_nodes = nullptr; }
    if (gpu.d_rollout_nodes) { cudaFree(gpu.d_rollout_nodes); gpu.d_rollout_nodes = nullptr; }
    if (gpu.d_num_hands) { cudaFree(gpu.d_num_hands); gpu.d_num_hands = nullptr; }
    if (gpu.d_private_cards_ptrs) { cudaFree(gpu.d_private_cards_ptrs); gpu.d_private_cards_ptrs = nullptr; }
    if (gpu.d_levels) {
        for (int d = 0; d <= gpu.max_depth; ++d) {
            if (gpu.d_levels[d]) { cudaFree(gpu.d_levels[d]); gpu.d_levels[d] = nullptr; }
        }
        delete[] gpu.d_levels;
        gpu.d_levels = nullptr;
    }
    delete[] gpu.level_sizes;
    gpu.level_sizes = nullptr;
    gpu.max_depth = 0;
    for (int p = 0; p < gpu.num_players; ++p) {
        if (gpu.d_private_cards[p]) { cudaFree(gpu.d_private_cards[p]); gpu.d_private_cards[p] = nullptr; }
        if (gpu.d_initial_weights[p]) { cudaFree(gpu.d_initial_weights[p]); gpu.d_initial_weights[p] = nullptr; }
    }
    gpu.num_fold_nodes = 0;
    gpu.num_showdown_nodes = 0;
    gpu.num_rollout_nodes = 0;
    gpu.initialized = false;
}

// RAII destructor (declaration lives in gpu_solver.h).
GpuMemory::~GpuMemory() {
    gpu_solver_cleanup(*this);
}

} // namespace postflop
