#include "settings.h"

#include "json.h"
#include "util.h"

namespace cs {

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
            std::string server = root.get_string("server");
            std::string key = root.get_string("api_key");
            std::string tsa = root.get_string("tsa_url");
            if (!server.empty()) out.server = server;
            if (!key.empty()) out.api_key = key;
            if (!tsa.empty()) out.tsa_url = tsa;
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
    Json server;
    server.type = Json::Type::String;
    server.text = settings.server;
    Json key;
    key.type = Json::Type::String;
    key.text = settings.api_key;
    Json tsa;
    tsa.type = Json::Type::String;
    tsa.text = settings.tsa_url;
    root.members.emplace_back("server", server);
    root.members.emplace_back("api_key", key);
    root.members.emplace_back("tsa_url", tsa);
    return write_file(config_file(), root.dump() + "\n", err);
}

} // namespace cs
