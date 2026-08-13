// ════════════════════════════════════════════════════════════════════════
// experiment_4way.cpp — 4-Way DCFR Convergence Experiment
// ════════════════════════════════════════════════════════════════════════
#include <cstdio>
#include <vector>
#include <string>
#include <chrono>
#include <iomanip>
#include <iostream>
#include "card.h"
#include "hand_evaluator.h"
#include "range.h"
#include "action_tree.h"
#include "game.h"
#include "solver.h"
#include "gpu_solver.h"

using namespace postflop;

// Функция для вычисления Strategy Delta (метрика сходимости для мультивея)
float compute_strategy_delta(const std::vector<float>& old_strat, const std::vector<float>& new_strat) {
    if (old_strat.empty() || new_strat.empty()) return 0.0f;
    float max_diff = 0.0f;
    for (size_t i = 0; i < old_strat.size(); ++i) {
        float diff = std::abs(old_strat[i] - new_strat[i]);
        if (diff > max_diff) max_diff = diff;
    }
    return max_diff;
}

int main() {
    std::cout << "======================================================\n";
    std::cout << "   🚀 4-WAY DCFR EXPERIMENT (Gamma=2.0, GPU) 🚀       \n";
    std::cout << "======================================================\n";

    // 1. Настройка игры
    CardConfig cc;
    cc.num_players = 4;
    
    // Задаем диапазоны 4 игроков
    cc.ranges.push_back(Range::from_string("TT+, AQs+, AKo"));
    cc.ranges.push_back(Range::from_string("88+, ATs+, KQs, AQo+"));
    cc.ranges.push_back(Range::from_string("55+, A8s+, KJs+, QJs, AJo+"));
    cc.ranges.push_back(Range::from_string("22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, ATo+, KTo+"));

    // Полный борд для 7-карточной оценки рук
    cc.flop[0] = card_from_string("As");
    cc.flop[1] = card_from_string("Td");
    cc.flop[2] = card_from_string("7c");
    cc.turn    = card_from_string("2d");
    cc.river   = card_from_string("3h");

    // 2. Настройка дерева (Action Pruning)
    TreeConfig tc;
    tc.num_players = 4;
    tc.initial_state = BoardState::Flop;
    tc.starting_pot = 1000; // 4 игрока по 250
    tc.effective_stack = 4750; // 5000 - 250
    tc.rake_rate = 0;
    tc.rake_cap = 0;
    
    // Только 1 сайзинг (50% банка) для предотвращения взрыва памяти
    tc.flop_bet_sizes[0] = { {BetSize::PotRelative(0.50)}, {BetSize::PrevRelative(2.0)} };
    tc.turn_bet_sizes[0] = { {BetSize::PotRelative(0.50)}, {BetSize::PrevRelative(2.0)} };
    tc.river_bet_sizes[0] = { {BetSize::PotRelative(0.50)}, {BetSize::PrevRelative(2.0)} };

    std::cout << "Building 4-Way Game Tree...\n";
    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    game.allocate_memory(false); // Выключаем сжатие для максимальной точности
    game.set_gpu_enabled(true);  // ВКЛЮЧАЕМ GPU!

    std::cout << "Tree built successfully!\n";
    std::cout << "Total Nodes: " << game.num_nodes() << "\n";
    auto [uncomp, comp] = game.memory_usage();
    std::cout << "Memory Required: " << uncomp / (1024 * 1024) << " MB\n\n";

    // Инициализация стратегии
    if (game.is_gpu_enabled() && game.gpu_mem_initialized()) {
        gpu_solver_copy_back(game, *game.gpu_mem());
    }
    std::vector<float> old_strat = game.root_strategy();

    // 3. Запуск DCFR
    std::cout << "Starting DCFR on GPU...\n";
    std::cout << "------------------------------------------------------\n";
    std::cout << std::setw(10) << "Iteration" << " | " 
              << std::setw(15) << "Time (ms)" << " | " 
              << std::setw(15) << "Max Strat Delta" << "\n";
    std::cout << "------------------------------------------------------\n";

    auto t_start = std::chrono::high_resolution_clock::now();

    for (uint32_t iter = 1; iter <= 1000; ++iter) {
        auto t0 = std::chrono::high_resolution_clock::now();
        
        solve_step(game, iter);
        
        auto t1 = std::chrono::high_resolution_clock::now();
        double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();

        if (iter % 100 == 0 || iter == 1) {
            // КОПИРУЕМ ДАННЫЕ ИЗ VRAM В RAM ПЕРЕД ЗАМЕРОМ СТРАТЕГИИ!
            if (game.is_gpu_enabled() && game.gpu_mem_initialized()) {
                gpu_solver_copy_back(game, *game.gpu_mem());
            }
            
            std::vector<float> new_strat = game.root_strategy();
            float delta = compute_strategy_delta(old_strat, new_strat);
            old_strat = new_strat;

            std::cout << std::setw(10) << iter << " | " 
                      << std::setw(15) << std::fixed << std::setprecision(2) << ms << " | " 
                      << std::setw(15) << std::fixed << std::setprecision(6) << delta << "\n";
        }
    }

    auto t_end = std::chrono::high_resolution_clock::now();
    double total_sec = std::chrono::duration<double>(t_end - t_start).count();
    std::cout << "------------------------------------------------------\n";
    std::cout << "Total Time: " << total_sec << " seconds.\n\n";

    // Синхронизируем перед финальным выводом
    if (game.is_gpu_enabled() && game.gpu_mem_initialized()) {
        gpu_solver_copy_back(game, *game.gpu_mem());
    }

    // 4. Вывод итоговой стратегии для P0 (UTG)
    std::cout << "=== FINAL STRATEGY FOR P0 (UTG) AT ROOT ===\n";
    std::vector<float> final_strat = game.root_strategy();
    const PostFlopNode& root = game.node_arena()[0];
    int num_actions = root.num_actions();
    int num_hands = game.num_private_hands(0);

    std::vector<std::string> target_hands = {"AA", "KK", "77", "AcKc"};
    
    for (const auto& target : target_hands) {
        Card c1 = card_from_string(target.substr(0, 2));
        Card c2 = card_from_string(target.substr(2, 2));
        if (c1 == NOT_DEALT || c2 == NOT_DEALT) {
            c1 = make_card(card_rank(card_from_string(target.substr(0,1) + "s")), 3);
            c2 = make_card(card_rank(card_from_string(target.substr(1,1) + "h")), 2);
        }

        int hand_idx = -1;
        const auto& p0_cards = game.private_cards(0);
        for (int i = 0; i < num_hands; ++i) {
            if ((p0_cards[i].first == c1 && p0_cards[i].second == c2) ||
                (p0_cards[i].first == c2 && p0_cards[i].second == c1)) {
                hand_idx = i;
                break;
            }
        }

        if (hand_idx != -1) {
            std::cout << "Hand " << target << ": ";
            for (int a = 0; a < num_actions; ++a) {
                float prob = final_strat[a * num_hands + hand_idx] * 100.0f;
                std::cout << "Action " << a << " (" << std::fixed << std::setprecision(1) << prob << "%)  ";
            }
            std::cout << "\n";
        }
    }

    std::cout << "======================================================\n";
    return 0;
}
