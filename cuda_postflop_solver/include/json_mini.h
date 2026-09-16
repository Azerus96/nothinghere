// ════════════════════════════════════════════════════════════════════════
// json_mini.h — dependency-free single-line JSON parser/serializer
// ════════════════════════════════════════════════════════════════════════
// Recursive descent over a complete JSON document (objects, arrays, string
// escapes, numbers, booleans, null). Used by the live_solver daemon
// protocol (Defect 1.6) so the service stays dependency-free.
// ════════════════════════════════════════════════════════════════════════
#ifndef JSON_MINI_H
#define JSON_MINI_H

#include <string>
#include <vector>
#include <unordered_map>
#include <memory>
#include <cstdlib>
#include <cstring>
#include <stdexcept>
#include <utility>

enum class JsonType { Null, Bool, Number, String, Array, Object };

struct JsonValue;

// PIMPL-обертка для поддержки рекурсивных типов на GCC 11 / Clang / MSVC
class JsonObject {
public:
    using MapType = std::unordered_map<std::string, JsonValue>;
    using iterator = MapType::iterator;
    using const_iterator = MapType::const_iterator;

private:
    mutable std::shared_ptr<MapType> map_;
    void ensure_map() const;

public:
    JsonObject();
    ~JsonObject();
    JsonObject(const JsonObject&);
    JsonObject& operator=(const JsonObject&);
    JsonObject(JsonObject&&) noexcept;
    JsonObject& operator=(JsonObject&&) noexcept;

    iterator begin();
    iterator end();
    const_iterator begin() const;
    const_iterator end() const;

    size_t size() const;
    bool empty() const;

    iterator find(const std::string& key);
    const_iterator find(const std::string& key) const;

    JsonValue& operator[](const std::string& key);
};

struct JsonValue {
    JsonType type = JsonType::Null;
    double num = 0.0;
    bool boolean = false;
    std::string str;
    std::vector<JsonValue> arr;
    JsonObject obj; // Фиксированный размер 16 байт, компилируется на любых GCC

    static JsonValue make_null() { return JsonValue{}; }
    static JsonValue jnum(double v) { JsonValue j; j.type = JsonType::Number; j.num = v; return j; }
    static JsonValue jstr(const std::string& s) { JsonValue j; j.type = JsonType::String; j.str = s; return j; }
    static JsonValue jbool(bool b) { JsonValue j; j.type = JsonType::Bool; j.boolean = b; return j; }

    bool is_number() const { return type == JsonType::Number; }
    bool is_string() const { return type == JsonType::String; }
};

// Реализация методов JsonObject после полного закрытия JsonValue
inline void JsonObject::ensure_map() const {
    if (!map_) map_ = std::make_shared<MapType>();
}

inline JsonObject::JsonObject() = default;
inline JsonObject::~JsonObject() = default;
inline JsonObject::JsonObject(const JsonObject&) = default;
inline JsonObject& JsonObject::operator=(const JsonObject&) = default;
inline JsonObject::JsonObject(JsonObject&&) noexcept = default;
inline JsonObject& JsonObject::operator=(JsonObject&&) noexcept = default;

inline JsonObject::iterator JsonObject::begin() { ensure_map(); return map_->begin(); }
inline JsonObject::iterator JsonObject::end() { ensure_map(); return map_->end(); }
inline JsonObject::const_iterator JsonObject::begin() const { ensure_map(); return map_->begin(); }
inline JsonObject::const_iterator JsonObject::end() const { ensure_map(); return map_->end(); }

inline size_t JsonObject::size() const { return map_ ? map_->size() : 0; }
inline bool JsonObject::empty() const { return map_ ? map_->empty() : true; }

inline JsonObject::iterator JsonObject::find(const std::string& key) {
    ensure_map();
    return map_->find(key);
}

inline JsonObject::const_iterator JsonObject::find(const std::string& key) const {
    ensure_map();
    return map_->find(key);
}

