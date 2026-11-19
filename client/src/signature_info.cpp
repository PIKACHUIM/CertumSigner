#include "signature_info.h"

#include <windows.h>
#include <wincrypt.h>

#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <vector>

#pragma comment(lib, "crypt32.lib")

namespace cs {
namespace siginfo {

namespace {

constexpr size_t kMaxCertTable = 16u * 1024u * 1024u; // 证书表不会这么大，防坏文件
constexpr size_t kMaxSignatures = 32;
constexpr int kMaxDepth = 4;

std::string to_utf8(const wchar_t *text) {
    if (!text || !*text) return {};
    const int length = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
    if (length <= 1) return {};
    std::string out(static_cast<size_t>(length), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text, -1, out.data(), length, nullptr, nullptr);
    out.resize(static_cast<size_t>(length - 1));
    return out;
}

std::string hex_upper(const BYTE *data, size_t size) {
    static const char kDigits[] = "0123456789ABCDEF";
    std::string out;
    out.reserve(size * 2);
    for (size_t i = 0; i < size; ++i) {
        out.push_back(kDigits[(data[i] >> 4) & 0xF]);
        out.push_back(kDigits[data[i] & 0xF]);
    }
    return out;
}

std::string date_of(const FILETIME &value) {
    FILETIME local = value;
    FileTimeToLocalFileTime(&value, &local);
    SYSTEMTIME time{};
    if (!FileTimeToSystemTime(&local, &time)) return {};
    char buffer[32] = {0};
    std::snprintf(buffer, sizeof(buffer), "%04u-%02u-%02u", time.wYear, time.wMonth, time.wDay);
    return buffer;
}

std::string cert_full_name(PCCERT_CONTEXT cert, bool issuer) {
    if (!cert || !cert->pCertInfo) return {};
    CERT_NAME_BLOB blob = issuer ? cert->pCertInfo->Issuer : cert->pCertInfo->Subject;
    const DWORD length = CertNameToStrW(X509_ASN_ENCODING, &blob, CERT_X500_NAME_STR, nullptr, 0);
    if (length <= 1) return {};
    std::vector<wchar_t> buffer(length);
    if (!CertNameToStrW(X509_ASN_ENCODING, &blob, CERT_X500_NAME_STR, buffer.data(), length)) return {};
    return to_utf8(buffer.data());
}

/** 从 "CN=xxx, O=yyy" 里取出 CN；没有 CN 就返回整串 */
std::string brief_name(const std::string &dn) {
    const std::string marker = "CN=";
    const size_t start = dn.find(marker);
    if (start == std::string::npos) return dn;
    size_t cursor = start + marker.size();
    std::string value;
    if (cursor < dn.size() && dn[cursor] == '"') {
        // CN 里带逗号时 X500 会用双引号包起来
        ++cursor;
        while (cursor < dn.size()) {
            if (dn[cursor] == '\\' && cursor + 1 < dn.size()) {
                value.push_back(dn[cursor + 1]);
                cursor += 2;
                continue;
            }
            if (dn[cursor] == '"') break;
            value.push_back(dn[cursor++]);
        }
    } else {
        while (cursor < dn.size() && dn[cursor] != ',') {
            if (dn[cursor] == '\\' && cursor + 1 < dn.size()) {
                value.push_back(dn[cursor + 1]);
                cursor += 2;
                continue;
            }
            value.push_back(dn[cursor++]);
        }
    }
    return value.empty() ? dn : value;
}

std::string cert_name(PCCERT_CONTEXT cert, bool issuer) {
    // CertGetNameString 的 CERT_NAME_ISSUER_FLAG 在部分系统上会把 issuer 当成 subject 返回，
    // 这里统一走 CertNameToStr 取完整 DN，再抽 CN，行为稳定。
    return brief_name(cert_full_name(cert, issuer));
}

CertificateInfo describe_cert(PCCERT_CONTEXT cert) {
    CertificateInfo info;
    if (!cert) return info;
    info.subject = cert_name(cert, false);
    info.issuer = cert_name(cert, true);
    if (info.subject.empty()) info.subject = to_utf8(L"（未命名证书）");
    if (cert->pCertInfo) {
        info.serial = hex_upper(cert->pCertInfo->SerialNumber.pbData, cert->pCertInfo->SerialNumber.cbData);
        info.not_before = date_of(cert->pCertInfo->NotBefore);
        info.not_after = date_of(cert->pCertInfo->NotAfter);
    }
    BYTE hash[32] = {0};
    DWORD hash_size = sizeof(hash);
    if (CryptHashCertificate(0, CALG_SHA_256, 0, cert->pbCertEncoded, cert->cbCertEncoded, hash, &hash_size)) {
        info.fingerprint = hex_upper(hash, hash_size);
    }
    return info;
}

std::string digest_of_oid(const char *oid) {
    if (!oid) return {};
    // 1.3.14.3.2.26 = SHA-1，2.16.840.1.101.3.4.2.1~3 = SHA-256/384/512
    if (std::strcmp(oid, "1.3.14.3.2.26") == 0) return "sha1";
    if (std::strcmp(oid, "2.16.840.1.101.3.4.2.1") == 0) return "sha256";
    if (std::strcmp(oid, "2.16.840.1.101.3.4.2.2") == 0) return "sha384";
    if (std::strcmp(oid, "2.16.840.1.101.3.4.2.3") == 0) return "sha512";
    return {};
}

std::string signature_alg_of_oid(const char *oid) {
    if (!oid) return {};
    if (std::strcmp(oid, "1.2.840.113549.1.1.1") == 0) return "RSA";
    if (std::strcmp(oid, "1.2.840.113549.1.1.5") == 0) return "RSA (SHA-1)";
    if (std::strcmp(oid, "1.2.840.113549.1.1.11") == 0) return "RSA (SHA-256)";
    if (std::strcmp(oid, "1.2.840.113549.1.1.12") == 0) return "RSA (SHA-384)";
    if (std::strcmp(oid, "1.2.840.113549.1.1.13") == 0) return "RSA (SHA-512)";
    if (std::strcmp(oid, "1.2.840.10045.2.1") == 0) return "ECDSA";
    return oid;
}

/** 读 DER 元素头（tag + length），返回是否成功 */
bool read_tlv(const BYTE *data, size_t size, size_t offset, BYTE &tag, size_t &content_offset, size_t &content_size,
              size_t &total_size) {
    if (offset + 2 > size) return false;
    tag = data[offset];
    size_t cursor = offset + 1;
    size_t length = 0;
    const BYTE first = data[cursor++];
    if ((first & 0x80) == 0) {
        length = first;
    } else {
        const size_t count = first & 0x7F;
        if (count == 0 || count > 4 || cursor + count > size) return false;
        for (size_t i = 0; i < count; ++i) length = (length << 8) | data[cursor++];
    }
    if (cursor + length > size) return false;
    content_offset = cursor;
    content_size = length;
    total_size = cursor + length - offset;
    return true;
}

bool parse_der_sequence(const BYTE *data, size_t size, bool nested, FileSignature &out, int depth);

/** 解析一段 PKCS#7 ContentInfo */
bool parse_content_info(const BYTE *data, DWORD size, bool nested, FileSignature &out, int depth) {
    if (!data || size < 16 || depth > kMaxDepth) return false;
    if (out.signatures.size() >= kMaxSignatures) return false;

    CRYPT_DATA_BLOB blob{};
    blob.cbData = size;
    blob.pbData = const_cast<BYTE *>(data);

    HCERTSTORE store = nullptr;
    HCRYPTMSG message = nullptr;
    DWORD encoding = 0;
    DWORD content = 0;
    DWORD format = 0;
    if (!CryptQueryObject(CERT_QUERY_OBJECT_BLOB, &blob,
                          CERT_QUERY_CONTENT_FLAG_PKCS7_SIGNED | CERT_QUERY_CONTENT_FLAG_PKCS7_SIGNED_EMBED,
                          CERT_QUERY_FORMAT_FLAG_BINARY, 0, &encoding, &content, &format, &store, &message,
                          nullptr)) {
        return false;
    }

    bool produced = false;
    DWORD count = 0;
    DWORD bytes = sizeof(count);
    if (CryptMsgGetParam(message, CMSG_SIGNER_COUNT_PARAM, 0, &count, &bytes)) {
        for (DWORD i = 0; i < count && out.signatures.size() < kMaxSignatures; ++i) {
            bytes = 0;
            if (!CryptMsgGetParam(message, CMSG_SIGNER_INFO_PARAM, i, nullptr, &bytes) || bytes == 0) continue;
            std::vector<BYTE> buffer(bytes);
            if (!CryptMsgGetParam(message, CMSG_SIGNER_INFO_PARAM, i, buffer.data(), &bytes)) continue;
            auto *signer = reinterpret_cast<CMSG_SIGNER_INFO *>(buffer.data());

            SignatureInfo signature;
            signature.nested = nested;
            signature.digest = digest_of_oid(signer->HashAlgorithm.pszObjId);
            signature.signature_algorithm = signature_alg_of_oid(signer->HashEncryptionAlgorithm.pszObjId);
            out.embedded = true;

            CERT_INFO cert_info{};
            cert_info.Issuer = signer->Issuer;
            cert_info.SerialNumber = signer->SerialNumber;
            PCCERT_CONTEXT cert = CertFindCertificateInStore(store, X509_ASN_ENCODING | PKCS_7_ASN_ENCODING, 0,
                                                             CERT_FIND_SUBJECT_CERT, &cert_info, nullptr);
            if (cert) {
                signature.signer = describe_cert(cert);
                CertFreeCertificateContext(cert);
            }

            // 未认证属性：RFC3161 时间戳、嵌套签名
            DWORD attr_bytes = 0;
            if (CryptMsgGetParam(message, CMSG_SIGNER_UNAUTH_ATTR_PARAM, i, nullptr, &attr_bytes) && attr_bytes > 0) {
                std::vector<BYTE> attr_buffer(attr_bytes);
                if (CryptMsgGetParam(message, CMSG_SIGNER_UNAUTH_ATTR_PARAM, i, attr_buffer.data(), &attr_bytes)) {
                    auto *attributes = reinterpret_cast<CRYPT_ATTRIBUTES *>(attr_buffer.data());
                    for (DWORD a = 0; a < attributes->cAttr; ++a) {
                        const CRYPT_ATTRIBUTE &attribute = attributes->rgAttr[a];
                        if (!attribute.pszObjId) continue;
                        if (std::strcmp(attribute.pszObjId, "1.3.6.1.4.1.311.3.3.1") == 0) {
                            signature.timestamped = true;
                        } else if (std::strcmp(attribute.pszObjId, "1.3.6.1.4.1.311.2.4.1") == 0) {
                            for (DWORD v = 0; v < attribute.cValue; ++v) {
                                const CRYPT_ATTR_BLOB &value = attribute.rgValue[v];
                                if (!parse_content_info(value.pbData, value.cbData, true, out, depth + 1)) {
                                    parse_der_sequence(value.pbData, value.cbData, true, out, depth + 1);
                                }
                            }
                        }
                    }
                }
            }

            out.signatures.push_back(signature);
            produced = true;
        }
    }

    // 证书链：判断是否含 Microsoft 交叉证书
    if (store) {
        PCCERT_CONTEXT cert = nullptr;
        while ((cert = CertEnumCertificatesInStore(store, cert)) != nullptr) {
            CertificateInfo info = describe_cert(cert);
            bool duplicate = false;
            for (const auto &existing : out.chain) {
                if (!info.fingerprint.empty() && existing.fingerprint == info.fingerprint) {
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) {
                std::string lower = info.subject;
                for (char &ch : lower) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
                if (lower.find("microsoft code verification root") != std::string::npos ||
                    lower.find("microsoft root certificate authority") != std::string::npos ||
                    lower.find("microsoft code signing pca") != std::string::npos) {
                    out.cross_signed = true;
                }
                out.chain.push_back(info);
            }
        }
    }

    if (message) CryptMsgClose(message);
    if (store) CertCloseStore(store, 0);
    return produced;
}

/** 属性值可能是「SET OF ContentInfo」，逐个元素再试一次 */
bool parse_der_sequence(const BYTE *data, size_t size, bool nested, FileSignature &out, int depth) {
    bool produced = false;
    size_t offset = 0;
    while (offset + 2 <= size) {
        BYTE tag = 0;
        size_t content_offset = 0;
        size_t content_size = 0;
        size_t total = 0;
        if (!read_tlv(data, size, offset, tag, content_offset, content_size, total)) break;
        if (tag == 0x30 && content_size > 0) {
            if (parse_content_info(data + offset, static_cast<DWORD>(total), nested, out, depth)) produced = true;
        }
        offset += total;
        if (total == 0) break;
    }
    return produced;
}

bool read_at(std::ifstream &stream, std::uint64_t offset, void *buffer, size_t size) {
    stream.clear();
    stream.seekg(static_cast<std::streamoff>(offset), std::ios::beg);
    if (!stream) return false;
    stream.read(static_cast<char *>(buffer), static_cast<std::streamsize>(size));
    return static_cast<size_t>(stream.gcount()) == size;
}

std::uint16_t le16(const BYTE *data) {
    return static_cast<std::uint16_t>(data[0] | (data[1] << 8));
}

std::uint32_t le32(const BYTE *data) {
    return static_cast<std::uint32_t>(data[0]) | (static_cast<std::uint32_t>(data[1]) << 8) |
           (static_cast<std::uint32_t>(data[2]) << 16) | (static_cast<std::uint32_t>(data[3]) << 24);
}

/** 从 PE 头里取出证书表位置；没有签名时 size=0 */
bool peek_cert_table(const std::string &path, std::uint32_t &cert_offset, std::uint32_t &cert_size) {
    cert_offset = 0;
    cert_size = 0;
    std::ifstream stream(path, std::ios::binary);
    if (!stream) return false;

    BYTE dos[0x40] = {0};
    if (!read_at(stream, 0, dos, sizeof(dos))) return false;
    if (dos[0] != 'M' || dos[1] != 'Z') return false;

    const std::uint32_t pe_offset = le32(dos + 0x3C);
    BYTE pe[24] = {0};
    if (!read_at(stream, pe_offset, pe, sizeof(pe))) return false;
    if (std::memcmp(pe, "PE\0\0", 4) != 0) return false;

    const std::uint16_t optional_size = le16(pe + 20);
    const std::uint64_t optional_offset = static_cast<std::uint64_t>(pe_offset) + 24;
    BYTE optional[240] = {0};
    const size_t want = optional_size < sizeof(optional) ? optional_size : sizeof(optional);
    if (!read_at(stream, optional_offset, optional, want)) return false;

    const std::uint16_t magic = le16(optional);
    size_t data_dir = 0;
    if (magic == 0x10B) {
        data_dir = 96;
    } else if (magic == 0x20B) {
        data_dir = 112;
    } else {
        return false;
    }
    const size_t security_dir = data_dir + 4 * 8;
    if (security_dir + 8 > want) return false;

    cert_offset = le32(optional + security_dir);
    cert_size = le32(optional + security_dir + 4);
    return true;
}

} // namespace

FileSignature load(const std::string &path) {
    FileSignature result;

    std::uint32_t cert_offset = 0;
    std::uint32_t cert_size = 0;
    if (!peek_cert_table(path, cert_offset, cert_size)) return result;
    if (cert_offset == 0 || cert_size == 0 || cert_size > kMaxCertTable) return result;

    std::ifstream stream(path, std::ios::binary);
    if (!stream) return result;
    std::vector<BYTE> table(cert_size);
    if (!read_at(stream, cert_offset, table.data(), table.size())) return result;

    size_t offset = 0;
    while (offset + 8 <= table.size()) {
        const std::uint32_t length = le32(table.data() + offset);
        if (length < 8 || offset + length > table.size()) break;
        // WIN_CERTIFICATE：8 字节头 + PKCS#7
        result.embedded = true;
        parse_content_info(table.data() + offset + 8, length - 8, false, result, 0);
        const size_t aligned = (static_cast<size_t>(length) + 7u) & ~static_cast<size_t>(7u);
        if (aligned == 0) break;
        offset += aligned;
    }
    return result;
}

std::vector<std::string> digests(const FileSignature &signature) {
    std::vector<std::string> out;
    for (const auto &item : signature.signatures) {
        if (item.digest.empty()) continue;
        bool seen = false;
        for (const auto &existing : out) {
            if (existing == item.digest) {
                seen = true;
                break;
            }
        }
        if (!seen) out.push_back(item.digest);
    }
    return out;
}

unsigned long long file_size(const std::string &path) {
    std::ifstream stream(path, std::ios::binary | std::ios::ate);
    if (!stream) return 0;
    const std::streamoff size = stream.tellg();
    return size > 0 ? static_cast<unsigned long long>(size) : 0;
}

std::wstring format_size(unsigned long long bytes) {
    wchar_t buffer[64] = {0};
    if (bytes < 1024) {
        swprintf_s(buffer, L"%llu B", bytes);
    } else if (bytes < 1024ull * 1024) {
        swprintf_s(buffer, L"%.1f KB", static_cast<double>(bytes) / 1024.0);
    } else if (bytes < 1024ull * 1024 * 1024) {
        swprintf_s(buffer, L"%.1f MB", static_cast<double>(bytes) / (1024.0 * 1024.0));
    } else {
        swprintf_s(buffer, L"%.2f GB", static_cast<double>(bytes) / (1024.0 * 1024.0 * 1024.0));
    }
    return buffer;
}

} // namespace siginfo
} // namespace cs
