#ifndef ANCHOR_FORMAT_H
#define ANCHOR_FORMAT_H

#include <cstdint>
#include <cstddef>
#include <array>

namespace postflop::anchor {

// Ситуации за префлоп-столом 8-max
enum class PreflopContext : uint8_t {
    Unopened    = 0, // Первый ход (Open-Raise / Fold / Jam)
    FacingOpen  = 1, // Против опен-рейза (Fold / Call / 3-Bet / 3-Bet Jam)
    Facing3Bet  = 2, // Опенер против 3-бета (Fold / Call / 4-Bet / 4-Bet Jam)
    FacingJam   = 3, // Против прямого пуша (Fold / Call)
    SqueezeSpot = 4  // Сквиз-пот (был опен и один или два колла)
};

constexpr uint32_t NUM_POSITIONS = 8;
constexpr uint32_t NUM_ACTIONS   = 4; // Fold, Call, Raise/3Bet, AllIn
constexpr uint32_t NUM_CONTEXTS  = 5;
constexpr uint32_t NUM_COMBOS    = 1326;

inline const std::array<const char*, NUM_POSITIONS> POSITION_NAMES = {{
    "UTG", "UTG+1", "MP", "LJ", "HJ", "CO", "BTN", "SB"
}};

inline const std::array<const char*, NUM_ACTIONS> ACTION_NAMES = {{
    "Fold", "Call", "Raise", "AllIn"
}};

inline const std::array<int, 27> STACK_GRID = {{
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    17, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100, 130
}};

#pragma pack(push, 1)
struct AnchorFileHeaderV2 {
    char     magic[4];          // "MTTV"
    uint32_t version;           // 2
    uint32_t num_stacks;        // 27
    uint32_t num_positions;     // 8
    uint32_t num_contexts;      // 5
    uint32_t num_combos;        // 1326
    uint32_t actions_count;     // 4
    uint32_t has_regrets;       // 1 (содержит вектор кумулятивных регретов)
    uint64_t tensor_offset;     // Смещение до данных (64 байта)
    uint8_t  reserved[24];
};
#pragma pack(pop)

// Линейный индекс для матрицы стратегий и регретов
inline size_t tensor_index_v2(size_t s, size_t p, size_t ctx, size_t combo, size_t a) {
    return ((((s * NUM_POSITIONS + p) * NUM_CONTEXTS + ctx) * NUM_COMBOS + combo) * NUM_ACTIONS) + a;
}

} // namespace postflop::anchor

#endif // ANCHOR_FORMAT_H
