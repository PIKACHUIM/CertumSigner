// Win32 GUI（Windows）—— 深色现代界面，自绘卡片 / 分段按钮 / 状态条
#include "gui.h"

#include <windows.h>
#include <windowsx.h>
#include <commdlg.h>
#include <commctrl.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <softpub.h>
#include <uxtheme.h>
#include <wintrust.h>

#include <cwchar>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "settings.h"
#include "signer.h"
#include "util.h"

#pragma comment(lib, "comctl32.lib")
#pragma comment(lib, "comdlg32.lib")
#pragma comment(lib, "dwmapi.lib")
#pragma comment(lib, "shell32.lib")
#pragma comment(lib, "uxtheme.lib")

namespace cs {

namespace {

constexpr int IDC_SERVER = 2001;
constexpr int IDC_KEY = 2002;
constexpr int IDC_FILE = 2003;
constexpr int IDC_BROWSE = 2004;
constexpr int IDC_ALGO256 = 2005;
constexpr int IDC_ALGO1 = 2006;
constexpr int IDC_TIMESTAMP = 2007;
constexpr int IDC_BACKUP = 2008;
constexpr int IDC_SIGN = 2009;
constexpr int IDC_VERIFY = 2010;
constexpr int IDC_LOG = 2011;
constexpr int IDC_CLEAR = 2012;

constexpr UINT WM_APP_LOG = WM_APP + 1;
constexpr UINT WM_APP_DONE = WM_APP + 2;
constexpr UINT_PTR TIMER_ANIM = 1;

// 色板（深色）
constexpr COLORREF kBg = RGB(9, 14, 26);
constexpr COLORREF kCard = RGB(17, 27, 48);
constexpr COLORREF kCardEdge = RGB(31, 44, 72);
constexpr COLORREF kInput = RGB(12, 20, 37);
constexpr COLORREF kInputEdge = RGB(40, 56, 90);
constexpr COLORREF kText = RGB(231, 237, 247);
constexpr COLORREF kMuted = RGB(141, 160, 192);
constexpr COLORREF kAccent = RGB(99, 102, 241);
constexpr COLORREF kAccentHot = RGB(124, 127, 245);
constexpr COLORREF kAccentDown = RGB(79, 70, 229);
constexpr COLORREF kOk = RGB(52, 211, 153);
constexpr COLORREF kWarn = RGB(251, 191, 36);
constexpr COLORREF kBad = RGB(248, 113, 113);
constexpr COLORREF kLogBg = RGB(10, 17, 32);

constexpr int kBaseWidth = 820;
constexpr int kBaseHeight = 812;

struct GuiContext {
    HWND window = nullptr;
    HWND server = nullptr;
    HWND key = nullptr;
    HWND file = nullptr;
    HWND log = nullptr;
    HWND browse = nullptr;
    HWND algo256 = nullptr;
    HWND algo1 = nullptr;
    HWND timestamp = nullptr;
    HWND backup = nullptr;
    HWND sign = nullptr;
    HWND verify = nullptr;
    HWND clear = nullptr;

    HFONT fontTitle = nullptr;
    HFONT fontBody = nullptr;
    HFONT fontSmall = nullptr;
    HFONT fontButton = nullptr;
    HFONT fontMono = nullptr;

    HBRUSH brushBg = nullptr;
    HBRUSH brushCard = nullptr;
    HBRUSH brushInput = nullptr;
    HBRUSH brushLog = nullptr;

    float scale = 1.0f;
    int dpi = 96;
    int hot = 0;
    int algo = 0;
    bool wantTimestamp = true;
    bool wantBackup = false;
    bool busy = false;
    int phase = 0; // 0 就绪 / 1 进行中 / 2 完成 / 3 失败
    int anim = 0;
    std::wstring status = L"就绪";
};

GuiContext *g_ctx = nullptr;
float g_scale = 1.0f;

int px(int value) {
    if (!g_ctx) return value;
    return static_cast<int>(value * g_ctx->scale + 0.5f);
}

std::wstring widen(const std::string &text) {
    if (text.empty()) return std::wstring();
    int length = MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    if (length <= 0) return std::wstring();
    std::wstring out(static_cast<size_t>(length), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), length);
    return out;
}

std::string narrow(const std::wstring &text) {
    if (text.empty()) return std::string();
    int length = WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0, nullptr,
                                     nullptr);
    if (length <= 0) return std::string();
    std::string out(static_cast<size_t>(length), '\0');
    WideCharToMultiByte(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), out.data(), length, nullptr, nullptr);
    return out;
}

