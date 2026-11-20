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

Json json_number(double value) {
    Json node;
    node.type = Json::Type::Number;
    node.number = value;
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
            const std::string session_token = root.get_string("session_token");
            const double session_expires = root.get_number("session_expires", 0);

            if (!server.empty()) out.server = server;
            if (!key.empty()) out.api_key = key;
            if (!tsa_url.empty()) out.tsa_url = tsa_url;
            if (!tsa_name.empty()) out.tsa_name = tsa_name;
            if (!session_token.empty()) out.session_token = session_token;
            if (session_expires > 0) out.session_expires = static_cast<long long>(session_expires);

            // 本机保存的 Key 明文：平台侧只有哈希，丢了就得换发，所以原样落盘
            if (const Json *locals = root.find("local_keys"); locals && locals->type == Json::Type::Array) {
                out.local_keys.clear();
                for (const auto &item : locals->items) {
                    LocalKey entry;
                    entry.id = item.get_string("id");
                    entry.name = item.get_string("name");
                    entry.prefix = item.get_string("prefix");
                    entry.credential_id = item.get_string("credential_id");
                    entry.credential_label = item.get_string("credential_label");
                    entry.server = item.get_string("server");
                    entry.plaintext = item.get_string("plaintext");
                    entry.created_at = static_cast<long long>(item.get_number("created_at", 0));
                    if (!entry.id.empty() && !entry.plaintext.empty()) out.local_keys.push_back(entry);
                }
            }
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
            out.skip_signed = root.get_bool("skip_signed", out.skip_signed);
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
    root.members.emplace_back("skip_signed", json_bool(settings.skip_signed));
    root.members.emplace_back("lang", json_string(settings.lang));
    root.members.emplace_back("theme", json_string(settings.theme));
    root.members.emplace_back("username", json_string(settings.username));
    root.members.emplace_back("key_name", json_string(settings.key_name));
    root.members.emplace_back("session_token", json_string(settings.session_token));
    root.members.emplace_back("session_expires", json_number(static_cast<double>(settings.session_expires)));

    Json locals;
    locals.type = Json::Type::Array;
    for (const auto &key : settings.local_keys) {
        if (key.id.empty() || key.plaintext.empty()) continue;
        Json node;
        node.type = Json::Type::Object;
        node.members.emplace_back("id", json_string(key.id));
        node.members.emplace_back("name", json_string(key.name));
        node.members.emplace_back("prefix", json_string(key.prefix));
        node.members.emplace_back("credential_id", json_string(key.credential_id));
        node.members.emplace_back("credential_label", json_string(key.credential_label));
        node.members.emplace_back("server", json_string(key.server));
        node.members.emplace_back("plaintext", json_string(key.plaintext));
        node.members.emplace_back("created_at", json_number(static_cast<double>(key.created_at)));
        locals.items.push_back(node);
    }
    root.members.emplace_back("local_keys", locals);
    return write_file(config_file(), root.dump() + "\n", err);
}

} // namespace cs
