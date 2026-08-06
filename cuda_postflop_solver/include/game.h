// ════════════════════════════════════════════════════════════════════════
// game.h — PostFlopGame: flat node arena + storage arenas (GPU-ready)
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

namespace postflop { struct GpuMemory; }

namespace postflop {

struct PostFlopNode {
    uint8_t  player;             
    uint8_t  turn;               
    uint8_t  river;              
    uint8_t  is_locked;          
    int32_t  amount;             
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

struct StrengthItem {
    uint16_t strength;   
    uint16_t index;      
};

struct CardConfig {
    Range range_oop;          
    Range range_ip;           
    Card  flop[3];            
    Card  turn;               
    Card  river;              

    std::vector<std::pair<Card, Card>> private_cards[2];   
    std::vector<float>                initial_weights[2];  
    std::vector<uint16_t>             same_hand_index[2];  
    std::vector<uint16_t>             valid_indices_flop[2];
    std::vector<std::array<std::vector<uint16_t>, 2>> valid_indices_turn;
    std::vector<std::array<std::vector<uint16_t>, 2>> valid_indices_river;
    std::vector<std::array<std::vector<StrengthItem>, 2>> hand_strength;

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
    void allocate_memory(bool enable_compression);

    friend float solve(PostFlopGame& game, uint32_t max_iter, float target_exploit, bool verbose);
    friend void solve_step(PostFlopGame& game, uint32_t current_iter);
    friend void finalize(PostFlopGame& game);
    friend float compute_exploitability(const PostFlopGame& game);

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

    const float* storage1_data() const { return storage1_.data(); }      
    const float* storage2_data() const { return storage2_.data(); }      
    const float* storage_ip_data() const { return storage_ip_.data(); }
    const float* storage_chance_data() const { return storage_chance_.data(); }
    float* storage1_data_mut() { return storage1_.data(); }
    float* storage2_data_mut() { return storage2_.data(); }
    float* storage_ip_data_mut() { return storage_ip_.data(); }
    float* storage_chance_data_mut() { return storage_chance_.data(); }

    // Геттеры размеров хранилищ в байтах для GPU
    size_t storage1_bytes() const { return storage1_.size() * sizeof(float); }
    size_t storage_ip_bytes() const { return storage_ip_.size() * sizeof(float); }
    size_t storage_chance_bytes() const { return storage_chance_.size() * sizeof(float); }

    std::vector<float> root_strategy() const;

    int chance_factor(const PostFlopNode& node) const {
        return (node.turn == NOT_DEALT) ? 45 : 44;
    }

private:
    CardConfig card_config_;
    TreeConfig tree_config_;
    std::unique_ptr<ActionTree> action_tree_;

    std::vector<PostFlopNode> node_arena_;
    std::vector<std::vector<int>> nodes_by_depth_;
    int max_tree_depth_ = 0;

    std::vector<float>  storage1_;     
    std::vector<float>  storage2_;     
    std::vector<float>  storage_ip_;   
    std::vector<float>  storage_chance_; 
    
    bool is_compressed_ = false;
    bool is_solved_ = false;
    bool gpu_enabled_ = false;   
    std::unique_ptr<GpuMemory> gpu_mem_;  

    uint64_t num_storage_ = 0;
    uint64_t num_storage_ip_ = 0;
    uint64_t num_storage_chance_ = 0;

    void build_node_arena();
    void compute_card_data();   
    void compute_hand_strength_for_all_boards();
};

} // namespace postflop

#endif // GAME_H
