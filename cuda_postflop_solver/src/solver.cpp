// ════════════════════════════════════════════════════════════════════════
// solver.cpp — DCFR solver
// ════════════════════════════════════════════════════════════════════════
#include "solver.h"
#include "game.h"
#include "hand_evaluator.h"
#include "gpu_solver.h"
#include <cmath>
#include <algorithm>
#include <cstring>
#include <cstdio>
#include <chrono>
#include <vector>
#include <memory>

namespace postflop {

// ИСПРАВЛЕНИЕ БАГА: std::unique_ptr предотвращает утечки при исключениях
struct ScratchChunk {
    std::unique_ptr<float[]> base;
    size_t capacity;
    size_t offset;
    ScratchChunk* next;

    ScratchChunk(size_t cap) : capacity(cap), offset(0), next(nullptr) {
        base = std::make_unique<float[]>(cap);
    }
    ~ScratchChunk() {
        if (next) delete next;
    }
};

struct ScratchArena {
    static constexpr size_t CHUNK_SIZE = 4ULL * 1024 * 1024;  
    ScratchChunk* head;
    ScratchChunk* current;
    size_t total_capacity;
    size_t total_used;

    struct SavePoint {
        ScratchChunk* chunk;
        size_t offset;
    };

    ScratchArena() : head(nullptr), current(nullptr), total_capacity(0), total_used(0) {
        head = new ScratchChunk(CHUNK_SIZE);
        current = head;
        total_capacity = CHUNK_SIZE;
    }

    ~ScratchArena() { delete head; }

    float* alloc(size_t n) {
        n = (n + 15) & ~((size_t)15);
        if (n > CHUNK_SIZE) {
            ScratchChunk* big = new ScratchChunk(n);
            big->next = current->next;
            current->next = big;
            big->offset = n;
            total_capacity += n;
            total_used += n;
            return big->base.get();
        }
        if (current->offset + n > current->capacity) {
            if (!current->next) {
                current->next = new ScratchChunk(CHUNK_SIZE);
                total_capacity += CHUNK_SIZE;
            }
            current = current->next;
        }
        float* p = current->base.get() + current->offset;
        current->offset += n;
        total_used += n;
        return p;
    }

    SavePoint save() const { return {current, current->offset}; }

