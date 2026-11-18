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

} // namespace cs
