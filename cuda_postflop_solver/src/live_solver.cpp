// ════════════════════════════════════════════════════════════════════════
// live_solver.cpp — Persistent daemon-mode live solver (Defect 1.6 / V8)
// ════════════════════════════════════════════════════════════════════════
// Long-running service: reads one JSON query per line from stdin, writes one
// JSON response per line to stdout (flushed). "QUIT" terminates.
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

static const char* default_opp_ranges[5] = {
    "22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s, 64s, ATo+, KJo+, QJo",
    "55+, A8s+, KJs+, QJs, AJo+, KTo+, QTo+",
    "88+, ATs+, KQs, AQo+, AJs",
    "TT+, AQs+, AKo, KQs",
    "JJ+, AKs, AKo"
};

// ── [V8 Full] Двухрежимный PreflopAnchorManager (V1 169c и V2 1326c) ────
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

        char magic[4];
        if (std::fread(magic, 1, 4, f) != 4) { std::fclose(f); return false; }
        std::fclose(f);

        // Проверка версии заголовка
        if (std::memcmp(magic, "MTTV", 4) == 0) {
            return load_v2(path);
        } else if (std::memcmp(magic, "MTTA", 4) == 0) {
            return load_v1(path);
        }
        return false;
    }

    // Извлечение вероятностей для V2 (1326 комбо, контексты префлопа)
    void get_strategy_v2(double stack_bb, int pos, int ctx, int combo_idx, float out_probs[4]) const {
        out_probs[0] = 1.0f; out_probs[1] = 0.0f; out_probs[2] = 0.0f; out_probs[3] = 0.0f;
        if (!loaded_ || version_ != 2 || combo_idx < 0 || combo_idx >= 1326 || pos < 0 || pos >= 8) {
            return;
        }
        if (ctx < 0 || ctx >= (int)anchor::NUM_CONTEXTS) ctx = 0;

        int lo = 0, hi = 0;
        const auto& grid = anchor::STACK_GRID;
        for (size_t i = 0; i < grid.size(); ++i) {
            if (grid[i] <= stack_bb) lo = (int)i;
        }
        hi = (lo + 1 < (int)grid.size()) ? lo + 1 : lo;

        double w = (grid[hi] > grid[lo]) ? (stack_bb - grid[lo]) / (double)(grid[hi] - grid[lo]) : 0.0;
        if (w < 0.0) w = 0.0; if (w > 1.0) w = 1.0;

        size_t idx_lo = anchor::tensor_index_v2(lo, pos, ctx, combo_idx, 0);
        size_t idx_hi = anchor::tensor_index_v2(hi, pos, ctx, combo_idx, 0);

        float sum = 0.0f;
        for (int a = 0; a < 4; ++a) {
            float p = (float)((1.0 - w) * v2_strat_[idx_lo + a] + w * v2_strat_[idx_hi + a]);
            out_probs[a] = p;
            sum += p;
        }
        if (sum > 1e-6f) {
            for (int a = 0; a < 4; ++a) out_probs[a] /= sum;
        } else {
            out_probs[0] = 1.0f;
        }
    }

    // Извлечение для обратной совместимости с V1 (169 классов)
    void action_probs_v1(double stack_bb, int position, uint16_t hero_class, double out_probs[4]) const {
        out_probs[0] = 1.0; out_probs[1] = 0.0; out_probs[2] = 0.0; out_probs[3] = 0.0;
        if (!loaded_ || version_ != 1 || position < 0 || position >= 8 || hero_class >= 169) return;

        int lo = 0, hi = 0;
        const auto& grid = anchor::STACK_GRID;
        for (size_t i = 0; i < grid.size(); ++i) {
            if (grid[i] <= stack_bb) lo = (int)i;
        }
        hi = (lo + 1 < (int)grid.size()) ? lo + 1 : lo;

        double w = (grid[hi] > grid[lo]) ? (stack_bb - grid[lo]) / (double)(grid[hi] - grid[lo]) : 0.0;
        if (w < 0.0) w = 0.0; if (w > 1.0) w = 1.0;

        auto cell = [&](int stk) -> const uint8_t* {
            size_t idx = (((stk * 8) + position) * 169 + hero_class) * 4;
            return v1_mapped_ + idx;
        };

        const uint8_t* p_lo = cell(lo);
        const uint8_t* p_hi = cell(hi);
        for (int a = 0; a < 4; ++a) {
            double v = (1.0 - w) * (double)p_lo[a] + w * (double)p_hi[a];
            out_probs[a] = v / 255.0;
        }
    }

    bool is_loaded() const { return loaded_; }
    int version() const { return version_; }

