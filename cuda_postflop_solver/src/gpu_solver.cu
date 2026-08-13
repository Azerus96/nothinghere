// ════════════════════════════════════════════════════════════════════════
// gpu_solver.cu — Level-by-Level BFS DCFR solver for Tesla T4
// ════════════════════════════════════════════════════════════════════════
#ifdef __CUDACC__

#include "gpu_solver.h"
#include "solver.h"
#include "hand_evaluator.h"
#include <cstdio>
#include <cmath>

namespace postflop {

#define PLAYER_FOLD_FLAG 24
#define MAX_HANDS 1326

// ── ЯДРО 1: Проход ВНИЗ (Шаблонное) ─────────────────────────────────────
template <int NUM_PLAYERS>
__global__
void kernel_down_pass(
    const int* __restrict__ d_nodes_at_depth,
    int num_nodes_this_depth,
    const PostFlopNode* __restrict__ d_nodes,
    const uint8_t* __restrict__ d_storage2, 
    float* __restrict__ d_opp_reach,
    int num_hands_p,
    int num_hands_opp,
    int updating_player,
    bool is_compressed)
{
    int idx = blockIdx.x;
    if (idx >= num_nodes_this_depth) return;
    
    int node_idx = d_nodes_at_depth[idx];
    const PostFlopNode& node = d_nodes[node_idx];
    if (node.is_terminal()) return;

    int num_actions = node.num_children;
    int tid = threadIdx.x; 

    if (node.is_chance()) {
        float chance_factor = (node.turn == 255) ? 45.0f : 44.0f;
        for (int opp_h = tid; opp_h < num_hands_opp; opp_h += blockDim.x) {
            float my_reach = d_opp_reach[node_idx * MAX_HANDS + opp_h];
            float scaled = my_reach / chance_factor;
            for (int a = 0; a < num_actions; ++a) {
                d_opp_reach[(node.children_offset + a) * MAX_HANDS + opp_h] = scaled;
            }
        }
        return;
    }

    int node_player = node.player & 7; // Маска для мультивея
    
    for (int opp_h = tid; opp_h < num_hands_opp; opp_h += blockDim.x) {
        float my_reach = d_opp_reach[node_idx * MAX_HANDS + opp_h];

        if (node_player == updating_player) {
            for (int a = 0; a < num_actions; ++a) {
                d_opp_reach[(node.children_offset + a) * MAX_HANDS + opp_h] = my_reach;
            }
        } else {
            float sum_pos = 0.0f;
            float s2 = node.scale2;
            if (s2 == 0.0f) s2 = 1.0f;
            float decode_mult = is_compressed ? (s2 / 32767.0f) : 1.0f;
            
            for (int a = 0; a < num_actions; ++a) {
                int mem_idx = node.storage2_offset + a * num_hands_opp + opp_h;
                float r = is_compressed ? (float)((const int16_t*)d_storage2)[mem_idx] * decode_mult
                                        : ((const float*)d_storage2)[mem_idx];
                if (r > 0.0f) sum_pos += r;
            }
            
            float inv = (sum_pos > 1e-7f) ? (1.0f / sum_pos) : 0.0f;
            float uniform = 1.0f / num_actions;
            
            for (int a = 0; a < num_actions; ++a) {
                int mem_idx = node.storage2_offset + a * num_hands_opp + opp_h;
                float r = is_compressed ? (float)((const int16_t*)d_storage2)[mem_idx] * decode_mult
                                        : ((const float*)d_storage2)[mem_idx];
                
                float strat_val = (sum_pos > 1e-7f) ? ((r > 0.0f) ? (r * inv) : 0.0f) : uniform;
                d_opp_reach[(node.children_offset + a) * MAX_HANDS + opp_h] = my_reach * strat_val;
            }
        }
    }
}

// ── ЯДРО 2: Терминальный Fold (Шаблонное) ───────────────────────────────
template <int NUM_PLAYERS>
__global__ 
void kernel_terminal_fold(
    const int* __restrict__ d_fold_nodes, int num_nodes, 
    const PostFlopNode* __restrict__ d_nodes,
    const float* __restrict__ d_opp_reach, float* __restrict__ d_node_cfv,
    const Card* __restrict__ d_my_cards, const Card* __restrict__ d_opp_cards, 
    const uint16_t* __restrict__ d_my_same,
    int num_hands, int opp_num_hands,
    int starting_pot, float rake_rate, float rake_cap, int updating_player)
{
    int idx = blockIdx.x;
    if (idx >= num_nodes) return;
    int node_idx = d_fold_nodes[idx];
    const PostFlopNode& node = d_nodes[node_idx];
    
    int folded_player = node.player & 7;
    
    if constexpr (NUM_PLAYERS == 2) {
        double pot = starting_pot + 2 * node.amount;
        double half_pot = 0.5 * pot;
        double rake = fmin(pot * (double)rake_rate, (double)rake_cap);
        double amount_win = (half_pot - rake) / opp_num_hands;
        double amount_lose = -half_pot / opp_num_hands;
        double payoff = (updating_player == folded_player) ? amount_lose : amount_win;

        extern __shared__ double s_cfreach_minus[]; 
        int tid = threadIdx.x;
        if (tid < 53) s_cfreach_minus[tid] = 0.0;
        __syncthreads();

        const float* cfreach = d_opp_reach + node_idx * MAX_HANDS;
        
        double my_sum = 0.0;
        for (int i = tid; i < opp_num_hands; i += blockDim.x) {
            float w = cfreach[i];
            if (w != 0.0f) {
                my_sum += w;
                atomicAdd(&s_cfreach_minus[d_opp_cards[i * 2]], (double)w);
                atomicAdd(&s_cfreach_minus[d_opp_cards[i * 2 + 1]], (double)w);
            }
        }
        if (my_sum != 0.0) atomicAdd(&s_cfreach_minus[52], my_sum);
        __syncthreads();

        double cfreach_sum = s_cfreach_minus[52];
        for (int h = tid; h < num_hands; h += blockDim.x) {
            Card c1 = d_my_cards[h * 2];
            Card c2 = d_my_cards[h * 2 + 1];
            double cfreach_same = 0.0;
            uint16_t si = d_my_same[h];
            if (si != 0xFFFF) cfreach_same = cfreach[si];
            double total = cfreach_sum + cfreach_same - s_cfreach_minus[c1] - s_cfreach_minus[c2];
            d_node_cfv[node_idx * MAX_HANDS + h] = (float)(payoff * total);
        }
    } else {
        // Multiway Fold (Упрощенный)
        int tid = threadIdx.x;
        if (updating_player == folded_player) {
            for (int h = tid; h < num_hands; h += blockDim.x) {
                d_node_cfv[node_idx * MAX_HANDS + h] = 0.0f;
            }
        } else {
            double pot = starting_pot + NUM_PLAYERS * node.amount;
            const float* cfreach = d_opp_reach + node_idx * MAX_HANDS;
            double sum_reach = 0.0;
            for (int i = tid; i < opp_num_hands; i += blockDim.x) {
                sum_reach += cfreach[i];
            }
            // Warp reduction
            for (int offset = 16; offset > 0; offset /= 2) {
                sum_reach += __shfl_down_sync(0xffffffff, sum_reach, offset);
            }
            __shared__ double s_sum;
            if (tid == 0) s_sum = sum_reach;
            __syncthreads();
            
            for (int h = tid; h < num_hands; h += blockDim.x) {
                d_node_cfv[node_idx * MAX_HANDS + h] = (float)(pot * s_sum);
            }
        }
    }
}

// ── ЯДРО 3: Терминальный Showdown (Шаблонное) ───────────────────────────
template <int NUM_PLAYERS>
__global__ 
void kernel_terminal_showdown(
    const int* __restrict__ d_showdown_nodes, int num_nodes, 
    const PostFlopNode* __restrict__ d_nodes,
    const float* __restrict__ d_opp_reach, float* __restrict__ d_node_cfv,
    const Card* __restrict__ d_my_cards, const Card* __restrict__ d_opp_cards, 
    const uint16_t* __restrict__ d_my_same,
    int num_hands, int opp_num_hands,
    int starting_pot, float rake_rate, float rake_cap,
    Card flop0, Card flop1, Card flop2)
{
    int idx = blockIdx.x;
    if (idx >= num_nodes) return;
    int node_idx = d_showdown_nodes[idx];
    const PostFlopNode& node = d_nodes[node_idx];
    
    Card turn = node.turn;
    Card river = node.river;
    const float* cfreach = d_opp_reach + node_idx * MAX_HANDS;
    int tid = threadIdx.x;

    if constexpr (NUM_PLAYERS == 2) {
        double pot = starting_pot + 2 * node.amount;
        double half_pot = 0.5 * pot;
        double rake = fmin(pot * (double)rake_rate, (double)rake_cap);
        double amount_win = (half_pot - rake) / opp_num_hands;
        double amount_lose = -half_pot / opp_num_hands;
        double amount_tie = -0.5 * rake / opp_num_hands;

        extern __shared__ uint16_t s_opp_strengths[]; 
        
        for (int i = tid; i < opp_num_hands; i += blockDim.x) {
            Card oc1 = d_opp_cards[i*2], oc2 = d_opp_cards[i*2+1];
            Card ocards[7] = {oc1, oc2, flop0, flop1, flop2, turn, river};
            s_opp_strengths[i] = evaluate(ocards, 7);
        }
        __syncthreads();

        for (int h = tid; h < num_hands; h += blockDim.x) {
            Card c1 = d_my_cards[h*2], c2 = d_my_cards[h*2+1];
            Card mcards[7] = {c1, c2, flop0, flop1, flop2, turn, river};
            uint16_t my_strength = evaluate(mcards, 7);

            double win_cfreach = 0, lose_cfreach = 0, tie_cfreach = 0;
            double minus_c1_win = 0, minus_c2_win = 0;
            double minus_c1_lose = 0, minus_c2_lose = 0;
            double minus_c1_tie = 0, minus_c2_tie = 0;

            for (int i = 0; i < opp_num_hands; ++i) {
                float w = cfreach[i];
                if (w > 0.0f) {
                    uint16_t opp_s = s_opp_strengths[i];
                    Card oc1 = d_opp_cards[i*2], oc2 = d_opp_cards[i*2+1];
                    bool has_c1 = (oc1 == c1 || oc2 == c1);
                    bool has_c2 = (oc1 == c2 || oc2 == c2);
                    
                    if (my_strength > opp_s) {
                        win_cfreach += w;
                        if (has_c1) minus_c1_win += w;
                        if (has_c2) minus_c2_win += w;
                    } else if (my_strength < opp_s) {
                        lose_cfreach += w;
                        if (has_c1) minus_c1_lose += w;
                        if (has_c2) minus_c2_lose += w;
                    } else {
                        tie_cfreach += w;
                        if (has_c1) minus_c1_tie += w;
                        if (has_c2) minus_c2_tie += w;
                    }
                }
            }

            double cfreach_same = 0.0;
            uint16_t si = d_my_same[h];
            if (si != 0xFFFF) cfreach_same = cfreach[si];

            win_cfreach += cfreach_same - minus_c1_win - minus_c2_win;
            lose_cfreach += cfreach_same - minus_c1_lose - minus_c2_lose;
            tie_cfreach += cfreach_same - minus_c1_tie - minus_c2_tie;

            d_node_cfv[node_idx * MAX_HANDS + h] = (float)(
                amount_win * win_cfreach + amount_lose * lose_cfreach + amount_tie * tie_cfreach);
        }
    } else {
        // Multiway Showdown (Упрощенный)
        double pot = starting_pot + NUM_PLAYERS * node.amount;
        extern __shared__ uint16_t s_opp_strengths[]; 
        
        for (int i = tid; i < opp_num_hands; i += blockDim.x) {
            Card oc1 = d_opp_cards[i*2], oc2 = d_opp_cards[i*2+1];
            Card ocards[7] = {oc1, oc2, flop0, flop1, flop2, turn, river};
            s_opp_strengths[i] = evaluate(ocards, 7);
        }
        __syncthreads();

        for (int h = tid; h < num_hands; h += blockDim.x) {
            Card c1 = d_my_cards[h*2], c2 = d_my_cards[h*2+1];
            Card mcards[7] = {c1, c2, flop0, flop1, flop2, turn, river};
            uint16_t my_strength = evaluate(mcards, 7);

            double win_cfreach = 0;
            for (int i = 0; i < opp_num_hands; ++i) {
                if (my_strength > s_opp_strengths[i]) {
                    win_cfreach += cfreach[i];
                }
            }
            d_node_cfv[node_idx * MAX_HANDS + h] = (float)(pot * win_cfreach);
        }
    }
}

// ── ЯДРО 4: Проход ВВЕРХ (Шаблонное) ────────────────────────────────────
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
    int num_hands_p, int num_hands_opp,
    int updating_player, bool is_compressed)
{
    int idx = blockIdx.x;
    if (idx >= num_nodes_this_depth) return;

    int node_idx = d_nodes_at_depth[idx];
    PostFlopNode& node = d_nodes[node_idx];
    if (node.is_terminal()) return;

    int num_actions = node.num_children;
    int tid = threadIdx.x;

    for (int h = tid; h < num_hands_p; h += blockDim.x) {
        if (node.is_chance()) {
            float sum_cfv = 0.0f;
            for (int a = 0; a < num_actions; ++a) {
                sum_cfv += d_node_cfv[(node.children_offset + a) * MAX_HANDS + h];
            }
            d_node_cfv[node_idx * MAX_HANDS + h] = sum_cfv;
            continue;
        }

        int node_player = node.player & 7;

        float sum_pos = 0.0f;
        float s2 = node.scale2;
        if (s2 == 0.0f) s2 = 1.0f;
        float decode_mult = is_compressed ? (s2 / 32767.0f) : 1.0f;
        
        for (int a = 0; a < num_actions; ++a) {
            int mem_idx = node.storage2_offset + a * num_hands_p + h;
            float r = is_compressed ? (float)((const int16_t*)d_storage2)[mem_idx] * decode_mult
                                    : ((const float*)d_storage2)[mem_idx];
            if (r > 0.0f) sum_pos += r;
        }
        
        float inv = (sum_pos > 1e-7f) ? (1.0f / sum_pos) : 0.0f;
        float uniform = 1.0f / num_actions;

        float my_cfv = 0.0f;
        for (int a = 0; a < num_actions; ++a) {
            int mem_idx = node.storage2_offset + a * num_hands_p + h;
            float r = is_compressed ? (float)((const int16_t*)d_storage2)[mem_idx] * decode_mult
                                    : ((const float*)d_storage2)[mem_idx];
            float strat_val = (sum_pos > 1e-7f) ? ((r > 0.0f) ? (r * inv) : 0.0f) : uniform;
            
            float child_cfv = d_node_cfv[(node.children_offset + a) * MAX_HANDS + h];
            if (node_player == updating_player) {
                my_cfv += strat_val * child_cfv;
            } else {
                my_cfv += child_cfv;
            }
        }
        d_node_cfv[node_idx * MAX_HANDS + h] = my_cfv;

        if (node_player == updating_player) {
            float s1 = node.scale1; if (s1 == 0.0f) s1 = 1.0f;
            float decode_mult1 = is_compressed ? (s1 / 32767.0f) : 1.0f;
            
            for (int a = 0; a < num_actions; ++a) {
                int mem_idx1 = node.storage1_offset + a * num_hands_p + h;
                int mem_idx2 = node.storage2_offset + a * num_hands_p + h;
                float child_cfv = d_node_cfv[(node.children_offset + a) * MAX_HANDS + h];

                float r = is_compressed ? (float)((const int16_t*)d_storage2)[mem_idx2] * decode_mult
                                        : ((const float*)d_storage2)[mem_idx2];
                float strat_val = (sum_pos > 1e-7f) ? ((r > 0.0f) ? (r * inv) : 0.0f) : uniform;

                float old_s = is_compressed ? (float)((int16_t*)d_storage1)[mem_idx1] * decode_mult1 : ((float*)d_storage1)[mem_idx1];
                float new_s = old_s * gamma_t + strat_val;
                if (!is_compressed) ((float*)d_storage1)[mem_idx1] = new_s;

                float old_r = is_compressed ? (float)((int16_t*)d_storage2)[mem_idx2] * decode_mult : ((float*)d_storage2)[mem_idx2];
                float coef = (old_r >= 0.0f) ? alpha_t : beta_t;
                float new_r = old_r * coef + (child_cfv - my_cfv);
                new_r = (new_r > 0.0f) ? new_r : 0.0f;
                if (!is_compressed) ((float*)d_storage2)[mem_idx2] = new_r;
            }
        }
    }
}

