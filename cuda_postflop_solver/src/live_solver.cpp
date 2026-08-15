#include <iostream>
#include <vector>
#include <string>
#include <cstring>
#include <memory>
#include <iomanip>

#ifdef CUDA_BUILD
#include <cuda_runtime.h>
#endif

#include "game.h"
#include "solver.h"
#include "gpu_solver.h"
#include "card.h"
#include "range.h"
#include "action_tree.h"

using namespace postflop;

enum class OpponentProfile : uint8_t {
    GTO = 0,
    OVERFOLDER = 1,
    CALLING_STATION = 2,
    MANIAC = 3
};

// 100% математически точная инжекция эксплуатационных профилей в память CUDA
void apply_node_locking_profile(PostFlopGame& game, int player_idx, OpponentProfile profile) {
    if (profile == OpponentProfile::GTO) return;

    auto& arena = const_cast<std::vector<PostFlopNode>&>(game.node_arena());
    float* storage1 = game.storage1_data_mut();
    float* storage2 = game.storage2_data_mut();
    int nh = game.num_private_hands(player_idx);

    for (auto& node : arena) {
        if (node.is_terminal() || node.is_chance()) continue;
        if (node.get_player() != player_idx) continue;

        int na = node.num_actions();
        if (na < 2) continue;

        for (int a = 0; a < na; ++a) {
            float strat_val = 1.0f / na;

            if (profile == OpponentProfile::OVERFOLDER) {
                // 85% Fold/Check (action 0), 15% распределяется на Call/Bet/Raise
                strat_val = (a == 0) ? 0.85f : (0.15f / (na - 1));
            } 
            else if (profile == OpponentProfile::CALLING_STATION) {
                // Пассивный автоответчик: 90% Call/Check, 10% Fold, 0% Raise
                if (na == 2) {
                    strat_val = (a == 0) ? 0.15f : 0.85f;
                } else {
                    if (a == 0) strat_val = 0.10f;       // Fold/Check: 10%
                    else if (a == 1) strat_val = 0.85f;  // Call/Check: 85%
                    else strat_val = 0.05f / (na - 2);   // Raise/Allin: 5%
                }
            } 
            else if (profile == OpponentProfile::MANIAC) {
                // Гиперагрессор: 75% Bet/Raise (последнее действие), 25% на пассивные линии
                if (na == 2) {
                    strat_val = (a == 0) ? 0.25f : 0.75f;
                } else {
                    strat_val = (a == na - 1) ? 0.75f : (0.25f / (na - 1));
                }
            }

            // КРИТИЧЕСКИ ВАЖНО: регреты строго пропорциональны вероятностям
            float regret_val = strat_val * 100.0f;

            for (int h = 0; h < nh; ++h) {
                int idx = node.storage1_offset + a * nh + h;
                storage1[idx] = strat_val * 100.0f; // Вес стратегии
                storage2[idx] = regret_val;         // Регрет для Regret Matching
            }
        }
    }
}

// Подбор безопасной фантомной карты, которой ещё нет на доске
Card find_unused_card(uint64_t used_mask, int prefer_rank) {
    for (int r = prefer_rank; r >= 0; --r) {
        for (int s = 0; s < 4; ++s) {
            Card c = make_card(r, s);
            if (!(used_mask & card_to_bit(c))) return c;
        }
    }
    for (int c = 0; c < 52; ++c) {
        if (!(used_mask & card_to_bit(c))) return (Card)c;
    }
    return 0;
}

