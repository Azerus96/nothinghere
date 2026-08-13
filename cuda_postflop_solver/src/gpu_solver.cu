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

// ── ЯДРО 1: Проход ВНИЗ ─────────────────────────────────────────────────
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
    bool is_compressed)
{
    int idx = blockIdx.x;
    if (idx >= num_nodes_this_depth) return;
    
    int node_idx = d_nodes_at_depth[idx];
    const PostFlopNode& node = d_nodes[node_idx];
    if (node.is_terminal()) return;

    int node_player = node.player & 7;
    int num_actions = node.num_children;
    int tid = threadIdx.x; 

    for (int p = 0; p < NUM_PLAYERS; ++p) {
        if (p == updating_player) continue;
        
        int hands_p = d_num_hands[p];
        float* p_reach_in = &d_all_reaches[p * (gridDim.x * MAX_HANDS) + node_idx * MAX_HANDS];
        
        for (int h = tid; h < hands_p; h += blockDim.x) {
            float my_reach = p_reach_in[h];
            
            if (node.is_chance()) {
                float chance_factor = (node.turn == 255) ? 45.0f : 44.0f;
                float scaled = my_reach / chance_factor;
                for (int a = 0; a < num_actions; ++a) {
                    d_all_reaches[p * (gridDim.x * MAX_HANDS) + (node.children_offset + a) * MAX_HANDS + h] = scaled;
                }
            } else if (node_player == p) {
                float sum_pos = 0.0f;
                float s2 = node.scale2; if (s2 == 0.0f) s2 = 1.0f;
                float decode_mult = is_compressed ? (s2 / 32767.0f) : 1.0f;
                
                for (int a = 0; a < num_actions; ++a) {
                    int mem_idx = node.storage2_offset + a * hands_p + h;
                    float r = is_compressed ? (float)((const int16_t*)d_storage2)[mem_idx] * decode_mult
                                            : ((const float*)d_storage2)[mem_idx];
                    if (r > 0.0f) sum_pos += r;
                }
                
                float inv = (sum_pos > 1e-7f) ? (1.0f / sum_pos) : 0.0f;
                float uniform = 1.0f / num_actions;
                
                for (int a = 0; a < num_actions; ++a) {
                    int mem_idx = node.storage2_offset + a * hands_p + h;
                    float r = is_compressed ? (float)((const int16_t*)d_storage2)[mem_idx] * decode_mult
                                            : ((const float*)d_storage2)[mem_idx];
                    float strat_val = (sum_pos > 1e-7f) ? ((r > 0.0f) ? (r * inv) : 0.0f) : uniform;
                    d_all_reaches[p * (gridDim.x * MAX_HANDS) + (node.children_offset + a) * MAX_HANDS + h] = my_reach * strat_val;
                }
            } else {
                for (int a = 0; a < num_actions; ++a) {
                    d_all_reaches[p * (gridDim.x * MAX_HANDS) + (node.children_offset + a) * MAX_HANDS + h] = my_reach;
                }
            }
        }
    }
}

// ── ЯДРО 2: Терминальный Fold ───────────────────────────────────────────
template <int NUM_PLAYERS>
__global__ 
void kernel_terminal_fold(
    const int* __restrict__ d_fold_nodes, int num_nodes, 
    const PostFlopNode* __restrict__ d_nodes,
    const float* __restrict__ d_all_reaches, float* __restrict__ d_node_cfv,
    const int* __restrict__ d_num_hands,
    int starting_pot, int updating_player)
{
    int idx = blockIdx.x;
    if (idx >= num_nodes) return;
    int node_idx = d_fold_nodes[idx];
    const PostFlopNode& node = d_nodes[node_idx];
    
    int folded_player = node.player & 7;
    int tid = threadIdx.x;
    int my_hands = d_num_hands[updating_player];

    if (updating_player == folded_player) {
        for (int h = tid; h < my_hands; h += blockDim.x) {
            d_node_cfv[node_idx * MAX_HANDS + h] = 0.0f;
        }
    } else {
        double pot = starting_pot + NUM_PLAYERS * node.amount;
        double win_prob = 1.0;

        for (int p = 0; p < NUM_PLAYERS; ++p) {
            if (p == updating_player) continue;
            const float* cfreach = &d_all_reaches[p * (gridDim.x * MAX_HANDS) + node_idx * MAX_HANDS];
            double sum_reach = 0.0;
            for (int i = tid; i < d_num_hands[p]; i += blockDim.x) {
                sum_reach += cfreach[i];
            }
            for (int offset = 16; offset > 0; offset /= 2) {
                sum_reach += __shfl_down_sync(0xffffffff, sum_reach, offset);
            }
            __shared__ double s_sum;
            if (tid == 0) s_sum = sum_reach;
            __syncthreads();
            win_prob *= s_sum;
        }
        
        for (int h = tid; h < my_hands; h += blockDim.x) {
            d_node_cfv[node_idx * MAX_HANDS + h] = (float)(pot * win_prob);
        }
    }
}