std::string control_text(HWND control) {
    if (!control) return {};
    int length = GetWindowTextLengthW(control);
    std::wstring buffer(static_cast<size_t>(length) + 1, L'\0');
    GetWindowTextW(control, buffer.data(), length + 1);
    buffer.resize(static_cast<size_t>(length));
    return narrow(buffer);
}

HFONT make_font(int size_px, int weight) {
    LOGFONTW lf{};
    lf.lfHeight = -px(size_px);
    lf.lfWeight = weight;
    lf.lfQuality = CLEARTYPE_QUALITY;
    lf.lfCharSet = DEFAULT_CHARSET;
    wcscpy_s(lf.lfFaceName, L"Segoe UI");
    return CreateFontIndirectW(&lf);
}

HFONT make_mono_font(int size_px) {
    LOGFONTW lf{};
    lf.lfHeight = -px(size_px);
    lf.lfWeight = FW_NORMAL;
    lf.lfQuality = CLEARTYPE_QUALITY;
    lf.lfCharSet = DEFAULT_CHARSET;
    wcscpy_s(lf.lfFaceName, L"Consolas");
    return CreateFontIndirectW(&lf);
}

RECT rect(int x, int y, int w, int h) {
    RECT r{px(x), px(y), px(x + w), px(y + h)};
    return r;
}

void fill_round(HDC dc, const RECT &r, int radius, COLORREF color) {
    HBRUSH brush = CreateSolidBrush(color);
    HPEN pen = CreatePen(PS_SOLID, 1, color);
    HGDIOBJ oldBrush = SelectObject(dc, brush);
    HGDIOBJ oldPen = SelectObject(dc, pen);
    RoundRect(dc, r.left, r.top, r.right, r.bottom, radius, radius);
    SelectObject(dc, oldPen);
    SelectObject(dc, oldBrush);
    DeleteObject(brush);
    DeleteObject(pen);
}

void stroke_round(HDC dc, const RECT &r, int radius, COLORREF color, int width = 1) {
    HPEN pen = CreatePen(PS_SOLID, width, color);
    HGDIOBJ oldPen = SelectObject(dc, pen);
    HGDIOBJ oldBrush = SelectObject(dc, GetStockObject(NULL_BRUSH));
    RoundRect(dc, r.left, r.top, r.right, r.bottom, radius, radius);
    SelectObject(dc, oldBrush);
    SelectObject(dc, oldPen);
    DeleteObject(pen);
}

void draw_text(HDC dc, const std::wstring &text, RECT r, HFONT font, COLORREF color,
               UINT format = DT_LEFT | DT_SINGLELINE | DT_VCENTER) {
    HGDIOBJ oldFont = SelectObject(dc, font);
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, color);
    DrawTextW(dc, text.c_str(), static_cast<int>(text.size()), &r, format);
    SelectObject(dc, oldFont);
}

void append_log(const std::string &message) {
    if (!g_ctx || !g_ctx->log) return;
    std::wstring line = widen(message + "\r\n");
    int length = GetWindowTextLengthW(g_ctx->log);
    SendMessageW(g_ctx->log, EM_SETSEL, static_cast<WPARAM>(length), static_cast<LPARAM>(length));
    SendMessageW(g_ctx->log, EM_REPLACESEL, FALSE, reinterpret_cast<LPARAM>(line.c_str()));
}

void post_log(HWND window, const std::string &message) {
    if (!IsWindow(window)) return;
    auto *copy = new std::string(message);
    if (!PostMessageW(window, WM_APP_LOG, 0, reinterpret_cast<LPARAM>(copy))) delete copy;
}

void set_status(int phase, const std::wstring &text) {
    if (!g_ctx) return;
    g_ctx->phase = phase;
    g_ctx->status = text;
    InvalidateRect(g_ctx->window, nullptr, FALSE);
}

void set_busy(bool busy) {
    if (!g_ctx) return;
    g_ctx->busy = busy;
    EnableWindow(g_ctx->sign, busy ? FALSE : TRUE);
    EnableWindow(g_ctx->verify, busy ? FALSE : TRUE);
    EnableWindow(g_ctx->browse, busy ? FALSE : TRUE);
    if (busy) {
        SetTimer(g_ctx->window, TIMER_ANIM, 33, nullptr);
    } else {
        KillTimer(g_ctx->window, TIMER_ANIM);
    }
    InvalidateRect(g_ctx->window, nullptr, FALSE);
}

