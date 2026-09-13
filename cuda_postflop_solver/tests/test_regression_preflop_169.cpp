// ════════════════════════════════════════════════════════════════════════
// tests/test_regression_preflop_169.cpp — [TEST-7]
// Scenario: query AA vs KK equity from preflop_table.bin.
//
// SPEC DEVIATION NOTE (documented in the developer report): the
// specification asserts Equity == 0.825 +/- 0.001. Exact enumeration of all
// C(48,5) boards gives:
//     variant 0 (no shared suits)   : 0.812555
//     variant 1 (one shared suit)   : 0.819461
//     variant 2 (two shared suits)  : 0.826366
//     combo-weighted average        : 0.819468
// No suit variant lies within 0.001 of 0.825 (the nearest, variant 2, is
// off by 0.0014); the spec's figure is a rounded popular statistic. The
// table stores mathematically exact values; this test asserts THOSE.
// ════════════════════════════════════════════════════════════════════════
#include <cstdio>
#include <cmath>
#include <vector>
#include <string>
#include <chrono>
#include <set>
#include "card.h"
#include "preflop_engine.h"

using namespace postflop;
using namespace postflop::preflop;

static int pass = 0, fail = 0;
static void check(bool ok, const std::string& name) {
    std::printf("  %s: %s\n", ok ? "PASS" : "FAIL", name.c_str());
    if (ok) ++pass; else ++fail;
}

