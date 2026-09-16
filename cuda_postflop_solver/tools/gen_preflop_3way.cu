#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <cmath>
#include <vector>
#include <string>
#include <chrono>
#include <algorithm>
#include <omp.h>
#include "cuda_compat.h"
#include "card.h"
#include "hand_evaluator.h"
#include "preflop_engine.h"

using namespace postflop;
using namespace postflop::preflop;

struct ClassDesc { int r_hi, r_lo; bool pair, suited; };

static ClassDesc describe(uint16_t cls) {
    ClassDesc d{};
    if (cls <= 12) { d.pair = true; d.r_hi = d.r_lo = 12 - cls; return d; }
    size_t idx = (cls >= 91) ? (cls - 91) : (cls - 13);
    d.suited = (cls < 91);
    for (int a = 2; a <= 13; ++a) {
        size_t base = (size_t)(a - 2) * (27 - a) / 2;
        size_t row_len = (size_t)(14 - a);
        if (idx >= base && idx < base + row_len) {
            int b = (int)(a + 1 + (idx - base));
            d.r_hi = 14 - a;
            d.r_lo = 14 - b;
            return d;
        }
    }
    d.r_hi = 12; d.r_lo = 11; return d;
}

static bool triplet_reps(uint16_t c0, uint16_t c1, uint16_t c2, Card out[6]) {
    uint64_t used = 0;
    const uint16_t classes[3] = {c0, c1, c2};
    for (int seat = 0; seat < 3; ++seat) {
        ClassDesc d = describe(classes[seat]);
        bool placed = false;
        if (d.pair) {
            for (int s0 = 0; s0 < 4 && !placed; ++s0) {
                for (int s1 = 0; s1 < 4 && !placed; ++s1) {
                    if (s0 == s1) continue;
                    Card a = make_card(d.r_hi, s0);
                    Card b = make_card(d.r_lo, s1);
                    uint64_t m = card_to_bit(a) | card_to_bit(b);
                    if ((used & m) == 0) {
                        used |= m;
                        out[seat * 2] = a; out[seat * 2 + 1] = b;
                        placed = true;
                    }
                }
            }
        } else if (d.suited) {
            for (int s = 0; s < 4 && !placed; ++s) {
                Card a = make_card(d.r_hi, s);
                Card b = make_card(d.r_lo, s);
                uint64_t m = card_to_bit(a) | card_to_bit(b);
                if ((used & m) == 0) {
                    used |= m;
                    out[seat * 2] = a; out[seat * 2 + 1] = b;
                    placed = true;
                }
            }
        } else {
            for (int s0 = 0; s0 < 4 && !placed; ++s0) {
                for (int s1 = 0; s1 < 4 && !placed; ++s1) {
                    if (s0 == s1) continue;
                    Card a = make_card(d.r_hi, s0);
                    Card b = make_card(d.r_lo, s1);
                    uint64_t m = card_to_bit(a) | card_to_bit(b);
                    if ((used & m) == 0) {
                        used |= m;
                        out[seat * 2] = a; out[seat * 2 + 1] = b;
                        placed = true;
                    }
                }
            }
        }
        if (!placed) return false;
    }
    return true;
}

#define MAX_BLOCK_THREADS 256

__device__ __host__ __forceinline__
static uint32_t sm32(uint32_t x) {
    x += 0x9E3779B9u;
    x = (x ^ (x >> 16)) * 0x85EBCA6Bu;
    x = (x ^ (x >> 13)) * 0xC2B2AE35u;
    return x ^ (x >> 16);
}

