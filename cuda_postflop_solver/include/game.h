// ════════════════════════════════════════════════════════════════════════
// game.h — PostFlopGame: flat node arena + storage arenas (GPU-ready)
// ════════════════════════════════════════════════════════════════════════
// Port of postflop-solver/src/game/base.rs
//
// Memory layout (designed for cudaMemcpy to device):
//
//   node_arena:    contiguous PostFlopNode[] (flat, ~48 bytes each)
//                  Indexed by node_index. Children accessed via
//                  node_index + children_offset.
//
//   storage1:      strategy data (f32 or u16/i16 compressed)
//                  Each node stores offset into this arena.
//   storage2:      regret data
//   storage_ip:    IP cfvalues cached at OOP street-start nodes
//   storage_chance: chance-node cfvalues
//
// On GPU: each arena is a separate cudaMalloc. Pointers in PostFlopNode
// become device pointers. Kernel reads/writes go through these.
// ════════════════════════════════════════════════════════════════════════
#ifndef GAME_H
#define GAME_H

#include <cstdint>
#include <vector>
#include <array>
#include <memory>
#include "cuda_compat.h"
#include "card.h"
#include "range.h"
#include "action_tree.h"
#include "hand_evaluator.h"

// Forward declaration — GpuMemory is defined in gpu_solver.h
namespace postflop { struct GpuMemory; }

namespace postflop {

// ── PostFlopNode — exactly 48 bytes, GPU-friendly ───────────────────────
// Matches Rust's PostFlopNode layout (minus pointers, which become offsets).
struct PostFlopNode {
    uint8_t  player;             // 0/1/2 with flags
    uint8_t  turn;               // Card or NOT_DEALT
    uint8_t  river;              // Card or NOT_DEALT
    uint8_t  is_locked;          // bool
    int32_t  amount;             // current total bet
    uint32_t children_offset;    // offset into node_arena for first child
    uint16_t num_children;
    uint16_t num_elements_ip;    // size of IP cfv storage
    uint32_t num_elements;       // = num_actions * num_private_hands(player)
    float    scale1;             // strategy scale (compression)
    float    scale2;             // regret  scale
    float    scale3;             // IP cfv  scale
    uint32_t storage1_offset;    // offset into strategy arena
    uint32_t storage2_offset;    // offset into regret arena
    uint32_t storage3_offset;    // offset into IP cfv arena (0 if none)
    uint32_t storage_chance_offset; // offset into chance cfv arena

    // ── Accessors ──────────────────────────────────────────────────────
    __device__ __host__ __forceinline__
    bool is_terminal() const { return (player & PLAYER_TERMINAL_FLAG) != 0; }

    __device__ __host__ __forceinline__
    bool is_chance() const { return (player & PLAYER_CHANCE_FLAG) != 0; }

    __device__ __host__ __forceinline__
    int  get_player() const { return player & PLAYER_MASK; }

    __device__ __host__ __forceinline__
    int  num_actions() const { return num_children; }

    __device__ __host__ __forceinline__
    bool has_cfvalues_ip() const { return num_elements_ip != 0; }
};

// ── StrengthItem (for terminal showdown sort) ──────────────────────────
struct StrengthItem {
    uint16_t strength;   // 1..4824 (0 = sentinel "before first")
    uint16_t index;      // index into private_cards[player]
};

// ── Card configuration ──────────────────────────────────────────────────
struct CardConfig {
    Range range_oop;          // 1326 f32
    Range range_ip;           // 1326 f32
    Card  flop[3];            // 3 cards
    Card  turn;               // NOT_DEALT if not yet dealt
    Card  river;              // NOT_DEALT if not yet dealt

    // Derived (computed on host, transferred to GPU)
    std::vector<std::pair<Card, Card>> private_cards[2];   // [OOP, IP] sorted
    std::vector<float>                initial_weights[2];  // [OOP, IP]
    std::vector<uint16_t>             same_hand_index[2];  // for inclusion-exclusion
    std::vector<uint16_t>             valid_indices_flop[2];
    // Per-turn-card valid_indices (52 entries; empty if turn is dealt)
    std::vector<std::array<std::vector<uint16_t>, 2>> valid_indices_turn;
    // Per-(turn,river) valid_indices (1326 entries; empty if river is dealt)
    std::vector<std::array<std::vector<uint16_t>, 2>> valid_indices_river;
    // Per-(turn,river) sorted strength lists (1326 entries)
    std::vector<std::array<std::vector<StrengthItem>, 2>> hand_strength;

    bool has_flop() const  { return flop[0] != NOT_DEALT; }
    bool has_turn() const  { return turn != NOT_DEALT; }
    bool has_river() const { return river != NOT_DEALT; }
};

// ── PostFlopGame ────────────────────────────────────────────────────────
class PostFlopGame {
public:
    PostFlopGame(CardConfig card_config, TreeConfig tree_config,
                 std::vector<std::vector<Action>> added_lines = {},
                 std::vector<std::vector<Action>> removed_lines = {});

