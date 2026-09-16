// ════════════════════════════════════════════════════════════════════════
// tests/experiment_3way.cpp — Real 3-Way Postflop JIT Benchmark on GPU
// ════════════════════════════════════════════════════════════════════════
#include <iostream>
#include <vector>
#include <iomanip>
#include <chrono>
#include <cmath>
#include <string>
#include <cstring>
#include <memory>
#include <algorithm>

#include "game.h"
#include "solver.h"
#include "gpu_solver.h"
#include "card.h"
#include "range.h"
#include "action_tree.h"

using namespace postflop;

std::vector<float> extract_all_normalized_strategies(const PostFlopGame& game) {
    const auto& arena = game.node_arena();
    const float* storage = game.storage1_data();
    std::vector<float> all_strats;

    for (const auto& node : arena) {
        if (node.is_terminal() || node.is_chance() || node.num_elements == 0) continue;
        int num_actions = node.num_actions();
        if (num_actions <= 0) continue;
        int num_hands = node.num_elements / num_actions;

        std::vector<float> node_strat(node.num_elements);
        std::memcpy(node_strat.data(), storage + node.storage1_offset, node.num_elements * sizeof(float));
        normalize_strategy(node_strat.data(), num_actions, num_hands);
        all_strats.insert(all_strats.end(), node_strat.begin(), node_strat.end());
    }
    return all_strats;
}

float compute_strategy_delta(const std::vector<float>& old_s, const std::vector<float>& new_s) {
    if (old_s.size() != new_s.size() || old_s.empty()) return 0.0f;
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
        int hand_idx = -1;
        std::string display_hand = target;

        if (target.length() == 2) {
            int rank1 = card_rank(card_from_string(target.substr(0, 1) + "s"));
            int rank2 = card_rank(card_from_string(target.substr(1, 1) + "s"));
            for (int i = 0; i < num_hands; ++i) {
                int rA = card_rank(p_cards[i].first), rB = card_rank(p_cards[i].second);
                if ((rA == rank1 && rB == rank2) || (rA == rank2 && rB == rank1)) {
                    hand_idx = i;
                    display_hand = target + " (" + card_to_string(p_cards[i].first) + card_to_string(p_cards[i].second) + ")";
                    break;
                }
            }
        } else if (target.length() == 4) {
            Card c1 = card_from_string(target.substr(0, 2)), c2 = card_from_string(target.substr(2, 2));
            for (int i = 0; i < num_hands; ++i) {
                if ((p_cards[i].first == c1 && p_cards[i].second == c2) || (p_cards[i].first == c2 && p_cards[i].second == c1)) {
                    hand_idx = i; break;
                }
            }
        }

        if (hand_idx != -1) {
            std::cout << "Hand " << std::setw(12) << display_hand << ": ";
            for (int a = 0; a < num_actions; ++a) {
                float prob = strat[a * num_hands + hand_idx] * 100.0f;
                uint8_t a_type = node.action_type(a);
                const char* type_str = "None";
                if (a_type == 1) type_str = "Fold";
                else if (a_type == 2) type_str = "Check";
                else if (a_type == 3) type_str = "Call";
                else if (a_type == 4) type_str = "Bet";
                else if (a_type == 5) type_str = "Raise";
                else if (a_type == 6) type_str = "AllIn";

                std::cout << type_str << ": " << std::fixed << std::setprecision(1) << std::setw(5) << prob << "%  ";
            }
            std::cout << "\n";
        }
    }
    std::cout << "\n";
}