HWND make_control(const wchar_t *klass, const wchar_t *text, DWORD style, DWORD ex_style, RECT bounds, int id,
                  HWND parent) {
    HWND control = CreateWindowExW(ex_style, klass, text, WS_CHILD | WS_VISIBLE | style, bounds.left, bounds.top,
                                   bounds.right - bounds.left, bounds.bottom - bounds.top, parent,
                                   reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)), GetModuleHandleW(nullptr),
                                   nullptr);
    if (!control) return nullptr;
    if (g_ctx) {
        HFONT font = wcscmp(klass, L"EDIT") == 0 && id == IDC_LOG ? g_ctx->fontMono : g_ctx->fontBody;
        SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(font), TRUE);
        SendMessageW(control, EM_SETMARGINS, EC_LEFTMARGIN | EC_RIGHTMARGIN,
                     MAKELPARAM(px(10), px(10)));
    }
    return control;
}

void choose_file() {
    wchar_t buffer[MAX_PATH * 4] = {0};
    OPENFILENAMEW dialog{};
    dialog.lStructSize = sizeof(dialog);
    dialog.hwndOwner = g_ctx ? g_ctx->window : nullptr;
    dialog.lpstrFile = buffer;
    dialog.nMaxFile = MAX_PATH * 4;
    dialog.lpstrFilter = L"PE 文件 (*.exe;*.dll;*.sys;*.ocx)\0*.exe;*.dll;*.sys;*.ocx\0所有文件\0*.*\0";
    dialog.nFilterIndex = 1;
    dialog.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR;
    if (GetOpenFileNameW(&dialog)) {
        SetWindowTextW(g_ctx->file, buffer);
    }
}

const wchar_t *verify_hint(LONG status) {
    switch (static_cast<unsigned long>(status)) {
    case 0x800B0100UL:
        return L"文件没有 Authenticode 签名";
    case 0x800B0109UL:
        return L"签名结构有效，但根证书不在受信任列表";
    case 0x800B0101UL:
        return L"签名证书已过期";
    case 0x80096010UL:
        return L"摘要与签名不符（签名后文件被改过）";
    default:
        return nullptr;
    }
}

void verify_current() {
    if (!g_ctx) return;
    std::string path = control_text(g_ctx->file);
    if (path.empty()) {
        append_log("请先选择要校验的文件。");
        return;
    }
    std::wstring wide = widen(path);
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
        append_log("校验通过：签名有效。");
        set_status(2, L"签名有效");
    } else {
        wchar_t buffer[128] = {0};
        swprintf_s(buffer, L"0x%08lX", static_cast<unsigned long>(status));
        std::wstring line = L"校验未通过（" + std::wstring(buffer) + L"）";
        if (const wchar_t *hint = verify_hint(status)) line += std::wstring(L"：") + hint;
        append_log(narrow(line));
        set_status(3, L"校验未通过");
    }
}

struct SignJob {
    std::string server;
    std::string key;
    std::string path;
    std::string algorithm;
    std::string tsa;
    bool timestamp = true;
    bool backup = false;
};

void start_signing() {
    if (!g_ctx) return;

    std::string server = control_text(g_ctx->server);
    std::string key = control_text(g_ctx->key);
    std::string path = control_text(g_ctx->file);

    if (server.empty()) {
        append_log("错误：请填写 Worker 地址。");
        SetFocus(g_ctx->server);
        set_status(3, L"缺少服务地址");
        return;
    }
    if (key.empty()) {
        append_log("错误：请填写 API Key（csk_…）。");
        SetFocus(g_ctx->key);
        set_status(3, L"缺少 API Key");
        return;
    }
    if (path.empty()) {
        append_log("错误：请选择要签名的文件。");
        set_status(3, L"缺少文件");
        return;
    }

    Settings settings;
    std::string load_error;
    load_settings(settings, load_error); // 先读旧配置，保留 tsa_url 等界面上没有的字段
    settings.server = server;
    settings.api_key = key;
    std::string save_error;
    save_settings(settings, save_error);

    auto job = std::make_shared<SignJob>();
    job->server = server;
    job->key = key;
    job->path = path;
    job->algorithm = g_ctx->algo == 1 ? "sha1" : "sha256";
    job->timestamp = g_ctx->wantTimestamp;
    job->backup = g_ctx->wantBackup;
    job->tsa = settings.tsa_url; // 空则用 SignOptions 里的默认 TSA

    HWND window = g_ctx->window;
    set_busy(true);
    set_status(1, L"签名中");
    append_log("=== 开始签名：" + cs::file_name(path) + "（" + (job->algorithm == "sha1" ? "SHA-1" : "SHA-256") + "）");

    std::thread([job, window]() {
        Signer signer;
        signer.options.server = job->server;
        signer.options.api_key = job->key;
        signer.options.algorithm = job->algorithm;
        signer.options.timestamp = job->timestamp;
        signer.options.backup = job->backup;
        if (!job->tsa.empty()) signer.options.tsa_url = job->tsa;
        signer.log = [window](const std::string &message) { post_log(window, message); };

        std::string error;
        bool ok = signer.prepare(error);
        if (ok) ok = signer.sign_file(job->path, error);
        if (!ok) post_log(window, "错误：" + error);
        if (IsWindow(window)) {
            PostMessageW(window, WM_APP_DONE, ok ? 1 : 0, 0);
        }
    }).detach();
}

