// ════════════════════════════════════════════════════════════════════════
// hand_evaluator.cu — CUDA kernels for batched hand evaluation
// ════════════════════════════════════════════════════════════════════════
// This file is compiled by nvcc when CUDA is available. It defines:
//   - __constant__ HAND_TABLE (4824 i32, 19,296 bytes)
//   - evaluate_hands_batch_kernel: 1 thread per hand
//   - evaluate_terminal_showdown_kernel: batched terminal eval
//
// For CPU-only builds (no CUDA), this file is NOT compiled — the .cpp file
// defines HAND_TABLE with regular `const` storage and the inline functions
// in hand_evaluator.h run on the host.
// ════════════════════════════════════════════════════════════════════════
#ifdef __CUDACC__

#include "cuda_compat.h"
#include "hand_evaluator.h"
#include "card.h"
#include <cstdio>

namespace postflop {

// Define __constant__ HAND_TABLE — populated via cudaMemcpyToSymbol at startup.
__constant__
int32_t HAND_TABLE[4824];

// Initialize HAND_TABLE on GPU. Call once at program start.
// Returns 0 on success.
extern "C" int init_hand_table_on_gpu(const int32_t* host_table) {
    cudaError_t err = cudaMemcpyToSymbol(HAND_TABLE, host_table, 4824 * sizeof(int32_t));
    if (err != cudaSuccess) {
        fprintf(stderr, "cudaMemcpyToSymbol HAND_TABLE failed: %s\n", cudaGetErrorString(err));
        return -1;
    }
    return 0;
}

// ── Kernel: evaluate a batch of 7-card hands in parallel ───────────────
// One thread per hand. Each thread reads 7 cards from d_cards[idx*7..idx*7+6]
// and writes the strength (1..4824) to d_strengths[idx].
__global__
void evaluate_hands_batch_kernel(
    const Card* __restrict__ d_cards,   // [num_hands * 7]
    int num_hands,
    int32_t* __restrict__ d_strengths)  // [num_hands]
{
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= num_hands) return;
    Card cards[7];
    #pragma unroll
    for (int i = 0; i < 7; ++i) cards[i] = d_cards[idx * 7 + i];
    d_strengths[idx] = evaluate(cards, 7);
}

// Host launcher for evaluate_hands_batch_kernel
// Returns 0 on success, -1 on failure.
extern "C" int evaluate_hands_batch_gpu(
    const Card* d_cards,
    int num_hands,
    int32_t* d_strengths)
{
    int threads = 256;
    int blocks = (num_hands + threads - 1) / threads;
    evaluate_hands_batch_kernel<<<blocks, threads>>>(d_cards, num_hands, d_strengths);
    cudaError_t err = cudaGetLastError();
    if (err != cudaSuccess) {
        fprintf(stderr, "evaluate_hands_batch_kernel launch failed: %s\n", cudaGetErrorString(err));
        return -1;
    }
    return 0;
}

// ── Kernel: evaluate all (hole, board) combos for a single board ───────
// For a fixed 5-card board, evaluate all 1326 hole card combinations.
// Output: d_strengths[1326] = strength of each (h0,h1,board) hand.
// d_holes: precomputed array of [h0,h1] pairs (1326 × 2 = 2652 bytes).
__global__
void evaluate_all_holes_on_board_kernel(
    Card b0, Card b1, Card b2, Card b3, Card b4,
    const Card* __restrict__ d_holes,    // [1326 * 2]
    int32_t* __restrict__ d_strengths)   // [1326]
{
    int idx = blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= 1326) return;
    Card h0 = d_holes[idx * 2];
    Card h1 = d_holes[idx * 2 + 1];
    Card cards[7] = {h0, h1, b0, b1, b2, b3, b4};
    d_strengths[idx] = evaluate(cards, 7);
}

// Host launcher
extern "C" int evaluate_all_holes_on_board_gpu(
    Card b0, Card b1, Card b2, Card b3, Card b4,
    const Card* d_holes,
    int32_t* d_strengths)
{
    int threads = 256;
    int blocks = (1326 + threads - 1) / threads;
    evaluate_all_holes_on_board_kernel<<<blocks, threads>>>(
        b0, b1, b2, b3, b4, d_holes, d_strengths);
    cudaError_t err = cudaGetLastError();
    if (err != cudaSuccess) return -1;
    return 0;
}

// ── Kernel: evaluate (hole, board) for ALL 1326 × N boards ─────────────
// For each of N board configurations (e.g., all 47 possible turn cards,
// or all 1081 possible river cards), evaluate all 1326 hole combos.
// Output: d_strengths[N * 1326], row-major: d_strengths[board_idx * 1326 + hole_idx]
//
// Each block handles one board. 1326 threads per block (or 256 with striding).
__global__
void evaluate_holes_multi_board_kernel(
    const Card* __restrict__ d_boards,    // [N * 5] board cards
    const Card* __restrict__ d_holes,     // [1326 * 2] hole pairs
    int N,
    int32_t* __restrict__ d_strengths)    // [N * 1326]
{
    int board_idx = blockIdx.x;
    int hole_idx  = threadIdx.x + blockIdx.y * blockDim.x;
    if (board_idx >= N || hole_idx >= 1326) return;

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

extern "C" int evaluate_holes_multi_board_gpu(
    const Card* d_boards,
    const Card* d_holes,
    int N,
    int32_t* d_strengths)
{
    dim3 threads(256);
    dim3 blocks(N, (1326 + 255) / 256);
    evaluate_holes_multi_board_kernel<<<blocks, threads>>>(
        d_boards, d_holes, N, d_strengths);
    cudaError_t err = cudaGetLastError();
    if (err != cudaSuccess) return -1;
    return 0;
}

} // namespace postflop

// C ABI wrappers for use from Python ctypes / Rust FFI
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

#endif // __CUDACC__
