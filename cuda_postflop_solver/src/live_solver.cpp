// ════════════════════════════════════════════════════════════════════════
// live_solver.cpp — Persistent daemon-mode live solver (Defect 1.6)
// ════════════════════════════════════════════════════════════════════════
// Long-running service: reads one JSON query per line from stdin, writes one
// JSON response per line to stdout (flushed). "QUIT" terminates.
//
// Per-query pipeline:
//   Defect 1.2   no dummy cards: flop inputs keep turn/river NOT_DEALT and
//                route to chance expansion (HU) / rollout leaves (multiway)
//   Defect 1.5   node locking bound to semantic Action::Type
//   Defect 1.8   exact chip accounting (starting pot split, invested[])
//   Section 2    Tier 1 (HU): full tree, 49-turn/48-river chance expansion,
//                5 flop sizes / 2 turn / 2 river
//                Tier 2 (3-8 players): max_depth = 1, exact 820-board leaves
//   Module 3.1   <= 12 BB preflop queries served from preflop_table.bin
//   Module 3.2   optional Bayesian range filtering (action probabilities)
//   Module 3.3   pseudo-harmonic custom bet injection (custom_bets)
//   Defect 1.10  CDF mixed-strategy sampling with RNG roll reporting
//
// [V8]
//   Module 1     8-max MTT tables: num_players up to MAX_PLAYERS = 8
//   Module 2     multiway street-ends evaluated by the EXACT 820-board
//                enumeration kernel (zero Monte Carlo noise)
//   Module 3     "preflop_equity_3way" served from the 169^3 tensor
//                (preflop_3way.bin, ~57.9 MB, loaded at startup)
//   Module 4     "bubble_factor" (float) parsed from JSON queries and
//                assigned to GpuMemory::bubble_factor / TreeConfig — the
//                solve runs under ICM risk scaling; an optional "icm"
//                payload (stacks + payouts) derives it exactly via
//                Malmuth-Harville (include/icm_math.hpp)
//   Module 5     "dynamic_lock" payload: continuous empirical HUD
//                frequencies applied through apply_dynamic_node_lock
//   Module 6     "preflop_anchor" served from preflop_anchors_mtt.bin via
//                the mmap-backed PreflopAnchorManager (O(1) queries,
//                sub-millisecond linear stack interpolation)
//
// Protocol (one JSON object per line):
//   {"hero": "AhKh", "board": "AsKd2c", "pot": 100, "stack": 1900,
//    "num_players": 2, "locked_mask": 0, "profile_id": 0, "device_id": 0,
//    "iterations": 300, "custom_bets": [137], "ranges": ["...", "..."],
//    "bayes_probs": [[..], [..], ...],
//    "bubble_factor": 1.35,
//    "icm": {"stacks": [..], "payouts": [..], "hero_idx": 0, "villain_idx": 1},
//    "dynamic_lock": {"player_idx": 1, "fold": 0.72, "call": 0.20, "raise": 0.08},
//    "query": "postflop" | "preflop_equity" | "preflop_decision"
//             | "preflop_equity_3way" | "preflop_anchor" | "icm"}
// ════════════════════════════════════════════════════════════════════════
#include <iostream>
#include <sstream>
#include <vector>
#include <string>
#include <cstring>
#include <memory>
#include <iomanip>
#include <random>
#include <chrono>
#include <algorithm>
#include <cstdlib>
#include <cmath>

#include "game.h"
#include "solver.h"
#include "gpu_solver.h"
#include "card.h"
#include "range.h"
#include "action_tree.h"
#include "bet_translation.h"
#include "bayesian_range.h"
#include "preflop_engine.h"
#include "node_locking.h"
#include "icm_math.hpp"
#include "anchor_format.h"
#include "json_mini.h"

#if defined(__linux__) || defined(__APPLE__)
#include <fcntl.h>
#include <unistd.h>
#include <sys/mman.h>
#include <sys/stat.h>
#define ANCHOR_MMAP_AVAILABLE 1
#endif

using namespace postflop;

// ── Default opponent ranges (unchanged from the legacy build) ───────────
static const char* default_opp_ranges[5] = {
    "22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s, 64s, ATo+, KJo+, QJo",
    "55+, A8s+, KJs+, QJs, AJo+, KTo+, QTo+",
    "88+, ATs+, KQs, AQo+, AJs",
    "TT+, AQs+, AKo, KQs",
    "JJ+, AKs, AKo"
};

// ── [Module 6.2, V8] mmap-backed MTT preflop anchor manager ────────────
// Zero-copy O(1) lookups into preflop_anchors_mtt.bin: the file is mapped
// once and queries dereference the uint8 tensor directly. Fractional live
// stack depths interpolate linearly between the two bracketing grid points
// (sub-millisecond: two pointer reads and a lerp per action).
class PreflopAnchorManager {
public:
    PreflopAnchorManager() = default;
    ~PreflopAnchorManager() { release(); }
    PreflopAnchorManager(const PreflopAnchorManager&) = delete;
    PreflopAnchorManager& operator=(const PreflopAnchorManager&) = delete;