int main(int argc, char** argv) {
    if (argc < 5) {
        std::cerr << "Usage: live_solver <hero_cards> <board_cards> <pot> <stack> [locked_mask] [profile_id] [device_id]\n";
        return 1;
    }

    std::string hero = argv[1];
    std::string board = argv[2];
    int pot = std::atoi(argv[3]);
    int stack = std::atoi(argv[4]);
    uint8_t locked_mask = (argc > 5) ? (uint8_t)std::atoi(argv[5]) : 0;
    int profile_id = (argc > 6) ? std::atoi(argv[6]) : 0;
    int device_id = (argc > 7) ? std::atoi(argv[7]) : 0;

    if (hero.length() != 4 || board.length() < 6) {
        std::cout << "{\"error\": \"Invalid cards input\", \"check\": 1.0, \"bet\": 0.0, \"allin\": 0.0}" << std::endl;
        return 0;
    }

    CardConfig cc;
    cc.num_players = 4;
    cc.ranges.push_back(Range::from_string("TT+, AQs+, AKo"));
    cc.ranges.push_back(Range::from_string("88+, ATs+, KQs, AQo+"));
    cc.ranges.push_back(Range::from_string("55+, A8s+, KJs+, QJs, AJo+"));
    cc.ranges.push_back(Range::from_string("22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, ATo+, KTo+"));

    uint64_t used_mask = 0;
    cc.flop[0] = card_from_string(board.substr(0, 2)); used_mask |= card_to_bit(cc.flop[0]);
    cc.flop[1] = card_from_string(board.substr(2, 2)); used_mask |= card_to_bit(cc.flop[1]);
    cc.flop[2] = card_from_string(board.substr(4, 2)); used_mask |= card_to_bit(cc.flop[2]);

    // Безопасное заполнение доски (защита от краша CUDA по коду 255)
    if (board.length() >= 8) {
        cc.turn = card_from_string(board.substr(6, 2));
        used_mask |= card_to_bit(cc.turn);
    } else {
        cc.turn = find_unused_card(used_mask, 0); // 2-ка свободной масти
        used_mask |= card_to_bit(cc.turn);
    }

    if (board.length() >= 10) {
        cc.river = card_from_string(board.substr(8, 2));
    } else {
        cc.river = find_unused_card(used_mask, 1); // 3-ка свободной масти
    }

    TreeConfig tc;
    tc.num_players = 4;
    tc.initial_state = (board.length() == 6) ? BoardState::Flop : 
                       (board.length() == 8) ? BoardState::Turn : BoardState::River;
    tc.starting_pot = pot;
    tc.effective_stack = stack;

    for (int i = 0; i < 4; ++i) {
        tc.flop_bet_sizes[i]  = { {BetSize::PotRelative(0.50), BetSize::AllIn()}, {} };
        tc.turn_bet_sizes[i]  = { {BetSize::PotRelative(0.50), BetSize::AllIn()}, {} };
        tc.river_bet_sizes[i] = { {BetSize::PotRelative(0.50), BetSize::AllIn()}, {} };
    }

    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    game.allocate_memory(false);

    // 1. Применяем Node Locking в оперативную память хоста
    if (locked_mask != 0 && profile_id > 0) {
        for (int p = 1; p < 4; ++p) {
            if (locked_mask & (1 << p)) {
                apply_node_locking_profile(game, p, static_cast<OpponentProfile>(profile_id));
            }
        }
    }

    game.set_gpu_enabled(true);
    auto gpu_mem = std::make_unique<GpuMemory>();
    
    // 2. Активируем выбранный GPU перед выделением памяти
    #ifdef CUDA_BUILD
    cudaSetDevice(device_id);
    #endif

    // 3. Выделяем память на GPU и копируем туда залоченные массивы storage1 и storage2
    if (!gpu_solver_init(game, *gpu_mem)) {
        std::cout << "{\"error\": \"GPU init failed\", \"check\": 0.5, \"bet\": 0.5, \"allin\": 0.0}" << std::endl;
        return 1;
    }

    // 4. Передаём маску залоченных игроков в GPU структуру
    gpu_mem->locked_players_mask = locked_mask;
    game.set_gpu_mem(std::move(gpu_mem));

    // 5. 250 итераций DCFR (обучаются только незалоченные игроки)
    for (uint32_t iter = 1; iter <= 250; ++iter) {
        gpu_solve_step_dispatch(game, iter);
    }

    // 6. Копируем результат обратно
    gpu_solver_copy_back(game, *game.gpu_mem());

    std::vector<float> strat = game.root_strategy();
    float p_check = (strat.size() > 0) ? strat[0] : 0.5f;
    float p_bet   = (strat.size() > 1) ? strat[1] : 0.5f;
    float p_allin = (strat.size() > 2) ? strat[2] : 0.0f;

    std::cout << "{"
              << "\"status\": \"ok\","
              << "\"device\": " << device_id << ","
              << "\"check\": " << std::fixed << std::setprecision(4) << p_check << ","
              << "\"bet\": " << p_bet << ","
              << "\"allin\": " << p_allin
              << "}" << std::endl;

    gpu_solver_cleanup(*game.gpu_mem());
    return 0;
}
