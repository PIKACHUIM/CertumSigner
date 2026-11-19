#include "api.h"

#include "http.h"
#include "json.h"
#include "util.h"

#include <utility>

namespace cs {

namespace {

std::string error_message(const Json &root, const std::string &fallback) {
    const Json *error = root.find("error");
    if (error && error->type == Json::Type::Object) {
        std::string message = error->get_string("message");
        if (!message.empty()) return message;
    }
    return fallback;
}

std::string shorten(const std::string &text, size_t limit = 200) {
    std::string flat;
    flat.reserve(text.size());
    for (char c : text) flat.push_back((c == '\n' || c == '\r' || c == '\t') ? ' ' : c);
    return flat.size() > limit ? flat.substr(0, limit) + "…" : flat;
}

std::string url_encode(const std::string &text) {
    static const char *hex = "0123456789ABCDEF";
    std::string out;
    out.reserve(text.size() * 3);
    for (unsigned char c : text) {
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' ||
            c == '_' || c == '.' || c == '~') {
            out.push_back(static_cast<char>(c));
        } else {
            out.push_back('%');
            out.push_back(hex[c >> 4]);
            out.push_back(hex[c & 0x0F]);
        }
    }
    return out;
}

void read_verdict(const Json &node, ScanVerdict &out) {
    out.malicious = static_cast<int>(node.get_number("malicious", 0));
    out.suspicious = static_cast<int>(node.get_number("suspicious", 0));
    out.undetected = static_cast<int>(node.get_number("undetected", 0));
    out.harmless = static_cast<int>(node.get_number("harmless", 0));
    out.total = static_cast<int>(node.get_number("total", 0));
    out.sha256 = node.get_string("sha256");
    out.permalink = node.get_string("permalink");
}

} // namespace

ApiClient::ApiClient(std::string base_url, std::string api_key)
    : base_url_(std::move(base_url)), api_key_(std::move(api_key)) {
    while (!base_url_.empty() && base_url_.back() == '/') base_url_.pop_back();
}

std::string ApiClient::url_for(const std::string &path) const {
    return base_url_ + (path.empty() || path[0] == '/' ? path : "/" + path);
}

bool ApiClient::fetch_certificate(RemoteCertificate &out, std::string &err) {
    HttpHeaders headers;
    headers.emplace_back("Authorization", "Bearer " + api_key_);
    headers.emplace_back("Accept", "application/json");
    headers.emplace_back("X-Client", "certumsigner/1.0");

    HttpResponse response = http_get(url_for("/v1/certificate"), headers);
    if (!response.error.empty()) {
        err = "请求签名服务失败：" + response.error;
        return false;
    }

    Json root;
    if (!Json::parse(response.body, root, err)) {
        err = "签名服务返回的不是 JSON：" + shorten(response.body);
        return false;
    }
    if (!response.ok()) {
        err = error_message(root, "获取证书失败（HTTP " + std::to_string(response.status) + "）");
        return false;
    }

    const Json *certificate = root.find("certificate");
    if (!certificate || certificate->type != Json::Type::Object) {
        err = "响应里没有 certificate 字段";
        return false;
    }

    out.pem = certificate->get_string("pem");
    out.chain = certificate->get_strings("chain");
    out.serial = certificate->get_string("serial");
    out.fingerprint256 = certificate->get_string("fingerprint256");
    if (out.pem.empty()) {
        err = "证书 PEM 为空";
        return false;
    }
    return true;
}

bool ApiClient::sign_digest(const std::string &digest_hex, const std::string &algorithm,
                            std::string &signature_hex, RemoteCertificate &certificate, std::string &err,
                            const std::string &file_sha256) {
    std::string body = "{\"hash\":\"" + digest_hex + "\",\"algorithm\":\"" + algorithm + "\"";
    // 开启病毒查杀的证书：服务端按原始文件 SHA-256 复核扫描结果
    if (!file_sha256.empty()) body += ",\"file\":{\"sha256\":\"" + file_sha256 + "\"}";
    body += "}";

    HttpHeaders headers;
    headers.emplace_back("Authorization", "Bearer " + api_key_);
    headers.emplace_back("Content-Type", "application/json");
    headers.emplace_back("Accept", "application/json");
    headers.emplace_back("X-Client", "certumsigner/1.0");

    HttpResponse response = http_post(url_for("/v1/sign"), headers, body);
    if (!response.error.empty()) {
        err = "请求签名服务失败：" + response.error;
        return false;
    }

    Json root;
    if (!Json::parse(response.body, root, err)) {
        err = "签名服务返回的不是 JSON：" + shorten(response.body);
        return false;
    }
    if (!response.ok() || !root.get_bool("ok", false)) {
        err = error_message(root, "签名失败（HTTP " + std::to_string(response.status) + "）");
        return false;
    }

    std::vector<std::string> signatures = root.get_strings("signatures");
    if (signatures.size() != 1) {
        err = "签名响应里的签名数量不正确";
        return false;
    }
    signature_hex = to_lower(signatures[0]);

    const Json *cert = root.find("certificate");
    if (cert && cert->type == Json::Type::Object) {
        std::string pem = cert->get_string("pem");
        if (!pem.empty()) {
            certificate.pem = pem;
            certificate.chain = cert->get_strings("chain");
            certificate.serial = cert->get_string("serial");
            certificate.fingerprint256 = cert->get_string("fingerprint256");
        }
    }

    return true;
}

