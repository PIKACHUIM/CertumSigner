// Win32 GUI（Windows）—— 登录 / 签名 / 设置 三页，自绘卡片、列表与开关
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

#include <algorithm>
#include <cmath>
#include <cstring>
#include <cwchar>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "http.h"
#include "json.h"
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

/* --------------------------------- 常量 ---------------------------------- */

constexpr int kBaseWidth = 1060;
constexpr int kBaseHeight = 740;
constexpr int kSideWidth = 200;

enum Page { PAGE_LOGIN = 0, PAGE_KEYS = 1, PAGE_SIGN = 2, PAGE_SETTINGS = 3 };

constexpr int IDC_NAV_SIGN = 1001;
constexpr int IDC_NAV_SETTINGS = 1002;
constexpr int IDC_LANG = 1003;
constexpr int IDC_THEME = 1004;

constexpr int IDC_L_SERVER = 1101;
constexpr int IDC_L_USER = 1102;
constexpr int IDC_L_PASS = 1103;
constexpr int IDC_L_LOGIN = 1104;

constexpr int IDC_K_LIST = 1201;
constexpr int IDC_K_USE = 1202;
constexpr int IDC_K_NAME = 1203;
constexpr int IDC_K_CRED = 1204;
constexpr int IDC_K_CREATE = 1205;
constexpr int IDC_K_BACK = 1206;

constexpr int IDC_S_DROP = 1301;
constexpr int IDC_S_LIST = 1302;
constexpr int IDC_S_ADD = 1303;
constexpr int IDC_S_REMOVE = 1304;
constexpr int IDC_S_CLEAR = 1305;
constexpr int IDC_S_SIGN = 1306;
constexpr int IDC_S_VERIFY = 1307;
constexpr int IDC_S_LOG = 1308;
constexpr int IDC_S_LOGCLEAR = 1309;

constexpr int IDC_T_SERVER = 1401;
constexpr int IDC_T_KEY = 1402;
constexpr int IDC_T_SHOWKEY = 1403;
constexpr int IDC_T_ALGO256 = 1404;
constexpr int IDC_T_ALGO1 = 1405;
constexpr int IDC_T_TSON = 1406;
constexpr int IDC_T_TSA = 1407;
constexpr int IDC_T_BACKUP = 1408;
constexpr int IDC_T_LANG = 1409;
constexpr int IDC_T_THEME = 1410;
constexpr int IDC_T_RELOGIN = 1411;
constexpr int IDC_T_LICENSE = 1412;
constexpr int IDC_T_PROJECT = 1413;

constexpr UINT WM_APP_LOG = WM_APP + 1;
constexpr UINT WM_APP_FILE_STATE = WM_APP + 2;
constexpr UINT WM_APP_BATCH_DONE = WM_APP + 3;
constexpr UINT WM_APP_LOGIN_DONE = WM_APP + 4;
constexpr UINT WM_APP_KEY_DONE = WM_APP + 5;
constexpr UINT WM_APP_WHOAMI_DONE = WM_APP + 6;
constexpr UINT_PTR TIMER_ANIM = 1;

/* --------------------------------- 配色 ---------------------------------- */

struct Palette {
    COLORREF bg;
    COLORREF side;
    COLORREF card;
    COLORREF edge;
    COLORREF input;
    COLORREF inputEdge;
    COLORREF text;
    COLORREF muted;
    COLORREF muted2;
    COLORREF accent;
    COLORREF accentHot;
    COLORREF accentDown;
    COLORREF ok;
    COLORREF warn;
    COLORREF bad;
    COLORREF logBg;
    COLORREF hover;
    COLORREF sideActive;
};

const Palette kDark = {
    RGB(11, 16, 28),  RGB(15, 21, 36),  RGB(20, 28, 46),  RGB(34, 45, 68),
    RGB(15, 22, 38),  RGB(44, 58, 88),  RGB(232, 238, 248), RGB(150, 165, 192),
    RGB(104, 120, 148), RGB(99, 102, 241), RGB(124, 127, 245), RGB(79, 70, 229),
    RGB(52, 211, 153), RGB(251, 191, 36), RGB(248, 113, 113), RGB(9, 14, 26),
    RGB(29, 41, 64),  RGB(26, 36, 58),
};

const Palette kLight = {
    RGB(244, 246, 250), RGB(255, 255, 255), RGB(255, 255, 255), RGB(227, 232, 240),
    RGB(248, 250, 252), RGB(214, 222, 234), RGB(23, 31, 45),  RGB(100, 116, 139),
    RGB(148, 163, 184), RGB(79, 70, 229),  RGB(99, 102, 241), RGB(67, 56, 202),
    RGB(16, 185, 129),  RGB(217, 119, 6),  RGB(220, 38, 38),  RGB(246, 248, 251),
    RGB(237, 241, 247), RGB(238, 241, 247),
};

/* --------------------------------- 文案 ---------------------------------- */

struct TextRow {
    const char *key;
    const wchar_t *zh;
    const wchar_t *en;
};

const TextRow kTexts[] = {
    {"app.tag", L"云端代码签名", L"Cloud code signing"},
    {"nav.sign", L"签名", L"Sign"},
    {"nav.settings", L"设置", L"Settings"},
    {"common.show", L"显示", L"Show"},
    {"common.hide", L"隐藏", L"Hide"},

    {"login.title", L"登录", L"Sign in"},
    {"login.sub", L"用平台账号登录，选择或新建一把 API Key", L"Sign in to pick or create an API key"},
    {"login.server", L"平台地址（如 https://xxx.workers.dev）", L"Server URL (e.g. https://xxx.workers.dev)"},
    {"login.user", L"用户名", L"Username"},
    {"login.pass", L"口令", L"Password"},
    {"login.submit", L"登录", L"Sign in"},
    {"login.busy", L"登录中…", L"Signing in…"},
    {"login.hint", L"Key 会保存在本机，下次启动直接进入签名页。", L"Your key is stored locally; next launch skips this page."},
    {"login.empty", L"请填写平台地址、用户名和口令", L"Server, username and password are required"},

    {"keys.title", L"选择 API Key", L"Choose an API key"},
    {"keys.sub", L"选择已有 Key 会换发新值（旧值立即失效），也可以新建一把",
     L"Picking an existing key issues a new secret (the old one stops working), or create a new one"},
    {"keys.use", L"使用选中的 Key", L"Use selected key"},
    {"keys.empty", L"还没有 Key，先新建一把", L"No keys yet — create one below"},
    {"keys.newTitle", L"新建密钥", L"Create a new key"},
    {"keys.name", L"名称", L"Name"},
    {"keys.namePlaceholder", L"例如 laptop", L"e.g. laptop"},
    {"keys.cred", L"证书凭据", L"Certificate"},
    {"keys.create", L"新建并使用", L"Create and use"},
    {"keys.back", L"返回登录", L"Back to sign-in"},
    {"keys.confirm", L"会为此 Key 生成新的 Key 值，旧值立即失效。继续？",
     L"A new secret will be issued for this key; the old one stops working. Continue?"},
    {"keys.revealed", L"新的 API Key", L"Your new API key"},
    {"keys.revealedBody", L"旧值已经失效，请把新值更新到其他设备。", L"The old secret no longer works — update your other machines."},
    {"keys.busy", L"正在换取新 Key…", L"Issuing a new key…"},
    {"keys.defaultName", L"桌面端", L"desktop"},
    {"keys.noCred", L"管理员还没有给你分配证书", L"No certificate assigned yet"},

    {"sign.title", L"签名", L"Sign"},
    {"sign.sub", L"拖入文件或点击上传，批量签名后写回 PE", L"Drop files or click to upload, then sign the whole batch"},
    {"sign.drop", L"拖拽文件到这里，或点击上传", L"Drop files here, or click to upload"},
    {"sign.dropHint", L"支持 .exe / .dll / .sys / .ocx，可一次添加多个",
     L".exe / .dll / .sys / .ocx — multiple files at once"},
    {"sign.queue", L"待签名", L"Queue"},
    {"sign.add", L"添加", L"Add"},
    {"sign.remove", L"移除", L"Remove"},
    {"sign.clear", L"清空", L"Clear"},
    {"sign.start", L"开始签名", L"Sign all"},
    {"sign.verify", L"验证签名", L"Verify"},
    {"sign.empty", L"还没有文件", L"No files yet"},
    {"st.wait", L"等待", L"Queued"},
    {"st.work", L"签名中", L"Signing"},
    {"st.ok", L"成功", L"Signed"},
    {"st.fail", L"失败", L"Failed"},
    {"sign.done", L"完成：%d 成功，%d 失败", L"Done: %d signed, %d failed"},
    {"sign.busy", L"签名中…", L"Signing…"},
    {"sign.pickFirst", L"请先添加文件", L"Add a file first"},
    {"sign.log", L"日志", L"Log"},
    {"sign.logClear", L"清空", L"Clear"},
    {"sign.ready", L"就绪", L"Ready"},
    {"sign.valid", L"签名有效", L"Signature valid"},
    {"sign.invalid", L"签名无效", L"Signature invalid"},
    {"sign.noFile", L"请先在列表里选择文件", L"Select a file in the list first"},

    {"set.title", L"设置", L"Settings"},
    {"set.sub", L"连接、签名选项与界面偏好都保存在本机", L"Connection, signing options and appearance are stored locally"},
    {"set.conn", L"连接", L"Connection"},
    {"set.server", L"平台地址", L"Server URL"},
    {"set.key", L"API Key", L"API Key"},
    {"set.account", L"当前账号", L"Account"},
    {"set.keyName", L"当前 Key", L"Current key"},
    {"set.signing", L"签名选项", L"Signing"},
    {"set.algo", L"摘要算法", L"Digest"},
    {"set.ts", L"时间戳服务", L"Timestamp server"},
    {"set.tsOn", L"添加时间戳", L"Add timestamp"},
    {"set.backup", L"备份原文件", L"Keep a .bak copy"},
    {"set.tsHint", L"直连失败会自动改走 Worker 的 /v1/timestamp 代理",
     L"Falls back to the Worker /v1/timestamp proxy if direct access fails"},
    {"set.ui", L"界面", L"Appearance"},
    {"set.lang", L"语言", L"Language"},
    {"set.theme", L"主题", L"Theme"},
    {"set.auto", L"跟随系统", L"System"},
    {"set.dark", L"暗色", L"Dark"},
    {"set.light", L"亮色", L"Light"},
    {"set.about", L"关于", L"About"},
    {"set.license", L"软件许可", L"License"},
    {"set.project", L"项目地址", L"Project"},
    {"set.relogin", L"重新登录", L"Sign in again"},
    {"set.saved", L"已保存", L"Saved"},
    {"common.unlimited", L"不限", L"Unlimited"},
    {"keys.perDay", L" 次/天", L" / day"},
    {"set.version", L"v1.0.0 · 私钥始终在 Certum 云端，本机只发送摘要",
     L"v1.0.0 · the private key stays in Certum's cloud; only digests leave this machine"},

    {"err.badCredentials", L"用户名或口令错误", L"Wrong username or password"},
    {"err.tooMany", L"尝试次数过多，请稍后再试", L"Too many attempts, try again later"},
    {"err.expired", L"登录已过期，请重新登录", L"Session expired, please sign in again"},
    {"err.account", L"账号已停用或已过期", L"Account disabled or expired"},
    {"err.credRequired", L"请选择证书凭据", L"Pick a certificate"},
    {"err.credAssigned", L"这套证书没有分配给你", L"That certificate is not assigned to you"},
    {"err.keyMissing", L"找不到该 Key", L"Key not found"},
    {"err.keyDisabled", L"该 Key 已停用", L"That key is disabled"},
    {"err.missing", L"请把信息填写完整", L"Please fill in every field"},
    {"err.network", L"连接失败：", L"Connection failed: "},
    {"err.oldServer", L"服务端缺少客户端登录接口，请先升级 Worker", L"Server is missing the client API — upgrade the Worker"},
    {"err.server", L"服务端错误：", L"Server error: "},
};

/* --------------------------------- 状态 ---------------------------------- */

struct FileItem {
    std::string path;
    int state = 0; // 0 等待 / 1 进行中 / 2 成功 / 3 失败
};

struct KeyItem {
    std::string id;
    std::string name;
    std::string prefix;
    std::string credentialId;
    bool enabled = true;
    int quota = 0;
};

struct CredentialItem {
    std::string id;
    std::string label;
    std::string email;
};

struct LoginResult {
    bool ok = false;
    bool revealed = false;
    std::string error;
    std::string token;
    std::string username;
    std::string key_name;
    std::string plaintext;
    std::vector<KeyItem> keys;
    std::vector<CredentialItem> credentials;
};

struct KeyResult {
    bool ok = false;
    std::string error;
    std::string plaintext;
    std::string key_name;
};

struct WhoamiResult {
    bool ok = false;
    bool unauthorized = false;
    std::string username;
    std::string key_name;
    std::string summary;
};

struct App {
    HWND window = nullptr;
    Page page = PAGE_SIGN;

    HWND navSign = nullptr;
    HWND navSettings = nullptr;
    HWND langBtn = nullptr;
    HWND themeBtn = nullptr;

    HWND lgServer = nullptr;
    HWND lgUser = nullptr;
    HWND lgPass = nullptr;
    HWND lgLogin = nullptr;

    HWND keyList = nullptr;
    HWND keyUse = nullptr;
    HWND keyName = nullptr;
    HWND keyCred = nullptr;
    HWND keyCreate = nullptr;
    HWND keyBack = nullptr;

    HWND drop = nullptr;
    HWND list = nullptr;
    HWND addBtn = nullptr;
    HWND removeBtn = nullptr;
    HWND clearBtn = nullptr;
    HWND signBtn = nullptr;
    HWND verifyBtn = nullptr;
    HWND logBox = nullptr;
    HWND logClear = nullptr;

    HWND stServer = nullptr;
    HWND stKey = nullptr;
    HWND stShowKey = nullptr;
    HWND stAlgo256 = nullptr;
    HWND stAlgo1 = nullptr;
    HWND stTsOn = nullptr;
    HWND stTsa = nullptr;
    HWND stBackup = nullptr;
    HWND stLang = nullptr;
    HWND stTheme = nullptr;
    HWND stRelogin = nullptr;
    HWND stLicense = nullptr;
    HWND stProject = nullptr;

