#include "cli.h"

#include "api.h"
#include "digest.h"
#include "gui.h"
#include "pe.h"
#include "pkcs7.h"
#include "settings.h"
#include "signer.h"
#include "util.h"

#include <cstdio>
#include <iostream>
#include <string>
#include <vector>

#if defined(_WIN32)
#include <windows.h>
#include <softpub.h>
#include <wintrust.h>
#endif

namespace cs {

namespace {

const char *kVersion = "1.0.0";

#if defined(_WIN32)
std::wstring widen_utf8(const std::string &text) {
    if (text.empty()) return std::wstring();
    int length = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    if (length <= 0) return std::wstring();
    std::wstring out(static_cast<size_t>(length), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), length);
    return out;
}

// WinVerifyTrust 的返回值里，只有一部分真的代表“签名坏了”
const char *wintrust_hint(LONG status) {
    switch (status) {
    case TRUST_E_NOSIGNATURE: return "文件没有 Authenticode 签名";
    case TRUST_E_BAD_DIGEST: return "摘要与签名不符（签名后文件被改过）";
    case TRUST_E_CERT_SIGNATURE: return "证书自身的签名校验失败";
    case TRUST_E_EXPLICIT_DISTRUST: return "证书被管理员显式不信任";
    case TRUST_E_SUBJECT_NOT_TRUSTED: return "签名主体不受信任";
    case CERT_E_UNTRUSTEDROOT: return "签名结构有效，但根证书不在受信任列表（自签或测试证书常见）";
    case CERT_E_CHAINING: return "证书链构建失败（缺中间证书）";
    case CERT_E_EXPIRED: return "签名证书已过期";
    case CERT_E_REVOKED: return "签名证书已被吊销";
    case CRYPT_E_SECURITY_SETTINGS: return "本机安全策略禁止验证该签名";
    default: return nullptr;
    }
}
#endif

void print_usage() {
    std::cout
        << "CertumSigner " << kVersion << " —— Certum 云签名客户端（Windows / Linux）\n\n"
        << "用法：\n"
        << "  certumsigner sign <文件或目录>... [选项]\n"
        << "  certumsigner cert [--save <证书路径>]\n"
        << "  certumsigner hash <文件> [--sha1|--sha256|--sha384|--sha512]\n"
        << "  certumsigner verify <文件>\n"
        << "  certumsigner config [--server URL] [--api-key KEY] [--tsa URL] [--show]\n"
        << "  certumsigner --gui\n\n"
        << "签名选项：\n"
        << "  --server <URL>       Worker 地址（默认取配置，例如 https://sign.example.com）\n"
        << "  --api-key <KEY>      Worker 后台创建的 csk_… Key\n"
        << "  --sha1|--sha256|--sha384|--sha512\n"
        << "                      摘要算法，可叠加使用（默认 sha256）；每种算法各生成一个签名\n"
        << "  --no-timestamp       不请求 RFC3161 时间戳\n"
        << "  --tsa <URL>          时间戳服务（默认取配置，未配置时用 http://time.certum.pl/）\n"
        << "  --backup             修改前保留 <文件>.orig\n"
        << "  --skip-signed        已经有签名的文件直接跳过\n"
        << "  --recursive          目录递归处理\n"
        << "  --yes                目录批量签名时跳过确认\n"
        << "  --quiet              只输出错误\n"
        << "\n"
        << "配置文件：" << config_file() << "\n"
        << "环境变量：CERTUM_SIGNER_SERVER / CERTUM_SIGNER_API_KEY / CERTUM_SIGNER_TSA（覆盖配置文件）\n";
}

struct ParsedArgs {
    std::string command;
    std::vector<std::string> positionals;
    std::string server;
    std::string api_key;
    std::string tsa_url;
    std::string save_path;
    std::vector<std::string> algorithms;
    bool no_timestamp = false;
    bool backup = false;
    bool skip_signed = false;
    bool recursive = false;
    bool assume_yes = false;
    bool quiet = false;
    bool show = false;
    bool gui = false;
    bool help = false;
};

bool parse_args(int argc, char **argv, ParsedArgs &out, std::string &err) {
    if (argc <= 1) {
        out.help = true;
        return true;
    }

    int index = 1;
    std::string first = argv[1];
    if (first == "--help" || first == "-h" || first == "help") {
        out.help = true;
        return true;
    }
    if (first == "--version" || first == "-v") {
        out.command = "version";
        return true;
    }
    if (first == "--gui") {
        out.gui = true;
        return true;
    }
    if (!first.empty() && first[0] != '-') {
        out.command = first;
        index = 2;
    }

    for (; index < argc; index++) {
        std::string arg = argv[index];
        auto take_value = [&](const std::string &name, std::string &target) -> bool {
            if (arg.rfind(name + "=", 0) == 0) {
                target = arg.substr(name.size() + 1);
                return true;
            }
            if (arg == name) {
                if (index + 1 >= argc) {
                    err = name + " 需要一个参数";
                    return false;
                }
                target = argv[++index];
                return true;
            }
            return false;
        };

        std::string value;
        if (take_value("--server", value)) {
            out.server = value;
        } else if (take_value("--api-key", value)) {
            out.api_key = value;
        } else if (take_value("--tsa", value)) {
            out.tsa_url = value;
        } else if (take_value("--save", value)) {
            out.save_path = value;
        } else if (arg == "--sha1") {
            out.algorithms.push_back("sha1");
        } else if (arg == "--sha256") {
            out.algorithms.push_back("sha256");
        } else if (arg == "--sha384") {
            out.algorithms.push_back("sha384");
        } else if (arg == "--sha512") {
            out.algorithms.push_back("sha512");
        } else if (take_value("--alg", value)) {
            // --alg sha256,sha384 也可以一次写多个
            std::string current;
            for (char ch : value + ",") {
                if (ch == ',' || ch == ' ' || ch == ';') {
                    if (!current.empty()) out.algorithms.push_back(current);
                    current.clear();
                } else {
                    current.push_back(ch);
                }
            }
        } else if (arg == "--no-timestamp") {
            out.no_timestamp = true;
        } else if (arg == "--backup") {
            out.backup = true;
        } else if (arg == "--skip-signed") {
            out.skip_signed = true;
        } else if (arg == "--recursive" || arg == "-r") {
            out.recursive = true;
        } else if (arg == "--yes" || arg == "-y") {
            out.assume_yes = true;
        } else if (arg == "--quiet" || arg == "-q") {
            out.quiet = true;
        } else if (arg == "--show") {
            out.show = true;
        } else if (arg == "--gui") {
            out.gui = true;
        } else if (arg == "--help" || arg == "-h") {
            out.help = true;
        } else if (!arg.empty() && arg[0] == '-') {
            err = "未知选项：" + arg;
            return false;
        } else {
            out.positionals.push_back(arg);
        }
    }

    if (out.command.empty() && !out.gui && !out.help) {
        err = "缺少子命令（sign / cert / hash / verify / config）";
        return false;
    }
    return true;
}

bool is_signable_extension(const std::string &path) {
    const std::string lower = to_lower(path);
    const char *extensions[] = {".exe", ".dll", ".sys", ".ocx", ".cpl", ".efi", ".scr", ".node"};
    for (const char *ext : extensions) {
        if (ends_with(lower, ext)) return true;
    }
    return false;
}

int run_config(const ParsedArgs &args) {
    Settings settings;
    std::string err;
    if (!load_settings(settings, err)) {
        std::cerr << "读取配置失败：" << err << "\n";
        return 1;
    }

    bool changed = false;
    if (!args.server.empty()) {
        settings.server = args.server;
        changed = true;
    }
    if (!args.api_key.empty()) {
        settings.api_key = args.api_key;
        changed = true;
    }
    if (!args.tsa_url.empty()) {
        settings.tsa_url = args.tsa_url;
        changed = true;
    }

    if (changed) {
        if (!save_settings(settings, err)) {
            std::cerr << "保存配置失败：" << err << "\n";
            return 1;
        }
        std::cout << "已保存：" << config_file() << "\n";
    }

    std::cout << "服务地址: " << settings.server << "\n";
    std::cout << "API Key : " << (settings.api_key.empty() ? "(未设置)" : settings.api_key.substr(0, 12) + "…") << "\n";
    std::cout << "时间戳  : " << effective_tsa(settings) << "（" << settings.tsa_name << "）" << "\n";
    return 0;
}

int run_cert(const ParsedArgs &args) {
    Settings settings;
    std::string err;
    if (!load_settings(settings, err)) {
        std::cerr << err << "\n";
        return 1;
    }
    if (!args.server.empty()) settings.server = args.server;
    if (!args.api_key.empty()) settings.api_key = args.api_key;
    if (settings.api_key.empty()) {
        std::cerr << "缺少 API Key（certumsigner config --api-key csk_…）\n";
        return 1;
    }

    ApiClient api(settings.server, settings.api_key);
    RemoteCertificate remote;
    if (!api.fetch_certificate(remote, err)) {
        std::cerr << err << "\n";
        return 1;
    }

    CertificateBlob blob;
    if (!load_certificate(remote.pem, blob, err)) {
        std::cerr << err << "\n";
        return 1;
    }

    std::cout << "主题      : " << blob.subject << "\n"
              << "有效期至  : " << blob.not_after << "\n"
              << "SHA-256   : " << blob.fingerprint_sha256 << "\n"
              << "卡片序列号: " << remote.serial << "\n"
              << "证书链    : " << remote.chain.size() << " 张\n\n"
              << remote.pem;
    for (const auto &pem : remote.chain) std::cout << pem;

    if (!args.save_path.empty()) {
        std::string content = remote.pem;
        for (const auto &pem : remote.chain) content += pem;
        if (!write_file(args.save_path, content, err)) {
            std::cerr << "保存证书失败：" << err << "\n";
            return 1;
        }
        std::cout << "\n已保存到 " << args.save_path << "\n";
    }
    return 0;
}

int run_hash(const ParsedArgs &args) {
    if (args.positionals.empty()) {
        std::cerr << "用法：certumsigner hash <文件> [--sha1|--sha256|--sha384|--sha512]\n";
        return 1;
    }
    const std::vector<std::string> algorithms = effective_algorithms(args.algorithms);
    std::string digest;
    std::string err;
    for (const std::string &algorithm : algorithms) {
        if (!pe::authentihash(args.positionals[0], algorithm, digest, err)) {
            std::cerr << err << "\n";
            return 1;
        }
        if (algorithms.size() > 1) std::cout << digest::display_name(algorithm) << "  ";
        std::cout << to_hex(digest) << "\n";
    }
    return 0;
}

int run_verify(const ParsedArgs &args) {
    if (args.positionals.empty()) {
        std::cerr << "用法：certumsigner verify <文件>\n";
        return 1;
    }
    const std::string &path = args.positionals[0];
    if (!file_exists(path)) {
        std::cerr << "文件不存在：" << path << "\n";
        return 1;
    }
#if defined(_WIN32)
    std::wstring wide = widen_utf8(path);
    WINTRUST_FILE_INFO file_info{};
    file_info.cbStruct = sizeof(file_info);
    file_info.pcwszFilePath = wide.c_str();

    WINTRUST_DATA data{};
    data.cbStruct = sizeof(data);
    data.dwUIChoice = WTD_UI_NONE;
    data.fdwRevocationChecks = WTD_REVOKE_NONE;
    data.dwUnionChoice = WTD_CHOICE_FILE;
    data.pFile = &file_info;
    data.dwStateAction = WTD_STATEACTION_VERIFY;
    data.dwProvFlags = WTD_CACHE_ONLY_URL_RETRIEVAL;

    GUID policy = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    LONG status = WinVerifyTrust(nullptr, &policy, &data);
    data.dwStateAction = WTD_STATEACTION_CLOSE;
    WinVerifyTrust(nullptr, &policy, &data);

    if (status == ERROR_SUCCESS) {
        std::cout << "签名有效\n";
        return 0;
    }

    std::cout << "校验未通过（0x" << std::hex << static_cast<unsigned long>(status) << std::dec << "）";
    const char *hint = wintrust_hint(status);
    if (hint) std::cout << "：" << hint;
    std::cout << "\n";
    return 1;
#else
    std::cerr << "Linux 上没有 WinVerifyTrust；请用 osslsigncode verify 或 Windows 的 signtool 校验。\n";
    return 2;
#endif
}

int run_sign(const ParsedArgs &args) {
    Settings settings;
    std::string err;
    if (!load_settings(settings, err)) {
        std::cerr << err << "\n";
        return 1;
    }
    if (!args.server.empty()) settings.server = args.server;
    if (!args.api_key.empty()) settings.api_key = args.api_key;

    if (args.positionals.empty()) {
        std::cerr << "用法：certumsigner sign <文件或目录>...\n";
        return 1;
    }

    std::vector<std::string> targets;
    for (const auto &item : args.positionals) {
        if (is_directory(item)) {
            for (const auto &file : list_files(item, args.recursive)) {
                if (is_signable_extension(file)) targets.push_back(file);
            }
        } else if (file_exists(item)) {
            targets.push_back(item);
        } else {
            std::cerr << "路径不存在，跳过：" << item << "\n";
        }
    }

    if (targets.empty()) {
        std::cerr << "没有找到可签名的文件。\n";
        return 1;
    }
    if (targets.size() > 1 && !args.assume_yes && !args.quiet) {
        std::cout << "即将为 " << targets.size() << " 个文件签名，继续？[y/N] ";
        std::string answer;
        std::getline(std::cin, answer);
        if (answer != "y" && answer != "Y" && answer != "yes") {
            std::cout << "已取消。\n";
            return 1;
        }
    }

    Signer signer;
    signer.options.server = settings.server;
    signer.options.api_key = settings.api_key;
    signer.options.algorithms = args.algorithms.empty() ? settings.algorithms : args.algorithms;
    signer.options.algorithms = effective_algorithms(signer.options.algorithms);
    signer.options.timestamp = !args.no_timestamp;
    signer.options.backup = args.backup;
    signer.options.skip_signed = args.skip_signed;
    // 优先级：命令行 --tsa > 配置文件 tsa_url > 内置时间戳服务（默认 DigiCert）
    signer.options.tsa_url = args.tsa_url.empty() ? effective_tsa(settings) : args.tsa_url;
    signer.log = [&args](const std::string &message) {
        if (!args.quiet) std::cout << "  " << message << "\n";
    };

    if (!args.quiet) {
        std::cout << "服务地址: " << settings.server << "\n";
        std::string joined;
        for (const std::string &algorithm : signer.options.algorithms) {
            if (!joined.empty()) joined += " + ";
            joined += digest::display_name(algorithm);
        }
        std::cout << "算法    : " << joined << "\n";
    }

    if (!signer.prepare(err)) {
        std::cerr << "准备失败：" << err << "\n";
        return 1;
    }

    int failed = 0;
    for (const auto &file : targets) {
        if (!args.quiet) std::cout << "\n[" << file_name(file) << "]\n";
        std::string file_error;
        if (!signer.sign_file(file, file_error)) {
            std::cerr << "  失败：" << file_error << "\n";
            failed++;
        }
    }

    std::cout << "\n完成：成功 " << (targets.size() - failed) << " 个，失败 " << failed << " 个。\n";
    return failed == 0 ? 0 : 1;
}

} // namespace

