#pragma once
// Authenticode 的 SpcIndirectDataContent
#include <string>

namespace cs {
namespace spc {

/** 由文件摘要构造 SpcIndirectDataContent（PKCS#7 的 eContent） */
std::string build(const std::string &file_digest, bool sha1);

} // namespace spc
} // namespace cs