inline JsonValue& JsonObject::operator[](const std::string& key) {
    ensure_map();
    return (*map_)[key];
}

namespace json_mini_detail {

struct Parser {
    const char* p;
    const char* end;

    void skip_ws() {
        while (p < end && (*p == ' ' || *p == '\t' || *p == '\r' || *p == '\n')) ++p;
    }

    [[noreturn]] void fail(const std::string& msg) {
        throw std::runtime_error(msg + " at offset " + std::to_string(p - (end - (end - p))));
    }

    char peek() {
        if (p >= end) throw std::runtime_error("unexpected end of input");
        return *p;
    }

    void expect(char c) {
        if (p >= end || *p != c) throw std::runtime_error(std::string("expected '") + c + "'");
        ++p;
    }

    JsonValue parse_value() {
        skip_ws();
        char c = peek();
        switch (c) {
            case '{': return parse_object();
            case '[': return parse_array();
            case '"': {
                JsonValue j; j.type = JsonType::String; j.str = parse_string(); return j;
            }
            case 't': literal("true");  return JsonValue::jbool(true);
            case 'f': literal("false"); return JsonValue::jbool(false);
            case 'n': literal("null");  return JsonValue::make_null();
            default:  return parse_number();
        }
    }

    void literal(const char* lit) {
        size_t n = std::strlen(lit);
        if ((size_t)(end - p) < n || std::strncmp(p, lit, n) != 0)
            throw std::runtime_error(std::string("bad literal, expected ") + lit);
        p += n;
    }

    JsonValue parse_object() {
        JsonValue j; j.type = JsonType::Object;
        expect('{');
        skip_ws();
        if (peek() == '}') { ++p; return j; }
        while (true) {
            skip_ws();
            std::string key = parse_string();
            skip_ws();
            expect(':');
            j.obj[key] = parse_value();
            skip_ws();
            char c = peek();
            if (c == ',') { ++p; continue; }
            if (c == '}') { ++p; break; }
            throw std::runtime_error("expected ',' or '}' in object");
        }
        return j;
    }

    JsonValue parse_array() {
        JsonValue j; j.type = JsonType::Array;
        expect('[');
        skip_ws();
        if (peek() == ']') { ++p; return j; }
        while (true) {
            j.arr.push_back(parse_value());
            skip_ws();
            char c = peek();
            if (c == ',') { ++p; continue; }
            if (c == ']') { ++p; break; }
            throw std::runtime_error("expected ',' or ']' in array");
        }
        return j;
    }

    std::string parse_string() {
        expect('"');
        std::string out;
        while (true) {
            if (p >= end) throw std::runtime_error("unterminated string");
            char c = *p++;
            if (c == '"') break;
            if (c == '\\') {
                if (p >= end) throw std::runtime_error("unterminated escape");
                char e = *p++;
                switch (e) {
                    case '"':  out += '"';  break;
                    case '\\': out += '\\'; break;
                    case '/':  out += '/';  break;
                    case 'b':  out += '\b'; break;
                    case 'f':  out += '\f'; break;
                    case 'n':  out += '\n'; break;
                    case 'r':  out += '\r'; break;
                    case 't':  out += '\t'; break;
                    case 'u': {
                        if (end - p < 4) throw std::runtime_error("bad \\u escape");
                        unsigned code = 0;
                        for (int i = 0; i < 4; ++i) {
                            char h = *p++;
                            code <<= 4;
                            if (h >= '0' && h <= '9') code |= (unsigned)(h - '0');
                            else if (h >= 'a' && h <= 'f') code |= (unsigned)(h - 'a' + 10);
                            else if (h >= 'A' && h <= 'F') code |= (unsigned)(h - 'A' + 10);
                            else throw std::runtime_error("bad hex in \\u escape");
                        }
                        if (code < 0x80) out += (char)code;
                        else if (code < 0x800) {
                            out += (char)(0xC0 | (code >> 6));
                            out += (char)(0x80 | (code & 0x3F));
                        } else {
                            out += (char)(0xE0 | (code >> 12));
                            out += (char)(0x80 | ((code >> 6) & 0x3F));
                            out += (char)(0x80 | (code & 0x3F));
                        }
                        break;
                    }
                    default: throw std::runtime_error("unknown escape");
                }
            } else {
                out += c;
            }
        }
        return out;
    }

