#include "tsa.h"

#include "der.h"
#include "http.h"
#include "pkcs7.h"
#include "util.h"

#include <openssl/asn1.h>
#include <openssl/pkcs7.h>
#include <openssl/ts.h>

namespace cs {

namespace {
const char *kSha256Oid = "2.16.840.1.101.3.4.2.1";

/** 响应体是不是可读文本（拦截页通常是 HTML/JSON，二进制错误页会被跳过） */
bool looks_like_text(const std::string &body) {
    if (body.empty()) return false;
    size_t control = 0;
    for (unsigned char ch : body) {
        if (ch < 0x09 || (ch > 0x0D && ch < 0x20)) control++;
    }
    return control * 10 <= body.size();
}

/** 取一段单行摘要，用于把拦截页/错误页的内容带回命令行 */
std::string text_snippet(const std::string &body, size_t limit) {
    std::string out;
    bool pending_space = false;
    for (unsigned char ch : body) {
        if (out.size() >= limit) break;
        if (ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n') {
            pending_space = !out.empty();
            continue;
        }
        if (ch < 0x20) continue;
        if (pending_space) {
            out.push_back(' ');
            pending_space = false;
        }
        out.push_back(static_cast<char>(ch));
    }
    return out;
}
} // namespace

bool request_timestamp(const std::string &tsa_url, const HttpHeaders &extra_headers, const std::string &signature,
                       std::string &token_der, std::string &err) {
    token_der.clear();
    if (tsa_url.empty()) {
        err = "未配置时间戳服务地址";
        return false;
    }

    // 时间戳的 messageImprint 固定用 SHA-256，与签名本身用的摘要算法无关
    const std::string imprint = hash_bytes(signature, "sha256");
    if (imprint.empty()) {
        err = "计算时间戳摘要失败";
        return false;
    }

    // TimeStampReq ::= SEQUENCE { version 1, messageImprint, certReq TRUE }
    std::string message_imprint =
        der::sequence(der::algorithm_identifier(kSha256Oid) + der::octet_string(imprint));
    std::string cert_req("\x01\x01\xFF", 3);
    std::string tsq = der::sequence(der::integer(1) + message_imprint + cert_req);

    HttpHeaders headers;
    headers.emplace_back("Content-Type", "application/timestamp-query");
    headers.emplace_back("Accept", "application/timestamp-reply");
    for (const auto &header : extra_headers) headers.push_back(header);

    HttpResponse response = http_post(tsa_url, headers, tsq, 45);
    if (!response.error.empty()) {
        err = "时间戳请求失败：" + response.error;
        return false;
    }
    if (!response.ok()) {
        err = "时间戳服务返回 HTTP " + std::to_string(response.status) + "（" + tsa_url + "）";
        if (response.status == 401 || response.status == 403) {
            err += "；常见原因是本机安全软件拦截了未签名程序的出网请求（把 exe 加白名单），"
                   "或该服务不接受这个来源，可用 --tsa 换一个时间戳服务";
        }
        if (looks_like_text(response.body)) {
            std::string snippet = text_snippet(response.body, 160);
            if (!snippet.empty()) err += "；响应内容：" + snippet;
        }
        return false;
    }

    const unsigned char *cursor = reinterpret_cast<const unsigned char *>(response.body.data());
    TS_RESP *ts_response = d2i_TS_RESP(nullptr, &cursor, static_cast<long>(response.body.size()));
    if (!ts_response) {
        err = "时间戳响应无法解析";
        return false;
    }

    bool ok = false;
    TS_STATUS_INFO *status_info = TS_RESP_get_status_info(ts_response);
    long status = status_info ? ASN1_INTEGER_get(TS_STATUS_INFO_get0_status(status_info)) : -1;

    if (status == 0 || status == 1) {
        PKCS7 *token = TS_RESP_get_token(ts_response);
        if (token) {
            unsigned char *buffer = nullptr;
            int length = i2d_PKCS7(token, &buffer);
            if (length > 0) {
                token_der.assign(reinterpret_cast<char *>(buffer), static_cast<size_t>(length));
                ok = true;
            } else {
                err = "时间戳令牌编码失败";
            }
            OPENSSL_free(buffer);
        } else {
            err = "时间戳响应里没有令牌";
        }
    } else {
        err = "时间戳被拒绝（状态 " + std::to_string(status) + "）";
        if (status_info) {
            const STACK_OF(ASN1_UTF8STRING) *texts = TS_STATUS_INFO_get0_text(status_info);
            if (texts && sk_ASN1_UTF8STRING_num(texts) > 0) {
                const ASN1_UTF8STRING *first = sk_ASN1_UTF8STRING_value(texts, 0);
                const unsigned char *data = first ? ASN1_STRING_get0_data(first) : nullptr;
                int length = first ? ASN1_STRING_length(first) : 0;
                if (data && length > 0) {
                    err += "：" + std::string(reinterpret_cast<const char *>(data), static_cast<size_t>(length));
                }
            }
        }
    }

    TS_RESP_free(ts_response);
    return ok;
}

} // namespace cs