void create_controls(HWND window) {
    GuiContext *c = g_ctx;
    c->server = make_control(L"EDIT", L"", ES_AUTOHSCROLL | WS_TABSTOP, 0, rect(50, 158, 720, 38), IDC_SERVER, window);
    c->key = make_control(L"EDIT", L"", ES_AUTOHSCROLL | ES_PASSWORD | WS_TABSTOP, 0, rect(50, 226, 720, 38), IDC_KEY,
                          window);
    c->file = make_control(L"EDIT", L"", ES_AUTOHSCROLL | WS_TABSTOP, 0, rect(50, 348, 592, 38), IDC_FILE, window);
    c->browse = make_control(L"BUTTON", L"浏览…", BS_OWNERDRAW | WS_TABSTOP, 0, rect(656, 348, 114, 38), IDC_BROWSE,
                             window);

    c->algo256 = make_control(L"BUTTON", L"SHA-256", BS_OWNERDRAW | WS_TABSTOP, 0, rect(50, 492, 96, 34), IDC_ALGO256,
                              window);
    c->algo1 = make_control(L"BUTTON", L"SHA-1", BS_OWNERDRAW | WS_TABSTOP, 0, rect(152, 492, 84, 34), IDC_ALGO1,
                            window);
    c->timestamp = make_control(L"BUTTON", L"添加时间戳", BS_OWNERDRAW | WS_TABSTOP, 0, rect(262, 492, 132, 34),
                                IDC_TIMESTAMP, window);
    c->backup = make_control(L"BUTTON", L"备份原文件", BS_OWNERDRAW | WS_TABSTOP, 0, rect(408, 492, 132, 34),
                             IDC_BACKUP, window);

    c->sign = make_control(L"BUTTON", L"开始签名", BS_OWNERDRAW | WS_TABSTOP, 0, rect(30, 552, 520, 48), IDC_SIGN,
                            window);
    c->verify = make_control(L"BUTTON", L"验证签名", BS_OWNERDRAW | WS_TABSTOP, 0, rect(562, 552, 228, 48), IDC_VERIFY,
                             window);

    c->log = make_control(L"EDIT", L"", ES_MULTILINE | ES_READONLY | ES_AUTOVSCROLL | WS_VSCROLL, 0,
                          rect(50, 656, 720, 110), IDC_LOG, window);
    if (c->log) SetWindowTheme(c->log, L"DarkMode_Explorer", nullptr);
    c->clear = make_control(L"BUTTON", L"清空", BS_OWNERDRAW | WS_TABSTOP, 0, rect(722, 628, 48, 24), IDC_CLEAR,
                            window);
}

