#include "util.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <system_error>

namespace fs = std::filesystem;

namespace cs {

namespace {
const char *kHex = "0123456789abcdef";
const char *kB64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

int b64_value(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+') return 62;
    if (c == '/') return 63;
    return -1;
}
} // namespace

std::string to_hex(const uint8_t *data, size_t len) {
    std::string out;
    out.resize(len * 2);
    for (size_t i = 0; i < len; i++) {
        out[i * 2] = kHex[data[i] >> 4];
        out[i * 2 + 1] = kHex[data[i] & 0x0F];
    }
    return out;
}

std::string to_hex(const std::string &bytes) {
    return to_hex(reinterpret_cast<const uint8_t *>(bytes.data()), bytes.size());
}

std::vector<uint8_t> from_hex(const std::string &hex) {
    std::vector<uint8_t> out;
    std::string clean;
    for (char c : hex) {
        if (c == ' ' || c == '\n' || c == '\r' || c == '\t' || c == ':' || c == '-') continue;
        clean.push_back(c);
    }
    if (clean.size() % 2 != 0) return out;
    out.reserve(clean.size() / 2);
    auto nibble = [](char c) -> int {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    };
    for (size_t i = 0; i < clean.size(); i += 2) {
        int hi = nibble(clean[i]);
        int lo = nibble(clean[i + 1]);
        if (hi < 0 || lo < 0) return {};
        out.push_back(static_cast<uint8_t>((hi << 4) | lo));
    }
    return out;
}

bool looks_like_hex(const std::string &text, size_t expected_length) {
    if (text.size() != expected_length) return false;
    for (char c : text) {
        bool ok = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
        if (!ok) return false;
    }
    return true;
}

std::string base64_encode(const std::string &bytes) {
    std::string out;
    size_t i = 0;
    const auto *data = reinterpret_cast<const unsigned char *>(bytes.data());
    while (i + 2 < bytes.size()) {
        uint32_t n = (static_cast<uint32_t>(data[i]) << 16) |
                     (static_cast<uint32_t>(data[i + 1]) << 8) | data[i + 2];
        out.push_back(kB64[(n >> 18) & 63]);
        out.push_back(kB64[(n >> 12) & 63]);
        out.push_back(kB64[(n >> 6) & 63]);
        out.push_back(kB64[n & 63]);
        i += 3;
    }
    size_t remain = bytes.size() - i;
    if (remain == 1) {
        uint32_t n = static_cast<uint32_t>(data[i]) << 16;
        out.push_back(kB64[(n >> 18) & 63]);
        out.push_back(kB64[(n >> 12) & 63]);
        out += "==";
    } else if (remain == 2) {
        uint32_t n = (static_cast<uint32_t>(data[i]) << 16) | (static_cast<uint32_t>(data[i + 1]) << 8);
        out.push_back(kB64[(n >> 18) & 63]);
        out.push_back(kB64[(n >> 12) & 63]);
        out.push_back(kB64[(n >> 6) & 63]);
        out.push_back('=');
    }
    return out;
}

std::vector<uint8_t> base64_decode(const std::string &text) {
    std::vector<uint8_t> out;
    int buffer = 0;
    int bits = 0;
    for (char c : text) {
        if (c == '=' || c == '\n' || c == '\r' || c == ' ' || c == '\t') continue;
        int value = b64_value(c);
        if (value < 0) return {};
        buffer = (buffer << 6) | value;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<uint8_t>((buffer >> bits) & 0xFF));
        }
    }
    return out;
}

std::string to_lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return value;
}

std::string trim(const std::string &value) {
    size_t begin = 0;
    size_t end = value.size();
    while (begin < end && std::isspace(static_cast<unsigned char>(value[begin]))) begin++;
    while (end > begin && std::isspace(static_cast<unsigned char>(value[end - 1]))) end--;
    return value.substr(begin, end - begin);
}

bool starts_with(const std::string &value, const std::string &prefix) {
    return value.size() >= prefix.size() && value.compare(0, prefix.size(), prefix) == 0;
}

bool ends_with(const std::string &value, const std::string &suffix) {
    return value.size() >= suffix.size() &&
           value.compare(value.size() - suffix.size(), suffix.size(), suffix) == 0;
}

