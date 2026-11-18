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
                            std::string &signature_hex, RemoteCertificate &certificate, std::string &err) {
    std::string body = "{\"hash\":\"" + digest_hex + "\",\"algorithm\":\"" + algorithm + "\"}";

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

} // namespace cs
