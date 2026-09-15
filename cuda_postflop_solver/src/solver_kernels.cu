// ════════════════════════════════════════════════════════════════════════
// solver_kernels.cu — CUDA kernels for DCFR hot paths (dual-build)
// ════════════════════════════════════════════════════════════════════════
// Compiles under nvcc (production) AND plain g++ -DCPU_ONLY=1 via
// cuda_compat.h. All kernels use emulation-safe idioms:
//   * grid-stride loops for flat kernels, or
//   * per-block strided loops with __shared__ cooperation
//     (the CPU shim runs one emulated thread per block).
// [Defect 1.3] update_regret_kernel retains negative regrets.
// ════════════════════════════════════════════════════════════════════════
#include "cuda_compat.h"
#include "hand_evaluator.h"
#include "card.h"
#include "solver.h"
#include "game.h"
#include <cstdio>

namespace postflop {

// ── Kernel: regret matching (vectorized) ────────────────────────────────
__global__
void regret_matching_kernel(
    float* __restrict__ strategy,       // [num_actions, num_hands]
    const float* __restrict__ regret,   // [num_actions, num_hands]
    int num_actions,
    int num_hands)
{
    for (int h = blockIdx.x * blockDim.x + threadIdx.x;
         h < num_hands;
         h += gridDim.x * blockDim.x) {
        const float uniform = 1.0f / num_actions;

        float sum_positive = 0.0f;
        for (int a = 0; a < num_actions; ++a) {
            float r = __ldg(&regret[a * num_hands + h]);
            if (r > 0.0f) sum_positive += r;   // [Defect 1.3] positive part HERE only
        }

        if (sum_positive > 1e-7f) {
            for (int a = 0; a < num_actions; ++a) {
                float r = regret[a * num_hands + h];
                // True division (NOT r * (1/sum)): matches the CPU
                // regret_matching bit-for-bit; the reciprocal-multiply idiom
                // leaves phantom ULP-level regrets after alpha=0 resets that
                // regret matching amplifies into spurious pure strategies.
                strategy[a * num_hands + h] = (r > 0.0f) ? (r / sum_positive) : 0.0f;
            }
        } else {
            for (int a = 0; a < num_actions; ++a) {
                strategy[a * num_hands + h] = uniform;
            }
        }
    }
}

extern "C" int regret_matching_gpu(
    float* d_strategy, const float* d_regret,
    int num_actions, int num_hands)
{
    int threads = 256;
    int blocks = (num_hands + threads - 1) / threads;
    KERNEL_LAUNCH(regret_matching_kernel, blocks, threads,
                  d_strategy, d_regret, num_actions, num_hands);
    return cudaGetLastError() == cudaSuccess ? 0 : -1;
}

// ── Kernel: strategy × CFV FMA reduction ────────────────────────────────
__global__
void fma_strategy_cfv_kernel(
    float* __restrict__ result,             // [num_hands]
    const float* __restrict__ strategy,     // [num_actions, num_hands]
    const float* __restrict__ cfv,          // [num_actions, num_hands]
    int num_actions,
    int num_hands)
{
    for (int h = blockIdx.x * blockDim.x + threadIdx.x;
         h < num_hands;
         h += gridDim.x * blockDim.x) {
        float sum = 0.0f;
        for (int a = 0; a < num_actions; ++a) {
            sum += strategy[a * num_hands + h] * cfv[a * num_hands + h];
        }
        result[h] = sum;
    }
}

extern "C" int fma_strategy_cfv_gpu(
    float* d_result, const float* d_strategy, const float* d_cfv,
    int num_actions, int num_hands)
{
    int threads = 256;
    int blocks = (num_hands + threads - 1) / threads;
    KERNEL_LAUNCH(fma_strategy_cfv_kernel, blocks, threads,
                  d_result, d_strategy, d_cfv, num_actions, num_hands);
    return cudaGetLastError() == cudaSuccess ? 0 : -1;
}

// ── Kernel: cumulative regret update (DCFR) ────────────────────────────
// [Defect 1.3] NEGATIVE REGRETS ARE RETAINED in the arena: the CFR+ floor
// `new_r = max(0, new_r)` was removed; positive-part truncation happens
// exclusively in regret matching. beta_t = 0.5 is therefore reachable.
__global__
void update_regret_kernel(
    float* __restrict__ regret,             // [num_actions, num_hands]
    const float* __restrict__ cfv,          // [num_actions, num_hands]
    const float* __restrict__ result,       // [num_hands]
    int num_actions,
    int num_hands,
    float alpha_t,
    float beta_t)
{
    for (int h = blockIdx.x * blockDim.x + threadIdx.x;
         h < num_hands;
         h += gridDim.x * blockDim.x) {
        float r_h = result[h];
        for (int a = 0; a < num_actions; ++a) {
            int idx = a * num_hands + h;
            float old_r = regret[idx];
            float coef = (old_r >= 0.0f) ? alpha_t : beta_t;
            float imm_regret = cfv[idx] - r_h;
            regret[idx] = old_r * coef + imm_regret;   // negatives preserved
        }
    }
}

extern "C" int update_regret_gpu(
    float* d_regret, const float* d_cfv, const float* d_result,
    int num_actions, int num_hands,
    float alpha_t, float beta_t)
{
    int threads = 256;
    int blocks = (num_hands + threads - 1) / threads;
    KERNEL_LAUNCH(update_regret_kernel, blocks, threads,
                  d_regret, d_cfv, d_result, num_actions, num_hands, alpha_t, beta_t);
    return cudaGetLastError() == cudaSuccess ? 0 : -1;
}

// ── Kernel: cumulative strategy update (DCFR) ──────────────────────────
__global__
void update_strategy_sum_kernel(
    float* __restrict__ strategy_sum,       // [num_actions, num_hands]
    const float* __restrict__ strategy,     // [num_actions, num_hands]
    int num_actions,
    int num_hands,
    float gamma_t)
{
    for (int h = blockIdx.x * blockDim.x + threadIdx.x;
         h < num_hands;
         h += gridDim.x * blockDim.x) {
        for (int a = 0; a < num_actions; ++a) {
            int idx = a * num_hands + h;
            strategy_sum[idx] = strategy_sum[idx] * gamma_t + strategy[idx];
        }
    }
}

extern "C" int update_strategy_sum_gpu(
    float* d_strategy_sum, const float* d_strategy,
    int num_actions, int num_hands, float gamma_t)
{
    int threads = 256;
    int blocks = (num_hands + threads - 1) / threads;
    KERNEL_LAUNCH(update_strategy_sum_kernel, blocks, threads,
                  d_strategy_sum, d_strategy, num_actions, num_hands, gamma_t);
    return cudaGetLastError() == cudaSuccess ? 0 : -1;
}

// ── Kernel: terminal fold evaluation with inclusion-exclusion ──────────
// NOTE: the production pipeline terminal evaluators (net utilities per
// Defect 1.1) live in gpu_solver.cu (kernel_terminal_fold /
// kernel_terminal_showdown / kernel_rollout_showdown_leaf). The kernels
// below are the standalone library API retained for tooling/benchmarks.
__global__
void terminal_fold_kernel(
    float* __restrict__ result,                 // [num_hands]
    const Card* __restrict__ player_cards,      // [num_hands, 2]
    const Card* __restrict__ opp_cards,         // [opp_num_hands, 2]
    const float* __restrict__ cfreach,          // [opp_num_hands]
    const uint16_t* __restrict__ same_hand_idx, // [num_hands], 0xFFFF if none
    int num_hands,
    int opp_num_hands,
    float payoff)
{
    __shared__ float s_cfreach_minus[53];
    int tid = threadIdx.x;

    for (int c = tid; c < 53; c += blockDim.x) {
        s_cfreach_minus[c] = 0.0f;
    }
    __syncthreads();

    float my_sum = 0.0f;
    for (int i = tid; i < opp_num_hands; i += blockDim.x) {
        float w = cfreach[i];
        if (w != 0.0f) {
            my_sum += w;
            atomicAdd(&s_cfreach_minus[opp_cards[i * 2]],     w);
            atomicAdd(&s_cfreach_minus[opp_cards[i * 2 + 1]], w);
        }
    }
    if (my_sum != 0.0f) {
        atomicAdd(&s_cfreach_minus[52], my_sum);
    }
    __syncthreads();

    float cfreach_sum = s_cfreach_minus[52];

    for (int h = blockIdx.x * blockDim.x + tid;
         h < num_hands;
         h += gridDim.x * blockDim.x) {
        Card c1 = player_cards[h * 2];
        Card c2 = player_cards[h * 2 + 1];
        float cfreach_same = 0.0f;
        uint16_t si = same_hand_idx[h];
        if (si != 0xFFFF) cfreach_same = cfreach[si];

        float total = cfreach_sum + cfreach_same - s_cfreach_minus[c1] - s_cfreach_minus[c2];
        result[h] = payoff * total;
    }
}

extern "C" int terminal_fold_gpu(
    float* d_result,
    const Card* d_player_cards,
    const Card* d_opp_cards,
    const float* d_cfreach,
    const uint16_t* d_same_hand_idx,
    int num_hands, int opp_num_hands,
    float payoff)
{
    int threads = 256;
    int blocks = (num_hands + threads - 1) / threads;
    KERNEL_LAUNCH(terminal_fold_kernel, blocks, threads,
                  d_result, d_player_cards, d_opp_cards, d_cfreach, d_same_hand_idx,
                  num_hands, opp_num_hands, payoff);
    return cudaGetLastError() == cudaSuccess ? 0 : -1;
}

// ── Kernel: terminal showdown (binary search per hand) ─────────────────
__global__
void terminal_showdown_kernel(
    float* __restrict__ result,                     // [num_hands]
    const uint16_t* __restrict__ player_strengths,  // [num_hands]
    const uint16_t* __restrict__ opp_strengths,     // [opp_num_hands]
    const float* __restrict__ cfreach,              // [opp_num_hands]
    const float* __restrict__ opp_prefix_cfreach,   // [opp_num_hands+1] prefix sum (optional)
    const Card* __restrict__ player_cards,          // [num_hands, 2]
    const Card* __restrict__ opp_cards,             // [opp_num_hands, 2]
    const uint16_t* __restrict__ same_hand_idx,     // [num_hands]
    int num_hands,
    int opp_num_hands,
    float amount_win,
    float amount_lose,
    float amount_tie)
{
    for (int h = blockIdx.x * blockDim.x + threadIdx.x;
         h < num_hands;
         h += gridDim.x * blockDim.x) {
        uint16_t my_strength = player_strengths[h];
        Card c1 = player_cards[h * 2];
        Card c2 = player_cards[h * 2 + 1];

        int lo = 0, hi = opp_num_hands - 1;
        int first_ge = opp_num_hands;
        while (lo <= hi) {
            int mid = (lo + hi) >> 1;
            if (opp_strengths[mid] < my_strength) lo = mid + 1;
            else { first_ge = mid; hi = mid - 1; }
        }

        lo = 0; hi = opp_num_hands - 1;
        int first_gt = opp_num_hands;
        while (lo <= hi) {
            int mid = (lo + hi) >> 1;
            if (opp_strengths[mid] <= my_strength) lo = mid + 1;
            else { first_gt = mid; hi = mid - 1; }
        }

        float win_cfreach, lose_cfreach, tie_cfreach;
        if (opp_prefix_cfreach != nullptr) {
            win_cfreach = opp_prefix_cfreach[first_ge];
            lose_cfreach = opp_prefix_cfreach[opp_num_hands] - opp_prefix_cfreach[first_gt];
            tie_cfreach = opp_prefix_cfreach[first_gt] - opp_prefix_cfreach[first_ge];
        } else {
            win_cfreach = 0.0f;
            for (int i = 0; i < first_ge; ++i) win_cfreach += cfreach[i];
            lose_cfreach = 0.0f;
            for (int i = first_gt; i < opp_num_hands; ++i) lose_cfreach += cfreach[i];
            tie_cfreach = 0.0f;
            for (int i = first_ge; i < first_gt; ++i) tie_cfreach += cfreach[i];
        }

        float minus_c1_win = 0, minus_c2_win = 0;
        for (int i = 0; i < first_ge; ++i) {
            float w = cfreach[i];
            if (w != 0.0f) {
                if (opp_cards[i * 2] == c1 || opp_cards[i * 2 + 1] == c1) minus_c1_win += w;
                if (opp_cards[i * 2] == c2 || opp_cards[i * 2 + 1] == c2) minus_c2_win += w;
            }
        }
        float minus_c1_lose = 0, minus_c2_lose = 0;
        for (int i = first_gt; i < opp_num_hands; ++i) {
            float w = cfreach[i];
            if (w != 0.0f) {
                if (opp_cards[i * 2] == c1 || opp_cards[i * 2 + 1] == c1) minus_c1_lose += w;
                if (opp_cards[i * 2] == c2 || opp_cards[i * 2 + 1] == c2) minus_c2_lose += w;
            }
        }

        float cfreach_same = 0.0f;
        uint16_t si = same_hand_idx[h];
        if (si != 0xFFFF) cfreach_same = cfreach[si];

        win_cfreach += cfreach_same - minus_c1_win - minus_c2_win;
        lose_cfreach += cfreach_same - minus_c1_lose - minus_c2_lose;

        result[h] = amount_win * win_cfreach + amount_lose * lose_cfreach + amount_tie * tie_cfreach;
    }
}

extern "C" int terminal_showdown_gpu(
    float* d_result,
    const uint16_t* d_player_strengths,
    const uint16_t* d_opp_strengths,
    const float* d_cfreach,
    const Card* d_player_cards,
    const Card* d_opp_cards,
    const uint16_t* d_same_hand_idx,
    int num_hands, int opp_num_hands,
    float amount_win, float amount_lose, float amount_tie)
{
    int threads = 256;
    int blocks = (num_hands + threads - 1) / threads;
    KERNEL_LAUNCH(terminal_showdown_kernel, blocks, threads,
                  d_result, d_player_strengths, d_opp_strengths,
                  d_cfreach, (const float*)nullptr,
                  d_player_cards, d_opp_cards, d_same_hand_idx,
                  num_hands, opp_num_hands,
                  amount_win, amount_lose, amount_tie);
    return cudaGetLastError() == cudaSuccess ? 0 : -1;
}

// ── Kernel: best-response max over actions ──────────────────────────────
__global__
void max_over_actions_kernel(
    float* __restrict__ result,             // [num_hands]
    const float* __restrict__ cfv,          // [num_actions, num_hands]
    int num_actions,
    int num_hands)
{
    for (int h = blockIdx.x * blockDim.x + threadIdx.x;
         h < num_hands;
         h += gridDim.x * blockDim.x) {
        float m = cfv[h];
        for (int a = 1; a < num_actions; ++a) {
            float v = cfv[a * num_hands + h];
            if (v > m) m = v;
        }
        result[h] = m;
    }
}

extern "C" int max_over_actions_gpu(
    float* d_result, const float* d_cfv,
    int num_actions, int num_hands)
{
    int threads = 256;
    int blocks = (num_hands + threads - 1) / threads;
    KERNEL_LAUNCH(max_over_actions_kernel, blocks, threads,
                  d_result, d_cfv, num_actions, num_hands);
    return cudaGetLastError() == cudaSuccess ? 0 : -1;
}

// ── Kernel: normalize strategy ──────────────────────────────────────────
__global__
void normalize_strategy_kernel(
    float* __restrict__ strategy,
    int num_actions,
    int num_hands)
{
    for (int h = blockIdx.x * blockDim.x + threadIdx.x;
         h < num_hands;
         h += gridDim.x * blockDim.x) {
        float sum = 0.0f;
        for (int a = 0; a < num_actions; ++a) sum += strategy[a * num_hands + h];
        if (sum > 1e-7f) {
            float inv = 1.0f / sum;
            for (int a = 0; a < num_actions; ++a) strategy[a * num_hands + h] *= inv;
        } else {
            float u = 1.0f / num_actions;
            for (int a = 0; a < num_actions; ++a) strategy[a * num_hands + h] = u;
        }
    }
}

extern "C" int normalize_strategy_gpu(
    float* d_strategy, int num_actions, int num_hands)
{
    int threads = 256;
    int blocks = (num_hands + threads - 1) / threads;
    KERNEL_LAUNCH(normalize_strategy_kernel, blocks, threads,
                  d_strategy, num_actions, num_hands);
    return cudaGetLastError() == cudaSuccess ? 0 : -1;
}

// ── Compression kernels (disabled by default per Defect 1.9; retained for
//    constrained-VRAM targets) ──────────────────────────────────────────
__global__
void encode_i16_kernel(
    int16_t* __restrict__ dst,
    const float* __restrict__ src,
    int n,
    float inv_encoder)
{
    for (int i = blockIdx.x * blockDim.x + threadIdx.x;
         i < n;
         i += gridDim.x * blockDim.x) {
        float v = src[i] * inv_encoder;
        if (v > 32767.0f) v = 32767.0f;
        else if (v < -32768.0f) v = -32768.0f;
        dst[i] = (int16_t)__float2int_rn(v);
    }
}

__global__
void decode_i16_kernel(
    float* __restrict__ dst,
    const int16_t* __restrict__ src,
    int n,
    float decoder)
{
    for (int i = blockIdx.x * blockDim.x + threadIdx.x;
         i < n;
         i += gridDim.x * blockDim.x) {
        dst[i] = (float)src[i] * decoder;
    }
}

__global__
void max_abs_kernel(
    const float* __restrict__ src,
    int n,
    float* __restrict__ d_max)
{
    __shared__ float s_max[1024];
    int tid = threadIdx.x;
    int i = blockIdx.x * blockDim.x + tid;
    float my_max = 0.0f;
    while (i < n) {
        float v = fabsf(__ldg(&src[i]));
        if (v > my_max) my_max = v;
        i += gridDim.x * blockDim.x;
    }
    s_max[tid] = my_max;
    __syncthreads();

    for (int s = blockDim.x / 2; s > 0; s >>= 1) {
        if (tid < s && s_max[tid + s] > s_max[tid]) {
            s_max[tid] = s_max[tid + s];
        }
        __syncthreads();
    }

    if (tid == 0) {
        float old_val = *d_max;
        float new_val = s_max[0];
        while (new_val > old_val) {
            int* d_max_int = (int*)d_max;
            int old_int = __float_as_int(old_val);
            int new_int = __float_as_int(new_val);
            int prev = atomicCAS(d_max_int, old_int, new_int);
            if (prev == old_int) break;
            old_val = __int_as_float(prev);
        }
    }
}

} // namespace postflop