private:
    bool load_v2(const std::string& path) {
        FILE* f = std::fopen(path.c_str(), "rb");
        if (!f) return false;
        anchor::AnchorFileHeaderV2 hdr;
        if (std::fread(&hdr, sizeof(hdr), 1, f) != 1) { std::fclose(f); return false; }
        std::fclose(f);

        if (hdr.version != 2 || hdr.num_combos != 1326) return false;
        size_t total_floats = (size_t)hdr.num_stacks * 8 * hdr.num_contexts * 1326 * 4;
        size_t tensor_bytes = total_floats * sizeof(float) * (hdr.has_regrets ? 2 : 1);

#if ANCHOR_MMAP_AVAILABLE
        fd_ = ::open(path.c_str(), O_RDONLY);
        if (fd_ >= 0) {
            struct stat st;
            if (::fstat(fd_, &st) == 0 && (size_t)st.st_size >= hdr.tensor_offset + tensor_bytes) {
                void* m = ::mmap(nullptr, (size_t)st.st_size, PROT_READ, MAP_PRIVATE, fd_, 0);
                if (m != MAP_FAILED) {
                    map_ = m;
                    map_bytes_ = (size_t)st.st_size;
                    v2_strat_ = (const float*)((const uint8_t*)m + hdr.tensor_offset);
                    if (hdr.has_regrets) v2_regret_ = v2_strat_ + total_floats;
                    loaded_ = true;
                    version_ = 2;
                    return true;
                }
            }
        }
#endif
        return false;
    }

    bool load_v1(const std::string& path) {
        FILE* f = std::fopen(path.c_str(), "rb");
        if (!f) return false;
        anchor::AnchorFileHeader hdr;
        if (std::fread(&hdr, sizeof(hdr), 1, f) != 1) { std::fclose(f); return false; }
        std::fclose(f);

        size_t tensor_bytes = (size_t)hdr.num_stacks * 8 * 169 * 4;
#if ANCHOR_MMAP_AVAILABLE
        fd_ = ::open(path.c_str(), O_RDONLY);
        if (fd_ >= 0) {
            struct stat st;
            if (::fstat(fd_, &st) == 0 && (size_t)st.st_size >= hdr.tensor_offset + tensor_bytes) {
                void* m = ::mmap(nullptr, (size_t)st.st_size, PROT_READ, MAP_PRIVATE, fd_, 0);
                if (m != MAP_FAILED) {
                    map_ = m;
                    map_bytes_ = (size_t)st.st_size;
                    v1_mapped_ = (const uint8_t*)m + hdr.tensor_offset;
                    loaded_ = true;
                    version_ = 1;
                    return true;
                }
            }
        }
#endif
        return false;
    }

    void release() {
#if ANCHOR_MMAP_AVAILABLE
        if (map_) { ::munmap(map_, map_bytes_); map_ = nullptr; }
        if (fd_ >= 0) { ::close(fd_); fd_ = -1; }
#endif
        v1_mapped_ = nullptr;
        v2_strat_ = nullptr;
        v2_regret_ = nullptr;
        loaded_ = false;
        version_ = 0;
    }

    bool loaded_ = false;
    int version_ = 0;
    const uint8_t* v1_mapped_ = nullptr;
    const float* v2_strat_ = nullptr;
    const float* v2_regret_ = nullptr;
#if ANCHOR_MMAP_AVAILABLE
    void* map_ = nullptr;
    size_t map_bytes_ = 0;
    int fd_ = -1;
#endif
};

