// ════════════════════════════════════════════════════════════════════════
// tests/test_regression_preflop_3way.cpp — [Module 3 + 6, V8] preflop
// artifacts regression suite (3-way tensor, 184-flop subset, MTT anchors)
// ════════════════════════════════════════════════════════════════════════
// Verifies:
//   1. Preflop3WayEquityTable: P3TB header round-trip, O(1) queries,
//      corruption detection, uniform fallback for out-of-range inputs.
//   2. class_index bijection anchors (AA->0, KK->1, QQ->2, AKs->13...).
//   3. Generator E2E: gen_preflop_3way --dry-run produces a valid 57.9 MB
//      artifact in < 5 s with sane AA/KK/QQ equities; the loaded tensor
//      reproduces the daemon-reported values.
//   4. live_solver daemon wiring: {"query":"preflop_equity_3way"} served
//      from the tensor loaded via $POSTFLOP_3WAY_PATH.
//   5. [Module 6] FLOP_SUBSET_184: 184 entries, weights sum to 529.28,
//      every cards_str parses to three distinct valid cards.
//   6. [Module 6] gen_mtt_anchors --dry-run: MTTA layout, 1 stack x 2
//      flops in < 5 s, round-trip header validation; live_solver serves
//      {"query":"preflop_anchor"} with interpolated stack depths.
// ════════════════════════════════════════════════════════════════════════
#include <cstdio>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <memory>
#include "card.h"
#include "hand_evaluator.h"
#include "range.h"
#include "preflop_engine.h"
#include "flop_subset_184.h"

using namespace postflop;
using namespace postflop::preflop;

static int pass = 0, fail = 0;
static void check(bool ok, const std::string& name) {
    std::printf("  %s: %s\n", ok ? "PASS" : "FAIL", name.c_str());
    if (ok) ++pass; else ++fail;
}

// ── Subprocess helpers ───────────────────────────────────────────────────
static std::string bin_dir() {
    const char* env = std::getenv("POSTFLOP_TEST_BIN_DIR");
    if (env && *env) return std::string(env);
#ifdef POSTFLOP_TEST_BIN_DIR
    return std::string(POSTFLOP_TEST_BIN_DIR);
#else
    return std::string(".");
#endif
}

static std::string source_root() {
#ifdef SOURCE_ROOT
    return std::string(SOURCE_ROOT);
#else
    return std::string(".");
#endif
}

// Runs `cmd` (shell) and captures stdout; returns the exit code.
static int run_capture(const std::string& cmd, std::string& out) {
    std::string full = cmd + " 2>&1";
    FILE* p = ::popen(full.c_str(), "r");
    if (!p) return -1;
    char buf[4096];
    out.clear();
    while (size_t n = std::fread(buf, 1, sizeof(buf), p)) out.append(buf, n);
    int rc = ::pclose(p);
    return (rc == -1) ? -1 : (rc >> 8);
}

// Feeds `input` to `cmd`'s stdin and captures stdout (one line back).
static int run_daemon_query(const std::string& cmd, const std::string& input,
                            std::string& out) {
    std::string full = "(printf '%s\\nQUIT\\n' '" + input + "') | (" + cmd + ") 2>&1";
    FILE* p = ::popen(full.c_str(), "r");
    if (!p) return -1;
    char buf[4096];
    out.clear();
    while (size_t n = std::fread(buf, 1, sizeof(buf), p)) out.append(buf, n);
    int rc = ::pclose(p);
    return (rc == -1) ? -1 : (rc >> 8);
}

static bool contains(const std::string& hay, const std::string& needle) {
    return hay.find(needle) != std::string::npos;
}

