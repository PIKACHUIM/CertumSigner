#pragma once
// 本机 Key 生成：明文只在这里产生，发给平台的只有 SHA-256
#include <string>

namespace cs {
namespace keygen {

/** 生成一把 csk_ 开头的 Key；同时给出十六进制 SHA-256 与前 12 位前缀（上传用） */
bool generate(std::string &plaintext, std::string &hash_hex, std::string &prefix, std::string &err);

/** 计算任意字符串的 SHA-256 十六进制（小写） */
std::string sha256_hex(const std::string &text);

} // namespace keygen
} // namespace cs
