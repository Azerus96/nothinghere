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
    std::cout << "======================================================\n";
    std::cout << "   🚀 2-WAY (HEADS-UP) DCFR TEST ON GPU 🚀           \n";
    std::cout << "======================================================\n";

    CardConfig cc;
    cc.num_players = 2;
    
    // Классические диапазоны: OOP (BB Defend) vs IP (BTN Open)
    cc.ranges.push_back(Range::from_string("88-22, AJs-A2s, KQs-K9s, QJs-Q9s, JTs-J9s, T9s, 98s, 87s, 76s, AQo-ATo, KJo+")); // P0 (OOP)
    cc.ranges.push_back(Range::from_string("TT+, AQs+, AKo, KQs"));                                                              // P1 (IP)

    cc.flop[0] = card_from_string("As");
    cc.flop[1] = card_from_string("Td");
    cc.flop[2] = card_from_string("7c");
    cc.turn    = card_from_string("2d");
    cc.river   = card_from_string("3h");

    TreeConfig tc;
    tc.num_players = 2;
    tc.initial_state = BoardState::Flop;
    tc.starting_pot = 100;
    tc.effective_stack = 950;
    tc.rake_rate = 0;
    tc.rake_cap = 0;
    
    // Стандартные сайзинги Heads-Up
    tc.flop_bet_sizes[0]  = { {BetSize::PotRelative(0.33)}, {BetSize::PotRelative(0.50)} }; // OOP
    tc.flop_bet_sizes[1]  = { {BetSize::PotRelative(0.33)}, {BetSize::PotRelative(0.50)} }; // IP
    tc.turn_bet_sizes[0]  = { {BetSize::PotRelative(0.66)}, {BetSize::AllIn()} };
    tc.turn_bet_sizes[1]  = { {BetSize::PotRelative(0.66)}, {BetSize::AllIn()} };
    tc.river_bet_sizes[0] = { {BetSize::PotRelative(0.66)}, {BetSize::AllIn()} };
    tc.river_bet_sizes[1] = { {BetSize::PotRelative(0.66)}, {BetSize::AllIn()} };

    std::cout << "Building Heads-Up Game Tree...\n";
    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    game.allocate_memory(false); 
    
    std::cout << "Tree built successfully! Total Nodes: " << game.num_nodes() << "\n\n";

    game.set_gpu_enabled(true);
    if (game.is_gpu_enabled()) {
        auto gpu_mem = std::make_unique<GpuMemory>();
        if (!gpu_solver_init(game, *gpu_mem)) {
            std::cerr << "FATAL ERROR: Failed to initialize GPU memory!\n";
            return 1;
        }
        game.set_gpu_mem(std::move(gpu_mem));
        std::cout << "✅ GPU Memory Initialized Successfully!\n";
    }

    std::vector<float> old_strat = game.root_strategy();

    std::cout << "Starting 2-Way DCFR on GPU...\n";
    std::cout << "------------------------------------------------------\n";
    std::cout << std::setw(10) << "Iteration" << " | " 
              << std::setw(15) << "Time (ms)" << " | " 
              << std::setw(15) << "Max Strat Delta" << "\n";
    std::cout << "------------------------------------------------------\n";

    auto t_start = std::chrono::high_resolution_clock::now();

    for (uint32_t iter = 1; iter <= 1000; ++iter) {
        auto t0 = std::chrono::high_resolution_clock::now();
        
        int res = gpu_solve_step_dispatch(game, iter);
        if (res != 0) {
            std::cerr << "\nFATAL ERROR: gpu_solve_step_dispatch failed at iter " << iter << "!\n";
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
    std::cout << " 🎯 STRATEGIES AT ROOT NODE (OOP P0 Flop Action)     \n";
    std::cout << "======================================================\n";
    print_node_strategy(game, 0, 0, "P0 (OOP) Root Flop Strategy", {"77", "ATs", "KQs", "87s", "22"});

    const auto& arena = game.node_arena();
    if (arena[0].num_children > 0) {
        int p0_check_node = arena[0].children_offset + 0;
        print_node_strategy(game, p0_check_node, 1, "P1 (IP) Facing Check", {"AA", "TT", "AKo", "QJs"});
    }

    std::cout << "======================================================\n";
    gpu_solver_cleanup(*game.gpu_mem());
    return 0;
}
