// ════════════════════════════════════════════════════════════════════════
// tools/gen_preflop_table.cpp — preflop_table.bin generator (Module 3.1)
// ════════════════════════════════════════════════════════════════════════
// [V8] Produces the 169x169x3 double matrix (685 KB) with EXACT
// enumeration for EVERY matchup: all C(48,5) = 1,712,304 boards per
// bucket, computed cooperatively by kernel_exact_hu_bucket (one CUDA
// block per bucket; the same source compiles under plain g++ through
// cuda_compat.h for the deterministic CPU-only regression path).
// The V7 design (exact for pair-vs-pair only, 32768-sample Monte Carlo
// for the rest, ~0.003 standard error) is retired: the shipped artifact
// is exact everywhere.
//
// Symmetry: eq(A,B,v) + eq(B,A,v) = 1 exactly (win/lose swap under the
// hero/villain exchange; ties are symmetric) — unordered pairs are
// enumerated once and mirrored.
//
// Impossible suit variants (e.g. a suited villain sharing 2 suits with a
// suited hero) fall back to the nearest achievable variant's
// representative cards and are counted in the fallback statistic.
//
// Usage:
//   gen_preflop_table [output_path] [--dry-run]
//     --dry-run : compute ONLY the off-diagonal ordered pairs of the first
//                 3 classes (AA/KK/QQ, 6 cells, variant 0) and write
//                 <output_path>.dryrun — a < 2 s CPU sanity check with the
//                 full binary layout (regression-critical AA vs KK value).
// ════════════════════════════════════════════════════════════════════════
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <cmath>
#include <vector>
#include <array>
#include <string>
#include <chrono>
#include "cuda_compat.h"
#include "card.h"
#include "hand_evaluator.h"
#include "preflop_engine.h"

using namespace postflop;
using namespace postflop::preflop;

// ── Class descriptor ────────────────────────────────────────────────────
struct ClassDesc {
    int r_hi, r_lo;     // ranks
    bool pair, suited;
};

static ClassDesc describe(uint16_t cls) {
    ClassDesc d{};
    if (cls <= 12) { d.pair = true; d.r_hi = d.r_lo = 12 - cls; return d; }
    size_t idx = (cls >= 91) ? (cls - 91) : (cls - 13);
    d.suited = (cls < 91);
    // invert pair_idx = (a-2)*(27-a)/2 + (b-a-1)
    for (int a = 2; a <= 13; ++a) {
        size_t base = (size_t)(a - 2) * (27 - a) / 2;
        size_t row_len = (size_t)(14 - a);
        if (idx >= base && idx < base + row_len) {
            int b = (int)(a + 1 + (idx - base));
            d.r_hi = 14 - a;   // larger rank  (a = 14 - max)
            d.r_lo = 14 - b;   // smaller rank
            return d;
        }
    }
    d.r_hi = 12; d.r_lo = 11; return d;  // unreachable for valid classes
}

// ── Representative card pairs for (class, variant) ─────────────────────
// Hero always uses canonical suits: pair {0,1}, suited {0}, offsuit {0,1}.
// Villain suits realize the requested shared-suit count (clamped when
// impossible: suited hands expose at most 1 shared suit).
static std::pair<Card, Card> hero_rep(uint16_t cls) {
    ClassDesc d = describe(cls);
    if (d.pair)  return {make_card(d.r_hi, 0), make_card(d.r_lo, 1)};
    if (d.suited) return {make_card(d.r_hi, 0), make_card(d.r_lo, 0)};
    return {make_card(d.r_hi, 0), make_card(d.r_lo, 1)};
}

static std::pair<Card, Card> villain_rep(uint16_t vcls, const std::pair<Card, Card>& hero, size_t want_variant) {
    ClassDesc d = describe(vcls);
    int h0 = card_suit(hero.first), h1 = card_suit(hero.second);
    // Available "other" suits (not in hero).
    int other[4]; int n_other = 0;
    for (int s = 0; s < 4; ++s) {
        if (s != h0 && s != h1) other[n_other++] = s;
    }
    int s0, s1;
    if (d.pair) {
        // villain needs two distinct suits
        if (want_variant == 0 && n_other >= 2)      { s0 = other[0]; s1 = other[1]; }
        else if (want_variant == 1)                 { s0 = h0; s1 = (n_other >= 1 ? other[0] : h1); }
        else                                        { s0 = h0; s1 = h1; }
        if (s0 == s1) s1 = (s0 == 0) ? 1 : 0;
        return {make_card(d.r_hi, s0), make_card(d.r_lo, s1)};
    }
    if (d.suited) {
        // single suit: 0 or 1 shared possible
        s0 = (want_variant >= 1) ? h0 : other[0];
        return {make_card(d.r_hi, s0), make_card(d.r_lo, s0)};
    }
    // offsuit: two distinct suits, 0/1/2 shared
    if (want_variant == 0 && n_other >= 2)      { s0 = other[0]; s1 = other[1]; }
    else if (want_variant == 1)                 { s0 = h0; s1 = other[0]; }   // high card shares hero's suit (canonical)
    else                                        { s0 = h0; s1 = h1; }
    if (s0 == s1) s1 = (s0 == 0) ? 1 : 0;
    return {make_card(d.r_hi, s0), make_card(d.r_lo, s1)};
}