// ── ЯДРО 3: Терминальный Showdown (ИДЕАЛЬНАЯ МАТЕМАТИКА МУЛЬТИВЕЯ) ──────
template <int NUM_PLAYERS>
__global__ 
void kernel_terminal_showdown(
    const int* __restrict__ d_showdown_nodes, int num_nodes, 
    const PostFlopNode* __restrict__ d_nodes,
    const float* __restrict__ d_all_reaches, float* __restrict__ d_node_cfv,
    Card** d_private_cards,
    const int* __restrict__ d_num_hands,
    int starting_pot, Card flop0, Card flop1, Card flop2)
{
    int idx = blockIdx.x;
    if (idx >= num_nodes) return;
    int node_idx = d_showdown_nodes[idx];
    const PostFlopNode& node = d_nodes[node_idx];
    
    Card turn = node.turn;
    Card river = node.river;
    int tid = threadIdx.x;
    int updating_player = blockIdx.y; // Запускаем 2D сетку: x=узлы, y=игроки
    int my_hands = d_num_hands[updating_player];
    double pot = starting_pot + NUM_PLAYERS * node.amount;

    for (int h = tid; h < my_hands; h += blockDim.x) {
        Card c1 = d_private_cards[updating_player][h*2];
        Card c2 = d_private_cards[updating_player][h*2+1];
        Card mcards[7] = {c1, c2, flop0, flop1, flop2, turn, river};
        uint16_t my_strength = evaluate(mcards, 7);

        double win_prob = 1.0;
        // ЧЕСТНЫЙ ЦИКЛ ПО ВСЕМ ОППОНЕНТАМ
        for (int p = 0; p < NUM_PLAYERS; ++p) {
            if (p == updating_player) continue;
            
            const float* cfreach = &d_all_reaches[p * (gridDim.x * MAX_HANDS) + node_idx * MAX_HANDS];
            double beat_reach = 0.0;
            
            for (int oh = 0; oh < d_num_hands[p]; ++oh) {
                float w = cfreach[oh];
                if (w > 0.0f) {
                    Card oc1 = d_private_cards[p][oh*2];
                    Card oc2 = d_private_cards[p][oh*2+1];
                    Card ocards[7] = {oc1, oc2, flop0, flop1, flop2, turn, river};
                    uint16_t opp_strength = evaluate(ocards, 7);
                    if (my_strength > opp_strength) {
                        beat_reach += w;
                    }
                }
            }
            win_prob *= beat_reach;
        }
        d_node_cfv[node_idx * MAX_HANDS + h] = (float)(pot * win_prob);
    }
}

// ── ЯДРО 4: Проход ВВЕРХ ────────────────────────────────────────────────
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

        int node_player = node.player & 7;

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

        float my_cfv = 0.0f;
        for (int a = 0; a < num_actions; ++a) {
            int mem_idx = node.storage2_offset + a * my_hands + h;
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
                int mem_idx1 = node.storage1_offset + a * my_hands + h;
                int mem_idx2 = node.storage2_offset + a * my_hands + h;
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
    gpu.num_players = game.num_players();
    
    cudaMalloc(&gpu.d_num_hands, gpu.num_players * sizeof(int));
    cudaMemcpy(gpu.d_num_hands, gpu.num_hands, gpu.num_players * sizeof(int), cudaMemcpyHostToDevice);
    
    for (int p = 0; p < gpu.num_players; ++p) {
        gpu.num_hands[p] = game.num_private_hands(p);
    }
    
    gpu.starting_pot = game.tree_config().starting_pot;
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

    Card* h_private_cards_ptrs[6];
    for (int p = 0; p < gpu.num_players; ++p) {
        int nh = gpu.num_hands[p];
        std::vector<Card> cards_flat(nh * 2);
        for (int i = 0; i < nh; ++i) {
            cards_flat[i*2]   = cc.private_cards[p][i].first;
            cards_flat[i*2+1] = cc.private_cards[p][i].second;
        }
        cudaMalloc(&gpu.d_private_cards[p], nh * 2 * sizeof(Card));
        cudaMemcpy(gpu.d_private_cards[p], cards_flat.data(), nh * 2 * sizeof(Card), cudaMemcpyHostToDevice);
        h_private_cards_ptrs[p] = gpu.d_private_cards[p];
        
        cudaMalloc(&gpu.d_initial_weights[p], nh * sizeof(float));
        cudaMemcpy(gpu.d_initial_weights[p], cc.initial_weights[p].data(), nh * sizeof(float), cudaMemcpyHostToDevice);
    }
    cudaMalloc(&gpu.d_private_cards_ptrs, 6 * sizeof(Card*));
    cudaMemcpy(gpu.d_private_cards_ptrs, h_private_cards_ptrs, 6 * sizeof(Card*), cudaMemcpyHostToDevice);

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

    cudaMalloc(&gpu.d_all_reaches, gpu.num_players * gpu.num_nodes * MAX_HANDS * sizeof(float));
    cudaMalloc(&gpu.d_node_cfv, gpu.num_nodes * MAX_HANDS * sizeof(float));

    gpu.initialized = true;
    return true;
}

