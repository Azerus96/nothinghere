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

// ── ЯДРО 1: Проход ВНИЗ (Down-pass) ─────────────────────────────────────
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
    int h = threadIdx.x; 
    extern __shared__ float s_strategy[]; 

    if (node.is_chance()) {
        for (int opp_h = h; opp_h < num_hands_opp; opp_h += blockDim.x) {
            float my_reach = d_opp_reach[node_idx * num_hands_opp + opp_h];
            float scaled = my_reach / (float)num_actions;
            for (int a = 0; a < num_actions; ++a) {
                d_opp_reach[(node.children_offset + a) * num_hands_opp + opp_h] = scaled;
            }
        }
        return;
    }

    int node_player = node.player & 3;
    
    for (int opp_h = h; opp_h < num_hands_opp; opp_h += blockDim.x) {
        if (node_player != updating_player) {
            float sum_pos = 0.0f;
            float decode_mult = is_compressed ? (node.scale2 / 32767.0f) : 1.0f;
            for (int a = 0; a < num_actions; ++a) {
                float r = is_compressed ? (float)((const int16_t*)d_storage2)[node.storage2_offset + a*num_hands_opp + opp_h] * decode_mult
                                        : ((const float*)d_storage2)[node.storage2_offset + a*num_hands_opp + opp_h];
                if (r > 0.0f) sum_pos += r;
            }
            float inv = (sum_pos > 1e-7f) ? (1.0f / sum_pos) : 0.0f;
            float uniform = 1.0f / num_actions;
            for (int a = 0; a < num_actions; ++a) {
                float r = is_compressed ? (float)((const int16_t*)d_storage2)[node.storage2_offset + a*num_hands_opp + opp_h] * decode_mult
                                        : ((const float*)d_storage2)[node.storage2_offset + a*num_hands_opp + opp_h];
                s_strategy[a * blockDim.x + threadIdx.x] = (sum_pos > 1e-7f && r > 0.0f) ? (r * inv) : uniform;
            }
        }

        float my_reach = d_opp_reach[node_idx * num_hands_opp + opp_h];
        for (int a = 0; a < num_actions; ++a) {
            int child_idx = node.children_offset + a;
            if (node_player == updating_player) {
                d_opp_reach[child_idx * num_hands_opp + opp_h] = my_reach;
            } else {
                d_opp_reach[child_idx * num_hands_opp + opp_h] = my_reach * s_strategy[a * blockDim.x + threadIdx.x];
            }
        }
    }
}

// ── ЯДРО 2: Терминальный Fold ───────────────────────────────────────────
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
    
    int folded_player = node.player & 3;
    float pot = starting_pot + 2 * node.amount;
    float half_pot = 0.5f * pot;
    float rake = fminf(pot * rake_rate, rake_cap);
    float amount_win = (half_pot - rake) / opp_num_hands;
    float amount_lose = -half_pot / opp_num_hands;
    float payoff = (updating_player == folded_player) ? amount_lose : amount_win;

    extern __shared__ float s_cfreach_minus[]; 
    int tid = threadIdx.x;
    if (tid < 53) s_cfreach_minus[tid] = 0.0f;
    __syncthreads();

    const float* cfreach = d_opp_reach + node_idx * opp_num_hands;
    
    float my_sum = 0.0f;
    for (int i = tid; i < opp_num_hands; i += blockDim.x) {
        float w = cfreach[i];
        if (w != 0.0f) {
            my_sum += w;
            atomicAdd(&s_cfreach_minus[d_opp_cards[i * 2]], w);
            atomicAdd(&s_cfreach_minus[d_opp_cards[i * 2 + 1]], w);
        }
    }
    if (my_sum != 0.0f) atomicAdd(&s_cfreach_minus[52], my_sum);
    __syncthreads();

    float cfreach_sum = s_cfreach_minus[52];
    for (int h = tid; h < num_hands; h += blockDim.x) {
        Card c1 = d_my_cards[h * 2];
        Card c2 = d_my_cards[h * 2 + 1];
        float cfreach_same = 0.0f;
        uint16_t si = d_my_same[h];
        if (si != 0xFFFF) cfreach_same = cfreach[si];
        float total = cfreach_sum + cfreach_same - s_cfreach_minus[c1] - s_cfreach_minus[c2];
        d_node_cfv[node_idx * num_hands + h] = payoff * total;
    }
}