    HFONT fontTitle = nullptr;
    HFONT fontH1 = nullptr;
    HFONT fontBody = nullptr;
    HFONT fontSmall = nullptr;
    HFONT fontTiny = nullptr;
    HFONT fontButton = nullptr;
    HFONT fontMono = nullptr;

    HBRUSH brushBg = nullptr;
    HBRUSH brushSide = nullptr;
    HBRUSH brushCard = nullptr;
    HBRUSH brushInput = nullptr;
    HBRUSH brushLog = nullptr;

    Settings settings;
    std::string lang = "zh";
    bool dark = true;

    float scale = 1.0f;
    int dpi = 96;
    int hot = 0;
    int anim = 0;
    int phase = 0; // 0 就绪 / 1 进行中 / 2 完成 / 3 失败
    std::wstring status;
    std::wstring error;
    std::wstring account;   // 侧边栏底部：账号 · Key
    std::wstring note;      // 页面内提示（已保存等）
    bool busy = false;
    bool show_key = false;

    std::vector<FileItem> files;
    std::vector<KeyItem> keys;
    std::vector<CredentialItem> credentials;
    std::string token;
    std::string pending_name;
    std::string pending_plaintext;
};

App *g_app = nullptr;
float g_scale = 1.0f;

/* --------------------------------- 工具 ---------------------------------- */

int px(int value) {
    if (!g_app) return value;
    return static_cast<int>(value * g_app->scale + 0.5f);
}

const Palette &pal() {
    return g_app && !g_app->dark ? kLight : kDark;
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

std::wstring tr(const char *key) {
    const bool en = !g_app || g_app->lang == "en";
    for (const auto &row : kTexts) {
        if (std::strcmp(row.key, key) == 0) return en ? row.en : row.zh;
    }
    return widen(key);
}

std::string control_text(HWND control) {
    if (!control) return {};
    int length = GetWindowTextLengthW(control);
    std::wstring buffer(static_cast<size_t>(length) + 1, L'\0');
    GetWindowTextW(control, buffer.data(), length + 1);
    buffer.resize(static_cast<size_t>(length));
    return narrow(buffer);
}

bool is_dark_system() {
    HKEY key = nullptr;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize", 0,
                      KEY_READ, &key) != ERROR_SUCCESS) {
        return true;
    }
    DWORD value = 1;
    DWORD size = sizeof(value);
    const LSTATUS status = RegQueryValueExW(key, L"AppsUseLightTheme", nullptr, nullptr,
                                            reinterpret_cast<LPBYTE>(&value), &size);
    RegCloseKey(key);
    return status != ERROR_SUCCESS ? true : value == 0;
}

std::string system_lang() {
    const LANGID id = GetUserDefaultUILanguage();
    return (PRIMARYLANGID(id) == LANG_CHINESE) ? "zh" : "en";
}

/* --------------------------------- 绘制 ---------------------------------- */

HFONT make_font(int size_px, int weight, const wchar_t *face) {
    LOGFONTW lf{};
    lf.lfHeight = -px(size_px);
    lf.lfWeight = weight;
    lf.lfQuality = CLEARTYPE_QUALITY;
    lf.lfCharSet = DEFAULT_CHARSET;
    wcscpy_s(lf.lfFaceName, face);
    return CreateFontIndirectW(&lf);
}

RECT rect(int x, int y, int w, int h) {
    return RECT{px(x), px(y), px(x + w), px(y + h)};
}

void fill_rect(HDC dc, const RECT &r, COLORREF color) {
    HBRUSH brush = CreateSolidBrush(color);
    FillRect(dc, &r, brush);
    DeleteObject(brush);
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

void dashed_round(HDC dc, const RECT &r, int radius, COLORREF color) {
    HPEN pen = CreatePen(PS_DASH, 1, color);
    HGDIOBJ oldPen = SelectObject(dc, pen);
    HGDIOBJ oldBrush = SelectObject(dc, GetStockObject(NULL_BRUSH));
    RoundRect(dc, r.left, r.top, r.right, r.bottom, radius, radius);
    SelectObject(dc, oldBrush);
    SelectObject(dc, oldPen);
    DeleteObject(pen);
}

COLORREF color_mix(COLORREF fg, COLORREF bg, int percent = 18) {
    const int r = (GetRValue(fg) * percent + GetRValue(bg) * (100 - percent)) / 100;
    const int g = (GetGValue(fg) * percent + GetGValue(bg) * (100 - percent)) / 100;
    const int b = (GetBValue(fg) * percent + GetBValue(bg) * (100 - percent)) / 100;
    return RGB(r, g, b);
}

void draw_text(HDC dc, const std::wstring &text, RECT r, HFONT font, COLORREF color,
               UINT format = DT_LEFT | DT_SINGLELINE | DT_VCENTER) {
    HGDIOBJ oldFont = SelectObject(dc, font);
    SetBkMode(dc, TRANSPARENT);
    SetTextColor(dc, color);
    DrawTextW(dc, text.c_str(), static_cast<int>(text.size()), &r, format);
    SelectObject(dc, oldFont);
}

/** 一条 1px 分隔线 */
void hline(HDC dc, int x1, int x2, int y, COLORREF color) {
    HPEN pen = CreatePen(PS_SOLID, 1, color);
    HGDIOBJ oldPen = SelectObject(dc, pen);
    MoveToEx(dc, px(x1), px(y), nullptr);
    LineTo(dc, px(x2), px(y));
    SelectObject(dc, oldPen);
    DeleteObject(pen);
}

void draw_pill(HDC dc, RECT r, const std::wstring &text, COLORREF fg, COLORREF bg, HFONT font) {
    fill_round(dc, r, px(11), bg);
    draw_text(dc, text, r, font, fg, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
}

void draw_checkbox(HDC dc, const RECT &r, bool checked, const std::wstring &label, HFONT font) {
    const Palette &p = pal();
    RECT box{};
    box.left = r.left + px(1);
    box.right = box.left + px(18);
    box.top = r.top + (r.bottom - r.top - px(18)) / 2;
    box.bottom = box.top + px(18);

    fill_round(dc, box, px(5), checked ? p.accent : p.input);
    stroke_round(dc, box, px(5), checked ? p.accent : p.inputEdge);
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
    RECT text_rect = r;
    text_rect.left = box.right + px(9);
    draw_text(dc, label, text_rect, font, pal().text);
}

void draw_logo(HDC dc, int x, int y, int size, HFONT font) {
    const Palette &p = pal();
    RECT box = rect(x, y, size, size);
    fill_round(dc, box, px(size / 3), p.accent);
    draw_text(dc, L"C", box, font, RGB(255, 255, 255), DT_CENTER | DT_SINGLELINE | DT_VCENTER);
}

/* --------------------------------- 图标 ---------------------------------- */

void draw_pen_icon(HDC dc, RECT box, COLORREF color) {
    HPEN pen = CreatePen(PS_SOLID, px(2), color);
    HGDIOBJ oldPen = SelectObject(dc, pen);
    const int left = box.left;
    const int top = box.top;
    const int size = box.right - box.left;
    MoveToEx(dc, left + size / 5, top + size * 4 / 5, nullptr);
    LineTo(dc, left + size / 5, top + size * 3 / 5);
    LineTo(dc, left + size * 3 / 4, top + size / 6);
    LineTo(dc, left + size * 5 / 6, top + size / 4);
    LineTo(dc, left + size * 2 / 5, top + size * 3 / 5);
    SelectObject(dc, oldPen);
    DeleteObject(pen);
}

void draw_gear_icon(HDC dc, RECT box, COLORREF color) {
    HPEN pen = CreatePen(PS_SOLID, px(2), color);
    HGDIOBJ oldPen = SelectObject(dc, pen);
    HGDIOBJ oldBrush = SelectObject(dc, GetStockObject(HOLLOW_BRUSH));
    const int cx = (box.left + box.right) / 2;
    const int cy = (box.top + box.bottom) / 2;
    const int r = (box.right - box.left) / 3;
    Ellipse(dc, cx - r, cy - r, cx + r, cy + r);
    for (int i = 0; i < 8; ++i) {
        const double angle = i * 3.14159265 / 4.0;
        const int x1 = cx + static_cast<int>(r * 1.35 * std::cos(angle));
        const int y1 = cy + static_cast<int>(r * 1.35 * std::sin(angle));
        const int x2 = cx + static_cast<int>(r * 1.9 * std::cos(angle));
        const int y2 = cy + static_cast<int>(r * 1.9 * std::sin(angle));
        MoveToEx(dc, x1, y1, nullptr);
        LineTo(dc, x2, y2);
    }
    SelectObject(dc, oldBrush);
    SelectObject(dc, oldPen);
    DeleteObject(pen);
}

void draw_upload_icon(HDC dc, RECT box, COLORREF fg, COLORREF bg) {
    fill_round(dc, box, px(24), bg);
    HPEN pen = CreatePen(PS_SOLID, px(3), fg);
    HGDIOBJ oldPen = SelectObject(dc, pen);
    const int cx = (box.left + box.right) / 2;
    const int top = box.top + px(12);
    MoveToEx(dc, cx, top + px(18), nullptr);
    LineTo(dc, cx, top);
    MoveToEx(dc, cx - px(7), top + px(7), nullptr);
    LineTo(dc, cx, top);
    LineTo(dc, cx + px(7), top + px(7));
    MoveToEx(dc, cx - px(12), top + px(24), nullptr);
    LineTo(dc, cx + px(12), top + px(24));
    SelectObject(dc, oldPen);
    DeleteObject(pen);
}

void draw_file_icon(HDC dc, RECT box, COLORREF fg) {
    HPEN pen = CreatePen(PS_SOLID, px(2), fg);
    HGDIOBJ oldPen = SelectObject(dc, pen);
    HGDIOBJ oldBrush = SelectObject(dc, GetStockObject(HOLLOW_BRUSH));
    RoundRect(dc, box.left, box.top, box.right, box.bottom, px(4), px(4));
    MoveToEx(dc, box.left + px(5), box.top, nullptr);
    LineTo(dc, box.left + px(5), box.bottom);
    SelectObject(dc, oldBrush);
    SelectObject(dc, oldPen);
    DeleteObject(pen);
}

/* ------------------------------- 控件创建 -------------------------------- */

HWND make_control(const wchar_t *klass, const wchar_t *text, DWORD style, DWORD ex_style, RECT bounds, int id,
                  HWND parent, HFONT font) {
    HWND control = CreateWindowExW(ex_style, klass, text, WS_CHILD | style, bounds.left, bounds.top,
                                   bounds.right - bounds.left, bounds.bottom - bounds.top, parent,
                                   reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)), GetModuleHandleW(nullptr),
                                   nullptr);
    if (!control) return nullptr;
    SendMessageW(control, WM_SETFONT, reinterpret_cast<WPARAM>(font ? font : g_app->fontBody), TRUE);
    if (wcscmp(klass, L"EDIT") == 0) {
        SendMessageW(control, EM_SETMARGINS, EC_LEFTMARGIN | EC_RIGHTMARGIN, MAKELPARAM(px(10), px(10)));
    }
    return control;
}

void apply_control_theme(HWND control) {
    if (!control) return;
    if (g_app->dark) {
        SetWindowTheme(control, L"DarkMode_Explorer", nullptr);
    } else {
        SetWindowTheme(control, L"Explorer", nullptr);
    }
}

void rebuild_brushes() {
    App *a = g_app;
    if (!a) return;
    if (a->brushBg) DeleteObject(a->brushBg);
    if (a->brushSide) DeleteObject(a->brushSide);
    if (a->brushCard) DeleteObject(a->brushCard);
    if (a->brushInput) DeleteObject(a->brushInput);
    if (a->brushLog) DeleteObject(a->brushLog);
    const Palette &p = pal();
    a->brushBg = CreateSolidBrush(p.bg);
    a->brushSide = CreateSolidBrush(p.side);
    a->brushCard = CreateSolidBrush(p.card);
    a->brushInput = CreateSolidBrush(p.input);
    a->brushLog = CreateSolidBrush(p.logBg);
}

HBRUSH backdrop_for(HWND control) {
    App *a = g_app;
    const Palette &p = pal();
    if (!a) return CreateSolidBrush(p.card);
    if (control == a->navSign || control == a->navSettings || control == a->langBtn || control == a->themeBtn) {
        return a->brushSide;
    }
    if (control == a->drop) return a->brushBg;
    return a->brushCard;
}

/* ------------------------------- 页面切换 -------------------------------- */

struct ControlSet {
    std::vector<HWND> controls;
};

ControlSet login_controls() {
    App *a = g_app;
    return {{a->lgServer, a->lgUser, a->lgPass, a->lgLogin}};
}

ControlSet keys_controls() {
    App *a = g_app;
    return {{a->keyList, a->keyUse, a->keyName, a->keyCred, a->keyCreate, a->keyBack}};
}

ControlSet sign_controls() {
    App *a = g_app;
    return {{a->drop, a->list, a->addBtn, a->removeBtn, a->clearBtn, a->signBtn, a->verifyBtn, a->logBox,
             a->logClear}};
}

ControlSet settings_controls() {
    App *a = g_app;
    return {{a->stServer, a->stKey, a->stShowKey, a->stAlgo256, a->stAlgo1, a->stTsOn, a->stTsa, a->stBackup,
             a->stLang, a->stTheme, a->stRelogin, a->stLicense, a->stProject}};
}

void show_controls(const ControlSet &set, bool visible) {
    for (HWND control : set.controls) {
        if (control) ShowWindow(control, visible ? SW_SHOW : SW_HIDE);
    }
}

