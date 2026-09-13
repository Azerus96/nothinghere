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

// Utility for tests: the locked strategy implied by regret_matching over the
// node's regret arena (row per action, num_hands columns, normalized).
std::vector<std::vector<float>> locked_strategy_at_node(const PostFlopGame& game,
                                                        int node_idx, int player_idx);

} // namespace postflop

#endif // NODE_LOCKING_H
