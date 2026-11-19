// libcurl 实现（Linux / macOS）
#include "http.h"

#include <curl/curl.h>

#include <algorithm>
#include <cctype>
#include <cstring>
#include <ctime>
#include <exception>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <string>

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

std::string sanitize_filename(const std::string &name) {
    std::string out;
    for (char c : name) {
        if (c == '\r' || c == '\n' || c == '"' || c == '\\') {
            out.push_back('_');
        } else {
            out.push_back(c);
        }
    }
    if (out.empty()) out = "upload.bin";
    if (out.size() > 120) out.resize(120);
    return out;
}

std::string make_boundary() {
    static unsigned counter = 0;
    return "----certumsigner" + std::to_string(static_cast<unsigned long long>(time(nullptr))) +
           std::to_string(++counter);
}

/** 按 prefix → 文件内容 → suffix 的顺序供给 libcurl，文件本身不进内存 */
struct MultipartSource {
    std::string prefix;
    std::string suffix;
    std::ifstream file;
    size_t prefix_sent = 0;
    bool file_done = false;
    size_t suffix_sent = 0;
};

size_t read_callback(char *buffer, size_t size, size_t nitems, void *userdata) {
    auto *src = static_cast<MultipartSource *>(userdata);
    const size_t capacity = size * nitems;
    size_t written = 0;

    if (src->prefix_sent < src->prefix.size()) {
        const size_t n = std::min(capacity, src->prefix.size() - src->prefix_sent);
        std::memcpy(buffer, src->prefix.data() + src->prefix_sent, n);
        src->prefix_sent += n;
        written += n;
    }

    while (written < capacity && !src->file_done) {
        src->file.read(buffer + written, static_cast<std::streamsize>(capacity - written));
        const std::streamsize got = src->file.gcount();
        if (got > 0) written += static_cast<size_t>(got);
        if (src->file.eof() || !src->file) src->file_done = true;
        if (got <= 0) break;
    }

    if (src->file_done && src->suffix_sent < src->suffix.size() && written < capacity) {
        const size_t n = std::min(capacity - written, src->suffix.size() - src->suffix_sent);
        std::memcpy(buffer + written, src->suffix.data() + src->suffix_sent, n);
        src->suffix_sent += n;
        written += n;
    }

    return written;
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

HttpResponse http_post_file_multipart(const std::string &url, const HttpHeaders &headers,
                                      const std::string &field, const std::string &filename,
                                      const std::string &path, int timeout_seconds) {
    HttpResponse out;
    ensure_global_init();

    MultipartSource source;
    try {
        source.file.open(std::filesystem::u8path(path), std::ios::binary);
    } catch (const std::exception &) {
        out.error = "无法打开文件：" + path;
        return out;
    }
    if (!source.file) {
        out.error = "无法打开文件：" + path;
        return out;
    }

    std::error_code size_error;
    const auto file_size = std::filesystem::file_size(std::filesystem::u8path(path), size_error);
    if (size_error) {
        out.error = "读取文件大小失败：" + path;
        return out;
    }

    const std::string boundary = make_boundary();
    source.prefix = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + field +
                    "\"; filename=\"" + sanitize_filename(filename) +
                    "\"\r\nContent-Type: application/octet-stream\r\n\r\n";
    source.suffix = "\r\n--" + boundary + "--\r\n";
    const unsigned long long total = source.prefix.size() + file_size + source.suffix.size();

    CURL *curl = curl_easy_init();
    if (!curl) {
        out.error = "初始化 libcurl 失败";
        return out;
    }

    curl_slist *list = nullptr;
    for (const auto &header : headers) {
        std::string name = header.first;
        std::transform(name.begin(), name.end(), name.begin(),
                       [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        if (name == "content-type") continue;
        list = curl_slist_append(list, (header.first + ": " + header.second).c_str());
    }
    list = curl_slist_append(list, ("Content-Type: multipart/form-data; boundary=" + boundary).c_str());

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "CertumSigner/1.0");
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_callback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &out.body);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_MAXREDIRS, 10L);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, static_cast<long>(timeout_seconds > 0 ? timeout_seconds : 1800));
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 20L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, list);
    curl_easy_setopt(curl, CURLOPT_POST, 1L);
    curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE_LARGE, static_cast<curl_off_t>(total));
    curl_easy_setopt(curl, CURLOPT_READFUNCTION, read_callback);
    curl_easy_setopt(curl, CURLOPT_READDATA, &source);

    CURLcode code = curl_easy_perform(curl);
    if (code != CURLE_OK) {
        out.error = std::string("上传文件失败：") + curl_easy_strerror(code);
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
