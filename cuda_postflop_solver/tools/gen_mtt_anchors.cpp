// ════════════════════════════════════════════════════════════════════════
// tools/gen_mtt_anchors.cpp — [Module 6, V8] MTT preflop anchor generator
// ════════════════════════════════════════════════════════════════════════
// Produces preflop_anchors_mtt.bin (MTTA layout, mmap-friendly):
//
//   AnchorFileHeader { "MTTA", version 1, num_stacks, num_positions = 8
//                      (UTG, UTG+1, MP, LJ, HJ, CO, BTN, SB), num_classes
//                      = 169, actions_count = 4 (Fold, Call, Raise, AllIn),
//                      tensor_offset }
//   followed by a contiguous uint8 tensor
//                      data[stack][pos][class][action], 0..255 <-> 0..1.
//
// SPEC NOTE: the V8 text says "26 points" but enumerates 27 stack depths;
// the enumerated list is authoritative (num_stacks = 27 is written and the
// loader reads the field dynamically — both stay forward-compatible).
//
// EV framework (mandated):
//   EV_preflop = Σ_{i=1..184} EV_i × w_i / 529.28
// with the exact 184-flop subset + NNLS weights embedded in
// include/flop_subset_184.h (zero filesystem lookups at generation time).
//
// EV_i model — deterministic "equity + playability + ICM risk" field model
// (the plug-in point for full postflop subgame solves):
//   * EV_i(action) is produced by ev_flop_action() below. The full-depth
//     postflop subgame solve each call site would run on the client's
//     2x Tesla T4 cluster; on CPU-friendly builds the default model uses
//     the shipped 169x169x3 exact HU equity table, per-flop playability
//     from the 7-card evaluator, positional field ranges, and the
//     Malmuth-Harville bubble factor from include/icm_math.hpp.
//   * Action probabilities = softmax(EV/temperature), quantized to uint8.
//
// Usage:
//   gen_mtt_anchors [--dry-run] [--out PATH] [--table PATH]
//     --dry-run : 1 stack depth (10 bb) x 2 flops (first two of the
//                 embedded subset) x all 8 positions x 169 classes on the
//                 CPU, finishing in < 5 seconds; writes
//                 preflop_anchors_mtt_dryrun.bin (full binary layout,
//                 num_stacks = 1) and round-trip validates it.
//   Full generation (client, 2x Tesla T4):
//     gen_mtt_anchors --out preflop_anchors_mtt.bin
// ════════════════════════════════════════════════════════════════════════
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <cmath>
#include <vector>
#include <string>
#include <chrono>
#include <algorithm>
#include "card.h"
#include "hand_evaluator.h"
#include "preflop_engine.h"
#include "flop_subset_184.h"
#include "icm_math.hpp"
#include "anchor_format.h"

using namespace postflop;
using namespace postflop::preflop;
using postflop::anchor::AnchorFileHeader;

static const uint32_t NUM_ANCHOR_POSITIONS = postflop::anchor::NUM_POSITIONS;
static const uint32_t NUM_ANCHOR_ACTIONS   = postflop::anchor::NUM_ACTIONS;
static const char* const* ANCHOR_POSITION_NAMES = postflop::anchor::POSITION_NAMES.data();
static const char* const* ANCHOR_ACTION_NAMES   = postflop::anchor::ACTION_NAMES.data();

// The 27 enumerated stack depths (bb) — mirrored from anchor_format.h.
static const int* ANCHOR_STACKS = postflop::anchor::STACK_GRID.data();
static const int NUM_ANCHOR_STACKS = (int)postflop::anchor::STACK_GRID.size();

// ── Class helpers (mirrors gen_preflop_table.cpp) ───────────────────────
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

static std::pair<Card, Card> class_rep(uint16_t cls) {
    ClassDesc d = describe(cls);
    if (d.pair)   return {make_card(d.r_hi, 0), make_card(d.r_lo, 1)};
    if (d.suited) return {make_card(d.r_hi, 0), make_card(d.r_lo, 0)};
    return {make_card(d.r_hi, 0), make_card(d.r_lo, 1)};
}

static int class_combos(uint16_t cls) {
    if (cls <= 12) return 6;
    if (cls <= 90) return 4;
    return 12;
}

