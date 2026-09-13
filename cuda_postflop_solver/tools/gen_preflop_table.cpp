// ════════════════════════════════════════════════════════════════════════
// tools/gen_preflop_table.cpp — preflop_table.bin generator (Module 3.1)
// ════════════════════════════════════════════════════════════════════════
// Produces the 169x169x3 double matrix (685 KB) with:
//   * EXACT enumeration (all C(48,5) = 1,712,304 boards) for every
//     pair-vs-pair matchup — includes the regression-critical AA vs KK;
//   * DETERMINISTIC Monte Carlo (fixed-seed LCG, partial Fisher-Yates,
//     default 32768 samples per bucket) for the remaining matchups,
//     standard error ~0.003 (documented);
//   * Class symmetry enforced exactly: eq(A,B,v) + eq(B,A,v) = 1.
//
// Usage: gen_preflop_table [output_path] [mc_samples]
// ════════════════════════════════════════════════════════════════════════
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <vector>
#include <array>
#include <chrono>
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

// ── Exact equity: enumerate all C(48,5) boards ──────────────────────────
static double exact_equity(const std::pair<Card, Card>& hero,
                           const std::pair<Card, Card>& villain) {
    bool dead[52] = {false};
    dead[hero.first] = dead[hero.second] = true;
    dead[villain.first] = dead[villain.second] = true;
    int avail[48]; int na = 0;
    for (int c = 0; c < 52; ++c) if (!dead[c]) avail[na++] = c;

    double win = 0.0, tie = 0.0;
    long long boards = 0;
    Card h7[7] = {hero.first, hero.second, 0, 0, 0, 0, 0};
    Card v7[7] = {villain.first, villain.second, 0, 0, 0, 0, 0};
    for (int a = 0; a < 48; ++a)
    for (int b = a + 1; b < 48; ++b)
    for (int c = b + 1; c < 48; ++c)
    for (int d = c + 1; d < 48; ++d)
    for (int e = d + 1; e < 48; ++e) {
        h7[2] = v7[2] = (Card)avail[a];
        h7[3] = v7[3] = (Card)avail[b];
        h7[4] = v7[4] = (Card)avail[c];
        h7[5] = v7[5] = (Card)avail[d];
        h7[6] = v7[6] = (Card)avail[e];
        int hs = evaluate(h7, 7);
        int vs = evaluate(v7, 7);
        if (hs > vs) win += 1.0;
        else if (hs == vs) tie += 1.0;
        ++boards;
    }
    return (win + 0.5 * tie) / (double)boards;
}

// ── Deterministic MC equity ─────────────────────────────────────────────
static uint32_t splitmix32(uint32_t x) {
    x += 0x9E3779B9u;
    x = (x ^ (x >> 16)) * 0x85EBCA6Bu;
    x = (x ^ (x >> 13)) * 0xC2B2AE35u;
    return x ^ (x >> 16);
}

static double mc_equity(const std::pair<Card, Card>& hero,
                        const std::pair<Card, Card>& villain,
                        int samples, uint32_t seed) {
    bool dead[52] = {false};
    dead[hero.first] = dead[hero.second] = true;
    dead[villain.first] = dead[villain.second] = true;
    int avail[48]; int na = 0;
    for (int c = 0; c < 52; ++c) if (!dead[c]) avail[na++] = c;

    uint32_t rng = splitmix32(seed);
    double acc = 0.0;
    int valid = 0;
    Card h7[7] = {hero.first, hero.second, 0, 0, 0, 0, 0};
    Card v7[7] = {villain.first, villain.second, 0, 0, 0, 0, 0};
    for (int s = 0; s < samples; ++s) {
        // Partial Fisher-Yates: draw 5 distinct positions from the tail.
        for (int k = 0; k < 5; ++k) {
            rng = rng * 1664525u + 1013904223u;
            int j = (int)((rng >> 8) % (uint32_t)(na - k));
            int tail = na - 1 - k;
            int tmp = avail[j]; avail[j] = avail[tail]; avail[tail] = tmp;
        }
        h7[2] = v7[2] = (Card)avail[na - 1];
        h7[3] = v7[3] = (Card)avail[na - 2];
        h7[4] = v7[4] = (Card)avail[na - 3];
        h7[5] = v7[5] = (Card)avail[na - 4];
        h7[6] = v7[6] = (Card)avail[na - 5];
        int hs = evaluate(h7, 7);
        int vs = evaluate(v7, 7);
        if (hs > vs) acc += 1.0;
        else if (hs == vs) acc += 0.5;
        ++valid;
    }
    return (valid > 0) ? acc / (double)valid : 0.5;
}

