#include "signer.h"

#include "api.h"
#include "digest.h"
#include "pe.h"
#include "pkcs7.h"
#include "spc.h"
#include "tsa.h"
#include "util.h"

#include <algorithm>

namespace cs {

std::vector<std::string> effective_algorithms(const std::vector<std::string> &algorithms) {
    std::vector<std::string> out;
    for (const auto &raw : algorithms) {
        const std::string name = digest::normalize(raw);
        if (!digest::valid(name)) continue;
        if (std::find(out.begin(), out.end(), name) == out.end()) out.push_back(name);
    }
    if (out.empty()) out.push_back("sha256");
    return out;
}

bool SignOptions::wants(const std::string &algorithm) const {
    const std::string name = digest::normalize(algorithm);
    const auto list = effective_algorithms(algorithms);
    return std::find(list.begin(), list.end(), name) != list.end();
}

namespace {

const char *kDefaultTsa = "http://time.certum.pl/";

std::string bytes_from_hex(const std::string &hex) {
    std::vector<uint8_t> bytes = from_hex(hex);
    if (bytes.empty()) return {};
    return std::string(reinterpret_cast<const char *>(bytes.data()), bytes.size());
}

std::string lower_ascii(std::string text) {
    for (char &ch : text) {
        if (ch >= 'A' && ch <= 'Z') ch = static_cast<char>(ch - 'A' + 'a');
    }
    return text;
}

/** tsa_url 写成 worker / auto / proxy 时表示「走 Worker 的 /v1/timestamp 代理」 */
bool wants_worker_tsa(const std::string &url) {
    const std::string lower = lower_ascii(trim(url));
    return lower == "worker" || lower == "auto" || lower == "proxy";
}

std::string worker_tsa_url(const std::string &server) {
    std::string base = server;
    while (!base.empty() && base.back() == '/') base.pop_back();
    if (base.empty()) return {};
    return base + "/v1/timestamp";
}

} // namespace

bool Signer::adopt_certificate(const std::string &pem, const std::vector<std::string> &chain,
                               const std::string &serial, std::string &err) {
    CertificateBlob blob;
    if (!load_certificate(pem, blob, err)) return false;

    certificate_pem_ = pem;
    chain_pem_ = chain;
    subject_ = blob.subject;
    fingerprint_ = blob.fingerprint_sha256;
    card_serial_ = serial;

    write("签名证书：" + subject_);
    write("证书 SHA-256：" + fingerprint_);
    if (!serial.empty()) write("卡片序列号：" + serial);
    if (!chain.empty()) write("附带证书链：" + std::to_string(chain.size()) + " 张");
    return true;
}

bool Signer::prepare(std::string &err) {
    if (options.server.empty()) {
        err = "没有配置签名服务地址（--server 或 config set --server）";
        return false;
    }
    if (options.api_key.empty()) {
        err = "没有配置 API Key（--api-key 或 config set --api-key）";
        return false;
    }

    ApiClient api(options.server, options.api_key);
    RemoteCertificate remote;
    if (!api.fetch_certificate(remote, err)) return false;
    return adopt_certificate(remote.pem, remote.chain, remote.serial, err);
}

bool Signer::sign_file(const std::string &path, std::string &err) {
    err.clear();
    if (certificate_pem_.empty()) {
        err = "内部错误：签名前没有调用 prepare()";
        return false;
    }
    if (!file_exists(path)) {
        err = "文件不存在：" + path;
        return false;
    }
    if (is_directory(path)) {
        err = "这是目录，不支持直接签名：" + path;
        return false;
    }

    const std::string name = file_name(path);
    const std::vector<std::string> algorithms = effective_algorithms(options.algorithms);

    // 时间戳代理与鉴权头：每种算法各要一次时间戳，提前算好
    const std::string proxy = worker_tsa_url(options.server);
    HttpHeaders auth;
    if (!options.api_key.empty()) auth.emplace_back("Authorization", "Bearer " + options.api_key);

    std::vector<std::string> blobs;
    blobs.reserve(algorithms.size());

    for (const std::string &algorithm : algorithms) {
        const std::string label = digest::display_name(algorithm);
        const char *api_algorithm = digest::api_name(algorithm);
        if (!api_algorithm) {
            err = "不支持的摘要算法：" + algorithm;
            return false;
        }

        write("计算摘要（" + label + "）：" + name);
        std::string file_digest;
        if (!pe::authentihash(path, algorithm, file_digest, err)) return false;
        if (file_digest.size() != digest::byte_length(algorithm)) {
            err = "摘要长度异常";
            return false;
        }

        const std::string content = spc::build(file_digest, algorithm);
        if (content.empty()) {
            err = "不支持的摘要算法：" + algorithm;
            return false;
        }
        const std::string signed_attrs = build_signed_attributes(content, algorithm);
        const std::string attrs_digest = hash_bytes(signed_attrs, algorithm);
        if (attrs_digest.empty()) {
            err = "计算签名输入摘要失败";
            return false;
        }

        write("请求云端签名（" + label + "）：" + to_hex(attrs_digest).substr(0, 16) + "…");
        ApiClient api(options.server, options.api_key);
        RemoteCertificate remote;
        std::string signature_hex;
        if (!api.sign_digest(to_hex(attrs_digest), api_algorithm, signature_hex, remote, err)) {
            return false;
        }

        if (!remote.pem.empty() && remote.pem != certificate_pem_) {
            // 云端换了证书（重签/续期），后续必须用新的那张来组装
            if (!adopt_certificate(remote.pem, remote.chain, remote.serial, err)) return false;
        }

        const std::string signature = bytes_from_hex(signature_hex);
        if (signature.empty()) {
            err = "云端返回的签名不是合法十六进制";
            return false;
        }

        CertificateBlob certificate;
        if (!load_certificate(certificate_pem_, certificate, err)) return false;
        const std::vector<std::string> chain = load_certificate_chain(chain_pem_);

        if (options.self_check) {
            std::string verify_error;
            if (!verify_signature(certificate.der, signed_attrs, algorithm, signature, verify_error)) {
                err = verify_error;
                return false;
            }
            write("签名自检通过（" + label + "）");
        }

        std::string timestamp_token;
        if (options.timestamp) {
            const std::string direct_url = wants_worker_tsa(options.tsa_url)
                                               ? std::string()
                                               : (options.tsa_url.empty() ? std::string(kDefaultTsa) : options.tsa_url);

            std::string token;
            std::string direct_error;
            bool ok = !direct_url.empty() && request_timestamp(direct_url, HttpHeaders(), signature, token, direct_error);

            if (ok) {
                timestamp_token = token;
                write("已获取时间戳：" + direct_url);
            } else {
                // 直连 TSA 失败多半是企业网的安全软件拦了未签名程序的出网请求，
                // 客户端到 Worker 的连接通常是通的，改走 Worker 代理再试一次
                std::string proxy_error;
                if (!proxy.empty() && request_timestamp(proxy, auth, signature, token, proxy_error)) {
                    timestamp_token = token;
                    if (!direct_error.empty()) write("直连 " + direct_url + " 失败（" + direct_error + "），已改走 Worker 代理");
                    write("已获取时间戳：" + proxy);
                } else {
                    std::string detail = direct_error;
                    if (!proxy_error.empty()) {
                        if (!detail.empty()) detail += "；Worker 代理也失败：";
                        detail += proxy_error;
                    }
                    // 时间戳失败不阻断签名：产物仍然有效，只是没有可信时间
                    write("警告：时间戳失败（" + detail + "），继续生成不带时间戳的签名");
                    timestamp_token.clear();
                }
            }
        }

        Pkcs7Request request;
        request.content = content;
        request.certificate = certificate;
        request.chain_der = chain;
        request.algorithm = algorithm;
        request.signature = signature;
        request.timestamp_token = timestamp_token;

        std::string pkcs7 = build_pkcs7(request, err);
        if (pkcs7.empty()) return false;
        blobs.push_back(std::move(pkcs7));
    }

    if (options.backup) {
        const std::string backup = path + ".orig";
        if (!file_exists(backup)) {
            std::string original;
            std::string read_error;
            if (read_file(path, original, read_error)) {
                std::string write_error;
                if (!write_file(backup, original, write_error)) {
                    write("警告：备份失败（" + write_error + "）");
                } else {
                    write("已备份原文件：" + file_name(backup));
                }
            }
        }
    }

    if (!pe::embed(path, blobs, err)) return false;

    std::string joined;
    for (const std::string &algorithm : algorithms) {
        if (!joined.empty()) joined += " + ";
        joined += digest::display_name(algorithm);
    }
    write("签名完成：" + name + "（" + joined + "）");
    return true;
}

} // namespace cs