    bool load(const std::string& path) {
        release();
        FILE* f = std::fopen(path.c_str(), "rb");
        if (!f) return false;
        anchor::AnchorFileHeader hdr;
        if (std::fread(&hdr, sizeof(hdr), 1, f) != 1) { std::fclose(f); return false; }
        std::fclose(f);
        if (std::memcmp(hdr.magic, "MTTA", 4) != 0) return false;
        if (hdr.version != 1) return false;
        if (hdr.num_positions != anchor::NUM_POSITIONS ||
            hdr.num_classes != 169 || hdr.actions_count != anchor::NUM_ACTIONS) {
            return false;
        }
        if (hdr.num_stacks == 0 || hdr.num_stacks > 1024) return false;
        size_t tensor_bytes = (size_t)hdr.num_stacks * hdr.num_positions *
                              hdr.num_classes * hdr.actions_count;
        if (hdr.tensor_offset != sizeof(anchor::AnchorFileHeader)) return false;

        // Stack grid: the canonical grid when the stack count matches,
        // otherwise a defensive uniform grid rebuilt from the header.
        stacks_.clear();
        if (hdr.num_stacks == anchor::STACK_GRID.size()) {
            for (int st : anchor::STACK_GRID) stacks_.push_back((double)st);
        } else {
            for (uint32_t i = 0; i < hdr.num_stacks; ++i) {
                stacks_.push_back((double)anchor::STACK_GRID.back() * (double)(i + 1) / (double)hdr.num_stacks);
            }
        }
        num_stacks_ = hdr.num_stacks;

#if ANCHOR_MMAP_AVAILABLE
        fd_ = ::open(path.c_str(), O_RDONLY);
        if (fd_ >= 0) {
            struct stat st;
            if (::fstat(fd_, &st) == 0 &&
                (size_t)st.st_size >= sizeof(hdr) + tensor_bytes) {
                void* m = ::mmap(nullptr, (size_t)st.st_size, PROT_READ, MAP_PRIVATE, fd_, 0);
                if (m != MAP_FAILED) {
                    map_ = m;
                    mapped_ = (const uint8_t*)m + hdr.tensor_offset;
                    map_bytes_ = (size_t)st.st_size;
                    loaded_ = true;
                    return true;
                }
            }
            ::close(fd_);
            fd_ = -1;
        }
#endif
        // Portable fallback: plain read (still O(1) after load).
        fallback_.resize(tensor_bytes);
        FILE* rf = std::fopen(path.c_str(), "rb");
        if (!rf) return false;
        if (std::fseek(rf, (long)hdr.tensor_offset, SEEK_SET) != 0 ||
            std::fread(fallback_.data(), 1, tensor_bytes, rf) != tensor_bytes) {
            std::fclose(rf);
            fallback_.clear();
            return false;
        }
        std::fclose(rf);
        mapped_ = fallback_.data();
        loaded_ = true;
        return true;
    }

    bool is_loaded() const { return loaded_; }
    uint32_t num_stacks() const { return num_stacks_; }

    // Action probabilities (Fold/Call/Raise/AllIn) for hero_class at a
    // (fractional) effective stack depth and table position. Stack depths
    // outside the grid clamp to the nearest endpoint.
    void action_probs(double stack_bb, int position, uint16_t hero_class,
                      double out_probs[4]) const {
        out_probs[0] = out_probs[1] = out_probs[2] = out_probs[3] = 0.25;
        if (!loaded_) return;
        if (position < 0 || position >= (int)anchor::NUM_POSITIONS) return;
        if (hero_class >= 169) return;

        // Bracketing grid indices (stacks_ is ascending).
        int lo = 0, hi = 0;
        for (size_t i = 0; i < stacks_.size(); ++i) {
            if (stacks_[i] <= stack_bb) lo = (int)i;
        }
        hi = lo;
        if ((size_t)lo + 1 < stacks_.size()) hi = lo + 1;
        if (stacks_[0] > stack_bb) { lo = hi = 0; }

        auto cell = [&](int stk) -> const uint8_t* {
            size_t idx = anchor::tensor_index(num_stacks_, anchor::NUM_POSITIONS, 169,
                                              (size_t)stk, (size_t)position,
                                              (size_t)hero_class, 0);
            return mapped_ + idx;
        };

        const uint8_t* p_lo = cell(lo);
        const uint8_t* p_hi = cell(hi);
        double span = stacks_[hi] - stacks_[lo];
        double w = (span > 1e-9) ? (stack_bb - stacks_[lo]) / span : 0.0;
        if (w < 0.0) w = 0.0;
        if (w > 1.0) w = 1.0;
        for (int a = 0; a < (int)anchor::NUM_ACTIONS; ++a) {
            double v = (1.0 - w) * (double)p_lo[a] + w * (double)p_hi[a];
            out_probs[a] = v / 255.0;
        }
    }

private:
    void release() {
#if ANCHOR_MMAP_AVAILABLE
        if (map_) { ::munmap(map_, map_bytes_); map_ = nullptr; }
        if (fd_ >= 0) { ::close(fd_); fd_ = -1; }
#endif
        mapped_ = nullptr;
        fallback_.clear();
        loaded_ = false;
        num_stacks_ = 0;
    }

