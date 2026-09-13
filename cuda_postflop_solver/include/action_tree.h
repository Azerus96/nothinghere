#ifndef ACTION_TREE_H
#define ACTION_TREE_H

#include <cstdint>
#include <vector>
#include <string>
#include <memory>
#include <array>
#include "cuda_compat.h"
#include "card.h"

namespace postflop {

constexpr uint8_t PLAYER_OOP           = 0;
constexpr uint8_t PLAYER_IP            = 1;
constexpr uint8_t PLAYER_MASK          = 7;
constexpr uint8_t PLAYER_CHANCE_FLAG   = 8;
constexpr uint8_t PLAYER_TERMINAL_FLAG = 16;
constexpr uint8_t PLAYER_FOLD_FLAG     = 32;

// PLAYER_CHANCE is an alias of PLAYER_CHANCE_FLAG (bit 8 only, no collision
// with terminal/fold flags — historical note: the old value 254 contained
// both PLAYER_TERMINAL_FLAG and PLAYER_FOLD_FLAG bits, which made
// is_terminal() return true for chance nodes and broke flop→turn reach
// propagation in the GPU down/up passes).
constexpr uint8_t PLAYER_CHANCE        = PLAYER_CHANCE_FLAG;

enum class BoardState : uint8_t { Flop = 0, Turn = 1, River = 2 };

struct Action {
    enum class Type : uint8_t {
        None = 0, Fold = 1, Check = 2, Call = 3, Bet = 4, Raise = 5, AllIn = 6, Chance = 7
    };
    Type   type = Type::None;
    int32_t amount = 0;
    Card   card = NOT_DEALT;

    bool operator==(const Action& o) const {
        if (type != o.type) return false;
        if (type == Type::Bet || type == Type::Raise || type == Type::AllIn)
            return amount == o.amount;
        if (type == Type::Chance) return card == o.card;
        return true;
    }
    bool operator!=(const Action& o) const { return !(*this == o); }
    bool operator<(const Action& o) const {
        if (type != o.type) return (uint8_t)type < (uint8_t)o.type;
        if (type == Type::Bet || type == Type::Raise || type == Type::AllIn)
            return amount < o.amount;
        if (type == Type::Chance) return card < o.card;
        return false;
    }

    std::string to_string() const {
        switch (type) {
            case Action::Type::None:   return "None";
            case Action::Type::Fold:   return "F";
            case Action::Type::Check:  return "X";
            case Action::Type::Call:   return "C";
            case Action::Type::Bet:    return "B" + std::to_string(amount);
            case Action::Type::Raise:  return "R" + std::to_string(amount);
            case Action::Type::AllIn:  return "A" + std::to_string(amount);
            case Action::Type::Chance: return "Chance(" + card_to_string(card) + ")";
        }
        return "?";
    }
};

struct BetSize {
    enum class Kind : uint8_t {
        PotRelative, PrevBetRelative, Additive, Geometric, AllIn
    };
    Kind   kind;
    double pot_rel = 0;
    double prev_rel = 0;
    int32_t additive_base = 0;
    int32_t additive_raise_cap = 0;
    int     geometric_streets = 1;
    double  geometric_max_ratio = 1.0;

    static BetSize PotRelative(double r) {
        BetSize b; b.kind = Kind::PotRelative; b.pot_rel = r; return b;
    }
    static BetSize PrevRelative(double r) {
        BetSize b; b.kind = Kind::PrevBetRelative; b.prev_rel = r; return b;
    }
    static BetSize Additive(int32_t base, int32_t cap) {
        BetSize b; b.kind = Kind::Additive; b.additive_base = base; b.additive_raise_cap = cap; return b;
    }
    static BetSize Geometric(int n, double max_ratio) {
        BetSize b; b.kind = Kind::Geometric; b.geometric_streets = n; b.geometric_max_ratio = max_ratio; return b;
    }
    static BetSize AllIn() {
        BetSize b; b.kind = Kind::AllIn; return b;
    }
};

struct BetSizeOptions {
    std::vector<BetSize> bet;
    std::vector<BetSize> raise;
};

struct DonkSizeOptions {
    std::vector<BetSize> donk;
};

struct TreeConfig {
    int               num_players = 2;
    BoardState        initial_state = BoardState::Flop;
    int32_t           starting_pot = 0;
    int32_t           effective_stack = 0;
    double            rake_rate = 0;
    double            rake_cap = 0;
    std::array<BetSizeOptions, 6> flop_bet_sizes;
    std::array<BetSizeOptions, 6> turn_bet_sizes;
    std::array<BetSizeOptions, 6> river_bet_sizes;
    DonkSizeOptions*  turn_donk_sizes = nullptr;
    DonkSizeOptions*  river_donk_sizes = nullptr;
    double            add_allin_threshold = 1.0;
    double            force_allin_threshold = 0.25;
    double            merging_threshold = 0.0;

