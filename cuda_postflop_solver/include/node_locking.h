// ════════════════════════════════════════════════════════════════════════
// node_locking.h — Defect 1.5: semantic opponent-profile node locking
// ════════════════════════════════════════════════════════════════════════
// Locking probabilities are bound STRICTLY to the semantic Action::Type
// (never to the action index). At unopened pots (to_call == 0) the sorted
// action order is [Check, Bet, ...], so the legacy index-based mapping made
// a passive Calling Station bet 85% of its range when checked to.
//
// Profile semantics (fixed caps; passive actions absorb the residual mass
// so every distribution sums to exactly 1 on any action set):
//   CALLING_STATION : Fold 0.10 | Bet/Raise/AllIn 0.05 each | Check/Call rest
//   OVERFOLDER      : Fold/Check 0.85 (single passive anchor) | rest split
//   MANIAC          : Bet/Raise/AllIn share 0.75 | rest split
// ════════════════════════════════════════════════════════════════════════
#ifndef NODE_LOCKING_H
#define NODE_LOCKING_H

#include <cstdint>
#include "game.h"

namespace postflop {

enum class OpponentProfile : uint8_t {
    GTO = 0,
    OVERFOLDER = 1,
    CALLING_STATION = 2,
    MANIAC = 3
};

// Writes the profile distribution into the strategy-sum and regret arenas of
// every decision node owned by `player_idx`, such that regret_matching
// reproduces exactly this distribution and the frozen update path (both CPU
// and GPU honor the lock mask) preserves it.
void apply_node_locking_profile(PostFlopGame& game, int player_idx, OpponentProfile profile);

// ── [Module 5, V8] Dynamic HUD node-locking ───────────────────────────────
// Replaces the static three-profile enumeration with CONTINUOUS empirical
// action frequencies (the reference payload is a HUD row such as
// fold 0.72 / call 0.20 / raise 0.08 aggregated from observed hands).
//
// Semantics (regression-tested by tests/test_regression_dynamic_locking.cpp):
//   * Targets bind to the SEMANTIC Action::Type, never the action index.
//   * Unspecified actions (< 0) receive zero mass — EXCEPT the passive
//     anchors (Check / Call), which absorb the residual
//       residual = 1 - sum(specified targets of actions PRESENT at the node)
//     so every distribution sums to exactly 1.0 on any action set (an
//     unopened [Check, Bet, AllIn] node with no specified targets locks
//     Check at 1.0; a specified-but-absent type's mass joins the residual).
//   * Over-constrained payloads (sum > 1) renormalize proportionally
//     (fold 0.9 + call 0.9 -> 0.5 / 0.5).
//   * A payload with no specified field, or player_idx outside
//     [0, num_players), is a no-op and leaves locked_players_mask untouched.
struct DynamicActionLock {
    int   player_idx = -1;
    float fold  = -1.0f;
    float check = -1.0f;
    float call  = -1.0f;
    float bet   = -1.0f;
    float raise = -1.0f;
    float allin = -1.0f;

    // Target mass for a semantic Action::Type (as uint8_t); -1 = unspecified.
    float target_for(uint8_t action_type) const {
        switch ((Action::Type)action_type) {
            case Action::Type::Fold:   return fold;
            case Action::Type::Check:  return check;
            case Action::Type::Call:   return call;
            case Action::Type::Bet:    return bet;
            case Action::Type::Raise:  return raise;
            case Action::Type::AllIn:  return allin;
            default:                   return -1.0f;   // None / Chance
        }
    }

    bool any_specified() const {
        return fold >= 0.0f || check >= 0.0f || call >= 0.0f ||
               bet  >= 0.0f || raise >= 0.0f || allin >= 0.0f;
    }
};

// Applies the empirical frequency lock: writes the derived distribution into
// every decision node owned by lock.player_idx (regret_matching then
// reproduces it exactly; both solve paths freeze it via the lock mask) and
// sets the player's bit in game.locked_players_mask(). No-op for payloads
// that constrain nothing.
void apply_dynamic_node_lock(PostFlopGame& game, const DynamicActionLock& lock);

// Utility for tests: the locked strategy implied by regret_matching over the
// node's regret arena (row per action, num_hands columns, normalized).
std::vector<std::vector<float>> locked_strategy_at_node(const PostFlopGame& game,
                                                        int node_idx, int player_idx);

} // namespace postflop

#endif // NODE_LOCKING_H
