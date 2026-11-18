#include "cli.h"

#if defined(_WIN32)
#include <windows.h>
#include <shellapi.h>

#include <string>
#include <vector>

#pragma comment(lib, "shell32.lib")

namespace {

std::string to_utf8(const wchar_t *text) {
    if (!text || !*text) return {};
    int length = WideCharToMultiByte(CP_UTF8, 0, text, -1, nullptr, 0, nullptr, nullptr);
    if (length <= 1) return {};
    std::string out(static_cast<size_t>(length), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text, -1, out.data(), length, nullptr, nullptr);
    out.resize(static_cast<size_t>(length - 1));
    return out;
}

} // namespace

int main() {
    // 控制台默认是本地代码页；统一成 UTF-8
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);

    // Windows 的 argv 是 ANSI（GBK），含中文的路径会在 u8path 处炸掉。
    // 用宽字符命令行重新切一次，再转成 UTF-8。
    int argc = 0;
    LPWSTR *wide_args = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (!wide_args) return 1;

    std::vector<std::string> storage;
    storage.reserve(static_cast<size_t>(argc));
    for (int i = 0; i < argc; i++) storage.push_back(to_utf8(wide_args[i]));
    LocalFree(wide_args);

    std::vector<char *> argv;
    argv.reserve(storage.size());
    for (auto &item : storage) argv.push_back(item.data());
    return cs::cli_main(static_cast<int>(argv.size()), argv.data());
}
#else
int main(int argc, char **argv) { return cs::cli_main(argc, argv); }
#endif
