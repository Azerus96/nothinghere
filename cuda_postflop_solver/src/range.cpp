// ════════════════════════════════════════════════════════════════════════
// range.cpp — Range parsing and manipulation
// ════════════════════════════════════════════════════════════════════════
#include "range.h"
#include <stdexcept>
#include <sstream>
#include <algorithm>
#include <cctype>
#include <regex>

namespace postflop {

// ── Parse a single combo like "AA", "AKs", "AKo", "AhKh" ────────────────
std::vector<std::pair<Card, Card>> Range::parse_combo(const std::string& s) {
    std::vector<std::pair<Card, Card>> result;
    if (s.size() < 2) return result;

    int r1 = rank_from_char(s[0]);
    int r2 = rank_from_char(s[1]);
    if (r1 < 0 || r2 < 0) {
        // Try suit-specified form "AhKh"
        if (s.size() == 4) {
            int ra = rank_from_char(s[0]);
            int sa = -1;
            switch (s[1]) { case 'c': case 'C': sa=0; break; case 'd': case 'D': sa=1; break;
                            case 'h': case 'H': sa=2; break; case 's': case 'S': sa=3; break; }
            int rb = rank_from_char(s[2]);
            int sb = -1;
            switch (s[3]) { case 'c': case 'C': sb=0; break; case 'd': case 'D': sb=1; break;
                            case 'h': case 'H': sb=2; break; case 's': case 'S': sb=3; break; }
            if (ra < 0 || rb < 0 || sa < 0 || sb < 0) return result;
            Card c1 = make_card(ra, sa), c2 = make_card(rb, sb);
            if (c1 > c2) std::swap(c1, c2);
            result.push_back({c1, c2});
        }
        return result;
    }

    if (s.size() == 2) {
        // Pair: AA, KK — all 6 suit combos
        if (r1 == r2) {
            for (int s1 = 0; s1 < 4; ++s1)
                for (int s2 = s1+1; s2 < 4; ++s2)
                    result.push_back({make_card(r1, s1), make_card(r1, s2)});
        } else {
            // Unspecified non-pair: BOTH suited and offsuit (4 + 12 = 16 combos)
            for (int s1 = 0; s1 < 4; ++s1)
                for (int s2 = 0; s2 < 4; ++s2) {
                    Card c1 = make_card(r1, s1), c2 = make_card(r2, s2);
                    if (c1 > c2) std::swap(c1, c2);
                    result.push_back({c1, c2});
                }
        }
    } else if (s.size() == 3) {
        // AKs or AKo
        char t = std::tolower(s[2]);
        if (t == 's') {
            for (int s1 = 0; s1 < 4; ++s1)
                result.push_back({make_card(r1, s1), make_card(r2, s1)});
        } else if (t == 'o') {
            for (int s1 = 0; s1 < 4; ++s1)
                for (int s2 = 0; s2 < 4; ++s2)
                    if (s1 != s2)
                        result.push_back({make_card(r1, s1), make_card(r2, s2)});
        }
    }
    return result;
}

// ── Expand plus ("88+") or range ("QQ-88", "A9s-A5s") ──────────────────
std::vector<std::pair<Card, Card>> Range::expand_plus_or_range(
    const std::string& head, const std::string& tail) {
    std::vector<std::pair<Card, Card>> result;

    if (tail.empty()) return parse_combo(head);

    if (tail == "+") {
        // For pairs: 88+ = 88, 99, TT, JJ, QQ, KK, AA
        // For suited/offsuit: ATs+ = ATs, AJs, AQs, AKs
        if (head.size() == 2) {
            int r1 = rank_from_char(head[0]);
            int r2 = rank_from_char(head[1]);
            if (r1 == r2) {
                for (int r = r2; r <= 12; ++r) {
                    auto c = parse_combo(std::string() + char_from_rank(r) + char_from_rank(r));
                    result.insert(result.end(), c.begin(), c.end());
                }
            } else {
                for (int r = r2; r < r1; ++r) {
                    auto c = parse_combo(std::string() + char_from_rank(r1) + char_from_rank(r));
                    result.insert(result.end(), c.begin(), c.end());
                }
            }
        } else if (head.size() == 3) {
            int r1 = rank_from_char(head[0]);
            int r2 = rank_from_char(head[1]);
            char t = std::tolower(head[2]);
            for (int r = r2; r < r1; ++r) {
                auto c = parse_combo(std::string() + char_from_rank(r1) + char_from_rank(r) + t);
                result.insert(result.end(), c.begin(), c.end());
            }
        }
    } else if (tail[0] == '-') {
        // Range like "QQ-88", "A9s-A5s", "T9o-65o"
        std::string end = tail.substr(1);
        if (head.size() == 2 && end.size() == 2) {
            int r1 = rank_from_char(head[0]);
            int r2 = rank_from_char(head[1]);
            int e1 = rank_from_char(end[0]);
            int e2 = rank_from_char(end[1]);
            if (r1 == r2 && e1 == e2) {
                int hi = std::max(r1, e1), lo = std::min(r1, e1);
                for (int r = lo; r <= hi; ++r) {
                    auto c = parse_combo(std::string() + char_from_rank(r) + char_from_rank(r));
                    result.insert(result.end(), c.begin(), c.end());
                }
            }
        } else if (head.size() == 3 && end.size() == 3) {
            int r1 = rank_from_char(head[0]);
            int r2 = rank_from_char(head[1]);
            char t1 = std::tolower(head[2]);
            int e1 = rank_from_char(end[0]);
            int e2 = rank_from_char(end[1]);
            // r1 == e1 (same high rank), e2 <= r2
            if (r1 == e1 && e2 <= r2 && t1 == std::tolower(end[2])) {
                for (int r = e2; r <= r2; ++r) {
                    auto c = parse_combo(std::string() + char_from_rank(r1) + char_from_rank(r) + t1);
                    result.insert(result.end(), c.begin(), c.end());
                }
            }
        }
    }
    return result;
}

// ── Parse full range string ─────────────────────────────────────────────
Range Range::from_string(const std::string& s) {
    Range r;
    if (s.empty()) return r;

    // Split by comma
    std::stringstream ss(s);
    std::string token;
    while (std::getline(ss, token, ',')) {
        // Trim whitespace
        size_t start = token.find_first_not_of(" \t");
        size_t end = token.find_last_not_of(" \t");
        if (start == std::string::npos) continue;
        token = token.substr(start, end - start + 1);

        // Parse weight suffix ":N"
        float weight = 1.0f;
        size_t colon = token.find(':');
        std::string combo_part = token;
        if (colon != std::string::npos) {
            combo_part = token.substr(0, colon);
            std::string w_str = token.substr(colon + 1);
            try { weight = std::stof(w_str); }
            catch (...) { throw std::invalid_argument("Bad weight: " + w_str); }
        }

        // Parse plus or dash
        std::vector<std::pair<Card, Card>> hands;
        size_t plus = combo_part.find('+');
        size_t dash = combo_part.find('-');
        if (plus != std::string::npos) {
            hands = expand_plus_or_range(combo_part.substr(0, plus), "+");
        } else if (dash != std::string::npos && dash > 0) {
            hands = expand_plus_or_range(combo_part.substr(0, dash), "-" + combo_part.substr(dash+1));
        } else {
            hands = parse_combo(combo_part);
        }

        for (auto& h : hands) {
            int idx = card_pair_to_index(h.first, h.second);
            r.data_[idx] = std::max(r.data_[idx], weight);  // take max if overlap
        }
    }
    return r;
}

// ── Get list of (hole_cards, weight) with positive weight ──────────────
std::vector<Range::HandWeight> Range::get_hands_weights(uint64_t dead_cards_mask) const {
    std::vector<HandWeight> result;
    for (int c1 = 0; c1 < 52; ++c1) {
        if (dead_cards_mask & (1ULL << c1)) continue;
        for (int c2 = c1+1; c2 < 52; ++c2) {
            if (dead_cards_mask & (1ULL << c2)) continue;
            int idx = card_pair_to_index((Card)c1, (Card)c2);
            if (data_[idx] > 0.0f) {
                result.push_back({(Card)c1, (Card)c2, data_[idx]});
            }
        }
    }
    return result;
}

// ── Suit isomorphism check ─────────────────────────────────────────────
bool Range::is_suit_isomorphic(int s1, int s2) const {
    if (s1 == s2) return true;
    for (int c1 = 0; c1 < 52; ++c1) {
        for (int c2 = c1+1; c2 < 52; ++c2) {
            int idx = card_pair_to_index((Card)c1, (Card)c2);
            // Build swapped pair
            int r1 = card_rank((Card)c1), su1 = card_suit((Card)c1);
            int r2 = card_rank((Card)c2), su2 = card_suit((Card)c2);
            int nsu1 = (su1 == s1) ? s2 : (su1 == s2 ? s1 : su1);
            int nsu2 = (su2 == s1) ? s2 : (su2 == s2 ? s1 : su2);
            Card nc1 = make_card(r1, nsu1), nc2 = make_card(r2, nsu2);
            int nidx = card_pair_to_index(nc1, nc2);
            if (data_[idx] != data_[nidx]) return false;
        }
    }
    return true;
}

// ── Compact string representation ──────────────────────────────────────
std::string Range::to_string() const {
    std::vector<std::string> parts;
    // Pairs
    for (int r = 12; r >= 0; --r) {
        float w = get_weight_pair(r);
        if (w > 0) {
            char buf[8];
            if (w == 1.0f) std::snprintf(buf, sizeof(buf), "%c%c", char_from_rank(r), char_from_rank(r));
            else std::snprintf(buf, sizeof(buf), "%c%c:%.3f", char_from_rank(r), char_from_rank(r), w);
            parts.push_back(buf);
        }
    }
    // Suited and offsuit
    for (int r1 = 12; r1 >= 0; --r1) {
        for (int r2 = r1 - 1; r2 >= 0; --r2) {
            float ws = get_weight_suited(r1, r2);
            float wo = get_weight_offsuit(r1, r2);
            char buf[16];
            if (ws > 0 && wo > 0 && ws == wo) {
                std::snprintf(buf, sizeof(buf), "%c%c", char_from_rank(r1), char_from_rank(r2));
                parts.push_back(buf);
            } else {
                if (ws > 0) {
                    if (ws == 1.0f) std::snprintf(buf, sizeof(buf), "%c%cs", char_from_rank(r1), char_from_rank(r2));
                    else std::snprintf(buf, sizeof(buf), "%c%cs:%.3f", char_from_rank(r1), char_from_rank(r2), ws);
                    parts.push_back(buf);
                }
                if (wo > 0) {
                    if (wo == 1.0f) std::snprintf(buf, sizeof(buf), "%c%co", char_from_rank(r1), char_from_rank(r2));
                    else std::snprintf(buf, sizeof(buf), "%c%co:%.3f", char_from_rank(r1), char_from_rank(r2), wo);
                    parts.push_back(buf);
                }
            }
        }
    }
    std::string result;
    for (size_t i = 0; i < parts.size(); ++i) {
        if (i) result += ",";
        result += parts[i];
    }
    return result;
}

} // namespace postflop
