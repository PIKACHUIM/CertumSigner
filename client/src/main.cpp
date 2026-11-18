#include "cli.h"

#if defined(_WIN32)
#include <windows.h>
#include <shellapi.h>

#include <cstdio>
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

// Windows 的 argv 是 ANSI（GBK），含中文的路径会在 u8path 处炸掉。
// 用宽字符命令行重新切一次，再转成 UTF-8。
std::vector<std::string> command_line_args() {
    int argc = 0;
    LPWSTR *wide = CommandLineToArgvW(GetCommandLineW(), &argc);
    std::vector<std::string> out;
    if (!wide) return out;
    out.reserve(static_cast<size_t>(argc));
    for (int i = 0; i < argc; i++) out.push_back(to_utf8(wide[i]));
    LocalFree(wide);
    return out;
}

/**
 * GUI 子系统下进程本身没有控制台，从 cmd / PowerShell 调用时挂到父进程的控制台上，
 * 再把标准流接回去。GUI 模式不调用它 —— 这就是启动时黑框的来源。
 */
void attach_parent_console() {
    if (!AttachConsole(ATTACH_PARENT_PROCESS)) return;
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);
    FILE *stream = nullptr;
    freopen_s(&stream, "CONOUT$", "w", stdout);
    freopen_s(&stream, "CONOUT$", "w", stderr);
    freopen_s(&stream, "CONIN$", "r", stdin);
}

std::vector<char *> argv_of(std::vector<std::string> &storage) {
    std::vector<char *> argv;
    argv.reserve(storage.size());
    for (auto &item : storage) argv.push_back(item.data());
    return argv;
}

} // namespace

#if defined(CS_GUI_SUBSYSTEM)
int APIENTRY wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    std::vector<std::string> storage = command_line_args();
    std::vector<char *> argv = argv_of(storage);

    // 只有真正的命令行调用才去接管父控制台；双击启动时什么都不做
    if (!cs::gui_invocation(static_cast<int>(argv.size()), argv.data())) attach_parent_console();

    return cs::cli_main(static_cast<int>(argv.size()), argv.data());
}
#else
int main() {
    // 控制台默认是本地代码页；统一成 UTF-8
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCP(CP_UTF8);

    std::vector<std::string> storage = command_line_args();
    std::vector<char *> argv = argv_of(storage);
    return cs::cli_main(static_cast<int>(argv.size()), argv.data());
}
#endif // CS_GUI_SUBSYSTEM

#else
int main(int argc, char **argv) { return cs::cli_main(argc, argv); }
#endif