void set_page(Page page) {
    App *a = g_app;
    if (!a) return;
    a->page = page;
    const bool logged_in = page != PAGE_LOGIN && page != PAGE_KEYS;

    show_controls(login_controls(), page == PAGE_LOGIN);
    show_controls(keys_controls(), page == PAGE_KEYS);
    show_controls(sign_controls(), page == PAGE_SIGN);
    show_controls(settings_controls(), page == PAGE_SETTINGS);

    if (a->navSign) ShowWindow(a->navSign, logged_in ? SW_SHOW : SW_HIDE);
    if (a->navSettings) ShowWindow(a->navSettings, logged_in ? SW_SHOW : SW_HIDE);

    if (a->page == PAGE_SIGN) {
        EnableWindow(a->signBtn, a->busy ? FALSE : TRUE);
        EnableWindow(a->verifyBtn, a->busy ? FALSE : TRUE);
        EnableWindow(a->addBtn, a->busy ? FALSE : TRUE);
        EnableWindow(a->removeBtn, a->busy ? FALSE : TRUE);
        EnableWindow(a->clearBtn, a->busy ? FALSE : TRUE);
    }
    if (a->page == PAGE_KEYS) {
        EnableWindow(a->keyUse, a->keys.empty() ? FALSE : TRUE);
    }

    InvalidateRect(a->window, nullptr, FALSE);
    UpdateWindow(a->window);
}

void set_status(int phase, const std::wstring &text) {
    if (!g_app) return;
    g_app->phase = phase;
    g_app->status = text;
    InvalidateRect(g_app->window, nullptr, FALSE);
}

void set_busy(bool busy) {
    App *a = g_app;
    if (!a) return;
    a->busy = busy;
    EnableWindow(a->signBtn, busy ? FALSE : TRUE);
    EnableWindow(a->verifyBtn, busy ? FALSE : TRUE);
    EnableWindow(a->addBtn, busy ? FALSE : TRUE);
    EnableWindow(a->removeBtn, busy ? FALSE : TRUE);
    EnableWindow(a->clearBtn, busy ? FALSE : TRUE);
    EnableWindow(a->lgLogin, busy ? FALSE : TRUE);
    EnableWindow(a->keyUse, busy ? FALSE : TRUE);
    EnableWindow(a->keyCreate, busy ? FALSE : TRUE);
    if (busy) {
        SetTimer(a->window, TIMER_ANIM, 33, nullptr);
    } else {
        KillTimer(a->window, TIMER_ANIM);
    }
    InvalidateRect(a->window, nullptr, FALSE);
}

/* --------------------------------- 日志 ---------------------------------- */

void append_log(const std::string &message) {
    if (!g_app || !g_app->logBox) return;
    std::wstring line = widen(message + "\r\n");
    const int length = GetWindowTextLengthW(g_app->logBox);
    SendMessageW(g_app->logBox, EM_SETSEL, static_cast<WPARAM>(length), static_cast<LPARAM>(length));
    SendMessageW(g_app->logBox, EM_REPLACESEL, FALSE, reinterpret_cast<LPARAM>(line.c_str()));
    SendMessageW(g_app->logBox, EM_SCROLLCARET, 0, 0);
}

void post_log(HWND window, const std::string &message) {
    if (!IsWindow(window)) return;
    auto *copy = new std::string(message);
    if (!PostMessageW(window, WM_APP_LOG, 0, reinterpret_cast<LPARAM>(copy))) delete copy;
}

/* --------------------------------- 配置 ---------------------------------- */

void sync_settings_from_ui() {
    App *a = g_app;
    if (!a || a->page == PAGE_LOGIN) return;
    if (a->stServer) {
        const std::string server = control_text(a->stServer);
        if (!server.empty()) a->settings.server = server;
    }
    if (a->stKey) {
        const std::string key = control_text(a->stKey);
        a->settings.api_key = key;
    }
}

void save_settings_silent() {
    App *a = g_app;
    if (!a) return;
    sync_settings_from_ui();
    std::string err;
    if (!save_settings(a->settings, err)) {
        a->note = widen(err);
        InvalidateRect(a->window, nullptr, FALSE);
    }
}

std::string join_url(const std::string &base, const std::string &path) {
    std::string out = base;
    while (!out.empty() && out.back() == '/') out.pop_back();
    return out + path;
}

std::string json_escape(const std::string &text) {
    std::string out;
    out.reserve(text.size() + 8);
    for (char ch : text) {
        switch (ch) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        default: out += ch; break;
        }
    }
    return out;
}

std::string error_text(const Json &root, const std::string &fallback) {
    const Json *error = root.find("error");
    if (error && error->type == Json::Type::Object) {
        const std::string message = error->get_string("message");
        if (!message.empty()) return message;
    }
    return fallback;
}

std::string error_code(const Json &root) {
    const Json *error = root.find("error");
    if (error && error->type == Json::Type::Object) return error->get_string("code");
    return {};
}

std::wstring localize_error(const std::string &code, const std::string &message) {
    if (code == "bad_credentials") return tr("err.badCredentials");
    if (code == "too_many_attempts") return tr("err.tooMany");
    if (code == "unauthorized") return tr("err.expired");
    if (code == "account_unavailable") return tr("err.account");
    if (code == "credential_required") return tr("err.credRequired");
    if (code == "credential_not_assigned") return tr("err.credAssigned");
    if (code == "key_not_found") return tr("err.keyMissing");
    if (code == "key_disabled") return tr("err.keyDisabled");
    if (code == "missing_fields") return tr("err.missing");
    if (!message.empty()) return widen(message);
    return tr("err.server");
}

/* --------------------------------- 列表 ---------------------------------- */

void refresh_file_list() {
    App *a = g_app;
    if (!a || !a->list) return;
    SendMessageW(a->list, LB_RESETCONTENT, 0, 0);
    for (size_t i = 0; i < a->files.size(); ++i) {
        const int index = static_cast<int>(SendMessageW(a->list, LB_ADDSTRING, 0,
                                                       reinterpret_cast<LPARAM>(L"file")));
        if (index >= 0) SendMessageW(a->list, LB_SETITEMDATA, static_cast<WPARAM>(index),
                                     static_cast<LPARAM>(i));
    }
    InvalidateRect(a->list, nullptr, FALSE);
}

void refresh_key_list() {
    App *a = g_app;
    if (!a || !a->keyList) return;
    SendMessageW(a->keyList, LB_RESETCONTENT, 0, 0);
    for (size_t i = 0; i < a->keys.size(); ++i) {
        const int index = static_cast<int>(SendMessageW(a->keyList, LB_ADDSTRING, 0,
                                                        reinterpret_cast<LPARAM>(L"key")));
        if (index >= 0) SendMessageW(a->keyList, LB_SETITEMDATA, static_cast<WPARAM>(index),
                                     static_cast<LPARAM>(i));
    }
    if (!a->keys.empty()) SendMessageW(a->keyList, LB_SETCURSEL, 0, 0);
    InvalidateRect(a->keyList, nullptr, FALSE);
}

void refresh_cred_combo() {
    App *a = g_app;
    if (!a || !a->keyCred) return;
    SendMessageW(a->keyCred, CB_RESETCONTENT, 0, 0);
    for (size_t i = 0; i < a->credentials.size(); ++i) {
        const CredentialItem &credential = a->credentials[i];
        std::string label = credential.label;
        if (label.empty()) label = credential.id;
        if (!credential.email.empty() && credential.email != credential.label) {
            if (!label.empty()) label += " · ";
            label += credential.email;
        }
        SendMessageW(a->keyCred, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(widen(label).c_str()));
    }
    if (!a->credentials.empty()) SendMessageW(a->keyCred, CB_SETCURSEL, 0, 0);
    EnableWindow(a->keyCred, a->credentials.empty() ? FALSE : TRUE);
    EnableWindow(a->keyCreate, a->credentials.empty() ? FALSE : TRUE);
}

/* --------------------------------- 文件 ---------------------------------- */

bool is_pe_file(const std::string &path) {
    std::string lower = to_lower(path);
    return ends_with(lower, ".exe") || ends_with(lower, ".dll") || ends_with(lower, ".sys") ||
           ends_with(lower, ".ocx") || ends_with(lower, ".cpl");
}

void add_file(const std::string &path) {
    App *a = g_app;
    if (!a) return;
    for (const auto &item : a->files) {
        if (item.path == path) return;
    }
    a->files.push_back(FileItem{path, 0});
}

void add_paths(const std::vector<std::string> &paths) {
    App *a = g_app;
    if (!a) return;
    size_t before = a->files.size();
    for (const auto &path : paths) {
        if (is_directory(path)) {
            for (const auto &inner : list_files(path, true)) {
                if (is_pe_file(inner)) add_file(inner);
            }
        } else if (is_pe_file(path)) {
            add_file(path);
        }
    }
    refresh_file_list();
    if (g_app->files.size() != before) {
        set_status(0, tr("sign.ready"));
    }
}

void pick_files() {
    wchar_t buffer[8192] = {0};
    OPENFILENAMEW dialog{};
    dialog.lStructSize = sizeof(dialog);
    dialog.hwndOwner = g_app ? g_app->window : nullptr;
    dialog.lpstrFile = buffer;
    dialog.nMaxFile = 8192;
    dialog.lpstrFilter = L"PE 文件 (*.exe;*.dll;*.sys;*.ocx)\0*.exe;*.dll;*.sys;*.ocx\0所有文件\0*.*\0";
    dialog.nFilterIndex = 1;
    dialog.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_ALLOWMULTISELECT | OFN_EXPLORER;

    if (!GetOpenFileNameW(&dialog)) return;

    std::vector<std::string> paths;
    const std::wstring first = buffer;
    const wchar_t *cursor = buffer + first.size() + 1;
    if (*cursor == L'\0') {
        paths.push_back(narrow(first));
    } else {
        while (*cursor) {
            const std::wstring name = cursor;
            paths.push_back(narrow(first + L"\\" + name));
            cursor += name.size() + 1;
        }
    }
    add_paths(paths);
}

void remove_selected_files() {
    App *a = g_app;
    if (!a || !a->list) return;
    const int index = static_cast<int>(SendMessageW(a->list, LB_GETCURSEL, 0, 0));
    if (index < 0) return;
    const LRESULT data = SendMessageW(a->list, LB_GETITEMDATA, static_cast<WPARAM>(index), 0);
    if (data < 0 || static_cast<size_t>(data) >= a->files.size()) return;
    a->files.erase(a->files.begin() + data);
    refresh_file_list();
    if (!a->files.empty()) {
        SendMessageW(a->list, LB_SETCURSEL, std::min<size_t>(static_cast<size_t>(index), a->files.size() - 1), 0);
    }
}

void remove_file_at(size_t index) {
    App *a = g_app;
    if (!a || index >= a->files.size()) return;
    a->files.erase(a->files.begin() + static_cast<std::ptrdiff_t>(index));
    refresh_file_list();
}

/* --------------------------------- 签名 ---------------------------------- */

void start_batch_sign() {
    App *a = g_app;
    if (!a || a->busy) return;
    if (a->files.empty()) {
        set_status(3, tr("sign.pickFirst"));
        return;
    }

    sync_settings_from_ui();
    std::string save_error;
    save_settings(a->settings, save_error);

    std::vector<size_t> pending;
    for (size_t i = 0; i < a->files.size(); ++i) {
        const bool use = a->files[i].state != 2;
        if (use) pending.push_back(i);
    }
    if (pending.empty()) pending.push_back(0);

    for (size_t index : pending) a->files[index].state = 0;
    refresh_file_list();

    struct Job {
        std::string server;
        std::string key;
        std::string algorithm;
        std::string tsa;
        bool timestamp = true;
        bool backup = false;
        std::vector<std::string> paths;
        std::vector<size_t> indices;
    };

    auto job = std::make_shared<Job>();
    job->server = a->settings.server;
    job->key = a->settings.api_key;
    job->algorithm = a->settings.algorithm;
    job->tsa = effective_tsa(a->settings);
    job->timestamp = a->settings.timestamp;
    job->backup = a->settings.backup;
    for (size_t index : pending) {
        job->paths.push_back(a->files[index].path);
        job->indices.push_back(index);
    }

    HWND window = a->window;
    set_busy(true);
    set_status(1, tr("sign.busy"));
    append_log(narrow(tr("sign.start") + L" · " + std::to_wstring(job->paths.size()) + L" 个文件"));

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
        bool ready = signer.prepare(error);
        if (!ready) post_log(window, "错误：" + error);

        int ok_count = 0;
        int fail_count = 0;
        for (size_t i = 0; i < job->paths.size(); ++i) {
            const size_t index = job->indices[i];
            if (!IsWindow(window)) break;
            PostMessageW(window, WM_APP_FILE_STATE, static_cast<WPARAM>(index), 1);

            bool ok = ready;
            if (ok) {
                std::string file_error;
                ok = signer.sign_file(job->paths[i], file_error);
                if (!ok) post_log(window, "错误：" + file_error);
            }
            if (ok) ++ok_count; else ++fail_count;
            if (IsWindow(window)) {
                PostMessageW(window, WM_APP_FILE_STATE, static_cast<WPARAM>(index), ok ? 2 : 3);
            }
        }

        if (IsWindow(window)) {
            PostMessageW(window, WM_APP_BATCH_DONE, static_cast<WPARAM>(ok_count), static_cast<LPARAM>(fail_count));
        }
    }).detach();
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

