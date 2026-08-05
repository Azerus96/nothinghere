// ════════════════════════════════════════════════════════════════════════
// action_tree.h — Game tree builder for NLHE postflop
// ════════════════════════════════════════════════════════════════════════
// Port of postflop-solver/src/action_tree.rs
//
// Action enum:
//   Fold, Check, Call, Bet(amount), Raise(amount), AllIn(amount), Chance(card)
//
// Tree building algorithm:
//   1. Start at root with prev_action=None, num_bets=0, allin_flag=false,
//      oop_call_flag=false, stack=[eff_stack, eff_stack].
//   2. For each player node, generate available actions:
//      - Facing bet (num_bets > 0): Fold, Call, raise sizes (unless allin_flag), auto-allin
//      - No bet (num_bets == 0): Check, bet sizes, donk sizes (if OOP just called), auto-allin
//   3. Bet sizes from TreeConfig: pot-relative, prev-bet-relative, additive, geometric, all-in
//   4. Geometric: ratio = ((2·spr+1)^(1/n) - 1)/2, size = ratio · pot
//   5. Merge close bet sizes (PioSOLVER algorithm: keep action iff
//      (100+X)/(100+Y) < 1+threshold).
//   6. Force AllIn if SPR-after-call ≤ force_allin_threshold.
//   7. Recurse for each child with updated stack/flags.
//
// Player flag encoding (u8):
//   bits 0-1: player (0=OOP, 1=IP)
//   bit  2:   chance flag (4)
//   bit  3:   terminal flag (8)
//   bits 3-4: fold flag (24 = 0b11000, "folded player = player & 3")
// ════════════════════════════════════════════════════════════════════════
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

// ── Player flag constants ───────────────────────────────────────────────
constexpr uint8_t PLAYER_OOP           = 0;
constexpr uint8_t PLAYER_IP            = 1;
constexpr uint8_t PLAYER_CHANCE        = 2;
constexpr uint8_t PLAYER_MASK          = 3;
constexpr uint8_t PLAYER_CHANCE_FLAG   = 4;
constexpr uint8_t PLAYER_TERMINAL_FLAG = 8;
constexpr uint8_t PLAYER_FOLD_FLAG     = 24;   // 0b11000

// ── BoardState ──────────────────────────────────────────────────────────
enum class BoardState : uint8_t { Flop = 0, Turn = 1, River = 2 };

// ── Action ──────────────────────────────────────────────────────────────
struct Action {
    enum class Type : uint8_t {
        None, Fold, Check, Call, Bet, Raise, AllIn, Chance
    };
    Type   type = Type::None;
    int32_t amount = 0;   // for Bet/Raise/AllIn
    Card   card = NOT_DEALT;  // for Chance

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

// ── Bet size specifications ─────────────────────────────────────────────
struct BetSize {
    enum class Kind : uint8_t {
        PotRelative, PrevBetRelative, Additive, Geometric, AllIn
    };
    Kind   kind;
    double pot_rel = 0;     // for PotRelative (0.75 = 75% pot)
    double prev_rel = 0;    // for PrevBetRelative (2.5 = 2.5× previous bet)
    int32_t additive_base = 0;   // for Additive (in chips)
    int32_t additive_raise_cap = 0;  // raise cap (1..100)
    int     geometric_streets = 1;  // for Geometric (num streets to all-in)
    double  geometric_max_ratio = 1.0;  // max pot-relative ratio

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
    std::vector<BetSize> bet;     // for first bets (Check or Donk → Bet)
    std::vector<BetSize> raise;   // for raises (facing a bet)
};

struct DonkSizeOptions {
    std::vector<BetSize> donk;    // for OOP donk bets after IP checked back previous street
};

// ── Tree configuration ──────────────────────────────────────────────────
struct TreeConfig {
    BoardState        initial_state = BoardState::Flop;
    int32_t           starting_pot = 0;
    int32_t           effective_stack = 0;
    double            rake_rate = 0;
    double            rake_cap = 0;
    std::array<BetSizeOptions, 2> flop_bet_sizes;   // [OOP, IP]
    std::array<BetSizeOptions, 2> turn_bet_sizes;
    std::array<BetSizeOptions, 2> river_bet_sizes;
    DonkSizeOptions*  turn_donk_sizes = nullptr;
    DonkSizeOptions*  river_donk_sizes = nullptr;
    double            add_allin_threshold = 1.0;
    double            force_allin_threshold = 0.25;
    double            merging_threshold = 0.0;
};

// ── Action tree node ────────────────────────────────────────────────────
struct ActionTreeNode {
    uint8_t  player = PLAYER_OOP;             // 0/1/2 chance, with terminal/fold flags
    BoardState board_state = BoardState::Flop;
    int32_t amount = 0;                        // current total bet in pot
    std::vector<Action> actions;              // available actions
    std::vector<std::unique_ptr<ActionTreeNode>> children;
};

// ── Action tree ─────────────────────────────────────────────────────────
class ActionTree {
public:
    ActionTree(const TreeConfig& cfg,
               std::vector<std::vector<Action>> added_lines = {},
               std::vector<std::vector<Action>> removed_lines = {});

    const ActionTreeNode& root() const { return *root_; }
    ActionTreeNode& root_mut() { return *root_; }

    // Count action nodes per street: [flop, turn, river]
    std::array<uint64_t, 3> count_num_action_nodes() const;

    // Total nodes (including chance + terminal)
    uint64_t total_nodes() const;

private:
    TreeConfig config_;
    std::vector<std::vector<Action>> added_lines_;
    std::vector<std::vector<Action>> removed_lines_;
    std::unique_ptr<ActionTreeNode> root_;

    // Build state passed through recursion
    struct BuildInfo {
        Action prev_action;
        int num_bets = 0;
        bool allin_flag = false;
        bool oop_call_flag = false;
        std::array<int32_t, 2> stack;
        int32_t prev_amount = 0;
    };

    void build_recursive(ActionTreeNode& node, BoardState state, int player, BuildInfo info);
    void push_actions(ActionTreeNode& node, int player, BoardState state, BuildInfo& info);

    // Compute a bet size to a specific amount
    int32_t compute_bet_size(const BetSize& bs, int32_t pot, int32_t prev_amount,
                             int32_t to_call, int32_t opp_stack, int32_t my_stack,
                             int num_bets) const;

    // Merge close bet sizes (PioSOLVER algorithm)
    void merge_bet_actions(std::vector<Action>& actions, int32_t pot,
                          int32_t prev_amount, double threshold) const;

    // Apply added_lines / removed_lines
    void apply_added_lines();
    void apply_removed_lines();
};

} // namespace postflop

#endif // ACTION_TREE_H