// ── ЯДРО 3: Терминальный Showdown ───────────────────────────────────────
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
    
    float pot = starting_pot + 2 * node.amount;
    float half_pot = 0.5f * pot;
    float rake = fminf(pot * rake_rate, rake_cap);
    float amount_win = (half_pot - rake) / opp_num_hands;
    float amount_lose = -half_pot / opp_num_hands;
    float amount_tie = -0.5f * rake / opp_num_hands;

    Card turn = node.turn;
    Card river = node.river;
    const float* cfreach = d_opp_reach + node_idx * opp_num_hands;

    extern __shared__ uint16_t s_opp_strengths[]; 
    int tid = threadIdx.x;
    
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

        float win_cfreach = 0, lose_cfreach = 0, tie_cfreach = 0;
        float minus_c1_win = 0, minus_c2_win = 0;
        float minus_c1_lose = 0, minus_c2_lose = 0;
        float minus_c1_tie = 0, minus_c2_tie = 0;

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

        float cfreach_same = 0.0f;
        uint16_t si = d_my_same[h];
        if (si != 0xFFFF) cfreach_same = cfreach[si];

        win_cfreach += cfreach_same - minus_c1_win - minus_c2_win;
        lose_cfreach += cfreach_same - minus_c1_lose - minus_c2_lose;
        tie_cfreach += cfreach_same - minus_c1_tie - minus_c2_tie;

        d_node_cfv[node_idx * num_hands + h] = 
            amount_win * win_cfreach + amount_lose * lose_cfreach + amount_tie * tie_cfreach;
    }
}

