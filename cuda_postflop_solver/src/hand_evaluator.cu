// ════════════════════════════════════════════════════════════════════════
// hand_evaluator.cu — CUDA kernels for batched hand evaluation (dual-build)
// ════════════════════════════════════════════════════════════════════════
// Compiles under nvcc (production) AND plain g++ -DCPU_ONLY=1 through
// cuda_compat.h. Grid-stride loops keep the flat kernels emulation-safe.
// ════════════════════════════════════════════════════════════════════════
#include "cuda_compat.h"
#include "hand_evaluator.h"
#include "card.h"
#include <cstdio>

#ifdef __CUDACC__
// The single global definition of the device symbol (linked thanks to
// CMAKE_CUDA_SEPARABLE_COMPILATION).
__constant__ int32_t g_hand_table_device[4824];
#endif

namespace postflop {

int init_hand_table_on_gpu(const int32_t* host_table) {
    if (!host_table) host_table = HAND_TABLE;
#ifdef __CUDACC__
    cudaError_t err = cudaMemcpyToSymbol(g_hand_table_device, host_table, 4824 * sizeof(int32_t));
    if (err != cudaSuccess) {
        fprintf(stderr, "cudaMemcpyToSymbol g_hand_table_device failed: %s\n", cudaGetErrorString(err));
        return -1;
    }
    return 0;
#else
    // CPU dual-build: evaluate() reads the host-side HAND_TABLE directly.
    return (host_table != nullptr) ? 0 : -1;
#endif
}

__global__
void evaluate_hands_batch_kernel(
    const Card* __restrict__ d_cards,   // [num_hands, 7]
    int num_hands,
    int32_t* __restrict__ d_strengths)  // [num_hands]
{
    for (int idx = blockIdx.x * blockDim.x + threadIdx.x;
         idx < num_hands;
         idx += gridDim.x * blockDim.x) {
        Card cards[7];
        #pragma unroll
        for (int i = 0; i < 7; ++i) cards[i] = d_cards[idx * 7 + i];
        d_strengths[idx] = evaluate(cards, 7);
    }
}

extern "C" int evaluate_hands_batch_gpu(
    const Card* d_cards,
    int num_hands,
    int32_t* d_strengths)
{
    int threads = 256;
    int blocks = (num_hands + threads - 1) / threads;
    if (blocks < 1) blocks = 1;
    KERNEL_LAUNCH(evaluate_hands_batch_kernel, blocks, threads, d_cards, num_hands, d_strengths);
    cudaError_t err = cudaGetLastError();
    if (err != cudaSuccess) {
        fprintf(stderr, "evaluate_hands_batch_kernel launch failed: %s\n", cudaGetErrorString(err));
        return -1;
    }
    return 0;
}

__global__
void evaluate_all_holes_on_board_kernel(
    Card b0, Card b1, Card b2, Card b3, Card b4,
    const Card* __restrict__ d_holes,     // [1326, 2]
    int32_t* __restrict__ d_strengths)    // [1326]
{
    for (int idx = blockIdx.x * blockDim.x + threadIdx.x;
         idx < 1326;
         idx += gridDim.x * blockDim.x) {
        Card h0 = d_holes[idx * 2];
        Card h1 = d_holes[idx * 2 + 1];
        Card cards[7] = {h0, h1, b0, b1, b2, b3, b4};
        d_strengths[idx] = evaluate(cards, 7);
    }
}

extern "C" int evaluate_all_holes_on_board_gpu(
    Card b0, Card b1, Card b2, Card b3, Card b4,
    const Card* d_holes,
    int32_t* d_strengths)
{
    int threads = 256;
    int blocks = (1326 + threads - 1) / threads;
    KERNEL_LAUNCH(evaluate_all_holes_on_board_kernel, blocks, threads,
                  b0, b1, b2, b3, b4, d_holes, d_strengths);
    cudaError_t err = cudaGetLastError();
    if (err != cudaSuccess) return -1;
    return 0;
}

__global__
void evaluate_holes_multi_board_kernel(
    const Card* __restrict__ d_boards,    // [N, 5]
    const Card* __restrict__ d_holes,     // [1326, 2]
    int N,
    int32_t* __restrict__ d_strengths)    // [N, 1326]
{
    for (int board_idx = blockIdx.x; board_idx < N; board_idx += gridDim.x) {
        for (int hole_idx = threadIdx.x + blockIdx.y * blockDim.x;
             hole_idx < 1326;
             hole_idx += blockDim.x * gridDim.y) {
            Card b0 = d_boards[board_idx * 5 + 0];
            Card b1 = d_boards[board_idx * 5 + 1];
            Card b2 = d_boards[board_idx * 5 + 2];
            Card b3 = d_boards[board_idx * 5 + 3];
            Card b4 = d_boards[board_idx * 5 + 4];
            Card h0 = d_holes[hole_idx * 2];
            Card h1 = d_holes[hole_idx * 2 + 1];
            Card cards[7] = {h0, h1, b0, b1, b2, b3, b4};
            d_strengths[board_idx * 1326 + hole_idx] = evaluate(cards, 7);
        }
    }
}

extern "C" int evaluate_holes_multi_board_gpu(
    const Card* d_boards,
    const Card* d_holes,
    int N,
    int32_t* d_strengths)
{
    dim3 threads(256);
    dim3 blocks(N > 0 ? N : 1, (1326 + 255) / 256);
    KERNEL_LAUNCH(evaluate_holes_multi_board_kernel, blocks, threads,
                  d_boards, d_holes, N, d_strengths);
    cudaError_t err = cudaGetLastError();
    if (err != cudaSuccess) return -1;
    return 0;
}

} // namespace postflop

extern "C" {
    int postflop_init_hand_table_gpu(const int32_t* host_table) {
        return postflop::init_hand_table_on_gpu(host_table);
    }
    int postflop_evaluate_hands_batch_gpu(
        const postflop::Card* d_cards, int num_hands,
        int32_t* d_strengths) {
        return postflop::evaluate_hands_batch_gpu(d_cards, num_hands, d_strengths);
    }
    int postflop_evaluate_holes_multi_board_gpu(
        const postflop::Card* d_boards,
        const postflop::Card* d_holes,
        int N, int32_t* d_strengths) {
        return postflop::evaluate_holes_multi_board_gpu(d_boards, d_holes, N, d_strengths);
    }
}
