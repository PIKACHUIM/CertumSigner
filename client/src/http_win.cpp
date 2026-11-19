// WinHTTP 实现（Windows 自带，不需要额外依赖）
#include "http.h"

#include <windows.h>
#include <winhttp.h>

#include <algorithm>
#include <cctype>
#include <exception>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#ifndef WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY
#define WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY 4
#endif

namespace cs {

namespace {

std::wstring widen(const std::string &text) {
    if (text.empty()) return std::wstring();
    int size = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    if (size <= 0) return std::wstring();
    std::wstring out(static_cast<size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), size);
    return out;
}

struct Handle {
    HINTERNET value = nullptr;
    ~Handle() {
        if (value) WinHttpCloseHandle(value);
    }
};

void set_error(HttpResponse &out, const char *what) {
    DWORD code = GetLastError();
    out.error = std::string(what) + "（WinHTTP 错误 " + std::to_string(code) + "）";
}

bool add_headers(HINTERNET request, const HttpHeaders &headers, bool skip_content_type) {
    if (headers.empty()) return true;
    std::wstring block;
    for (const auto &header : headers) {
        if (skip_content_type) {
            const std::string name = [&] {
                std::string lower = header.first;
                std::transform(lower.begin(), lower.end(), lower.begin(),
                               [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
                return lower;
            }();
            if (name == "content-type") continue;
        }
        block += widen(header.first + ": " + header.second);
        block += L"\r\n";
    }
    if (block.empty()) return true;
    return WinHttpAddRequestHeaders(request, block.c_str(), static_cast<DWORD>(block.size()),
                                    WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE) != FALSE;
}

/** 建立会话并打开请求；请求头由调用方添加 */
bool open_request(const std::string &method, const std::string &url, int timeout_seconds, Handle &session,
                  Handle &connection, Handle &request, HttpResponse &out) {
    std::wstring wurl = widen(url);
    URL_COMPONENTS parts{};
    parts.dwStructSize = sizeof(parts);
    parts.dwSchemeLength = static_cast<DWORD>(-1);
    parts.dwHostNameLength = static_cast<DWORD>(-1);
    parts.dwUrlPathLength = static_cast<DWORD>(-1);
    parts.dwExtraInfoLength = static_cast<DWORD>(-1);

    if (!WinHttpCrackUrl(wurl.c_str(), 0, 0, &parts)) {
        out.error = "URL 解析失败（WinHTTP 错误 " + std::to_string(GetLastError()) + "）：" + url;
        return false;
    }

    std::wstring host(parts.lpszHostName, parts.dwHostNameLength);
    std::wstring path(parts.lpszUrlPath, parts.dwUrlPathLength);
    if (parts.dwExtraInfoLength > 0) {
        path.append(parts.lpszExtraInfo, parts.dwExtraInfoLength);
    }
    const bool secure = parts.nScheme == INTERNET_SCHEME_HTTPS;
    const INTERNET_PORT port = parts.nPort;

    session.value = WinHttpOpen(L"CertumSigner/1.0", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                                WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session.value) {
        session.value = WinHttpOpen(L"CertumSigner/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                    WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    }
    if (!session.value) {
        set_error(out, "创建 WinHTTP 会话失败");
        return false;
    }

    int timeout_ms = (timeout_seconds > 0 ? timeout_seconds : 60) * 1000;
    WinHttpSetTimeouts(session.value, timeout_ms, timeout_ms, timeout_ms, timeout_ms);

    connection.value = WinHttpConnect(session.value, host.c_str(), port, 0);
    if (!connection.value) {
        set_error(out, "连接服务器失败");
        return false;
    }

    std::wstring verb = widen(method);
    request.value = WinHttpOpenRequest(connection.value, verb.c_str(), path.c_str(), nullptr,
                                       WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                       secure ? WINHTTP_FLAG_SECURE : 0);
    if (!request.value) {
        set_error(out, "创建请求失败");
        return false;
    }
    return true;
}

bool read_response(HINTERNET request, HttpResponse &out) {
    if (!WinHttpReceiveResponse(request, nullptr)) {
        set_error(out, "读取响应失败");
        return false;
    }

    DWORD status = 0;
    DWORD status_size = sizeof(status);
    WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                        WINHTTP_HEADER_NAME_BY_INDEX, &status, &status_size, WINHTTP_NO_HEADER_INDEX);
    out.status = static_cast<long>(status);

    std::string raw;
    for (;;) {
        DWORD available = 0;
        if (!WinHttpQueryDataAvailable(request, &available)) {
            set_error(out, "读取响应体失败");
            return false;
        }
        if (available == 0) break;
        std::string chunk(available, '\0');
        DWORD read = 0;
        if (!WinHttpReadData(request, chunk.data(), available, &read)) {
            set_error(out, "读取响应体失败");
            return false;
        }
        chunk.resize(read);
        raw += chunk;
    }
    out.body.swap(raw);
    return true;
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
    return "----certumsigner" + std::to_string(GetTickCount64()) + std::to_string(++counter);
}

bool write_all(HINTERNET request, const char *data, size_t length, HttpResponse &out) {
    size_t sent = 0;
    while (sent < length) {
        const DWORD chunk = static_cast<DWORD>(std::min<size_t>(length - sent, 1024 * 1024));
        DWORD written = 0;
        if (!WinHttpWriteData(request, data + sent, chunk, &written) || written == 0) {
            set_error(out, "上传文件失败");
            return false;
        }
        sent += written;
    }
    return true;
}

} // namespace

HttpResponse http_request(const std::string &method, const std::string &url,
                          const HttpHeaders &headers, const std::string &body, int timeout_seconds) {
    HttpResponse out;

    Handle session;
    Handle connection;
    Handle request;
    if (!open_request(method, url, timeout_seconds, session, connection, request, out)) return out;
    if (!add_headers(request.value, headers, false)) {
        set_error(out, "设置请求头失败");
        return out;
    }

    LPVOID body_ptr = body.empty() ? WINHTTP_NO_REQUEST_DATA : const_cast<char *>(body.data());
    DWORD body_size = static_cast<DWORD>(body.size());
    if (!WinHttpSendRequest(request.value, WINHTTP_NO_ADDITIONAL_HEADERS, 0, body_ptr, body_size,
                            body_size, 0)) {
        set_error(out, "发送请求失败");
        return out;
    }

    read_response(request.value, out);
    return out;
}

HttpResponse http_post_file_multipart(const std::string &url, const HttpHeaders &headers,
                                      const std::string &field, const std::string &filename,
                                      const std::string &path, int timeout_seconds) {
    HttpResponse out;

    std::ifstream file;
    try {
        file.open(std::filesystem::u8path(path), std::ios::binary);
    } catch (const std::exception &) {
        out.error = "无法打开文件：" + path;
        return out;
    }
    if (!file) {
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
    const std::string prefix = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + field +
                               "\"; filename=\"" + sanitize_filename(filename) +
                               "\"\r\nContent-Type: application/octet-stream\r\n\r\n";
    const std::string suffix = "\r\n--" + boundary + "--\r\n";
    const unsigned long long total = prefix.size() + file_size + suffix.size();
    if (total > 0xFFFFFFFFull) {
        out.error = "文件过大，单次上传不能超过 4 GB";
        return out;
    }

    Handle session;
    Handle connection;
    Handle request;
    if (!open_request("POST", url, timeout_seconds, session, connection, request, out)) return out;

    HttpHeaders all = headers;
    all.emplace_back("Content-Type", "multipart/form-data; boundary=" + boundary);
    if (!add_headers(request.value, all, true)) {
        set_error(out, "设置请求头失败");
        return out;
    }

    // 先声明总长度，再用 WinHttpWriteData 分块写入，文件本身不会整体进内存
    if (!WinHttpSendRequest(request.value, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0,
                            static_cast<DWORD>(total), 0)) {
        set_error(out, "发送请求失败");
        return out;
    }

    if (!write_all(request.value, prefix.data(), prefix.size(), out)) return out;

    std::vector<char> buffer(1024 * 1024);
    while (file) {
        file.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
        const std::streamsize got = file.gcount();
        if (got > 0 && !write_all(request.value, buffer.data(), static_cast<size_t>(got), out)) return out;
        if (file.eof()) break;
        if (file.bad()) {
            out.error = "读取文件失败：" + path;
            return out;
        }
    }

    if (!write_all(request.value, suffix.data(), suffix.size(), out)) return out;

    read_response(request.value, out);
    return out;
}

} // namespace cs
