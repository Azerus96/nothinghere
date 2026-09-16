// ════════════════════════════════════════════════════════════════════════
// tools/gen_preflop_3way.cpp — [Module 3, V8] 3-Way Preflop Tensor generator
// ════════════════════════════════════════════════════════════════════════
// Produces preflop_3way.bin: 169 x 169 x 169 = 4,826,809 canonical triplets
// x 3 floats (P0/P1/P2 equity) ~= 57.9 MB, P3TB header (20 bytes).
//
// PROHIBITION honored: NO 1.71M-board exact enumeration per triplet
// (4,826,809 x 1,712,304 ~= 8.26 trillion ops, ~4 days). Mandated method:
// deterministic Monte Carlo with 5,000 samples per cell — LCG PRNG per
// (triplet, thread) pair, partial Fisher-Yates board deals from the
// 46-card live deck. Zero bias; per-cell standard error ~0.007.
//
// Dual-build: the sampling kernel compiles under nvcc (USE_CUDA=ON — the
// client runs the full 4.8M-cell pass on 2x Tesla T4) AND under plain g++
// -DCPU_ONLY=1 through cuda_compat.h (single-thread deterministic
// emulation — this is the developer verification path).
//
// Representative hands: one canonical card pair per class; a fixed greedy
// suit assignment per triplet keeps the three hands card-disjoint.
// Physically impossible triplets (e.g. three identical pair classes: only
// four suits exist per rank) store the uniform fallback (1/3, 1/3, 1/3).
//
// Usage:
//   gen_preflop_3way [--dry-run] [--samples N] [--out PATH]
//     --dry-run : compute only the first 3 classes cubed (27 cells:
//                 AA/KK/QQ combinations) and finish in < 5 seconds on the
//                 CPU; writes preflop_3way_dryrun.bin with the full 57.9 MB
//                 layout (uncomputed cells hold the neutral 1/3 fallback)
//                 so the binary I/O path is exercised end-to-end.
//   Full generation (client, 2x Tesla T4):
//     gen_preflop_3way --out preflop_3way.bin
// ════════════════════════════════════════════════════════════════════════
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <cmath>
#include <vector>
#include <string>
#include <chrono>
#include "cuda_compat.h"
#include "card.h"
#include "hand_evaluator.h"
#include "preflop_engine.h"

using namespace postflop;
using namespace postflop::preflop;

// ── Class descriptor (mirrors gen_preflop_table.cpp) ────────────────────
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

// ── Card-disjoint representative selection for one triplet ──────────────
// Seats are assigned in order with a fixed greedy suit search: pairs try
// (s0, s1) ascending, suited hands try suits ascending, offsuit hands try
// (hi_suit, lo_suit) lexicographically. First fully-disjoint assignment
// wins — deterministic across platforms. Returns false when no disjoint
// assignment exists (physically impossible triplet).
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

