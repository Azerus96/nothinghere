#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <cmath>
#include <vector>
#include <array>
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

struct ClassDesc {
    int r_hi, r_lo;
    bool pair, suited;
};

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

static std::pair<Card, Card> hero_rep(uint16_t cls) {
    ClassDesc d = describe(cls);
    if (d.pair)   return {make_card(d.r_hi, 0), make_card(d.r_lo, 1)};
    if (d.suited) return {make_card(d.r_hi, 0), make_card(d.r_lo, 0)};
    return {make_card(d.r_hi, 0), make_card(d.r_lo, 1)};
}

static std::pair<Card, Card> villain_rep(uint16_t vcls, const std::pair<Card, Card>& hero, size_t want_variant) {
    ClassDesc d = describe(vcls);
    int h0 = card_suit(hero.first), h1 = card_suit(hero.second);
    int other[4]; int n_other = 0;
    for (int s = 0; s < 4; ++s) {
        if (s != h0 && s != h1) other[n_other++] = s;
    }
    int s0, s1;
    if (d.pair) {
        if (want_variant == 0 && n_other >= 2)      { s0 = other[0]; s1 = other[1]; }
        else if (want_variant == 1)                 { s0 = h0; s1 = (n_other >= 1 ? other[0] : h1); }
        else                                        { s0 = h0; s1 = h1; }
        if (s0 == s1) s1 = (s0 == 0) ? 1 : 0;
        return {make_card(d.r_hi, s0), make_card(d.r_lo, s1)};
    }
    if (d.suited) {
        s0 = (want_variant >= 1) ? h0 : other[0];
        return {make_card(d.r_hi, s0), make_card(d.r_lo, s0)};
    }
    if (want_variant == 0 && n_other >= 2)      { s0 = other[0]; s1 = other[1]; }
    else if (want_variant == 1)                 { s0 = h0; s1 = other[0]; }
    else                                        { s0 = h0; s1 = h1; }
    if (s0 == s1) s1 = (s0 == 0) ? 1 : 0;
    return {make_card(d.r_hi, s0), make_card(d.r_lo, s1)};
}

__global__
void kernel_exact_hu_bucket(
    const Card* __restrict__ hero_reps,
    const Card* __restrict__ villain_reps,
    int num_buckets,
    double* __restrict__ out)
{
    int bucket = blockIdx.x;
    if (bucket >= num_buckets) return;

    Card h1 = hero_reps[bucket * 2];
    Card h2 = hero_reps[bucket * 2 + 1];
    Card v1 = villain_reps[bucket * 2];
    Card v2 = villain_reps[bucket * 2 + 1];

    int tid = threadIdx.x;

    __shared__ Card deck[48];
    if (tid == 0) {
        int n = 0;
        for (Card c = 0; c < 52; ++c) {
            if (c != h1 && c != h2 && c != v1 && c != v2) deck[n++] = c;
        }
    }
    __syncthreads();

    __shared__ double sh_win[256];
    __shared__ double sh_tie[256];
    __shared__ long long sh_boards[256];

    double win = 0.0, tie = 0.0;
    long long boards = 0;
    Card h7[7] = {h1, h2, 0, 0, 0, 0, 0};
    Card v7[7] = {v1, v2, 0, 0, 0, 0, 0};

    for (int a = tid; a < 48; a += blockDim.x) {
        h7[2] = v7[2] = deck[a];
        for (int b = a + 1; b < 48; ++b) {
            h7[3] = v7[3] = deck[b];
            for (int c = b + 1; c < 48; ++c) {
                h7[4] = v7[4] = deck[c];
                for (int d = c + 1; d < 48; ++d) {
                    h7[5] = v7[5] = deck[d];
                    for (int e = d + 1; e < 48; ++e) {
                        h7[6] = v7[6] = deck[e];
                        int hs = evaluate(h7, 7);
                        int vs = evaluate(v7, 7);
                        if (hs > vs)      win += 1.0;
                        else if (hs == vs) tie += 1.0;
                        ++boards;
                    }
                }
            }
        }
    }

    sh_win[tid] = win;
    sh_tie[tid] = tie;
    sh_boards[tid] = boards;
    __syncthreads();

    if (tid == 0) {
        double W = 0.0, T = 0.0;
        long long B = 0;
        for (int t = 0; t < (int)blockDim.x; ++t) {
            W += sh_win[t];
            T += sh_tie[t];
            B += sh_boards[t];
        }
        out[bucket] = (B > 0) ? ((W + 0.5 * T) / (double)B) : 0.5;
    }
}

