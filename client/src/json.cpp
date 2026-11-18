#include "json.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

namespace cs {

namespace {

struct Parser {
    const std::string &src;
    size_t pos = 0;
    std::string err;

    explicit Parser(const std::string &text) : src(text) {}

    void skip_space() {
        while (pos < src.size()) {
            char c = src[pos];
            if (c == ' ' || c == '\t' || c == '\n' || c == '\r') {
                pos++;
            } else {
                break;
            }
        }
    }

    bool fail(const std::string &message) {
        if (err.empty()) err = message + "（位置 " + std::to_string(pos) + "）";
        return false;
    }

    static void append_utf8(std::string &out, unsigned int code) {
        if (code < 0x80) {
            out.push_back(static_cast<char>(code));
        } else if (code < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (code >> 6)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xE0 | (code >> 12)));
            out.push_back(static_cast<char>(0x80 | ((code >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (code & 0x3F)));
        }
    }

    bool parse_string(std::string &out) {
        if (pos >= src.size() || src[pos] != '"') return fail("期望字符串");
        pos++;
        while (pos < src.size()) {
            char c = src[pos++];
            if (c == '"') return true;
            if (c != '\\') {
                out.push_back(c);
                continue;
            }
            if (pos >= src.size()) return fail("字符串转义不完整");
            char esc = src[pos++];
            switch (esc) {
            case '"': out.push_back('"'); break;
            case '\\': out.push_back('\\'); break;
            case '/': out.push_back('/'); break;
            case 'b': out.push_back('\b'); break;
            case 'f': out.push_back('\f'); break;
            case 'n': out.push_back('\n'); break;
            case 'r': out.push_back('\r'); break;
            case 't': out.push_back('\t'); break;
            case 'u': {
                if (pos + 4 > src.size()) return fail("\\u 转义不完整");
                unsigned int code = 0;
                for (int i = 0; i < 4; i++) {
                    char h = src[pos++];
                    code <<= 4;
                    if (h >= '0' && h <= '9') code |= static_cast<unsigned int>(h - '0');
                    else if (h >= 'a' && h <= 'f') code |= static_cast<unsigned int>(h - 'a' + 10);
                    else if (h >= 'A' && h <= 'F') code |= static_cast<unsigned int>(h - 'A' + 10);
                    else return fail("\\u 里有非十六进制字符");
                }
                append_utf8(out, code);
                break;
            }
            default: return fail("未知转义字符");
            }
        }
        return fail("字符串没有闭合");
    }

    bool parse_value(Json &out) {
        skip_space();
        if (pos >= src.size()) return fail("内容意外结束");

        char c = src[pos];
        if (c == '{') return parse_object(out);
        if (c == '[') return parse_array(out);
        if (c == '"') {
            out.type = Json::Type::String;
            return parse_string(out.text);
        }
        if (c == 't' && src.compare(pos, 4, "true") == 0) {
            pos += 4;
            out.type = Json::Type::Bool;
            out.boolean = true;
            return true;
        }
        if (c == 'f' && src.compare(pos, 5, "false") == 0) {
            pos += 5;
            out.type = Json::Type::Bool;
            out.boolean = false;
            return true;
        }
        if (c == 'n' && src.compare(pos, 4, "null") == 0) {
            pos += 4;
            out.type = Json::Type::Null;
            return true;
        }
        if (c == '-' || (c >= '0' && c <= '9')) return parse_number(out);
        return fail("无法识别的 JSON 值");
    }

    bool parse_number(Json &out) {
        size_t start = pos;
        if (pos < src.size() && src[pos] == '-') pos++;
        while (pos < src.size() && src[pos] >= '0' && src[pos] <= '9') pos++;
        if (pos < src.size() && src[pos] == '.') {
            pos++;
            while (pos < src.size() && src[pos] >= '0' && src[pos] <= '9') pos++;
        }
        if (pos < src.size() && (src[pos] == 'e' || src[pos] == 'E')) {
            pos++;
            if (pos < src.size() && (src[pos] == '+' || src[pos] == '-')) pos++;
            while (pos < src.size() && src[pos] >= '0' && src[pos] <= '9') pos++;
        }
        if (pos == start) return fail("数字格式错误");
        out.type = Json::Type::Number;
        out.number = std::strtod(src.substr(start, pos - start).c_str(), nullptr);
        return true;
    }

