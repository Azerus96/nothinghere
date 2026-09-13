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
    // Sync the known board cards into the tree config so that
    // ActionTree::enumerate_chance_actions deals known streets
    // deterministically (1 child) and expands only genuinely pending
    // streets (49 turn / 48 river runouts).
    tree_config_.board[0] = card_config_.flop[0];
    tree_config_.board[1] = card_config_.flop[1];
    tree_config_.board[2] = card_config_.flop[2];
    tree_config_.board[3] = card_config_.turn;
    tree_config_.board[4] = card_config_.river;

    action_tree_ = std::make_unique<ActionTree>(tree_config_,
                                                std::move(added_lines),
                                                std::move(removed_lines));
    // Reflect the effective (post two-tier-routing) config, including the
    // board sync, back so tree_config() reports what was actually built.
    tree_config_ = action_tree_->effective_config();
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
        double wsum = 0.0;
        for (auto& h : hands) {
            card_config_.private_cards[p].push_back({h.c1, h.c2});
            card_config_.initial_weights[p].push_back(h.weight);
            wsum += h.weight;
        }
        // Normalize each player's initial range to total mass 1.0 so that
        // reach vectors are genuine probability distributions. This unifies
        // the EV scale of the CPU and GPU terminal evaluators (the legacy
        // build divided payoffs by opp_num_hands on the CPU side only,
        // which was inconsistent with the GPU kernels' raw reach products).
        if (wsum > 0.0) {
            float inv = (float)(1.0 / wsum);
            for (auto& w : card_config_.initial_weights[p]) w *= inv;
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
    node_arena_.clear();
    nodes_by_depth_.clear();
    strength_cache_.clear();

    struct QueueItem {
        const ActionTreeNode* atn;
        BoardState state;
        Card turn;     // board context effective at this node
        Card river;
        int my_idx;
        int parent_idx;
        int depth;
    };
    std::vector<QueueItem> bfs_order;
    bfs_order.push_back({&action_tree_->root(), tree_config_.initial_state,
                         card_config_.turn, card_config_.river, 0, -1, 0});

    size_t head = 0;
    while (head < bfs_order.size()) {
        auto cur = bfs_order[head];
        const ActionTreeNode* atn = cur.atn;

        if (cur.depth >= (int)nodes_by_depth_.size()) {
            nodes_by_depth_.resize(cur.depth + 1);
        }
        nodes_by_depth_[cur.depth].push_back((int)head);

        PostFlopNode node;
        node.player = atn->player;
        // Per-node effective board: a chance child inherits the card dealt by
        // its Chance action; all other nodes inherit the parent context.
        node.turn = cur.turn;
        node.river = cur.river;
        node.active_mask = atn->active_mask;
        node.amount = atn->total_pot;              // [Defect 1.8] exact total pot
        for (int i = 0; i < 6; ++i) node.invested[i] = atn->invested[i];
        node.children_offset = (uint32_t)bfs_order.size();

        node.num_children = (uint16_t)atn->children.size();

        // Semantic action types [Defect 1.5].
        for (size_t a = 0; a < atn->actions.size() && a < MAX_NODE_ACTIONS; ++a) {
            node.action_types[a] = (uint8_t)atn->actions[a].type;
        }

        int p = node.get_player();
        if (!node.is_terminal() && !node.is_chance() && p < card_config_.num_players) {
            node.num_elements = (uint32_t)(node.num_children * num_private_hands(p));
        } else {
            node.num_elements = 0;
        }
        node.num_elements_ip = 0;
        node.scale1 = 1.0f;
        node.scale2 = 1.0f;
        node.scale3 = 0.0f;
        node.storage1_offset = 0;
        node.storage2_offset = 0;
        node.storage3_offset = 0;
        node.storage_chance_offset = 0;
        node_arena_.push_back(node);

        bool node_is_chance = (atn->player & PLAYER_CHANCE_FLAG) != 0;
        BoardState child_state = node_is_chance ? atn->board_state : atn->board_state;

        for (size_t ci = 0; ci < atn->children.size(); ++ci) {
            const auto& child = atn->children[ci];
            Card child_turn = cur.turn;
            Card child_river = cur.river;
            if (node_is_chance) {
                // The chance action that produced this child deals the
                // target street's card.
                Card dealt = (ci < atn->actions.size()) ? atn->actions[ci].card : NOT_DEALT;
                if (atn->board_state == BoardState::Turn && dealt != NOT_DEALT) child_turn = dealt;
                if (atn->board_state == BoardState::River && dealt != NOT_DEALT) child_river = dealt;
            }
            int child_idx = (int)bfs_order.size();
            bfs_order.push_back({child.get(), child_state, child_turn, child_river,
                                 child_idx, cur.my_idx, cur.depth + 1});
        }
        ++head;
    }

    max_tree_depth_ = nodes_by_depth_.empty() ? 0 : (int)nodes_by_depth_.size() - 1;
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

const std::vector<StrengthItem>& PostFlopGame::cached_strengths(int player, Card turn, Card river) const {
    uint16_t key = (uint16_t)(((uint16_t)turn << 8) | (uint16_t)river);
    std::lock_guard<std::mutex> lk(strength_cache_mu_);
    auto it = strength_cache_.find(key);
    if (it != strength_cache_.end()) return it->second[player];

    Card b0 = card_config_.flop[0], b1 = card_config_.flop[1], b2 = card_config_.flop[2];
    auto& entry = strength_cache_[key];
    for (int p = 0; p < card_config_.num_players; ++p) {
        std::vector<StrengthItem> items;
        items.reserve(card_config_.private_cards[p].size());
        for (size_t i = 0; i < card_config_.private_cards[p].size(); ++i) {
            Card h0 = card_config_.private_cards[p][i].first;
            Card h1 = card_config_.private_cards[p][i].second;
            Card cards[7] = {h0, h1, b0, b1, b2, turn, river};
            items.push_back({(uint16_t)evaluate(cards, 7), (uint16_t)i});
        }
        std::sort(items.begin(), items.end(),
                  [](const StrengthItem& a, const StrengthItem& b) { return a.strength < b.strength; });
        entry[p] = std::move(items);
    }
    return entry[player];
}

std::pair<uint64_t, uint64_t> PostFlopGame::memory_usage() const {
    uint64_t uncompressed = 4 * (2 * num_storage_ + num_storage_ip_ + num_storage_chance_);
    uint64_t compressed   = 2 * (2 * num_storage_ + num_storage_ip_ + num_storage_chance_);
    return {uncompressed, compressed};
}

void PostFlopGame::allocate_memory(bool enable_compression) {
    // [Defect 1.9] Pure FP32 precision: INT16 quantization is disabled by
    // default on the 2x Tesla T4 staging platform (32 GB VRAM total). The
    // compression parameter remains available for constrained targets but
    // every regression path and the live solver run uncompressed FP32.
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
    int nh = (na > 0) ? n / na : 0;
    if (na > 0 && nh > 0) normalize_strategy(s.data(), na, nh);
    return s;
}

} // namespace postflop