// ── Оркестрация с хоста ─────────────────────────────────────────────────
bool gpu_solver_init(const PostFlopGame& game, GpuMemory& gpu) {
    if (gpu.initialized) return true;

    init_hand_table_on_gpu();

    const auto& arena = game.node_arena();
    gpu.num_nodes = (int)arena.size();
    gpu.num_storage = (int)game.storage1_bytes();
    gpu.num_storage_ip = (int)game.storage_ip_bytes();
    gpu.num_storage_chance = (int)game.storage_chance_bytes();
    gpu.num_players = game.num_players();
    
    for (int p = 0; p < gpu.num_players; ++p) {
        gpu.num_hands[p] = game.num_private_hands(p);
    }
    
    gpu.starting_pot = game.tree_config().starting_pot;
    gpu.rake_rate = (float)game.tree_config().rake_rate;
    gpu.rake_cap = (float)game.tree_config().rake_cap;
    gpu.is_compressed = game.is_compression_enabled();
    const auto& cc = game.card_config();
    gpu.flop[0] = cc.flop[0]; gpu.flop[1] = cc.flop[1]; gpu.flop[2] = cc.flop[2];
    gpu.turn = cc.turn; gpu.river = cc.river;

    cudaMalloc(&gpu.d_nodes, gpu.num_nodes * sizeof(PostFlopNode));
    cudaMemcpy(gpu.d_nodes, arena.data(), gpu.num_nodes * sizeof(PostFlopNode), cudaMemcpyHostToDevice);

    cudaMalloc(&gpu.d_storage1, gpu.num_storage);
    cudaMemcpy(gpu.d_storage1, game.storage1_data(), gpu.num_storage, cudaMemcpyHostToDevice);
    cudaMalloc(&gpu.d_storage2, gpu.num_storage);
    cudaMemcpy(gpu.d_storage2, game.storage2_data(), gpu.num_storage, cudaMemcpyHostToDevice);

    for (int p = 0; p < gpu.num_players; ++p) {
        int nh = gpu.num_hands[p];
        std::vector<Card> cards_flat(nh * 2);
        for (int i = 0; i < nh; ++i) {
            cards_flat[i*2]   = cc.private_cards[p][i].first;
            cards_flat[i*2+1] = cc.private_cards[p][i].second;
        }
        cudaMalloc(&gpu.d_private_cards[p], nh * 2 * sizeof(Card));
        cudaMemcpy(gpu.d_private_cards[p], cards_flat.data(), nh * 2 * sizeof(Card), cudaMemcpyHostToDevice);
        cudaMalloc(&gpu.d_same_hand_idx[p], nh * sizeof(uint16_t));
        cudaMemcpy(gpu.d_same_hand_idx[p], cc.same_hand_index[p].data(), nh * sizeof(uint16_t), cudaMemcpyHostToDevice);
        cudaMalloc(&gpu.d_initial_weights[p], nh * sizeof(float));
        cudaMemcpy(gpu.d_initial_weights[p], cc.initial_weights[p].data(), nh * sizeof(float), cudaMemcpyHostToDevice);
    }

    gpu.max_depth = game.max_tree_depth();
    gpu.level_sizes = new int[gpu.max_depth + 1];
    gpu.d_levels = new int*[gpu.max_depth + 1];
    for (int d = 0; d <= gpu.max_depth; ++d) {
        const auto& level_nodes = game.nodes_by_depth()[d];
        gpu.level_sizes[d] = level_nodes.size();
        if (gpu.level_sizes[d] > 0) {
            cudaMalloc(&gpu.d_levels[d], gpu.level_sizes[d] * sizeof(int));
            cudaMemcpy(gpu.d_levels[d], level_nodes.data(), gpu.level_sizes[d] * sizeof(int), cudaMemcpyHostToDevice);
        } else {
            gpu.d_levels[d] = nullptr;
        }
    }

    std::vector<int> fold_nodes, showdown_nodes;
    for (int i = 0; i < gpu.num_nodes; ++i) {
        if (arena[i].is_terminal()) {
            if ((arena[i].player & PLAYER_FOLD_FLAG) == PLAYER_FOLD_FLAG) fold_nodes.push_back(i);
            else showdown_nodes.push_back(i);
        }
    }
    gpu.num_fold_nodes = fold_nodes.size();
    gpu.num_showdown_nodes = showdown_nodes.size();
    if (gpu.num_fold_nodes > 0) {
        cudaMalloc(&gpu.d_fold_nodes, gpu.num_fold_nodes * sizeof(int));
        cudaMemcpy(gpu.d_fold_nodes, fold_nodes.data(), gpu.num_fold_nodes * sizeof(int), cudaMemcpyHostToDevice);
    }
    if (gpu.num_showdown_nodes > 0) {
        cudaMalloc(&gpu.d_showdown_nodes, gpu.num_showdown_nodes * sizeof(int));
        cudaMemcpy(gpu.d_showdown_nodes, showdown_nodes.data(), gpu.num_showdown_nodes * sizeof(int), cudaMemcpyHostToDevice);
    }

    cudaMalloc(&gpu.d_node_cfreach, gpu.num_nodes * MAX_HANDS * sizeof(float));
    cudaMalloc(&gpu.d_node_cfv, gpu.num_nodes * MAX_HANDS * sizeof(float));

    gpu.initialized = true;
    return true;
}

