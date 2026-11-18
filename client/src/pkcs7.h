#pragma once
// 组装 Authenticode 的 PKCS#7 SignedData（签名由云端返回，私钥不在本机）。
#include <string>
#include <vector>

namespace cs {

struct CertificateBlob {
    std::string der;
    std::string issuer_der;  // Name（RDNSequence）的 DER
    std::string serial_der;  // INTEGER 的 DER
    std::string subject;
    std::string not_after;
    std::string fingerprint_sha256;
};

bool load_certificate(const std::string &pem, CertificateBlob &out, std::string &err);

/** 把多张 PEM 证书解析成 DER 列表（失败的直接跳过） */
std::vector<std::string> load_certificate_chain(const std::vector<std::string> &pems);

/** 需要签名的 authenticatedAttributes（0x31 SET OF 编码，签名输入就是它） */
std::string build_signed_attributes(const std::string &content, const std::string &algorithm);

std::string hash_bytes(const std::string &data, const std::string &algorithm);

struct Pkcs7Request {
    std::string content;   // SpcIndirectDataContent
    CertificateBlob certificate;
    std::vector<std::string> chain_der;
    std::string algorithm = "sha256"; // sha1 | sha256 | sha384 | sha512
    std::string signature;        // RSA PKCS#1 v1.5 原始签名
    std::string timestamp_token;  // 可选的 RFC3161 TimeStampToken（DER）
    /**
     * 嵌套签名（SPC_NESTED_SIGNATURE）：每种额外摘要算法各是一整个 ContentInfo，
     * 放进本签名 SignerInfo 的未认证属性里。Windows 只认证书表里的第一条记录，
     * 多算法必须这么放，不能在同一张证书表里并排写多条 WIN_CERTIFICATE。
     */
    std::vector<std::string> nested;
};

std::string build_pkcs7(const Pkcs7Request &request, std::string &err);

/** 自检：用证书公钥验证签名确实对应这段 authenticatedAttributes */
bool verify_signature(const std::string &cert_der, const std::string &signed_attributes,
                      const std::string &algorithm, const std::string &signature, std::string &err);

} // namespace cs