void verify_selected() {
    App *a = g_app;
    if (!a || a->files.empty()) {
        set_status(3, tr("sign.noFile"));
        return;
    }
    int index = static_cast<int>(SendMessageW(a->list, LB_GETCURSEL, 0, 0));
    if (index < 0) index = 0;
    const LRESULT data = SendMessageW(a->list, LB_GETITEMDATA, static_cast<WPARAM>(index), 0);
    if (data < 0 || static_cast<size_t>(data) >= a->files.size()) return;

    const std::string path = a->files[static_cast<size_t>(data)].path;
    const std::wstring wide = widen(path);

    WINTRUST_FILE_INFO file_info{};
    file_info.cbStruct = sizeof(file_info);
    file_info.pcwszFilePath = wide.c_str();

    WINTRUST_DATA info{};
    info.cbStruct = sizeof(info);
    info.dwUIChoice = WTD_UI_NONE;
    info.fdwRevocationChecks = WTD_REVOKE_NONE;
    info.dwUnionChoice = WTD_CHOICE_FILE;
    info.pFile = &file_info;
    info.dwStateAction = WTD_STATEACTION_VERIFY;
    info.dwProvFlags = WTD_CACHE_ONLY_URL_RETRIEVAL;

    GUID policy = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    const LONG result = WinVerifyTrust(nullptr, &policy, &info);
    info.dwStateAction = WTD_STATEACTION_CLOSE;
    WinVerifyTrust(nullptr, &policy, &info);

    if (result == ERROR_SUCCESS) {
        append_log("校验通过：" + file_name(path) + " 签名有效。");
        set_status(2, tr("sign.valid"));
    } else {
        wchar_t code[32] = {0};
        swprintf_s(code, L"0x%08lX", static_cast<unsigned long>(result));
        std::wstring line = L"校验未通过（" + std::wstring(code) + L"）";
        if (const wchar_t *hint = verify_hint(result)) line += std::wstring(L"：") + hint;
        append_log(narrow(line) + " · " + file_name(path));
        set_status(3, tr("sign.invalid"));
    }
}

/* -------------------------------- 登录流程 ------------------------------- */

void apply_login_result(LoginResult *result) {
    App *a = g_app;
    if (!result) return;
    if (!result->ok) {
        a->error = widen(result->error);
        set_busy(false);
        InvalidateRect(a->window, nullptr, FALSE);
        delete result;
        return;
    }

    a->error.clear();
    a->token = result->token;
    a->keys = result->keys;
    a->credentials = result->credentials;
    a->pending_plaintext = result->plaintext;
    a->settings.username = result->username;
    if (!result->key_name.empty()) a->settings.key_name = result->key_name;
    if (!result->plaintext.empty()) a->settings.api_key = result->plaintext;

    a->account = widen(result->username);
    if (!result->key_name.empty()) a->account += std::wstring(L" · ") + widen(result->key_name);

    refresh_key_list();
    refresh_cred_combo();
    set_busy(false);
    set_status(0, tr("sign.ready"));

    if (!result->plaintext.empty()) {
        // 直接选到了 Key：落盘并进入签名页
        std::string err;
        save_settings(a->settings, err);
        if (a->stServer) SetWindowTextW(a->stServer, widen(a->settings.server).c_str());
        if (a->stKey) SetWindowTextW(a->stKey, widen(a->settings.api_key).c_str());
        append_log("已登录：" + result->username + "，Key " + result->key_name);
        a->pending_plaintext.clear();
        set_page(PAGE_SIGN);
    } else {
        // 先把平台地址和账号记下来，选完 Key 再补上 Key
        std::string err;
        save_settings(a->settings, err);
        if (a->stServer) SetWindowTextW(a->stServer, widen(a->settings.server).c_str());
        set_page(PAGE_KEYS);
    }
    delete result;
}

void do_login() {
    App *a = g_app;
    if (!a || a->busy) return;
    const std::string server = control_text(a->lgServer);
    const std::string username = control_text(a->lgUser);
    const std::string password = control_text(a->lgPass);

    if (server.empty() || username.empty() || password.empty()) {
        a->error = tr("login.empty");
        InvalidateRect(a->window, nullptr, FALSE);
        return;
    }

    a->error.clear();
    set_busy(true);
    set_status(1, tr("login.busy"));
    HWND window = a->window;

    std::string body = "{\"username\":\"" + json_escape(username) + "\",\"password\":\"" + json_escape(password) + "\"}";
    std::thread([server, body, window]() {
        auto *result = new LoginResult();
        HttpHeaders headers;
        headers.emplace_back("Content-Type", "application/json");
        headers.emplace_back("Accept", "application/json");
        headers.emplace_back("X-Client", "certumsigner/1.0");

        HttpResponse response = http_post(join_url(server, "/api/client/login"), headers, body, 30);
        if (!response.error.empty()) {
            result->error = narrow(tr("err.network")) + response.error;
            PostMessageW(window, WM_APP_LOGIN_DONE, 0, reinterpret_cast<LPARAM>(result));
            return;
        }

        Json root;
        std::string parse_error;
        if (!Json::parse(response.body, root, parse_error)) {
            result->error = response.status == 404 ? narrow(tr("err.oldServer"))
                                                   : narrow(tr("err.server")) + response.body.substr(0, 120);
            PostMessageW(window, WM_APP_LOGIN_DONE, 0, reinterpret_cast<LPARAM>(result));
            return;
        }

        if (!response.ok() || !root.get_bool("ok", false)) {
            result->error = narrow(localize_error(error_code(root), error_text(root, "登录失败")));
            PostMessageW(window, WM_APP_LOGIN_DONE, 0, reinterpret_cast<LPARAM>(result));
            return;
        }

        result->ok = true;
        result->token = root.get_string("token");
        result->username = root.get_string("username");
        const Json *user = root.find("user");
        if (user && user->type == Json::Type::Object) {
            const std::string name = user->get_string("username");
            if (!name.empty()) result->username = name;
        }

        if (const Json *credentials = root.find("credentials"); credentials && credentials->type == Json::Type::Array) {
            for (const auto &item : credentials->items) {
                CredentialItem credential;
                credential.id = item.get_string("id");
                credential.label = item.get_string("label");
                credential.email = item.get_string("email");
                if (!credential.id.empty()) result->credentials.push_back(credential);
            }
        }
        if (const Json *keys = root.find("keys"); keys && keys->type == Json::Type::Array) {
            for (const auto &item : keys->items) {
                KeyItem key;
                key.id = item.get_string("id");
                key.name = item.get_string("name");
                key.prefix = item.get_string("prefix");
                key.credentialId = item.get_string("credentialId");
                key.enabled = item.get_bool("enabled", true);
                key.quota = static_cast<int>(item.get_number("dailyQuota", 0));
                if (!key.id.empty()) result->keys.push_back(key);
            }
        }
        PostMessageW(window, WM_APP_LOGIN_DONE, 0, reinterpret_cast<LPARAM>(result));
    }).detach();
}

void use_selected_key() {
    App *a = g_app;
    if (!a || a->busy) return;
    const int index = static_cast<int>(SendMessageW(a->keyList, LB_GETCURSEL, 0, 0));
    if (index < 0) return;
    const LRESULT data = SendMessageW(a->keyList, LB_GETITEMDATA, static_cast<WPARAM>(index), 0);
    if (data < 0 || static_cast<size_t>(data) >= a->keys.size()) return;

    const KeyItem key = a->keys[static_cast<size_t>(data)];
    const std::wstring question = tr("keys.confirm");
    if (MessageBoxW(a->window, question.c_str(), L"CertumSigner", MB_ICONQUESTION | MB_YESNO) != IDYES) return;

    set_busy(true);
    set_status(1, tr("keys.busy"));
    const std::string server = a->settings.server;
    const std::string token = a->token;
    HWND window = a->window;

    std::thread([server, token, key, window]() {
        auto *result = new LoginResult();
        HttpHeaders headers;
        headers.emplace_back("Authorization", "Bearer " + token);
        headers.emplace_back("Accept", "application/json");
        headers.emplace_back("X-Client", "certumsigner/1.0");

        HttpResponse response = http_post(join_url(server, "/api/client/keys/" + key.id + "/reveal"), headers, "", 30);
        Json root;
        std::string parse_error;
        if (!response.error.empty()) {
            result->error = narrow(tr("err.network")) + response.error;
        } else if (!Json::parse(response.body, root, parse_error)) {
            result->error = narrow(tr("err.server")) + response.body.substr(0, 120);
        } else if (!response.ok() || !root.get_bool("ok", false)) {
            result->error = narrow(localize_error(error_code(root), error_text(root, "失败")));
        } else {
            result->ok = true;
            result->revealed = true;
            result->plaintext = root.get_string("plaintext");
            result->key_name = key.name;
        }
        PostMessageW(window, WM_APP_KEY_DONE, 0, reinterpret_cast<LPARAM>(result));
    }).detach();
}

void create_key() {
    App *a = g_app;
    if (!a || a->busy) return;
    if (a->credentials.empty()) {
        a->error = tr("keys.noCred");
        InvalidateRect(a->window, nullptr, FALSE);
        return;
    }
    int index = static_cast<int>(SendMessageW(a->keyCred, CB_GETCURSEL, 0, 0));
    if (index < 0) index = 0;
    if (static_cast<size_t>(index) >= a->credentials.size()) return;

    const std::string credential_id = a->credentials[static_cast<size_t>(index)].id;
    std::string name = control_text(a->keyName);
    if (name.empty()) name = narrow(tr("keys.defaultName"));

    set_busy(true);
    set_status(1, tr("keys.busy"));
    const std::string server = a->settings.server;
    const std::string token = a->token;
    HWND window = a->window;

    std::string body = "{\"name\":\"" + json_escape(name) + "\",\"credentialId\":\"" + json_escape(credential_id) +
                       "\",\"dailyQuota\":0}";

    std::thread([server, token, body, name, window]() {
        auto *result = new LoginResult();
        HttpHeaders headers;
        headers.emplace_back("Authorization", "Bearer " + token);
        headers.emplace_back("Content-Type", "application/json");
        headers.emplace_back("Accept", "application/json");
        headers.emplace_back("X-Client", "certumsigner/1.0");

        HttpResponse response = http_post(join_url(server, "/api/client/keys"), headers, body, 30);
        Json root;
        std::string parse_error;
        if (!response.error.empty()) {
            result->error = narrow(tr("err.network")) + response.error;
        } else if (!Json::parse(response.body, root, parse_error)) {
            result->error = narrow(tr("err.server")) + response.body.substr(0, 120);
        } else if (!response.ok() || !root.get_bool("ok", false)) {
            result->error = narrow(localize_error(error_code(root), error_text(root, "失败")));
        } else {
            result->ok = true;
            result->plaintext = root.get_string("plaintext");
            result->key_name = name;
        }
        PostMessageW(window, WM_APP_KEY_DONE, 0, reinterpret_cast<LPARAM>(result));
    }).detach();
}

void apply_key_result(LoginResult *result) {
    App *a = g_app;
    if (!result) return;
    set_busy(false);
    if (!result->ok) {
        a->error = widen(result->error);
        InvalidateRect(a->window, nullptr, FALSE);
        delete result;
        return;
    }

    a->error.clear();
    a->settings.api_key = result->plaintext;
    a->settings.key_name = result->key_name;
    if (!result->username.empty()) a->settings.username = result->username;
    std::string err;
    save_settings(a->settings, err);

    a->account = widen(a->settings.username);
    if (!a->settings.key_name.empty()) a->account += std::wstring(L" · ") + widen(a->settings.key_name);
    if (a->stServer) SetWindowTextW(a->stServer, widen(a->settings.server).c_str());
    if (a->stKey) SetWindowTextW(a->stKey, widen(a->settings.api_key).c_str());

    append_log("已保存 Key：" + result->key_name);

    const std::wstring title = result->revealed ? tr("keys.revealed") : tr("keys.create");
    std::wstring message = title;
    if (result->revealed) message += L"\r\n" + tr("keys.revealedBody");
    message += L"\r\n\r\n" + widen(result->plaintext);
    MessageBoxW(a->window, message.c_str(), L"CertumSigner", MB_ICONINFORMATION | MB_OK);

    delete result;
    set_status(0, tr("sign.ready"));
    set_page(PAGE_SIGN);
}

void refresh_whoami() {
    App *a = g_app;
    if (!a || a->settings.api_key.empty() || a->settings.server.empty()) return;
    const std::string server = a->settings.server;
    const std::string key = a->settings.api_key;
    HWND window = a->window;

    std::thread([server, key, window]() {
        auto *result = new WhoamiResult();
        HttpHeaders headers;
        headers.emplace_back("Authorization", "Bearer " + key);
        headers.emplace_back("Accept", "application/json");
        headers.emplace_back("X-Client", "certumsigner/1.0");

        HttpResponse response = http_get(join_url(server, "/v1/whoami"), headers, 20);
        if (response.error.empty()) {
            Json root;
            std::string parse_error;
            if (Json::parse(response.body, root, parse_error) && response.ok() && root.get_bool("ok", false)) {
                result->ok = true;
                const Json *key_node = root.find("key");
                if (key_node && key_node->type == Json::Type::Object) {
                    result->key_name = key_node->get_string("name");
                }
                const Json *user_node = root.find("user");
                if (user_node && user_node->type == Json::Type::Object) {
                    result->username = user_node->get_string("username");
                }
            } else if (response.status == 401) {
                result->unauthorized = true;
            }
        }
        PostMessageW(window, WM_APP_WHOAMI_DONE, 0, reinterpret_cast<LPARAM>(result));
    }).detach();
}

/* --------------------------------- 布局 ---------------------------------- */

