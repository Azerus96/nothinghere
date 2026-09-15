// ════════════════════════════════════════════════════════════════════════
// anchor_format.h — [Module 6.2, V8] MTT preflop anchor binary format
// ════════════════════════════════════════════════════════════════════════
// preflop_anchors_mtt.bin layout (zero-copy mmap friendly):
//
//   AnchorFileHeader (24 bytes, packed):
//     magic "MTTA" | version 1 | num_stacks | num_positions = 8
//     (UTG, UTG+1, MP, LJ, HJ, CO, BTN, SB) | num_classes = 169
//     actions_count = 4 (Fold, Call, Raise, AllIn) | tensor_offset
//
//   uint8 tensor at tensor_offset:
//     data[stack_idx][pos_idx][class_idx][action_idx], 0..255 <-> 0.0..1.0
//
// SPEC NOTE: the V8 text says "26 points" but enumerates 27 stack depths;
// the enumerated list is authoritative (num_stacks = 27 is written and the
// loader reads the field dynamically — both stay forward-compatible).
//
// Shared by tools/gen_mtt_anchors.cpp (writer) and the PreflopAnchorManager
// in src/live_solver.cpp (mmap reader) so the layout can never drift.
// ════════════════════════════════════════════════════════════════════════
#ifndef ANCHOR_FORMAT_H
#define ANCHOR_FORMAT_H

#include <cstdint>
#include <cstddef>
#include <array>

namespace postflop::anchor {

#pragma pack(push, 1)
struct AnchorFileHeader {
    char     magic[4];          // "MTTA"
    uint32_t version;           // 1
    uint32_t num_stacks;        // 27 (see SPEC NOTE above)
    uint32_t num_positions;     // 8 (UTG, UTG+1, MP, LJ, HJ, CO, BTN, SB)
    uint32_t num_classes;       // 169
    uint32_t actions_count;     // 4 (Fold, Call, Raise, AllIn)
    uint64_t tensor_offset;     // Byte offset where raw probability tensors begin
};
#pragma pack(pop)

constexpr uint32_t NUM_POSITIONS = 8;
constexpr uint32_t NUM_ACTIONS   = 4;

inline const std::array<const char*, NUM_POSITIONS> POSITION_NAMES = {{
    "UTG", "UTG+1", "MP", "LJ", "HJ", "CO", "BTN", "SB"
}};
inline const std::array<const char*, NUM_ACTIONS> ACTION_NAMES = {{
    "Fold", "Call", "Raise", "AllIn"
}};

// The 27 enumerated stack depths (bb), ascending (the interpolation grid).
inline const std::array<int, 27> STACK_GRID = {{
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    17, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100, 130
}};

// Linear index into the tensor for (stack, pos, class, action).
inline size_t tensor_index(size_t num_stacks, size_t num_positions, size_t num_classes,
                           size_t s, size_t p, size_t c, size_t a) {
    return (((s * num_positions) + p) * num_classes + c) * NUM_ACTIONS + a;
}

} // namespace postflop::anchor

#endif // ANCHOR_FORMAT_H
