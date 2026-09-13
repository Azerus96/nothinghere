// ════════════════════════════════════════════════════════════════════════
// preflop_engine.cpp — Module 3.1 implementation
// ════════════════════════════════════════════════════════════════════════
#include "preflop_engine.h"
#include <cstdio>
#include <cstring>
#include <cstdlib>
#include <algorithm>
#include "hand_evaluator.h"

namespace postflop::preflop {

std::size_t classify_suit_variant(const std::pair<Card, Card>& hero,
                                  const std::pair<Card, Card>& villain) {
    int h_s0 = card_suit(hero.first), h_s1 = card_suit(hero.second);
    int v_s0 = card_suit(villain.first), v_s1 = card_suit(villain.second);
    std::size_t shared = 0;
    for (int s = 0; s < 4; ++s) {
        bool in_hero = (h_s0 == s || h_s1 == s);
        bool in_villain = (v_s0 == s || v_s1 == s);
        if (in_hero && in_villain) ++shared;
    }
    return shared == 0 ? 0 : (shared == 1 ? 1 : 2);
}

static const char TABLE_MAGIC[4] = {'P', 'F', 'T', 'B'};
static const uint32_t TABLE_VERSION = 1;

#pragma pack(push, 1)
struct TableHeader {
    char magic[4];
    uint32_t version;
    uint32_t classes;
    uint32_t variants;
    uint32_t dtype;   // bytes per element (8 = double)
};
#pragma pack(pop)

bool PreflopEquityTable::load(const std::string& path) {
    FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return false;
    TableHeader hdr;
    if (std::fread(&hdr, sizeof(hdr), 1, f) != 1) { std::fclose(f); return false; }
    if (std::memcmp(hdr.magic, TABLE_MAGIC, 4) != 0) { std::fclose(f); return false; }
    if (hdr.version != TABLE_VERSION || hdr.classes != NUM_CLASSES ||
        hdr.variants != NUM_SUIT_VARIANTS || hdr.dtype != sizeof(double)) {
        std::fclose(f); return false;
    }
    data.resize(EQUITY_TABLE_SIZE);
    size_t got = std::fread(data.data(), sizeof(double), EQUITY_TABLE_SIZE, f);
    std::fclose(f);
    if (got != EQUITY_TABLE_SIZE) { data.clear(); return false; }
    loaded = true;
    return true;
}

bool PreflopEquityTable::save(const std::string& path) const {
    if (data.size() != EQUITY_TABLE_SIZE) return false;
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) return false;
    TableHeader hdr;
    std::memcpy(hdr.magic, TABLE_MAGIC, 4);
    hdr.version = TABLE_VERSION;
    hdr.classes = (uint32_t)NUM_CLASSES;
    hdr.variants = (uint32_t)NUM_SUIT_VARIANTS;
    hdr.dtype = (uint32_t)sizeof(double);
    if (std::fwrite(&hdr, sizeof(hdr), 1, f) != 1) { std::fclose(f); return false; }
    size_t put = std::fwrite(data.data(), sizeof(double), EQUITY_TABLE_SIZE, f);
    std::fclose(f);
    return put == EQUITY_TABLE_SIZE;
}

PreflopEquityTable& global_preflop_table() {
    static PreflopEquityTable table;
    return table;
}

std::string default_table_path() {
    if (const char* env = std::getenv("POSTFLOP_TABLE_PATH")) {
        if (*env) return std::string(env);
    }
    return std::string("preflop_table.bin");
}

PushFoldDecision push_fold_call_decision(const std::pair<Card, Card>& hero,
                                         const std::pair<Card, Card>& villain_range_rep,
                                         int32_t pot_before, int32_t to_call) {
    PushFoldDecision d{};
    const PreflopEquityTable& tbl = global_preflop_table();
    d.equity = tbl.equity_cards(hero, villain_range_rep);

    // Break-even equity for calling an all-in shove:
    //   EV(call) = eq * (pot_before + 2*to_call - to_call)... in net terms:
    //   call risks `to_call` to win `pot_before + to_call` (the pot after
    //   the shove, excluding our call).
    double risk = (double)to_call;
    double reward = (double)pot_before + (double)to_call;
    d.required = (risk > 0.0) ? risk / (risk + reward) : 0.0;
    d.ev_call = d.equity * reward - (1.0 - d.equity) * risk;
    d.should_call = d.equity >= d.required;
    return d;
}

bool should_shove(const std::pair<Card, Card>& hero, double stack_bb,
                  double open_threshold_equity) {
    (void)stack_bb;  // chart thresholds may be stack-dependent; the default
                     // uses a single equity bar documented in the report.
    const PreflopEquityTable& tbl = global_preflop_table();
    // Blend the villain calling classes with natural weights (pairs heavier).
    // A hand shoves when its average equity vs the blended calling range
    // clears the threshold.
    double total_w = 0.0, acc = 0.0;
    int hr1 = card_rank(hero.first), hr2 = card_rank(hero.second);
    bool suited = card_suit(hero.first) == card_suit(hero.second);
    uint16_t hc = class_index((uint8_t)std::max(hr1, hr2), (uint8_t)std::min(hr1, hr2), suited);
    for (uint16_t vc = 0; vc < NUM_CLASSES; ++vc) {
        int combos;
        if (vc <= 12) combos = 6;                                   // pair
        else if (vc <= 90) combos = 4;                              // suited
        else combos = 12;                                           // offsuit
        acc += combos * tbl.equity(hc, vc, 0);
        total_w += combos;
    }
    double avg_eq = (total_w > 0) ? acc / total_w : 0.5;
    return avg_eq >= open_threshold_equity;
}

} // namespace postflop::preflop