template <int NUM_PLAYERS>
int gpu_solve_step_impl(GpuMemory& gpu, uint32_t current_iter) {
    DiscountParams params = DiscountParams::from_iteration(current_iter);

    for (int p = 0; p < NUM_PLAYERS; ++p) {
        int opp = (p + 1) % NUM_PLAYERS; // Для HU это 1-p
        int num_hands_p = gpu.num_hands[p];
        int num_hands_opp = gpu.num_hands[opp];

        cudaMemcpy(gpu.d_node_cfreach, gpu.d_initial_weights[opp], num_hands_opp * sizeof(float), cudaMemcpyDeviceToDevice);

        for (int d = 0; d <= gpu.max_depth; ++d) {
            if (gpu.level_sizes[d] == 0) continue;
            kernel_down_pass<NUM_PLAYERS><<<gpu.level_sizes[d], 256>>>(
                gpu.d_levels[d], gpu.level_sizes[d], gpu.d_nodes, gpu.d_storage2, gpu.d_node_cfreach,
                num_hands_p, num_hands_opp, p, gpu.is_compressed
            );
        }

        if (gpu.num_fold_nodes > 0) {
            kernel_terminal_fold<NUM_PLAYERS><<<gpu.num_fold_nodes, 256, 53 * sizeof(double)>>>(
                gpu.d_fold_nodes, gpu.num_fold_nodes, gpu.d_nodes, gpu.d_node_cfreach, gpu.d_node_cfv,
                gpu.d_private_cards[p], gpu.d_private_cards[opp], gpu.d_same_hand_idx[p],
                num_hands_p, num_hands_opp, gpu.starting_pot, gpu.rake_rate, gpu.rake_cap, p
            );
        }
        if (gpu.num_showdown_nodes > 0) {
            kernel_terminal_showdown<NUM_PLAYERS><<<gpu.num_showdown_nodes, 256, 1326 * sizeof(uint16_t)>>>(
                gpu.d_showdown_nodes, gpu.num_showdown_nodes, gpu.d_nodes, gpu.d_node_cfreach, gpu.d_node_cfv,
                gpu.d_private_cards[p], gpu.d_private_cards[opp], gpu.d_same_hand_idx[p],
                num_hands_p, num_hands_opp, gpu.starting_pot, gpu.rake_rate, gpu.rake_cap,
                gpu.flop[0], gpu.flop[1], gpu.flop[2]
            );
        }

        for (int d = gpu.max_depth; d >= 0; --d) {
            if (gpu.level_sizes[d] == 0) continue;
            kernel_up_pass<NUM_PLAYERS><<<gpu.level_sizes[d], 256>>>(
                gpu.d_levels[d], gpu.level_sizes[d], gpu.d_nodes, gpu.d_storage1, gpu.d_storage2, gpu.d_node_cfv,
                params.alpha_t, params.beta_t, params.gamma_t, num_hands_p, num_hands_opp, p, gpu.is_compressed
            );
        }
    }
    cudaDeviceSynchronize();
    return 0;
}