    // V6: destructor defined in .cpp (needs complete GpuMemory type)
    ~PostFlopGame();

    // ── Setup ──────────────────────────────────────────────────────────
    // Computes private_cards, initial_weights, valid_indices, hand_strength.
    void prepare();

    // Returns (uncompressed_bytes, compressed_bytes) needed for storage.
    std::pair<uint64_t, uint64_t> memory_usage() const;

    // Allocates storage1/2/3/chance arenas. If enable_compression, uses i16/u16.
    void allocate_memory(bool enable_compression);

    // ── Solver entry points (in solver.cpp) ────────────────────────────
    friend float solve(PostFlopGame& game, uint32_t max_iter, float target_exploit, bool verbose);
    friend void solve_step(const PostFlopGame& game, uint32_t current_iter);
    friend void finalize(PostFlopGame& game);
    friend float compute_exploitability(const PostFlopGame& game);

    // ── Accessors ──────────────────────────────────────────────────────
    int num_private_hands(int player) const {
        return (int)card_config_.private_cards[player].size();
    }
    const std::vector<float>& initial_weights(int player) const {
        return card_config_.initial_weights[player];
    }
    const std::vector<std::pair<Card, Card>>& private_cards(int player) const {
        return card_config_.private_cards[player];
    }
    const TreeConfig& tree_config() const { return tree_config_; }
    const CardConfig& card_config() const { return card_config_; }
    bool is_compression_enabled() const { return is_compressed_; }
    bool is_solved() const { return is_solved_; }
    void set_solved() { is_solved_ = true; }

    // V4: GPU mode flag. When true, solve_step dispatches to gpu_solve_step()
    // (defined in gpu_solver.cu) which transfers the entire arena to device
    // once and runs a persistent-thread kernel for tree traversal.
    bool is_gpu_enabled() const { return gpu_enabled_; }
    void set_gpu_enabled(bool v) { gpu_enabled_ = v; }

    // V6 FIX (BUG#1): GpuMemory is now OWNED by PostFlopGame, not a static local.
    // This prevents cross-game state pollution when solving multiple hands.
    // The pointer is lazy-initialized on first gpu_solve_step call.
    // Note: set_gpu_mem is defined in game.cpp (needs complete GpuMemory type).
    GpuMemory* gpu_mem();
    const GpuMemory* gpu_mem() const;
    void set_gpu_mem(std::unique_ptr<GpuMemory> m);
    bool gpu_mem_initialized() const;

    // Total nodes
    uint64_t num_nodes() const { return node_arena_.size(); }
    const std::vector<PostFlopNode>& node_arena() const { return node_arena_; }

    // Storage arena accessors (const and mutable)
    const float* storage1_data() const { return storage1_.data(); }      // strategy_sum
    const float* storage2_data() const { return storage2_.data(); }      // regrets
    const float* storage_ip_data() const { return storage_ip_.data(); }
    const float* storage_chance_data() const { return storage_chance_.data(); }
    float* storage1_data_mut() { return storage1_.data(); }
    float* storage2_data_mut() { return storage2_.data(); }
    float* storage_ip_data_mut() { return storage_ip_.data(); }
    float* storage_chance_data_mut() { return storage_chance_.data(); }

    // Strategy at root
    std::vector<float> root_strategy() const;

private:
    CardConfig card_config_;
    TreeConfig tree_config_;
    std::unique_ptr<ActionTree> action_tree_;

    // Node arena (flat)
    std::vector<PostFlopNode> node_arena_;

    // Storage arenas (flat, f32 or i16/u16)
    std::vector<float>  storage1_;     // strategy
    std::vector<float>  storage2_;     // regrets
    std::vector<float>  storage_ip_;   // IP cfvalues at OOP nodes
    std::vector<float>  storage_chance_; // chance-node cfvalues
    bool is_compressed_ = false;
    bool is_solved_ = false;
    bool gpu_enabled_ = false;   // V4: GPU mode flag
    std::unique_ptr<GpuMemory> gpu_mem_;  // V6: per-game GPU memory (not static)

    // Total elements per arena
    uint64_t num_storage_ = 0;
    uint64_t num_storage_ip_ = 0;
    uint64_t num_storage_chance_ = 0;

    // Counts per street
    std::array<uint64_t, 3> num_nodes_per_street_ = {0, 0, 0};

    // ── Internal setup ─────────────────────────────────────────────────
    void build_node_arena();
    void compute_card_data();   // valid_indices, hand_strength, isomorphism
    void compute_hand_strength_for_all_boards();

    // Allocate node storage offsets
    void allocate_node_storage();

    // Recursive helper to count nodes
    void count_nodes_recursive(const ActionTreeNode& atn, BoardState state, int& idx);
    void build_node_recursive(const ActionTreeNode& atn, PostFlopNode& node,
                              BoardState state, int& idx, std::vector<int>& stack);
};

} // namespace postflop

#endif // GAME_H