    bool loaded_ = false;
    uint32_t num_stacks_ = 0;
    std::vector<double> stacks_;
    const uint8_t* mapped_ = nullptr;
    std::vector<uint8_t> fallback_;
#if ANCHOR_MMAP_AVAILABLE
    void* map_ = nullptr;
    size_t map_bytes_ = 0;
    int fd_ = -1;
#endif
};

// ── Helpers ─────────────────────────────────────────────────────────────
static std::string fmt4(float v) {
    std::ostringstream os;
    os << std::fixed << std::setprecision(4) << v;
    return os.str();
}

struct QueryContext {
    std::string hero;            // 4 chars
    std::string board;           // 6/8/10 chars
    int pot = 0;
    int stack = 0;
    int num_players = 4;
    uint8_t locked_mask = 0;
    int profile_id = 0;
    int device_id = 0;
    int iterations = -1;         // -1 = policy default
    std::vector<int32_t> custom_bets;
    std::vector<std::string> ranges;
    std::vector<std::vector<float>> bayes_probs;
    std::string query = "postflop";
    float bb_size = 100.0f;
    // [Module 4, V8] ICM bubble factor (1.0 = pure Chip-EV).
    float bubble_factor = 1.0f;
    // [Module 5, V8] dynamic empirical HUD lock (present => applied).
    bool has_dynamic_lock = false;
    DynamicActionLock dynamic_lock;
};