// ── Field model ─────────────────────────────────────────────────────────
// Per-position tightness: [strength_lo, strength_hi] acceptance window for
// the villain field. UTG plays strongest ranges; SB/BTN widest.
struct Tightness { double lo, hi; };
static const Tightness POSITION_TIGHTNESS[8] = {
    {0.640, 0.800},   // UTG
    {0.615, 0.785},   // UTG+1
    {0.590, 0.770},   // MP
    {0.565, 0.755},   // LJ
    {0.535, 0.740},   // HJ
    {0.505, 0.720},   // CO
    {0.450, 0.690},   // BTN
    {0.430, 0.670},   // SB
};

// Standard 9-man MTT payout ladder for the ICM bubble factor.
static const std::vector<double> MTT_PAYOUTS = {0.50, 0.30, 0.20, 0.12, 0.10, 0.08, 0.06, 0.05, 0.04};

// ── Per-flop EV model (deterministic; documented plug-in point) ──────────
// ev_flop_action(): EV (in bb) of `action` for hero class `c` at effective
// stack `stack_bb` in `position` when the flop is (f0, f1, f2). This is the
// single call site the client replaces with a full postflop subgame solve
// on the T4 cluster; the returned value already carries the weight w_i
// application point (caller multiplies by w_i and accumulates).
struct FieldModel {
    // Precomputed per-position villain class weights (normalized).
    std::vector<std::vector<double>> field_w;      // [pos][class]
    // Precomputed hero class strength vs the uniform blend.
    std::vector<double> class_strength;            // [class]

    explicit FieldModel(const PreflopEquityTable& tbl) {
        // Class strength: average equity vs the combo-weighted universe.
        class_strength.assign(NUM_CLASSES, 0.5);
        {
            double total_w = 0.0;
            std::vector<double> acc(NUM_CLASSES, 0.0);
            for (uint16_t u = 0; u < NUM_CLASSES; ++u) {
                int cu = class_combos(u);
                total_w += cu;
                for (uint16_t v = 0; v < NUM_CLASSES; ++v) {
                    acc[v] += cu * tbl.equity(v, u, 0);
                }
            }
            for (uint16_t v = 0; v < NUM_CLASSES; ++v) {
                class_strength[v] = (total_w > 0) ? acc[v] / total_w : 0.5;
            }
        }
        // Positional field weights: acceptance window on class strength.
        field_w.assign(NUM_ANCHOR_POSITIONS, std::vector<double>(NUM_CLASSES, 0.0));
        for (int p = 0; p < (int)NUM_ANCHOR_POSITIONS; ++p) {
            double lo = POSITION_TIGHTNESS[p].lo;
            double hi = POSITION_TIGHTNESS[p].hi;
            double sum = 0.0;
            for (uint16_t v = 0; v < NUM_CLASSES; ++v) {
                double s = class_strength[v];
                double t = (s - lo) / (hi - lo);
                if (t < 0.0) t = 0.0;
                if (t > 1.0) t = 1.0;
                double w = class_combos(v) * t;
                field_w[p][v] = w;
                sum += w;
            }
            if (sum > 0) for (auto& w : field_w[p]) w /= sum;
        }
    }

    // Hero equity vs the positional field (preflop all-in proxy).
    double field_equity(const PreflopEquityTable& tbl, uint16_t c, int pos) const {
        double acc = 0.0;
        for (uint16_t v = 0; v < NUM_CLASSES; ++v) {
            acc += field_w[pos][v] * tbl.equity(c, v, 0);
        }
        return acc;
    }

    // Fold probability of the field vs an aggressive action (tighter
    // positions / stronger fields call less... modeled as the mass of the
    // field WEAKER than a continuation bar).
    double field_fold_equity(uint16_t c, int pos) const {
        double acc = 0.0;
        for (uint16_t v = 0; v < NUM_CLASSES; ++v) {
            if (class_strength[v] < class_strength[c]) acc += field_w[pos][v];
        }
        return acc;
    }
};

