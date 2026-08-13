#include "game.h"
#include "solver.h"
#include "gpu_solver.h"
#include <algorithm>
#include <stdexcept>
#include <cstring>
#include <cstdio>

namespace postflop {

PostFlopGame::PostFlopGame(CardConfig card_config, TreeConfig tree_config,
                           std::vector<std::vector<Action>> added_lines,
                           std::vector<std::vector<Action>> removed_lines)
    : card_config_(std::move(card_config)),
      tree_config_(tree_config)
{
    action_tree_ = std::make_unique<ActionTree>(tree_config,
                                                std::move(added_lines),
                                                std::move(removed_lines));
}

PostFlopGame::~PostFlopGame() = default;

GpuMemory* PostFlopGame::gpu_mem() { return gpu_mem_.get(); }
const GpuMemory* PostFlopGame::gpu_mem() const { return gpu_mem_.get(); }
void PostFlopGame::set_gpu_mem(std::unique_ptr<GpuMemory> m) { gpu_mem_ = std::move(m); }
bool PostFlopGame::gpu_mem_initialized() const { return gpu_mem_ != nullptr; }

void PostFlopGame::prepare() {
    if (card_config_.ranges.empty()) {
        card_config_.ranges.push_back(card_config_.range_oop);
        card_config_.ranges.push_back(card_config_.range_ip);
        card_config_.num_players = 2;
    }

    int n = card_config_.num_players;
    card_config_.private_cards.resize(n);
    card_config_.initial_weights.resize(n);
    card_config_.same_hand_index.resize(n);
    card_config_.hand_strength.resize(n);

    uint64_t dead_mask = 0;
    for (int i = 0; i < 3; ++i) dead_mask |= card_to_bit(card_config_.flop[i]);
    if (card_config_.turn != NOT_DEALT)  dead_mask |= card_to_bit(card_config_.turn);
    if (card_config_.river != NOT_DEALT) dead_mask |= card_to_bit(card_config_.river);

    for (int p = 0; p < n; ++p) {
        auto hands = card_config_.ranges[p].get_hands_weights(dead_mask);
        card_config_.private_cards[p].reserve(hands.size());
        card_config_.initial_weights[p].reserve(hands.size());
        for (auto& h : hands) {
            card_config_.private_cards[p].push_back({h.c1, h.c2});
            card_config_.initial_weights[p].push_back(h.weight);
        }
    }

    for (int p = 0; p < n; ++p) {
        card_config_.same_hand_index[p].assign(card_config_.private_cards[p].size(), 0xFFFF);
        if (n == 2) {
            int opp = 1 - p;
            for (size_t i = 0; i < card_config_.private_cards[p].size(); ++i) {
                const auto& c = card_config_.private_cards[p][i];
                for (size_t j = 0; j < card_config_.private_cards[opp].size(); ++j) {
                    const auto& q = card_config_.private_cards[opp][j];
                    if ((c.first == q.first && c.second == q.second) ||
                        (c.first == q.second && c.second == q.first)) {
                        card_config_.same_hand_index[p][i] = (uint16_t)j;
                        break;
                    }
                }
            }
        }
    }

    build_node_arena();
    compute_hand_strength_for_all_boards();
}

void PostFlopGame::build_node_arena() {
    struct BFSItem {
        const ActionTreeNode* node;
        BoardState state;
        int arena_idx;       
        int parent_idx;      
        int depth;           
    };

    std::vector<BFSItem> bfs_order;
    bfs_order.reserve(256);
    bfs_order.push_back({&action_tree_->root(), tree_config_.initial_state, 0, -1, 0});
    
    node_arena_.clear();
    node_arena_.reserve(256);
    nodes_by_depth_.clear();
    max_tree_depth_ = 0;

    size_t head = 0;
    while (head < bfs_order.size()) {
        BFSItem& cur = bfs_order[head];
        const ActionTreeNode* atn = cur.node;
        int my_idx = cur.arena_idx;

        if (cur.depth >= (int)nodes_by_depth_.size()) {
            nodes_by_depth_.push_back(std::vector<int>());
        }
        nodes_by_depth_[cur.depth].push_back(my_idx);
        if (cur.depth > max_tree_depth_) max_tree_depth_ = cur.depth;

        PostFlopNode node{};
        node.player = atn->player;
        node.turn = card_config_.turn;
        node.river = card_config_.river;
        node.active_mask = atn->active_mask; // <--- ИСПРАВЛЕНО
        node.amount = atn->amount;
        node.num_children = (uint16_t)atn->actions.size();
        node.children_offset = (uint32_t)(bfs_order.size());  

        int p = node.get_player();
        if (!node.is_terminal() && !node.is_chance() && p < card_config_.num_players) {
            node.num_elements = (uint32_t)(node.num_children * num_private_hands(p));
        } else {
            node.num_elements = 0;
        }
        node.num_elements_ip = 0;
        node.scale1 = 1.0f;
        node.scale2 = 1.0f;
        node.scale3 = 1.0f;
        node.storage1_offset = 0;
        node.storage2_offset = 0;
        node.storage3_offset = 0;
        node.storage_chance_offset = 0;
        node_arena_.push_back(node);

        for (const auto& child : atn->children) {
            int child_idx = (int)bfs_order.size();
            bfs_order.push_back({child.get(), atn->board_state, child_idx, my_idx, cur.depth + 1});
        }
        ++head;
    }
}

void PostFlopGame::compute_hand_strength_for_all_boards() {
    if (!card_config_.has_turn() || !card_config_.has_river()) return;
    Card b0 = card_config_.flop[0], b1 = card_config_.flop[1], b2 = card_config_.flop[2];
    Card b3 = card_config_.turn, b4 = card_config_.river;

    for (int p = 0; p < card_config_.num_players; ++p) {
        std::vector<StrengthItem> items;
        items.reserve(card_config_.private_cards[p].size());
        for (size_t i = 0; i < card_config_.private_cards[p].size(); ++i) {
            Card h0 = card_config_.private_cards[p][i].first;
            Card h1 = card_config_.private_cards[p][i].second;
            Card cards[7] = {h0, h1, b0, b1, b2, b3, b4};
            uint16_t s = (uint16_t)evaluate(cards, 7);
            items.push_back({s, (uint16_t)i});
        }
        std::sort(items.begin(), items.end(),
                  [](const StrengthItem& a, const StrengthItem& b) { return a.strength < b.strength; });
        card_config_.hand_strength[p] = std::move(items);
    }
}

std::pair<uint64_t, uint64_t> PostFlopGame::memory_usage() const {
    uint64_t uncompressed = 4 * (2 * num_storage_ + num_storage_ip_ + num_storage_chance_);
    uint64_t compressed   = 2 * (2 * num_storage_ + num_storage_ip_ + num_storage_chance_);
    return {uncompressed, compressed};
}

void PostFlopGame::allocate_memory(bool enable_compression) {
    is_compressed_ = enable_compression;
    uint64_t total_strategy = 0, total_regret = 0, total_ip = 0, total_chance = 0;

    for (auto& node : node_arena_) {
        if (node.is_terminal()) continue;
        if (node.is_chance()) {
            total_chance += node.num_elements;
        } else {
            int p = node.get_player();
            if (p < card_config_.num_players) {
                uint32_t ne = node.num_elements;
                total_strategy += ne;
                total_regret   += ne;
                if (p == 1 && card_config_.num_players == 2) {
                    node.num_elements_ip = (uint16_t)num_private_hands(1);
                    total_ip += node.num_elements_ip;
                }
            }
        }
    }

    num_storage_        = total_strategy;
    num_storage_ip_     = total_ip;
    num_storage_chance_ = total_chance;

    size_t mult = is_compressed_ ? 2 : 1; 
    storage1_.assign((total_strategy + mult - 1) / mult, 0.0f);
    storage2_.assign((total_regret + mult - 1) / mult, 0.0f);
    storage_ip_.assign((total_ip + mult - 1) / mult, 0.0f);
    storage_chance_.assign((total_chance + mult - 1) / mult, 0.0f);

    uint64_t off_strat = 0, off_reg = 0, off_ip = 0, off_chance = 0;
    for (auto& node : node_arena_) {
        if (node.is_terminal()) continue;
        if (node.is_chance()) {
            node.storage_chance_offset = (uint32_t)off_chance;
            off_chance += node.num_elements;
        } else {
            int p = node.get_player();
            if (p < card_config_.num_players) {
                node.storage1_offset = (uint32_t)off_strat;
                node.storage2_offset = (uint32_t)off_reg;
                off_strat += node.num_elements;
                off_reg   += node.num_elements;
                if (node.num_elements_ip > 0) {
                    node.storage3_offset = (uint32_t)off_ip;
                    off_ip += node.num_elements_ip;
                }
            }
        }
    }
}

std::vector<float> PostFlopGame::root_strategy() const {
    if (node_arena_.empty()) return {};
    const PostFlopNode& root = node_arena_[0];
    int n = (int)root.num_elements;
    std::vector<float> s(n);
    
    if (is_compressed_) {
        const int16_t* src = (const int16_t*)storage1_.data() + root.storage1_offset;
        float decode_mult = root.scale1 / 32767.0f;
        for (int i = 0; i < n; ++i) s[i] = (float)src[i] * decode_mult;
    } else {
        std::memcpy(s.data(), storage1_.data() + root.storage1_offset, n * sizeof(float));
    }
    
    int na = root.num_actions();
    int nh = n / na;
    normalize_strategy(s.data(), na, nh);
    return s;
}

} // namespace postflop
