#pragma once
// 手写 DER 编码器。Authenticode 的 PKCS#7 需要“内容不是 OCTET STRING”的
// 老式 PKCS#7 结构，OpenSSL 的 CMS API 编不出来，所以这里自己拼字节。
#include <string>

namespace cs {
namespace der {

std::string encode_length(size_t length);
std::string tlv(unsigned char tag, const std::string &content);

std::string sequence(const std::string &content);
std::string set(const std::string &content);
std::string integer(long value);
std::string null_value();
std::string oid(const std::string &dotted);
std::string octet_string(const std::string &bytes);
std::string bit_string(const std::string &bytes, int unused_bits = 0);

/** [n] EXPLICIT / constructed */
std::string context(int index, const std::string &content);
/** [n] IMPLICIT primitive（例如 [0] BMPString） */
std::string context_primitive(int index, const std::string &content);

/** 把 ASCII 文本编码成 UTF-16BE 的 BMPString 内容 */
std::string bmp_string(const std::string &ascii);

std::string algorithm_identifier(const std::string &dotted, bool with_null = true);

/** 是否是一个完整的 DER 元素（用于组装后的自检） */
bool is_complete_element(const std::string &der);

/**
 * 取出一个 DER 元素的“内容字节”（去掉 tag 与长度）。
 * Authenticode 的 messageDigest 算的是 SpcIndirectDataContent 的内容字节，
 * 不是连 SEQUENCE 头一起算——这点和直觉相反，用真实签名验证过。
 */
bool content_octets(const std::string &encoded, std::string &out);

} // namespace der
} // namespace cs