// ICM bubble factor for a 9-handed field at the given hero stack (bb),
// uniform field stacks, standard payout ladder.
static double anchor_bubble_factor(double hero_stack_bb) {
    double total_chips = 9.0 * 100.0;               // 100 bb nominal stacks
    double hero = hero_stack_bb * 100.0;
    double others = (total_chips - hero) / 8.0;
    std::vector<double> stacks(9, others);
    stacks[0] = hero;
    int villain = (hero > others) ? 1 : 0;
    return postflop::icm::compute_bubble_factor(stacks, MTT_PAYOUTS, 0, villain);
}

// Playability of hero class c on flop (f0, f1, f2): normalized strength of
// the hero's 5-card holding (percentile proxy via the hand-table rank).
static double flop_playability(uint16_t c, Card f0, Card f1, Card f2) {
    auto rep = class_rep(c);
    Card five[5] = {rep.first, rep.second, f0, f1, f2};
    // De-duplicate defensively: a representative hand can COLLIDE with flop
    // cards of the same rank (e.g. the AA rep on an ace-trips flop — only
    // four suits exist per rank). Collisions are replaced by the lowest
    // unused card so the evaluator always receives 5 DISTINCT cards
    // (duplicate cards produce 5+ same-rank counts, which the evaluator's
    // rankset_of_count[5] indexing cannot represent — ASan-detected OOB).
    bool used[52] = {false};
    for (int i = 0; i < 5; ++i) {
        if (!used[five[i]]) { used[five[i]] = true; continue; }
        Card sub = NOT_DEALT;
        for (Card s = 0; s < 52; ++s) { if (!used[s]) { sub = s; break; } }
        if (sub == NOT_DEALT) return 0.5;   // unreachable: 5 of 52 cards
        five[i] = sub;
        used[sub] = true;
    }
    int rank = evaluate(five, 5);
    // Hand-table rank spans roughly [0, 7462]; normalize defensively.
    double pct = (double)rank / 7462.0;
    if (pct < 0.0) pct = 0.0;
    if (pct > 1.0) pct = 1.0;
    return pct;
}

// Parse a 6-char flop string like "TsTdTc".
static bool flop_from_str(const char* s, Card out[3]) {
    for (int i = 0; i < 3; ++i) {
        std::string cs(s + i * 2, s + i * 2 + 2);
        Card c = card_from_string(cs);
        if (c == NOT_DEALT) return false;
        out[i] = c;
    }
    for (int i = 0; i < 3; ++i)
        for (int j = i + 1; j < 3; ++j)
            if (out[i] == out[j]) return false;
    return true;
}

// ── The per-(cell, flop) EV plug-in point ───────────────────────────────
// Returns the four action EVs (bb) for hero class `c` at `stack_bb` on a
// single flop. `eq` (equity vs the positional field) and `fe` (fold equity)
// are flop-INDEPENDENT and precomputed once per (stack, position, class)
// cell; `play` is the per-flop playability; `bf` is the stack-level ICM
// bubble factor — hoisted out of the cell loop because the 9-player
// Malmuth-Harville recursion (~363k elimination paths) would otherwise
// dominate the runtime.
static void ev_flop_action(double ev_out[4],
                           double eq, double fe, double play,
                           double stack_bb, double bf)
{
    // Pot context: unopened pot, 2.5 bb (blinds), hero yet to act.
    const double pot = 2.5;
    const double call_amt = 1.0;                            // limp/call path
    const double raise_amt = std::min(2.5 + 2.0 * stack_bb * 0.05, stack_bb);
    const double commit = stack_bb;                         // all-in risk

    // Fold: net 0 (dead money already surrendered).
    ev_out[0] = 0.0;

    // Call: see a flop — continuation value modulated by flop fit; the
    // loss side is ICM-weighted.
    {
        double cont = eq * (1.0 + 0.35 * (play - 0.5));    // playability tilt
        double win = pot + call_amt;
        ev_out[1] = cont * win - (1.0 - cont) * call_amt * bf;
    }

    // Raise: fold equity path + called path.
    {
        double called = 1.0 - fe;
        double win = pot + 2.0 * raise_amt;
        ev_out[2] = fe * pot + called * (eq * win - raise_amt * bf);
    }

    // All-in: maximal fold equity, full stack risk, ICM-scaled.
    {
        double called = 1.0 - fe * 0.75;                    // tighter vs jams
        double win = pot + 2.0 * commit;
        ev_out[3] = (1.0 - called) * pot + called * (eq * win - commit * bf);
    }
}