bool ApiClient::fetch_scan_policy(ScanPolicy &out, std::string &err) {
    HttpHeaders headers;
    headers.emplace_back("Authorization", "Bearer " + api_key_);
    headers.emplace_back("Accept", "application/json");
    headers.emplace_back("X-Client", "certumsigner/1.0");

    HttpResponse response = http_get(url_for("/v1/scan/policy"), headers);
    if (!response.error.empty()) {
        err = "请求查杀策略失败：" + response.error;
        return false;
    }
    // 旧版 Worker 没有查杀接口，按「不要求扫描」处理，保持向后兼容
    if (response.status == 404) {
        out = ScanPolicy{};
        return true;
    }

    Json root;
    if (!Json::parse(response.body, root, err)) {
        err = "查杀策略不是 JSON：" + shorten(response.body);
        return false;
    }
    if (!response.ok()) {
        err = error_message(root, "获取查杀策略失败（HTTP " + std::to_string(response.status) + "）");
        return false;
    }

    out.mode = root.find("policy") ? root.find("policy")->get_string("mode", "off") : "off";
    out.required = out.mode == "manual" || out.mode == "auto";
    out.max_risk = root.find("policy") ? static_cast<int>(root.find("policy")->get_number("maxRisk", 0)) : 0;
    out.provider = root.get_string("provider");
    out.max_upload_mb = static_cast<int>(root.get_number("maxUploadMb", 32));
    out.manual_url = root.get_string("manualUrl");
    return true;
}

bool ApiClient::check_scan(const std::string &sha256, ScanVerdict &out, std::string &err) {
    HttpHeaders headers;
    headers.emplace_back("Authorization", "Bearer " + api_key_);
    headers.emplace_back("Accept", "application/json");
    headers.emplace_back("X-Client", "certumsigner/1.0");

    HttpResponse response = http_get(url_for("/v1/scan/check?sha256=" + url_encode(sha256)), headers);
    if (!response.error.empty()) {
        err = "查询病毒查杀结果失败：" + response.error;
        return false;
    }

    Json root;
    if (!Json::parse(response.body, root, err)) {
        err = "查杀服务返回的不是 JSON：" + shorten(response.body);
        return false;
    }
    if (!response.ok()) {
        err = error_message(root, "查询查杀结果失败（HTTP " + std::to_string(response.status) + "）");
        return false;
    }

    out = ScanVerdict{};
    out.found = root.get_bool("found", false);
    out.allowed = root.get_bool("allowed", false);
    out.risk = static_cast<int>(root.get_number("risk", 0));
    out.reason = root.get_string("reason");
    if (const Json *verdict = root.find("verdict")) read_verdict(*verdict, out);
    return true;
}

bool ApiClient::upload_scan(const std::string &path, const std::string &sha256, std::string &analysis_id,
                            std::string &uploaded_sha256, std::string &err) {
    std::string bytes;
    if (!read_file(path, bytes, err)) return false;
    if (bytes.empty()) {
        err = "文件为空：" + path;
        return false;
    }

    HttpHeaders headers;
    headers.emplace_back("Authorization", "Bearer " + api_key_);
    headers.emplace_back("Content-Type", "application/octet-stream");
    headers.emplace_back("Accept", "application/json");
    headers.emplace_back("X-Client", "certumsigner/1.0");

    const std::string url = url_for("/v1/scan/upload?sha256=" + url_encode(sha256) +
                                    "&name=" + url_encode(file_name(path)));
    HttpResponse response = http_post(url, headers, bytes, 180);
    if (!response.error.empty()) {
        err = "上传扫描失败：" + response.error;
        return false;
    }
    // 超过域名套餐的入站上限时，Cloudflare 会在 Worker 之前直接返回 HTML 413
    if (response.status == 413) {
        err = "文件超过服务端允许的上传体积（受 Cloudflare 套餐的入站上限约束，Free / Pro 为 100 MB）";
        return false;
    }

    Json root;
    if (!Json::parse(response.body, root, err)) {
        err = "查杀服务返回的不是 JSON：" + shorten(response.body);
        return false;
    }
    if (!response.ok()) {
        err = error_message(root, "上传扫描失败（HTTP " + std::to_string(response.status) + "）");
        return false;
    }

    analysis_id = root.get_string("analysisId");
    uploaded_sha256 = root.get_string("sha256");
    if (analysis_id.empty()) {
        err = "查杀服务没有返回分析 ID";
        return false;
    }
    return true;
}

bool ApiClient::poll_scan(const std::string &analysis_id, ScanVerdict &out, bool &done, std::string &err) {
    HttpHeaders headers;
    headers.emplace_back("Authorization", "Bearer " + api_key_);
    headers.emplace_back("Accept", "application/json");
    headers.emplace_back("X-Client", "certumsigner/1.0");

    HttpResponse response = http_get(url_for("/v1/scan/analysis/" + url_encode(analysis_id)), headers);
    if (!response.error.empty()) {
        err = "查询扫描进度失败：" + response.error;
        return false;
    }

    Json root;
    if (!Json::parse(response.body, root, err)) {
        err = "查杀服务返回的不是 JSON：" + shorten(response.body);
        return false;
    }
    if (!response.ok()) {
        err = error_message(root, "查询扫描进度失败（HTTP " + std::to_string(response.status) + "）");
        return false;
    }

    out = ScanVerdict{};
    done = root.get_string("status") == "completed";
    out.found = done;
    out.allowed = root.get_bool("allowed", false);
    out.risk = static_cast<int>(root.get_number("risk", 0));
    out.sha256 = root.get_string("sha256");
    const std::string fallback_sha = out.sha256;
    if (const Json *verdict = root.find("verdict"); verdict && verdict->type == Json::Type::Object) {
        read_verdict(*verdict, out);
    }
    if (out.sha256.empty()) out.sha256 = fallback_sha;
    return true;
}

} // namespace cs