int main() {
    std::printf("=== [TEST-7] Regression: preflop 169x169x3 RVR engine (Module 3.1) ===\n\n");

    PreflopEquityTable tbl;
    bool loaded = tbl.load("preflop_table.bin");
    check(loaded, "preflop_table.bin loads (169*169*3 doubles, 685 KB)");
    if (!loaded) {
        std::printf("\n=== [TEST-7] Summary: %d passed, %d failed ===\n", pass, fail);
        return 1;
    }

    // ── Class index bijection ────────────────────────────────────────────
    // (The spec's printed triangular formula collides A3s with KQs and
    // overflows for 32o; the corrected bijection is verified here.)
    {
        std::set<int> seen;
        bool bijective = true;
        for (int r_hi = 0; r_hi <= 12; ++r_hi) {
            for (int r_lo = 0; r_lo <= r_hi; ++r_lo) {
                if (r_hi == r_lo) {
                    // Pairs ignore the suited flag by definition: single class.
                    int idx = class_index((uint8_t)r_hi, (uint8_t)r_lo, false);
                    if (idx < 0 || idx > 168 || seen.count(idx)) { bijective = false; }
                    seen.insert(idx);
                } else {
                    for (int suited = 0; suited <= 1; ++suited) {
                        int idx = class_index((uint8_t)r_hi, (uint8_t)r_lo, suited != 0);
                        if (idx < 0 || idx > 168 || seen.count(idx)) { bijective = false; }
                        seen.insert(idx);
                    }
                }
            }
        }
        // 13 pairs + 78 suited + 78 offsuit = 169 classes used.
        check(bijective && seen.size() == 169,
              "class_index is a bijection onto [0,168] (169 classes)");

        // Corrected pair mapping: pairs occupy [0..12] (AA=0, KK=1, ..., 22=12).
        // The spec's 14-rank mapping put 22 at 14, colliding with the suited
        // block [13..90] (KQs) — same class-index family of defects as the
        // triangular formula (documented in the developer report).
        check(class_index(12, 12, false) == 0 && class_index(11, 11, false) == 1 &&
              class_index(0, 0, false) == 12,
              "pair classes map AA->0, KK->1, 22->12 (collision-free block [0..12])");
    }

    // ── Suit variant classification ─────────────────────────────────────
    {
        Card Ah = card_from_string("Ah"), As = card_from_string("As");
        Card Kc = card_from_string("Kc"), Kd = card_from_string("Kd");
        Card Qh = card_from_string("Qh"), Js = card_from_string("Js");
        Card Qc = card_from_string("Qc"), Jc = card_from_string("Jc");
        check(classify_suit_variant({Ah, As}, {Kc, Kd}) == 0,
              "classify_suit_variant: 0 shared suits");
        check(classify_suit_variant({Ah, As}, {Kc, Qh}) == 1,
              "classify_suit_variant: 1 shared suit");
        check(classify_suit_variant({Ah, As}, {Qc, Jc}) == 0,
              "classify_suit_variant: offsuit disjoint (0)");
        check(classify_suit_variant({Ah, As}, {Ah, As}) == 2,
              "classify_suit_variant: identical hands (2)");
    }

    // ── AA vs KK equity (exact enumeration stored) ──────────────────────
    {
        uint16_t aa = class_index(12, 12, false);
        uint16_t kk = class_index(11, 11, false);
        double v0 = tbl.equity(aa, kk, 0);
        double v1 = tbl.equity(aa, kk, 1);
        double v2 = tbl.equity(aa, kk, 2);
        std::printf("  AA vs KK: v0=%.6f v1=%.6f v2=%.6f (spec asserts 0.825+/-0.001)\n",
                    v0, v1, v2);
        check(std::fabs(v0 - 0.812555) < 0.001, "AA vs KK variant 0 == 0.8126 (exact)");
        check(std::fabs(v1 - 0.819461) < 0.001, "AA vs KK variant 1 == 0.8195 (exact)");
        check(std::fabs(v2 - 0.826366) < 0.001, "AA vs KK variant 2 == 0.8264 (exact)");
        check(std::fabs(v2 - 0.825) < 0.002,
              "nearest variant (2 shared suits) within 0.002 of the spec's 0.825");

        // Card-level query: AhAs vs KhKs (2 shared suits).
        Card Ah = card_from_string("Ah"), As = card_from_string("As");
        Card Kh = card_from_string("Kh"), Ks = card_from_string("Ks");
        double eq_cards = tbl.equity_cards({Ah, As}, {Kh, Ks});
        check(std::fabs(eq_cards - 0.826366) < 0.001,
              "equity_cards(AhAs, KhKs) == 0.8264 (variant routing correct)");

        // Symmetry invariant: eq(A,B,v) + eq(B,A,v) == 1.
        double sym = tbl.equity(aa, kk, 1) + tbl.equity(kk, aa, 1);
        check(std::fabs(sym - 1.0) < 1e-9, "eq(A,B,v) + eq(B,A,v) == 1 exactly");
    }

    // ── O(1) lookup latency ──────────────────────────────────────────────
    {
        auto t0 = std::chrono::high_resolution_clock::now();
        const int N = 100000;
        volatile double sink = 0.0;
        for (int i = 0; i < N; ++i) {
            uint16_t a = (uint16_t)(2 + (i % 167));
            uint16_t b = (uint16_t)(2 + ((i * 7 + 3) % 167));
            sink += tbl.equity(a, b, (size_t)(i % 3));
        }
        auto t1 = std::chrono::high_resolution_clock::now();
        double us = std::chrono::duration<double, std::micro>(t1 - t0).count() / N;
        std::printf("  lookup latency: %.4f us per query (100k queries)\n", us);
        check(us < 1.0, "lookup time < 1 microsecond");
        (void)sink;
    }

    // ── RVR push/fold decision ───────────────────────────────────────────
    {
        // Install the table as the global instance for decision helpers.
        global_preflop_table() = tbl;
        Card Ah = card_from_string("Ah"), As = card_from_string("As");
        Card Kc = card_from_string("Kc"), Kd = card_from_string("Kd");
        auto d = push_fold_call_decision({Ah, As}, {Kc, Kd}, 100, 200);
        std::printf("  RVR call decision (AA vs rep, risk 200 into 100): "
                    "eq=%.4f req=%.4f call=%d\n", d.equity, d.required, (int)d.should_call);
        check(d.should_call && d.equity > d.required,
              "AA calls a shove with a large equity edge");
    }

    std::printf("\n=== [TEST-7] Summary: %d passed, %d failed ===\n", pass, fail);
    return fail == 0 ? 0 : 1;
}
