#pragma once
// 读取 PE 文件里已经存在的 Authenticode 签名信息（证书表 → PKCS#7）。
// 只依赖 Windows 的 crypt32，不引入额外第三方库。
#include <string>
#include <vector>

namespace cs {
namespace siginfo {

struct CertificateInfo {
    std::string subject;     // CN 等可读名称
    std::string issuer;
    std::string serial;      // 大写十六进制
    std::string not_before;  // YYYY-MM-DD
    std::string not_after;
    std::string fingerprint; // SHA-256，大写十六进制
};

struct SignatureInfo {
    std::string digest;               // sha1 / sha256 / sha384 / sha512
    std::string signature_algorithm;  // 可读的签名算法，例如 RSA
    CertificateInfo signer;
    bool nested = false;     // 是否是嵌套签名（多摘要算法时才有）
    bool timestamped = false;
};

struct FileSignature {
    bool embedded = false;                 // 文件是否带证书表
    bool cross_signed = false;             // 证书链里是否有 Microsoft 交叉证书
    std::vector<SignatureInfo> signatures; // 顶层签名 + 嵌套签名
    std::vector<CertificateInfo> chain;    // PKCS#7 里附带的所有证书
};

/** 解析文件里的签名；文件没有签名时 embedded=false，不会失败 */
FileSignature load(const std::string &path);

/** 去重后的摘要算法列表，按签名顺序 */
std::vector<std::string> digests(const FileSignature &signature);

/** 文件字节数；读取失败返回 0 */
unsigned long long file_size(const std::string &path);

/** 人类可读的大小，例如 1.2 MB */
std::wstring format_size(unsigned long long bytes);

} // namespace siginfo
} // namespace cs