void layout_controls() {
    App *a = g_app;
    if (!a) return;

    if (a->navSign) MoveWindow(a->navSign, px(16), px(104), px(168), px(46), TRUE);
    if (a->navSettings) MoveWindow(a->navSettings, px(16), px(156), px(168), px(46), TRUE);
    if (a->langBtn) MoveWindow(a->langBtn, px(16), px(kBaseHeight - 92), px(80), px(34), TRUE);
    if (a->themeBtn) MoveWindow(a->themeBtn, px(104), px(kBaseHeight - 92), px(80), px(34), TRUE);

    if (a->lgServer) MoveWindow(a->lgServer, px(430), px(298), px(400), px(36), TRUE);
    if (a->lgUser) MoveWindow(a->lgUser, px(430), px(366), px(190), px(36), TRUE);
    if (a->lgPass) MoveWindow(a->lgPass, px(640), px(366), px(190), px(36), TRUE);
    if (a->lgLogin) MoveWindow(a->lgLogin, px(430), px(440), px(400), px(44), TRUE);

    if (a->keyList) MoveWindow(a->keyList, px(248), px(170), px(764), px(196), TRUE);
    if (a->keyUse) MoveWindow(a->keyUse, px(248), px(382), px(220), px(40), TRUE);
    if (a->keyName) MoveWindow(a->keyName, px(248), px(490), px(240), px(36), TRUE);
    if (a->keyCred) MoveWindow(a->keyCred, px(500), px(490), px(300), px(360), TRUE);
    if (a->keyCreate) MoveWindow(a->keyCreate, px(812), px(490), px(200), px(36), TRUE);
    if (a->keyBack) MoveWindow(a->keyBack, px(248), px(560), px(128), px(36), TRUE);

    if (a->drop) MoveWindow(a->drop, px(224), px(78), px(812), px(132), TRUE);
    if (a->list) MoveWindow(a->list, px(240), px(268), px(780), px(224), TRUE);
    if (a->addBtn) MoveWindow(a->addBtn, px(858), px(232), px(54), px(26), TRUE);
    if (a->removeBtn) MoveWindow(a->removeBtn, px(916), px(232), px(54), px(26), TRUE);
    if (a->clearBtn) MoveWindow(a->clearBtn, px(974), px(232), px(54), px(26), TRUE);
    if (a->signBtn) MoveWindow(a->signBtn, px(224), px(520), px(400), px(46), TRUE);
    if (a->verifyBtn) MoveWindow(a->verifyBtn, px(636), px(520), px(200), px(46), TRUE);
    if (a->logBox) MoveWindow(a->logBox, px(240), px(620), px(780), px(84), TRUE);
    if (a->logClear) MoveWindow(a->logClear, px(948), px(586), px(72), px(26), TRUE);

    if (a->stServer) MoveWindow(a->stServer, px(244), px(112), px(560), px(36), TRUE);
    if (a->stKey) MoveWindow(a->stKey, px(244), px(180), px(480), px(36), TRUE);
    if (a->stShowKey) MoveWindow(a->stShowKey, px(736), px(180), px(72), px(36), TRUE);
    if (a->stAlgo256) MoveWindow(a->stAlgo256, px(244), px(292), px(96), px(34), TRUE);
    if (a->stAlgo1) MoveWindow(a->stAlgo1, px(348), px(292), px(84), px(34), TRUE);
    if (a->stTsa) MoveWindow(a->stTsa, px(244), px(356), px(240), px(400), TRUE);
    if (a->stTsOn) MoveWindow(a->stTsOn, px(500), px(352), px(130), px(32), TRUE);
    if (a->stBackup) MoveWindow(a->stBackup, px(660), px(352), px(170), px(32), TRUE);
    if (a->stLang) MoveWindow(a->stLang, px(244), px(466), px(200), px(200), TRUE);
    if (a->stTheme) MoveWindow(a->stTheme, px(470), px(466), px(200), px(200), TRUE);
    if (a->stRelogin) MoveWindow(a->stRelogin, px(620), px(606), px(160), px(36), TRUE);
    if (a->stLicense) MoveWindow(a->stLicense, px(244), px(606), px(140), px(36), TRUE);
    if (a->stProject) MoveWindow(a->stProject, px(396), px(606), px(200), px(36), TRUE);
}

/* ------------------------------- 页面绘制 -------------------------------- */

void paint_sidebar(HDC dc, RECT client) {
    App *a = g_app;
    const Palette &p = pal();
    fill_rect(dc, RECT{0, 0, px(kSideWidth), client.bottom}, p.side);
    // 竖分割线
    HPEN pen = CreatePen(PS_SOLID, 1, p.edge);
    HGDIOBJ oldPen = SelectObject(dc, pen);
    MoveToEx(dc, px(kSideWidth - 1), 0, nullptr);
    LineTo(dc, px(kSideWidth - 1), client.bottom);
    SelectObject(dc, oldPen);
    DeleteObject(pen);

    draw_logo(dc, 24, 22, 34, a->fontTitle);
    draw_text(dc, L"CertumSigner", rect(70, 20, 140, 26), a->fontButton, p.text);
    draw_text(dc, tr("app.tag"), rect(70, 44, 140, 18), a->fontTiny, p.muted2);

    if (a->page != PAGE_LOGIN && a->page != PAGE_KEYS) {
        draw_text(dc, a->account, rect(16, kBaseHeight - 132, 168, 20), a->fontTiny, p.muted,
                  DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);
    } else {
        draw_text(dc, tr("app.tag"), rect(16, kBaseHeight - 132, 168, 20), a->fontTiny, p.muted2);
    }
}

