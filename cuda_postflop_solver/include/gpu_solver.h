// ════════════════════════════════════════════════════════════════════════
// gpu_solver.h — GPU memory manager + persistent-tree-traversal solver
// ════════════════════════════════════════════════════════════════════════
// V4 architecture (fixes V3 DEFECT #1):
//
// V3 ERROR: solve_recursive (CPU) called CUDA kernels per-node, passing
// host pointers. This would crash (segfault on GPU memory access) and
// even with Unified Memory would add 5-10μs launch overhead × 400k calls
// = 2 seconds of pure overhead per iteration.
//
// V4 FIX: The ENTIRE game tree (node_arena + storage arenas + card data)
// is transferred to GPU device memory ONCE via cudaMemcpy. Then a single
// persistent-thread CUDA kernel traverses the whole tree on the device,
// doing all regret matching, FMA, and updates in GPU memory. Results are
// copied back to host at the end.
//
// Memory layout on device:
//   d_nodes[NUM_NODES]          — PostFlopNode array (read-only structure)
//   d_storage1[NUM_ELEMENTS]    — strategy_sum (read-write)
//   d_storage2[NUM_ELEMENTS]    — regrets (read-write)
//   d_private_cards[2][MAX_HANDS] — hole cards per player (read-only)
//   d_same_hand_idx[2][MAX_HANDS] — same-hand index (read-only)
//   d_initial_weights[2][MAX_HANDS] — initial reach (read-only)
//
// The persistent kernel uses a stack-based DFS traversal (no recursion
// on GPU — recursion is illegal in device code). Each thread block
// processes one subtree. Within a block, threads cooperate on the
// regret matching / FMA / update operations for the node's num_hands.
// ════════════════════════════════════════════════════════════════════════
#ifndef GPU_SOLVER_H
#define GPU_SOLVER_H

#include <cstdint>
#include "cuda_compat.h"
#include "card.h"
#include "game.h"

namespace postflop {

// GPU device memory manager. Transfers host data to device once,
// keeps it resident across iterations, copies back on demand.
struct GpuMemory {
    // Device pointers (allocated on first use, freed on destruction)
    PostFlopNode* d_nodes;
    float*        d_storage1;        // strategy_sum
    float*        d_storage2;        // regrets
    float*        d_storage_ip;
    float*        d_storage_chance;
    Card*         d_private_cards[2];   // [player][hand_idx] = (c1, c2) packed as 2 Cards
    uint16_t*     d_same_hand_idx[2];
    float*        d_initial_weights[2];

    // Card config (small, copied to __constant__ or global)
    Card          flop[3];
    Card          turn;
    Card          river;

    // Sizes
    int   num_nodes;
    int   num_storage;
    int   num_storage_ip;
    int   num_storage_chance;
    int   num_hands[2];
    int   starting_pot;
    float rake_rate;
    float rake_cap;

    bool  initialized;

    GpuMemory() : d_nodes(nullptr), d_storage1(nullptr), d_storage2(nullptr),
                  d_storage_ip(nullptr), d_storage_chance(nullptr),
                  num_nodes(0), num_storage(0), num_storage_ip(0),
                  num_storage_chance(0), initialized(false) {
        d_private_cards[0] = d_private_cards[1] = nullptr;
        d_same_hand_idx[0] = d_same_hand_idx[1] = nullptr;
        d_initial_weights[0] = d_initial_weights[1] = nullptr;
    }
};

// Initialize GPU memory from a PostFlopGame. Transfers all data to device.
// Returns true on success. Subsequent calls are no-ops (data stays resident).
bool gpu_solver_init(const PostFlopGame& game, GpuMemory& gpu);

// Run one DCFR iteration entirely on GPU. Reads/writes device memory only.
// No host-device transfers during the iteration.
// Returns 0 on success, error code on failure.
int gpu_solve_step(GpuMemory& gpu, uint32_t current_iter);

// Copy results (storage1, storage2) back from device to host.
// Called after all iterations complete.
bool gpu_solver_copy_back(PostFlopGame& game, GpuMemory& gpu);

// Free device memory.
void gpu_solver_cleanup(GpuMemory& gpu);

} // namespace postflop

#endif // GPU_SOLVER_H
