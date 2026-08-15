// ════════════════════════════════════════════════════════════════════════
// gpu_solver_stub.cpp — CPU-only stub for GPU solver
// ════════════════════════════════════════════════════════════════════════
#include "gpu_solver.h"
#include <cstdio>

namespace postflop {

bool gpu_solver_init(const PostFlopGame& game, GpuMemory& gpu, int device_id) {
    (void)game; 
    (void)gpu; 
    (void)device_id;
    std::fprintf(stderr, "[GPU] Cannot init GPU solver — built CPU-only. "
                         "Rebuild with USE_CUDA=ON.\n");
    return false;
}

int gpu_solve_step(GpuMemory& gpu, uint32_t current_iter) {
    (void)gpu; 
    (void)current_iter;
    return -1;
}

int gpu_solve_step_dispatch(PostFlopGame& game, uint32_t current_iter) {
    (void)game; 
    (void)current_iter;
    return -1;
}

bool gpu_solver_copy_back(PostFlopGame& game, GpuMemory& gpu) {
    (void)game; 
    (void)gpu;
    return false;
}

void gpu_solver_cleanup(GpuMemory& gpu) {
    (void)gpu;
}

} // namespace postflop
