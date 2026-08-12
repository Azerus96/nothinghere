// ════════════════════════════════════════════════════════════════════════
// solver.h — DCFR (Discounted CFR) solver
// ════════════════════════════════════════════════════════════════════════
#ifndef SOLVER_H
#define SOLVER_H

#include <cstdint>
#include <cmath>
#include "cuda_compat.h"
#include "game.h"

namespace postflop {

// ── DCFR discount parameters ────────────────────────────────────────────
struct DiscountParams {
    float alpha_t;   // positive regret weight
    float beta_t;    // negative regret weight (0.5 always)
    float gamma_t;   // cumulative strategy weight

    __device__ __host__ __forceinline__
    static DiscountParams from_iteration(uint32_t iter) {
        uint32_t pow4 = 0;
        if (iter > 0) {
            pow4 = 1;
            while (pow4 * 4 <= iter) pow4 *= 4;
        }
        double t_alpha = (double)((int)iter - 1 > 0 ? (int)iter - 1 : 0);
        double t_gamma = (double)(iter - pow4);

        double pow_alpha = t_alpha * std::sqrt(t_alpha);   // t^(3/2)
        
        // ИЗМЕНЕНИЕ ДЛЯ МУЛЬТИВЕЯ: Квадрат вместо куба для плавности!
        double pow_gamma = std::pow(t_gamma / (t_gamma + 1.0), 2.0);

        DiscountParams p;
        p.alpha_t = (float)(pow_alpha / (pow_alpha + 1.0));
        p.beta_t  = 0.5f;
        p.gamma_t = (float)pow_gamma;
        return p;
    }
};

// ── Solver entry points ─────────────────────────────────────────────────
float solve(PostFlopGame& game, uint32_t max_iter, float target_exploit, bool verbose);
void solve_step(PostFlopGame& game, uint32_t current_iter);
void finalize(PostFlopGame& game);
float compute_exploitability(const PostFlopGame& game);

// ── Slice operations ────────────────────────────────────────────────────
void fma_slices_uninit(float* dst, const float* src, int num_rows, int len);
void max_slices_uninit(float* dst, const float* src, int num_rows, int len);
void sub_slice(float* dst, const float* src1, const float* src2, int len);
void mul_slice(float* dst, const float* src, int len);
void mul_slice_scalar_uninit(float* dst, const float* src, float scalar, int len);
void sum_slices_uninit(float* dst, const float* src, int num_rows, int len);
void regret_matching(float* strategy, const float* regret, int num_actions, int num_hands);
void normalize_strategy(float* strategy, int num_actions, int num_hands);

// ── Terminal evaluation (Heads-Up) ──────────────────────────────────────
void evaluate_terminal(
    float* result,
    const PostFlopGame& game,
    const PostFlopNode& node,
    int player,
    const float* cfreach);

// ── Transposition table ─────────────────────────────────────────────────
struct TranspositionTable {
    struct Entry {
        uint64_t key;
        std::vector<float> unit_cfv;
        int num_hands;
        bool valid;
        Entry() : key(0), num_hands(0), valid(false) {}
    };
    std::vector<Entry> entries;
    size_t capacity;
    size_t mask;

    TranspositionTable(size_t cap = 65536) : capacity(cap) {
        size_t p = 1;
        while (p < cap) p <<= 1;
        capacity = p;
        mask = capacity - 1;
        entries.resize(capacity);
    }

    void insert(uint64_t key, const std::vector<float>& unit_cfv, int num_hands) {
        size_t idx = key & mask;
        entries[idx].key = key;
        entries[idx].unit_cfv = unit_cfv;
        entries[idx].num_hands = num_hands;
        entries[idx].valid = true;
    }

    const Entry* lookup(uint64_t key) const {
        size_t idx = key & mask;
        const Entry& e = entries[idx];
        if (e.valid && e.key == key) return &e;
        return nullptr;
    }

    void clear() {
        for (auto& e : entries) e.valid = false;
    }
};

} // namespace postflop

#endif // SOLVER_H
