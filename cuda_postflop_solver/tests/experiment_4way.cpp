#include <iostream>
#include <vector>
#include <iomanip>
#include <chrono>
#include <cmath>
#include <string>
#include <cstring>
#include <memory>

#include "game.h"
#include "solver.h"
#include "gpu_solver.h"
#include "card.h"
#include "range.h"
#include "action_tree.h"

using namespace postflop;

// --- Вспомогательная функция: Расчет максимальной дельты стратегии ---
float compute_strategy_delta(const std::vector<float>& old_s, const std::vector<float>& new_s) {
    float max_d = 0.0f;
    for (size_t i = 0; i < old_s.size(); ++i) {
        float d = std::abs(old_s[i] - new_s[i]);
        if (d > max_d) max_d = d;
    }
    return max_d;
}

// --- Вспомогательная функция: Печать стратегии для конкретных рук ---
void print_node_strategy(const PostFlopGame& game, int node_idx, int player, const std::string& title, const std::vector<std::string>& target_hands) {
    const auto& arena = game.node_arena();
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

// --- ГЛАВНАЯ ФУНКЦИЯ ---
int main() {
    std::cout << "======================================================\n";
    std::cout << "   🚀 4-WAY DCFR EXPERIMENT (Gamma=2.0, GPU) 🚀       \n";
    std::cout << "======================================================\n";

    CardConfig cc;
    cc.num_players = 4;
    
    cc.ranges.push_back(Range::from_string("TT+, AQs+, AKo"));                             // P0 (UTG)
    cc.ranges.push_back(Range::from_string("88+, ATs+, KQs, AQo+"));                        // P1 (CO)
    cc.ranges.push_back(Range::from_string("55+, A8s+, KJs+, QJs, AJo+"));                  // P2 (BTN)
    cc.ranges.push_back(Range::from_string("22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, ATo+, KTo+")); // P3 (BB)

    cc.flop[0] = card_from_string("As");
    cc.flop[1] = card_from_string("Td");
    cc.flop[2] = card_from_string("7c");
    cc.turn    = card_from_string("2d");
    cc.river   = card_from_string("3h");

    TreeConfig tc;
    tc.num_players = 4;
    tc.initial_state = BoardState::Flop;
    tc.starting_pot = 1000;
    tc.effective_stack = 4750;
    tc.rake_rate = 0;
    tc.rake_cap = 0;
    
    // ИСПРАВЛЕНИЕ: Даем всем 4 игрокам одинаковые права на ставки (1 сайзинг)
    for (int i = 0; i < 4; ++i) {
        tc.flop_bet_sizes[i] = { {BetSize::PotRelative(0.50)}, {} };
        tc.turn_bet_sizes[i] = { {BetSize::PotRelative(0.50)}, {} };
        tc.river_bet_sizes[i] = { {BetSize::PotRelative(0.50)}, {} };
    }

    std::cout << "Building 4-Way Game Tree...\n";
    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    game.allocate_memory(false); 
    
    std::cout << "Tree built successfully! Total Nodes: " << game.num_nodes() << "\n\n";

    // ИСПРАВЛЕНИЕ: Правильная инициализация GPU
    game.set_gpu_enabled(true);
    if (game.is_gpu_enabled()) {
        auto gpu_mem = std::make_unique<GpuMemory>();
        if (!gpu_solver_init(game, *gpu_mem)) {
            std::cerr << "FATAL ERROR: Failed to initialize GPU memory! Check CUDA availability and VRAM.\n";
            return 1;
        }
        game.set_gpu_mem(std::move(gpu_mem));
        std::cout << "✅ GPU Memory Initialized Successfully!\n";
    } else {
        std::cerr << "FATAL ERROR: GPU is not enabled!\n";
        return 1;
    }

    std::vector<float> old_strat = game.root_strategy();

    std::cout << "Starting DCFR on GPU...\n";
    std::cout << "------------------------------------------------------\n";
    std::cout << std::setw(10) << "Iteration" << " | " 
              << std::setw(15) << "Time (ms)" << " | " 
              << std::setw(15) << "Max Strat Delta" << "\n";
    std::cout << "------------------------------------------------------\n";

    auto t_start = std::chrono::high_resolution_clock::now();

    for (uint32_t iter = 1; iter <= 1000; ++iter) {
        auto t0 = std::chrono::high_resolution_clock::now();
        
        // ИСПРАВЛЕНИЕ: Проверка ошибок выполнения
        int res = gpu_solve_step_dispatch(game, iter);
        if (res != 0) {
            std::cerr << "\nFATAL ERROR: gpu_solve_step_dispatch failed at iter " << iter << " with code " << res << "!\n";
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
                      << std::setw(15) << std::fixed << std::setprecision(6) << delta << "\n";
        }
    }

    auto t_end = std::chrono::high_resolution_clock::now();
    double total_sec = std::chrono::duration<double>(t_end - t_start).count();
    std::cout << "------------------------------------------------------\n";
    std::cout << "Total Time: " << total_sec << " seconds.\n";

    gpu_solver_copy_back(game, *game.gpu_mem());

    std::cout << "\n======================================================\n";
    std::cout << " 🎯 STRATEGIES FOR ALL 4 PLAYERS AT KEY DECISION NODES \n";
    std::cout << "======================================================\n";

    const auto& arena = game.node_arena();

    print_node_strategy(game, 0, 0, "P0 (UTG) First to Act at Root", {"AA", "KK", "77", "AcKc"});

    int p0_check_node = arena[0].children_offset + 0; 
    print_node_strategy(game, p0_check_node, 1, "P1 (CO) Facing UTG Check", {"TT", "JJ", "AdQd", "KQs"});

    int p0_bet_node = arena[0].children_offset + 1; 
    print_node_strategy(game, p0_bet_node, 1, "P1 (CO) Facing UTG Bet 500", {"TT", "JJ", "AdQd", "KQs"});

    int p1_check_node = arena[p0_check_node].children_offset + 0;
    print_node_strategy(game, p1_check_node, 2, "P2 (BTN) Facing UTG Check -> CO Check", {"7s7h", "AsJs", "9s8s", "5s5h"});

    int p2_check_node = arena[p1_check_node].children_offset + 0;
    print_node_strategy(game, p2_check_node, 3, "P3 (BB) Facing Checks from All 3 Players", {"Ts9s", "8s7s", "As5s", "Jh9h"});

    std::cout << "\n======================================================\n";
    
    gpu_solver_cleanup(*game.gpu_mem());
    
    return 0;
}
