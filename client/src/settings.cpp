#include "settings.h"

#include "digest.h"
#include "json.h"
#include "util.h"

namespace cs {

namespace {

const std::vector<BuiltinTsa> kTsaList = {
    {"DigiCert", "http://timestamp.digicert.com"},
    {"Symantec", "http://sha256timestamp.ws.symantec.com/sha256/rfc3161"},
    {"GeoTrust", "http://timestamp.geotrust.com/rfc3161"},
    {"Comodo", "http://timestamp.comodoca.com/rfc3161"},
    {"WoSign", "http://timestamp.wosign.com/rfc3161"},
    {"GlobalSign", "http://timestamp.globalsign.com/tsa/r6advanced1"},
    {"Entrust", "http://timestamp.entrust.net/TSS/RFC3161sha2TS"},
    {"GoDaddy", "http://tsa.starfieldtech.com"},
    {"Certum", "http://time.certum.pl/"},
};

Json json_string(const std::string &value) {
    Json node;
    node.type = Json::Type::String;
    node.text = value;
    return node;
}

Json json_bool(bool value) {
    Json node;
    node.type = Json::Type::Bool;
    node.boolean = value;
    return node;
}

} // namespace

const std::vector<BuiltinTsa> &builtin_tsa() {
    return kTsaList;
}

const BuiltinTsa *find_builtin_tsa(const std::string &name) {
    for (const auto &item : kTsaList) {
        if (name == item.name) return &item;
    }
    return nullptr;
}

std::string effective_tsa(const Settings &settings) {
    if (!settings.tsa_url.empty()) return settings.tsa_url;
    if (const BuiltinTsa *builtin = find_builtin_tsa(settings.tsa_name)) return builtin->url;
    return kTsaList.front().url;
}

bool load_settings(Settings &out, std::string &err) {
    err.clear();
    const std::string path = config_file();

    if (file_exists(path)) {
        std::string text;
        if (!read_file(path, text, err)) return false;
        if (!trim(text).empty()) {
            Json root;
            std::string parse_error;
            if (!Json::parse(text, root, parse_error)) {
                err = "配置文件不是合法 JSON：" + path + "（" + parse_error + "）";
                return false;
            }
            const std::string server = root.get_string("server");
            const std::string key = root.get_string("api_key");
            const std::string tsa_url = root.get_string("tsa_url");
            const std::string tsa_name = root.get_string("tsa_name");
            const std::string algorithm = root.get_string("algorithm");
            const std::vector<std::string> algorithms = root.get_strings("algorithms");
            const std::string lang = root.get_string("lang");
            const std::string theme = root.get_string("theme");
            const std::string username = root.get_string("username");
            const std::string key_name = root.get_string("key_name");

            if (!server.empty()) out.server = server;
            if (!key.empty()) out.api_key = key;
            if (!tsa_url.empty()) out.tsa_url = tsa_url;
            if (!tsa_name.empty()) out.tsa_name = tsa_name;
            // 新版写 algorithms 数组；旧配置只有单个 algorithm 字符串
            std::vector<std::string> picked;
            for (const auto &item : algorithms) {
                if (digest::valid(item)) picked.push_back(digest::normalize(item));
            }
            if (picked.empty() && digest::valid(algorithm)) picked.push_back(digest::normalize(algorithm));
            if (!picked.empty()) out.algorithms = picked;
            if (lang == "zh" || lang == "en") out.lang = lang;
            if (theme == "auto" || theme == "dark" || theme == "light") out.theme = theme;
            if (!username.empty()) out.username = username;
            if (!key_name.empty()) out.key_name = key_name;
            out.timestamp = root.get_bool("timestamp", out.timestamp);
            out.backup = root.get_bool("backup", out.backup);
        }
    }

    const std::string env_server = getenv_string("CERTUM_SIGNER_SERVER");
    if (!env_server.empty()) out.server = env_server;
    const std::string env_key = getenv_string("CERTUM_SIGNER_API_KEY");
    if (!env_key.empty()) out.api_key = env_key;
    const std::string env_tsa = getenv_string("CERTUM_SIGNER_TSA");
    if (!env_tsa.empty()) out.tsa_url = env_tsa;

    return true;
}

bool save_settings(const Settings &settings, std::string &err) {
    err.clear();
    if (!make_dirs(config_dir())) {
        err = "无法创建配置目录：" + config_dir();
        return false;
    }
    Json root;
    root.type = Json::Type::Object;
    root.members.emplace_back("server", json_string(settings.server));
    root.members.emplace_back("api_key", json_string(settings.api_key));
    root.members.emplace_back("tsa_name", json_string(settings.tsa_name));
    root.members.emplace_back("tsa_url", json_string(settings.tsa_url));

    Json list;
    list.type = Json::Type::Array;
    for (const auto &raw : settings.algorithms) {
        if (!digest::valid(raw)) continue;
        const std::string name = digest::normalize(raw);
        bool seen = false;
        for (const auto &item : list.items) {
            if (item.text == name) seen = true;
        }
        if (!seen) list.items.push_back(json_string(name));
    }
    if (list.items.empty()) list.items.push_back(json_string("sha256"));
    root.members.emplace_back("algorithms", list);
    // 旧版客户端只认单个 algorithm，这里写成第一项，方便降级
    root.members.emplace_back("algorithm", json_string(list.items.front().text));
    root.members.emplace_back("timestamp", json_bool(settings.timestamp));
    root.members.emplace_back("backup", json_bool(settings.backup));
    root.members.emplace_back("lang", json_string(settings.lang));
    root.members.emplace_back("theme", json_string(settings.theme));
    root.members.emplace_back("username", json_string(settings.username));
    root.members.emplace_back("key_name", json_string(settings.key_name));
    return write_file(config_file(), root.dump() + "\n", err);
}

} // namespace cs
