#pragma once
// 最小 HTTP 客户端接口：Windows 用 WinHTTP（系统自带），Linux 用 libcurl。
#include <string>
#include <utility>
#include <vector>

namespace cs {

using HttpHeaders = std::vector<std::pair<std::string, std::string>>;

struct HttpResponse {
    long status = 0;
    std::string body;
    HttpHeaders headers;
    std::string error;

    bool ok() const { return status >= 200 && status < 300; }
};

HttpResponse http_request(const std::string &method, const std::string &url,
                          const HttpHeaders &headers, const std::string &body,
                          int timeout_seconds = 60);

inline HttpResponse http_get(const std::string &url, const HttpHeaders &headers = {},
                             int timeout_seconds = 60) {
    return http_request("GET", url, headers, std::string(), timeout_seconds);
}

inline HttpResponse http_post(const std::string &url, const HttpHeaders &headers,
                              const std::string &body, int timeout_seconds = 60) {
    return http_request("POST", url, headers, body, timeout_seconds);
}

/**
 * 以 multipart/form-data 流式上传磁盘文件：边读边发，不把整份文件读进内存。
 * 用于客户端直传 VirusTotal 大文件通道（最大 650 MB）。
 */
HttpResponse http_post_file_multipart(const std::string &url, const HttpHeaders &headers,
                                      const std::string &field, const std::string &filename,
                                      const std::string &path, int timeout_seconds = 1800);

} // namespace cs
