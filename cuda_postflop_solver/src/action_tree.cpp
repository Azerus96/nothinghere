// ════════════════════════════════════════════════════════════════════════
// action_tree.cpp — Action tree builder implementation
// ════════════════════════════════════════════════════════════════════════
#include "action_tree.h"
#include <algorithm>
#include <stdexcept>
#include <cmath>
#include <set>
#include <functional>

namespace postflop {

// ── Helper: parse bet size string like "60%, e, a" or "2.5x" ────────────
// Used by TreeConfig parsing. Returns vector of BetSize.
static std::vector<BetSize> parse_bet_size_list(const std::string& s, bool is_raise) {
    std::vector<BetSize> result;
    std::string token;
    size_t i = 0;
    while (i <= s.size()) {
        if (i == s.size() || s[i] == ',') {
            // Process token
            // Trim
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
                    // Geometric: "e" or "2e" or "3e200%"
                    int n = 1;
                    double max_ratio = 1e9;
                    size_t e_pos = t.find_first_of("eE");
                    std::string before = t.substr(0, e_pos);
                    std::string after = t.substr(e_pos + 1);
                    if (!before.empty()) n = std::stoi(before);
                    if (!after.empty()) {
                        if (after.back() == '%') {
                            max_ratio = std::stod(after.substr(0, after.size() - 1)) / 100.0;
                        }
                    }
                    result.push_back(BetSize::Geometric(n, max_ratio));
                } else if (t.find('c') != std::string::npos) {
                    // Additive: "100c" or "20c3r"
                    size_t c_pos = t.find('c');
                    int32_t base = std::stoi(t.substr(0, c_pos));
                    int32_t cap = 100;
                    size_t r_pos = t.find('r');
                    if (r_pos != std::string::npos) {
                        cap = std::stoi(t.substr(r_pos + 1));
                    }
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

// ── ActionTree constructor ──────────────────────────────────────────────
ActionTree::ActionTree(const TreeConfig& cfg,
                       std::vector<std::vector<Action>> added_lines,
                       std::vector<std::vector<Action>> removed_lines)
    : config_(cfg), added_lines_(std::move(added_lines)),
      removed_lines_(std::move(removed_lines))
{
    root_ = std::make_unique<ActionTreeNode>();
    root_->player = PLAYER_OOP;
    root_->board_state = cfg.initial_state;
    root_->amount = 0;

    BuildInfo info;
    info.stack = {cfg.effective_stack, cfg.effective_stack};
    info.prev_action = {Action::Type::None, 0, NOT_DEALT};
    build_recursive(*root_, cfg.initial_state, PLAYER_OOP, info);

    if (!added_lines_.empty())   apply_added_lines();
    if (!removed_lines_.empty()) apply_removed_lines();
}

// ── Build: generate available actions for a node ──────────────────────
void ActionTree::push_actions(ActionTreeNode& node, int player, BoardState state, BuildInfo& info) {
    const auto& bet_options = (state == BoardState::Flop) ? config_.flop_bet_sizes[player]
                              : (state == BoardState::Turn) ? config_.turn_bet_sizes[player]
                              : config_.river_bet_sizes[player];

    int32_t pot = config_.starting_pot + 2 * node.amount;
    int32_t to_call = 0;
    int32_t prev_amount = info.prev_amount;
    int32_t opp_stack = info.stack[1 - player];
    int32_t my_stack = info.stack[player];
    int32_t max_amount = opp_stack + prev_amount;

    // Compute to_call: if facing a bet, it's (prev_amount - my_bet_in_this_round)
    // We track amount = total in pot per player; to_call = (prev_amount - 0) for first caller
    // In our simplified model: if num_bets > 0, to_call = prev_amount (we need to match it)
    if (info.num_bets > 0) {
        to_call = prev_amount;  // simplified
    }

    if (info.num_bets > 0 && !info.allin_flag) {
        // Facing a bet: Fold, Call, raise sizes, auto-allin
        node.actions.push_back({Action::Type::Fold, 0, NOT_DEALT});
        node.actions.push_back({Action::Type::Call, 0, NOT_DEALT});

        for (const auto& bs : bet_options.raise) {
            int32_t amt = compute_bet_size(bs, pot, prev_amount, to_call,
                                          opp_stack, my_stack, info.num_bets);
            if (amt > prev_amount && amt <= max_amount) {
                // Check if SPR after call ≤ force_allin_threshold
                int32_t remaining_after = my_stack - (amt - prev_amount + to_call);
                int32_t pot_after = pot + 2 * (amt - prev_amount) + to_call;
                if (pot_after > 0 && (double)remaining_after / pot_after <= config_.force_allin_threshold) {
                    node.actions.push_back({Action::Type::AllIn, max_amount, NOT_DEALT});
                } else {
                    node.actions.push_back({Action::Type::Raise, amt, NOT_DEALT});
                }
            }
        }
        // Auto-allin
        int32_t remaining_after_call = my_stack - to_call;
        if (remaining_after_call > 0 && remaining_after_call < opp_stack) {
            double spr = (pot > 0) ? (double)remaining_after_call / pot : 0;
            if (spr <= config_.add_allin_threshold) {
                node.actions.push_back({Action::Type::AllIn, max_amount, NOT_DEALT});
            }
        }
    } else if (info.num_bets == 0) {
        // No bet: Check, bet sizes, donk (if applicable), auto-allin
        node.actions.push_back({Action::Type::Check, 0, NOT_DEALT});

        bool is_donk = (player == PLAYER_OOP) && info.oop_call_flag
                     && (state == BoardState::Turn ? config_.turn_donk_sizes != nullptr
                                                   : config_.river_donk_sizes != nullptr);
        const std::vector<BetSize>* sizes = is_donk
            ? &((state == BoardState::Turn ? config_.turn_donk_sizes : config_.river_donk_sizes)->donk)
            : &bet_options.bet;

        for (const auto& bs : *sizes) {
            if (bs.kind == BetSize::Kind::AllIn) {
                node.actions.push_back({Action::Type::AllIn, max_amount, NOT_DEALT});
                continue;
            }
            int32_t amt = compute_bet_size(bs, pot, 0, 0, opp_stack, my_stack, 0);
            if (amt > 0 && amt <= my_stack) {
                int32_t remaining_after = my_stack - amt;
                int32_t pot_after = pot + 2 * amt;
                if (pot_after > 0 && (double)remaining_after / pot_after <= config_.force_allin_threshold) {
                    node.actions.push_back({Action::Type::AllIn, max_amount, NOT_DEALT});
                } else {
                    node.actions.push_back({Action::Type::Bet, amt, NOT_DEALT});
                }
            }
        }
    }

    // Sort and dedup
    std::sort(node.actions.begin(), node.actions.end());
    node.actions.erase(std::unique(node.actions.begin(), node.actions.end()), node.actions.end());

    // Merge close bet sizes (PioSOLVER algorithm)
    if (config_.merging_threshold > 0 && info.num_bets == 0) {
        merge_bet_actions(node.actions, pot, prev_amount, config_.merging_threshold);
    }
}

// ── Compute bet size from BetSize spec ─────────────────────────────────
int32_t ActionTree::compute_bet_size(const BetSize& bs, int32_t pot, int32_t prev_amount,
                                     int32_t to_call, int32_t opp_stack, int32_t my_stack,
                                     int num_bets) const {
    switch (bs.kind) {
        case BetSize::Kind::PotRelative:
            return std::max(1, std::min((int32_t)(bs.pot_rel * pot), my_stack));
        case BetSize::Kind::PrevBetRelative: {
            int32_t base = prev_amount + to_call;
            return std::max(1, std::min((int32_t)(base * bs.prev_rel), opp_stack + prev_amount));
        }
        case BetSize::Kind::Additive:
            return std::max(1, std::min(bs.additive_base, my_stack));
        case BetSize::Kind::Geometric: {
            // ratio = ((2·spr+1)^(1/n) - 1)/2, size = ratio · pot
            double spr = (pot > 0) ? (double)my_stack / pot : 0;
            double ratio = (std::pow(2.0 * spr + 1.0, 1.0 / bs.geometric_streets) - 1.0) / 2.0;
            ratio = std::min(ratio, bs.geometric_max_ratio);
            return std::max(1, std::min((int32_t)(ratio * pot), my_stack));
        }
        case BetSize::Kind::AllIn:
            return my_stack;
    }
    return 0;
}

// ── Merge close bet sizes ──────────────────────────────────────────────
void ActionTree::merge_bet_actions(std::vector<Action>& actions, int32_t pot,
                                   int32_t prev_amount, double threshold) const {
    if (actions.size() < 2) return;
    std::vector<Action> result;
    // Walk from largest to smallest
    for (int i = (int)actions.size() - 1; i >= 0; --i) {
        if (result.empty()) {
            result.push_back(actions[i]);
            continue;
        }
        // Compare actions[i] (smaller) vs result.back() (larger)
        const Action& cur = result.back();
        const Action& cand = actions[i];
        if (cand.type != cur.type) {
            result.push_back(cand);
            continue;
        }
        // Both are Bet or Raise with amounts
        int32_t cur_amt = cur.amount - prev_amount;
        int32_t cand_amt = cand.amount - prev_amount;
        double cur_ratio = (pot > 0) ? (double)cur_amt / pot : 0;
        double cand_ratio = (pot > 0) ? (double)cand_amt / pot : 0;
        // Keep cand iff (cur_ratio - threshold) / (1 + threshold) < cand_ratio
        // i.e., cand is "different enough" from cur
        if ((cur_ratio - threshold) / (1 + threshold) < cand_ratio) {
            result.push_back(cand);
        }
        // else: skip cand (merged into cur)
    }
    std::reverse(result.begin(), result.end());
    actions = result;
}

// ── Recursive build ────────────────────────────────────────────────────
void ActionTree::build_recursive(ActionTreeNode& node, BoardState state, int player, BuildInfo info) {
    if (state > config_.initial_state && (int)state > 2) return;  // past river
    if (info.allin_flag) {
        // After all-in, terminal
        node.player = player | PLAYER_TERMINAL_FLAG;
        return;
    }

    node.player = (uint8_t)player;
    node.board_state = state;
    push_actions(node, player, state, info);

    // For each action, create child
    node.children.reserve(node.actions.size());
    for (const Action& act : node.actions) {
        auto child = std::make_unique<ActionTreeNode>();
        child->amount = node.amount;
        BuildInfo child_info = info;

        switch (act.type) {
            case Action::Type::Fold: {
                child->player = (uint8_t)(player | PLAYER_FOLD_FLAG | PLAYER_TERMINAL_FLAG);
                child->board_state = state;
                child->amount = node.amount;
                break;
            }
            case Action::Type::Check: {
                // If OOP checks → IP acts. If IP checks → next street or terminal.
                child_info.oop_call_flag = false;
                if (player == PLAYER_IP) {
                    // Check-check: next street or showdown
                    BoardState next_state = (BoardState)((int)state + 1);
                    if ((int)next_state > 2) {
                        // River check → terminal showdown
                        child->player = (uint8_t)(player | PLAYER_TERMINAL_FLAG);
                    } else {
                        // Chance node → next street
                        child->player = PLAYER_CHANCE | PLAYER_CHANCE_FLAG;
                        child->board_state = next_state;
                    }
                } else {
                    // OOP checks → IP acts
                    child->player = PLAYER_IP;
                    child->board_state = state;
                    child_info.prev_action = act;
                    build_recursive(*child, state, PLAYER_IP, child_info);
                }
                break;
            }
            case Action::Type::Call: {
                child_info.num_bets = 0;
                child_info.oop_call_flag = (player == PLAYER_OOP);
                child_info.prev_amount = 0;
                // Equalize stacks: caller matches prev_amount
                child_info.stack[player] -= info.prev_amount;
                // Next street or terminal
                BoardState next_state = (BoardState)((int)state + 1);
                if ((int)next_state > 2) {
                    child->player = (uint8_t)(player | PLAYER_TERMINAL_FLAG);
                } else {
                    child->player = PLAYER_CHANCE | PLAYER_CHANCE_FLAG;
                    child->board_state = next_state;
                }
                child->amount = node.amount + info.prev_amount;
                break;
            }
            case Action::Type::Bet:
            case Action::Type::Raise:
            case Action::Type::AllIn: {
                child_info.num_bets += 1;
                child_info.allin_flag = (act.type == Action::Type::AllIn);
                int32_t delta = act.amount - info.prev_amount;
                child_info.stack[player] -= delta;
                child_info.prev_amount = act.amount;
                child_info.prev_action = act;
                child->amount = node.amount + act.amount - info.prev_amount;
                child->player = (uint8_t)(1 - player);
                child->board_state = state;
                if (!child_info.allin_flag) {
                    build_recursive(*child, state, 1 - player, child_info);
                } else {
                    child->player = (uint8_t)((1 - player) | PLAYER_TERMINAL_FLAG);
                }
                break;
            }
            case Action::Type::Chance: {
                // Chance node child: dealing a specific card
                BoardState next_state = (BoardState)((int)state + 1);
                child->player = (uint8_t)(1 - player);  // Next to act after chance
                child->board_state = state;
                child->amount = node.amount;
                BuildInfo chance_info = info;
                chance_info.num_bets = 0;
                chance_info.prev_amount = 0;
                build_recursive(*child, state, 1 - player, chance_info);
                break;
            }
            default:
                break;
        }
        node.children.push_back(std::move(child));
    }
}

// ── Apply added_lines / removed_lines ──────────────────────────────────
// Walk tree per added/removed line, modify children accordingly.
//
// V5 FIX (BUG #2): V4 used node->children.back().get() after sorting,
// which pointed to the WRONG child (sorting rearranges the order).
// V5 tracks the newly added child by finding it by action AFTER sorting.
void ActionTree::apply_added_lines() {
    for (const auto& line : added_lines_) {
        // Walk from root, follow each action in line.
        // If at some point the action isn't in node.actions, add it (and its subtree).
        ActionTreeNode* node = root_.get();
        for (const Action& act : line) {
            // First check if action already exists (BEFORE adding)
            auto it = std::find(node->actions.begin(), node->actions.end(), act);
            bool action_existed = (it != node->actions.end());

            if (!action_existed) {
                // Add this action + child subtree
                node->actions.push_back(act);
                auto child = std::make_unique<ActionTreeNode>();
                child->player = (uint8_t)(1 - (node->player & PLAYER_MASK));
                child->board_state = node->board_state;
                child->amount = node->amount;
                BuildInfo info;
                info.stack = {config_.effective_stack, config_.effective_stack};
                info.prev_action = act;
                info.prev_amount = act.amount;
                info.num_bets = (act.type == Action::Type::Bet || act.type == Action::Type::Raise) ? 1 : 0;
                info.allin_flag = (act.type == Action::Type::AllIn);
                if (act.type == Action::Type::Call) {
                    info.num_bets = 0;
                    info.oop_call_flag = ((node->player & PLAYER_MASK) == PLAYER_OOP);
                }
                build_recursive(*child, child->board_state, child->player, info);
                node->children.push_back(std::move(child));

                // Sort actions and children TOGETHER (keep them in sync)
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

                // V5 FIX: Find the newly added child by its action AFTER sorting.
                // Do NOT use .back() — sorting may have moved it to any position.
                it = std::find(node->actions.begin(), node->actions.end(), act);
            }

            // Move to the child corresponding to `act`
            size_t idx = std::distance(node->actions.begin(), it);
            node = node->children[idx].get();
        }
    }
}

void ActionTree::apply_removed_lines() {
    for (const auto& line : removed_lines_) {
        // Walk to the parent of the last action, then remove that child
        ActionTreeNode* node = root_.get();
        for (size_t i = 0; i + 1 < line.size(); ++i) {
            const Action& act = line[i];
            auto it = std::find(node->actions.begin(), node->actions.end(), act);
            if (it == node->actions.end()) break;  // line doesn't exist
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

// ── Count action nodes per street ──────────────────────────────────────
std::array<uint64_t, 3> ActionTree::count_num_action_nodes() const {
    std::array<uint64_t, 3> counts = {0, 0, 0};
    std::function<void(const ActionTreeNode&, BoardState)> visit =
        [&](const ActionTreeNode& n, BoardState state) {
        if (n.player >= PLAYER_CHANCE) return;  // skip chance/terminal
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