int gpu_solve_step_dispatch(PostFlopGame& game, uint32_t current_iter) {
    GpuMemory* gpu = game.gpu_mem();
    if (!gpu || !gpu->initialized) return -1;

    switch (gpu->num_players) {
        case 2: return gpu_solve_step_impl<2>(*gpu, current_iter);
        case 3: return gpu_solve_step_impl<3>(*gpu, current_iter);
        case 4: return gpu_solve_step_impl<4>(*gpu, current_iter);
        case 5: return gpu_solve_step_impl<5>(*gpu, current_iter);
        case 6: return gpu_solve_step_impl<6>(*gpu, current_iter);
        default: return -1;
    }
}

bool gpu_solver_copy_back(PostFlopGame& game, GpuMemory& gpu) {
    if (!gpu.initialized) return false;
    cudaMemcpy(game.storage1_data_mut(), gpu.d_storage1, gpu.num_storage, cudaMemcpyDeviceToHost);
    cudaMemcpy(game.storage2_data_mut(), gpu.d_storage2, gpu.num_storage, cudaMemcpyDeviceToHost);
    return true;
}

void gpu_solver_cleanup(GpuMemory& gpu) {
    if (gpu.d_nodes) cudaFree(gpu.d_nodes);
    if (gpu.d_storage1) cudaFree(gpu.d_storage1);
    if (gpu.d_storage2) cudaFree(gpu.d_storage2);
    if (gpu.d_node_cfreach) cudaFree(gpu.d_node_cfreach);
    if (gpu.d_node_cfv) cudaFree(gpu.d_node_cfv);
    if (gpu.d_fold_nodes) cudaFree(gpu.d_fold_nodes);
    if (gpu.d_showdown_nodes) cudaFree(gpu.d_showdown_nodes);
    for (int d = 0; d <= gpu.max_depth; ++d) if (gpu.d_levels[d]) cudaFree(gpu.d_levels[d]);
    delete[] gpu.d_levels;
    delete[] gpu.level_sizes;
    for (int p = 0; p < gpu.num_players; ++p) {
        if (gpu.d_private_cards[p]) cudaFree(gpu.d_private_cards[p]);
        if (gpu.d_same_hand_idx[p]) cudaFree(gpu.d_same_hand_idx[p]);
        if (gpu.d_initial_weights[p]) cudaFree(gpu.d_initial_weights[p]);
    }
    gpu.initialized = false;
}

} // namespace postflop
#endif
