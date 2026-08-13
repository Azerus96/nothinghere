// ════════════════════════════════════════════════════════════════════════
// action_tree.cpp — Game tree builder for NLHE postflop (Multiway Support)
// ════════════════════════════════════════════════════════════════════════
#include "action_tree.h"
#include <algorithm>
#include <stdexcept>
#include <cmath>
#include <set>
#include <functional>

namespace postflop {

static std::vector<BetSize> parse_bet_size_list(const std::string& s, bool is_raise) {
    std::vector<BetSize> result;
    std::string token;
    size_t i = 0;
    while (i <= s.size()) {
        if (i == s.size() || s[i] == ',') {
            size_t start = token.find_first_not_of(" \t");
            size_t end = token.find_last_not_of(" \t");
            if (start != std::string::npos) {
                std::string t = token.substr(start, end - start + 1);
                if (t == "a" || t == "A") {
                    result.push_back(BetSize::AllIn());
                } else if (t.back() == '%') {
                    double r = std::stod(t.substr(0, t.size() - 1)) / 100.0;
                    result.push_back(BetSize::PotRelative(r));
                } else if (t.back() == 'x' || t.back() == 'X') {
                    if (!is_raise) throw std::invalid_argument("'x' only valid for raises: " + t);
                    double r = std::stod(t.substr(0, t.size() - 1));
                    if (r <= 1.0) throw std::invalid_argument("raise multiplier must be > 1: " + t);
                    result.push_back(BetSize::PrevRelative(r));
                } else if (t.find('e') != std::string::npos || t.find('E') != std::string::npos) {
                    int n = 1;
                    double max_ratio = 1e9;
                    size_t e_pos = t.find_first_of("eE");
                    std::string before = t.substr(0, e_pos);
                    std::string after = t.substr(e_pos + 1);
                    if (!before.empty()) n = std::stoi(before);
                    if (!after.empty() && after.back() == '%') {
                        max_ratio = std::stod(after.substr(0, after.size() - 1)) / 100.0;
                    }
                    result.push_back(BetSize::Geometric(n, max_ratio));
                } else if (t.find('c') != std::string::npos) {
                    size_t c_pos = t.find('c');
                    int32_t base = std::stoi(t.substr(0, c_pos));
                    int32_t cap = 100;
                    size_t r_pos = t.find('r');
                    if (r_pos != std::string::npos) cap = std::stoi(t.substr(r_pos + 1));
                    if (!is_raise) throw std::invalid_argument("'c' only valid for raises: " + t);
                    result.push_back(BetSize::Additive(base, cap));
                } else {
                    throw std::invalid_argument("Unknown bet size: " + t);
                }
            }
            token.clear();
        } else {
            token += s[i];
        }
        ++i;
    }
    std::sort(result.begin(), result.end(), [](const BetSize& a, const BetSize& b) {
        return (uint8_t)a.kind < (uint8_t)b.kind;
    });
    return result;
}

BetSizeOptions parse_bet_size_options(const std::string& bet_str, const std::string& raise_str) {
    BetSizeOptions opt;
    opt.bet = parse_bet_size_list(bet_str, false);
    opt.raise = parse_bet_size_list(raise_str, true);
    return opt;
}

ActionTree::ActionTree(const TreeConfig& cfg,
                       std::vector<std::vector<Action>> added_lines,
                       std::vector<std::vector<Action>> removed_lines)
    : config_(cfg), added_lines_(std::move(added_lines)),
      removed_lines_(std::move(removed_lines))
{
    root_ = std::make_unique<ActionTreeNode>();
    root_->player = 0; 
    root_->board_state = cfg.initial_state;
    root_->amount = 0;

    int num_players = cfg.num_players;
    if (num_players < 2 || num_players > 6) {
        throw std::invalid_argument("num_players must be between 2 and 6");
    }

    BuildInfo info;
    info.stacks.assign(num_players, cfg.effective_stack);
    info.invested_this_street.assign(num_players, 0);
    info.folded.assign(num_players, false);
    info.allin.assign(num_players, false);
    info.active_players = num_players;
    info.current_bet = 0;
    info.num_raises = 0;
    info.actions_this_street = 0;

    build_recursive(*root_, cfg.initial_state, 0, info);

    if (!added_lines_.empty())   apply_added_lines();
    if (!removed_lines_.empty()) apply_removed_lines();
}

void ActionTree::push_actions(ActionTreeNode& node, int player, BoardState state, BuildInfo& info) {
    const auto& bet_options = (state == BoardState::Flop) ? config_.flop_bet_sizes[player]
                              : (state == BoardState::Turn) ? config_.turn_bet_sizes[player]
                              : config_.river_bet_sizes[player];

    int32_t pot = config_.starting_pot + node.amount; 
    int32_t to_call = info.current_bet - info.invested_this_street[player];
    int32_t my_stack = info.stacks[player];

    if (to_call > 0) {
        node.actions.push_back({Action::Type::Fold, 0, NOT_DEALT});
        int32_t actual_call = std::min(to_call, my_stack);
        node.actions.push_back({Action::Type::Call, actual_call, NOT_DEALT});

        int max_raises = (config_.num_players > 2) ? 1 : 3; 

        if (info.num_raises < max_raises && my_stack > actual_call) {
            for (const auto& bs : bet_options.raise) {
                int32_t raise_amt = compute_bet_size(bs, pot, info.current_bet, to_call, my_stack);
                if (raise_amt > info.current_bet && raise_amt <= my_stack) {
                    node.actions.push_back({Action::Type::Raise, raise_amt, NOT_DEALT});
                }
            }
            node.actions.push_back({Action::Type::AllIn, my_stack, NOT_DEALT});
        }
    } else {
        node.actions.push_back({Action::Type::Check, 0, NOT_DEALT});

        for (const auto& bs : bet_options.bet) {
            if (bs.kind == BetSize::Kind::AllIn) {
                node.actions.push_back({Action::Type::AllIn, my_stack, NOT_DEALT});
                continue;
            }
            int32_t bet_amt = compute_bet_size(bs, pot, 0, 0, my_stack);
            if (bet_amt > 0 && bet_amt <= my_stack) {
                node.actions.push_back({Action::Type::Bet, bet_amt, NOT_DEALT});
            }
        }
    }

    std::sort(node.actions.begin(), node.actions.end());
    node.actions.erase(std::unique(node.actions.begin(), node.actions.end()), node.actions.end());

    if (config_.merging_threshold > 0 && info.current_bet == 0) {
        merge_bet_actions(node.actions, pot, 0, config_.merging_threshold);
    }
}

int32_t ActionTree::compute_bet_size(const BetSize& bs, int32_t pot, int32_t current_bet,
                                     int32_t to_call, int32_t my_stack) const {
    switch (bs.kind) {
        case BetSize::Kind::PotRelative:
            return std::max(1, std::min((int32_t)(bs.pot_rel * (pot + to_call)) + current_bet, my_stack));
        case BetSize::Kind::PrevBetRelative: 
            return std::max(1, std::min((int32_t)(current_bet * bs.prev_rel), my_stack));
        case BetSize::Kind::Additive:
            return std::max(1, std::min(bs.additive_base + current_bet, my_stack));
        case BetSize::Kind::Geometric: {
            double spr = (pot > 0) ? (double)my_stack / pot : 0;
            double ratio = (std::pow(2.0 * spr + 1.0, 1.0 / bs.geometric_streets) - 1.0) / 2.0;
            ratio = std::min(ratio, bs.geometric_max_ratio);
            return std::max(1, std::min((int32_t)(ratio * pot) + current_bet, my_stack));
        }
        case BetSize::Kind::AllIn:
            return my_stack;
        default: return 0;
    }
}

void ActionTree::merge_bet_actions(std::vector<Action>& actions, int32_t pot,
                                   int32_t prev_amount, double threshold) const {
    if (actions.size() < 2) return;
    std::vector<Action> result;
    for (int i = (int)actions.size() - 1; i >= 0; --i) {
        if (result.empty()) {
            result.push_back(actions[i]);
            continue;
        }
        const Action& cur = result.back();
        const Action& cand = actions[i];
        if (cand.type != cur.type) {
            result.push_back(cand);
            continue;
        }
        int32_t cur_amt = cur.amount - prev_amount;
        int32_t cand_amt = cand.amount - prev_amount;
        double cur_ratio = (pot > 0) ? (double)cur_amt / pot : 0;
        double cand_ratio = (pot > 0) ? (double)cand_amt / pot : 0;
        if ((cur_ratio - threshold) / (1 + threshold) < cand_ratio) {
            result.push_back(cand);
        }
    }
    std::reverse(result.begin(), result.end());
    actions = result;
}

void ActionTree::build_recursive(ActionTreeNode& node, BoardState state, int player, BuildInfo info) {
    if (state > config_.initial_state && (int)state > 2) return; 

    if (info.active_players == 1) {
        node.player = player | PLAYER_TERMINAL_FLAG;
        return;
    }

    bool street_ended = false;
    if (info.actions_this_street >= info.active_players) {
        street_ended = true;
        for (int i = 0; i < config_.num_players; ++i) {
            if (!info.folded[i] && !info.allin[i] && info.invested_this_street[i] < info.current_bet) {
                street_ended = false;
                break;
            }
        }
    }

    if (street_ended) {
        BoardState next_state = (BoardState)((int)state + 1);
        if ((int)next_state > 2) {
            node.player = player | PLAYER_TERMINAL_FLAG;
        } else {
            node.player = PLAYER_CHANCE | PLAYER_CHANCE_FLAG;
            node.board_state = next_state;
            
            int next_p = 0;
            for (int i = 0; i < config_.num_players; ++i) {
                if (!info.folded[i] && !info.allin[i]) { next_p = i; break; }
            }

            auto child = std::make_unique<ActionTreeNode>();
            child->amount = node.amount;
            BuildInfo child_info = info;
            child_info.current_bet = 0;
            child_info.num_raises = 0;
            child_info.actions_this_street = 0;
            child_info.invested_this_street.assign(config_.num_players, 0);
            
            build_recursive(*child, next_state, next_p, child_info);
            node.children.push_back(std::move(child));
        }
        return;
    }

    if (info.folded[player] || info.allin[player]) {
        int next_p = (player + 1) % config_.num_players;
        build_recursive(node, state, next_p, info);
        return;
    }

    node.player = (uint8_t)player;
    node.board_state = state;
    push_actions(node, player, state, info);

    int next_p = (player + 1) % config_.num_players;

    for (const Action& act : node.actions) {
        auto child = std::make_unique<ActionTreeNode>();
        BuildInfo child_info = info;
        child_info.actions_this_street++;

        int32_t added_to_pot = 0;

        switch (act.type) {
            case Action::Type::Fold:
                child_info.folded[player] = true;
                child_info.active_players--;
                child->player = (uint8_t)(next_p | PLAYER_FOLD_FLAG); 
                break;
            case Action::Type::Check:
                child->player = (uint8_t)next_p;
                break;
            case Action::Type::Call:
                added_to_pot = act.amount;
                child_info.stacks[player] -= added_to_pot;
                child_info.invested_this_street[player] += added_to_pot;
                if (child_info.stacks[player] == 0) child_info.allin[player] = true;
                child->player = (uint8_t)next_p;
                break;
            case Action::Type::Bet:
            case Action::Type::Raise:
            case Action::Type::AllIn:
                added_to_pot = act.amount - child_info.invested_this_street[player];
                child_info.stacks[player] -= added_to_pot;
                child_info.invested_this_street[player] = act.amount;
                child_info.current_bet = act.amount;
                child_info.num_raises++;
                if (act.type == Action::Type::AllIn || child_info.stacks[player] == 0) {
                    child_info.allin[player] = true;
                }
                child_info.actions_this_street = 1; 
                child->player = (uint8_t)next_p;
                break;
            default: break;
        }

        child->amount = node.amount + added_to_pot;
        child->board_state = state;
        build_recursive(*child, state, next_p, child_info);
        node.children.push_back(std::move(child));
    }
}

void ActionTree::apply_added_lines() {
    for (const auto& line : added_lines_) {
        ActionTreeNode* node = root_.get();
        for (const Action& act : line) {
            auto it = std::find(node->actions.begin(), node->actions.end(), act);
            bool action_existed = (it != node->actions.end());

            if (!action_existed) {
                node->actions.push_back(act);
                auto child = std::make_unique<ActionTreeNode>();
                
                // Multiway aware player assignment
                int current_player = node->player & PLAYER_MASK;
                int next_p = (current_player + 1) % config_.num_players;
                child->player = (uint8_t)next_p;
                
                child->board_state = node->board_state;
                child->amount = node->amount;
                
                BuildInfo info;
                info.stacks.assign(config_.num_players, config_.effective_stack);
                info.invested_this_street.assign(config_.num_players, 0);
                info.folded.assign(config_.num_players, false);
                info.allin.assign(config_.num_players, false);
                info.active_players = config_.num_players;
                info.current_bet = act.amount;
                info.num_raises = (act.type == Action::Type::Bet || act.type == Action::Type::Raise) ? 1 : 0;
                info.actions_this_street = 1;

                build_recursive(*child, child->board_state, child->player, info);
                node->children.push_back(std::move(child));

                size_t n = node->actions.size();
                std::vector<size_t> order(n);
                for (size_t i = 0; i < n; ++i) order[i] = i;
                std::sort(order.begin(), order.end(),
                          [&](size_t a, size_t b) { return node->actions[a] < node->actions[b]; });
                std::vector<Action> new_actions(n);
                std::vector<std::unique_ptr<ActionTreeNode>> new_children(n);
                for (size_t i = 0; i < n; ++i) {
                    new_actions[i] = node->actions[order[i]];
                    new_children[i] = std::move(node->children[order[i]]);
                }
                node->actions = std::move(new_actions);
                node->children = std::move(new_children);

                it = std::find(node->actions.begin(), node->actions.end(), act);
            }

            size_t idx = std::distance(node->actions.begin(), it);
            node = node->children[idx].get();
        }
    }
}

void ActionTree::apply_removed_lines() {
    for (const auto& line : removed_lines_) {
        ActionTreeNode* node = root_.get();
        for (size_t i = 0; i + 1 < line.size(); ++i) {
            const Action& act = line[i];
            auto it = std::find(node->actions.begin(), node->actions.end(), act);
            if (it == node->actions.end()) break;  
            size_t idx = std::distance(node->actions.begin(), it);
            node = node->children[idx].get();
        }
        if (node) {
            const Action& act = line.back();
            auto it = std::find(node->actions.begin(), node->actions.end(), act);
            if (it != node->actions.end()) {
                size_t idx = std::distance(node->actions.begin(), it);
                node->actions.erase(node->actions.begin() + idx);
                node->children.erase(node->children.begin() + idx);
            }
        }
    }
}

std::array<uint64_t, 3> ActionTree::count_num_action_nodes() const {
    std::array<uint64_t, 3> counts = {0, 0, 0};
    std::function<void(const ActionTreeNode&, BoardState)> visit =
        [&](const ActionTreeNode& n, BoardState state) {
        if (n.player >= PLAYER_CHANCE) return;  
        counts[(int)state]++;
        for (const auto& c : n.children) {
            BoardState cs = (n.player == (PLAYER_CHANCE | PLAYER_CHANCE_FLAG))
                          ? n.board_state : state;
            visit(*c, cs);
        }
    };
    visit(*root_, config_.initial_state);
    return counts;
}

uint64_t ActionTree::total_nodes() const {
    uint64_t count = 0;
    std::function<void(const ActionTreeNode&)> visit = [&](const ActionTreeNode& n) {
        count++;
        for (const auto& c : n.children) visit(*c);
    };
    visit(*root_);
    return count;
}

} // namespace postflop