int main() {
    std::printf("=== [V8] Regression: 3-way tensor + MTT anchors (Modules 3 & 6) ===\n\n");

    // ── 1. class_index bijection anchors ───────────────────────────────
    std::printf("── class_index anchors ──\n");
    check(class_index(12, 12, false) == 0, "AA -> class 0");
    check(class_index(11, 11, false) == 1, "KK -> class 1");
    check(class_index(10, 10, false) == 2, "QQ -> class 2");
    check(class_index(12, 11, true)  == 13, "AKs -> class 13");
    check(class_index(12, 11, false) == 91, "AKo -> class 91");
    {
        // Full bijection onto [0,168]: every class maps back to a distinct
        // (rank_hi, rank_lo, suited) descriptor.
        std::vector<bool> seen(NUM_CLASSES, false);
        bool bijective = true;
        for (int r_hi = 0; r_hi <= 12; ++r_hi) {
            for (int r_lo = 0; r_lo <= r_hi; ++r_lo) {
                bool is_pair = (r_hi == r_lo);
                uint16_t cs = class_index((uint8_t)r_hi, (uint8_t)r_lo, true);
                uint16_t co = is_pair ? cs : class_index((uint8_t)r_hi, (uint8_t)r_lo, false);
                if (cs >= NUM_CLASSES || seen[cs]) bijective = false;
                if (!is_pair && (co >= NUM_CLASSES || seen[co])) bijective = false;
                if (!is_pair) seen[cs] = seen[co] = true;
                else seen[cs] = true;
            }
        }
        for (bool s : seen) if (!s) bijective = false;
        check(bijective, "class_index is a full bijection onto [0..168]");
    }

    // ── 2. 3-way tensor binary I/O ─────────────────────────────────────
    std::printf("\n── Preflop3WayEquityTable binary I/O ──\n");
    {
        Preflop3WayEquityTable tbl;
        tbl.data.assign(TENSOR_3WAY_FLOATS, 1.0f / 3.0f);
        // Known values at (AA, KK, QQ) and a symmetric spot check.
        size_t base = ((size_t)0 * NUM_CLASSES + 1) * NUM_CLASSES + 2;
        tbl.data[base * 3 + 0] = 0.401f;
        tbl.data[base * 3 + 1] = 0.276f;
        tbl.data[base * 3 + 2] = 0.323f;
        const std::string path = "/tmp/p3tb_test.bin";
        check(tbl.save(path), "save() writes the full 57.9 MB P3TB artifact");
        {
            // Raw header check.
            FILE* f = std::fopen(path.c_str(), "rb");
            char magic[4] = {0, 0, 0, 0};
            uint32_t ver = 0, cls = 0, pl = 0, dt = 0;
            if (f) {
                std::fread(magic, 1, 4, f);
                std::fread(&ver, 4, 1, f);
                std::fread(&cls, 4, 1, f);
                std::fread(&pl, 4, 1, f);
                std::fread(&dt, 4, 1, f);
                std::fclose(f);
            }
            check(std::memcmp(magic, "P3TB", 4) == 0 && ver == 1 && cls == 169 &&
                  pl == 3 && dt == 4,
                  "P3TB header: magic/version=1/classes=169/players=3/dtype=float");
        }
        Preflop3WayEquityTable loaded;
        check(loaded.load(path), "load() reads the artifact back");
        check(loaded.equity(0, 1, 2, 0) == 0.401f &&
              loaded.equity(0, 1, 2, 1) == 0.276f &&
              loaded.equity(0, 1, 2, 2) == 0.323f,
              "O(1) equity() returns the stored cell values verbatim");
        check(std::fabs((double)(loaded.equity(0, 1, 2, 0) +
                                 loaded.equity(0, 1, 2, 1) +
                                 loaded.equity(0, 1, 2, 2)) - 1.0) < 0.01,
              "AA/KK/QQ triple sums to ~1");
        // Out-of-range fallbacks.
        check(std::fabs((double)loaded.equity(169, 0, 0, 0) - 1.0 / 3.0) < 1e-6,
              "out-of-range class falls back to 1/3");
        check(std::fabs((double)loaded.equity(0, 0, 0, 5) - 1.0 / 3.0) < 1e-6,
              "out-of-range player index falls back to 1/3");
        // Corruption detection.
        Preflop3WayEquityTable bad;
        check(!bad.load("/tmp/p3tb_does_not_exist.bin"), "missing file rejected");
        {
            FILE* f = std::fopen("/tmp/p3tb_bad.bin", "wb");
            if (f) { std::fputs("XXXXgarbage", f); std::fclose(f); }
            check(!bad.load("/tmp/p3tb_bad.bin"), "corrupt header rejected");
        }
        std::remove(path.c_str());
        std::remove("/tmp/p3tb_bad.bin");
    }

    // ── 3. 184-flop embedded subset ────────────────────────────────────
    std::printf("\n── [Module 6] FLOP_SUBSET_184 embedded header ──\n");
    {
        check(FLOP_SUBSET_184.size() == 184, "184 flop entries embedded");
        double wsum = 0.0;
        bool parse_ok = true, distinct_ok = true;
        for (const auto& e : FLOP_SUBSET_184) {
            wsum += (double)e.weight;
            Card c[3];
            for (int i = 0; i < 3; ++i) {
                std::string cs(e.cards_str + i * 2, e.cards_str + i * 2 + 2);
                c[i] = card_from_string(cs);
                if (c[i] == NOT_DEALT) parse_ok = false;
            }
            if (c[0] == c[1] || c[0] == c[2] || c[1] == c[2]) distinct_ok = false;
        }
        std::printf("    weight sum = %.2f (expected 529.28)\n", wsum);
        check(std::fabs(wsum - 529.28) < 0.01, "NNLS weights sum to 529.28");
        check(parse_ok, "every cards_str parses into valid cards");
        check(distinct_ok, "every flop has three distinct cards");
        check(std::fabs((double)FLOP_SUBSET_184_WEIGHT_SUM - 529.28) < 0.01,
              "FLOP_SUBSET_184_WEIGHT_SUM constant matches");
    }

    // ── 4. Generator + daemon E2E (tensor) ─────────────────────────────
    std::printf("\n── gen_preflop_3way --dry-run + live_solver E2E ──\n");
    {
        std::string out;
        int rc = run_capture(bin_dir() + "/gen_preflop_3way --dry-run", out);
        std::printf("    [gen3way dry-run rc=%d]\n", rc);
        check(rc == 0, "gen_preflop_3way --dry-run exits 0 (< 5 s, 27 cells)");
        check(contains(out, "DRY-RUN check") && contains(out, "OK"),
              "dry-run self-check passes (timing + AA>KK>QQ ordering)");

        // The dry-run artifact carries the REAL computed 27 cells.
        Preflop3WayEquityTable dry;
        check(dry.load("preflop_3way_dryrun.bin"),
              "dry-run artifact loads through the production loader");
        float aa = dry.equity(0, 1, 2, 0);
        float kk = dry.equity(0, 1, 2, 1);
        float qq = dry.equity(0, 1, 2, 2);
        std::printf("    tensor AA/KK/QQ: %.4f / %.4f / %.4f\n", aa, kk, qq);
        // Set-over-set reference: AA vs KK vs QQ 3-way all-in is a classic
        // ~0.66 / ~0.17 / ~0.16 matchup.
        check(aa > kk && kk > qq && aa > 0.55f && aa < 0.75f,
              "3-way equities ordered AA > KK > QQ with AA in (0.55, 0.75)");

        // Daemon wiring: query the tensor through live_solver.
        std::string resp;
        std::string cmd = "POSTFLOP_3WAY_PATH=preflop_3way_dryrun.bin " +
                          bin_dir() + "/live_solver";
        int drc = run_daemon_query(
            cmd,
            "{\"query\":\"preflop_equity_3way\",\"hero\":\"AhAs\",\"villain1\":\"KcKd\",\"villain2\":\"QhQs\"}",
            resp);
        std::printf("    [live_solver rc=%d] %s\n", drc, resp.substr(0, 160).c_str());
        check(drc == 0 && contains(resp, "\"equity_p0\""),
              "live_solver serves preflop_equity_3way from the loaded tensor");
        if (contains(resp, "\"equity_p0\"")) {
            // The daemon value must equal the table cell (AA vs KK vs QQ).
            size_t k = resp.find("\"equity_p0\":");
            double daemon_p0 = (k != std::string::npos) ? std::atof(resp.c_str() + k + 12) : -1.0;
            std::printf("    daemon equity_p0 = %.6f vs tensor %.6f\n", daemon_p0, (double)aa);
            check(std::fabs(daemon_p0 - (double)aa) < 1e-6,
                  "daemon equity_p0 equals the tensor cell value");
        }
        std::remove("preflop_3way_dryrun.bin");
    }

    // ── 5. Anchor generator + daemon E2E ───────────────────────────────
    std::printf("\n── gen_mtt_anchors --dry-run + live_solver E2E ──\n");
    {
        std::string out;
        std::string cmd = bin_dir() + "/gen_mtt_anchors --dry-run --table " +
                          source_root() + "/preflop_table.bin";
        int rc = run_capture(cmd, out);
        std::printf("    [anchors dry-run rc=%d]\n", rc);
        check(rc == 0, "gen_mtt_anchors --dry-run exits 0 (< 5 s, 1 stack x 2 flops)");
        check(contains(out, "round-trip header validation: OK"),
              "MTTA round-trip header validation passes");

        // Raw layout check on the dry-run artifact.
        {
            FILE* f = std::fopen("preflop_anchors_mtt_dryrun.bin", "rb");
            bool layout_ok = false;
            size_t tensor_bytes = 0;
            if (f) {
                char magic[4];
                uint32_t ver = 0, ns = 0, np = 0, nc = 0, na = 0;
                uint64_t off = 0;
                if (std::fread(magic, 1, 4, f) == 4 &&
                    std::fread(&ver, 4, 1, f) == 1 && std::fread(&ns, 4, 1, f) == 1 &&
                    std::fread(&np, 4, 1, f) == 1 && std::fread(&nc, 4, 1, f) == 1 &&
                    std::fread(&na, 4, 1, f) == 1 && std::fread(&off, 8, 1, f) == 1) {
                    tensor_bytes = (size_t)ns * np * nc * na;
                    layout_ok = (std::memcmp(magic, "MTTA", 4) == 0 && ver == 1 &&
                                 ns == 1 && np == 8 && nc == 169 && na == 4 &&
                                 off == 32);
                    // uint8 tensor values are probabilities 0..255: sum of
                    // the four actions of any cell ~ 255.
                    std::vector<uint8_t> cell(4);
                    if (layout_ok && tensor_bytes == 8 * 169 * 4) {
                        long total = 0;
                        for (size_t i = 0; i < tensor_bytes; i += 4) {
                            if (std::fseek(f, (long)off + (long)i, SEEK_SET) != 0) { layout_ok = false; break; }
                            if (std::fread(cell.data(), 1, 4, f) != 4) { layout_ok = false; break; }
                            total += cell[0] + cell[1] + cell[2] + cell[3];
                        }
                        size_t cells = tensor_bytes / 4;
                        double avg = (double)total / (double)cells;
                        std::printf("    average per-cell action sum = %.2f (expect ~255)\n", avg);
                        if (std::fabs(avg - 255.0) > 1.0) layout_ok = false;
                    }
                }
                std::fclose(f);
            }
            check(layout_ok, "MTTA layout: magic/version/1-stack/8-pos/169-class/4-action, offset 32");
        }

        // Daemon: anchor query with a FRACTIONAL stack (interpolation).
        // live_solver loads "preflop_anchors_mtt.bin" from its CWD — stage
        // the dry-run artifact under that name in the build directory.
        {
            std::string stage = "cd '" + bin_dir() + "' && rm -f preflop_anchors_mtt.bin && "
                                "cp preflop_anchors_mtt_dryrun.bin preflop_anchors_mtt.bin && echo STAGED";
            int crc = run_capture(stage, out);
            check(crc == 0 && contains(out, "STAGED"), "anchor artifact staged for the daemon");

            std::string resp2;
            int arc = run_daemon_query(
                "cd '" + bin_dir() + "' && POSTFLOP_TABLE_PATH=" + source_root() +
                "/preflop_table.bin " + bin_dir() + "/live_solver",
                "{\"query\":\"preflop_anchor\",\"stack_bb\":12.3,\"position\":5,\"hero\":\"AhAs\"}",
                resp2);
            std::printf("    [live_solver anchor rc=%d] %s\n", arc, resp2.substr(0, 200).c_str());
            check(arc == 0 && contains(resp2, "\"p_fold\""),
                  "live_solver serves preflop_anchor (mmap manager + interpolation)");
            if (contains(resp2, "\"p_fold\"")) {
                double s = 0;
                int n = 0;
                for (const char* key : {"\"p_fold\":", "\"p_call\":", "\"p_raise\":", "\"p_allin\":"}) {
                    size_t k = resp2.find(key);
                    if (k != std::string::npos) {
                        s += std::atof(resp2.c_str() + k + std::strlen(key));
                        ++n;
                    }
                }
                std::printf("    anchor action probabilities sum = %.4f over %d actions\n", s, n);
                check(n == 4 && std::fabs(s - 1.0) < 0.02,
                      "anchor action probabilities sum to ~1.0 (uint8 quantization)");
            }
            std::remove((bin_dir() + "/preflop_anchors_mtt.bin").c_str());
        }
        std::remove("preflop_anchors_mtt_dryrun.bin");
    }

    std::printf("\n=== [V8] preflop-3way/anchors Summary: %d passed, %d failed ===\n", pass, fail);
    return fail == 0 ? 0 : 1;
}
