#include "scan.h"

#include "http.h"
#include "json.h"
#include "util.h"

#include <openssl/evp.h>

#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>
#include <system_error>
#include <thread>
#include <vector>

namespace fs = std::filesystem;

namespace cs {
namespace scan {

namespace {

constexpr int kPollAttempts = 30;
constexpr int kPollIntervalSeconds = 5;

std::string verdict_text(const ScanVerdict &verdict) {
    std::string text = "风险 " + std::to_string(verdict.risk) + "（报毒 " + std::to_string(verdict.malicious) +
                       " + 可疑 " + std::to_string(verdict.suspicious) + "，共 " + std::to_string(verdict.total) +
                       " 个引擎）";
    if (!verdict.permalink.empty()) text += "：" + verdict.permalink;
    return text;
}

std::string snippet(const std::string &text) {
    return text.size() > 200 ? text.substr(0, 200) + "…" : text;
}

std::string json_error(const Json &root, const std::string &fallback) {
    const Json *error = root.find("error");
    if (error) {
        const std::string message = error->get_string("message");
        if (!message.empty()) return message;
    }
    return fallback;
}

bool wait_for_analysis(ApiClient &api, const std::string &analysis_id, const LogFn &log, ScanVerdict &out,
                       std::string &err) {
    ScanVerdict verdict;
    for (int attempt = 1; attempt <= kPollAttempts; attempt++) {
        if (attempt > 1) std::this_thread::sleep_for(std::chrono::seconds(kPollIntervalSeconds));

        bool done = false;
        if (!api.poll_scan(analysis_id, verdict, done, err)) return false;
        if (done) {
            if (!verdict.sha256.empty()) verdict.sha256 = to_lower(verdict.sha256);
            out = verdict;
            if (log) log(std::string("扫描完成，") + verdict_text(verdict));
            return true;
        }
        if (log && attempt % 3 == 1) {
            log("扫描中…（" + std::to_string(attempt * kPollIntervalSeconds) + " 秒）");
        }
    }

    err = "扫描仍未完成（已等待 " + std::to_string(kPollAttempts * kPollIntervalSeconds) +
          " 秒）。结果会被服务端缓存，请稍后重试或打开手动上传页查看。";
    return false;
}

/** 客户端直传：Worker 只下发一次性上传地址和临时使用的查杀 Key */
bool direct_upload(ApiClient &api, const std::string &path, const std::string &sha256, const LogFn &log,
                   std::string &analysis_id, std::string &err) {
    std::string upload_url;
    std::string api_key;
    long long max_bytes = 0;
    if (!api.fetch_upload_target(upload_url, api_key, max_bytes, err)) return false;

    std::error_code size_error;
    const auto file_size = fs::file_size(fs::u8path(path), size_error);
    if (!size_error && max_bytes > 0 && static_cast<long long>(file_size) > max_bytes) {
        err = "文件 " + std::to_string((file_size + 1048575) / 1048576) + " MB，超过查杀服务上限 " +
              std::to_string(max_bytes / 1048576) + " MB";
        return false;
    }

    if (log) log("客户端直传查杀服务（服务端已临时下发 Key）…");

    HttpHeaders headers;
    headers.emplace_back("x-apikey", api_key);
    headers.emplace_back("Accept", "application/json");

    HttpResponse response = http_post_file_multipart(upload_url, headers, "file", file_name(path), path, 1800);
    if (!response.error.empty()) {
        err = "直传查杀服务失败：" + response.error;
        return false;
    }

    Json root;
    if (!Json::parse(response.body, root, err)) {
        err = "查杀服务返回的不是 JSON：" + snippet(response.body);
        return false;
    }
    if (!response.ok()) {
        err = json_error(root, "直传查杀服务失败（HTTP " + std::to_string(response.status) + "）");
        return false;
    }

    const Json *data = root.find("data");
    analysis_id = data ? data->get_string("id") : std::string();
    if (analysis_id.empty()) {
        err = "查杀服务没有返回分析 ID";
        return false;
    }
    if (!api.register_analysis(analysis_id, sha256, err)) return false;
    if (log) log("已直传，开始轮询结果…");
    return true;
}

} // namespace

bool file_sha256(const std::string &path, std::string &hex, std::string &err) {
    hex.clear();
    err.clear();

    std::ifstream stream;
    try {
        stream.open(fs::u8path(path), std::ios::binary);
    } catch (const std::exception &) {
        err = "无法打开文件：" + path;
        return false;
    }
    if (!stream) {
        err = "无法打开文件：" + path;
        return false;
    }

    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    if (!ctx) {
        err = "初始化摘要上下文失败";
        return false;
    }
    bool ok = EVP_DigestInit_ex(ctx, EVP_sha256(), nullptr) == 1;

    std::vector<char> buffer(64 * 1024);
    while (ok) {
        stream.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
        const std::streamsize got = stream.gcount();
        if (got > 0) ok = EVP_DigestUpdate(ctx, buffer.data(), static_cast<size_t>(got)) == 1;
        if (stream.eof()) break;
        if (stream.bad()) {
            err = "读取文件失败：" + path;
            EVP_MD_CTX_free(ctx);
            return false;
        }
    }
    if (!ok) {
        err = "计算文件 SHA-256 失败";
        EVP_MD_CTX_free(ctx);
        return false;
    }

    unsigned char digest[EVP_MAX_MD_SIZE];
    unsigned int length = 0;
    ok = EVP_DigestFinal_ex(ctx, digest, &length) == 1 && length == 32;
    EVP_MD_CTX_free(ctx);
    if (!ok) {
        err = "计算文件 SHA-256 失败";
        return false;
    }

    hex = to_hex(digest, length);
    return true;
}

bool upload_and_wait(ApiClient &api, const ScanPolicy &policy, const std::string &path,
                     const std::string &sha256, const LogFn &log, ScanVerdict &out, std::string &err) {
    if (policy.direct_upload) {
        std::string analysis_id;
        if (!direct_upload(api, path, sha256, log, analysis_id, err)) return false;
        return wait_for_analysis(api, analysis_id, log, out, err);
    }

    const int limit_mb = policy.max_upload_mb > 0 ? policy.max_upload_mb : 64;
    std::error_code size_error;
    const auto file_size = fs::file_size(fs::u8path(path), size_error);
    const unsigned long long limit = static_cast<unsigned long long>(limit_mb) * 1024ull * 1024ull;
    if (!size_error && file_size > limit) {
        err = "文件 " + std::to_string((file_size + 1048575) / 1048576) + " MB，超过查杀上传上限 " +
              std::to_string(limit_mb) + " MB";
        return false;
    }

    if (log) log("文件尚未收录，正在经 Worker 上传扫描…");

    std::string analysis_id;
    std::string uploaded_sha;
    if (!api.upload_scan(path, sha256, analysis_id, uploaded_sha, err)) return false;
    if (!uploaded_sha.empty() && to_lower(uploaded_sha) != to_lower(sha256)) {
        err = "服务端计算的文件 SHA-256 与本地不一致，已停止签名";
        return false;
    }

    return wait_for_analysis(api, analysis_id, log, out, err);
}

bool ensure_clear(ApiClient &api, const ScanPolicy &policy, const std::string &path, const LogFn &log,
                  std::string &sha256_out, std::string &err) {
    sha256_out.clear();
    err.clear();
    if (!policy.required) return true;

    std::string sha256;
    if (!file_sha256(path, sha256, err)) return false;

    ScanVerdict verdict;
    if (!api.check_scan(sha256, verdict, err)) return false;

    if (verdict.found) {
        if (!verdict.allowed) {
            err = "病毒查杀未通过：" + verdict_text(verdict) + "，超过允许的风险等级 " +
                  std::to_string(policy.max_risk);
            return false;
        }
        if (log) log("病毒查杀通过：" + verdict_text(verdict));
        sha256_out = sha256;
        return true;
    }

    if (policy.mode != "auto") {
        err = "文件尚未通过病毒查杀。";
        if (!policy.manual_url.empty()) {
            err += "请先打开 " + policy.manual_url + " 手动上传扫描";
        } else {
            err += "请先手动上传扫描";
        }
        err += "，或运行 certumsigner scan \"" + path + "\" 后重试。";
        return false;
    }

    if (!upload_and_wait(api, policy, path, sha256, log, verdict, err)) return false;
    if (!verdict.allowed) {
        err = "病毒查杀未通过：" + verdict_text(verdict) + "，超过允许的风险等级 " + std::to_string(policy.max_risk);
        return false;
    }
    sha256_out = sha256;
    return true;
}

bool scan_file(ApiClient &api, const ScanPolicy &policy, const std::string &path, const LogFn &log,
               ScanVerdict &out, std::string &err) {
    err.clear();

    std::string sha256;
    if (!file_sha256(path, sha256, err)) return false;

    ScanVerdict verdict;
    if (!api.check_scan(sha256, verdict, err)) return false;
    if (verdict.found) {
        out = verdict;
        if (log) log("已收录：" + verdict_text(verdict));
        return true;
    }
    return upload_and_wait(api, policy, path, sha256, log, out, err);
}

} // namespace scan
} // namespace cs
