#pragma once
// RFC 3161 时间戳（Authenticode 里的 unsigned attribute）
#include <string>

#include "http.h"

namespace cs {

/**
 * 请求时间戳令牌。
 * @param tsa_url  时间戳服务地址；也可以指向 Worker 的 /v1/timestamp 代理
 * @param headers  额外请求头（走 Worker 代理时放 Authorization）
 * @param signature 云端返回的 RSA 签名原始字节（messageImprint 就是它的 SHA-256）
 * @param token_der 输出：TimeStampToken（PKCS#7 ContentInfo）的 DER
 */
bool request_timestamp(const std::string &tsa_url, const HttpHeaders &headers, const std::string &signature,
                       std::string &token_der, std::string &err);

} // namespace cs