    // ── Section 2 (Two-Tier Architecture) ─────────────────────────────────
    // Maximum number of streets the tree may span, counted from
    // initial_state. 1 = current street only (Tier 2 multiway rollout
    // leaves); <= 0 or >= 3 = unrestricted full expansion (Tier 1 HU).
    // ActionTree::ActionTree auto-forces max_depth = 1 when num_players >= 3
    // unless explicitly overridden afterwards.
    int32_t           max_depth = 3;

    // ── Module 3.3 (Pseudo-Harmonic Action Translation) ───────────────────
    // Exact off-grid bet sizes (in chips) injected verbatim into decision
    // nodes when the observed live size deviates from the configured grid by
    // pseudo_harmonic_distance > 0.15. Populated by the caller (live_solver
    // / live_bridge) — see bet_translation.h.
    std::vector<int32_t> custom_injected_bets;

    // Board cards known at tree-build time (used by chance expansion to
    // enumerate only genuinely dealable runout cards, and by custom bet
    // injection to skip cards already dealt). Cards beyond the dealt prefix
    // must be NOT_DEALT.
    Card              board[5] = {NOT_DEALT, NOT_DEALT, NOT_DEALT, NOT_DEALT, NOT_DEALT};

    // ── Defect 1.8 ────────────────────────────────────────────────────────
    // Per-player chips already invested BEFORE the postflop subtree starts
    // (blinds / preflop contributions). Their sum should equal starting_pot;
    // entries <= -1 request an equal split (default convention).
    std::array<int32_t, 6> initial_invested = {-1, -1, -1, -1, -1, -1};
};

struct ActionTreeNode {
    uint8_t  player = 0;
    BoardState board_state = BoardState::Flop;
    int32_t amount = 0;                        // chips added to the pot WITHIN the current street at this point
    uint8_t active_mask = 0;
    std::vector<Action> actions;               // for chance nodes: Chance actions carrying the dealt card
    std::vector<std::unique_ptr<ActionTreeNode>> children;

    // ── Defect 1.8: exact chip bookkeeping ───────────────────────────────
    int32_t total_pot = 0;                     // full pot including starting pot and all streets
    int32_t invested[6] = {0, 0, 0, 0, 0, 0};  // cumulative per-player investment (incl. preflop share)
};

class ActionTree {
public:
    ActionTree(const TreeConfig& cfg,
               std::vector<std::vector<Action>> added_lines = {},
               std::vector<std::vector<Action>> removed_lines = {});

    const ActionTreeNode& root() const { return *root_; }
    ActionTreeNode& root_mut() { return *root_; }

    // Effective (post-routing) tree configuration: max_depth is forced to 1
    // for 3+ players (Section 2 two-tier routing).
    const TreeConfig& effective_config() const { return config_; }

    std::array<uint64_t, 3> count_num_action_nodes() const;
    uint64_t total_nodes() const;

    // True when the tree spans more than one street (Tier 1 semantics).
    bool is_full_depth() const { return config_.max_depth > 1; }

private:
    TreeConfig config_;
    std::vector<std::vector<Action>> added_lines_;
    std::vector<std::vector<Action>> removed_lines_;
    std::unique_ptr<ActionTreeNode> root_;

    struct BuildInfo {
        std::vector<int32_t> stacks;
        std::vector<int32_t> invested_this_street;
        std::vector<bool> folded;
        std::vector<bool> allin;
        int active_players = 0;
        int32_t current_bet = 0;
        int num_raises = 0;
        int actions_this_street = 0;
        // Board context of the CURRENT path (cards dealt through chance
        // expansion so far); used for runout enumeration exclusion.
        Card ctx_turn = NOT_DEALT;
        Card ctx_river = NOT_DEALT;
    };

    void build_recursive(ActionTreeNode& node, BoardState state, int player, BuildInfo info);
    void push_actions(ActionTreeNode& node, int player, BoardState state, BuildInfo& info);

    int32_t compute_bet_size(const BetSize& bs, int32_t pot, int32_t current_bet,
                             int32_t to_call, int32_t my_stack) const;

    void merge_bet_actions(std::vector<Action>& actions, int32_t pot,
                          int32_t prev_amount, double threshold) const;

    void apply_added_lines();
    void apply_removed_lines();

    // Section 2 routing: chance expansion (Tier 1) vs depth-capped rollout
    // leaf (Tier 2). Returns the set of chance actions for a street
    // transition whose target street card is unknown (NOT_DEALT), or a
    // single known-card action when the card is given. `ctx_turn` is the
    // turn card effective on the current path (config board or chance-dealt).
    std::vector<Action> enumerate_chance_actions(BoardState target_state, Card ctx_turn) const;

    // Defect 1.8: seed root investments from TreeConfig::initial_invested
    // (equal split fallback).
    void seed_root_invested();
};

} // namespace postflop

#endif // ACTION_TREE_H