// ── Deterministic MC sampling kernel (dual-build) ───────────────────────
// One block per computed cell. Threads take strided samples from
// per-thread LCG streams (seeded from the triplet id and the thread id);
// each sample deals a 5-card board from a per-thread partial Fisher-Yates
// over the 46 live cards. Block reduction in thread-id order keeps the
// result deterministic for a fixed launch configuration.
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
    const Card* __restrict__ d_reps,          // 6 cards per cell (impossible cells all 0xFF)
    const int*  __restrict__ d_impossible,    // 1 = uniform fallback
    int num_cells, int samples,
    uint32_t seed_base,
    float* __restrict__ d_out)               // 3 equities per cell
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
        // Rebuild the 46-card live deck (52 - 6 hole cards).
        int na = 0;
        for (Card c = 0; c < 52; ++c) {
            if (c != h0c1 && c != h0c2 && c != h1c1 && c != h1c2 &&
                c != h2c1 && c != h2c2) {
                avail[na++] = c;
            }
        }
        // Partial Fisher-Yates: draw 5 distinct positions from the tail.
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
            // Renormalize to guard against float rounding drift: the three
            // equities of a sample always sum to exactly 1 in exact
            // arithmetic; force the stored triple to sum to 1.0f.
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
    int samples = 5000;
    std::string out_path = "preflop_3way.bin";
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--dry-run") == 0) dry_run = true;
        else if (std::strcmp(argv[i], "--samples") == 0 && i + 1 < argc) samples = std::atoi(argv[++i]);
        else if (std::strcmp(argv[i], "--out") == 0 && i + 1 < argc) out_path = argv[++i];
    }
    if (samples < 100) samples = 100;
    if (dry_run) out_path = "preflop_3way_dryrun.bin";

    const int CLASS_LIMIT = dry_run ? 3 : (int)NUM_CLASSES;   // classes 0..2 = AA, KK, QQ

    auto t0 = std::chrono::high_resolution_clock::now();
    std::printf("[gen3way] preflop_3way.bin: %zu cells x 3 floats (%.1f MB), %d samples/cell%s\n",
                NUM_3WAY_TRIPLETS, (double)TENSOR_3WAY_FLOATS * 4.0 / 1048576.0, samples,
                dry_run ? " (DRY RUN: first 3 classes cubed = 27 cells)" : "");

    // Full-tensor output buffer: uncomputed cells keep the neutral 1/3.
    std::vector<float> tensor(TENSOR_3WAY_FLOATS, 1.0f / 3.0f);

    // Collect the cells to compute (deterministic order: c0, c1, c3 asc).
    struct Cell { uint16_t c0, c1, c2; };
    std::vector<Cell> cells;
    for (int c0 = 0; c0 < CLASS_LIMIT; ++c0)
        for (int c1 = 0; c1 < CLASS_LIMIT; ++c1)
            for (int c2 = 0; c2 < CLASS_LIMIT; ++c2)
                cells.push_back({(uint16_t)c0, (uint16_t)c1, (uint16_t)c2});

    std::vector<Card> reps(cells.size() * 6, 0xFF);
    std::vector<int> impossible(cells.size(), 0);
    int n_impossible = 0;
    for (size_t k = 0; k < cells.size(); ++k) {
        Card r[6];
        if (triplet_reps(cells[k].c0, cells[k].c1, cells[k].c2, r)) {
            std::memcpy(reps.data() + k * 6, r, 6);
        } else {
            impossible[k] = 1;
            ++n_impossible;
        }
    }

    // Device buffers (cudaMalloc shim = plain malloc on the CPU build).
    Card* d_reps = nullptr;
    int* d_impossible = nullptr;
    float* d_out = nullptr;
    int n = (int)cells.size();
    if (n > 0) {
        CUDA_CHECK(cudaMalloc(&d_reps, (size_t)n * 6 * sizeof(Card)));
        CUDA_CHECK(cudaMalloc(&d_impossible, (size_t)n * sizeof(int)));
        CUDA_CHECK(cudaMalloc(&d_out, (size_t)n * 3 * sizeof(float)));
        CUDA_CHECK(cudaMemcpy(d_reps, reps.data(), (size_t)n * 6 * sizeof(Card), cudaMemcpyHostToDevice));
        CUDA_CHECK(cudaMemcpy(d_impossible, impossible.data(), (size_t)n * sizeof(int), cudaMemcpyHostToDevice));

        KERNEL_LAUNCH(kernel_3way_mc, n, 256, d_reps, d_impossible, n, samples,
                      0xC0FFEE42u, d_out);
        CUDA_CHECK(cudaDeviceSynchronize());

        std::vector<float> cell_out((size_t)n * 3);
        CUDA_CHECK(cudaMemcpy(cell_out.data(), d_out, (size_t)n * 3 * sizeof(float), cudaMemcpyDeviceToHost));
        for (int k = 0; k < n; ++k) {
            size_t base = ((size_t)cells[k].c0 * NUM_CLASSES + cells[k].c1) * NUM_CLASSES + cells[k].c2;
            tensor[base * NUM_3WAY_PLAYERS + 0] = cell_out[(size_t)k * 3 + 0];
            tensor[base * NUM_3WAY_PLAYERS + 1] = cell_out[(size_t)k * 3 + 1];
            tensor[base * NUM_3WAY_PLAYERS + 2] = cell_out[(size_t)k * 3 + 2];
        }
        cudaFree(d_reps);
        cudaFree(d_impossible);
        cudaFree(d_out);
    }

    auto t1 = std::chrono::high_resolution_clock::now();
    double sec = std::chrono::duration<double>(t1 - t0).count();

    Preflop3WayEquityTable tbl;
    tbl.data = std::move(tensor);
    tbl.loaded = true;   // enable the O(1) in-memory self-check queries
    if (!tbl.save(out_path)) {
        std::fprintf(stderr, "[gen3way] FAILED to write %s\n", out_path.c_str());
        return 1;
    }

    // Self-checks: AA/KK/QQ triple equities must be sane and sum to 1.
    float aa = tbl.equity(0, 1, 2, 0);   // class 0 = AA, 1 = KK, 2 = QQ
    float kk = tbl.equity(0, 1, 2, 1);
    float qq = tbl.equity(0, 1, 2, 2);
    float s = aa + kk + qq;
    std::printf("[gen3way] cells computed=%zu (impossible triplets=%d)  time=%.2fs\n",
                cells.size(), n_impossible, sec);
    std::printf("[gen3way] AA vs KK vs QQ equities: %.4f / %.4f / %.4f  (sum=%.4f)\n",
                aa, kk, qq, s);
    std::printf("[gen3way] written: %s (%zu bytes)\n", out_path.c_str(),
                (size_t)20 + TENSOR_3WAY_FLOATS * sizeof(float));

    if (dry_run) {
        bool fast_enough = sec < 5.0;
        // Set-over-set reference: AA vs KK vs QQ 3-way all-in is a classic
        // ~0.66 / ~0.17 / ~0.16 matchup (AA's HU edge over each underpair
        // compounds across the joint board enumeration).
        bool sane = (aa > kk && kk > qq && aa > 0.55f && aa < 0.75f &&
                     std::fabs((double)s - 1.0) < 0.01);
        std::printf("[gen3way] DRY-RUN check: %.2fs (<5s: %s), AA>KK>QQ ordering + sum=1: %s\n",
                    sec, fast_enough ? "OK" : "FAIL", sane ? "OK" : "FAIL");
        if (!fast_enough || !sane) return 1;
    }
    return 0;
}
