// ════════════════════════════════════════════════════════════════════════
// experiment_4way.cpp — Full 4-Way DCFR Convergence & Multi-Player Strategy
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

float compute_strategy_delta(const std::vector<float>& old_strat, const std::vector<float>& new_strat) {
    if (old_strat.empty() || new_strat.empty()) return 0.0f;
    float max_diff = 0.0f;
    for (size_t i = 0; i < old_strat.size(); ++i) {
        float diff = std::abs(old_strat[i] - new_strat[i]);
        if (diff > max_diff) max_diff = diff;
    }
    return max_diff;
}

void print_node_strategy(PostFlopGame& game, int node_idx, int player_id, const std::string& situation_name, const std::vector<std::string>& target_hands) {
    const auto& arena = game.node_arena();
    if (node_idx >= (int)arena.size()) return;
    const PostFlopNode& node = arena[node_idx];

    int num_actions = node.num_actions();
    int num_hands = game.num_private_hands(player_id);
    if (num_actions == 0 || num_hands == 0) return;

    std::vector<float> strat(node.num_elements);
    if (game.is_compressed()) {
        const int16_t* src = (const int16_t*)game.storage1_data() + node.storage1_offset;
        float decode_mult = node.scale1 / 32767.0f;
        for (size_t i = 0; i < strat.size(); ++i) strat[i] = (float)src[i] * decode_mult;
    } else {
        std::memcpy(strat.data(), game.storage1_data() + node.storage1_offset, strat.size() * sizeof(float));
    }
    normalize_strategy(strat.data(), num_actions, num_hands);

    std::cout << "\n------------------------------------------------------\n";
    std::cout << " 📍 " << situation_name << " (Player " << player_id << ")\n";
    std::cout << "------------------------------------------------------\n";

    const auto& p_cards = game.private_cards(player_id);

    for (const auto& target : target_hands) {
        Card c1 = card_from_string(target.substr(0, 2));
        Card c2 = card_from_string(target.substr(2, 2));
        if (c1 == NOT_DEALT || c2 == NOT_DEALT) {
            c1 = make_card(card_rank(card_from_string(target.substr(0,1) + "s")), 3);
            c2 = make_card(card_rank(card_from_string(target.substr(1,1) + "h")), 2);
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
}

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
    
    tc.flop_bet_sizes[0] = { {BetSize::PotRelative(0.50)}, {BetSize::PrevRelative(2.0)} };
    tc.turn_bet_sizes[0] = { {BetSize::PotRelative(0.50)}, {BetSize::PrevRelative(2.0)} };
    tc.river_bet_sizes[0] = { {BetSize::PotRelative(0.50)}, {BetSize::PrevRelative(2.0)} };

    std::cout << "Building 4-Way Game Tree...\n";
    PostFlopGame game(std::move(cc), tc);
    game.prepare();
    game.allocate_memory(false);
    
    // ВКЛЮЧАЕМ GPU!
    game.set_gpu_enabled(true);

    std::cout << "Tree built successfully! Total Nodes: " << game.num_nodes() << "\n\n";

    if (game.is_gpu_enabled() && game.gpu_mem_initialized()) {
        gpu_solver_copy_back(game, *game.gpu_mem());
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
        
        solve_step(game, iter);
        
        auto t1 = std::chrono::high_resolution_clock::now();
        double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();

        if (iter % 100 == 0 || iter == 1) {
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
    std::cout << "Total Time: " << total_sec << " seconds.\n";

    if (game.is_gpu_enabled() && game.gpu_mem_initialized()) {
        gpu_solver_copy_back(game, *game.gpu_mem());
    }

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
    return 0;
}
