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

/** 服务端按证书配置的病毒查杀策略 */
struct ScanPolicy {
    bool required = false;
    /** manual | auto */
    std::string mode = "off";
    /** 允许签名的最大风险（报毒 + 可疑引擎数） */
    int max_risk = 0;
    std::string provider;
    int max_upload_mb = 32;
    /** 服务端允许客户端拿 Key 直传（会下发查杀 Key，默认关闭） */
    bool direct_upload = false;
    /** 手动上传页地址（服务端根据 publicBaseUrl 生成） */
    std::string manual_url;
};

struct ScanVerdict {
    bool found = false;
    bool allowed = false;
    int malicious = 0;
    int suspicious = 0;
    int undetected = 0;
    int harmless = 0;
    int total = 0;
    int risk = 0;
    std::string sha256;
    std::string permalink;
    std::string reason;
};

class ApiClient {
public:
    ApiClient(std::string base_url, std::string api_key);

    bool fetch_certificate(RemoteCertificate &out, std::string &err);
    bool sign_digest(const std::string &digest_hex, const std::string &algorithm,
                     std::string &signature_hex, RemoteCertificate &certificate, std::string &err,
                     const std::string &file_sha256 = std::string());

    /** 拉取当前 Key 绑定证书的查杀策略；旧版 Worker 没有这个端点时返回 required=false */
    bool fetch_scan_policy(ScanPolicy &out, std::string &err);
    /** 按原始文件 SHA-256 查询；found=false 表示查杀服务里还没有这个文件 */
    bool check_scan(const std::string &sha256, ScanVerdict &out, std::string &err);
    /** 上传文件并建立分析任务；sha256 会用上传内容重新核对 */
    bool upload_scan(const std::string &path, const std::string &sha256, std::string &analysis_id,
                     std::string &uploaded_sha256, std::string &err);
    /** 客户端直传用：向服务端要一次性上传地址与查杀 Key（需要管理员开启） */
    bool fetch_upload_target(std::string &upload_url, std::string &api_key, long long &max_bytes,
                             std::string &err);
    /** 把直传得到的分析 ID 登记到 Worker，之后照常轮询 */
    bool register_analysis(const std::string &analysis_id, const std::string &sha256, std::string &err);
    /** 轮询分析结果；done=false 表示还在扫描 */
    bool poll_scan(const std::string &analysis_id, ScanVerdict &out, bool &done, std::string &err);

    const std::string &base_url() const { return base_url_; }

private:
    std::string url_for(const std::string &path) const;

    std::string base_url_;
    std::string api_key_;
};

} // namespace cs
