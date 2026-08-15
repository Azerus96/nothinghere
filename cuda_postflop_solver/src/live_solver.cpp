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

enum class OpponentProfile : uint8_t {
    GTO = 0,
    OVERFOLDER = 1,
    CALLING_STATION = 2,
    MANIAC = 3
};

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
                strat_val = (a == 0) ? 0.85f : (0.15f / (na - 1));
            } 
            else if (profile == OpponentProfile::CALLING_STATION) {
                if (na == 2) {
                    strat_val = (a == 0) ? 0.15f : 0.85f;
                } else {
                    if (a == 0) strat_val = 0.10f;
                    else if (a == 1) strat_val = 0.85f;
                    else strat_val = 0.05f / (na - 2);
                }
            } 
            else if (profile == OpponentProfile::MANIAC) {
                if (na == 2) {
                    strat_val = (a == 0) ? 0.25f : 0.75f;
                } else {
                    strat_val = (a == na - 1) ? 0.75f : (0.25f / (na - 1));
                }
            }

            float regret_val = strat_val * 100.0f;

            for (int h = 0; h < nh; ++h) {
                int idx = node.storage1_offset + a * nh + h;
                storage1[idx] = strat_val * 100.0f;
                storage2[idx] = regret_val;
            }
        }
    }
}

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

    Card hero_c1 = card_from_string(hero.substr(0, 2));
    Card hero_c2 = card_from_string(hero.substr(2, 2));
    if (hero_c1 > hero_c2) std::swap(hero_c1, hero_c2);

    CardConfig cc;
    cc.num_players = 4;
    cc.ranges.push_back(Range::from_string("TT+, AQs+, AKo, KQs, QJs, JTs, 98s, 87s, A2s+, K9s+"));
    cc.ranges.push_back(Range::from_string("88+, ATs+, KQs, AQo+, QJs, JTs"));
    cc.ranges.push_back(Range::from_string("55+, A8s+, KJs+, QJs, AJo+"));
    cc.ranges.push_back(Range::from_string("22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, ATo+, KTo+"));

    uint64_t used_mask = 0;
    used_mask |= card_to_bit(hero_c1);
    used_mask |= card_to_bit(hero_c2);

    cc.flop[0] = card_from_string(board.substr(0, 2)); used_mask |= card_to_bit(cc.flop[0]);
    cc.flop[1] = card_from_string(board.substr(2, 2)); used_mask |= card_to_bit(cc.flop[1]);
    cc.flop[2] = card_from_string(board.substr(4, 2)); used_mask |= card_to_bit(cc.flop[2]);

    if (board.length() >= 8) {
        cc.turn = card_from_string(board.substr(6, 2));
        used_mask |= card_to_bit(cc.turn);
    } else {
        cc.turn = find_unused_card(used_mask, 0);
        used_mask |= card_to_bit(cc.turn);
    }

    if (board.length() >= 10) {
        cc.river = card_from_string(board.substr(8, 2));
    } else {
        cc.river = find_unused_card(used_mask, 1);
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

    if (locked_mask != 0 && profile_id > 0) {
        for (int p = 1; p < 4; ++p) {
            if (locked_mask & (1 << p)) {
                apply_node_locking_profile(game, p, static_cast<OpponentProfile>(profile_id));
            }
        }
    }

    game.set_gpu_enabled(true);
    auto gpu_mem = std::make_unique<GpuMemory>();

    if (!gpu_solver_init(game, *gpu_mem, device_id)) {
        std::cout << "{\"error\": \"GPU init failed\", \"check\": 0.5, \"bet\": 0.5, \"allin\": 0.0}" << std::endl;
        return 1;
    }

    gpu_mem->locked_players_mask = locked_mask;
    game.set_gpu_mem(std::move(gpu_mem));

    for (uint32_t iter = 1; iter <= 250; ++iter) {
        gpu_solve_step_dispatch(game, iter);
    }

    gpu_solver_copy_back(game, *game.gpu_mem());

    // ── ПОИСК ТОЧНОЙ СТРАТЕГИИ ДЛЯ РУКИ HERO ───────────────────────────
    const auto& hero_hands = game.card_config().private_cards[0];
    int hero_idx = -1;
    for (size_t i = 0; i < hero_hands.size(); ++i) {
        Card h1 = hero_hands[i].first;
        Card h2 = hero_hands[i].second;
        if (h1 > h2) std::swap(h1, h2);
        if (h1 == hero_c1 && h2 == hero_c2) {
            hero_idx = (int)i;
            break;
        }
    }

    int na = game.node_arena()[0].num_actions();
    int nh = game.num_private_hands(0);
    const float* s_data = game.storage1_data();

    float p_check = 0.5f, p_bet = 0.5f, p_allin = 0.0f;

    if (hero_idx != -1 && nh > 0) {
        std::vector<float> combo_strats(na);
        float sum_s = 0.0f;
        for (int a = 0; a < na; ++a) {
            float v = s_data[a * nh + hero_idx];
            combo_strats[a] = v;
            sum_s += v;
        }
        if (sum_s > 1e-6f) {
            for (int a = 0; a < na; ++a) combo_strats[a] /= sum_s;
        } else {
            for (int a = 0; a < na; ++a) combo_strats[a] = 1.0f / na;
        }

        p_check = combo_strats[0];
        p_bet   = (na > 1) ? combo_strats[1] : 0.0f;
        p_allin = (na > 2) ? combo_strats[2] : 0.0f;
    }

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
