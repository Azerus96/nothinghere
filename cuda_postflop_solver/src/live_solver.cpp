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
//                Tier 2 (3-6 players): max_depth = 1, rollout showdown
//   Module 3.1   <= 12 BB preflop queries served from preflop_table.bin
//   Module 3.2   optional Bayesian range filtering (action probabilities)
//   Module 3.3   pseudo-harmonic custom bet injection (custom_bets)
//   Defect 1.10  CDF mixed-strategy sampling with RNG roll reporting
//
// Protocol (one JSON object per line):
//   {"hero": "AhKh", "board": "AsKd2c", "pot": 100, "stack": 1900,
//    "num_players": 2, "locked_mask": 0, "profile_id": 0, "device_id": 0,
//    "iterations": 300, "custom_bets": [137], "ranges": ["...", "..."],
//    "bayes_probs": [[..], [..], ...],
//    "query": "postflop" | "preflop_equity" | "preflop_decision"}
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
#include "json_mini.h"

using namespace postflop;

// ── Default opponent ranges (unchanged from the legacy build) ───────────
static const char* default_opp_ranges[5] = {
    "22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s, 64s, ATo+, KJo+, QJo",
    "55+, A8s+, KJs+, QJs, AJo+, KTo+, QTo+",
    "88+, ATs+, KQs, AQo+, AJs",
    "TT+, AQs+, AKo, KQs",
    "JJ+, AKs, AKo"
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

    int num_players = q.num_players;
    if (num_players < 2) num_players = 2;
    if (num_players > 6) num_players = 6;

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

    // Defect 1.5: semantic node locking.
    if (q.locked_mask != 0 && q.profile_id > 0) {
        for (int p = 1; p < num_players; ++p) {
            if (q.locked_mask & (1 << p)) {
                apply_node_locking_profile(game, p, static_cast<OpponentProfile>(q.profile_id));
            }
        }
    }
    game.set_locked_players_mask(q.locked_mask);

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
    gpu_mem->locked_players_mask = q.locked_mask;
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
    out.obj["tier"] = JsonValue::jstr(num_players == 2 ? "HU_FULL_TREE" : "MW_ROLLOUT");
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
