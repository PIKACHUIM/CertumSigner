#include "scan.h"

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

bool upload_and_wait(ApiClient &api, const std::string &path, const std::string &sha256, int max_upload_mb,
                     const LogFn &log, ScanVerdict &out, std::string &err) {
    const int limit_mb = max_upload_mb > 0 ? max_upload_mb : 64;
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

    if (!upload_and_wait(api, path, sha256, policy.max_upload_mb, log, verdict, err)) return false;
    if (!verdict.allowed) {
        err = "病毒查杀未通过：" + verdict_text(verdict) + "，超过允许的风险等级 " + std::to_string(policy.max_risk);
        return false;
    }
    sha256_out = sha256;
    return true;
}

bool scan_file(ApiClient &api, const std::string &path, const LogFn &log, ScanVerdict &out, std::string &err) {
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
    return upload_and_wait(api, path, sha256, 64, log, out, err);
}

} // namespace scan
} // namespace cs