// ── [V8] Exact HU bucket kernel ─────────────────────────────────────────
// One block per bucket; every thread strides the OUTERMOST board-card loop
// (`a += blockDim.x`), which covers the full C(48,5) domain both on real
// hardware (256 threads) and under the CPU compat shim (blockDim forced to
// 1 — a single emulated thread walks every index). Shared accumulators
// reduce per-thread win/tie/board counts; thread 0 emits the exact equity:
//     eq = (wins + 0.5 * ties) / boards
__global__
void kernel_exact_hu_bucket(
    const Card* __restrict__ hero_reps,      // 2 cards per bucket
    const Card* __restrict__ villain_reps,   // 2 cards per bucket
    int num_buckets,
    double* __restrict__ out)                // exact equity per bucket
{
    int bucket = blockIdx.x;
    if (bucket >= num_buckets) return;

    Card h1 = hero_reps[bucket * 2];
    Card h2 = hero_reps[bucket * 2 + 1];
    Card v1 = villain_reps[bucket * 2];
    Card v2 = villain_reps[bucket * 2 + 1];

    int tid = threadIdx.x;

    // 48-card deck: 52 - hero's 2 - villain's 2.
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
    if (init_hand_table_on_gpu() != 0) {
        std::fprintf(stderr, "FATAL: Failed to init GPU hand table\n");
        return 1;
    }

    const char* out_path = "preflop_table.bin";
    bool dry = false;
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--dry-run") == 0) dry = true;
        else out_path = argv[i];
    }
    std::string final_path = dry ? (std::string(out_path) + ".dryrun")
                                 : std::string(out_path);

    std::printf("[gen] preflop_table.bin: %zu buckets, EXACT C(48,5) enumeration%s\n",
                EQUITY_TABLE_SIZE, dry ? " (DRY RUN: first 3 classes)" : "");
    std::fflush(stdout);

    // ── Build the bucket list ───────────────────────────────────────────
    // Dry run: unordered pairs among classes {0,1,2} (AA/KK/QQ), variant 0.
    // Full run: every unordered pair (i <= j), all 3 suit variants.
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
        if (real_v != v) ++fallbacks;   // nearest-variant fallback
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

    // Flat representative-card buffers (kernel interface).
    std::vector<Card> hreps(buckets.size() * 2), vreps(buckets.size() * 2);
    for (size_t k = 0; k < buckets.size(); ++k) {
        hreps[k * 2]     = buckets[k].hrep.first;
        hreps[k * 2 + 1] = buckets[k].hrep.second;
        vreps[k * 2]     = buckets[k].vrep.first;
        vreps[k * 2 + 1] = buckets[k].vrep.second;
    }

    auto t0 = std::chrono::high_resolution_clock::now();
    std::vector<double> eq(buckets.size(), 0.5);
    KERNEL_LAUNCH(kernel_exact_hu_bucket, (int)buckets.size(), 256,
                  hreps.data(), vreps.data(), (int)buckets.size(), eq.data());
    auto t1 = std::chrono::high_resolution_clock::now();
    double sec = std::chrono::duration<double>(t1 - t0).count();

    // ── Fill the table + mirror ─────────────────────────────────────────
    PreflopEquityTable tbl;
    tbl.data.assign(EQUITY_TABLE_SIZE, 0.5);
    long long filled = 0;
    for (size_t k = 0; k < buckets.size(); ++k) {
        uint16_t i = buckets[k].i, j = buckets[k].j;
        size_t v = buckets[k].v;
        double e = eq[k];
        tbl.data[(i * NUM_CLASSES + j) * NUM_SUIT_VARIANTS + v] = e;
        ++filled;
        if (i != j) {
            tbl.data[(j * NUM_CLASSES + i) * NUM_SUIT_VARIANTS + v] = 1.0 - e;
            ++filled;
        }
    }

    std::printf("[gen] exact buckets computed=%lld (nearest-variant fallbacks=%lld)  time=%.2fs\n",
                filled, fallbacks, sec);
    std::fflush(stdout);

    // Self-check: AA vs KK (variant 0), the regression-critical value.
    double aa_kk = tbl.equity(class_index(12, 12, false), class_index(11, 11, false), 0);
    if (dry) {
        std::printf("[gen] AA vs KK (0 shared suits) equity = %.6f\n", aa_kk);
        std::printf("[gen] (dry run computes variant 0 only; v1/v2 stay at the 0.5 placeholder)\n");
    } else {
        std::printf("[gen] AA vs KK (0 shared suits) equity = %.6f\n", aa_kk);
        std::printf("[gen] AA vs KK (1 shared suit)  equity = %.6f\n",
                    tbl.equity(class_index(12, 12, false), class_index(11, 11, false), 1));
        std::printf("[gen] AA vs KK (2 shared suits) equity = %.6f\n",
                    tbl.equity(class_index(12, 12, false), class_index(11, 11, false), 2));
    }

    if (!tbl.save(final_path)) {
        std::fprintf(stderr, "[gen] FAILED to write %s\n", final_path.c_str());
        return 1;
    }
    std::printf("[gen] written: %s (%zu bytes)\n", final_path.c_str(),
                EQUITY_TABLE_SIZE * sizeof(double) + 20);

    if (dry) {
        bool timing_ok = sec < 2.0;
        bool aakk_ok = (aa_kk >= 0.80 && aa_kk <= 0.83);
        std::printf("[gen] DRY-RUN check: %.2fs (<2s: %s), AA-vs-KK in [0.80,0.83]: %s\n",
                    sec, timing_ok ? "OK" : "FAIL", aakk_ok ? "OK" : "FAIL");
        return (timing_ok && aakk_ok) ? 0 : 1;
    }
    return 0;
}