    void restore(SavePoint sp) {
        ScratchChunk* c = sp.chunk;
        c->offset = sp.offset;
        c = c->next;
        while (c) { c->offset = 0; c = c->next; }
        current = sp.chunk;
    }
};

static thread_local ScratchArena* tls_scratch = nullptr;
static ScratchArena* get_scratch() {
    if (!tls_scratch) tls_scratch = new ScratchArena();
    return tls_scratch;
}

void sub_slice(float* dst, const float* src1, const float* src2, int len) {
    #pragma omp simd
    for (int i = 0; i < len; ++i) dst[i] = src1[i] - src2[i];
}

void mul_slice(float* dst, const float* src, int len) {
    #pragma omp simd
    for (int i = 0; i < len; ++i) dst[i] *= src[i];
}

void mul_slice_scalar_uninit(float* dst, const float* src, float scalar, int len) {
    #pragma omp simd
    for (int i = 0; i < len; ++i) dst[i] = src[i] * scalar;
}

void sum_slices_uninit(float* dst, const float* src, int num_rows, int len) {
    if (num_rows == 0) return;
    std::memcpy(dst, src, len * sizeof(float));
    for (int r = 1; r < num_rows; ++r) {
        const float* row = src + r * len;
        #pragma omp simd
        for (int i = 0; i < len; ++i) dst[i] += row[i];
    }
}

void fma_strategy_cfv(float* dst, const float* strategy, const float* cfv, int num_actions, int num_hands) {
    #pragma omp simd
    for (int h = 0; h < num_hands; ++h) dst[h] = 0.0f;
    for (int a = 0; a < num_actions; ++a) {
        const float* s_row = strategy + a * num_hands;
        const float* c_row = cfv      + a * num_hands;
        #pragma omp simd
        for (int h = 0; h < num_hands; ++h) dst[h] += s_row[h] * c_row[h];
    }
}

void max_slices_uninit(float* dst, const float* src, int num_rows, int len) {
    if (num_rows == 0) return;
    std::memcpy(dst, src, len * sizeof(float));
    for (int r = 1; r < num_rows; ++r) {
        const float* row = src + r * len;
        #pragma omp simd
        for (int i = 0; i < len; ++i) {
            if (row[i] > dst[i]) dst[i] = row[i];
        }
    }
}

void regret_matching(float* strategy, const float* regret, int num_actions, int num_hands) {
    const float uniform = 1.0f / num_actions;
    const int H8 = num_hands & ~7;
    int h = 0;
    for (; h < H8; h += 8) {
        float sp[8] = {0};
        for (int a = 0; a < num_actions; ++a) {
            const float* r = regret + a * num_hands + h;
            #pragma omp simd
            for (int k = 0; k < 8; ++k) if (r[k] > 0.0f) sp[k] += r[k];
        }
        for (int a = 0; a < num_actions; ++a) {
            float* s = strategy + a * num_hands + h;
            const float* r = regret + a * num_hands + h;
            #pragma omp simd
            for (int k = 0; k < 8; ++k) {
                if (sp[k] > 1e-7f) s[k] = (r[k] > 0.0f) ? (r[k] / sp[k]) : 0.0f;
                else s[k] = uniform;
            }
        }
    }
    for (; h < num_hands; ++h) {
        float sum_positive = 0.0f;
        for (int a = 0; a < num_actions; ++a) {
            float r = regret[a * num_hands + h];
            if (r > 0.0f) sum_positive += r;
        }
        if (sum_positive > 1e-7f) {
            for (int a = 0; a < num_actions; ++a) {
                float r = regret[a * num_hands + h];
                strategy[a * num_hands + h] = (r > 0.0f) ? (r / sum_positive) : 0.0f;
            }
        } else {
            for (int a = 0; a < num_actions; ++a) strategy[a * num_hands + h] = uniform;
        }
    }
}

void normalize_strategy(float* strategy, int num_actions, int num_hands) {
    const float uniform = 1.0f / num_actions;
    for (int h = 0; h < num_hands; ++h) {
        float sum = 0.0f;
        for (int a = 0; a < num_actions; ++a) sum += strategy[a * num_hands + h];
        if (sum > 1e-7f) {
            float inv = 1.0f / sum;
            for (int a = 0; a < num_actions; ++a) strategy[a * num_hands + h] *= inv;
        } else {
            for (int a = 0; a < num_actions; ++a) strategy[a * num_hands + h] = uniform;
        }
    }
}

void evaluate_terminal(float* result, const PostFlopGame& game, const PostFlopNode& node, int player, const float* cfreach) {
    const auto& cc = game.card_config();
    const auto& tc = game.tree_config();
    int num_hands = game.num_private_hands(player);
    int opp_player = 1 - player;
    int opp_num_hands = game.num_private_hands(opp_player);
    std::memset(result, 0, num_hands * sizeof(float));

    bool is_fold = (node.player & PLAYER_FOLD_FLAG) == PLAYER_FOLD_FLAG;
    int folded_player = node.player & PLAYER_MASK;

    double pot = (double)(tc.starting_pot + 2 * node.amount);
    double half_pot = 0.5 * pot;
    double rake = std::min(pot * tc.rake_rate, tc.rake_cap);
    double amount_win  = (half_pot - rake) / (double)opp_num_hands;
    double amount_lose = -half_pot / (double)opp_num_hands;
    double amount_tie  = -0.5 * rake / (double)opp_num_hands;

    if (is_fold) {
        double payoff = (player == folded_player) ? amount_lose : amount_win;
        float cfreach_minus[52] = {0};
        double cfreach_sum = 0;
        for (int i = 0; i < opp_num_hands; ++i) {
            float w = cfreach[i];
            if (w != 0.0f) {
                cfreach_sum += w;
                Card c1 = cc.private_cards[opp_player][i].first;
                Card c2 = cc.private_cards[opp_player][i].second;
                cfreach_minus[c1] += w;
                cfreach_minus[c2] += w;
            }
        }
        const auto& same_idx = cc.same_hand_index[player];
        for (int i = 0; i < num_hands; ++i) {
            Card c1 = cc.private_cards[player][i].first;
            Card c2 = cc.private_cards[player][i].second;
            double cfreach_same = 0;
            if (same_idx[i] != 0xFFFF) cfreach_same = cfreach[same_idx[i]];
            double total = cfreach_sum + cfreach_same - cfreach_minus[c1] - cfreach_minus[c2];
            result[i] = (float)(payoff * total);
        }
        return;
    }

    if (node.turn == NOT_DEALT || node.river == NOT_DEALT) return;

    Card b0 = cc.flop[0], b1 = cc.flop[1], b2 = cc.flop[2];
    Card b3 = node.turn, b4 = node.river;

    std::vector<StrengthItem> p_str(num_hands + 2);
    std::vector<StrengthItem> o_str(opp_num_hands + 2);

    p_str[0] = {0, 0};       
    p_str[num_hands + 1] = {0xFFFF, 0xFFFF};  
    for (int i = 0; i < num_hands; ++i) {
        Card h0 = cc.private_cards[player][i].first;
        Card h1 = cc.private_cards[player][i].second;
        Card cards[7] = {h0, h1, b0, b1, b2, b3, b4};
        p_str[i + 1] = { (uint16_t)evaluate(cards, 7), (uint16_t)i };
    }
    std::sort(p_str.begin() + 1, p_str.end() - 1, [](const StrengthItem& a, const StrengthItem& b) { return a.strength < b.strength; });

    o_str[0] = {0, 0};
    o_str[opp_num_hands + 1] = {0xFFFF, 0xFFFF};
    for (int i = 0; i < opp_num_hands; ++i) {
        Card h0 = cc.private_cards[opp_player][i].first;
        Card h1 = cc.private_cards[opp_player][i].second;
        Card cards[7] = {h0, h1, b0, b1, b2, b3, b4};
        o_str[i + 1] = { (uint16_t)evaluate(cards, 7), (uint16_t)i };
    }
    std::sort(o_str.begin() + 1, o_str.end() - 1, [](const StrengthItem& a, const StrengthItem& b) { return a.strength < b.strength; });

    {
        float cfreach_minus[52] = {0};
        double cfreach_sum = 0;
        int opp_ptr = 1;  
        for (int i = 1; i <= num_hands; ++i) {
            const StrengthItem& p = p_str[i];
            while (opp_ptr <= opp_num_hands && o_str[opp_ptr].strength < p.strength) {
                float w = cfreach[o_str[opp_ptr].index];
                if (w != 0.0f) {
                    cfreach_sum += w;
                    Card oc1 = cc.private_cards[opp_player][o_str[opp_ptr].index].first;
                    Card oc2 = cc.private_cards[opp_player][o_str[opp_ptr].index].second;
                    cfreach_minus[oc1] += w;
                    cfreach_minus[oc2] += w;
                }
                ++opp_ptr;
            }
            int pidx = p.index;
            Card c1 = cc.private_cards[player][pidx].first;
            Card c2 = cc.private_cards[player][pidx].second;
            double cfreach_same = 0;
            const auto& same_idx = cc.same_hand_index[player];
            if (same_idx[pidx] != 0xFFFF) cfreach_same = cfreach[same_idx[pidx]];
            double win_cfreach = cfreach_sum + cfreach_same - cfreach_minus[c1] - cfreach_minus[c2];
            result[pidx] += (float)(amount_win * win_cfreach);
        }
    }

    {
        float cfreach_minus[52] = {0};
        double cfreach_sum = 0;
        int opp_ptr = opp_num_hands;  
        for (int i = num_hands; i >= 1; --i) {
            const StrengthItem& p = p_str[i];
            while (opp_ptr >= 1 && o_str[opp_ptr].strength > p.strength) {
                float w = cfreach[o_str[opp_ptr].index];
                if (w != 0.0f) {
                    cfreach_sum += w;
                    Card oc1 = cc.private_cards[opp_player][o_str[opp_ptr].index].first;
                    Card oc2 = cc.private_cards[opp_player][o_str[opp_ptr].index].second;
                    cfreach_minus[oc1] += w;
                    cfreach_minus[oc2] += w;
                }
                --opp_ptr;
            }
            int pidx = p.index;
            Card c1 = cc.private_cards[player][pidx].first;
            Card c2 = cc.private_cards[player][pidx].second;
            double cfreach_same = 0;
            const auto& same_idx = cc.same_hand_index[player];
            if (same_idx[pidx] != 0xFFFF) cfreach_same = cfreach[same_idx[pidx]];
            double lose_cfreach = cfreach_sum + cfreach_same - cfreach_minus[c1] - cfreach_minus[c2];
            result[pidx] += (float)(amount_lose * lose_cfreach);
        }
    }

    if (rake > 0) {
        int opp_ptr = 1;  
        int i = 1;
        while (i <= num_hands) {
            uint16_t cur_strength = p_str[i].strength;
            while (opp_ptr <= opp_num_hands && o_str[opp_ptr].strength < cur_strength) ++opp_ptr;
            int tie_start = opp_ptr;  
            int tie_end = opp_ptr;
            while (tie_end <= opp_num_hands && o_str[tie_end].strength == cur_strength) ++tie_end;
            
            float tie_minus[52] = {0};
            double tie_sum = 0;
            for (int j = tie_start; j < tie_end; ++j) {
                float w = cfreach[o_str[j].index];
                if (w != 0.0f) {
                    tie_sum += w;
                    Card oc1 = cc.private_cards[opp_player][o_str[j].index].first;
                    Card oc2 = cc.private_cards[opp_player][o_str[j].index].second;
                    tie_minus[oc1] += w;
                    tie_minus[oc2] += w;
                }
            }

            const auto& same_idx = cc.same_hand_index[player];
            while (i <= num_hands && p_str[i].strength == cur_strength) {
                int pidx = p_str[i].index;
                Card c1 = cc.private_cards[player][pidx].first;
                Card c2 = cc.private_cards[player][pidx].second;
                double cfreach_same = 0;
                if (same_idx[pidx] != 0xFFFF) cfreach_same = cfreach[same_idx[pidx]];
                double tc = tie_sum + cfreach_same - tie_minus[c1] - tie_minus[c2];
                result[pidx] += (float)(amount_tie * tc);
                ++i;
            }
            opp_ptr = tie_end;
        }
    }
}

static void solve_recursive(
    float* result,
    const PostFlopGame& game,
    int node_idx,
    int player,
    const float* cfreach,
    const DiscountParams& params,
    int depth)
{
    const PostFlopNode& node = game.node_arena()[node_idx];
    int num_hands = game.num_private_hands(player);

    if (node.is_terminal()) {
        evaluate_terminal(result, game, node, player, cfreach);
        return;
    }

    // ── ИСПРАВЛЕНИЕ БАГА: ПОЛНОЦЕННЫЙ РАСЧЕТ CHANCE NODES ─────────────────
    if (node.is_chance()) {
        int num_children = node.num_children;
        if (num_children == 0) {
            std::memset(result, 0, num_hands * sizeof(float));
            return;
        }
        ScratchArena* arena = get_scratch();
        ScratchArena::SavePoint saved = arena->save();
        
        float* cfreach_scaled = arena->alloc(num_hands);
        float scale = 1.0f / (float)game.chance_factor(node);
        #pragma omp simd
        for (int i = 0; i < num_hands; ++i) cfreach_scaled[i] = cfreach[i] * scale;

        double* result_f64 = (double*)arena->alloc(num_hands * 2);
        std::memset(result_f64, 0, num_hands * sizeof(double));

        float* child_cfv = arena->alloc(num_hands);
        for (int a = 0; a < num_children; ++a) {
            int child_idx = node.children_offset + a;
            solve_recursive(child_cfv, game, child_idx, player, cfreach_scaled, params, depth + 1);
            #pragma omp simd
            for (int h = 0; h < num_hands; ++h) result_f64[h] += child_cfv[h];
        }

        #pragma omp simd
        for (int h = 0; h < num_hands; ++h) result[h] = (float)result_f64[h];

        arena->restore(saved);
        return;
    }

    int node_player = node.get_player();
    int num_actions = node.num_actions();
    if (num_actions == 0 || node.num_elements == 0) {
        std::memset(result, 0, num_hands * sizeof(float));
        return;
    }

    ScratchArena* arena = get_scratch();
    ScratchArena::SavePoint saved = arena->save();

    float* cfv_actions = arena->alloc(num_actions * num_hands);
    float* strategy = arena->alloc(num_actions * num_hands);

    if (game.is_compression_enabled()) {
        const int16_t* regrets = (const int16_t*)game.storage2_data() + node.storage2_offset;
        float decode_mult = node.scale2 / 32767.0f;
        float* r_float = arena->alloc(num_actions * num_hands);
        for (int i = 0; i < num_actions * num_hands; ++i) r_float[i] = (float)regrets[i] * decode_mult;
        regret_matching(strategy, r_float, num_actions, num_hands);
    } else {
        const float* regrets = game.storage2_data() + node.storage2_offset;
        regret_matching(strategy, regrets, num_actions, num_hands);
    }

    if (node_player == player) {
        for (int a = 0; a < num_actions; ++a) {
            int child_idx = node.children_offset + a;
            float* child_cfv = cfv_actions + a * num_hands;
            solve_recursive(child_cfv, game, child_idx, player, cfreach, params, depth + 1);
        }
    } else {
        float* cfreach_a = arena->alloc(num_hands);
        for (int a = 0; a < num_actions; ++a) {
            const float* strat_row = strategy + a * num_hands;
            #pragma omp simd
            for (int i = 0; i < num_hands; ++i) cfreach_a[i] = cfreach[i] * strat_row[i];
            int child_idx = node.children_offset + a;
            float* child_cfv = cfv_actions + a * num_hands;
            solve_recursive(child_cfv, game, child_idx, player, cfreach_a, params, depth + 1);
        }
    }

    fma_strategy_cfv(result, strategy, cfv_actions, num_actions, num_hands);

    if (node_player == player) {
        if (game.is_compression_enabled()) {
            int16_t* strategy_sum = (int16_t*)game.storage1_data_mut() + node.storage1_offset;
            int16_t* regrets = (int16_t*)game.storage2_data_mut() + node.storage2_offset;
            
            float decode_mult1 = node.scale1 / 32767.0f;
            float decode_mult2 = node.scale2 / 32767.0f;
            float max_s = 0.0f, max_r = 0.0f;

            float* new_s_buf = arena->alloc(num_actions * num_hands);
            float* new_r_buf = arena->alloc(num_actions * num_hands);

            for (int a = 0; a < num_actions; ++a) {
                for (int h = 0; h < num_hands; ++h) {
                    int idx = a * num_hands + h;
                    float old_s = (float)strategy_sum[idx] * decode_mult1;
                    float new_s = old_s * params.gamma_t + strategy[idx];
                    new_s_buf[idx] = new_s;
                    if (std::abs(new_s) > max_s) max_s = std::abs(new_s);

                    float old_r = (float)regrets[idx] * decode_mult2;
                    float coef = (old_r >= 0.0f) ? params.alpha_t : params.beta_t;
                    float new_r = old_r * coef + (cfv_actions[idx] - result[h]);
                    new_r = (new_r > 0.0f) ? new_r : 0.0f;
                    new_r_buf[idx] = new_r;
                    if (std::abs(new_r) > max_r) max_r = std::abs(new_r);
                }
            }

            float new_scale = std::max(max_s, max_r);
            if (new_scale == 0.0f) new_scale = 1.0f;
            const_cast<PostFlopNode&>(node).scale1 = new_scale;
            const_cast<PostFlopNode&>(node).scale2 = new_scale;
            float encode_mult = 32767.0f / new_scale;

            for (int i = 0; i < num_actions * num_hands; ++i) {
                strategy_sum[i] = (int16_t)std::max(-32768.0f, std::min(32767.0f, std::round(new_s_buf[i] * encode_mult)));
                regrets[i] = (int16_t)std::max(-32768.0f, std::min(32767.0f, std::round(new_r_buf[i] * encode_mult)));
            }
        } else {
            float* strategy_sum = game.storage1_data_mut() + node.storage1_offset;
            float* regrets = game.storage2_data_mut() + node.storage2_offset;
            for (int a = 0; a < num_actions; ++a) {
                for (int h = 0; h < num_hands; ++h) {
                    int idx = a * num_hands + h;
                    strategy_sum[idx] = strategy_sum[idx] * params.gamma_t + strategy[idx];
                    float old_r = regrets[idx];
                    float coef = (old_r >= 0.0f) ? params.alpha_t : params.beta_t;
                    float new_r = old_r * coef + (cfv_actions[idx] - result[h]);
                    regrets[idx] = (new_r > 0.0f) ? new_r : 0.0f;
                }
            }
        }
    }

    arena->restore(saved);
}

void solve_step(PostFlopGame& game, uint32_t current_iter) {
    DiscountParams params = DiscountParams::from_iteration(current_iter);

    if (game.is_gpu_enabled()) {
#ifdef CUDA_BUILD
        if (!game.gpu_mem_initialized()) {
            auto gpu = std::make_unique<GpuMemory>();
            if (!gpu_solver_init(game, *gpu)) {
                std::fprintf(stderr, "GPU init failed — falling back to CPU\n");
                game.set_gpu_enabled(false);
            } else {
                game.set_gpu_mem(std::move(gpu));
            }
        }
        if (game.gpu_mem_initialized()) {
            int ret = gpu_solve_step(*game.gpu_mem(), current_iter);
            if (ret != 0) {
                std::fprintf(stderr, "GPU solve_step failed (iter %u) — falling back to CPU\n", current_iter);
                game.set_gpu_enabled(false);
            } else {
                return;  
            }
        }
#else
        static bool warned = false;
        if (!warned) {
            std::fprintf(stderr, "WARNING: is_gpu_enabled()=true but built CPU-only. Using CPU path.\n");
            warned = true;
        }
        game.set_gpu_enabled(false);
#endif
    }

    int root_idx = 0;
    for (int player = 0; player < 2; ++player) {
        int opp = 1 - player;
        int opp_hands = game.num_private_hands(opp);
        std::vector<float> cfreach(opp_hands);
        const auto& opp_weights = game.initial_weights(opp);
        for (int i = 0; i < opp_hands; ++i) cfreach[i] = opp_weights[i];

        std::vector<float> result(game.num_private_hands(player));
        solve_recursive(result.data(), game, root_idx, player, cfreach.data(), params, 0);
    }
}

float solve(PostFlopGame& game, uint32_t max_iter, float target_exploit, bool verbose) {
    auto t0 = std::chrono::high_resolution_clock::now();
    float last_exploit = 0.0f;
    const char* mode = "CPU";
#ifdef CUDA_BUILD
    mode = game.is_gpu_enabled() ? "GPU" : "CPU";
#endif

    for (uint32_t iter = 0; iter < max_iter; ++iter) {
        solve_step(game, iter);
        if (verbose && (iter % 10 == 0 || iter == max_iter - 1)) {
            last_exploit = compute_exploitability(game);
            auto t1 = std::chrono::high_resolution_clock::now();
            double sec = std::chrono::duration<double>(t1 - t0).count();
            std::printf("  iter %5u  exploit=%.6f  t=%.2fs  [%s]\n", iter, last_exploit, sec, mode);
            if (last_exploit <= target_exploit) break;
        }
    }
    finalize(game);
    if (verbose) last_exploit = compute_exploitability(game);
    return last_exploit;
}

void finalize(PostFlopGame& game) { game.set_solved(); }

static void best_response_recursive(float* result, const PostFlopGame& game, int node_idx, int br_player, const float* cfreach, int depth) {
    const PostFlopNode& node = game.node_arena()[node_idx];
    int num_hands = game.num_private_hands(br_player);

    if (node.is_terminal()) {
        evaluate_terminal(result, game, node, br_player, cfreach);
        return;
    }

    ScratchArena* arena = get_scratch();
    ScratchArena::SavePoint saved = arena->save();

    if (node.is_chance()) {
        int num_children = node.num_children;
        if (num_children == 0) {
            std::memset(result, 0, num_hands * sizeof(float));
            arena->restore(saved);
            return;
        }
        float scale = 1.0f / (float)num_children;
        float* cfreach_scaled = arena->alloc(num_hands);
        #pragma omp simd
        for (int i = 0; i < num_hands; ++i) cfreach_scaled[i] = cfreach[i] * scale;

        double* result_f64 = (double*)arena->alloc(num_hands * 2);
        std::memset(result_f64, 0, num_hands * sizeof(double));

        float* child_cfv = arena->alloc(num_hands);
        for (int a = 0; a < num_children; ++a) {
            int child_idx = node.children_offset + a;
            best_response_recursive(child_cfv, game, child_idx, br_player, cfreach_scaled, depth + 1);
            #pragma omp simd
            for (int h = 0; h < num_hands; ++h) result_f64[h] += child_cfv[h];
        }
        #pragma omp simd
        for (int h = 0; h < num_hands; ++h) result[h] = (float)result_f64[h];
        arena->restore(saved);
        return;
    }

    int node_player = node.get_player();
    int num_actions = node.num_actions();
    if (num_actions == 0) {
        std::memset(result, 0, num_hands * sizeof(float));
        arena->restore(saved);
        return;
    }

    float* strategy = arena->alloc(num_actions * num_hands);
    if (game.is_compression_enabled()) {
        const int16_t* ss = (const int16_t*)game.storage1_data() + node.storage1_offset;
        float decode_mult = node.scale1 / 32767.0f;
        for (int i = 0; i < num_actions * num_hands; ++i) strategy[i] = (float)ss[i] * decode_mult;
    } else {
        const float* ss = game.storage1_data() + node.storage1_offset;
        std::memcpy(strategy, ss, num_actions * num_hands * sizeof(float));
    }
    normalize_strategy(strategy, num_actions, num_hands);

    if (node_player == br_player) {
        float* all_child_cfvs = arena->alloc(num_actions * num_hands);
        for (int a = 0; a < num_actions; ++a) {
            int child_idx = node.children_offset + a;
            best_response_recursive(all_child_cfvs + a * num_hands, game, child_idx, br_player, cfreach, depth + 1);
        }
        #pragma omp simd
        for (int h = 0; h < num_hands; ++h) result[h] = all_child_cfvs[h];
        for (int a = 1; a < num_actions; ++a) {
            const float* row = all_child_cfvs + a * num_hands;
            #pragma omp simd
            for (int h = 0; h < num_hands; ++h) {
                if (row[h] > result[h]) result[h] = row[h];
            }
        }
    } else {
        float* cfreach_a = arena->alloc(num_hands);
        double* sum = (double*)arena->alloc(num_hands * 2);
        float* child_cfv = arena->alloc(num_hands);
        std::memset(sum, 0, num_hands * sizeof(double));

        for (int a = 0; a < num_actions; ++a) {
            const float* s_row = strategy + a * num_hands;
            #pragma omp simd
            for (int i = 0; i < num_hands; ++i) cfreach_a[i] = cfreach[i] * s_row[i];
            int child_idx = node.children_offset + a;
            best_response_recursive(child_cfv, game, child_idx, br_player, cfreach_a, depth + 1);
            #pragma omp simd
            for (int h = 0; h < num_hands; ++h) sum[h] += child_cfv[h];
        }
        #pragma omp simd
        for (int h = 0; h < num_hands; ++h) result[h] = (float)sum[h];
    }
    arena->restore(saved);
}

float compute_exploitability(const PostFlopGame& game) {
    double total = 0;
    for (int br_player = 0; br_player < 2; ++br_player) {
        int opp = 1 - br_player;
        int opp_hands = game.num_private_hands(opp);
        std::vector<float> cfreach = game.initial_weights(opp);
        int br_hands = game.num_private_hands(br_player);
        std::vector<float> br_cfv(br_hands);
        best_response_recursive(br_cfv.data(), game, 0, br_player, cfreach.data(), 0);

        const auto& br_weights = game.initial_weights(br_player);
        double br_sum = 0, reach_sum = 0;
        for (int h = 0; h < br_hands; ++h) {
            br_sum += br_cfv[h] * br_weights[h];
            reach_sum += br_weights[h];
        }
        if (reach_sum > 0) total += br_sum / reach_sum;
    }
    double pot = (double)game.tree_config().starting_pot;
    if (pot <= 0) pot = 1.0;
    return (float)(total / (2.0 * pot));
}

} // namespace postflop
