#ifndef GAME_H
#define GAME_H

#include <cstdint>
#include <vector>
#include <array>
#include <memory>
#include <mutex>
#include <unordered_map>
#include "cuda_compat.h"
#include "card.h"
#include "range.h"
#include "action_tree.h"
#include "hand_evaluator.h"

namespace postflop { struct GpuMemory; }

namespace postflop {

// Maximum number of semantic action types storable inline in a node.
// Decision nodes in this codebase never exceed 8 actions (Fold/Call/Check
// + up to 3 raises + AllIn); chance nodes store Chance for the first 8
// children (their types are homogeneous and never queried semantically).
constexpr int MAX_NODE_ACTIONS = 8;

struct PostFlopNode {
    uint8_t  player;
    uint8_t  turn;               // Effective turn card at this node (NOT_DEALT while street pending)
    uint8_t  river;              // Effective river card at this node (NOT_DEALT while street pending)
    uint8_t  active_mask;        // Mask of players still active (not folded) at this node
    int32_t  amount;             // TOTAL pot at this node (starting pot + all streets' chips) [Defect 1.8]
    uint32_t children_offset;
    uint16_t num_children;
    uint16_t num_elements_ip;
    uint32_t num_elements;
    float    scale1;
    float    scale2;
    float    scale3;
    uint32_t storage1_offset;
    uint32_t storage2_offset;
    uint32_t storage3_offset;
    uint32_t storage_chance_offset;
    // ── Defect 1.1 / 1.8: cumulative chips contributed by each player at
    // this node (including their seeded share of the starting pot).
    // Sum over players == amount (exact zero-sum chip bookkeeping).
    // [Module 1, V8] MAX_PLAYERS-sized: V7's invested[6] sat directly
    // before action_types[8], so 7/8-handed games wrote invested[6]/[7]
    // out of bounds and stomped the semantic action-type bytes (the exact
    // corruption vector regression-tested by test_regression_8max.cpp).
    int32_t  invested[MAX_PLAYERS];
    // ── [Module 4, V8] ICM bubble factor snapshot for THIS node ───────────
    // Copied from TreeConfig::bubble_factor at arena-build time so both the
    // CPU evaluators and the GPU kernels read the identical risk scaling
    // (kernel_terminal_fold / kernel_terminal_showdown use node.bubble_factor;
    // kernel_exact_820_showdown_leaf receives it as a launch argument).
    float    bubble_factor;
    // ── Defect 1.5: semantic Action::Type of each child action, enabling
    // type-bound (not index-bound) node locking and strategy reporting.
    uint8_t  action_types[8];

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

    // Defect 1.5 helper: semantic type of child action `a` (0..num_children-1).
    // Action::Type::Chance for chance children beyond the stored window.
    __device__ __host__ __forceinline__
    uint8_t action_type(int a) const {
        return (a < MAX_NODE_ACTIONS) ? action_types[a] : (uint8_t)7 /* Chance */;
    }
};

struct StrengthItem {
    uint16_t strength;
    uint16_t index;
};

struct CardConfig {
    int num_players = 2;
    std::vector<Range> ranges;

    Range range_oop;
    Range range_ip;

    Card  flop[3];
    Card  turn;
    Card  river;

    std::vector<std::vector<std::pair<Card, Card>>> private_cards;
    std::vector<std::vector<float>>                 initial_weights;
    std::vector<std::vector<uint16_t>>              same_hand_index;
    std::vector<std::vector<StrengthItem>>          hand_strength;

    bool has_flop() const  { return flop[0] != NOT_DEALT; }
    bool has_turn() const  { return turn != NOT_DEALT; }
    bool has_river() const { return river != NOT_DEALT; }
};

class PostFlopGame {
public:
    PostFlopGame(CardConfig card_config, TreeConfig tree_config,
                 std::vector<std::vector<Action>> added_lines = {},
                 std::vector<std::vector<Action>> removed_lines = {});
    ~PostFlopGame();

    void prepare();
    std::pair<uint64_t, uint64_t> memory_usage() const;
    // Defect 1.9: pure FP32 precision — `enable_compression` defaults to
    // false; INT16 quantization is DISABLED on 2x Tesla T4 (32 GB VRAM).
    void allocate_memory(bool enable_compression = false);

    friend float solve(PostFlopGame& game, uint32_t max_iter, float target_exploit, bool verbose);
    friend void solve_step(PostFlopGame& game, uint32_t current_iter);
    friend void finalize(PostFlopGame& game);
    friend float compute_exploitability(const PostFlopGame& game);