    bool parse_array(Json &out) {
        pos++; // '['
        out.type = Json::Type::Array;
        skip_space();
        if (pos < src.size() && src[pos] == ']') {
            pos++;
            return true;
        }
        while (true) {
            Json item;
            if (!parse_value(item)) return false;
            out.items.push_back(std::move(item));
            skip_space();
            if (pos >= src.size()) return fail("数组没有闭合");
            if (src[pos] == ',') {
                pos++;
                continue;
            }
            if (src[pos] == ']') {
                pos++;
                return true;
            }
            return fail("数组缺少逗号或右括号");
        }
    }

    bool parse_object(Json &out) {
        pos++; // '{'
        out.type = Json::Type::Object;
        skip_space();
        if (pos < src.size() && src[pos] == '}') {
            pos++;
            return true;
        }
        while (true) {
            skip_space();
            std::string key;
            if (!parse_string(key)) return false;
            skip_space();
            if (pos >= src.size() || src[pos] != ':') return fail("对象缺少冒号");
            pos++;
            Json value;
            if (!parse_value(value)) return false;
            out.members.emplace_back(std::move(key), std::move(value));
            skip_space();
            if (pos >= src.size()) return fail("对象没有闭合");
            if (src[pos] == ',') {
                pos++;
                continue;
            }
            if (src[pos] == '}') {
                pos++;
                return true;
            }
            return fail("对象缺少逗号或右括号");
        }
    }
};

void escape_to(std::string &out, const std::string &value) {
    out.push_back('"');
    for (char c : value) {
        switch (c) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default:
            if (static_cast<unsigned char>(c) < 0x20) {
                char buffer[8];
                std::snprintf(buffer, sizeof(buffer), "\\u%04x", static_cast<unsigned char>(c));
                out += buffer;
            } else {
                out.push_back(c);
            }
        }
    }
    out.push_back('"');
}

} // namespace

bool Json::parse(const std::string &source, Json &out, std::string &err) {
    Parser parser(source);
    Json value;
    if (!parser.parse_value(value)) {
        err = parser.err;
        return false;
    }
    parser.skip_space();
    if (parser.pos != source.size()) {
        err = "JSON 末尾有多余内容";
        return false;
    }
    out = std::move(value);
    return true;
}

const Json *Json::find(const std::string &key) const {
    if (type != Type::Object) return nullptr;
    for (const auto &entry : members) {
        if (entry.first == key) return &entry.second;
    }
    return nullptr;
}

std::string Json::get_string(const std::string &key, const std::string &fallback) const {
    const Json *value = find(key);
    return value && value->type == Type::String ? value->text : fallback;
}

double Json::get_number(const std::string &key, double fallback) const {
    const Json *value = find(key);
    return value && value->type == Type::Number ? value->number : fallback;
}

bool Json::get_bool(const std::string &key, bool fallback) const {
    const Json *value = find(key);
    return value && value->type == Type::Bool ? value->boolean : fallback;
}

std::vector<std::string> Json::get_strings(const std::string &key) const {
    std::vector<std::string> out;
    const Json *value = find(key);
    if (!value || value->type != Type::Array) return out;
    for (const auto &item : value->items) {
        if (item.type == Type::String) out.push_back(item.text);
    }
    return out;
}

std::string Json::dump() const {
    std::string out;
    switch (type) {
    case Type::Null: out = "null"; break;
    case Type::Bool: out = boolean ? "true" : "false"; break;
    case Type::Number: {
        char buffer[64];
        if (number == std::floor(number) && std::fabs(number) < 1e15) {
            std::snprintf(buffer, sizeof(buffer), "%.0f", number);
        } else {
            std::snprintf(buffer, sizeof(buffer), "%.10g", number);
        }
        out = buffer;
        break;
    }
    case Type::String: escape_to(out, text); break;
    case Type::Array: {
        out.push_back('[');
        for (size_t i = 0; i < items.size(); i++) {
            if (i) out.push_back(',');
            out += items[i].dump();
        }
        out.push_back(']');
        break;
    }
    case Type::Object: {
        out.push_back('{');
        for (size_t i = 0; i < members.size(); i++) {
            if (i) out.push_back(',');
            escape_to(out, members[i].first);
            out.push_back(':');
            out += members[i].second.dump();
        }
        out.push_back('}');
        break;
    }
    }
    return out;
}

} // namespace cs