int main(int argc, char** argv) {
    const char* out_path = "preflop_table.bin";
    bool dry = false;
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--dry-run") == 0) dry = true;
        else out_path = argv[i];
    }
    std::string final_path = dry ? (std::string(out_path) + ".dryrun") : std::string(out_path);

    struct Bucket {
        uint16_t i, j;
        size_t v;
        std::pair<Card, Card> hrep, vrep;
    };
    std::vector<Bucket> buckets;
    long long fallbacks = 0;

    auto add_bucket = [&](uint16_t i, uint16_t j, size_t v) {
        std::pair<Card, Card> hrep = hero_rep(i);
        std::pair<Card, Card> vrep = villain_rep(j, hrep, v);
        size_t real_v = classify_suit_variant(hrep, vrep);
        if (real_v != v) ++fallbacks;
        buckets.push_back({i, j, v, hrep, vrep});
    };

    if (dry) {
        const uint16_t cls[3] = {0, 1, 2};
        for (int a = 0; a < 3; ++a)
            for (int b = a + 1; b < 3; ++b)
                add_bucket(cls[a], cls[b], 0);
    } else {
        for (uint16_t i = 0; i < NUM_CLASSES; ++i) {
            for (uint16_t j = i; j < NUM_CLASSES; ++j) {
                for (size_t v = 0; v < NUM_SUIT_VARIANTS; ++v) {
                    add_bucket(i, j, v);
                }
            }
        }
    }

    size_t total_buckets = buckets.size();
    std::vector<double> global_eq(total_buckets, 0.5);

    int num_gpus = 1;
    cudaGetDeviceCount(&num_gpus);
    if (dry) num_gpus = 1;

    std::printf("[gen] Запуск генерации HU таблицы (Exact C(48,5)) на %d GPU (Tesla T4)...\n", num_gpus);
    std::printf("[gen] Всего уникальных бакетов: %zu (Fallbacks: %lld)\n", total_buckets, fallbacks);
    std::fflush(stdout);

    auto t0 = std::chrono::high_resolution_clock::now();

    #pragma omp parallel num_threads(num_gpus)
    {
        int gpu_id = omp_get_thread_num();
        CUDA_CHECK(cudaSetDevice(gpu_id));
        init_hand_table_on_gpu();

        size_t chunk = (total_buckets + num_gpus - 1) / num_gpus;
        size_t start_idx = gpu_id * chunk;
        size_t end_idx = std::min(start_idx + chunk, total_buckets);
        size_t local_count = (end_idx > start_idx) ? (end_idx - start_idx) : 0;

        if (local_count > 0) {
            std::vector<Card> local_hreps(local_count * 2), local_vreps(local_count * 2);
            for (size_t k = 0; k < local_count; ++k) {
                size_t b_idx = start_idx + k;
                local_hreps[k * 2]     = buckets[b_idx].hrep.first;
                local_hreps[k * 2 + 1] = buckets[b_idx].hrep.second;
                local_vreps[k * 2]     = buckets[b_idx].vrep.first;
                local_vreps[k * 2 + 1] = buckets[b_idx].vrep.second;
            }

            Card *d_h = nullptr, *d_v = nullptr;
            double *d_res = nullptr;
            CUDA_CHECK(cudaMalloc(&d_h, local_count * 2 * sizeof(Card)));
            CUDA_CHECK(cudaMalloc(&d_v, local_count * 2 * sizeof(Card)));
            CUDA_CHECK(cudaMalloc(&d_res, local_count * sizeof(double)));

            CUDA_CHECK(cudaMemcpy(d_h, local_hreps.data(), local_count * 2 * sizeof(Card), cudaMemcpyHostToDevice));
            CUDA_CHECK(cudaMemcpy(d_v, local_vreps.data(), local_count * 2 * sizeof(Card), cudaMemcpyHostToDevice));

            KERNEL_LAUNCH(kernel_exact_hu_bucket, (int)local_count, 256, d_h, d_v, (int)local_count, d_res);
            CUDA_CHECK(cudaGetLastError());
            CUDA_CHECK(cudaDeviceSynchronize());

            CUDA_CHECK(cudaMemcpy(global_eq.data() + start_idx, d_res, local_count * sizeof(double), cudaMemcpyDeviceToHost));

            CUDA_CHECK(cudaFree(d_h));
            CUDA_CHECK(cudaFree(d_v));
            CUDA_CHECK(cudaFree(d_res));
        }
    }

    auto t1 = std::chrono::high_resolution_clock::now();
    double sec = std::chrono::duration<double>(t1 - t0).count();

    PreflopEquityTable tbl;
    tbl.data.assign(EQUITY_TABLE_SIZE, 0.5);
    for (size_t k = 0; k < total_buckets; ++k) {
        uint16_t i = buckets[k].i, j = buckets[k].j;
        size_t v = buckets[k].v;
        double e = global_eq[k];
        tbl.data[(i * NUM_CLASSES + j) * NUM_SUIT_VARIANTS + v] = e;
        if (i != j) {
            tbl.data[(j * NUM_CLASSES + i) * NUM_SUIT_VARIANTS + v] = 1.0 - e;
        }
    }

    double aa_kk_0 = tbl.equity(class_index(12, 12, false), class_index(11, 11, false), 0);
    double aa_kk_1 = tbl.equity(class_index(12, 12, false), class_index(11, 11, false), 1);
    double aa_kk_2 = tbl.equity(class_index(12, 12, false), class_index(11, 11, false), 2);

    std::printf("[gen] ✔ УСПЕХ! Расчёт завершён за %.2fс!\n", sec);
    std::printf("[gen] AA vs KK (0 shared suits) equity = %.6f\n", aa_kk_0);
    std::printf("[gen] AA vs KK (1 shared suit)  equity = %.6f\n", aa_kk_1);
    std::printf("[gen] AA vs KK (2 shared suits) equity = %.6f\n", aa_kk_2);

    tbl.save(final_path);
    std::printf("[gen] Файл записан: %s (%zu байт)\n", final_path.c_str(), EQUITY_TABLE_SIZE * sizeof(double) + 20);
    return 0;
}