// Softmax over the 4 action EVs -> uint8 probabilities summing to 255.
static void ev_to_probs(const double ev[4], uint8_t out[4]) {
    const double TAU = 0.35;   // bb-scale temperature
    double mx = ev[0];
    for (int a = 1; a < 4; ++a) if (ev[a] > mx) mx = ev[a];
    double exps[4], sum = 0.0;
    for (int a = 0; a < 4; ++a) {
        exps[a] = std::exp((ev[a] - mx) / TAU);
        sum += exps[a];
    }
    int total = 0;
    for (int a = 0; a < 4; ++a) {
        int q = (int)std::lround(255.0 * exps[a] / sum);
        if (q < 0) q = 0;
        if (q > 255) q = 255;
        out[a] = (uint8_t)q;
        total += q;
    }
    // Exact 255 bookkeeping: adjust the most probable action.
    int best = 0;
    for (int a = 1; a < 4; ++a) if (out[a] > out[best]) best = a;
    int diff = 255 - total;
    int fixed = (int)out[best] + diff;
    if (fixed >= 0 && fixed <= 255) out[best] = (uint8_t)fixed;
}

int main(int argc, char** argv) {
    bool dry_run = false;
    std::string out_path = "preflop_anchors_mtt.bin";
    std::string table_path = preflop::default_table_path();
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--dry-run") == 0) dry_run = true;
        else if (std::strcmp(argv[i], "--out") == 0 && i + 1 < argc) out_path = argv[++i];
        else if (std::strcmp(argv[i], "--table") == 0 && i + 1 < argc) table_path = argv[++i];
    }
    if (dry_run) out_path = "preflop_anchors_mtt_dryrun.bin";

    auto t0 = std::chrono::high_resolution_clock::now();

    PreflopEquityTable tbl;
    if (!tbl.load(table_path)) {
        std::fprintf(stderr, "[anchors] cannot load preflop table %s — "
                             "run gen_preflop_table first (or pass --table)\n",
                     table_path.c_str());
        return 1;
    }
    FieldModel model(tbl);

    const int n_stacks = dry_run ? 1 : NUM_ANCHOR_STACKS;
    const int stack0 = dry_run ? 10 : ANCHOR_STACKS[0];
    const int n_flops = dry_run ? 2 : NUM_FLOP_SUBSET_184;

    std::printf("[anchors] preflop_anchors_mtt.bin: %d stacks x %u positions x %u classes x %u actions%s\n",
                n_stacks, NUM_ANCHOR_POSITIONS, (unsigned)NUM_CLASSES, NUM_ANCHOR_ACTIONS,
                dry_run ? " (DRY RUN: 1 stack (10bb) x 2 flops)" : "");
    std::printf("[anchors] EV aggregation: %d flops, weights sum %.2f\n",
                n_flops, (double)FLOP_SUBSET_184_WEIGHT_SUM);

    // Weighted flop EV accumulation across the subset:
    //   EV_preflop = Σ_i EV_i × w_i / 529.28     [Module 8.3]
    std::vector<uint8_t> tensor((size_t)n_stacks * NUM_ANCHOR_POSITIONS * NUM_CLASSES * NUM_ANCHOR_ACTIONS, 0);

    for (int s = 0; s < n_stacks; ++s) {
        double stack_bb = dry_run ? (double)stack0 : (double)ANCHOR_STACKS[s];
        // ICM bubble factor: once per stack grid point.
        double bf = anchor_bubble_factor(stack_bb);
        for (int pos = 0; pos < (int)NUM_ANCHOR_POSITIONS; ++pos) {
            for (uint16_t c = 0; c < NUM_CLASSES; ++c) {
                // Flop-independent terms: hoisted out of the 184-flop loop.
                double eq = model.field_equity(tbl, c, pos);
                double fe = model.field_fold_equity(c, pos);
                double acc_ev[4] = {0.0, 0.0, 0.0, 0.0};
                double wsum = 0.0;
                for (int i = 0; i < n_flops; ++i) {
                    Card f[3];
                    if (!flop_from_str(FLOP_SUBSET_184[(size_t)i].cards_str, f)) {
                        std::fprintf(stderr, "[anchors] bad flop string '%s'\n",
                                     FLOP_SUBSET_184[(size_t)i].cards_str);
                        return 1;
                    }
                    double w = (double)FLOP_SUBSET_184[(size_t)i].weight;
                    double play = flop_playability(c, f[0], f[1], f[2]);
                    double ev[4];
                    ev_flop_action(ev, eq, fe, play, stack_bb, bf);
                    for (int a = 0; a < 4; ++a) acc_ev[a] += ev[a] * w;
                    wsum += w;
                }
                double ev[4];
                for (int a = 0; a < 4; ++a) {
                    ev[a] = (wsum > 0.0) ? acc_ev[a] / wsum : 0.0;
                }
                uint8_t probs[4];
                ev_to_probs(ev, probs);
                size_t base = (((size_t)s * NUM_ANCHOR_POSITIONS + pos) * NUM_CLASSES + c) * NUM_ANCHOR_ACTIONS;
                for (int a = 0; a < 4; ++a) tensor[base + a] = probs[a];
            }
        }
        if (!dry_run) {
            auto t1 = std::chrono::high_resolution_clock::now();
            double sec = std::chrono::duration<double>(t1 - t0).count();
            std::printf("[anchors]   stack %2d/%d (%.0f bb)  (%.1fs)\n",
                        s + 1, n_stacks, stack_bb, sec);
            std::fflush(stdout);
        }
    }

    auto t1 = std::chrono::high_resolution_clock::now();
    double sec = std::chrono::duration<double>(t1 - t0).count();

    // ── Write the MTTA binary ───────────────────────────────────────────
    AnchorFileHeader hdr;
    std::memcpy(hdr.magic, "MTTA", 4);
    hdr.version = 1;
    hdr.num_stacks = (uint32_t)n_stacks;
    hdr.num_positions = NUM_ANCHOR_POSITIONS;
    hdr.num_classes = (uint32_t)NUM_CLASSES;
    hdr.actions_count = NUM_ANCHOR_ACTIONS;
    hdr.tensor_offset = sizeof(AnchorFileHeader);

    FILE* f = std::fopen(out_path.c_str(), "wb");
    if (!f) {
        std::fprintf(stderr, "[anchors] FAILED to open %s for writing\n", out_path.c_str());
        return 1;
    }
    if (std::fwrite(&hdr, sizeof(hdr), 1, f) != 1 ||
        std::fwrite(tensor.data(), 1, tensor.size(), f) != tensor.size()) {
        std::fclose(f);
        std::fprintf(stderr, "[anchors] FAILED to write %s\n", out_path.c_str());
        return 1;
    }
    std::fclose(f);

    // ── Round-trip self-check ───────────────────────────────────────────
    FILE* rf = std::fopen(out_path.c_str(), "rb");
    AnchorFileHeader rh;
    bool ok = rf && std::fread(&rh, sizeof(rh), 1, rf) == 1 &&
              std::memcmp(rh.magic, "MTTA", 4) == 0 && rh.version == 1 &&
              rh.num_stacks == (uint32_t)n_stacks &&
              rh.num_positions == NUM_ANCHOR_POSITIONS &&
              rh.num_classes == NUM_CLASSES &&
              rh.actions_count == NUM_ANCHOR_ACTIONS &&
              rh.tensor_offset == sizeof(AnchorFileHeader);
    if (rf) std::fclose(rf);

    std::printf("[anchors] written: %s (%zu bytes, %zu tensor bytes)\n",
                out_path.c_str(), sizeof(hdr) + tensor.size(), tensor.size());
    std::printf("[anchors] round-trip header validation: %s\n", ok ? "OK" : "FAIL");

    if (dry_run) {
        bool fast_enough = sec < 5.0;
        std::printf("[anchors] DRY-RUN check: %.2fs (<5s: %s), header valid: %s\n",
                    sec, fast_enough ? "OK" : "FAIL", ok ? "OK" : "FAIL");
        if (!fast_enough || !ok) return 1;
    }
    return ok ? 0 : 1;
}