int main() {
    try {
        std::cout << "======================================================\n";
        std::cout << "   🚀 3-WAY DCFR REAL POSTFLOP JIT (820 Boards, GPU) 🚀\n";
        std::cout << "======================================================\n";

        CardConfig cc;
        cc.num_players = 3;
        // Очередность хода на постфлопе:
        // Player 0 = SB (первый ход)
        // Player 1 = BB (второй ход)
        // Player 2 = BTN / Hero (в позиции, ходит последним)
        cc.ranges.push_back(Range::from_string("77-TT, AJs-A9s, KQs, KJs, QJs, AQo"));                  // P0: SB (Flat Call)
        cc.ranges.push_back(Range::from_string("22-88, A2s-A8s, K2s-K9s, Q6s+, J7s+, T7s+, 96s+, 85s+")); // P1: BB (Defend)
        cc.ranges.push_back(Range::from_string("22+, A2s+, K8s+, Q9s+, J9s+, T8s+, ATo+, KJo+, QJo")); // P2: BTN (Opener)

        cc.flop[0] = card_from_string("Ks");
        cc.flop[1] = card_from_string("8d");
        cc.flop[2] = card_from_string("3c");
        cc.turn    = NOT_DEALT;
        cc.river   = NOT_DEALT;

        TreeConfig tc;
        tc.num_players = 3;
        tc.initial_state = BoardState::Flop;
        tc.starting_pot = 750;
        tc.effective_stack = 3250;
        tc.rake_rate = 0;
        tc.rake_cap = 0;
        tc.bubble_factor = 1.35f; // Турнирный ICM риск

        // Полноценная сетка ставок
        for (int i = 0; i < 3; ++i) {
            tc.flop_bet_sizes[i] = {
                {BetSize::PotRelative(0.33), BetSize::PotRelative(0.75), BetSize::AllIn()},
                {BetSize::PrevRelative(2.5), BetSize::AllIn()}
            };
        }

        std::cout << "Building 3-Way Production Game Tree...\n";
        PostFlopGame game(std::move(cc), tc);
        game.prepare();
        game.allocate_memory(false);

        std::cout << "Tree built successfully! Total Nodes: " << game.num_nodes() << "\n\n";

        game.set_gpu_enabled(true);
        auto gpu_mem = std::make_unique<GpuMemory>();
        if (!gpu_solver_init(game, *gpu_mem)) {
            std::cerr << "FATAL ERROR: Failed to initialize GPU memory!\n";
            return 1;
        }
        game.set_gpu_mem(std::move(gpu_mem));
        std::cout << "✅ GPU Memory Initialized (820 Boards JIT Ready)!\n";

        std::vector<float> old_strat = extract_all_normalized_strategies(game);

        std::cout << "Starting 3-Way DCFR on GPU (300 iterations)...\n";
        std::cout << "------------------------------------------------------\n";
        std::cout << std::setw(10) << "Iteration" << " | "
                  << std::setw(15) << "Time (ms)" << " | "
                  << std::setw(15) << "Tree Max Delta" << "\n";
        std::cout << "------------------------------------------------------\n";

        auto t_start = std::chrono::high_resolution_clock::now();

        // 300 честных итераций
        for (uint32_t iter = 1; iter <= 300; ++iter) {
            auto t0 = std::chrono::high_resolution_clock::now();
            int res = gpu_solve_step_dispatch(game, iter);
            if (res != 0) return 1;
            auto t1 = std::chrono::high_resolution_clock::now();
            double ms = std::chrono::duration<double, std::milli>(t1 - t0).count();

            if (iter % 50 == 0 || iter == 1) {
                gpu_solver_copy_back(game, *game.gpu_mem());
                std::vector<float> new_strat = extract_all_normalized_strategies(game);
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
        std::cout << " 🎯 3-WAY GTO STRATEGIES AT KEY DECISION NODES        \n";
        std::cout << "======================================================\n";
        const auto& arena = game.node_arena();

        // P0 (SB) ходит первым
        print_node_strategy(game, 0, 0, "P0 (SB) First to Act on Flop", {"88", "AdJd", "QJs", "Ts9s"});

        // P1 (BB) ходит вторым после чека от SB
        int p0_check_node = arena[0].children_offset + 0;
        print_node_strategy(game, p0_check_node, 1, "P1 (BB) Facing SB Check", {"88", "33", "A8s", "9s8s"});

        // P2 (BTN) закрывает торговлю после чеков от SB и BB
        int p1_check_node = arena[p0_check_node].children_offset + 0;
        print_node_strategy(game, p1_check_node, 2, "P2 (BTN Opener) Facing Checks from SB & BB", {"AA", "KK", "88", "33", "AcQc", "JdTs"});

        std::cout << "======================================================\n";
        gpu_solver_cleanup(*game.gpu_mem());
        return 0;

    } catch (const std::exception& e) {
        std::cerr << "EXCEPTION: " << e.what() << "\n";
        return 1;
    }
}