void paint_login(HDC dc) {
    App *a = g_app;
    const Palette &p = pal();
    const RECT card = rect(400, 160, 460, 340);
    fill_round(dc, card, px(18), p.card);
    stroke_round(dc, card, px(18), p.edge);

    draw_logo(dc, 430, 190, 40, a->fontH1);
    draw_text(dc, L"CertumSigner", rect(486, 190, 300, 24), a->fontH1, p.text);
    draw_text(dc, tr("login.title"), rect(486, 214, 300, 18), a->fontTiny, p.muted2);
    draw_text(dc, tr("login.sub"), rect(430, 240, 400, 20), a->fontSmall, p.muted,
              DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);

    draw_text(dc, tr("login.server"), rect(430, 276, 300, 18), a->fontTiny, p.muted2);
    fill_round(dc, rect(430, 298, 400, 36), px(9), p.input);
    stroke_round(dc, rect(430, 298, 400, 36), px(9), GetFocus() == a->lgServer ? p.accent : p.inputEdge);

    draw_text(dc, tr("login.user"), rect(430, 344, 180, 18), a->fontTiny, p.muted2);
    fill_round(dc, rect(430, 366, 190, 36), px(9), p.input);
    stroke_round(dc, rect(430, 366, 190, 36), px(9), GetFocus() == a->lgUser ? p.accent : p.inputEdge);

    draw_text(dc, tr("login.pass"), rect(640, 344, 180, 18), a->fontTiny, p.muted2);
    fill_round(dc, rect(640, 366, 190, 36), px(9), p.input);
    stroke_round(dc, rect(640, 366, 190, 36), px(9), GetFocus() == a->lgPass ? p.accent : p.inputEdge);

    if (!a->error.empty()) {
        draw_text(dc, a->error, rect(430, 408, 400, 22), a->fontSmall, p.bad,
                  DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);
    }

    draw_text(dc, tr("login.hint"), rect(400, 520, 460, 20), a->fontTiny, p.muted2, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
}

void paint_keys(HDC dc) {
    App *a = g_app;
    const Palette &p = pal();
    const RECT card = rect(224, 78, 812, 540);
    fill_round(dc, card, px(16), p.card);
    stroke_round(dc, card, px(16), p.edge);

    draw_text(dc, tr("keys.title"), rect(248, 100, 400, 26), a->fontH1, p.text);
    draw_text(dc, tr("keys.sub"), rect(248, 132, 740, 20), a->fontSmall, p.muted,
              DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);

    fill_round(dc, rect(248, 170, 764, 196), px(12), p.input);
    stroke_round(dc, rect(248, 170, 764, 196), px(12), p.inputEdge);

    if (!a->error.empty()) {
        draw_text(dc, a->error, rect(248, 428, 760, 20), a->fontSmall, p.bad,
                  DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);
    }

    hline(dc, 248, 1012, 442, p.edge);
    draw_text(dc, tr("keys.newTitle"), rect(248, 452, 300, 24), a->fontButton, p.text);
    draw_text(dc, tr("keys.name"), rect(248, 472, 120, 16), a->fontTiny, p.muted2);
    draw_text(dc, tr("keys.cred"), rect(500, 472, 120, 16), a->fontTiny, p.muted2);

    fill_round(dc, rect(248, 490, 240, 36), px(9), p.input);
    stroke_round(dc, rect(248, 490, 240, 36), px(9), GetFocus() == a->keyName ? p.accent : p.inputEdge);

    if (a->credentials.empty()) {
        draw_text(dc, tr("keys.noCred"), rect(500, 490, 300, 36), a->fontSmall, p.muted2,
                  DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);
    }
}

void paint_sign(HDC dc) {
    App *a = g_app;
    const Palette &p = pal();

    draw_text(dc, tr("sign.title"), rect(224, 18, 400, 30), a->fontH1, p.text);
    draw_text(dc, tr("sign.sub"), rect(224, 48, 760, 20), a->fontSmall, p.muted,
              DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);

    // 队列卡片
    const RECT card = rect(224, 222, 812, 286);
    fill_round(dc, card, px(16), p.card);
    stroke_round(dc, card, px(16), p.edge);
    const std::wstring title = tr("sign.queue") + L"  " + std::to_wstring(a->files.size());
    draw_text(dc, title, rect(240, 228, 400, 26), a->fontButton, p.text);
    fill_round(dc, rect(240, 268, 780, 224), px(10), p.input);
    stroke_round(dc, rect(240, 268, 780, 224), px(10), p.inputEdge);

    // 日志卡片
    const RECT log_card = rect(224, 578, 812, 138);
    fill_round(dc, log_card, px(16), p.card);
    stroke_round(dc, log_card, px(16), p.edge);
    draw_text(dc, tr("sign.log"), rect(240, 586, 200, 24), a->fontButton, p.text);
    fill_round(dc, rect(240, 620, 780, 84), px(10), p.logBg);
    stroke_round(dc, rect(240, 620, 780, 84), px(10), p.inputEdge);

    // 状态点
    const COLORREF tone = a->phase == 0 ? p.muted : a->phase == 1 ? p.accent : a->phase == 2 ? p.ok : p.bad;
    const int dot_x = 852;
    const int dot_y = 541;
    HBRUSH brush = CreateSolidBrush(tone);
    HPEN pen = CreatePen(PS_SOLID, 1, tone);
    HGDIOBJ oldBrush = SelectObject(dc, brush);
    HGDIOBJ oldPen = SelectObject(dc, pen);
    Ellipse(dc, px(dot_x), px(dot_y), px(dot_x + 8), px(dot_y + 8));
    SelectObject(dc, oldPen);
    SelectObject(dc, oldBrush);
    DeleteObject(brush);
    DeleteObject(pen);
    draw_text(dc, a->status, rect(868, 530, 168, 30), a->fontSmall, a->phase == 3 ? p.bad : p.muted,
              DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);

    if (a->busy) {
        const int width = px(812);
        const int segment = width / 4;
        const int offset = (a->anim * px(12)) % (width + segment);
        RECT bar{px(224) + offset - segment, px(4), px(224) + offset, px(7)};
        if (bar.right > px(224)) {
            if (bar.left < px(224)) bar.left = px(224);
            fill_round(dc, bar, px(2), p.accent);
        }
    }
}

void paint_settings(HDC dc) {
    App *a = g_app;
    const Palette &p = pal();

    draw_text(dc, tr("set.title"), rect(224, 18, 400, 30), a->fontH1, p.text);
    draw_text(dc, tr("set.sub"), rect(224, 48, 760, 20), a->fontSmall, p.muted,
              DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);

    // 连接
    RECT c1 = rect(224, 78, 812, 168);
    fill_round(dc, c1, px(16), p.card);
    stroke_round(dc, c1, px(16), p.edge);
    draw_text(dc, tr("set.conn"), rect(244, 90, 200, 22), a->fontButton, p.text);
    draw_text(dc, tr("set.server"), rect(244, 114, 300, 16), a->fontTiny, p.muted2);
    fill_round(dc, rect(244, 112, 560, 36), px(9), p.input);
    stroke_round(dc, rect(244, 112, 560, 36), px(9), GetFocus() == a->stServer ? p.accent : p.inputEdge);
    draw_text(dc, tr("set.key"), rect(244, 158, 300, 16), a->fontTiny, p.muted2);
    fill_round(dc, rect(244, 180, 480, 36), px(9), p.input);
    stroke_round(dc, rect(244, 180, 480, 36), px(9), GetFocus() == a->stKey ? p.accent : p.inputEdge);

    draw_text(dc, tr("set.account"), rect(820, 104, 200, 16), a->fontTiny, p.muted2);
    draw_text(dc, a->settings.username.empty() ? L"—" : widen(a->settings.username), rect(820, 124, 200, 20),
              a->fontSmall, p.text, DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);
    draw_text(dc, tr("set.keyName"), rect(820, 150, 200, 16), a->fontTiny, p.muted2);
    draw_text(dc, a->settings.key_name.empty() ? L"—" : widen(a->settings.key_name), rect(820, 168, 200, 20),
              a->fontSmall, p.text, DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);

    // 签名选项
    RECT c2 = rect(224, 258, 812, 160);
    fill_round(dc, c2, px(16), p.card);
    stroke_round(dc, c2, px(16), p.edge);
    draw_text(dc, tr("set.signing"), rect(244, 270, 200, 22), a->fontButton, p.text);
    draw_text(dc, tr("set.algo"), rect(244, 296, 200, 16), a->fontTiny, p.muted2);
    draw_text(dc, tr("set.ts"), rect(244, 332, 200, 16), a->fontTiny, p.muted2);
    draw_text(dc, tr("set.tsHint"), rect(500, 398, 520, 16), a->fontTiny, p.muted2,
              DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);

    // 界面
    RECT c3 = rect(224, 430, 812, 140);
    fill_round(dc, c3, px(16), p.card);
    stroke_round(dc, c3, px(16), p.edge);
    draw_text(dc, tr("set.ui"), rect(244, 442, 200, 22), a->fontButton, p.text);
    draw_text(dc, tr("set.lang"), rect(244, 468, 200, 16), a->fontTiny, p.muted2);
    draw_text(dc, tr("set.theme"), rect(470, 468, 200, 16), a->fontTiny, p.muted2);
    if (!a->note.empty()) {
        draw_text(dc, a->note, rect(700, 474, 320, 20), a->fontSmall, p.ok,
                  DT_RIGHT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);
    }

    // 关于
    RECT c4 = rect(224, 582, 812, 134);
    fill_round(dc, c4, px(16), p.card);
    stroke_round(dc, c4, px(16), p.edge);
    draw_text(dc, tr("set.about"), rect(244, 594, 200, 22), a->fontButton, p.text);
    draw_text(dc, tr("set.version"), rect(244, 656, 760, 20), a->fontTiny, p.muted2,
              DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);
}

void paint_window(HWND window, HDC target) {
    App *a = g_app;
    RECT client{};
    GetClientRect(window, &client);

    HDC dc = CreateCompatibleDC(target);
    HBITMAP bitmap = CreateCompatibleBitmap(target, client.right, client.bottom);
    HGDIOBJ oldBitmap = SelectObject(dc, bitmap);

    fill_rect(dc, client, pal().bg);
    paint_sidebar(dc, client);

    switch (a->page) {
    case PAGE_LOGIN: paint_login(dc); break;
    case PAGE_KEYS: paint_keys(dc); break;
    case PAGE_SIGN: paint_sign(dc); break;
    case PAGE_SETTINGS: paint_settings(dc); break;
    }

    BitBlt(target, 0, 0, client.right, client.bottom, dc, 0, 0, SRCCOPY);
    SelectObject(dc, oldBitmap);
    DeleteObject(bitmap);
    DeleteDC(dc);
}

/* ------------------------------- 自绘控件 -------------------------------- */

void draw_pill_state(HDC dc, RECT r, int state, HFONT font) {
    const Palette &p = pal();
    std::wstring label = tr("st.wait");
    COLORREF fg = p.muted;
    COLORREF bg = p.hover;
    if (state == 1) {
        label = tr("st.work");
        fg = p.accent;
        bg = color_mix(p.accent, p.card);
    } else if (state == 2) {
        label = tr("st.ok");
        fg = p.ok;
        bg = color_mix(p.ok, p.card);
    } else if (state == 3) {
        label = tr("st.fail");
        fg = p.bad;
        bg = color_mix(p.bad, p.card);
    }
    draw_pill(dc, r, label, fg, bg, font);
}

void draw_list_item(const DRAWITEMSTRUCT *item) {
    App *a = g_app;
    if (!a || !item) return;
    HDC dc = item->hDC;
    const Palette &p = pal();
    const RECT r = item->rcItem;

    if (item->itemID == static_cast<UINT>(-1)) {
        draw_text(dc, tr("sign.empty"), r, a->fontSmall, p.muted2, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        return;
    }

    const LRESULT data = SendMessageW(item->hwndItem, LB_GETITEMDATA, item->itemID, 0);
    if (data < 0) return;
    const size_t index = static_cast<size_t>(data);
    if (index >= a->files.size()) return;

    const bool selected = (item->itemState & ODS_SELECTED) != 0;
    fill_rect(dc, r, selected ? p.hover : p.input);

    draw_file_icon(dc, RECT{r.left + px(12), r.top + px(14), r.left + px(30), r.top + px(38)}, p.muted);

    RECT name_rect{r.left + px(42), r.top + px(6), r.right - px(150), r.top + px(28)};
    draw_text(dc, widen(file_name(a->files[index].path)), name_rect, a->fontBody, p.text,
              DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);

    RECT path_rect{r.left + px(42), r.top + px(28), r.right - px(150), r.top + px(48)};
    draw_text(dc, widen(dir_name(a->files[index].path)), path_rect, a->fontTiny, p.muted2,
              DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS | DT_PATH_ELLIPSIS);

    RECT pill{r.right - px(146), r.top + px(14), r.right - px(48), r.top + px(36)};
    draw_pill_state(dc, pill, a->files[index].state, a->fontTiny);

    RECT close{r.right - px(38), r.top + px(14), r.right - px(16), r.top + px(36)};
    draw_text(dc, L"\u00D7", close, a->fontBody, p.muted, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
}

void draw_key_item(const DRAWITEMSTRUCT *item) {
    App *a = g_app;
    if (!a || !item) return;
    HDC dc = item->hDC;
    const Palette &p = pal();
    const RECT r = item->rcItem;

    if (item->itemID == static_cast<UINT>(-1)) {
        draw_text(dc, tr("keys.empty"), r, a->fontSmall, p.muted2, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        return;
    }

    const LRESULT data = SendMessageW(item->hwndItem, LB_GETITEMDATA, item->itemID, 0);
    if (data < 0) return;
    const size_t index = static_cast<size_t>(data);
    if (index >= a->keys.size()) return;

    const bool selected = (item->itemState & ODS_SELECTED) != 0;
    fill_rect(dc, r, selected ? p.hover : p.input);

    const KeyItem &key = a->keys[index];
    draw_text(dc, widen(key.name), RECT{r.left + px(16), r.top + px(6), r.right - px(200), r.top + px(28)},
              a->fontButton, p.text, DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);
    draw_text(dc, widen(key.prefix) + L"…", RECT{r.left + px(16), r.top + px(28), r.right - px(200), r.top + px(48)},
              a->fontMono, p.muted2, DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);
    const std::wstring quota = key.quota > 0 ? widen(std::to_string(key.quota)) + tr("keys.perDay")
                                             : tr("common.unlimited");
    draw_text(dc, quota, RECT{r.right - px(190), r.top + px(16), r.right - px(16), r.top + px(40)}, a->fontTiny,
              p.muted, DT_RIGHT | DT_SINGLELINE | DT_VCENTER);
}

void draw_combo_item(const DRAWITEMSTRUCT *item) {
    App *a = g_app;
    if (!a || !item) return;
    HDC dc = item->hDC;
    const Palette &p = pal();
    const RECT r = item->rcItem;
    const bool selected = (item->itemState & ODS_SELECTED) != 0;
    const bool editing = (item->itemState & ODS_COMBOBOXEDIT) != 0;

    fill_rect(dc, r, selected && !editing ? p.accent : p.input);

    wchar_t buffer[256] = {0};
    SendMessageW(item->hwndItem, CB_GETLBTEXT, item->itemID, reinterpret_cast<LPARAM>(buffer));
    draw_text(dc, buffer, RECT{r.left + px(8), r.top, r.right - px(8), r.bottom}, a->fontSmall,
              selected && !editing ? RGB(255, 255, 255) : p.text,
              DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);
}

void draw_ownerdraw(const DRAWITEMSTRUCT *item) {
    App *a = g_app;
    if (!a || !item) return;
    const int id = static_cast<int>(item->CtlID);
    RECT r = item->rcItem;
    const bool hot = a->hot == id;
    const bool down = (item->itemState & ODS_SELECTED) != 0;
    const Palette &p = pal();
    HDC dc = item->hDC;
    SetBkMode(dc, TRANSPARENT);

    if (id == IDC_S_DROP) {
        fill_rect(dc, r, p.bg);
        RECT zone = r;
        InflateRect(&zone, -px(1), -px(1));
        fill_round(dc, zone, px(16), hot ? p.hover : p.card);
        dashed_round(dc, zone, px(16), down ? p.accent : (hot ? p.accent : p.inputEdge));
        RECT circle{};
        circle.right = (zone.left + zone.right) / 2 + px(22);
        circle.left = circle.right - px(44);
        circle.top = zone.top + px(22);
        circle.bottom = circle.top + px(44);
        draw_upload_icon(dc, circle, p.accent, color_mix(p.accent, p.card));
        draw_text(dc, tr("sign.drop"), RECT{zone.left, zone.top + px(70), zone.right, zone.top + px(94)}, a->fontButton,
                  p.text, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        draw_text(dc, tr("sign.dropHint"), RECT{zone.left, zone.top + px(96), zone.right, zone.top + px(116)},
                  a->fontTiny, p.muted2, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        return;
    }

    if (id == IDC_NAV_SIGN || id == IDC_NAV_SETTINGS) {
        const bool active = (id == IDC_NAV_SIGN) ? a->page == PAGE_SIGN : a->page == PAGE_SETTINGS;
        fill_rect(dc, r, p.side);
        fill_round(dc, r, px(10), active ? p.sideActive : (hot ? p.hover : p.side));
        RECT icon{r.left + px(14), r.top + px(14), r.left + px(32), r.top + px(32)};
        if (id == IDC_NAV_SIGN) draw_pen_icon(dc, icon, active ? p.text : p.muted);
        else draw_gear_icon(dc, icon, active ? p.text : p.muted);
        RECT label{r.left + px(42), r.top, r.right - px(10), r.bottom};
        draw_text(dc, id == IDC_NAV_SIGN ? tr("nav.sign") : tr("nav.settings"), label, a->fontButton,
                  active ? p.text : p.muted, DT_LEFT | DT_SINGLELINE | DT_VCENTER);
        return;
    }

    if (id == IDC_LANG || id == IDC_THEME) {
        fill_rect(dc, r, p.side);
        fill_round(dc, r, px(9), hot ? p.hover : p.sideActive);
        stroke_round(dc, r, px(9), p.edge);
        const std::wstring label = id == IDC_LANG ? (a->lang == "zh" ? L"中文" : L"EN")
                                                  : (a->dark ? tr("set.dark") : tr("set.light"));
        draw_text(dc, label, r, a->fontSmall, p.text, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        return;
    }

    if (id == IDC_S_SIGN) {
        fill_round(dc, r, px(11), p.bg);
        fill_round(dc, r, px(11), down ? p.accentDown : hot ? p.accentHot : p.accent);
        draw_text(dc, tr("sign.start"), r, a->fontButton, RGB(255, 255, 255),
                  DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        return;
    }

    if (id == IDC_S_VERIFY || id == IDC_K_USE || id == IDC_K_CREATE || id == IDC_T_RELOGIN || id == IDC_T_LICENSE ||
        id == IDC_T_PROJECT || id == IDC_L_LOGIN || id == IDC_K_BACK) {
        const bool primary = id == IDC_L_LOGIN || id == IDC_K_CREATE || id == IDC_K_USE;
        std::wstring label;
        switch (id) {
        case IDC_S_VERIFY: label = tr("sign.verify"); break;
        case IDC_K_USE: label = tr("keys.use"); break;
        case IDC_K_CREATE: label = tr("keys.create"); break;
        case IDC_K_BACK: label = tr("keys.back"); break;
        case IDC_L_LOGIN: label = tr("login.submit"); break;
        case IDC_T_RELOGIN: label = tr("set.relogin"); break;
        case IDC_T_LICENSE: label = tr("set.license"); break;
        case IDC_T_PROJECT: label = tr("set.project"); break;
        default: break;
        }
        if (primary) {
            fill_round(dc, r, px(10), down ? p.accentDown : hot ? p.accentHot : p.accent);
            draw_text(dc, label, r, a->fontButton, RGB(255, 255, 255), DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        } else {
            fill_round(dc, r, px(10), hot ? p.hover : p.card);
            stroke_round(dc, r, px(10), p.inputEdge);
            draw_text(dc, label, r, a->fontButton, p.text, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        }
        return;
    }

    if (id == IDC_S_ADD || id == IDC_S_REMOVE || id == IDC_S_CLEAR || id == IDC_S_LOGCLEAR) {
        fill_round(dc, r, px(7), hot ? p.hover : p.card);
        stroke_round(dc, r, px(7), p.inputEdge);
        const std::wstring label = id == IDC_S_ADD ? tr("sign.add")
                                 : id == IDC_S_REMOVE ? tr("sign.remove")
                                                      : tr("sign.clear");
        draw_text(dc, label, r, a->fontTiny, hot ? p.text : p.muted, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        return;
    }

    if (id == IDC_T_SHOWKEY) {
        fill_round(dc, r, px(9), hot ? p.hover : p.card);
        stroke_round(dc, r, px(9), p.inputEdge);
        draw_text(dc, a->show_key ? tr("common.hide") : tr("common.show"), r, a->fontSmall, p.text,
                  DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        return;
    }

    if (id == IDC_T_ALGO256 || id == IDC_T_ALGO1) {
        const bool active = (id == IDC_T_ALGO256) ? a->settings.algorithm != "sha1"
                                                  : a->settings.algorithm == "sha1";
        fill_round(dc, r, px(9), active ? p.accent : (hot ? p.hover : p.input));
        stroke_round(dc, r, px(9), active ? p.accent : p.inputEdge);
        draw_text(dc, id == IDC_T_ALGO256 ? L"SHA-256" : L"SHA-1", r, a->fontSmall,
                  active ? RGB(255, 255, 255) : p.muted, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
        return;
    }

    if (id == IDC_T_TSON || id == IDC_T_BACKUP) {
        fill_rect(dc, r, p.card);
        const bool checked = id == IDC_T_TSON ? a->settings.timestamp : a->settings.backup;
        draw_checkbox(dc, r, checked, id == IDC_T_TSON ? tr("set.tsOn") : tr("set.backup"), a->fontSmall);
        return;
    }
}

/* --------------------------------- 窗口 ---------------------------------- */

void apply_language_to_controls() {
    App *a = g_app;
    if (!a) return;
    if (a->lgLogin) SetWindowTextW(a->lgLogin, tr("login.submit").c_str());
    if (a->keyUse) SetWindowTextW(a->keyUse, tr("keys.use").c_str());
    if (a->keyCreate) SetWindowTextW(a->keyCreate, tr("keys.create").c_str());
    if (a->keyBack) SetWindowTextW(a->keyBack, tr("keys.back").c_str());
    if (a->signBtn) SetWindowTextW(a->signBtn, tr("sign.start").c_str());
    if (a->verifyBtn) SetWindowTextW(a->verifyBtn, tr("sign.verify").c_str());
    if (a->addBtn) SetWindowTextW(a->addBtn, tr("sign.add").c_str());
    if (a->removeBtn) SetWindowTextW(a->removeBtn, tr("sign.remove").c_str());
    if (a->clearBtn) SetWindowTextW(a->clearBtn, tr("sign.clear").c_str());
    if (a->logClear) SetWindowTextW(a->logClear, tr("sign.logClear").c_str());
    if (a->stRelogin) SetWindowTextW(a->stRelogin, tr("set.relogin").c_str());
    if (a->stLicense) SetWindowTextW(a->stLicense, tr("set.license").c_str());
    if (a->stProject) SetWindowTextW(a->stProject, tr("set.project").c_str());
    if (a->stShowKey) {
        const std::wstring label = a->show_key ? tr("common.hide") : tr("common.show");
        SetWindowTextW(a->stShowKey, label.c_str());
    }
    if (a->status.empty()) a->status = tr("sign.ready");
}

void refresh_theme_selectors() {
    App *a = g_app;
    if (!a) return;
    BOOL dark_flag = a->dark ? TRUE : FALSE;
    DwmSetWindowAttribute(a->window, 20, &dark_flag, sizeof(dark_flag));
    rebuild_brushes();
    HWND edits[] = {a->lgServer, a->lgUser, a->lgPass, a->keyName, a->logBox, a->stServer, a->stKey};
    for (HWND control : edits) apply_control_theme(control);
    HWND combos[] = {a->keyCred, a->stTsa, a->stLang, a->stTheme};
    for (HWND control : combos) apply_control_theme(control);
    InvalidateRect(a->window, nullptr, TRUE);
}

void apply_theme_choice() {
    App *a = g_app;
    if (!a) return;
    const std::string &theme = a->settings.theme;
    a->dark = theme == "dark" ? true : theme == "light" ? false : is_dark_system();
    refresh_theme_selectors();
}

void apply_lang_choice() {
    App *a = g_app;
    if (!a) return;
    a->lang = a->settings.lang.empty() ? system_lang() : a->settings.lang;
    if (a->stTheme) {
        const int index = static_cast<int>(SendMessageW(a->stTheme, CB_GETCURSEL, 0, 0));
        SendMessageW(a->stTheme, CB_RESETCONTENT, 0, 0);
        SendMessageW(a->stTheme, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(tr("set.auto").c_str()));
        SendMessageW(a->stTheme, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(tr("set.dark").c_str()));
        SendMessageW(a->stTheme, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(tr("set.light").c_str()));
        SendMessageW(a->stTheme, CB_SETCURSEL, index < 0 ? 0 : index, 0);
    }
    if (a->status.empty() || a->phase == 0) a->status = tr("sign.ready");
    apply_language_to_controls();
    InvalidateRect(a->window, nullptr, TRUE);
}

void setup_controls(HWND window) {
    App *a = g_app;
    const DWORD button = BS_OWNERDRAW | WS_TABSTOP;
    const DWORD edit_style = ES_AUTOHSCROLL | WS_TABSTOP;
    const DWORD list_style = LBS_OWNERDRAWFIXED | LBS_NOINTEGRALHEIGHT | LBS_NOTIFY | WS_VSCROLL | WS_TABSTOP |
                             LBS_HASSTRINGS;

    a->navSign = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_NAV_SIGN, window, a->fontButton);
    a->navSettings = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_NAV_SETTINGS, window, a->fontButton);
    a->langBtn = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_LANG, window, a->fontSmall);
    a->themeBtn = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_THEME, window, a->fontSmall);

    a->lgServer = make_control(L"EDIT", L"", edit_style, 0, rect(0, 0, 10, 10), IDC_L_SERVER, window, a->fontBody);
    a->lgUser = make_control(L"EDIT", L"", edit_style, 0, rect(0, 0, 10, 10), IDC_L_USER, window, a->fontBody);
    a->lgPass = make_control(L"EDIT", L"", edit_style | ES_PASSWORD, 0, rect(0, 0, 10, 10), IDC_L_PASS, window,
                             a->fontBody);
    a->lgLogin = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_L_LOGIN, window, a->fontButton);

    a->keyList = make_control(L"LISTBOX", L"", list_style, 0, rect(0, 0, 10, 10), IDC_K_LIST, window, a->fontBody);
    a->keyUse = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_K_USE, window, a->fontButton);
    a->keyName = make_control(L"EDIT", L"", edit_style, 0, rect(0, 0, 10, 10), IDC_K_NAME, window, a->fontBody);
    a->keyCred = make_control(L"COMBOBOX", L"", CBS_DROPDOWNLIST | CBS_OWNERDRAWFIXED | CBS_HASSTRINGS | WS_VSCROLL |
                                                  WS_TABSTOP,
                              0, rect(0, 0, 10, 10), IDC_K_CRED, window, a->fontSmall);
    a->keyCreate = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_K_CREATE, window, a->fontButton);
    a->keyBack = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_K_BACK, window, a->fontSmall);

    a->drop = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_S_DROP, window, a->fontBody);
    a->list = make_control(L"LISTBOX", L"", list_style, 0, rect(0, 0, 10, 10), IDC_S_LIST, window, a->fontBody);
    a->addBtn = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_S_ADD, window, a->fontTiny);
    a->removeBtn = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_S_REMOVE, window, a->fontTiny);
    a->clearBtn = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_S_CLEAR, window, a->fontTiny);
    a->signBtn = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_S_SIGN, window, a->fontButton);
    a->verifyBtn = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_S_VERIFY, window, a->fontButton);
    a->logBox = make_control(L"EDIT", L"", ES_MULTILINE | ES_READONLY | ES_AUTOVSCROLL | WS_VSCROLL, 0,
                             rect(0, 0, 10, 10), IDC_S_LOG, window, a->fontMono);
    a->logClear = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_S_LOGCLEAR, window, a->fontTiny);

    a->stServer = make_control(L"EDIT", L"", edit_style, 0, rect(0, 0, 10, 10), IDC_T_SERVER, window, a->fontBody);
    a->stKey = make_control(L"EDIT", L"", edit_style | ES_PASSWORD, 0, rect(0, 0, 10, 10), IDC_T_KEY, window,
                            a->fontBody);
    a->stShowKey = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_T_SHOWKEY, window, a->fontSmall);
    a->stAlgo256 = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_T_ALGO256, window, a->fontSmall);
    a->stAlgo1 = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_T_ALGO1, window, a->fontSmall);
    a->stTsOn = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_T_TSON, window, a->fontSmall);
    a->stTsa = make_control(L"COMBOBOX", L"", CBS_DROPDOWNLIST | CBS_OWNERDRAWFIXED | CBS_HASSTRINGS | WS_VSCROLL |
                                                 WS_TABSTOP,
                            0, rect(0, 0, 10, 10), IDC_T_TSA, window, a->fontSmall);
    a->stBackup = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_T_BACKUP, window, a->fontSmall);
    a->stLang = make_control(L"COMBOBOX", L"", CBS_DROPDOWNLIST | CBS_OWNERDRAWFIXED | CBS_HASSTRINGS | WS_VSCROLL |
                                                  WS_TABSTOP,
                             0, rect(0, 0, 10, 10), IDC_T_LANG, window, a->fontSmall);
    a->stTheme = make_control(L"COMBOBOX", L"", CBS_DROPDOWNLIST | CBS_OWNERDRAWFIXED | CBS_HASSTRINGS | WS_VSCROLL |
                                                   WS_TABSTOP,
                              0, rect(0, 0, 10, 10), IDC_T_THEME, window, a->fontSmall);
    a->stRelogin = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_T_RELOGIN, window, a->fontButton);
    a->stLicense = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_T_LICENSE, window, a->fontButton);
    a->stProject = make_control(L"BUTTON", L"", button, 0, rect(0, 0, 10, 10), IDC_T_PROJECT, window, a->fontButton);

    SendMessageW(a->keyList, LB_SETITEMHEIGHT, 0, px(56));
    SendMessageW(a->list, LB_SETITEMHEIGHT, 0, px(56));

    for (const auto &tsa : builtin_tsa()) {
        SendMessageW(a->stTsa, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(widen(tsa.name).c_str()));
    }
    SendMessageW(a->stLang, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(L"中文"));
    SendMessageW(a->stLang, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(L"English"));
    SendMessageW(a->stTheme, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(tr("set.auto").c_str()));
    SendMessageW(a->stTheme, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(tr("set.dark").c_str()));
    SendMessageW(a->stTheme, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(tr("set.light").c_str()));
}