    JsonValue parse_number() {
        const char* start = p;
        if (p < end && *p == '-') ++p;
        while (p < end && ((*p >= '0' && *p <= '9') || *p == '.' || *p == 'e' ||
                           *p == 'E' || *p == '+' || *p == '-')) ++p;
        if (p == start) throw std::runtime_error("invalid number");
        std::string tok(start, p);
        JsonValue j; j.type = JsonType::Number;
        j.num = std::strtod(tok.c_str(), nullptr);
        return j;
    }
};

inline void escape_into(const std::string& s, std::string& out) {
    out += '"';
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if ((unsigned char)c < 0x20) {
                    char buf[8];
                    std::snprintf(buf, sizeof(buf), "\\u%04x", (unsigned)(unsigned char)c);
                    out += buf;
                } else {
                    out += c;
                }
        }
    }
    out += '"';
}

inline void serialize_value(const JsonValue& v, std::string& out) {
    switch (v.type) {
        case JsonType::Null:   out += "null"; break;
        case JsonType::Bool:   out += v.boolean ? "true" : "false"; break;
        case JsonType::Number: {
            double r = v.num < 0 ? -v.num : v.num;
            if (v.num == (double)(long long)v.num && r < 1e15) {
                char buf[32];
                std::snprintf(buf, sizeof(buf), "%lld", (long long)v.num);
                out += buf;
            } else {
                char buf[32];
                std::snprintf(buf, sizeof(buf), "%.10g", v.num);
                out += buf;
            }
            break;
        }
        case JsonType::String: escape_into(v.str, out); break;
        case JsonType::Array: {
            out += '[';
            for (size_t i = 0; i < v.arr.size(); ++i) {
                if (i) out += ',';
                serialize_value(v.arr[i], out);
            }
            out += ']';
            break;
        }
        case JsonType::Object: {
            out += '{';
            bool first = true;
            for (const auto& kv : v.obj) {
                if (!first) out += ',';
                first = false;
                escape_into(kv.first, out);
                out += ':';
                serialize_value(kv.second, out);
            }
            out += '}';
            break;
        }
    }
}

} // namespace json_mini_detail

inline JsonValue json_parse(const std::string& text) {
    json_mini_detail::Parser p{text.data(), text.data() + text.size()};
    JsonValue v = p.parse_value();
    p.skip_ws();
    return v;
}

inline std::string json_serialize(const JsonValue& v) {
    std::string out;
    json_mini_detail::serialize_value(v, out);
    return out;
}

inline double json_get_double(const JsonValue& v, const std::string& key, double def) {
    auto it = v.obj.find(key);
    if (it == v.obj.end() || it->second.type != JsonType::Number) return def;
    return it->second.num;
}
inline long long json_get_int(const JsonValue& v, const std::string& key, long long def) {
    return (long long)json_get_double(v, key, (double)def);
}
inline std::string json_get_string(const JsonValue& v, const std::string& key, const std::string& def) {
    auto it = v.obj.find(key);
    if (it == v.obj.end() || it->second.type != JsonType::String) return def;
    return it->second.str;
}
inline const std::vector<JsonValue>& json_get_array(const JsonValue& v, const std::string& key) {
    static const std::vector<JsonValue> empty;
    auto it = v.obj.find(key);
    if (it == v.obj.end() || it->second.type != JsonType::Array) return empty;
    return it->second.arr;
}
inline const std::vector<JsonValue>& json_get_array_of(const JsonValue& v) {
    static const std::vector<JsonValue> empty;
    if (v.type != JsonType::Array) return empty;
    return v.arr;
}

#endif // JSON_MINI_H