extern "C" {
    int postflop_regret_matching_gpu(
        float* d_strategy, const float* d_regret,
        int num_actions, int num_hands) {
        return postflop::regret_matching_gpu(d_strategy, d_regret, num_actions, num_hands);
    }
    int postflop_fma_strategy_cfv_gpu(
        float* d_result, const float* d_strategy, const float* d_cfv,
        int num_actions, int num_hands) {
        return postflop::fma_strategy_cfv_gpu(d_result, d_strategy, d_cfv, num_actions, num_hands);
    }
    int postflop_update_regret_gpu(
        float* d_regret, const float* d_cfv, const float* d_result,
        int num_actions, int num_hands, float alpha_t, float beta_t) {
        return postflop::update_regret_gpu(d_regret, d_cfv, d_result, num_actions, num_hands, alpha_t, beta_t);
    }
    int postflop_update_strategy_sum_gpu(
        float* d_strategy_sum, const float* d_strategy,
        int num_actions, int num_hands, float gamma_t) {
        return postflop::update_strategy_sum_gpu(d_strategy_sum, d_strategy, num_actions, num_hands, gamma_t);
    }
    int postflop_terminal_fold_gpu(
        float* d_result,
        const postflop::Card* d_player_cards,
        const postflop::Card* d_opp_cards,
        const float* d_cfreach,
        const uint16_t* d_same_hand_idx,
        int num_hands, int opp_num_hands, float payoff) {
        return postflop::terminal_fold_gpu(d_result, d_player_cards, d_opp_cards,
                                          d_cfreach, d_same_hand_idx,
                                          num_hands, opp_num_hands, payoff);
    }
    int postflop_terminal_showdown_gpu(
        float* d_result,
        const uint16_t* d_player_strengths,
        const uint16_t* d_opp_strengths,
        const float* d_cfreach,
        const postflop::Card* d_player_cards,
        const postflop::Card* d_opp_cards,
        const uint16_t* d_same_hand_idx,
        int num_hands, int opp_num_hands,
        float amount_win, float amount_lose, float amount_tie) {
        return postflop::terminal_showdown_gpu(d_result, d_player_strengths, d_opp_strengths,
                                              d_cfreach, d_player_cards, d_opp_cards,
                                              d_same_hand_idx, num_hands, opp_num_hands,
                                              amount_win, amount_lose, amount_tie);
    }
    int postflop_max_over_actions_gpu(
        float* d_result, const float* d_cfv,
        int num_actions, int num_hands) {
        return postflop::max_over_actions_gpu(d_result, d_cfv, num_actions, num_hands);
    }
    int postflop_normalize_strategy_gpu(
        float* d_strategy, int num_actions, int num_hands) {
        return postflop::normalize_strategy_gpu(d_strategy, num_actions, num_hands);
    }
}