// ── Query Context ───────────────────────────────────────────────────────
struct QueryContext {
    std::string hero;
    std::string board;
    int pot = 0;
    int stack = 0;
    int num_players = 4;
    uint8_t locked_mask = 0;
    int profile_id = 0;
    int device_id = 0;
    int iterations = -1;
    std::vector<int32_t> custom_bets;
    std::vector<std::string> ranges;
    std::vector<std::vector<float>> bayes_probs;
    std::string query = "postflop";
    float bb_size = 100.0f;
    float bubble_factor = 1.0f;
    bool has_dynamic_lock = false;
    DynamicActionLock dynamic_lock;
};

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
    if (num_players > MAX_PLAYERS) num_players = MAX_PLAYERS;

    CardConfig cc;
    cc.num_players = num_players;
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

    cc.flop[0] = card_from_string(q.board.substr(0, 2));
    cc.flop[1] = card_from_string(q.board.substr(2, 2));
    cc.flop[2] = card_from_string(q.board.substr(4, 2));
    cc.turn = (q.board.length() >= 8) ? card_from_string(q.board.substr(6, 2)) : NOT_DEALT;
    cc.river = (q.board.length() >= 10) ? card_from_string(q.board.substr(8, 2)) : NOT_DEALT;

    TreeConfig tc;
    tc.num_players = num_players;
    tc.initial_state = (q.board.length() == 6) ? BoardState::Flop :
                       (q.board.length() == 8) ? BoardState::Turn : BoardState::River;
    tc.starting_pot = q.pot;
    tc.effective_stack = q.stack;
    tc.bubble_factor = q.bubble_factor;

    if (num_players == 2) {
        for (int i = 0; i < 2; ++i) {
            tc.flop_bet_sizes[i]  = { {BetSize::PotRelative(0.25), BetSize::PotRelative(0.50),
                                       BetSize::PotRelative(0.75), BetSize::AllIn()}, {} };
            tc.turn_bet_sizes[i]  = { {BetSize::PotRelative(0.67), BetSize::AllIn()}, {} };
            tc.river_bet_sizes[i] = { {BetSize::PotRelative(0.75), BetSize::AllIn()}, {} };
        }
    } else {
        for (int i = 0; i < num_players; ++i) {
            tc.flop_bet_sizes[i]  = { {BetSize::PotRelative(0.33), BetSize::PotRelative(0.75), BetSize::AllIn()},
                                      {BetSize::PrevRelative(2.5), BetSize::AllIn()} };
            tc.turn_bet_sizes[i]  = tc.flop_bet_sizes[i];
            tc.river_bet_sizes[i] = tc.flop_bet_sizes[i];
        }
    }

    tc.custom_injected_bets = q.custom_bets;
    tc.max_depth = (num_players == 2) ? 3 : 1;

    auto t0 = std::chrono::high_resolution_clock::now();

    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    game.allocate_memory(false);

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

    if (q.locked_mask != 0 && q.profile_id > 0 && !q.has_dynamic_lock) {
        for (int p = 1; p < num_players; ++p) {
            if (q.locked_mask & (1 << p)) {
                apply_node_locking_profile(game, p, static_cast<OpponentProfile>(q.profile_id));
            }
        }
        game.set_locked_players_mask(q.locked_mask);
    }

    if (q.has_dynamic_lock) {
        apply_dynamic_node_lock(game, q.dynamic_lock);
    }

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
    gpu_mem->bubble_factor = q.bubble_factor;
    game.set_gpu_mem(std::move(gpu_mem));

    for (uint32_t iter = 1; iter <= (uint32_t)effective_iters; ++iter) {
        gpu_solve_step_dispatch(game, iter);
    }
    gpu_solver_copy_back(game, *game.gpu_mem());

    auto t1 = std::chrono::high_resolution_clock::now();
    double solve_ms = std::chrono::duration<double, std::milli>(t1 - t0).count();

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

    // Инициализация префлоп таблиц
    bool preflop_table_ok = preflop::global_preflop_table().load(preflop::default_table_path());
    bool preflop_3way_ok = preflop::global_preflop_3way_table().load(preflop::default_3way_table_path());

    PreflopAnchorManager anchor_mgr;
    // Попытка загрузить полную V2 1326-комбо базу, затем V1 fallback
    const char* env_anchors = std::getenv("POSTFLOP_ANCHORS_PATH");
    bool anchors_ok = false;
    if (env_anchors && *env_anchors) {
        anchors_ok = anchor_mgr.load(env_anchors);
    }
    if (!anchors_ok) anchors_ok = anchor_mgr.load("preflop_mtt_full_1326.bin");
    if (!anchors_ok) anchors_ok = anchor_mgr.load("preflop_anchors_mtt.bin");

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
                    q.bubble_factor = (float)postflop::icm::compute_bubble_factor(
                        icm_stacks, icm_payouts, hero_idx, villain_idx);
                } else {
                    q.bubble_factor = 1.0f;
                }
            } else {
                q.bubble_factor = 1.0f;
            }
        }

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
                q.has_dynamic_lock = (q.dynamic_lock.player_idx >= 0 && q.dynamic_lock.any_specified());
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
                    out.obj["error"] = JsonValue::jstr("hero/villain1/villain2 must be 4-char card strings");
                }
            } else if (q.query == "preflop_anchor") {
                out.type = JsonType::Object;
                if (!anchors_ok) {
                    out.obj["error"] = JsonValue::jstr("MTT anchors table not loaded");
                } else if (q.hero.size() == 4) {
                    Card c1 = card_from_string(q.hero.substr(0, 2));
                    Card c2 = card_from_string(q.hero.substr(2, 2));
                    double stack_bb = json_get_double(req, "stack_bb", 25.0);
                    int position = (int)json_get_int(req, "position", 7);

                    std::string ctx_str = json_get_string(req, "context", "unopened");
                    int ctx = 0;
                    if (ctx_str == "facing_open") ctx = 1;
                    else if (ctx_str == "facing_3bet") ctx = 2;
                    else if (ctx_str == "facing_jam") ctx = 3;
                    else if (ctx_str == "squeeze") ctx = 4;

                    out.obj["status"] = JsonValue::jstr("ok");
                    out.obj["version"] = JsonValue::jnum((double)anchor_mgr.version());
                    out.obj["position"] = JsonValue::jstr(
                        (position >= 0 && position < 8) ? anchor::POSITION_NAMES[position] : "?");
                    out.obj["stack_bb"] = JsonValue::jnum(stack_bb);

                    if (anchor_mgr.version() == 2) {
                        int combo_idx = card_pair_to_index(c1, c2);
                        float probs[4];
                        anchor_mgr.get_strategy_v2(stack_bb, position, ctx, combo_idx, probs);
                        out.obj["context"] = JsonValue::jstr(ctx_str);
                        out.obj["p_fold"] = JsonValue::jnum(probs[0]);
                        out.obj["p_call"] = JsonValue::jnum(probs[1]);
                        out.obj["p_raise"] = JsonValue::jnum(probs[2]);
                        out.obj["p_allin"] = JsonValue::jnum(probs[3]);
                    } else {
                        int r1 = card_rank(c1), r2 = card_rank(c2);
                        bool suited = (card_suit(c1) == card_suit(c2));
                        uint16_t cls = preflop::class_index((uint8_t)std::max(r1, r2), (uint8_t)std::min(r1, r2), suited);
                        double probs[4];
                        anchor_mgr.action_probs_v1(stack_bb, position, cls, probs);
                        out.obj["p_fold"] = JsonValue::jnum(probs[0]);
                        out.obj["p_call"] = JsonValue::jnum(probs[1]);
                        out.obj["p_raise"] = JsonValue::jnum(probs[2]);
                        out.obj["p_allin"] = JsonValue::jnum(probs[3]);
                    }
                } else {
                    out.obj["error"] = JsonValue::jstr("hero must be a 4-char card string");
                }
            } else if (q.query == "icm") {
                out.type = JsonType::Object;
                std::vector<double> icm_stacks, icm_payouts;
                for (const JsonValue& v : json_get_array(req, "stacks")) {
                    if (v.type == JsonType::Number) icm_stacks.push_back(v.num);
                }
                for (const JsonValue& v : json_get_array(req, "payouts")) {
                    if (v.type == JsonType::Number) icm_payouts.push_back(v.num);
                }
                if ((int)icm_stacks.size() >= 2 && !icm_payouts.empty() && (int)icm_stacks.size() <= 8) {
                    auto eqs = postflop::icm::compute_icm_payouts(icm_stacks, icm_payouts);
                    out.obj["status"] = JsonValue::jstr("ok");
                    JsonValue eq_arr; eq_arr.type = JsonType::Array;
                    for (double e : eqs) eq_arr.arr.push_back(JsonValue::jnum(e));
                    out.obj["icm_equities"] = eq_arr;
                    int hero_idx = (int)json_get_int(req, "hero_idx", 0);
                    int villain_idx = (int)json_get_int(req, "villain_idx", 1);
                    if (hero_idx >= 0 && hero_idx < (int)icm_stacks.size() &&
                        villain_idx >= 0 && villain_idx < (int)icm_stacks.size() && villain_idx != hero_idx) {
                        out.obj["bubble_factor"] = JsonValue::jnum(
                            postflop::icm::compute_bubble_factor(icm_stacks, icm_payouts, hero_idx, villain_idx));
                    }
                } else {
                    out.obj["error"] = JsonValue::jstr("icm requires stacks[2..8] and payouts");
                }
            } else if (q.query == "preflop_decision") {
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
                int iters = q.iterations;
                if (iters <= 0) iters = (q.num_players == 2) ? 300 : 100;
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
