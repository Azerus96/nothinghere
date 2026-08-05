// ════════════════════════════════════════════════════════════════════════
// solver.h — DCFR (Discounted CFR) solver
// ════════════════════════════════════════════════════════════════════════
// Algorithm: Discounted CFR (Brown & Sandholm 2018, arXiv:1809.04040)
// with the postflop-solver crate's specific tweaks:
//
//   α_t = t^(3/2) / (t^(3/2) + 1),  t = max(iter - 1, 0)
//   β_t = 0.5                         (CONSTANT — original paper uses t/(t+1))
//   γ_t = (t' / (t' + 1))^3,         t' = iter - nearest_lower_power_of_4(iter)
//        original paper uses exponent 2; we use 3 per postflop-solver.
//
//   nearest_lower_power_of_4: 0, 1, 4, 16, 64, 256, 1024, ...
//   At powers of 4, t' = 0 ⇒ γ_t = 0 ⇒ cumulative strategy fully reset.
//
// Regret update:
//   strategy[a,h]      = max(regret[a,h], 0) / Σ_a' max(regret[a',h], 0)
//   cum_strategy[a,h]  = cum_strategy[a,h] * γ_t + strategy[a,h]
//   cum_regret[a,h]    = cum_regret[a,h] * (α_t if cum_regret[a,h] ≥ 0 else β_t)
//                      + (cfv[a,h] - cfv_result[h])
//
// Alternating updates: each iteration updates player 0 fully, then player 1.
//
// Parallelism: on CPU, rayon-style parallel iteration over children of
// pre-river nodes. On GPU, each child becomes a CUDA stream/block; deeper
// subtrees run sequentially within a warp.
// ════════════════════════════════════════════════════════════════════════
#ifndef SOLVER_H
#define SOLVER_H

#include <cstdint>
#include "cuda_compat.h"
#include "game.h"

namespace postflop {

// ── DCFR discount parameters ────────────────────────────────────────────
struct DiscountParams {
    float alpha_t;   // positive regret weight
    float beta_t;    // negative regret weight (0.5 always)
    float gamma_t;   // cumulative strategy weight

    // Compute for iteration `iter`.
    __device__ __host__ __forceinline__
    static DiscountParams from_iteration(uint32_t iter) {
        // nearest_lower_power_of_4: 0, 1, 4, 16, 64, 256, ...
        // Rust: 1 << ((leading_zeros(x) ^ 31) & !1)
        uint32_t pow4 = 0;
        if (iter > 0) {
            // Find largest power of 4 ≤ iter
            pow4 = 1;
            while (pow4 * 4 <= iter) pow4 *= 4;
        }
        double t_alpha = (double)((int)iter - 1 > 0 ? (int)iter - 1 : 0);
        double t_gamma = (double)(iter - pow4);

        double pow_alpha = t_alpha * std::sqrt(t_alpha);   // t^(3/2)
        double pow_gamma = std::pow(t_gamma / (t_gamma + 1.0), 3);

        DiscountParams p;
        p.alpha_t = (float)(pow_alpha / (pow_alpha + 1.0));
        p.beta_t  = 0.5f;
        p.gamma_t = (float)pow_gamma;
        return p;
    }
};

// ── Solver entry points ─────────────────────────────────────────────────

// Run full DCFR solve. Returns final exploitability (in pot fractions).
// Stops early if exploitability ≤ target_exploit.
float solve(PostFlopGame& game, uint32_t max_iter, float target_exploit, bool verbose);

// Run one DCFR step (one full traversal for both players).
// V7: Takes non-const PostFlopGame& because it may initialize per-game GPU memory.
void solve_step(PostFlopGame& game, uint32_t current_iter);

// Finalize: compute cfvalues with final strategy, set solved=true.
void finalize(PostFlopGame& game);

// Compute current exploitability (in pot fractions) via best-response.
float compute_exploitability(const PostFlopGame& game);

// ── Slice operations (highly optimized, GPU-friendly) ──────────────────

// dst[i] = src1[i] * src2[i] + dst_after_src1[i] * src2[i] + ... (sum over rows)
// Row-major: src has shape [num_rows, len], dst has shape [len].
void fma_slices_uninit(float* dst, const float* src, int num_rows, int len);

// element-wise max across rows
void max_slices_uninit(float* dst, const float* src, int num_rows, int len);

// dst = src1 - src2
void sub_slice(float* dst, const float* src1, const float* src2, int len);

// dst *= src (element-wise)
void mul_slice(float* dst, const float* src, int len);

// dst = src * scalar (uninit dst)
void mul_slice_scalar_uninit(float* dst, const float* src, float scalar, int len);

// dst = Σ rows of src (sum across rows)
void sum_slices_uninit(float* dst, const float* src, int num_rows, int len);

// Regret matching: positive part / sum_positive (or 1/num_actions if denom=0)
// Output: strategy[num_actions * num_hands], row-major.
void regret_matching(float* strategy, const float* regret, int num_actions, int num_hands);

// Normalize a strategy (sums to 1 across actions for each hand)
void normalize_strategy(float* strategy, int num_actions, int num_hands);

// ── Terminal evaluation ────────────────────────────────────────────────
// Computes cfv at terminal nodes (fold or showdown).
// result: length = num_private_hands(player)
// cfreach: opponent's reach probabilities, length = num_private_hands(prev_player)
// node: terminal node (player flag has FOLD or terminal bit set)
//
// Uses Zobrist-based transposition table to cache fold eval results
// (same (board, folded_player) → same payoff vector up to cfreach scaling).
void evaluate_terminal(
    float* result,
    const PostFlopGame& game,
    const PostFlopNode& node,
    int player,
    const float* cfreach);

// ── Transposition table for terminal eval caching ─────────────────────
// Key: Zobrist hash of (board, folded_player) for fold nodes.
//      Zobrist hash of (board) for showdown nodes.
// Value: precomputed "unit cfv" — cfv when cfreach is uniform (1/N for each opp hand).
//        Actual cfv = unit_cfv × Σ cfreach[i] (since terminal eval is linear in cfreach).
//
// For fold: unit_cfv[i] = payoff × (N + same_hand - 2) / N
//   (each player hand has N opp hands, minus the 2 that conflict with cards)
// For showdown: more complex (depends on opp strength distribution).
//   For now we cache only fold evals (showdown is harder to factor out).
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
        // Round up to power of 2
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
