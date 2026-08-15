#include <iostream>
#include <vector>
#include <string>
#include <cstring>
#include <memory>
#include <iomanip>

#include "game.h"
#include "solver.h"
#include "gpu_solver.h"
#include "card.h"
#include "range.h"
#include "action_tree.h"

using namespace postflop;

int main(int argc, char** argv) {
    // Аргументы: hero_cards, board_cards, pot_chips, stack_chips, hero_pos, locked_mask
    std::string hero = (argc > 1) ? argv[1] : "AhKd";
    std::string board = (argc > 2) ? argv[2] : "AsTd7c";
    int pot = (argc > 3) ? std::atoi(argv[3]) : 1000;
    int stack = (argc > 4) ? std::atoi(argv[4]) : 4750;
    uint8_t locked_mask = (argc > 5) ? (uint8_t)std::atoi(argv[5]) : 0;

    CardConfig cc;
    cc.num_players = 4;
    cc.ranges.push_back(Range::from_string("TT+, AQs+, AKo"));
    cc.ranges.push_back(Range::from_string("88+, ATs+, KQs, AQo+"));
    cc.ranges.push_back(Range::from_string("55+, A8s+, KJs+, QJs, AJo+"));
    cc.ranges.push_back(Range::from_string("22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, ATo+, KTo+"));

    if (board.length() >= 6) {
        cc.flop[0] = card_from_string(board.substr(0, 2));
        cc.flop[1] = card_from_string(board.substr(2, 2));
        cc.flop[2] = card_from_string(board.substr(4, 2));
    }
    cc.turn = (board.length() >= 8) ? card_from_string(board.substr(6, 2)) : card_from_string("2d");
    cc.river = (board.length() >= 10) ? card_from_string(board.substr(8, 2)) : card_from_string("3h");

    TreeConfig tc;
    tc.num_players = 4;
    tc.initial_state = BoardState::Flop;
    tc.starting_pot = pot;
    tc.effective_stack = stack;
    for (int i = 0; i < 4; ++i) {
        tc.flop_bet_sizes[i] = { {BetSize::PotRelative(0.50)}, {} };
        tc.turn_bet_sizes[i] = { {BetSize::PotRelative(0.50)}, {} };
        tc.river_bet_sizes[i] = { {BetSize::PotRelative(0.50)}, {} };
    }

    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    game.allocate_memory(false);
    game.set_gpu_enabled(true);

    auto gpu_mem = std::make_unique<GpuMemory>();
    if (!gpu_solver_init(game, *gpu_mem)) return 1;
    
    // Взводим маску Node Locking
    gpu_mem->locked_players_mask = locked_mask;
    game.set_gpu_mem(std::move(gpu_mem));

    // 200 быстрых итераций на GPU
    for (uint32_t iter = 1; iter <= 200; ++iter) {
        gpu_solve_step_dispatch(game, iter);
    }

    gpu_solver_copy_back(game, *game.gpu_mem());

    // Выводим результат в stdout в формате JSON для Python
    std::vector<float> strat = game.root_strategy();
    float p_check = (strat.size() > 0) ? strat[0] : 0.5f;
    float p_bet = (strat.size() > 1) ? strat[1] : 0.5f;

    std::cout << "{\"check\": " << std::fixed << std::setprecision(4) << p_check 
              << ", \"bet\": " << p_bet << "}" << std::endl;

    gpu_solver_cleanup(*game.gpu_mem());
    return 0;
}
