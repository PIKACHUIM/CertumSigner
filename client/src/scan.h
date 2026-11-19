#pragma once
// 签名前的病毒查杀：原始文件 SHA-256 → 查询 / 上传 / 轮询
#include "api.h"

#include <functional>
#include <string>

namespace cs {
namespace scan {

using LogFn = std::function<void(const std::string &)>;

/** 原始文件 SHA-256（不是 Authenticode 摘要） */
bool file_sha256(const std::string &path, std::string &hex, std::string &err);

/**
 * 签名前校验。
 *   auto   未收录时自动经 Worker 上传并等待结果；
 *   manual 未收录时直接失败，提示用户去手动上传页或运行 `certumsigner scan`。
 * 成功时 sha256_out 为原始文件 SHA-256，随 /v1/sign 一起提交。
 */
bool ensure_clear(ApiClient &api, const ScanPolicy &policy, const std::string &path, const LogFn &log,
                  std::string &sha256_out, std::string &err);

/** 主动扫描（CLI `scan`）：未收录就上传并等待，返回最终结果 */
bool scan_file(ApiClient &api, const ScanPolicy &policy, const std::string &path, const LogFn &log,
               ScanVerdict &out, std::string &err);

/**
 * 上传并等待分析完成；结果写入 out，allowed 由调用方判断。
 * policy.direct_upload 为真时由客户端直传 provider（需要服务端下发 Key）。
 */
bool upload_and_wait(ApiClient &api, const ScanPolicy &policy, const std::string &path, const std::string &sha256,
                     const LogFn &log, ScanVerdict &out, std::string &err);

} // namespace scan
} // namespace cs
