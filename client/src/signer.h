#pragma once
// 签名流程编排：摘要 → 病毒查杀 → 云端签名 → PKCS#7 → 写入 PE
#include "api.h"

#include <functional>
#include <string>
#include <vector>

namespace cs {

struct SignOptions {
    std::string server;
    std::string api_key;
    /** 可多选：sha1 / sha256 / sha384 / sha512，默认只用 sha256；每选中一种就多一个签名 */
    std::vector<std::string> algorithms{"sha256"};
    std::string tsa_url = "http://time.certum.pl/";
    bool timestamp = true;
    bool backup = false;
    /** 文件已经带签名时直接跳过（图形界面的签名页默认勾选；命令行默认不跳过） */
    bool skip_signed = false;
    bool self_check = true;

    bool wants(const std::string &algorithm) const;
};

/** 实际要用的算法列表：去重、只留受支持的，空的话回落到 sha256 */
std::vector<std::string> effective_algorithms(const std::vector<std::string> &algorithms);

using LogFn = std::function<void(const std::string &)>;

class Signer {
public:
    SignOptions options;
    LogFn log;

    /** 拉取并缓存签名证书（每次运行一次即可） */
    bool prepare(std::string &err);
    /** 返回值 true 表示这个文件处理成功（包含“已有签名，按要求跳过”）；skipped 用来区分 */
    bool sign_file(const std::string &path, std::string &err, bool *skipped = nullptr);

    const std::string &certificate_subject() const { return subject_; }
    const std::string &certificate_fingerprint() const { return fingerprint_; }
    const std::string &card_serial() const { return card_serial_; }
    const ScanPolicy &scan_policy() const { return scan_policy_; }

private:
    void write(const std::string &message) const {
        if (log) log(message);
    }
    bool adopt_certificate(const std::string &pem, const std::vector<std::string> &chain,
                           const std::string &serial, std::string &err);

    std::string certificate_pem_;
    std::vector<std::string> chain_pem_;
    std::string subject_;
    std::string fingerprint_;
    std::string card_serial_;
    ScanPolicy scan_policy_;
};

} // namespace cs
