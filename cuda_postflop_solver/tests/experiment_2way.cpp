#include <iostream>
#include <vector>
#include <iomanip>
#include <chrono>
#include <cmath>
#include <string>
#include <cstring>
#include <memory>
#include <stdexcept>

#include "game.h"
#include "solver.h"
#include "gpu_solver.h"
#include "card.h"
#include "range.h"
#include "action_tree.h"

using namespace postflop;

float compute_strategy_delta(const std::vector<float>& old_s, const std::vector<float>& new_s) {
    float max_d = 0.0f;
    for (size_t i = 0; i < old_s.size(); ++i) {
        float d = std::abs(old_s[i] - new_s[i]);
        if (d > max_d) max_d = d;
    }
    return max_d;
}

void print_node_strategy(const PostFlopGame& game, int node_idx, int player, const std::string& title, const std::vector<std::string>& target_hands) {
    const auto& arena = game.node_arena();
    if (node_idx >= (int)arena.size()) return;
    const auto& node = arena[node_idx];
    int num_actions = node.num_actions();
    int num_hands = game.num_private_hands(player);
    const auto& p_cards = game.card_config().private_cards[player];

    std::vector<float> strat(num_actions * num_hands);
    std::memcpy(strat.data(), game.storage1_data() + node.storage1_offset, num_actions * num_hands * sizeof(float));
    normalize_strategy(strat.data(), num_actions, num_hands);

    std::cout << "--- " << title << " ---\n";
    for (const auto& target : target_hands) {
        Card c1, c2;
        if (target.length() == 2) {
            c1 = make_card(card_rank(card_from_string(target.substr(0,1) + "s")), 3); 
            c2 = make_card(card_rank(card_from_string(target.substr(1,1) + "h")), 2); 
        } else if (target.length() == 4) {
            c1 = card_from_string(target.substr(0,2));
            c2 = card_from_string(target.substr(2,2));
        } else {
            continue;
        }

        int hand_idx = -1;
        for (int i = 0; i < num_hands; ++i) {
            if ((p_cards[i].first == c1 && p_cards[i].second == c2) ||
                (p_cards[i].first == c2 && p_cards[i].second == c1)) {
                hand_idx = i;
                break;
            }
        }

        if (hand_idx != -1) {
            std::cout << "Hand " << std::setw(5) << target << ": ";
            for (int a = 0; a < num_actions; ++a) {
                float prob = strat[a * num_hands + hand_idx] * 100.0f;
                std::cout << "Act " << a << ": " << std::fixed << std::setprecision(1) << std::setw(5) << prob << "%  ";
            }
            std::cout << "\n";
        }
    }
    std::cout << "\n";
}

