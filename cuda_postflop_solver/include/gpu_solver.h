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
    
    // [Module 1, V8] MAX_PLAYERS pointer slots (V7 sized 6: kernels read
    // d_private_cards_ptrs[6..7] out of bounds in 7/8-handed games).
    Card*         d_private_cards[MAX_PLAYERS];   
    uint16_t*     d_same_hand_idx[MAX_PLAYERS];   
    float*        d_initial_weights[MAX_PLAYERS];
    int           num_hands[MAX_PLAYERS];

    float*        d_node_cfreach; 
    float*        d_node_cfv;     
    float*        d_all_reaches;  
    int**         d_levels;       
    int*          level_sizes;    
    int           max_depth;
    
    int*          d_fold_nodes;
    int*          d_showdown_nodes;
    int           num_fold_nodes;
    int           num_showdown_nodes;
    int*          d_rollout_nodes;      // Module 3.4: depth-capped multiway leaves
    int           num_rollout_nodes;

    int*          d_num_hands;
    Card**        d_private_cards_ptrs;

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
    int   num_players;
    bool  initialized;
    bool  is_compressed;

    // [Module 4, V8] ICM bubble factor mirrored from TreeConfig at init
    // (1.0 = pure Chip-EV). Passed to kernel_exact_820_showdown_leaf as a
    // launch argument; terminal fold/showdown kernels read the identical
    // value from every PostFlopNode::bubble_factor.
    float bubble_factor;
    
    uint8_t locked_players_mask;

    // RAII: releases all device (or compat host) buffers on destruction.
    ~GpuMemory();

    GpuMemory() : d_nodes(nullptr), d_storage1(nullptr), d_storage2(nullptr),
                  d_storage_ip(nullptr), d_storage_chance(nullptr),
                  d_node_cfreach(nullptr), d_node_cfv(nullptr), d_all_reaches(nullptr),
                  d_levels(nullptr), level_sizes(nullptr),
                  d_fold_nodes(nullptr), d_showdown_nodes(nullptr),
                  num_fold_nodes(0), num_showdown_nodes(0),
                  d_rollout_nodes(nullptr), num_rollout_nodes(0),
                  d_num_hands(nullptr), d_private_cards_ptrs(nullptr),
                  num_nodes(0), num_storage(0), num_storage_ip(0),
                  num_storage_chance(0), starting_pot(0), rake_rate(0.0f), rake_cap(0.0f),
                  num_players(2), initialized(false), is_compressed(false),
                  bubble_factor(1.0f),
                  locked_players_mask(0) {
        // [Module 1, V8] initialize the FULL MAX_PLAYERS slot range (V7
        // looped to 6 — seats 6/7 stayed uninitialized garbage pointers).
        for (int i = 0; i < MAX_PLAYERS; ++i) {
            d_private_cards[i] = nullptr;
            d_same_hand_idx[i] = nullptr;
            d_initial_weights[i] = nullptr;
            num_hands[i] = 0;
        }
    }
};

bool gpu_solver_init(const PostFlopGame& game, GpuMemory& gpu, int device_id = 0);
// Frees every buffer and resets the structure to a safe empty state
// (idempotent; called by the GpuMemory destructor).
int gpu_solve_step(GpuMemory& gpu, uint32_t current_iter);
int gpu_solve_step_dispatch(PostFlopGame& game, uint32_t current_iter);
bool gpu_solver_copy_back(PostFlopGame& game, GpuMemory& gpu);
void gpu_solver_cleanup(GpuMemory& gpu);

} // namespace postflop

#endif // GPU_SOLVER_H
