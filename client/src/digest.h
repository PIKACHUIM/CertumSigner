#pragma once
// 摘要算法：客户端里所有 sha1 / sha256 / sha384 / sha512 的名字、长度与 OID 都从这里取
// （这里不带 OpenSSL 依赖，界面与配置代码也能直接引用）
#include <cstddef>
#include <string>

namespace cs {
namespace digest {

/** 支持的算法名：sha1 | sha256 | sha384 | sha512 */
bool valid(const std::string &algorithm);

/** 统一成小写；未知算法返回空串 */
std::string normalize(const std::string &algorithm);

/** 十六进制摘要长度（40 / 64 / 96 / 128），未知返回 0 */
size_t hex_length(const std::string &algorithm);

/** 原始摘要字节数（20 / 32 / 48 / 64），未知返回 0 */
size_t byte_length(const std::string &algorithm);

/** 摘要 OID（DigestInfo / SignerInfo 用），未知返回 nullptr */
const char *oid(const std::string &algorithm);

/** 提交给 Worker /v1/sign 的 algorithm 字段：SHA1 / SHA256 / SHA384 / SHA512 */
const char *api_name(const std::string &algorithm);

/** 界面上显示的名字：SHA-1 / SHA-256 / SHA-384 / SHA-512 */
const char *display_name(const std::string &algorithm);

} // namespace digest
} // namespace cs