int main(int argc, char** argv) {
    const char* out_path = (argc > 1) ? argv[1] : "preflop_table.bin";
    int mc_samples = (argc > 2) ? std::atoi(argv[2]) : 32768;
    if (mc_samples < 1000) mc_samples = 1000;

    auto t0 = std::chrono::high_resolution_clock::now();
    std::printf("[gen] preflop_table.bin: %zu buckets, MC samples=%d (pairs exact)\n",
                EQUITY_TABLE_SIZE, mc_samples);

    PreflopEquityTable tbl;
    tbl.data.assign(EQUITY_TABLE_SIZE, 0.5);

    // Fill the used class space [2,168]; 0 and 1 stay 0.5 (reserved).
    // Compute hero <= villain and mirror with eq(B,A) = 1 - eq(A,B).
    long long exact_count = 0, mc_count = 0;
    for (uint16_t i = 0; i < NUM_CLASSES; ++i) {
        for (uint16_t j = i; j < NUM_CLASSES; ++j) {
            bool both_pairs = (i <= 12) && (j <= 12);
            std::pair<Card, Card> hrep = hero_rep(i);
            for (size_t v = 0; v < NUM_SUIT_VARIANTS; ++v) {
                std::pair<Card, Card> vrep = villain_rep(j, hrep, v);
                // variant actually achievable? (suited hands share <= 1 suit)
                size_t real_v = classify_suit_variant(hrep, vrep);
                double eq;
                if (both_pairs) {
                    eq = exact_equity(hrep, vrep);
                    ++exact_count;
                } else {
                    eq = mc_equity(hrep, vrep, mc_samples,
                                   splitmix32(((uint32_t)i << 20) ^ ((uint32_t)j << 4) ^ (uint32_t)v));
                    ++mc_count;
                }
                (void)real_v;
                tbl.data[(i * NUM_CLASSES + j) * NUM_SUIT_VARIANTS + v] = eq;
                if (i != j) {
                    tbl.data[(j * NUM_CLASSES + i) * NUM_SUIT_VARIANTS + v] = 1.0 - eq;
                }
            }
        }
        if (i % 20 == 0) {
            auto t1 = std::chrono::high_resolution_clock::now();
            double sec = std::chrono::duration<double>(t1 - t0).count();
            std::printf("[gen]   class %3u/168  (%.1fs)\n", i, sec);
            std::fflush(stdout);
        }
    }

    if (!tbl.save(out_path)) {
        std::fprintf(stderr, "[gen] FAILED to write %s\n", out_path);
        return 1;
    }
    auto t1 = std::chrono::high_resolution_clock::now();
    double sec = std::chrono::duration<double>(t1 - t0).count();

    // Self-check: AA vs KK (variant 0), the regression-critical value.
    double aa_kk = tbl.equity(class_index(12, 12, false), class_index(11, 11, false), 0);
    std::printf("[gen] exact buckets=%lld  mc buckets=%lld  time=%.1fs\n",
                exact_count, mc_count, sec);
    std::printf("[gen] AA vs KK (0 shared suits) equity = %.6f\n", aa_kk);
    std::printf("[gen] AA vs KK (1 shared suit)  equity = %.6f\n",
                tbl.equity(class_index(12, 12, false), class_index(11, 11, false), 1));
    std::printf("[gen] AA vs KK (2 shared suits) equity = %.6f\n",
                tbl.equity(class_index(12, 12, false), class_index(11, 11, false), 2));
    std::printf("[gen] written: %s (%zu bytes)\n", out_path,
                EQUITY_TABLE_SIZE * sizeof(double) + 20);
    return 0;
}