void load_state_into_controls() {
    App *a = g_app;
    if (!a) return;
    if (a->stServer) SetWindowTextW(a->stServer, widen(a->settings.server).c_str());
    if (a->stKey) SetWindowTextW(a->stKey, widen(a->settings.api_key).c_str());
    if (a->lgServer) SetWindowTextW(a->lgServer, widen(a->settings.server).c_str());
    if (a->lgUser) SetWindowTextW(a->lgUser, widen(a->settings.username).c_str());
    if (a->keyName) SetWindowTextW(a->keyName, tr("keys.defaultName").c_str());

    int tsa_index = 0;
    for (size_t i = 0; i < builtin_tsa().size(); ++i) {
        if (a->settings.tsa_name == builtin_tsa()[i].name) tsa_index = static_cast<int>(i);
    }
    if (a->stTsa) SendMessageW(a->stTsa, CB_SETCURSEL, tsa_index, 0);

    const int lang_index = a->settings.lang == "en" ? 1 : a->settings.lang == "zh" ? 0 : (a->lang == "en" ? 1 : 0);
    if (a->stLang) SendMessageW(a->stLang, CB_SETCURSEL, lang_index, 0);

    const int theme_index = a->settings.theme == "dark" ? 1 : a->settings.theme == "light" ? 2 : 0;
    if (a->stTheme) SendMessageW(a->stTheme, CB_SETCURSEL, theme_index, 0);
}

void update_setting_strings() {
    App *a = g_app;
    if (!a) return;
    const int tsa_index = static_cast<int>(SendMessageW(a->stTsa, CB_GETCURSEL, 0, 0));
    if (tsa_index >= 0 && static_cast<size_t>(tsa_index) < builtin_tsa().size()) {
        a->settings.tsa_name = builtin_tsa()[static_cast<size_t>(tsa_index)].name;
        a->settings.tsa_url.clear();
    }
    const int lang_index = static_cast<int>(SendMessageW(a->stLang, CB_GETCURSEL, 0, 0));
    a->settings.lang = lang_index == 1 ? "en" : "zh";
    const int theme_index = static_cast<int>(SendMessageW(a->stTheme, CB_GETCURSEL, 0, 0));
    a->settings.theme = theme_index == 1 ? "dark" : theme_index == 2 ? "light" : "auto";
}

/* --------------------------------- 交互 ---------------------------------- */

void toggle_language() {
    App *a = g_app;
    if (!a) return;
    a->settings.lang = a->lang == "zh" ? "en" : "zh";
    apply_lang_choice();
    if (a->stLang) {
        const int index = a->settings.lang == "en" ? 1 : 0;
        SendMessageW(a->stLang, CB_SETCURSEL, index, 0);
        InvalidateRect(a->stLang, nullptr, TRUE);
    }
    save_settings_silent();
}

void toggle_theme() {
    App *a = g_app;
    if (!a) return;
    a->settings.theme = a->dark ? "light" : "dark";
    apply_theme_choice();
    if (a->stTheme) SendMessageW(a->stTheme, CB_SETCURSEL, a->dark ? 1 : 2, 0);
    save_settings_silent();
}

void relogin() {
    App *a = g_app;
    if (!a) return;
    sync_settings_from_ui();
    a->settings.api_key.clear();
    a->token.clear();
    a->keys.clear();
    a->credentials.clear();
    a->account.clear();
    a->error.clear();
    if (a->stKey) SetWindowTextW(a->stKey, L"");
    std::string err;
    save_settings(a->settings, err);
    set_page(PAGE_LOGIN);
    SetFocus(a->lgUser);
}

void show_license() {
    const std::wstring text =
        L"CertumSigner — GNU Affero General Public License v3.0\r\n\r\n"
        L"本程序是自由软件：你可以依据自由软件基金会发布的 GNU AGPL v3.0\r\n"
        L"（或更新版本）条款重新分发和/或修改它。\r\n\r\n"
        L"分发本程序或通过网络提供其功能时，必须一并提供完整的源代码。\r\n"
        L"本程序不提供任何担保，包括适销性或特定用途适用性的默示担保。\r\n\r\n"
        L"完整许可文本见项目仓库根目录的 LICENSE 文件。";
    MessageBoxW(g_app->window, text.c_str(), L"AGPL-3.0", MB_ICONINFORMATION | MB_OK);
}

void open_project() {
    ShellExecuteW(g_app->window, L"open", L"https://github.com/PIKACHUIM/CertumSigner", nullptr, nullptr,
                  SW_SHOWNORMAL);
}

void handle_command(int id, int code) {
    App *a = g_app;
    if (!a) return;

    if (code == BN_CLICKED) {
        switch (id) {
        case IDC_NAV_SIGN: set_page(PAGE_SIGN); return;
        case IDC_NAV_SETTINGS: set_page(PAGE_SETTINGS); return;
        case IDC_LANG: toggle_language(); return;
        case IDC_THEME: toggle_theme(); return;
        case IDC_L_LOGIN: do_login(); return;
        case IDC_K_USE: use_selected_key(); return;
        case IDC_K_CREATE: create_key(); return;
        case IDC_K_BACK: set_page(PAGE_LOGIN); return;
        case IDC_S_DROP:
        case IDC_S_ADD: pick_files(); return;
        case IDC_S_REMOVE: remove_selected_files(); return;
        case IDC_S_CLEAR:
            a->files.clear();
            refresh_file_list();
            return;
        case IDC_S_SIGN: start_batch_sign(); return;
        case IDC_S_VERIFY: verify_selected(); return;
        case IDC_S_LOGCLEAR: SetWindowTextW(a->logBox, L""); return;
        case IDC_T_ALGO256:
            a->settings.algorithm = "sha256";
            InvalidateRect(a->stAlgo256, nullptr, TRUE);
            InvalidateRect(a->stAlgo1, nullptr, TRUE);
            save_settings_silent();
            return;
        case IDC_T_ALGO1:
            a->settings.algorithm = "sha1";
            InvalidateRect(a->stAlgo256, nullptr, TRUE);
            InvalidateRect(a->stAlgo1, nullptr, TRUE);
            save_settings_silent();
            return;
        case IDC_T_TSON:
            a->settings.timestamp = !a->settings.timestamp;
            InvalidateRect(a->stTsOn, nullptr, TRUE);
            save_settings_silent();
            return;
        case IDC_T_BACKUP:
            a->settings.backup = !a->settings.backup;
            InvalidateRect(a->stBackup, nullptr, TRUE);
            save_settings_silent();
            return;
        case IDC_T_SHOWKEY:
            a->show_key = !a->show_key;
            SendMessageW(a->stKey, EM_SETPASSWORDCHAR, a->show_key ? 0 : static_cast<WPARAM>(0x25CF), 0);
            InvalidateRect(a->stKey, nullptr, TRUE);
            InvalidateRect(a->stShowKey, nullptr, TRUE);
            return;
        case IDC_T_RELOGIN: relogin(); return;
        case IDC_T_LICENSE: show_license(); return;
        case IDC_T_PROJECT: open_project(); return;
        default: break;
        }
    }

    if (id == IDC_T_SERVER || id == IDC_T_KEY) {
        if (code == EN_KILLFOCUS) {
            save_settings_silent();
            a->note = tr("set.saved");
            InvalidateRect(a->window, nullptr, FALSE);
        } else if (code == EN_SETFOCUS || code == EN_CHANGE) {
            InvalidateRect(a->window, nullptr, FALSE);
        }
        return;
    }

    if (id == IDC_L_SERVER || id == IDC_L_USER || id == IDC_L_PASS) {
        if (code == EN_SETFOCUS || code == EN_KILLFOCUS) InvalidateRect(a->window, nullptr, FALSE);
        return;
    }

    if (id == IDC_T_TSA || id == IDC_T_LANG || id == IDC_T_THEME) {
        if (code == CBN_SELCHANGE) {
            update_setting_strings();
            if (id == IDC_T_LANG) {
                // 下拉里提前写好了 settings.lang，这里直接套用
                apply_lang_choice();
                if (a->stTheme) {
                    const int theme_index = a->settings.theme == "dark" ? 1 : a->settings.theme == "light" ? 2 : 0;
                    SendMessageW(a->stTheme, CB_SETCURSEL, theme_index, 0);
                }
            } else if (id == IDC_T_THEME) {
                apply_theme_choice();
            }
            save_settings_silent();
            InvalidateRect(a->window, nullptr, FALSE);
        }
        return;
    }

    if (id == IDC_K_LIST && code == LBN_SELCHANGE) {
        InvalidateRect(a->keyList, nullptr, FALSE);
        return;
    }
}