// ── ЯДРО 4: Проход ВВЕРХ (Up-pass) ──────────────────────────────────────
__global__
void kernel_up_pass(
    const int* __restrict__ d_nodes_at_depth,
    int num_nodes_this_depth,
    PostFlopNode* __restrict__ d_nodes, 
    uint8_t* __restrict__ d_storage1,   
    uint8_t* __restrict__ d_storage2,   
    float* __restrict__ d_node_cfv,
    float alpha_t, float beta_t, float gamma_t,
    int num_hands, int updating_player, bool is_compressed)
{
    int idx = blockIdx.x;
    if (idx >= num_nodes_this_depth) return;

    int node_idx = d_nodes_at_depth[idx];
    PostFlopNode& node = d_nodes[node_idx];
    if (node.is_terminal()) return;

    int num_actions = node.num_children;
    int h = threadIdx.x;

    if (node.is_chance()) {
        float sum_cfv = 0.0f;
        for (int a = 0; a < num_actions; ++a) {
            sum_cfv += d_node_cfv[(node.children_offset + a) * num_hands + h];
        }
        d_node_cfv[node_idx * num_hands + h] = sum_cfv;
        return;
    }

    int node_player = node.player & 3;
    extern __shared__ float s_mem[];
    float* s_strategy = s_mem;
    float* s_max_abs = s_strategy + num_actions * blockDim.x;

    float sum_pos = 0.0f;
    float decode_mult = is_compressed ? (node.scale2 / 32767.0f) : 1.0f;
    for (int a = 0; a < num_actions; ++a) {
        float r = is_compressed ? (float)((int16_t*)d_storage2)[node.storage2_offset + a*num_hands + h] * decode_mult
                                : ((float*)d_storage2)[node.storage2_offset + a*num_hands + h];
        if (r > 0.0f) sum_pos += r;
    }
    float inv = (sum_pos > 1e-7f) ? (1.0f / sum_pos) : 0.0f;
    float uniform = 1.0f / num_actions;
    for (int a = 0; a < num_actions; ++a) {
        float r = is_compressed ? (float)((int16_t*)d_storage2)[node.storage2_offset + a*num_hands + h] * decode_mult
                                : ((float*)d_storage2)[node.storage2_offset + a*num_hands + h];
        s_strategy[a * blockDim.x + h] = (sum_pos > 1e-7f && r > 0.0f) ? (r * inv) : uniform;
    }

    float my_cfv = 0.0f;
    if (node_player == updating_player) {
        for (int a = 0; a < num_actions; ++a) {
            my_cfv += s_strategy[a * blockDim.x + h] * d_node_cfv[(node.children_offset + a) * num_hands + h];
        }
    } else {
        for (int a = 0; a < num_actions; ++a) {
            my_cfv += d_node_cfv[(node.children_offset + a) * num_hands + h];
        }
    }
    d_node_cfv[node_idx * num_hands + h] = my_cfv;

    if (node_player == updating_player) {
        float local_max_regret = 0.0f;
        float local_max_strat = 0.0f;
        float decode_mult1 = is_compressed ? (node.scale1 / 32767.0f) : 1.0f;

        for (int a = 0; a < num_actions; ++a) {
            int mem_idx1 = node.storage1_offset + a * num_hands + h;
            int mem_idx2 = node.storage2_offset + a * num_hands + h;
            float child_cfv = d_node_cfv[(node.children_offset + a) * num_hands + h];

            float old_s = is_compressed ? (float)((int16_t*)d_storage1)[mem_idx1] * decode_mult1 : ((float*)d_storage1)[mem_idx1];
            float new_s = old_s * gamma_t + s_strategy[a * blockDim.x + h];
            if (fabsf(new_s) > local_max_strat) local_max_strat = fabsf(new_s);
            if (!is_compressed) ((float*)d_storage1)[mem_idx1] = new_s;
            else s_strategy[a * blockDim.x + h] = new_s; 

            float old_r = is_compressed ? (float)((int16_t*)d_storage2)[mem_idx2] * decode_mult : ((float*)d_storage2)[mem_idx2];
            float coef = (old_r >= 0.0f) ? alpha_t : beta_t;
            float new_r = old_r * coef + (child_cfv - my_cfv);
            new_r = (new_r > 0.0f) ? new_r : 0.0f;
            if (fabsf(new_r) > local_max_regret) local_max_regret = fabsf(new_r);
            if (!is_compressed) ((float*)d_storage2)[mem_idx2] = new_r;
            else d_node_cfv[(node.children_offset + a) * num_hands + h] = new_r; 
        }

        if (is_compressed) {
            s_max_abs[h] = fmaxf(local_max_regret, local_max_strat);
            __syncthreads();
            for (int s = blockDim.x / 2; s > 0; s >>= 1) {
                if (h < s) s_max_abs[h] = fmaxf(s_max_abs[h], s_max_abs[h + s]);
                __syncthreads();
            }
            __shared__ float new_scale;
            if (h == 0) {
                new_scale = s_max_abs[0] == 0.0f ? 1.0f : s_max_abs[0];
                node.scale1 = new_scale;
                node.scale2 = new_scale;
            }
            __syncthreads();

            float encode_mult = 32767.0f / new_scale;
            for (int a = 0; a < num_actions; ++a) {
                int mem_idx1 = node.storage1_offset + a * num_hands + h;
                int mem_idx2 = node.storage2_offset + a * num_hands + h;
                float s_val = s_strategy[a * blockDim.x + h];
                float r_val = d_node_cfv[(node.children_offset + a) * num_hands + h];
                ((int16_t*)d_storage1)[mem_idx1] = (int16_t)fmaxf(-32768.0f, fminf(32767.0f, roundf(s_val * encode_mult)));
                ((int16_t*)d_storage2)[mem_idx2] = (int16_t)fmaxf(-32768.0f, fminf(32767.0f, roundf(r_val * encode_mult)));
            }
        }
    }
}

