#pragma once
// 本地配置：服务地址、API Key、签名/时间戳选项、界面语言与主题
#include <string>
#include <vector>

namespace cs {

struct BuiltinTsa {
    const char *name;
    const char *url;
};

/** 界面里可选的内置时间戳服务（默认第一项 DigiCert） */
const std::vector<BuiltinTsa> &builtin_tsa();
/** 按名字找内置服务；找不到返回 nullptr */
const BuiltinTsa *find_builtin_tsa(const std::string &name);

struct Settings {
    /** 平台地址；首次使用由用户在登录页填写 */
    std::string server;
    std::string api_key;
    /** 内置时间戳服务的名字，界面下拉框用，默认 DigiCert */
    std::string tsa_name = "DigiCert";
    /** 自定义时间戳地址；非空时优先于 tsa_name（也支持 worker/auto 走代理） */
    std::string tsa_url;
    std::string algorithm = "sha256"; // sha1 | sha256
    bool timestamp = true;
    bool backup = false;
    /** zh | en；空 = 跟随系统语言 */
    std::string lang;
    /** auto | dark | light */
    std::string theme = "auto";
    /** 上次登录的用户名（只用于显示） */
    std::string username;
    /** 上次使用的 Key 名称（只用于显示） */
    std::string key_name;
};

/** 真正要请求的时间戳地址：tsa_url > 内置 tsa_name > DigiCert */
std::string effective_tsa(const Settings &settings);

/** 读配置；文件不存在不算错误，环境变量优先于文件 */
bool load_settings(Settings &out, std::string &err);
bool save_settings(const Settings &settings, std::string &err);

} // namespace cs
