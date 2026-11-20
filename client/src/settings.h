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

/** 本机保存的 Key：平台只存哈希，换发前拿不回明文，所以本地必须留一份 */
struct LocalKey {
    /** 平台上的 Key id */
    std::string id;
    std::string name;
    /** csk_ 开头的前 12 位，用来核对本地明文与平台记录 */
    std::string prefix;
    std::string credential_id;
    std::string credential_label;
    /** 属于哪个平台，切换服务器时不会串 */
    std::string server;
    std::string plaintext;
    long long created_at = 0;
};

struct Settings {
    /** 平台地址；首次使用由用户在登录页填写 */
    std::string server;
    std::string api_key;
    /** 内置时间戳服务的名字，界面下拉框用，默认 DigiCert */
    std::string tsa_name = "DigiCert";
    /** 自定义时间戳地址；非空时优先于 tsa_name（也支持 worker/auto 走代理） */
    std::string tsa_url;
    /** 多选摘要算法：sha1 / sha256 / sha384 / sha512，默认只用 sha256 */
    std::vector<std::string> algorithms{"sha256"};
    bool timestamp = true;
    bool backup = false;
    /** 签名页的「跳过已有签名」，默认勾选 */
    bool skip_signed = true;
    /** zh | en；空 = 跟随系统语言 */
    std::string lang;
    /** auto | dark | light */
    std::string theme = "auto";
    /** 上次登录的用户名（只用于显示） */
    std::string username;
    /** 上次使用的 Key 名称（只用于显示） */
    std::string key_name;
    /** /api/client 会话，用来实时拉取平台上的 Key；过期后需要重新登录 */
    std::string session_token;
    long long session_expires = 0;
    /** 本机保存的明文 Key（可能跨多个平台，按 server + id 区分） */
    std::vector<LocalKey> local_keys;
};

/** 真正要请求的时间戳地址：tsa_url > 内置 tsa_name > DigiCert */
std::string effective_tsa(const Settings &settings);

/** 读配置；文件不存在不算错误，环境变量优先于文件 */
bool load_settings(Settings &out, std::string &err);
bool save_settings(const Settings &settings, std::string &err);

} // namespace cs
