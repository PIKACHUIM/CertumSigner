// WinHTTP 实现（Windows 自带，不需要额外依赖）
#include "http.h"

#include <windows.h>
#include <winhttp.h>

#include <string>

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

} // namespace

HttpResponse http_request(const std::string &method, const std::string &url,
                          const HttpHeaders &headers, const std::string &body, int timeout_seconds) {
    HttpResponse out;

    std::wstring wurl = widen(url);
    URL_COMPONENTS parts{};
    parts.dwStructSize = sizeof(parts);
    parts.dwSchemeLength = static_cast<DWORD>(-1);
    parts.dwHostNameLength = static_cast<DWORD>(-1);
    parts.dwUrlPathLength = static_cast<DWORD>(-1);
    parts.dwExtraInfoLength = static_cast<DWORD>(-1);

    if (!WinHttpCrackUrl(wurl.c_str(), 0, 0, &parts)) {
        out.error = "URL 解析失败：" + url;
        return out;
    }

    std::wstring host(parts.lpszHostName, parts.dwHostNameLength);
    std::wstring path(parts.lpszUrlPath, parts.dwUrlPathLength);
    if (parts.dwExtraInfoLength > 0) {
        path.append(parts.lpszExtraInfo, parts.dwExtraInfoLength);
    }
    const bool secure = parts.nScheme == INTERNET_SCHEME_HTTPS;
    const INTERNET_PORT port = parts.nPort;

    Handle session;
    session.value = WinHttpOpen(L"CertumSigner/1.0", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                                WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    if (!session.value) {
        session.value = WinHttpOpen(L"CertumSigner/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                    WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
    }
    if (!session.value) {
        set_error(out, "创建 WinHTTP 会话失败");
        return out;
    }

    int timeout_ms = (timeout_seconds > 0 ? timeout_seconds : 60) * 1000;
    WinHttpSetTimeouts(session.value, timeout_ms, timeout_ms, timeout_ms, timeout_ms);

    Handle connection;
    connection.value = WinHttpConnect(session.value, host.c_str(), port, 0);
    if (!connection.value) {
        set_error(out, "连接服务器失败");
        return out;
    }

    std::wstring verb = widen(method);
    Handle request;
    request.value = WinHttpOpenRequest(connection.value, verb.c_str(), path.c_str(), nullptr,
                                       WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                       secure ? WINHTTP_FLAG_SECURE : 0);
    if (!request.value) {
        set_error(out, "创建请求失败");
        return out;
    }

    if (!headers.empty()) {
        std::wstring block;
        for (const auto &header : headers) {
            block += widen(header.first + ": " + header.second);
            block += L"\r\n";
        }
        WinHttpAddRequestHeaders(request.value, block.c_str(), static_cast<DWORD>(block.size()),
                                 WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE);
    }

    LPVOID body_ptr = body.empty() ? WINHTTP_NO_REQUEST_DATA : const_cast<char *>(body.data());
    DWORD body_size = static_cast<DWORD>(body.size());
    if (!WinHttpSendRequest(request.value, WINHTTP_NO_ADDITIONAL_HEADERS, 0, body_ptr, body_size,
                            body_size, 0)) {
        set_error(out, "发送请求失败");
        return out;
    }

    if (!WinHttpReceiveResponse(request.value, nullptr)) {
        set_error(out, "读取响应失败");
        return out;
    }

    DWORD status = 0;
    DWORD status_size = sizeof(status);
    WinHttpQueryHeaders(request.value, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                        WINHTTP_HEADER_NAME_BY_INDEX, &status, &status_size, WINHTTP_NO_HEADER_INDEX);
    out.status = static_cast<long>(status);

    std::string raw;
    for (;;) {
        DWORD available = 0;
        if (!WinHttpQueryDataAvailable(request.value, &available)) {
            set_error(out, "读取响应体失败");
            return out;
        }
        if (available == 0) break;
        std::string chunk(available, '\0');
        DWORD read = 0;
        if (!WinHttpReadData(request.value, chunk.data(), available, &read)) {
            set_error(out, "读取响应体失败");
            return out;
        }
        chunk.resize(read);
        raw += chunk;
    }
    out.body.swap(raw);
    return out;
}

} // namespace cs
