#include "digest.h"

namespace cs {
namespace digest {

namespace {

struct Entry {
    const char *name;
    size_t bytes;
    const char *oid;
    const char *api;
    const char *display;
};

const Entry kEntries[] = {
    {"sha1", 20, "1.3.14.3.2.26", "SHA1", "SHA-1"},
    {"sha256", 32, "2.16.840.1.101.3.4.2.1", "SHA256", "SHA-256"},
    {"sha384", 48, "2.16.840.1.101.3.4.2.2", "SHA384", "SHA-384"},
    {"sha512", 64, "2.16.840.1.101.3.4.2.3", "SHA512", "SHA-512"},
};

const Entry *find(const std::string &algorithm) {
    const std::string key = normalize(algorithm);
    for (const auto &entry : kEntries) {
        if (key == entry.name) return &entry;
    }
    return nullptr;
}

} // namespace

std::string normalize(const std::string &algorithm) {
    std::string out;
    out.reserve(algorithm.size());
    for (char ch : algorithm) {
        if (ch == '-' || ch == '_' || ch == ' ') continue;
        if (ch >= 'A' && ch <= 'Z') {
            out.push_back(static_cast<char>(ch - 'A' + 'a'));
        } else {
            out.push_back(ch);
        }
    }
    return out;
}

bool valid(const std::string &algorithm) {
    return find(algorithm) != nullptr;
}

size_t hex_length(const std::string &algorithm) {
    const Entry *entry = find(algorithm);
    return entry ? entry->bytes * 2 : 0;
}

size_t byte_length(const std::string &algorithm) {
    const Entry *entry = find(algorithm);
    return entry ? entry->bytes : 0;
}

const char *oid(const std::string &algorithm) {
    const Entry *entry = find(algorithm);
    return entry ? entry->oid : nullptr;
}

const char *api_name(const std::string &algorithm) {
    const Entry *entry = find(algorithm);
    return entry ? entry->api : nullptr;
}

const char *display_name(const std::string &algorithm) {
    const Entry *entry = find(algorithm);
    return entry ? entry->display : nullptr;
}

} // namespace digest
} // namespace cs