__global__
void kernel_3way_mc(
    const Card* __restrict__ d_reps,
    const int*  __restrict__ d_impossible,
    int num_cells, int samples,
    uint32_t seed_base,
    float* __restrict__ d_out)
{
    int cell = blockIdx.x;
    if (cell >= num_cells) return;

    if (d_impossible[cell]) {
        d_out[cell * 3 + 0] = 1.0f / 3.0f;
        d_out[cell * 3 + 1] = 1.0f / 3.0f;
        d_out[cell * 3 + 2] = 1.0f / 3.0f;
        return;
    }

    Card h0c1 = d_reps[cell * 6 + 0], h0c2 = d_reps[cell * 6 + 1];
    Card h1c1 = d_reps[cell * 6 + 2], h1c2 = d_reps[cell * 6 + 3];
    Card h2c1 = d_reps[cell * 6 + 4], h2c2 = d_reps[cell * 6 + 5];

    int tid = threadIdx.x;
    uint32_t rng = sm32(seed_base ^ (uint32_t)((uint32_t)cell * 2654435761u + 0x9E3779B9u) ^ (uint32_t)(tid * 40503u + 7u));

    double acc0 = 0.0, acc1 = 0.0, acc2 = 0.0;
    double my_samples = 0.0;
    Card avail[46];

    for (int s = tid; s < samples; s += blockDim.x) {
        int na = 0;
        for (Card c = 0; c < 52; ++c) {
            if (c != h0c1 && c != h0c2 && c != h1c1 && c != h1c2 &&
                c != h2c1 && c != h2c2) {
                avail[na++] = c;
            }
        }
        for (int k = 0; k < 5; ++k) {
            rng = rng * 1664525u + 1013904223u;
            int j = (int)((rng >> 8) % (uint32_t)(na - k));
            int tail = na - 1 - k;
            Card tmp = avail[j]; avail[j] = avail[tail]; avail[tail] = tmp;
        }
        Card b0 = avail[na - 1], b1 = avail[na - 2], b2 = avail[na - 3];
        Card b3 = avail[na - 4], b4 = avail[na - 5];

        Card c7_0[7] = {h0c1, h0c2, b0, b1, b2, b3, b4};
        Card c7_1[7] = {h1c1, h1c2, b0, b1, b2, b3, b4};
        Card c7_2[7] = {h2c1, h2c2, b0, b1, b2, b3, b4};
        int s0 = evaluate(c7_0, 7);
        int s1 = evaluate(c7_1, 7);
        int s2 = evaluate(c7_2, 7);

        int best = s0;
        if (s1 > best) best = s1;
        if (s2 > best) best = s2;

        int winners = 0;
        if (s0 == best) ++winners;
        if (s1 == best) ++winners;
        if (s2 == best) ++winners;
        double share = 1.0 / (double)winners;
        if (s0 == best) acc0 += share;
        if (s1 == best) acc1 += share;
        if (s2 == best) acc2 += share;
        my_samples += 1.0;
    }

    __shared__ double sh0[MAX_BLOCK_THREADS];
    __shared__ double sh1[MAX_BLOCK_THREADS];
    __shared__ double sh2[MAX_BLOCK_THREADS];
    __shared__ double shn[MAX_BLOCK_THREADS];
    sh0[tid] = acc0; sh1[tid] = acc1; sh2[tid] = acc2; shn[tid] = my_samples;
    __syncthreads();

    if (tid == 0) {
        double a0 = 0.0, a1 = 0.0, a2 = 0.0, n = 0.0;
        for (int i = 0; i < (int)blockDim.x; ++i) {
            a0 += sh0[i]; a1 += sh1[i]; a2 += sh2[i]; n += shn[i];
        }
        if (n > 0.0) {
            double e0 = a0 / n, e1 = a1 / n, e2 = a2 / n;
            double sum = e0 + e1 + e2;
            if (sum > 0.0) { e0 /= sum; e1 /= sum; e2 /= sum; }
            d_out[cell * 3 + 0] = (float)e0;
            d_out[cell * 3 + 1] = (float)e1;
            d_out[cell * 3 + 2] = (float)e2;
        } else {
            d_out[cell * 3 + 0] = 1.0f / 3.0f;
            d_out[cell * 3 + 1] = 1.0f / 3.0f;
            d_out[cell * 3 + 2] = 1.0f / 3.0f;
        }
    }
}

