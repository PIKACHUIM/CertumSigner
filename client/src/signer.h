#pragma once
// 签名流程编排：摘要 → 云端签名 → PKCS#7 → 写入 PE
#include <functional>
#include <string>
#include <vector>

namespace cs {

struct SignOptions {
    std::string server;
    std::string api_key;
    std::string algorithm = "sha256";              // sha1 | sha256
    std::string tsa_url = "http://time.certum.pl/";
    bool timestamp = true;
    bool backup = false;
    bool self_check = true;

    bool sha1() const { return algorithm == "sha1"; }
};

using LogFn = std::function<void(const std::string &)>;

class Signer {
public:
    SignOptions options;
    LogFn log;

    /** 拉取并缓存签名证书（每次运行一次即可） */
    bool prepare(std::string &err);
    bool sign_file(const std::string &path, std::string &err);

    const std::string &certificate_subject() const { return subject_; }
    const std::string &certificate_fingerprint() const { return fingerprint_; }
    const std::string &card_serial() const { return card_serial_; }

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
};

} // namespace cs
