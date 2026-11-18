#include "pkcs7.h"

#include "der.h"
#include "digest.h"
#include "util.h"

#include <openssl/bio.h>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/x509.h>

#include <algorithm>

namespace cs {

namespace {

const char *kSignedDataOid = "1.2.840.113549.1.7.2";
const char *kSpcIndirectDataOid = "1.3.6.1.4.1.311.2.1.4";
const char *kContentTypeOid = "1.2.840.113549.1.9.3";
const char *kMessageDigestOid = "1.2.840.113549.1.9.4";
const char *kRsaEncryptionOid = "1.2.840.113549.1.1.1";
const char *kTimestampOid = "1.3.6.1.4.1.311.3.3.1";
const char *kNestedSignatureOid = "1.3.6.1.4.1.311.2.4.1";

std::string bio_to_string(BIO *bio) {
    char *data = nullptr;
    long length = BIO_get_mem_data(bio, &data);
    if (!data || length <= 0) return {};
    return std::string(data, static_cast<size_t>(length));
}

std::string attribute(const char *oid, const std::string &value) {
    return der::sequence(der::oid(oid) + der::set(value));
}

const EVP_MD *md_for(const std::string &algorithm) {
    const std::string name = digest::normalize(algorithm);
    if (name == "sha1") return EVP_sha1();
    if (name == "sha256") return EVP_sha256();
    if (name == "sha384") return EVP_sha384();
    if (name == "sha512") return EVP_sha512();
    return nullptr;
}

} // namespace

std::string hash_bytes(const std::string &data, const std::string &algorithm) {
    const EVP_MD *md = md_for(algorithm);
    if (!md) return {};
    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int length = 0;
    if (EVP_Digest(data.data(), data.size(), digest, &length, md, nullptr) != 1) return {};
    return std::string(reinterpret_cast<char *>(digest), length);
}

bool load_certificate(const std::string &pem, CertificateBlob &out, std::string &err) {
    out = CertificateBlob();

    BIO *bio = BIO_new_mem_buf(pem.data(), static_cast<int>(pem.size()));
    if (!bio) {
        err = "无法读取证书 PEM";
        return false;
    }
    X509 *cert = PEM_read_bio_X509(bio, nullptr, nullptr, nullptr);
    BIO_free(bio);
    if (!cert) {
        err = "PEM 解析失败：不是合法的 X.509 证书";
        return false;
    }

    bool ok = true;
    unsigned char *buffer = nullptr;

    int length = i2d_X509(cert, &buffer);
    if (length > 0) {
        out.der.assign(reinterpret_cast<char *>(buffer), static_cast<size_t>(length));
    } else {
        ok = false;
    }
    OPENSSL_free(buffer);
    buffer = nullptr;

    length = i2d_X509_NAME(X509_get_issuer_name(cert), &buffer);
    if (length > 0) {
        out.issuer_der.assign(reinterpret_cast<char *>(buffer), static_cast<size_t>(length));
    } else {
        ok = false;
    }
    OPENSSL_free(buffer);
    buffer = nullptr;

    length = i2d_ASN1_INTEGER(X509_get_serialNumber(cert), &buffer);
    if (length > 0) {
        out.serial_der.assign(reinterpret_cast<char *>(buffer), static_cast<size_t>(length));
    } else {
        ok = false;
    }
    OPENSSL_free(buffer);
    buffer = nullptr;

    BIO *text = BIO_new(BIO_s_mem());
    if (text) {
        X509_NAME_print_ex(text, X509_get_subject_name(cert), 0, XN_FLAG_ONELINE);
        out.subject = bio_to_string(text);
        BIO_free(text);
    }

    text = BIO_new(BIO_s_mem());
    if (text) {
        ASN1_TIME_print(text, X509_get0_notAfter(cert));
        out.not_after = bio_to_string(text);
        BIO_free(text);
    }

    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int digest_length = 0;
    if (X509_digest(cert, EVP_sha256(), digest, &digest_length) == 1) {
        out.fingerprint_sha256 = to_hex(digest, digest_length);
    }

    X509_free(cert);
    if (!ok) {
        err = "证书字段提取失败";
        return false;
    }
    return true;
}

std::vector<std::string> load_certificate_chain(const std::vector<std::string> &pems) {
    std::vector<std::string> out;
    for (const auto &pem : pems) {
        CertificateBlob blob;
        std::string err;
        if (load_certificate(pem, blob, err) && !blob.der.empty()) {
            out.push_back(blob.der);
        }
    }
    return out;
}

std::string build_signed_attributes(const std::string &content, const std::string &algorithm) {
    // messageDigest 是对 SpcIndirectDataContent 的内容字节求摘要（不含外层 SEQUENCE 头）
    std::string content_body;
    if (!der::content_octets(content, content_body)) {
        // 结构自检会在 build_pkcs7 里再做一次；这里失败说明调用方传错了
        content_body = content;
    }
    const std::string content_digest = hash_bytes(content_body, algorithm);

    std::string content_type = attribute(kContentTypeOid, der::oid(kSpcIndirectDataOid));
    std::string message_digest = attribute(kMessageDigestOid, der::octet_string(content_digest));

    // SET OF 必须按 DER 字节序排序；这里只有两个属性，比较后交换即可
    if (content_type > message_digest) std::swap(content_type, message_digest);

    return der::set(content_type + message_digest);
}

std::string build_pkcs7(const Pkcs7Request &request, std::string &err) {
    err.clear();
    if (request.certificate.der.empty()) {
        err = "缺少签名证书";
        return {};
    }
    if (request.signature.empty()) {
        err = "缺少云端签名";
        return {};
    }
    if (request.certificate.issuer_der.empty() || request.certificate.serial_der.empty()) {
        err = "证书缺少 issuer / serial";
        return {};
    }

    const char *digest_oid = digest::oid(request.algorithm);
    if (!digest_oid) {
        err = "不支持的摘要算法：" + request.algorithm;
        return {};
    }

    const std::string attrs = build_signed_attributes(request.content, request.algorithm);
    std::string attrs_implicit = attrs;
    // 在 SignerInfo 里 authenticatedAttributes 是 [0] IMPLICIT，内容与 SET 完全一致
    attrs_implicit[0] = static_cast<char>(0xA0);

    // 未认证属性：[1] IMPLICIT SET OF Attribute —— 时间戳 + 嵌套签名
    std::vector<std::string> unsigned_items;
    if (!request.timestamp_token.empty()) {
        unsigned_items.push_back(attribute(kTimestampOid, request.timestamp_token));
    }
    if (!request.nested.empty()) {
        std::string nested;
        for (const auto &item : request.nested) nested += item;
        // 属性值本身是 SET OF ContentInfo
        unsigned_items.push_back(attribute(kNestedSignatureOid, nested));
    }
    if (unsigned_items.size() == 2 && unsigned_items[0] > unsigned_items[1]) {
        std::swap(unsigned_items[0], unsigned_items[1]);
    }
    std::string unsigned_attrs;
    if (!unsigned_items.empty()) {
        std::string body;
        for (const auto &item : unsigned_items) body += item;
        unsigned_attrs = der::context(1, body);
    }

    // IssuerAndSerialNumber
    std::string issuer_and_serial = der::sequence(request.certificate.issuer_der + request.certificate.serial_der);

    std::string signer_info = der::sequence(
        der::integer(1) + issuer_and_serial + der::algorithm_identifier(digest_oid) +
        attrs_implicit + der::algorithm_identifier(kRsaEncryptionOid) +
        der::octet_string(request.signature) + unsigned_attrs);

    // 证书集合：[0] IMPLICIT SET OF Certificate
    std::string certificates = request.certificate.der;
    for (const auto &chain : request.chain_der) {
        if (!chain.empty() && chain != request.certificate.der) certificates += chain;
    }
    std::string certificate_set = der::context(0, certificates);

    // eContentType 是 SPC_INDIRECT_DATA，eContent 是 SpcIndirectDataContent 本身（不是 OCTET STRING）
    std::string encapsulated = der::sequence(der::oid(kSpcIndirectDataOid) + der::context(0, request.content));

    std::string signed_data = der::sequence(
        der::integer(1) + der::set(der::algorithm_identifier(digest_oid)) + encapsulated +
        certificate_set + der::set(signer_info));

    std::string content_info = der::sequence(der::oid(kSignedDataOid) + der::context(0, signed_data));

    if (!der::is_complete_element(content_info)) {
        err = "生成的 PKCS#7 结构长度不一致";
        return {};
    }
    return content_info;
}

bool verify_signature(const std::string &cert_der, const std::string &signed_attributes,
                      const std::string &algorithm, const std::string &signature, std::string &err) {
    const unsigned char *cursor = reinterpret_cast<const unsigned char *>(cert_der.data());
    X509 *cert = d2i_X509(nullptr, &cursor, static_cast<long>(cert_der.size()));
    if (!cert) {
        err = "自检失败：无法解析证书 DER";
        return false;
    }

    bool ok = false;
    EVP_PKEY *key = X509_get0_pubkey(cert);
    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    const EVP_MD *md = md_for(algorithm);
    if (key && ctx && md) {
        if (EVP_DigestVerifyInit(ctx, nullptr, md, nullptr, key) == 1) {
            int rc = EVP_DigestVerify(ctx, reinterpret_cast<const unsigned char *>(signature.data()),
                                      signature.size(),
                                      reinterpret_cast<const unsigned char *>(signed_attributes.data()),
                                      signed_attributes.size());
            ok = rc == 1;
            if (!ok) err = "自检失败：云端签名与证书/摘要不匹配";
        } else {
            err = "自检失败：无法初始化验签";
        }
    } else {
        err = md ? "自检失败：证书没有可用的公钥" : "自检失败：不支持的摘要算法 " + algorithm;
    }

    if (ctx) EVP_MD_CTX_free(ctx);
    X509_free(cert);
    return ok;
}

} // namespace cs