int main(int argc, char** argv) {
    bool dry_run = false;
    int samples = 50000;
    std::string out_path = "preflop_3way.bin";
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--dry-run") == 0) dry_run = true;
        else if (std::strcmp(argv[i], "--samples") == 0 && i + 1 < argc) samples = std::atoi(argv[++i]);
        else if (std::strcmp(argv[i], "--out") == 0 && i + 1 < argc) out_path = argv[++i];
    }
    if (dry_run) {
        out_path = "preflop_3way_dryrun.bin";
        samples = 5000;
    }

    const int CLASS_LIMIT = dry_run ? 3 : (int)NUM_CLASSES;

    struct Cell { uint16_t c0, c1, c2; };
    std::vector<Cell> cells;
    for (int c0 = 0; c0 < CLASS_LIMIT; ++c0)
        for (int c1 = 0; c1 < CLASS_LIMIT; ++c1)
            for (int c2 = 0; c2 < CLASS_LIMIT; ++c2)
                cells.push_back({(uint16_t)c0, (uint16_t)c1, (uint16_t)c2});

    size_t total_cells = cells.size();
    std::vector<Card> reps(total_cells * 6, 0xFF);
    std::vector<int> impossible(total_cells, 0);

    for (size_t k = 0; k < total_cells; ++k) {
        Card r[6];
        if (triplet_reps(cells[k].c0, cells[k].c1, cells[k].c2, r)) {
            std::memcpy(reps.data() + k * 6, r, 6);
        } else {
            impossible[k] = 1;
        }
    }

    int num_gpus = 1;
    cudaGetDeviceCount(&num_gpus);
    if (dry_run) num_gpus = 1;

    std::printf("[gen3way] 🚀 Запуск генерации 3-Way тензора на %d GPU (Tesla T4)...\n", num_gpus);
    std::printf("[gen3way] Всего ячеек: %zu, сэмплов на ячейку: %d (Батч: 150 000)\n", total_cells, samples);
    std::fflush(stdout);

    std::vector<float> tensor(TENSOR_3WAY_FLOATS, 1.0f / 3.0f);
    std::vector<float> cell_out_global(total_cells * 3, 1.0f / 3.0f);

    auto t0 = std::chrono::high_resolution_clock::now();
    size_t BATCH_SIZE = 150000;

    #pragma omp parallel num_threads(num_gpus)
    {
        int gpu_id = omp_get_thread_num();
        CUDA_CHECK(cudaSetDevice(gpu_id));
        init_hand_table_on_gpu();

        #pragma omp for schedule(dynamic, 1)
        for (size_t b_start = 0; b_start < total_cells; b_start += BATCH_SIZE) {
            size_t b_count = std::min(BATCH_SIZE, total_cells - b_start);

            Card* d_reps = nullptr;
            int* d_imp = nullptr;
            float* d_out = nullptr;

            CUDA_CHECK(cudaMalloc(&d_reps, b_count * 6 * sizeof(Card)));
            CUDA_CHECK(cudaMalloc(&d_imp, b_count * sizeof(int)));
            CUDA_CHECK(cudaMalloc(&d_out, b_count * 3 * sizeof(float)));

            CUDA_CHECK(cudaMemcpy(d_reps, reps.data() + b_start * 6, b_count * 6 * sizeof(Card), cudaMemcpyHostToDevice));
            CUDA_CHECK(cudaMemcpy(d_imp, impossible.data() + b_start, b_count * sizeof(int), cudaMemcpyHostToDevice));

            uint32_t seed = 0xC0FFEE42u + (uint32_t)b_start;
            KERNEL_LAUNCH(kernel_3way_mc, (int)b_count, 256, d_reps, d_imp, (int)b_count, samples, seed, d_out);
            CUDA_CHECK(cudaGetLastError());
            CUDA_CHECK(cudaDeviceSynchronize());

            CUDA_CHECK(cudaMemcpy(cell_out_global.data() + b_start * 3, d_out, b_count * 3 * sizeof(float), cudaMemcpyDeviceToHost));

            CUDA_CHECK(cudaFree(d_reps));
            CUDA_CHECK(cudaFree(d_imp));
            CUDA_CHECK(cudaFree(d_out));

            if (gpu_id == 0 || total_cells <= BATCH_SIZE) {
                double pct = (double)(b_start + b_count) * 100.0 / total_cells;
                auto t_cur = std::chrono::high_resolution_clock::now();
                double elapsed = std::chrono::duration<double>(t_cur - t0).count();
                double eta = (elapsed / pct) * (100.0 - pct);
                std::printf("[gen3way] [GPU %d] Прогресс: %.1f%% (%zu/%zu) | Прошло: %.1f мин | ETA: %.1f мин\n",
                            gpu_id, pct, b_start + b_count, total_cells, elapsed / 60.0, eta / 60.0);
                std::fflush(stdout);
            }
        }
    }

    for (size_t k = 0; k < total_cells; ++k) {
        size_t base = ((size_t)cells[k].c0 * NUM_CLASSES + cells[k].c1) * NUM_CLASSES + cells[k].c2;
        tensor[base * NUM_3WAY_PLAYERS + 0] = cell_out_global[k * 3 + 0];
        tensor[base * NUM_3WAY_PLAYERS + 1] = cell_out_global[k * 3 + 1];
        tensor[base * NUM_3WAY_PLAYERS + 2] = cell_out_global[k * 3 + 2];
    }

    auto t1 = std::chrono::high_resolution_clock::now();
    double sec = std::chrono::duration<double>(t1 - t0).count();

    Preflop3WayEquityTable tbl;
    tbl.data = std::move(tensor);
    tbl.loaded = true;
    tbl.save(out_path);

    float aa = tbl.equity(0, 1, 2, 0);
    float kk = tbl.equity(0, 1, 2, 1);
    float qq = tbl.equity(0, 1, 2, 2);
    float s = aa + kk + qq;

    std::printf("[gen3way] УСПЕХ! Записан файл: %s\n", out_path.c_str());
    std::printf("[gen3way] Срез AA vs KK vs QQ: AA=%.4f, KK=%.4f, QQ=%.4f (Сумма: %.4f)\n", aa, kk, qq, s);

    // ── СТРОГО ДЛЯ CTEST: точный вывод, который проверяет тест ──
    if (dry_run) {
        bool fast_enough = sec < 5.0;
        bool sane = (aa > kk && kk > qq && aa > 0.55f && aa < 0.75f && std::fabs((double)s - 1.0) < 0.01);
        std::printf("[gen3way] DRY-RUN check: %.2fs (<5s: %s), AA>KK>QQ ordering + sum=1: %s\n",
                    sec, fast_enough ? "OK" : "FAIL", sane ? "OK" : "FAIL");
        std::fflush(stdout);
        if (!fast_enough || !sane) return 1;
    }

    return 0;
}
