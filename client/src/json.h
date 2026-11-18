#pragma once
// 极简 JSON：够用来读写配置和解析 Worker 的响应，不引入第三方库。
#include <string>
#include <utility>
#include <vector>

namespace cs {

class Json {
public:
    enum class Type { Null, Bool, Number, String, Array, Object };

    Type type = Type::Null;
    bool boolean = false;
    double number = 0;
    std::string text;
    std::vector<Json> items;
    std::vector<std::pair<std::string, Json>> members;

    static bool parse(const std::string &source, Json &out, std::string &err);

    const Json *find(const std::string &key) const;
    std::string get_string(const std::string &key, const std::string &fallback = "") const;
    double get_number(const std::string &key, double fallback = 0) const;
    bool get_bool(const std::string &key, bool fallback = false) const;
    std::vector<std::string> get_strings(const std::string &key) const;

    std::string dump() const;
};

} // namespace cs