bool read_file(const std::string &path, std::string &out, std::string &err) {
    try {
        // 必须走 filesystem::path：Windows 上窄字符路径按 ANSI 解释，
        // 含中文的路径（如 D:\下载\…）用 ifstream(string) 会直接打不开
        std::ifstream stream(fs::u8path(path), std::ios::binary);
        if (!stream) {
            err = "无法打开文件：" + path;
            return false;
        }
        std::string data((std::istreambuf_iterator<char>(stream)), std::istreambuf_iterator<char>());
        if (stream.bad()) {
            err = "读取文件失败：" + path;
            return false;
        }
        out.swap(data);
        return true;
    } catch (const std::exception &) {
        err = "无法打开文件：" + path;
        return false;
    }
}

bool write_file(const std::string &path, const std::string &data, std::string &err) {
    try {
        std::ofstream stream(fs::u8path(path), std::ios::binary | std::ios::trunc);
        if (!stream) {
            err = "无法写入文件：" + path;
            return false;
        }
        stream.write(data.data(), static_cast<std::streamsize>(data.size()));
        if (!stream) {
            err = "写入文件失败：" + path;
            return false;
        }
        return true;
    } catch (const std::exception &) {
        err = "无法写入文件：" + path;
        return false;
    }
}

bool file_exists(const std::string &path) {
    std::error_code ec;
    return fs::exists(fs::u8path(path), ec);
}

bool is_directory(const std::string &path) {
    std::error_code ec;
    return fs::is_directory(fs::u8path(path), ec);
}

bool make_dirs(const std::string &path) {
    std::error_code ec;
    fs::create_directories(fs::u8path(path), ec);
    return !ec;
}

std::string join_path(const std::string &a, const std::string &b) {
    return (fs::u8path(a) / fs::u8path(b)).u8string();
}

std::string file_name(const std::string &path) {
    return fs::u8path(path).filename().u8string();
}

std::string dir_name(const std::string &path) {
    return fs::u8path(path).parent_path().u8string();
}

std::string absolute_path(const std::string &path) {
    std::error_code ec;
    auto result = fs::absolute(fs::u8path(path), ec);
    return ec ? path : result.u8string();
}

std::vector<std::string> list_files(const std::string &dir, bool recursive) {
    std::vector<std::string> files;
    std::error_code ec;
    if (!fs::is_directory(fs::u8path(dir), ec)) return files;
    if (recursive) {
        for (auto it = fs::recursive_directory_iterator(fs::u8path(dir), ec);
             it != fs::recursive_directory_iterator(); it.increment(ec)) {
            if (ec) break;
            if (it->is_regular_file(ec)) files.push_back(it->path().u8string());
        }
    } else {
        for (auto it = fs::directory_iterator(fs::u8path(dir), ec); it != fs::directory_iterator();
             it.increment(ec)) {
            if (ec) break;
            if (it->is_regular_file(ec)) files.push_back(it->path().u8string());
        }
    }
    std::sort(files.begin(), files.end());
    return files;
}

std::string getenv_string(const char *name) {
#if defined(_WIN32)
    char *buffer = nullptr;
    size_t size = 0;
    if (_dupenv_s(&buffer, &size, name) != 0 || !buffer) return {};
    std::string value(buffer);
    free(buffer);
    return value;
#else
    const char *value = std::getenv(name);
    return value ? std::string(value) : std::string();
#endif
}

std::string config_dir() {
#if defined(_WIN32)
    std::string appdata = getenv_string("APPDATA");
    if (appdata.empty()) appdata = getenv_string("USERPROFILE");
    return join_path(appdata.empty() ? "." : appdata, "CertumSigner");
#else
    std::string xdg = getenv_string("XDG_CONFIG_HOME");
    if (!xdg.empty()) return join_path(xdg, "certumsigner");
    std::string home = getenv_string("HOME");
    return join_path(home.empty() ? "." : home, ".config/certumsigner");
#endif
}

std::string config_file() { return join_path(config_dir(), "config.json"); }

std::string now_iso8601() {
    std::time_t now = std::time(nullptr);
    std::tm utc{};
#if defined(_WIN32)
    gmtime_s(&utc, &now);
#else
    gmtime_r(&now, &utc);
#endif
    char buffer[32];
    std::strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utc);
    return buffer;
}

} // namespace cs