LRESULT CALLBACK list_subclass(HWND control, UINT message, WPARAM wparam, LPARAM lparam, UINT_PTR, DWORD_PTR) {
    App *a = g_app;
    if (!a) return DefSubclassProc(control, message, wparam, lparam);

    if (message == WM_LBUTTONUP) {
        const int x = GET_X_LPARAM(lparam);
        const int y = GET_Y_LPARAM(lparam);
        const LRESULT hit = SendMessageW(control, LB_ITEMFROMPOINT, 0, MAKELPARAM(x, y));
        RECT client{};
        GetClientRect(control, &client);
        if (control == a->list && HIWORD(hit) == 0 && x > client.right - px(40)) {
            const LRESULT data = SendMessageW(control, LB_GETITEMDATA, LOWORD(hit), 0);
            if (data >= 0) remove_file_at(static_cast<size_t>(data));
            return 0;
        }
    } else if (message == WM_KEYDOWN && wparam == VK_DELETE) {
        if (control == a->list) {
            remove_selected_files();
            return 0;
        }
    }
    return DefSubclassProc(control, message, wparam, lparam);
}

LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
    App *a = g_app;
    switch (message) {
    case WM_CREATE: {
        a = new App();
        g_app = a;
        a->window = window;

        HDC screen = GetDC(nullptr);
        a->dpi = GetDeviceCaps(screen, LOGPIXELSX);
        ReleaseDC(nullptr, screen);
        if (a->dpi <= 0) a->dpi = 96;
        a->scale = g_scale > 0.0f ? g_scale : 1.0f;

        a->fontTitle = make_font(20, FW_SEMIBOLD, L"Segoe UI");
        a->fontH1 = make_font(19, FW_SEMIBOLD, L"Segoe UI");
        a->fontBody = make_font(14, FW_NORMAL, L"Segoe UI");
        a->fontSmall = make_font(12, FW_NORMAL, L"Segoe UI");
        a->fontTiny = make_font(11, FW_NORMAL, L"Segoe UI");
        a->fontButton = make_font(13, FW_SEMIBOLD, L"Segoe UI");
        a->fontMono = make_font(12, FW_NORMAL, L"Consolas");

        Settings settings;
        std::string err;
        if (!load_settings(settings, err)) append_log("读取配置失败：" + err);
        a->settings = settings;
        a->note.clear();
        a->account = widen(settings.username);
        if (!settings.key_name.empty()) {
            if (!a->account.empty()) a->account += L" · ";
            a->account += widen(settings.key_name);
        }

        apply_theme_choice();
        apply_lang_choice();
        a->status = tr("sign.ready");

        setup_controls(window);
        layout_controls();
        load_state_into_controls();
        apply_language_to_controls();
        refresh_theme_selectors();

        SendMessageW(a->list, LB_SETITEMHEIGHT, 0, px(56));
        SendMessageW(a->keyList, LB_SETITEMHEIGHT, 0, px(56));
        SetWindowSubclass(a->list, list_subclass, 1, 0);
        SetWindowSubclass(a->keyList, list_subclass, 2, 0);

        DragAcceptFiles(window, TRUE);

        if (!a->settings.api_key.empty()) {
            set_page(PAGE_SIGN);
            append_log("就绪：已载入本机保存的 Key。");
            refresh_whoami();
        } else {
            set_page(PAGE_LOGIN);
            SetFocus(a->lgServer);
        }
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
    case WM_DRAWITEM: {
        const DRAWITEMSTRUCT *item = reinterpret_cast<const DRAWITEMSTRUCT *>(lparam);
        if (!item) return TRUE;
        if (item->CtlID == IDC_S_LIST) draw_list_item(item);
        else if (item->CtlID == IDC_K_LIST) draw_key_item(item);
        else if (item->CtlID == IDC_T_TSA || item->CtlID == IDC_T_LANG || item->CtlID == IDC_T_THEME ||
                 item->CtlID == IDC_K_CRED)
            draw_combo_item(item);
        else draw_ownerdraw(item);
        return TRUE;
    }
    case WM_MEASUREITEM: {
        MEASUREITEMSTRUCT *measure = reinterpret_cast<MEASUREITEMSTRUCT *>(lparam);
        if (measure) measure->itemHeight = static_cast<UINT>(px(26));
        return TRUE;
    }
    case WM_CTLCOLORBTN: {
        HDC dc = reinterpret_cast<HDC>(wparam);
        HWND control = reinterpret_cast<HWND>(lparam);
        SetBkMode(dc, TRANSPARENT);
        return reinterpret_cast<LRESULT>(backdrop_for(control));
    }
    case WM_CTLCOLOREDIT:
    case WM_CTLCOLORSTATIC: {
        HDC dc = reinterpret_cast<HDC>(wparam);
        HWND control = reinterpret_cast<HWND>(lparam);
        SetTextColor(dc, pal().text);
        if (a && control == a->logBox) {
            SetBkColor(dc, pal().logBg);
            return reinterpret_cast<LRESULT>(a->brushLog);
        }
        SetBkColor(dc, pal().input);
        return reinterpret_cast<LRESULT>(a->brushInput);
    }
    case WM_CTLCOLORLISTBOX: {
        HDC dc = reinterpret_cast<HDC>(wparam);
        SetTextColor(dc, pal().text);
        SetBkColor(dc, pal().input);
        return reinterpret_cast<LRESULT>(a->brushInput);
    }
    case WM_COMMAND:
        handle_command(LOWORD(wparam), HIWORD(wparam));
        return 0;
    case WM_MOUSEMOVE: {
        POINT point{GET_X_LPARAM(lparam), GET_Y_LPARAM(lparam)};
        HWND child = ChildWindowFromPointEx(window, point, CWP_SKIPINVISIBLE | CWP_SKIPDISABLED);
        const int id = child ? GetDlgCtrlID(child) : 0;
        if (id != a->hot) {
            if (a->hot) {
                HWND old = GetDlgItem(window, a->hot);
                if (old) InvalidateRect(old, nullptr, TRUE);
            }
            a->hot = id;
            if (child) InvalidateRect(child, nullptr, TRUE);
        }
        TRACKMOUSEEVENT track{sizeof(track), TME_LEAVE, window, 0};
        TrackMouseEvent(&track);
        return 0;
    }
    case WM_MOUSELEAVE:
        if (a->hot) {
            HWND old = GetDlgItem(window, a->hot);
            if (old) InvalidateRect(old, nullptr, TRUE);
            a->hot = 0;
        }
        return 0;
    case WM_TIMER:
        if (wparam == TIMER_ANIM && a) {
            a->anim = (a->anim + 2) % 1000;
            InvalidateRect(window, nullptr, FALSE);
        }
        return 0;
    case WM_DROPFILES: {
        HDROP drop = reinterpret_cast<HDROP>(wparam);
        const UINT count = DragQueryFileW(drop, 0xFFFFFFFF, nullptr, 0);
        std::vector<std::string> paths;
        for (UINT i = 0; i < count; ++i) {
            wchar_t buffer[MAX_PATH * 4] = {0};
            if (DragQueryFileW(drop, i, buffer, MAX_PATH * 4)) paths.push_back(narrow(buffer));
        }
        DragFinish(drop);
        if (a->page != PAGE_SIGN) set_page(PAGE_SIGN);
        add_paths(paths);
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
    case WM_APP_FILE_STATE: {
        const size_t index = static_cast<size_t>(wparam);
        if (a && index < a->files.size()) {
            a->files[index].state = static_cast<int>(lparam);
            InvalidateRect(a->list, nullptr, FALSE);
        }
        return 0;
    }
    case WM_APP_BATCH_DONE: {
        const int ok_count = static_cast<int>(wparam);
        const int fail_count = static_cast<int>(lparam);
        wchar_t buffer[128] = {0};
        swprintf_s(buffer, tr("sign.done").c_str(), ok_count, fail_count);
        set_busy(false);
        set_status(fail_count == 0 ? 2 : 3, buffer);
        append_log(narrow(buffer));
        return 0;
    }
    case WM_APP_LOGIN_DONE: {
        auto *result = reinterpret_cast<LoginResult *>(lparam);
        // 登录成功后服务器端点：把服务器地址一并记住
        if (result && result->ok) {
            const std::string server = control_text(a->lgServer);
            if (!server.empty()) a->settings.server = server;
            a->settings.username = result->username;
        }
        apply_login_result(result);
        return 0;
    }
    case WM_APP_KEY_DONE: {
        apply_key_result(reinterpret_cast<LoginResult *>(lparam));
        return 0;
    }
    case WM_APP_WHOAMI_DONE: {
        auto *result = reinterpret_cast<WhoamiResult *>(lparam);
        if (result) {
            if (result->unauthorized) {
                // 本机保存的 Key 已失效：回到登录页重新选一把
                a->error = tr("err.expired");
                a->account.clear();
                set_page(PAGE_LOGIN); // 先切页，避免 save_settings_silent 把旧 Key 再写回去
                a->settings.api_key.clear();
                save_settings_silent();
                if (a->stKey) SetWindowTextW(a->stKey, L"");
                SetFocus(a->lgPass);
            } else if (result->ok) {
                // /v1/whoami 不带用户名，只用它刷新 Key 名（用户名来自登录时保存的配置）
                std::wstring text = widen(a->settings.username);
                if (!result->key_name.empty()) {
                    if (!text.empty()) text += L" · ";
                    text += widen(result->key_name);
                    a->settings.key_name = result->key_name;
                }
                if (!text.empty()) a->account = text;
                InvalidateRect(window, nullptr, FALSE);
            }
            delete result;
        }
        return 0;
    }
    case WM_CLOSE:
        DestroyWindow(window);
        return 0;
    case WM_DESTROY:
        if (a) {
            KillTimer(window, TIMER_ANIM);
            RemoveWindowSubclass(a->list, list_subclass, 1);
            RemoveWindowSubclass(a->keyList, list_subclass, 2);
            if (a->fontTitle) DeleteObject(a->fontTitle);
            if (a->fontH1) DeleteObject(a->fontH1);
            if (a->fontBody) DeleteObject(a->fontBody);
            if (a->fontSmall) DeleteObject(a->fontSmall);
            if (a->fontTiny) DeleteObject(a->fontTiny);
            if (a->fontButton) DeleteObject(a->fontButton);
            if (a->fontMono) DeleteObject(a->fontMono);
            if (a->brushBg) DeleteObject(a->brushBg);
            if (a->brushSide) DeleteObject(a->brushSide);
            if (a->brushCard) DeleteObject(a->brushCard);
            if (a->brushInput) DeleteObject(a->brushInput);
            if (a->brushLog) DeleteObject(a->brushLog);
            delete a;
            g_app = nullptr;
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

int gui_main(int argc, char **argv) {
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

    const int screen_width = GetSystemMetrics(SM_CXSCREEN);
    const int screen_height = GetSystemMetrics(SM_CYSCREEN);
    HWND window = CreateWindowExW(
        0, klass.lpszClassName, L"CertumSigner", WS_OVERLAPPEDWINDOW & ~WS_THICKFRAME & ~WS_MAXIMIZEBOX,
        (screen_width - window_width) / 2, (screen_height - window_height) / 2, window_width, window_height, nullptr,
        nullptr, instance, nullptr);
    if (!window) return 1;

    int corner = 2;
    DwmSetWindowAttribute(window, 33, &corner, sizeof(corner));

    ShowWindow(window, SW_SHOW);
    UpdateWindow(window);

    // 命令行带文件时直接入队（支持“打开方式 / 拖到 exe 上”）
    if (argc > 1 && g_app) {
        std::vector<std::string> paths;
        for (int i = 1; i < argc; ++i) {
            const std::string arg = argv[i] ? argv[i] : "";
            if (arg.empty() || arg[0] == '-') continue;
            paths.push_back(arg);
        }
        if (!paths.empty()) {
            add_paths(paths);
            if (!g_app->settings.api_key.empty()) set_page(PAGE_SIGN);
        }
    }

    MSG message;
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        // 登录页：在输入框里按回车直接登录
        if (message.message == WM_KEYDOWN && message.wParam == VK_RETURN && g_app && g_app->page == PAGE_LOGIN &&
            GetFocus() != g_app->lgLogin) {
            do_login();
            continue;
        }
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    return 0;
}

} // namespace cs
