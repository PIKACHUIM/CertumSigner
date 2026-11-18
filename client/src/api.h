#pragma once
// 与 CertumSigner Worker 通信（HTTPS 代理签名）
#include <string>
#include <vector>

namespace cs {

struct RemoteCertificate {
    std::string pem;
    std::vector<std::string> chain;
    std::string serial;
    std::string fingerprint256;
};

class ApiClient {
public:
    ApiClient(std::string base_url, std::string api_key);

    bool fetch_certificate(RemoteCertificate &out, std::string &err);
    bool sign_digest(const std::string &digest_hex, const std::string &algorithm,
                     std::string &signature_hex, RemoteCertificate &certificate, std::string &err);

    const std::string &base_url() const { return base_url_; }

private:
    std::string url_for(const std::string &path) const;

    std::string base_url_;
    std::string api_key_;
};

} // namespace cs
