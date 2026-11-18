#pragma once
// PE 文件的 Authenticode 摘要计算与签名写入。
#include <cstddef>
#include <string>

namespace cs {
namespace pe {

struct Layout {
    size_t checksum_offset = 0;      // OptionalHeader.CheckSum 的文件偏移
    size_t security_dir_offset = 0;  // DataDirectory[4]（证书表）的文件偏移
    size_t cert_table_offset = 0;    // 已有证书表的文件偏移，0 表示没有
    size_t cert_table_size = 0;
    size_t file_size = 0;
    bool valid = false;
};

bool analyze(const std::string &data, Layout &out, std::string &err);
bool analyze_file(const std::string &path, Layout &out, std::string &err);

/**
 * Authenticode 摘要：
 *   跳过 Checksum（4 字节）、证书表目录项（8 字节）以及证书表本身。
 */
bool authentihash(const std::string &path, bool sha1, std::string &digest, std::string &err);

/** 把 PKCS#7 写入 PE 的证书表（会先移除旧签名），并重算校验和 */
bool embed(const std::string &path, const std::string &pkcs7, std::string &err);

/** 文件是否已经带证书表 */
bool has_signature(const std::string &path);

} // namespace pe
} // namespace cs