bool gui_invocation(int argc, char **argv) {
    if (!gui_available()) return false;
    if (argc <= 1) return true;
    for (int i = 1; i < argc; i++) {
        const std::string arg = argv[i] ? argv[i] : "";
        if (arg == "--gui") return true;
    }
    // 桌面场景：把文件拖到 exe 上或“打开方式”时，第一个参数就是路径，直接进 GUI 排队
    const std::string first = argv[1] ? argv[1] : "";
    return !first.empty() && first[0] != '-' && (file_exists(first) || is_directory(first));
}

int cli_main(int argc, char **argv) {
    if (gui_invocation(argc, argv)) return gui_main(argc, argv);

    ParsedArgs args;
    std::string err;
    if (!parse_args(argc, argv, args, err)) {
        std::cerr << err << "\n\n";
        print_usage();
        return 2;
    }
    if (args.help) {
        print_usage();
        return 0;
    }
    if (args.gui) return gui_main(argc, argv);
    if (args.command == "version") {
        std::cout << "CertumSigner " << kVersion << "\n";
        return 0;
    }
    if (args.command == "config") return run_config(args);
    if (args.command == "cert") return run_cert(args);
    if (args.command == "hash") return run_hash(args);
    if (args.command == "verify") return run_verify(args);
    if (args.command == "sign") return run_sign(args);

    std::cerr << "未知命令：" << args.command << "\n";
    print_usage();
    return 2;
}

} // namespace cs