    int num_players() const { return card_config_.num_players; }
    int num_private_hands(int player) const { return (int)card_config_.private_cards[player].size(); }
    const std::vector<float>& initial_weights(int player) const { return card_config_.initial_weights[player]; }
    const std::vector<std::pair<Card, Card>>& private_cards(int player) const { return card_config_.private_cards[player]; }
    const TreeConfig& tree_config() const { return tree_config_; }
    const CardConfig& card_config() const { return card_config_; }
    bool is_compression_enabled() const { return is_compressed_; }
    bool is_solved() const { return is_solved_; }
    void set_solved() { is_solved_ = true; }

    bool is_gpu_enabled() const { return gpu_enabled_; }
    void set_gpu_enabled(bool v) { gpu_enabled_ = v; }

    GpuMemory* gpu_mem();
    const GpuMemory* gpu_mem() const;
    void set_gpu_mem(std::unique_ptr<GpuMemory> m);
    bool gpu_mem_initialized() const;

    uint64_t num_nodes() const { return node_arena_.size(); }
    const std::vector<PostFlopNode>& node_arena() const { return node_arena_; }

    const std::vector<std::vector<int>>& nodes_by_depth() const { return nodes_by_depth_; }
    int max_tree_depth() const { return max_tree_depth_; }

    // ── Locked (frozen) players: their regret/strategy arenas are never
    // updated by the solver (node-locking / exploit profiles). Bit p set =
    // player p locked. Honored by BOTH CPU and GPU solve paths [Defect 1.5].
    uint8_t locked_players_mask() const { return locked_players_mask_; }
    void set_locked_players_mask(uint8_t mask) { locked_players_mask_ = mask; }

    const float* storage1_data() const { return storage1_.data(); }
    const float* storage2_data() const { return storage2_.data(); }
    const float* storage_ip_data() const { return storage_ip_.data(); }
    const float* storage_chance_data() const { return storage_chance_.data(); }
    float* storage1_data_mut() { return storage1_.data(); }
    float* storage2_data_mut() { return storage2_.data(); }
    float* storage_ip_data_mut() { return storage_ip_.data(); }
    float* storage_chance_data_mut() { return storage_chance_.data(); }

    size_t storage1_bytes() const { return storage1_.size() * sizeof(float); }
    size_t storage2_bytes() const { return storage2_.size() * sizeof(float); }
    size_t storage_ip_bytes() const { return storage_ip_.size() * sizeof(float); }
    size_t storage_chance_bytes() const { return storage_chance_.size() * sizeof(float); }

    std::vector<float> root_strategy() const;

    // Lazily-built per-(turn,river) sorted strength table used by the
    // heads-up terminal evaluator (public: solver.cpp consumes it).
    const std::vector<StrengthItem>& cached_strengths(int player, Card turn, Card river) const;

    // Number of chance outcomes at a pending-street transition (used to scale
    // counterfactual reaches). Correct counts: 52 - dealt board cards.
    int chance_factor(const PostFlopNode& node) const {
        int dealt = 3;  // flop
        if (node.turn != NOT_DEALT)  ++dealt;
        if (node.river != NOT_DEALT) ++dealt;
        return NUM_CARDS - dealt;
    }

private:
    CardConfig card_config_;
    TreeConfig tree_config_;
    std::unique_ptr<ActionTree> action_tree_;

    std::vector<PostFlopNode> node_arena_;
    std::vector<std::vector<int>> nodes_by_depth_;
    int max_tree_depth_ = 0;

    std::vector<float>  storage1_;      // strategy sum (FP32) [Defect 1.9]
    std::vector<float>  storage2_;      // regrets incl. negative values [Defect 1.3]
    std::vector<float>  storage_ip_;
    std::vector<float>  storage_chance_;

    bool is_compressed_ = false;
    bool is_solved_ = false;
    bool gpu_enabled_ = false;
    std::unique_ptr<GpuMemory> gpu_mem_;

    uint64_t num_storage_ = 0;
    uint64_t num_storage_ip_ = 0;
    uint64_t num_storage_chance_ = 0;

    uint8_t locked_players_mask_ = 0;

    // Per-(turn,river) sorted strength cache for terminal evaluation.
    // Key: (turn << 8) | river. Filled lazily; guarded by mutex for safety
    // even though the solver itself is single-threaded per game.
    // [Module 1, V8] MAX_PLAYERS rows (V7 sized 6 — out-of-range for 7/8).
    mutable std::unordered_map<uint16_t,
        std::array<std::vector<StrengthItem>, MAX_PLAYERS>> strength_cache_;
    mutable std::mutex strength_cache_mu_;

    void build_node_arena();
    void compute_hand_strength_for_all_boards();
};

} // namespace postflop

#endif // GAME_H