template <int NUM_PLAYERS>
int gpu_solve_step_impl(GpuMemory& gpu, uint32_t current_iter) {
    DiscountParams params = DiscountParams::from_iteration(current_iter);

    for (int p = 0; p < NUM_PLAYERS; ++p) {
        for (int opp = 0; opp < NUM_PLAYERS; ++opp) {
            if (opp == p) continue;
            cudaMemcpy(gpu.d_all_reaches + opp * (gpu.num_nodes * MAX_HANDS), 
                       gpu.d_initial_weights[opp], gpu.num_hands[opp] * sizeof(float), cudaMemcpyDeviceToDevice);
        }

        for (int d = 0; d <= gpu.max_depth; ++d) {
            if (gpu.level_sizes[d] == 0) continue;
            kernel_down_pass<NUM_PLAYERS><<<gpu.level_sizes[d], 256>>>(
                gpu.d_levels[d], gpu.level_sizes[d], gpu.d_nodes, gpu.d_storage2, gpu.d_all_reaches,
                gpu.d_num_hands, p, gpu.is_compressed
            );
        }

        if (gpu.num_fold_nodes > 0) {
            kernel_terminal_fold<NUM_PLAYERS><<<gpu.num_fold_nodes, 256>>>(
                gpu.d_fold_nodes, gpu.num_fold_nodes, gpu.d_nodes, gpu.d_all_reaches, gpu.d_node_cfv,
                gpu.d_num_hands, gpu.starting_pot, p
            );
        }
        if (gpu.num_showdown_nodes > 0) {
            dim3 blocks(gpu.num_showdown_nodes, NUM_PLAYERS);
            kernel_terminal_showdown<NUM_PLAYERS><<<blocks, 256>>>(
                gpu.d_showdown_nodes, gpu.num_showdown_nodes, gpu.d_nodes, gpu.d_all_reaches, gpu.d_node_cfv,
                gpu.d_private_cards_ptrs, gpu.d_num_hands, gpu.starting_pot,
                gpu.flop[0], gpu.flop[1], gpu.flop[2]
            );
        }

        for (int d = gpu.max_depth; d >= 0; --d) {
            if (gpu.level_sizes[d] == 0) continue;
            kernel_up_pass<NUM_PLAYERS><<<gpu.level_sizes[d], 256>>>(
                gpu.d_levels[d], gpu.level_sizes[d], gpu.d_nodes, gpu.d_storage1, gpu.d_storage2, gpu.d_node_cfv,
                params.alpha_t, params.beta_t, params.gamma_t, gpu.d_num_hands, p, gpu.is_compressed
            );
        }
    }
    cudaDeviceSynchronize();
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
    cudaMemcpy(game.storage1_data_mut(), gpu.d_storage1, gpu.num_storage, cudaMemcpyDeviceToHost);
    cudaMemcpy(game.storage2_data_mut(), gpu.d_storage2, gpu.num_storage, cudaMemcpyDeviceToHost);
    return true;
}

void gpu_solver_cleanup(GpuMemory& gpu) {
    if (gpu.d_nodes) cudaFree(gpu.d_nodes);
    if (gpu.d_storage1) cudaFree(gpu.d_storage1);
    if (gpu.d_storage2) cudaFree(gpu.d_storage2);
    if (gpu.d_all_reaches) cudaFree(gpu.d_all_reaches);
    if (gpu.d_node_cfv) cudaFree(gpu.d_node_cfv);
    if (gpu.d_fold_nodes) cudaFree(gpu.d_fold_nodes);
    if (gpu.d_showdown_nodes) cudaFree(gpu.d_showdown_nodes);
    if (gpu.d_num_hands) cudaFree(gpu.d_num_hands);
    if (gpu.d_private_cards_ptrs) cudaFree(gpu.d_private_cards_ptrs);
    for (int d = 0; d <= gpu.max_depth; ++d) if (gpu.d_levels[d]) cudaFree(gpu.d_levels[d]);
    delete[] gpu.d_levels;
    delete[] gpu.level_sizes;
    for (int p = 0; p < gpu.num_players; ++p) {
        if (gpu.d_private_cards[p]) cudaFree(gpu.d_private_cards[p]);
        if (gpu.d_initial_weights[p]) cudaFree(gpu.d_initial_weights[p]);
    }
    gpu.initialized = false;
}

} // namespace postflop
#endif