// Build + solve one postflop query; returns the response JSON object.
static JsonValue solve_postflop(const QueryContext& q, int effective_iters) {
    JsonValue out;
    out.type = JsonType::Object;

    if (q.hero.length() != 4 || q.board.length() < 6) {
        out.obj["error"] = JsonValue::jstr("Invalid cards input");
        out.obj["check"] = JsonValue::jnum(1.0);
        out.obj["bet"] = JsonValue::jnum(0.0);
        out.obj["allin"] = JsonValue::jnum(0.0);
        return out;
    }

    Card hero_c1 = card_from_string(q.hero.substr(0, 2));
    Card hero_c2 = card_from_string(q.hero.substr(2, 2));
    if (hero_c1 > hero_c2) std::swap(hero_c1, hero_c2);

    // [Module 1, V8] 8-max MTT tables (V7 clamped to 6).
    int num_players = q.num_players;
    if (num_players < 2) num_players = 2;
    if (num_players > MAX_PLAYERS) num_players = MAX_PLAYERS;

    CardConfig cc;
    cc.num_players = num_players;

    // Hero: 100% of combos (guarantees hero_idx is always found).
    cc.ranges.push_back(Range::ones());
    for (int p = 1; p < num_players; ++p) {
        size_t ri = p - 1;
        if (ri < q.ranges.size() && !q.ranges[ri].empty()) {
            cc.ranges.push_back(Range::from_string(q.ranges[ri]));
        } else if (num_players - 1 <= 5) {
            cc.ranges.push_back(Range::from_string(default_opp_ranges[ri < 5 ? ri : 4]));
        } else {
            cc.ranges.push_back(Range::from_string(default_opp_ranges[4]));
        }
    }

    uint64_t used_mask = 0;
    used_mask |= card_to_bit(hero_c1);
    used_mask |= card_to_bit(hero_c2);

    cc.flop[0] = card_from_string(q.board.substr(0, 2)); used_mask |= card_to_bit(cc.flop[0]);
    cc.flop[1] = card_from_string(q.board.substr(2, 2)); used_mask |= card_to_bit(cc.flop[1]);
    cc.flop[2] = card_from_string(q.board.substr(4, 2)); used_mask |= card_to_bit(cc.flop[2]);

    // ── Defect 1.2: dummy card synthesis ELIMINATED ─────────────────────
    // Incomplete boards stay NOT_DEALT; the solve routes through chance
    // expansion (HU, Tier 1) or rollout showdown leaves (multiway, Tier 2).
    if (q.board.length() >= 8) {
        cc.turn = card_from_string(q.board.substr(6, 2));
        used_mask |= card_to_bit(cc.turn);
    } else {
        cc.turn = NOT_DEALT;
    }
    if (q.board.length() >= 10) {
        cc.river = card_from_string(q.board.substr(8, 2));
    } else {
        cc.river = NOT_DEALT;
    }

    TreeConfig tc;
    tc.num_players = num_players;
    tc.initial_state = (q.board.length() == 6) ? BoardState::Flop :
                       (q.board.length() == 8) ? BoardState::Turn : BoardState::River;
    tc.starting_pot = q.pot;
    tc.effective_stack = q.stack;
    // [Module 4, V8] ICM bubble factor: propagates into every node at
    // build time (tree_config -> PostFlopNode::bubble_factor) and into
    // GpuMemory at init, so the fold / showdown / exact-820 evaluators all
    // run under the same risk scaling.
    tc.bubble_factor = q.bubble_factor;

    if (num_players == 2) {
        // Tier 1 sizing grid: 5 flop sizes (Check + 25%/50%/75% + All-In),
        // 2 turn sizes (67% + All-In), 2 river sizes (75% + All-In).
        for (int i = 0; i < 2; ++i) {
            tc.flop_bet_sizes[i]  = { {BetSize::PotRelative(0.25), BetSize::PotRelative(0.50),
                                       BetSize::PotRelative(0.75), BetSize::AllIn()}, {} };
            tc.turn_bet_sizes[i]  = { {BetSize::PotRelative(0.67), BetSize::AllIn()}, {} };
            tc.river_bet_sizes[i] = { {BetSize::PotRelative(0.75), BetSize::AllIn()}, {} };
        }
    } else {
        // Tier 2: compact street-bounded grid.
        for (int i = 0; i < num_players; ++i) {
            tc.flop_bet_sizes[i]  = { {BetSize::PotRelative(0.50), BetSize::AllIn()}, {} };
            tc.turn_bet_sizes[i]  = { {BetSize::PotRelative(0.50), BetSize::AllIn()}, {} };
            tc.river_bet_sizes[i] = { {BetSize::PotRelative(0.50), BetSize::AllIn()}, {} };
        }
    }

    // Module 3.3: exact off-grid sizes injected verbatim.
    tc.custom_injected_bets = q.custom_bets;

    // Section 2: explicit depth policy (ActionTree auto-forces max_depth=1
    // for 3+ players; Tier 1 leaves it unrestricted).
    tc.max_depth = (num_players == 2) ? 3 : 1;

    auto t0 = std::chrono::high_resolution_clock::now();

    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    game.allocate_memory(false);   // Defect 1.9: pure FP32

    // Module 3.2: Bayesian range filtering of opponent initial weights.
    if (!q.bayes_probs.empty()) {
        auto& iw = const_cast<CardConfig&>(game.card_config()).initial_weights;
        for (size_t p = 1; p < iw.size() && p < q.bayes_probs.size() + 1; ++p) {
            const auto& probs = q.bayes_probs[p - 1];
            int nh = game.num_private_hands((int)p);
            if ((int)probs.size() >= nh) {
                apply_bayesian_observation(iw[p], probs.data(), nh);
            }
        }
    }

    // Defect 1.5: semantic node locking (legacy profile path — deprecated).
    if (q.locked_mask != 0 && q.profile_id > 0 && !q.has_dynamic_lock) {
        for (int p = 1; p < num_players; ++p) {
            if (q.locked_mask & (1 << p)) {
                apply_node_locking_profile(game, p, static_cast<OpponentProfile>(q.profile_id));
            }
        }
        game.set_locked_players_mask(q.locked_mask);
    }

    // [Module 5, V8] dynamic HUD node-locking: exact empirical action
    // frequencies from the query payload (e.g. SQLite HUD aggregates).
    // Sets game.locked_players_mask itself, freezing both solve paths.
    if (q.has_dynamic_lock) {
        apply_dynamic_node_lock(game, q.dynamic_lock);
    }

    // Solve on the GPU (compat layer on CPU builds — same kernel source).
    game.set_gpu_enabled(true);
    auto gpu_mem = std::make_unique<GpuMemory>();
    if (!gpu_solver_init(game, *gpu_mem, q.device_id)) {
        out.obj["error"] = JsonValue::jstr("GPU init failed");
        out.obj["check"] = JsonValue::jnum(0.5);
        out.obj["bet"] = JsonValue::jnum(0.5);
        out.obj["allin"] = JsonValue::jnum(0.0);
        return out;
    }
    gpu_mem->locked_players_mask = game.locked_players_mask();
    // [Module 4, V8] explicit GpuMemory assignment per spec (already
    // mirrored from TreeConfig at init — kept for visibility/parity).
    gpu_mem->bubble_factor = q.bubble_factor;
    game.set_gpu_mem(std::move(gpu_mem));

    for (uint32_t iter = 1; iter <= (uint32_t)effective_iters; ++iter) {
        gpu_solve_step_dispatch(game, iter);
    }
    gpu_solver_copy_back(game, *game.gpu_mem());

    auto t1 = std::chrono::high_resolution_clock::now();
    double solve_ms = std::chrono::duration<double, std::milli>(t1 - t0).count();

    // Locate hero's combo.
    const auto& hero_hands = game.card_config().private_cards[0];
    int hero_idx = -1;
    for (size_t i = 0; i < hero_hands.size(); ++i) {
        Card h1 = hero_hands[i].first;
        Card h2 = hero_hands[i].second;
        if (h1 > h2) std::swap(h1, h2);
        if (h1 == hero_c1 && h2 == hero_c2) { hero_idx = (int)i; break; }
    }

    const PostFlopNode& root = game.node_arena()[0];
    int na = root.num_actions();
    int nh = game.num_private_hands(0);
    const float* s_data = game.storage1_data();

    // Semantic per-type probabilities at the root for hero's combo.
    float p_check = 0.0f, p_bet = 0.0f, p_allin = 0.0f, p_fold = 0.0f, p_call = 0.0f, p_raise = 0.0f;
    std::vector<float> combo_strats((size_t)na, 0.0f);
    std::vector<std::string> action_names((size_t)na);

    if (hero_idx != -1 && nh > 0) {
        float sum_s = 0.0f;
        for (int a = 0; a < na; ++a) {
            float v = s_data[(size_t)a * nh + hero_idx];
            combo_strats[a] = v;
            sum_s += v;
        }
        if (sum_s > 1e-6f) {
            for (int a = 0; a < na; ++a) combo_strats[a] /= sum_s;
        } else {
            for (int a = 0; a < na; ++a) combo_strats[a] = 1.0f / na;
        }
        for (int a = 0; a < na; ++a) {
            switch ((Action::Type)root.action_type(a)) {
                case Action::Type::Fold:   p_fold += combo_strats[a]; action_names[a] = "fold"; break;
                case Action::Type::Check:  p_check += combo_strats[a]; action_names[a] = "check"; break;
                case Action::Type::Call:   p_call += combo_strats[a]; action_names[a] = "call"; break;
                case Action::Type::Bet:    p_bet += combo_strats[a]; action_names[a] = "bet"; break;
                case Action::Type::Raise:  p_raise += combo_strats[a]; action_names[a] = "raise"; break;
                case Action::Type::AllIn:  p_allin += combo_strats[a]; action_names[a] = "allin"; break;
                default: action_names[a] = "?"; break;
            }
        }
    }

    // ── Defect 1.10: CDF mixed-strategy sampling ────────────────────────
    static std::mt19937_64 rng(std::random_device{}());
    std::uniform_real_distribution<float> dist(0.0f, 1.0f);
    float roll = dist(rng);
    int sampled_action = 0;
    float cumulative = 0.0f;
    for (int a = 0; a < na; ++a) {
        cumulative += combo_strats[a];
        if (roll < cumulative) {
            sampled_action = a;
            break;
        }
    }

    // Legacy-compatible passive/aggressive summary:
    float passive = p_check + p_fold + p_call;
    out.obj["status"] = JsonValue::jstr("ok");
    out.obj["device"] = JsonValue::jnum((double)q.device_id);
    out.obj["tier"] = JsonValue::jstr(num_players == 2 ? "HU_FULL_TREE" : "MW_EXACT_820");
    out.obj["bubble_factor"] = JsonValue::jnum((double)q.bubble_factor);
    out.obj["num_players"] = JsonValue::jnum((double)num_players);
    out.obj["nodes"] = JsonValue::jnum((double)game.num_nodes());
    out.obj["iterations"] = JsonValue::jnum((double)effective_iters);
    out.obj["solve_ms"] = JsonValue::jnum((double)((int)solve_ms));
    out.obj["check"] = JsonValue::jnum(passive);
    out.obj["bet"] = JsonValue::jnum(p_bet + p_raise);
    out.obj["allin"] = JsonValue::jnum(p_allin);
    out.obj["p_check"] = JsonValue::jnum(p_check);
    out.obj["p_fold"] = JsonValue::jnum(p_fold);
    out.obj["p_call"] = JsonValue::jnum(p_call);
    out.obj["p_bet"] = JsonValue::jnum(p_bet);
    out.obj["p_raise"] = JsonValue::jnum(p_raise);
    out.obj["p_allin"] = JsonValue::jnum(p_allin);
    out.obj["sampled_action"] = JsonValue::jnum((double)sampled_action);
    out.obj["sampled_action_type"] = JsonValue::jstr(
        (sampled_action >= 0 && sampled_action < na) ? action_names[sampled_action] : "?");
    out.obj["rng_roll"] = JsonValue::jnum((double)roll);
    out.obj["board_dealt"] = JsonValue::jstr(
        std::to_string(3 + (cc.turn != NOT_DEALT ? 1 : 0) + (cc.river != NOT_DEALT ? 1 : 0)) + " cards");

    gpu_solver_cleanup(*game.gpu_mem());
    return out;
}

