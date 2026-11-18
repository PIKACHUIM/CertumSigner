#pragma once
// 基础工具：十六进制/Base64、文件读写、路径与配置目录。
#include <cstdint>
#include <string>
#include <vector>

namespace cs {

std::string to_hex(const uint8_t *data, size_t len);
std::string to_hex(const std::string &bytes);
std::vector<uint8_t> from_hex(const std::string &hex);
bool looks_like_hex(const std::string &text, size_t expected_length);

std::string base64_encode(const std::string &bytes);
std::vector<uint8_t> base64_decode(const std::string &text);

std::string to_lower(std::string value);
std::string trim(const std::string &value);
bool starts_with(const std::string &value, const std::string &prefix);
bool ends_with(const std::string &value, const std::string &suffix);

bool read_file(const std::string &path, std::string &out, std::string &err);
bool write_file(const std::string &path, const std::string &data, std::string &err);
bool file_exists(const std::string &path);
bool is_directory(const std::string &path);
bool make_dirs(const std::string &path);
std::string join_path(const std::string &a, const std::string &b);
std::string file_name(const std::string &path);
std::string dir_name(const std::string &path);
std::string absolute_path(const std::string &path);
std::vector<std::string> list_files(const std::string &dir, bool recursive);

/** %APPDATA%\CertumSigner 或 $XDG_CONFIG_HOME/certumsigner */
std::string config_dir();
std::string config_file();
std::string now_iso8601();

std::string getenv_string(const char *name);

} // namespace cs
