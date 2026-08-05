// ════════════════════════════════════════════════════════════════════════
// gpu_solver_stub.cpp — CPU-only stub for GPU solver
// ════════════════════════════════════════════════════════════════════════
// When CUDA is not available (CPU_ONLY build), these stubs allow the
// code to link. They print a warning and return false/-1.
// The real implementation is in gpu_solver.cu (compiled by nvcc).
// ════════════════════════════════════════════════════════════════════════
#include "gpu_solver.h"
#include <cstdio>

namespace postflop {

bool gpu_solver_init(const PostFlopGame& game, GpuMemory& gpu) {
    (void)game; (void)gpu;
    std::fprintf(stderr, "[GPU] Cannot init GPU solver — built CPU-only. "
                         "Rebuild with USE_CUDA=ON.\n");
    return false;
}

int gpu_solve_step(GpuMemory& gpu, uint32_t current_iter) {
    (void)gpu; (void)current_iter;
    return -1;
}

bool gpu_solver_copy_back(PostFlopGame& game, GpuMemory& gpu) {
    (void)game; (void)gpu;
    return false;
}

void gpu_solver_cleanup(GpuMemory& gpu) {
    (void)gpu;
}

} // namespace postflop