int main(int argc, char** argv) {
    std::ios::sync_with_stdio(false);

    int device_id = 0;
    for (int i = 1; i + 1 < argc; ++i) {
        if (std::strcmp(argv[i], "--device") == 0) device_id = std::atoi(argv[i + 1]);
    }
#ifdef CUDA_BUILD
    cudaSetDevice(device_id);
#endif

    // Load the preflop equity table once at startup (Module 3.1).
    bool preflop_table_ok = preflop::global_preflop_table().load(preflop::default_table_path());

    // [Module 3, V8] 3-way preflop tensor (57.9 MB) — optional: queries
    // degrade gracefully when the artifact is absent.
    bool preflop_3way_ok = preflop::global_preflop_3way_table().load(preflop::default_3way_table_path());

    // [Module 6, V8] mmap-backed MTT anchor manager — optional.
    PreflopAnchorManager anchor_mgr;
    bool anchors_ok = anchor_mgr.load("preflop_anchors_mtt.bin");

    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;
        if (line == "QUIT" || line == "quit") break;

        JsonValue req;
        try {
            req = json_parse(line);
        } catch (const std::exception& e) {
            std::cout << "{\"error\": \"JSON parse: " << e.what() << "\"}" << std::endl;
            std::cout.flush();
            continue;
        }

        QueryContext q;
        q.hero = json_get_string(req, "hero", "");
        q.board = json_get_string(req, "board", "");
        q.pot = json_get_int(req, "pot", 0);
        q.stack = json_get_int(req, "stack", 0);
        q.num_players = json_get_int(req, "num_players", 4);
        q.locked_mask = (uint8_t)json_get_int(req, "locked_mask", 0);
        q.profile_id = json_get_int(req, "profile_id", 0);
        q.device_id = json_get_int(req, "device_id", device_id);
        q.iterations = json_get_int(req, "iterations", -1);
        q.query = json_get_string(req, "query", "postflop");
        q.bb_size = (float)json_get_double(req, "bb_size", 100.0);

        // [Module 4, V8] explicit bubble factor, or exact Malmuth-Harville
        // derivation from an "icm" payload {"stacks":[...], "payouts":[...],
        // "hero_idx":i, "villain_idx":j}.
        q.bubble_factor = (float)json_get_double(req, "bubble_factor", -1.0);
        if (q.bubble_factor < 0.0f) {
            auto it = req.obj.find("icm");
            if (it != req.obj.end() && it->second.type == JsonType::Object) {
                const JsonValue& icm = it->second;
                std::vector<double> icm_stacks, icm_payouts;
                for (const JsonValue& v : json_get_array(icm, "stacks")) {
                    if (v.type == JsonType::Number) icm_stacks.push_back(v.num);
                }
                for (const JsonValue& v : json_get_array(icm, "payouts")) {
                    if (v.type == JsonType::Number) icm_payouts.push_back(v.num);
                }
                int hero_idx   = (int)json_get_int(icm, "hero_idx", 0);
                int villain_idx = (int)json_get_int(icm, "villain_idx", 1);
                if ((int)icm_stacks.size() >= 2 && !icm_payouts.empty() &&
                    hero_idx >= 0 && hero_idx < (int)icm_stacks.size() &&
                    villain_idx >= 0 && villain_idx < (int)icm_stacks.size() &&
                    villain_idx != hero_idx) {
                    double bf = postflop::icm::compute_bubble_factor(icm_stacks, icm_payouts,
                                                                    hero_idx, villain_idx);
                    q.bubble_factor = (float)bf;
                } else {
                    q.bubble_factor = 1.0f;
                }
            } else {
                q.bubble_factor = 1.0f;
            }
        }

        // [Module 5, V8] dynamic HUD lock payload:
        //   "dynamic_lock": {"player_idx": 1, "fold": 0.72, "call": 0.20, "raise": 0.08}
        {
            auto it = req.obj.find("dynamic_lock");
            if (it != req.obj.end() && it->second.type == JsonType::Object) {
                const JsonValue& dl = it->second;
                q.dynamic_lock.player_idx = (int)json_get_int(dl, "player_idx", -1);
                q.dynamic_lock.fold  = (float)json_get_double(dl, "fold",  -1.0);
                q.dynamic_lock.check = (float)json_get_double(dl, "check", -1.0);
                q.dynamic_lock.call  = (float)json_get_double(dl, "call",  -1.0);
                q.dynamic_lock.bet   = (float)json_get_double(dl, "bet",   -1.0);
                q.dynamic_lock.raise = (float)json_get_double(dl, "raise", -1.0);
                q.dynamic_lock.allin = (float)json_get_double(dl, "allin", -1.0);
                q.has_dynamic_lock = (q.dynamic_lock.player_idx >= 0 &&
                                      q.dynamic_lock.any_specified());
            }
        }

        for (const JsonValue& v : json_get_array(req, "custom_bets")) {
            if (v.type == JsonType::Number) q.custom_bets.push_back((int32_t)v.num);
        }
        for (const JsonValue& v : json_get_array(req, "ranges")) {
            if (v.type == JsonType::String) q.ranges.push_back(v.str);
        }
        for (const JsonValue& row : json_get_array(req, "bayes_probs")) {
            std::vector<float> probs;
            for (const JsonValue& v : json_get_array_of(row)) probs.push_back((float)v.num);
            q.bayes_probs.push_back(std::move(probs));
        }

        JsonValue out;
        try {
            if (q.query == "preflop_equity") {
                // {"query":"preflop_equity","hero":"AhAs","villain":"KcKd"}
                std::string villain = json_get_string(req, "villain", "");
                out.type = JsonType::Object;
                if (!preflop_table_ok) {
                    out.obj["error"] = JsonValue::jstr("preflop_table.bin not loaded");
                } else if (q.hero.size() == 4 && villain.size() == 4) {
                    auto h = std::make_pair(card_from_string(q.hero.substr(0, 2)),
                                            card_from_string(q.hero.substr(2, 2)));
                    auto v = std::make_pair(card_from_string(villain.substr(0, 2)),
                                            card_from_string(villain.substr(2, 2)));
                    double eq = preflop::global_preflop_table().equity_cards(h, v);
                    out.obj["status"] = JsonValue::jstr("ok");
                    out.obj["equity"] = JsonValue::jnum(eq);
                } else {
                    out.obj["error"] = JsonValue::jstr("hero/villain must be 4-char card strings");
                }
            } else if (q.query == "preflop_equity_3way") {
                // [Module 3, V8] {"query":"preflop_equity_3way",
                //  "hero":"AhAs","villain1":"KcKd","villain2":"QhQs"}
                std::string v1 = json_get_string(req, "villain1", "");
                std::string v2 = json_get_string(req, "villain2", "");
                out.type = JsonType::Object;
                if (!preflop_3way_ok) {
                    out.obj["error"] = JsonValue::jstr("preflop_3way.bin not loaded");
                } else if (q.hero.size() == 4 && v1.size() == 4 && v2.size() == 4) {
                    auto h0 = std::make_pair(card_from_string(q.hero.substr(0, 2)),
                                             card_from_string(q.hero.substr(2, 2)));
                    auto h1 = std::make_pair(card_from_string(v1.substr(0, 2)),
                                             card_from_string(v1.substr(2, 2)));
                    auto h2 = std::make_pair(card_from_string(v2.substr(0, 2)),
                                             card_from_string(v2.substr(2, 2)));
                    double e0 = preflop::global_preflop_3way_table().equity_cards_3way(h0, h1, h2, 0);
                    double e1 = preflop::global_preflop_3way_table().equity_cards_3way(h0, h1, h2, 1);
                    double e2 = preflop::global_preflop_3way_table().equity_cards_3way(h0, h1, h2, 2);
                    out.obj["status"] = JsonValue::jstr("ok");
                    out.obj["equity_p0"] = JsonValue::jnum(e0);
                    out.obj["equity_p1"] = JsonValue::jnum(e1);
                    out.obj["equity_p2"] = JsonValue::jnum(e2);
                    out.obj["equity_sum"] = JsonValue::jnum(e0 + e1 + e2);
                } else {
                    out.obj["error"] = JsonValue::jstr(
                        "hero/villain1/villain2 must be 4-char card strings");
                }
            } else if (q.query == "preflop_anchor") {
                // [Module 6, V8] {"query":"preflop_anchor",
                //  "stack_bb":23.5,"position":5,"hero":"AhKh"}
                out.type = JsonType::Object;
                if (!anchors_ok) {
                    out.obj["error"] = JsonValue::jstr("preflop_anchors_mtt.bin not loaded");
                } else if (q.hero.size() == 4) {
                    int r1 = card_rank(card_from_string(q.hero.substr(0, 2)));
                    int r2 = card_rank(card_from_string(q.hero.substr(2, 2)));
                    bool suited = (card_suit(card_from_string(q.hero.substr(0, 2))) ==
                                  card_suit(card_from_string(q.hero.substr(2, 2))));
                    uint16_t cls = preflop::class_index(
                        (uint8_t)std::max(r1, r2), (uint8_t)std::min(r1, r2), suited);
                    double stack_bb = json_get_double(req, "stack_bb", 25.0);
                    int position = (int)json_get_int(req, "position", 7);
                    double probs[4];
                    anchor_mgr.action_probs(stack_bb, position, cls, probs);
                    out.obj["status"] = JsonValue::jstr("ok");
                    out.obj["position"] = JsonValue::jstr(
                        (position >= 0 && position < (int)postflop::anchor::NUM_POSITIONS)
                            ? postflop::anchor::POSITION_NAMES[position] : "?");
                    out.obj["stack_bb"] = JsonValue::jnum(stack_bb);
                    out.obj["p_fold"] = JsonValue::jnum(probs[0]);
                    out.obj["p_call"] = JsonValue::jnum(probs[1]);
                    out.obj["p_raise"] = JsonValue::jnum(probs[2]);
                    out.obj["p_allin"] = JsonValue::jnum(probs[3]);
                } else {
                    out.obj["error"] = JsonValue::jstr("hero must be a 4-char card string");
                }
            } else if (q.query == "icm") {
                // [Module 4, V8] {"query":"icm","stacks":[...],
                //  "payouts":[...], "hero_idx":0, "villain_idx":1}
                out.type = JsonType::Object;
                std::vector<double> icm_stacks, icm_payouts;
                for (const JsonValue& v : json_get_array(req, "stacks")) {
                    if (v.type == JsonType::Number) icm_stacks.push_back(v.num);
                }
                for (const JsonValue& v : json_get_array(req, "payouts")) {
                    if (v.type == JsonType::Number) icm_payouts.push_back(v.num);
                }
                if ((int)icm_stacks.size() >= 2 && !icm_payouts.empty() &&
                    (int)icm_stacks.size() <= 8) {
                    auto eqs = postflop::icm::compute_icm_payouts(icm_stacks, icm_payouts);
                    out.obj["status"] = JsonValue::jstr("ok");
                    JsonValue eq_arr; eq_arr.type = JsonType::Array;
                    for (double e : eqs) eq_arr.arr.push_back(JsonValue::jnum(e));
                    out.obj["icm_equities"] = eq_arr;
                    int hero_idx = (int)json_get_int(req, "hero_idx", 0);
                    int villain_idx = (int)json_get_int(req, "villain_idx", 1);
                    if (hero_idx >= 0 && hero_idx < (int)icm_stacks.size() &&
                        villain_idx >= 0 && villain_idx < (int)icm_stacks.size() &&
                        villain_idx != hero_idx) {
                        double bf = postflop::icm::compute_bubble_factor(
                            icm_stacks, icm_payouts, hero_idx, villain_idx);
                        out.obj["bubble_factor"] = JsonValue::jnum(bf);
                    }
                    double chip_sum = 0.0;
                    for (double st : icm_stacks) chip_sum += st;
                    out.obj["chip_ev_equities"] = [&]() {
                        JsonValue a; a.type = JsonType::Array;
                        for (double st : icm_stacks) a.arr.push_back(JsonValue::jnum(st / chip_sum));
                        return a;
                    }();
                } else {
                    out.obj["error"] = JsonValue::jstr(
                        "icm requires stacks[2..8] and a non-empty payouts array");
                }
            } else if (q.query == "preflop_decision") {
                // Module 3.1: <= 12 BB push/fold decision.
                std::string villain = json_get_string(req, "villain", "AcKd");
                out.type = JsonType::Object;
                if (!preflop_table_ok) {
                    out.obj["error"] = JsonValue::jstr("preflop_table.bin not loaded");
                } else if (q.hero.size() == 4) {
                    auto h = std::make_pair(card_from_string(q.hero.substr(0, 2)),
                                            card_from_string(q.hero.substr(2, 2)));
                    auto v = std::make_pair(card_from_string(villain.substr(0, 2)),
                                            card_from_string(villain.substr(2, 2)));
                    auto d = preflop::push_fold_call_decision(h, v, q.pot, q.stack);
                    out.obj["status"] = JsonValue::jstr("ok");
                    out.obj["should_call"] = JsonValue::jnum(d.should_call ? 1.0 : 0.0);
                    out.obj["equity"] = JsonValue::jnum(d.equity);
                    out.obj["required"] = JsonValue::jnum(d.required);
                    out.obj["ev_call"] = JsonValue::jnum(d.ev_call);
                } else {
                    out.obj["error"] = JsonValue::jstr("hero must be a 4-char card string");
                }
            } else {
                // Default: postflop solve with two-tier routing.
                // Iteration policy: HU 300 (Tier 1), multiway 100 (Tier 2);
                // explicit override honored.
                int iters = q.iterations;
                if (iters <= 0) {
                    iters = (q.num_players == 2) ? 300 : 100;
                }
                out = solve_postflop(q, iters);
            }
        } catch (const std::exception& e) {
            out.type = JsonType::Object;
            out.obj["error"] = JsonValue::jstr(std::string("solver exception: ") + e.what());
        }

        std::cout << json_serialize(out) << std::endl;
        std::cout.flush();
    }
    return 0;
}
