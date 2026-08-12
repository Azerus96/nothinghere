// ════════════════════════════════════════════════════════════════════════
// gpu_solver.h — GPU memory manager + Level-by-Level BFS solver
// ════════════════════════════════════════════════════════════════════════
#ifndef GPU_SOLVER_H
#define GPU_SOLVER_H

#include <cstdint>
#include "cuda_compat.h"
#include "card.h"
#include "game.h"

namespace postflop {

struct GpuMemory {
    PostFlopNode* d_nodes;
    uint8_t*      d_storage1;        
    uint8_t*      d_storage2;        
    uint8_t*      d_storage_ip;
    uint8_t*      d_storage_chance;
    
    // Поддержка до 6 игроков
    Card*         d_private_cards[6];   
    uint16_t*     d_same_hand_idx[6];
    float*        d_initial_weights[6];
    int           num_hands[6];
    int           num_players;

    // BFS Level data
    float*        d_node_cfreach; 
    float*        d_node_cfv;     
    float*        d_all_reaches;  // Для мультивея
    int**         d_levels;       
    int*          level_sizes;    
    int           max_depth;
    
    // Terminal nodes
    int*          d_fold_nodes;
    int*          d_showdown_nodes;
    int           num_fold_nodes;
    int           num_showdown_nodes;

    Card          flop[3];
    Card          turn;
    Card          river;

    int   num_nodes;
    int   num_storage;
    int   num_storage_ip;
    int   num_storage_chance;
    int   starting_pot;
    float rake_rate;
    float rake_cap;

    bool  initialized;
    bool  is_compressed;

    GpuMemory() : d_nodes(nullptr), d_storage1(nullptr), d_storage2(nullptr),
                  d_storage_ip(nullptr), d_storage_chance(nullptr),
                  d_node_cfreach(nullptr), d_node_cfv(nullptr), d_all_reaches(nullptr),
                  d_levels(nullptr), level_sizes(nullptr),
                  d_fold_nodes(nullptr), d_showdown_nodes(nullptr),
                  num_nodes(0), num_storage(0), num_storage_ip(0),
                  num_storage_chance(0), num_players(2), initialized(false), is_compressed(false) {
        for (int i = 0; i < 6; ++i) {
            d_private_cards[i] = nullptr;
            d_same_hand_idx[i] = nullptr;
            d_initial_weights[i] = nullptr;
            num_hands[i] = 0;
        }
    }
};

bool gpu_solver_init(const PostFlopGame& game, GpuMemory& gpu);
int gpu_solve_step_dispatch(PostFlopGame& game, uint32_t current_iter);
bool gpu_solver_copy_back(PostFlopGame& game, GpuMemory& gpu);
void gpu_solver_cleanup(GpuMemory& gpu);

} // namespace postflop

#endif // GPU_SOLVER_H