int main() {
    try {
        std::cout << "======================================================\n";
        std::cout << "   🚀 2-WAY (HEADS-UP) DCFR TEST ON GPU 🚀           \n";
        std::cout << "======================================================\n";

        std::cout << "[DEBUG 1] Инициализация конфигурации карт..." << std::endl;
        CardConfig cc;
        cc.num_players = 2;
        
        // Используем 100% проверенные диапазоны из 4-Way теста
        cc.ranges.push_back(Range::from_string("TT+, AQs+, AKo"));            // P0 (OOP)
        cc.ranges.push_back(Range::from_string("88+, ATs+, KQs, AQo+"));       // P1 (IP)

        cc.flop[0] = card_from_string("As");
        cc.flop[1] = card_from_string("Td");
        cc.flop[2] = card_from_string("7c");
        cc.turn    = card_from_string("2d");
        cc.river   = card_from_string("3h");

        std::cout << "[DEBUG 2] Инициализация конфигурации дерева..." << std::endl;
        TreeConfig tc;
        tc.num_players = 2;
        tc.initial_state = BoardState::Flop;
        tc.starting_pot = 100;
        tc.effective_stack = 950;
        tc.rake_rate = 0;
        tc.rake_cap = 0;
        
        tc.flop_bet_sizes[0]  = { {BetSize::PotRelative(0.50)}, {} }; 
        tc.flop_bet_sizes[1]  = { {BetSize::PotRelative(0.50)}, {} }; 
        tc.turn_bet_sizes[0]  = { {BetSize::PotRelative(0.50)}, {} };
        tc.turn_bet_sizes[1]  = { {BetSize::PotRelative(0.50)}, {} };
        tc.river_bet_sizes[0] = { {BetSize::PotRelative(0.50)}, {} };
        tc.river_bet_sizes[1] = { {BetSize::PotRelative(0.50)}, {} };

        std::cout << "[DEBUG 3] Создание объекта PostFlopGame..." << std::endl;
        PostFlopGame game(std::move(cc), tc);

        std::cout << "[DEBUG 4] Вызов game.prepare()..." << std::endl;
        game.prepare();

        std::cout << "[DEBUG 5] Вызов game.allocate_memory(false)..." << std::endl;
        game.allocate_memory(false); 
        
        std::cout << "Tree built successfully! Total Nodes: " << game.num_nodes() << "\n" << std::endl;

        std::cout << "[DEBUG 6] Включение и выделение GPU памяти..." << std::endl;
        game.set_gpu_enabled(true);
        if (game.is_gpu_enabled()) {
            auto gpu_mem = std::make_unique<GpuMemory>();
            if (!gpu_solver_init(game, *gpu_mem)) {
                std::cerr << "FATAL ERROR: Failed to initialize GPU memory!\n" << std::endl;
                return 1;
            }
            game.set_gpu_mem(std::move(gpu_mem));
            std::cout << "✅ GPU Memory Initialized Successfully!\n" << std::endl;
        }

        std::cout << "[DEBUG 7] Получение начальной стратегии корня..." << std::endl;
        std::vector<float> old_strat = game.root_strategy();

        std::cout << "Starting 2-Way DCFR on GPU...\n";
        std::cout << "------------------------------------------------------\n";
        std::cout << std::setw(10) << "Iteration" << " | " 
                  << std::setw(15) << "Time (ms)" << " | " 
                  << std::setw(15) << "Max Strat Delta" << "\n";
        std::cout << "------------------------------------------------------\n" << std::endl;

        auto t_start = std::chrono::high_resolution_clock::now();

        for (uint32_t iter = 1; iter <= 1000; ++iter) {
            auto t0 = std::chrono::high_resolution_clock::now();
            
            int res = gpu_solve_step_dispatch(game, iter);
            if (res != 0) {
                std::cerr << "\nFATAL ERROR: gpu_solve_step_dispatch failed at iter " << iter << " with code " << res << "!\n" << std::endl;
                return 1;
            }
            
            auto t1 = std::chrono::high_resolution_clock::now();
            double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();

            if (iter % 100 == 0 || iter == 1) {
                gpu_solver_copy_back(game, *game.gpu_mem());
                
                std::vector<float> new_strat = game.root_strategy();
                float delta = compute_strategy_delta(old_strat, new_strat);
                old_strat = new_strat;

                std::cout << std::setw(10) << iter << " | " 
                          << std::setw(15) << std::fixed << std::setprecision(2) << ms << " | " 
                          << std::setw(15) << std::fixed << std::setprecision(6) << delta << std::endl;
            }
        }

        auto t_end = std::chrono::high_resolution_clock::now();
        double total_sec = std::chrono::duration<double>(t_end - t_start).count();
        std::cout << "------------------------------------------------------\n";
        std::cout << "Total Time: " << total_sec << " seconds.\n" << std::endl;

        gpu_solver_copy_back(game, *game.gpu_mem());

        std::cout << "\n======================================================\n";
        std::cout << " 🎯 STRATEGIES AT ROOT NODE (OOP P0 Flop Action)     \n";
        std::cout << "======================================================\n";
        print_node_strategy(game, 0, 0, "P0 (OOP) Root Flop Strategy", {"AA", "KK", "77", "AcKc"});

        std::cout << "======================================================\n";
        gpu_solver_cleanup(*game.gpu_mem());
        return 0;

    } catch (const std::exception& e) {
        std::cerr << "\n❌ ИСКЛЮЧЕНИЕ C++ CATCH: " << e.what() << "\n" << std::endl;
        return 1;
    } catch (...) {
        std::cerr << "\n❌ НЕИЗВЕСТНЫЙ СБОЙ ПАМЯТИ (UNKNOWN CRASH)!\n" << std::endl;
        return 1;
    }
}
