// libcurl 实现（Linux / macOS）
#include "http.h"

#include <curl/curl.h>

#include <mutex>

namespace cs {

namespace {

std::once_flag g_init;

size_t write_callback(char *data, size_t size, size_t count, void *userdata) {
    auto *out = static_cast<std::string *>(userdata);
    out->append(data, size * count);
    return size * count;
}

void ensure_global_init() {
    std::call_once(g_init, []() { curl_global_init(CURL_GLOBAL_DEFAULT); });
}

} // namespace

HttpResponse http_request(const std::string &method, const std::string &url,
                          const HttpHeaders &headers, const std::string &body, int timeout_seconds) {
    HttpResponse out;
    ensure_global_init();

    CURL *curl = curl_easy_init();
    if (!curl) {
        out.error = "初始化 libcurl 失败";
        return out;
    }

    curl_slist *list = nullptr;
    for (const auto &header : headers) {
        list = curl_slist_append(list, (header.first + ": " + header.second).c_str());
    }

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "CertumSigner/1.0");
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &out.body);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 10L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, static_cast<long>(timeout_seconds > 0 ? timeout_seconds : 60));
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 20L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    if (list) curl_easy_setopt(curl, CURLOPT_HTTPHEADER, list);

    if (method == "POST") {
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, body.data());
        curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(body.size()));
    } else if (method != "GET") {
        curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, method.c_str());
    }

    CURLcode code = curl_easy_perform(curl);
    if (code != CURLE_OK) {
        out.error = std::string("HTTP 请求失败：") + curl_easy_strerror(code);
    } else {
        long status = 0;
        curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
        out.status = status;
    }

    if (list) curl_slist_free_all(list);
    curl_easy_cleanup(curl);
    return out;
}

} // namespace cs