// ── Оркестрация с хоста ─────────────────────────────────────────────────
bool gpu_solver_init(const PostFlopGame& game, GpuMemory& gpu) {
    if (gpu.initialized) return true;

    const auto& arena = game.node_arena();
    gpu.num_nodes = (int)arena.size();
    gpu.num_storage = (int)game.storage1_bytes();
    gpu.num_storage_ip = (int)game.storage_ip_bytes();
    gpu.num_storage_chance = (int)game.storage_chance_bytes();
    gpu.num_hands[0] = game.num_private_hands(0);
    gpu.num_hands[1] = game.num_private_hands(1);
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

    for (int p = 0; p < 2; ++p) {
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

    cudaMalloc(&gpu.d_node_cfreach, gpu.num_nodes * 1326 * sizeof(float));
    cudaMalloc(&gpu.d_node_cfv, gpu.num_nodes * 1326 * sizeof(float));

    gpu.initialized = true;
    return true;
}

int gpu_solve_step(GpuMemory& gpu, uint32_t current_iter) {
    if (!gpu.initialized) return -1;
    DiscountParams params = DiscountParams::from_iteration(current_iter);

    for (int p = 0; p < 2; ++p) {
        int opp = 1 - p;
        int num_hands_p = gpu.num_hands[p];
        int num_hands_opp = gpu.num_hands[opp];

        cudaMemcpy(gpu.d_node_cfreach, gpu.d_initial_weights[opp], num_hands_opp * sizeof(float), cudaMemcpyDeviceToDevice);

        for (int d = 0; d <= gpu.max_depth; ++d) {
            if (gpu.level_sizes[d] == 0) continue;
            size_t smem = 10 * 256 * sizeof(float); 
            kernel_down_pass<<<gpu.level_sizes[d], 256, smem>>>(
                gpu.d_levels[d], gpu.level_sizes[d], gpu.d_nodes, gpu.d_storage2, gpu.d_node_cfreach,
                num_hands_p, num_hands_opp, p, gpu.is_compressed
            );
        }

        if (gpu.num_fold_nodes > 0) {
            kernel_terminal_fold<<<gpu.num_fold_nodes, 256, 53 * sizeof(float)>>>(
                gpu.d_fold_nodes, gpu.num_fold_nodes, gpu.d_nodes, gpu.d_node_cfreach, gpu.d_node_cfv,
                gpu.d_private_cards[p], gpu.d_private_cards[opp], gpu.d_same_hand_idx[p],
                num_hands_p, num_hands_opp, gpu.starting_pot, gpu.rake_rate, gpu.rake_cap, p
            );
        }
        if (gpu.num_showdown_nodes > 0) {
            kernel_terminal_showdown<<<gpu.num_showdown_nodes, 256, 1326 * sizeof(uint16_t)>>>(
                gpu.d_showdown_nodes, gpu.num_showdown_nodes, gpu.d_nodes, gpu.d_node_cfreach, gpu.d_node_cfv,
                gpu.d_private_cards[p], gpu.d_private_cards[opp], gpu.d_same_hand_idx[p],
                num_hands_p, num_hands_opp, gpu.starting_pot, gpu.rake_rate, gpu.rake_cap,
                gpu.flop[0], gpu.flop[1], gpu.flop[2]
            );
        }

        for (int d = gpu.max_depth; d >= 0; --d) {
            if (gpu.level_sizes[d] == 0) continue;
            size_t smem = (10 * 256 + 256) * sizeof(float);
            kernel_up_pass<<<gpu.level_sizes[d], 256, smem>>>(
                gpu.d_levels[d], gpu.level_sizes[d], gpu.d_nodes, gpu.d_storage1, gpu.d_storage2, gpu.d_node_cfv,
                params.alpha_t, params.beta_t, params.gamma_t, num_hands_p, p, gpu.is_compressed
            );
        }
    }
    cudaDeviceSynchronize();
    return 0;
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
    for (int p = 0; p < 2; ++p) {
        if (gpu.d_private_cards[p]) cudaFree(gpu.d_private_cards[p]);
        if (gpu.d_same_hand_idx[p]) cudaFree(gpu.d_same_hand_idx[p]);
        if (gpu.d_initial_weights[p]) cudaFree(gpu.d_initial_weights[p]);
    }
    gpu.initialized = false;
}

} // namespace postflop
#endif
