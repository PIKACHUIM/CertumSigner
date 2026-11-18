#include "der.h"

#include <cstdio>
#include <vector>

namespace cs {
namespace der {

std::string encode_length(size_t length) {
    std::string out;
    if (length < 0x80) {
        out.push_back(static_cast<char>(length));
        return out;
    }
    std::vector<unsigned char> bytes;
    size_t value = length;
    while (value > 0) {
        bytes.insert(bytes.begin(), static_cast<unsigned char>(value & 0xFF));
        value >>= 8;
    }
    out.push_back(static_cast<char>(0x80 | bytes.size()));
    for (unsigned char b : bytes) out.push_back(static_cast<char>(b));
    return out;
}

std::string tlv(unsigned char tag, const std::string &content) {
    std::string out;
    out.reserve(content.size() + 6);
    out.push_back(static_cast<char>(tag));
    out += encode_length(content.size());
    out += content;
    return out;
}

std::string sequence(const std::string &content) { return tlv(0x30, content); }
std::string set(const std::string &content) { return tlv(0x31, content); }

std::string integer(long value) {
    if (value == 0) return tlv(0x02, std::string(1, '\0'));
    std::vector<unsigned char> bytes;
    long remaining = value;
    while (remaining > 0) {
        bytes.insert(bytes.begin(), static_cast<unsigned char>(remaining & 0xFF));
        remaining >>= 8;
    }
    // 最高位是 1 时要补一个 0x00，否则会被当成负数
    if (!bytes.empty() && (bytes[0] & 0x80)) bytes.insert(bytes.begin(), 0x00);
    return tlv(0x02, std::string(reinterpret_cast<const char *>(bytes.data()), bytes.size()));
}

std::string null_value() { return tlv(0x05, std::string()); }

std::string oid(const std::string &dotted) {
    std::vector<unsigned long> arcs;
    unsigned long current = 0;
    bool has_digit = false;
    for (char c : dotted) {
        if (c == '.') {
            arcs.push_back(current);
            current = 0;
            has_digit = false;
        } else if (c >= '0' && c <= '9') {
            current = current * 10 + static_cast<unsigned long>(c - '0');
            has_digit = true;
        } else {
            return {};
        }
    }
    if (has_digit) arcs.push_back(current);
    if (arcs.size() < 2) return {};

    std::string body;
    unsigned long first = arcs[0] * 40 + arcs[1];
    auto append_arc = [&body](unsigned long value) {
        unsigned char stack[10];
        int count = 0;
        do {
            stack[count++] = static_cast<unsigned char>(value & 0x7F);
            value >>= 7;
        } while (value > 0);
        for (int i = count - 1; i >= 0; i--) {
            unsigned char byte = stack[i];
            if (i != 0) byte |= 0x80;
            body.push_back(static_cast<char>(byte));
        }
    };
    append_arc(first);
    for (size_t i = 2; i < arcs.size(); i++) append_arc(arcs[i]);
    return tlv(0x06, body);
}

std::string octet_string(const std::string &bytes) { return tlv(0x04, bytes); }

std::string bit_string(const std::string &bytes, int unused_bits) {
    std::string content(1, static_cast<char>(unused_bits & 0x07));
    content += bytes;
    return tlv(0x03, content);
}

std::string context(int index, const std::string &content) {
    return tlv(static_cast<unsigned char>(0xA0 | (index & 0x1F)), content);
}

std::string context_primitive(int index, const std::string &content) {
    return tlv(static_cast<unsigned char>(0x80 | (index & 0x1F)), content);
}

std::string bmp_string(const std::string &ascii) {
    std::string out;
    out.reserve(ascii.size() * 2);
    for (char c : ascii) {
        out.push_back('\0');
        out.push_back(c);
    }
    return out;
}

std::string algorithm_identifier(const std::string &dotted, bool with_null) {
    std::string body = oid(dotted);
    if (body.empty()) return {};
    if (with_null) body += null_value();
    return sequence(body);
}

bool is_complete_element(const std::string &encoded) {
    if (encoded.size() < 2) return false;
    size_t pos = 1;
    size_t length = 0;
    unsigned char first = static_cast<unsigned char>(encoded[pos++]);
    if (first < 0x80) {
        length = first;
    } else {
        size_t count = first & 0x7F;
        if (count == 0 || count > 4) return false;
        if (pos + count > encoded.size()) return false;
        length = 0;
        for (size_t i = 0; i < count; i++) {
            length = (length << 8) | static_cast<unsigned char>(encoded[pos++]);
        }
    }
    return pos + length == encoded.size();
}

bool content_octets(const std::string &encoded, std::string &out) {
    out.clear();
    if (encoded.size() < 2) return false;
    size_t pos = 1;
    size_t length = 0;
    unsigned char first = static_cast<unsigned char>(encoded[pos++]);
    if (first < 0x80) {
        length = first;
    } else {
        size_t count = first & 0x7F;
        if (count == 0 || count > 4 || pos + count > encoded.size()) return false;
        for (size_t i = 0; i < count; i++) {
            length = (length << 8) | static_cast<unsigned char>(encoded[pos++]);
        }
    }
    if (pos + length > encoded.size()) return false;
    out.assign(encoded, pos, length);
    return true;
}

} // namespace der
} // namespace cs
