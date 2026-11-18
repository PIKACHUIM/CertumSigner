#pragma once
// Authenticode 的 SpcIndirectDataContent
#include <string>

namespace cs {
namespace spc {

/** 由文件摘要构造 SpcIndirectDataContent（PKCS#7 的 eContent）；algorithm 为 sha1/sha256/sha384/sha512 */
std::string build(const std::string &file_digest, const std::string &algorithm);

} // namespace spc
} // namespace cs