void paint_window(HWND window, HDC target) {
    GuiContext *c = g_ctx;
    RECT client{};
    GetClientRect(window, &client);

    HDC dc = CreateCompatibleDC(target);
    HBITMAP bitmap = CreateCompatibleBitmap(target, client.right, client.bottom);
    HGDIOBJ oldBitmap = SelectObject(dc, bitmap);

    HBRUSH bg = CreateSolidBrush(kBg);
    FillRect(dc, &client, bg);
    DeleteObject(bg);

    // 顶部品牌
    RECT logo = rect(30, 26, 34, 34);
    fill_round(dc, logo, px(10), kAccent);
    draw_text(dc, L"C", logo, c->fontTitle, RGB(255, 255, 255), DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    draw_text(dc, L"CertumSigner", rect(76, 18, 260, 34), c->fontTitle, kText);
    draw_text(dc, L"私钥在 Certum 云端，本机只转发摘要", rect(76, 50, 420, 22), c->fontSmall, kMuted);

    // 状态胶囊
    COLORREF tone = c->phase == 0 ? kMuted : c->phase == 1 ? kAccent : c->phase == 2 ? kOk : kBad;
    RECT pill = rect(640, 30, 150, 30);
    fill_round(dc, pill, px(15), c->phase == 0 ? RGB(24, 35, 58) : RGB(24, 35, 58));
    HPEN dotPen = CreatePen(PS_SOLID, 1, tone);
    HBRUSH dotBrush = CreateSolidBrush(tone);
    HGDIOBJ oldPen = SelectObject(dc, dotPen);
    HGDIOBJ oldBrush = SelectObject(dc, dotBrush);
    Ellipse(dc, pill.left + px(12), pill.top + px(11), pill.left + px(20), pill.top + px(19));
    SelectObject(dc, oldBrush);
    SelectObject(dc, oldPen);
    DeleteObject(dotPen);
    DeleteObject(dotBrush);
    draw_text(dc, c->status,
              RECT{pill.left + px(26), pill.top, pill.right - px(6), pill.bottom},
              c->fontSmall, c->phase == 3 ? kBad : kText);

    // 卡片：连接
    RECT card1 = rect(30, 92, 760, 196);
    fill_round(dc, card1, px(14), kCard);
    stroke_round(dc, card1, px(14), kCardEdge);
    draw_text(dc, L"连接", rect(50, 106, 200, 22), c->fontButton, kText);
    draw_text(dc, L"服务地址", rect(50, 136, 200, 18), c->fontSmall, kMuted);
    draw_text(dc, L"API Key", rect(50, 204, 200, 18), c->fontSmall, kMuted);
    draw_text(dc, L"Key 形如 csk_…，只在后台创建时显示一次", rect(50, 270, 500, 18), c->fontSmall,
              RGB(104, 122, 152));

    // 卡片：文件
    RECT card2 = rect(30, 302, 760, 120);
    fill_round(dc, card2, px(14), kCard);
    stroke_round(dc, card2, px(14), kCardEdge);
    draw_text(dc, L"目标文件", rect(50, 316, 200, 22), c->fontButton, kText);
    draw_text(dc, L"可以直接把 .exe / .dll 拖进窗口", rect(50, 396, 500, 18), c->fontSmall, RGB(104, 122, 152));

    // 卡片：选项
    RECT card3 = rect(30, 436, 760, 96);
    fill_round(dc, card3, px(14), kCard);
    stroke_round(dc, card3, px(14), kCardEdge);
    draw_text(dc, L"签名选项", rect(50, 450, 200, 22), c->fontButton, kText);

    // 输入框底
    fill_round(dc, rect(50, 158, 720, 38), px(9), kInput);
    stroke_round(dc, rect(50, 158, 720, 38), px(9), GetFocus() == c->server ? kAccent : kInputEdge);
    fill_round(dc, rect(50, 226, 720, 38), px(9), kInput);
    stroke_round(dc, rect(50, 226, 720, 38), px(9), GetFocus() == c->key ? kAccent : kInputEdge);
    fill_round(dc, rect(50, 348, 592, 38), px(9), kInput);
    stroke_round(dc, rect(50, 348, 592, 38), px(9), GetFocus() == c->file ? kAccent : kInputEdge);

    // 日志卡片
    RECT card4 = rect(30, 616, 760, 166);
    fill_round(dc, card4, px(14), kCard);
    stroke_round(dc, card4, px(14), kCardEdge);
    draw_text(dc, L"日志", rect(50, 628, 120, 22), c->fontButton, kText);
    fill_round(dc, rect(50, 656, 720, 110), px(10), kLogBg);

    // 进行中的顶部进度条
    if (c->busy) {
        int width = client.right - px(60);
        int segment = width / 4;
        int offset = (c->anim * px(14)) % (width + segment);
        RECT bar{px(30) + offset - segment, px(4), px(30) + offset, px(7)};
        if (bar.right > px(30)) {
            if (bar.left < px(30)) bar.left = px(30);
            fill_round(dc, bar, px(2), kAccent);
        }
    }

    BitBlt(target, 0, 0, client.right, client.bottom, dc, 0, 0, SRCCOPY);
    SelectObject(dc, oldBitmap);
    DeleteObject(bitmap);
    DeleteDC(dc);
}

void draw_ownerdraw(const DRAWITEMSTRUCT *item) {
    GuiContext *c = g_ctx;
    if (!c || !item) return;
    const int id = static_cast<int>(item->CtlID);
    RECT r = item->rcItem;
    const bool hot = c->hot == id;
    const bool down = (item->itemState & ODS_SELECTED) != 0;

    HDC dc = item->hDC;
    SetBkMode(dc, TRANSPARENT);

    if (id == IDC_BROWSE) {
        fill_round(dc, r, px(9), kCard);
        fill_round(dc, r, px(9), hot ? RGB(30, 44, 72) : kInput);
        stroke_round(dc, r, px(9), kInputEdge);
        draw_text(dc, L"浏览…", r, c->fontBody, kText, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        return;
    }

    if (id == IDC_SIGN) {
        fill_round(dc, r, px(11), kBg);
        fill_round(dc, r, px(11), down ? kAccentDown : hot ? kAccentHot : kAccent);
        draw_text(dc, L"开始签名", r, c->fontButton, RGB(255, 255, 255), DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        return;
    }

    if (id == IDC_VERIFY) {
        fill_round(dc, r, px(11), kBg);
        fill_round(dc, r, px(11), hot ? RGB(28, 41, 66) : kCard);
        stroke_round(dc, r, px(11), kInputEdge);
        draw_text(dc, L"验证签名", r, c->fontButton, kText, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        return;
    }

    if (id == IDC_CLEAR) {
        fill_round(dc, r, px(6), kCard);
        draw_text(dc, L"清空", r, c->fontSmall, hot ? kText : kMuted, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        return;
    }

    if (id == IDC_ALGO256 || id == IDC_ALGO1) {
        const bool active = (id == IDC_ALGO256) ? c->algo == 0 : c->algo == 1;
        fill_round(dc, r, px(9), kCard);
        fill_round(dc, r, px(9), active ? kAccent : hot ? RGB(30, 44, 72) : kInput);
        stroke_round(dc, r, px(9), active ? kAccent : kInputEdge);
        draw_text(dc, id == IDC_ALGO256 ? L"SHA-256" : L"SHA-1", r, c->fontSmall,
                  active ? RGB(255, 255, 255) : kMuted, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        return;
    }

    if (id == IDC_TIMESTAMP || id == IDC_BACKUP) {
        const bool checked = (id == IDC_TIMESTAMP) ? c->wantTimestamp : c->wantBackup;
        // 先铺满整个按钮区域，否则会残留系统默认的浅色按钮底
        fill_round(dc, r, px(8), kCard);
        RECT box = r;
        box.top = r.top + (r.bottom - r.top - px(18)) / 2;
        box.left = r.left + px(2);
        box.right = box.left + px(18);
        box.bottom = box.top + px(18);
        fill_round(dc, box, px(5), checked ? kAccent : kInput);
        stroke_round(dc, box, px(5), checked ? kAccent : kInputEdge);
        if (checked) {
            HPEN pen = CreatePen(PS_SOLID, px(2), RGB(255, 255, 255));
            HGDIOBJ oldPen = SelectObject(dc, pen);
            POINT points[3];
            points[0] = {box.left + px(4), box.top + px(9)};
            points[1] = {box.left + px(8), box.top + px(13)};
            points[2] = {box.left + px(14), box.top + px(5)};
            Polyline(dc, points, 3);
            SelectObject(dc, oldPen);
            DeleteObject(pen);
        }
        RECT textRect = r;
        textRect.left = box.right + px(9);
        draw_text(dc, id == IDC_TIMESTAMP ? L"添加时间戳" : L"备份原文件", textRect, c->fontSmall, kText);
        return;
    }
}

LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    switch (message) {
    case WM_CREATE: {
        g_ctx = new GuiContext();
        g_ctx->window = window;

        HDC screen = GetDC(nullptr);
        g_ctx->dpi = GetDeviceCaps(screen, LOGPIXELSX);
        ReleaseDC(nullptr, screen);
        if (g_ctx->dpi <= 0) g_ctx->dpi = 96;
        g_ctx->scale = g_scale > 0.0f ? g_scale : 1.0f;

        g_ctx->fontTitle = make_font(22, FW_SEMIBOLD);
        g_ctx->fontBody = make_font(15, FW_NORMAL);
        g_ctx->fontSmall = make_font(13, FW_NORMAL);
        g_ctx->fontButton = make_font(15, FW_SEMIBOLD);
        g_ctx->fontMono = make_mono_font(13);

        g_ctx->brushBg = CreateSolidBrush(kBg);
        g_ctx->brushCard = CreateSolidBrush(kCard);
        g_ctx->brushInput = CreateSolidBrush(kInput);
        g_ctx->brushLog = CreateSolidBrush(kLogBg);

        create_controls(window);
        DragAcceptFiles(window, TRUE);
        // 日志框的滚动条跟随深色主题，否则是一条浅色系统滚动条
        SetWindowTheme(g_ctx->log, L"DarkMode_Explorer", nullptr);

        Settings settings;
        std::string error;
        if (load_settings(settings, error)) {
            SetWindowTextW(g_ctx->server, widen(settings.server).c_str());
            if (!settings.api_key.empty()) SetWindowTextW(g_ctx->key, widen(settings.api_key).c_str());
        } else {
            append_log("读取配置失败：" + error);
        }
        append_log("就绪：私钥在 Certum 云端，本机只转发摘要。");
        append_log("提示：先在 Worker 后台创建 API Key，再填到上面。");
        return 0;
    }
    case WM_SIZE:
        InvalidateRect(window, nullptr, TRUE);
        return 0;
    case WM_ERASEBKGND:
        return 1;
    case WM_PAINT: {
        PAINTSTRUCT ps{};
        HDC dc = BeginPaint(window, &ps);
        paint_window(window, dc);
        EndPaint(window, &ps);
        return 0;
    }
    case WM_DRAWITEM:
        draw_ownerdraw(reinterpret_cast<const DRAWITEMSTRUCT *>(lparam));
        return TRUE;
    case WM_CTLCOLORBTN: {
        // 自绘按钮的默认底色是系统浅灰，圆角填充会在四周漏出 1px 灰线，这里换成卡片/窗口底色
        HDC dc = reinterpret_cast<HDC>(wparam);
        HWND control = reinterpret_cast<HWND>(lparam);
        SetBkMode(dc, TRANSPARENT);
        if (!g_ctx) break;
        const bool on_background = control == g_ctx->sign || control == g_ctx->verify;
        SetBkColor(dc, on_background ? kBg : kCard);
        return static_cast<LRESULT>(reinterpret_cast<INT_PTR>(
            on_background ? g_ctx->brushBg : g_ctx->brushCard));
    }
    case WM_CTLCOLOREDIT:
    case WM_CTLCOLORSTATIC: {
        HDC dc = reinterpret_cast<HDC>(wparam);
        HWND control = reinterpret_cast<HWND>(lparam);
        SetTextColor(dc, kText);
        if (g_ctx && control == g_ctx->log) {
            SetBkColor(dc, kLogBg);
            return reinterpret_cast<LRESULT>(g_ctx->brushLog);
        }
        SetBkColor(dc, kInput);
        return reinterpret_cast<LRESULT>(g_ctx->brushInput);
    }
    case WM_COMMAND: {
        const int id = LOWORD(wparam);
        const int code = HIWORD(wparam);
        if (code == BN_CLICKED) {
            if (id == IDC_BROWSE) choose_file();
            else if (id == IDC_SIGN) start_signing();
            else if (id == IDC_VERIFY) verify_current();
            else if (id == IDC_ALGO256) {
                g_ctx->algo = 0;
                InvalidateRect(g_ctx->algo256, nullptr, TRUE);
                InvalidateRect(g_ctx->algo1, nullptr, TRUE);
            } else if (id == IDC_ALGO1) {
                g_ctx->algo = 1;
                InvalidateRect(g_ctx->algo256, nullptr, TRUE);
                InvalidateRect(g_ctx->algo1, nullptr, TRUE);
            } else if (id == IDC_TIMESTAMP) {
                g_ctx->wantTimestamp = !g_ctx->wantTimestamp;
                InvalidateRect(g_ctx->timestamp, nullptr, TRUE);
            } else if (id == IDC_BACKUP) {
                g_ctx->wantBackup = !g_ctx->wantBackup;
                InvalidateRect(g_ctx->backup, nullptr, TRUE);
            } else if (id == IDC_CLEAR) {
                SetWindowTextW(g_ctx->log, L"");
            }
        } else if (code == EN_SETFOCUS || code == EN_KILLFOCUS) {
            InvalidateRect(window, nullptr, FALSE);
        }
        return 0;
    }
    case WM_MOUSEMOVE: {
        POINT point{GET_X_LPARAM(lparam), GET_Y_LPARAM(lparam)};
        HWND child = ChildWindowFromPointEx(window, point, CWP_SKIPINVISIBLE | CWP_SKIPDISABLED);
        int id = child ? GetDlgCtrlID(child) : 0;
        if (id != g_ctx->hot) {
            if (g_ctx->hot) {
                HWND old = GetDlgItem(window, g_ctx->hot);
                if (old) InvalidateRect(old, nullptr, TRUE);
            }
            g_ctx->hot = id;
            if (child) InvalidateRect(child, nullptr, TRUE);
        }
        TRACKMOUSEEVENT track{sizeof(track), TME_LEAVE, window, 0};
        TrackMouseEvent(&track);
        return 0;
    }
    case WM_MOUSELEAVE:
        if (g_ctx->hot) {
            HWND old = GetDlgItem(window, g_ctx->hot);
            if (old) InvalidateRect(old, nullptr, TRUE);
            g_ctx->hot = 0;
        }
        return 0;
    case WM_TIMER:
        if (wparam == TIMER_ANIM && g_ctx) {
            g_ctx->anim = (g_ctx->anim + 2) % 1000;
            InvalidateRect(window, nullptr, FALSE);
        }
        return 0;
    case WM_DROPFILES: {
        HDROP drop = reinterpret_cast<HDROP>(wparam);
        wchar_t buffer[MAX_PATH * 4] = {0};
        if (DragQueryFileW(drop, 0, buffer, MAX_PATH * 4)) {
            SetWindowTextW(g_ctx->file, buffer);
            append_log("已选择：" + narrow(buffer));
        }
        DragFinish(drop);
        return 0;
    }
    case WM_APP_LOG: {
        auto *text = reinterpret_cast<std::string *>(lparam);
        if (text) {
            append_log(*text);
            delete text;
        }
        return 0;
    }
    case WM_APP_DONE: {
        set_busy(false);
        if (wparam) {
            set_status(2, L"已完成");
            append_log("=== 完成");
        } else {
            set_status(3, L"失败");
            append_log("=== 失败");
        }
        return 0;
    }
    case WM_CLOSE:
        DestroyWindow(window);
        return 0;
    case WM_DESTROY:
        if (g_ctx) {
            KillTimer(window, TIMER_ANIM);
            if (g_ctx->fontTitle) DeleteObject(g_ctx->fontTitle);
            if (g_ctx->fontBody) DeleteObject(g_ctx->fontBody);
            if (g_ctx->fontSmall) DeleteObject(g_ctx->fontSmall);
            if (g_ctx->fontButton) DeleteObject(g_ctx->fontButton);
            if (g_ctx->fontMono) DeleteObject(g_ctx->fontMono);
            if (g_ctx->brushBg) DeleteObject(g_ctx->brushBg);
            if (g_ctx->brushCard) DeleteObject(g_ctx->brushCard);
            if (g_ctx->brushInput) DeleteObject(g_ctx->brushInput);
            if (g_ctx->brushLog) DeleteObject(g_ctx->brushLog);
            delete g_ctx;
            g_ctx = nullptr;
        }
        PostQuitMessage(0);
        return 0;
    default:
        break;
    }
    return DefWindowProcW(window, message, wparam, lparam);
}

} // namespace

bool gui_available() { return true; }

int gui_main(int, char **) {
    // 先声明 DPI 感知，否则系统会把窗口按“虚拟像素”缩放，绘制结果偏移且被裁切
    using SetDpiContextFn = BOOL(WINAPI *)(HANDLE);
    if (HMODULE user32 = GetModuleHandleW(L"user32.dll")) {
        auto set_dpi_context =
            reinterpret_cast<SetDpiContextFn>(GetProcAddress(user32, "SetProcessDpiAwarenessContext"));
        // -4 = DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
        if (!set_dpi_context || !set_dpi_context(reinterpret_cast<HANDLE>(static_cast<INT_PTR>(-4)))) {
            SetProcessDPIAware();
        }
    } else {
        SetProcessDPIAware();
    }

    INITCOMMONCONTROLSEX controls{};
    controls.dwSize = sizeof(controls);
    controls.dwICC = ICC_STANDARD_CLASSES;
    InitCommonControlsEx(&controls);

    HINSTANCE instance = GetModuleHandleW(nullptr);
    WNDCLASSEXW klass{};
    klass.cbSize = sizeof(klass);
    klass.style = CS_HREDRAW | CS_VREDRAW;
    klass.lpfnWndProc = window_proc;
    klass.hInstance = instance;
    klass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    klass.hbrBackground = nullptr;
    klass.lpszClassName = L"CertumSignerWindow";
    if (!RegisterClassExW(&klass)) return 1;

    int dpi = 96;
    HDC screen = GetDC(nullptr);
    if (screen) {
        dpi = GetDeviceCaps(screen, LOGPIXELSX);
        ReleaseDC(nullptr, screen);
    }
    if (dpi <= 0) dpi = 96;
    const float scale = static_cast<float>(dpi) / 96.0f;
    g_scale = scale;
    RECT desired{0, 0, static_cast<LONG>(kBaseWidth * scale), static_cast<LONG>(kBaseHeight * scale)};
    AdjustWindowRectEx(&desired, WS_OVERLAPPEDWINDOW & ~WS_THICKFRAME & ~WS_MAXIMIZEBOX, FALSE, 0);
    const int window_width = desired.right - desired.left;
    const int window_height = desired.bottom - desired.top;

    int screen_width = GetSystemMetrics(SM_CXSCREEN);
    int screen_height = GetSystemMetrics(SM_CYSCREEN);
    HWND window = CreateWindowExW(
        0, klass.lpszClassName, L"CertumSigner", WS_OVERLAPPEDWINDOW & ~WS_THICKFRAME & ~WS_MAXIMIZEBOX,
        (screen_width - window_width) / 2, (screen_height - window_height) / 2, window_width, window_height, nullptr,
        nullptr, instance, nullptr);
    if (!window) return 1;

    BOOL dark = TRUE;
    DwmSetWindowAttribute(window, 20, &dark, sizeof(dark));
    int corner = 2;
    DwmSetWindowAttribute(window, 33, &corner, sizeof(corner));

    ShowWindow(window, SW_SHOW);
    UpdateWindow(window);

    MSG message;
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    return 0;
}

} // namespace cs
