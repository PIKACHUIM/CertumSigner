#pragma once
// 本地配置（服务器地址 + API Key）
#include <string>

namespace cs {

struct Settings {
    std::string server = "http://127.0.0.1:8787";
    std::string api_key;
    /** RFC3161 时间戳服务；空 = 用内置默认（http://time.certum.pl/） */
    std::string tsa_url;
};

/** 读配置；文件不存在不算错误，环境变量优先于文件 */
bool load_settings(Settings &out, std::string &err);
bool save_settings(const Settings &settings, std::string &err);

} // namespace cs
