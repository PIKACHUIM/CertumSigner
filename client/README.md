# CertumSigner 客户端

C++17 写的 Certum 云签名客户端，Windows 和 Linux 都能用，CLI + GUI 双入口。
它自己算 Authenticode 摘要、自己拼 PKCS#7、自己写回 PE 的证书表——
只把「对一段哈希做 RSA 签名」这一步交给 Worker（也就是 Certum 云端 HSM）。

## 依赖

| 平台 | 依赖 |
| --- | --- |
| Windows | Visual Studio 2019+（C++ 工作负载）、OpenSSL 3.x（vcpkg 或自建静态库）；HTTP 用系统自带 WinHTTP，GUI 用 Win32 |
| Linux | `cmake`、`g++`、`libssl-dev`、`libcurl4-openssl-dev`、`libgtk-3-dev`（不要 GUI 可省） |

## 构建

### Windows

CMake 会带 `UNICODE`/`_UNICODE`/`/utf-8` 等必要定义，源码里的中文提示和 `IDC_ARROW` 之类
的宏都依赖它们；用自己写的构建脚本时别漏。

OpenSSL 有两条路：

**1) vcpkg**

```powershell
vcpkg install openssl:x64-windows
cmake -B build -S . -DCMAKE_TOOLCHAIN_FILE=C:\vcpkg\scripts\buildsystems\vcpkg.cmake
cmake --build build --config Release
# 产物：build\Release\certumsigner.exe
```

**2) 自建静态 OpenSSL**（本项目实测走的就是这条：MSVC 14.44 + Windows SDK 10.0.22621 + OpenSSL 3.5.9）

```powershell
# 在 OpenSSL 源码目录里（需要 Strawberry Perl 在 PATH 里）
perl Configure VC-WIN64A no-shared no-asm no-tests no-docs --prefix=D:\openssl
nmake                # 并行可用 jom -j16
nmake install_dev    # 只装头文件和库

cmake -B build -S . -A x64 -DOPENSSL_ROOT_DIR=D:\openssl -DOPENSSL_USE_STATIC_LIBS=TRUE
cmake --build build --config Release
```

静态链接 OpenSSL 时注意运行库要一致：OpenSSL 的 `makefile` 里 `LIB_CFLAGS` 默认是 `/MT`，
CMake 默认 `/MD`，混链会报 `LNK2038 mismatch detected for 'RuntimeLibrary'`。
要么把 `LIB_CFLAGS` 的 `/MT` 改成 `/MD`，要么给客户端加
`-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded`。`/Zi` 会让多个 `cl.exe` 抢同一个 `.pdb`，
并行编译时去掉它或加 `/FS`。

不需要 GUI：

```powershell
cmake -B build -S . -DCS_BUILD_GUI=OFF -DOPENSSL_ROOT_DIR=D:\openssl -DOPENSSL_USE_STATIC_LIBS=TRUE
```

### Linux

```bash
sudo apt install build-essential cmake libssl-dev libcurl4-openssl-dev libgtk-3-dev
cmake -B build -S . -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
sudo cmake --install build
```

## 使用

### 0. 图形界面（Windows / Linux）

双击 `certumsigner.exe`（等价于 `certumsigner --gui`）打开图形界面，第一次用走三步：

1. **登录**：填平台地址（你的 Worker 域名，例如 `https://certum.example.workers.dev`）、
   用户名、口令；口令框里按回车也能提交。
2. **选择 API Key**：列出账号下的 Key（带每日额度）。选已有 Key 会**换发新明文**、
   旧值立即失效（点之前会先确认）；也可以填名称 + 选证书直接新建一把。
3. **签名**：拖文件进窗口或点上传，队列里逐条可删，`开始签名` 批量跑，
   每行显示等待 / 签名中 / 成功 / 失败，签完点 `验证签名` 调 `WinVerifyTrust`。

登录后的 Key 与偏好写进配置文件，下次启动直接进签名页；Key 失效会自动退回登录页。
把文件拖到 `certumsigner.exe` 图标上、或用「打开方式」选它，文件会直接进队列。

**设置页**：平台地址、API Key（可显示/隐藏）、SHA-256/SHA-1、是否加时间戳 +
内置 TSA 下拉（DigiCert / Symantec / GeoTrust / Comodo / WoSign / GlobalSign / Entrust /
GoDaddy / Certum，默认 DigiCert）、是否备份原文件、语言（中文 / English / 跟随系统）、
主题（跟随系统 / 暗色 / 亮色）、软件许可、项目地址、重新登录。

### 1. 配置（只做一次）

```bash
certumsigner config --server https://sign.example.com --api-key csk_xxxxxxxx
```

配置写到：

- Windows：`%APPDATA%\CertumSigner\config.json`
- Linux：`$XDG_CONFIG_HOME/certumsigner/config.json` 或 `~/.config/certumsigner/config.json`

环境变量 `CERTUM_SIGNER_SERVER` / `CERTUM_SIGNER_API_KEY` 优先级更高，适合 CI。

配置文件字段（GUI 和 CLI 共用一份）：

| 字段 | 说明 |
| --- | --- |
| `server` / `api_key` | 平台地址与 API Key |
| `username` / `key_name` | 上次登录的账号与 Key 名，只用于界面显示 |
| `algorithm` | `sha256`（默认）或 `sha1` |
| `timestamp` | 是否加 RFC3161 时间戳，默认 `true` |
| `tsa_name` | 内置 TSA 名字，默认 `DigiCert` |
| `tsa_url` | 自定义 TSA 地址，非空时优先于 `tsa_name`（也支持 `worker` / `auto`） |
| `backup` | 是否留一份 `.orig` 备份，默认 `false` |
| `lang` | `zh` / `en`；空 = 跟随系统 |
| `theme` | `auto` / `dark` / `light` |

### 2. 签名

```bash
# 单文件，SHA-256 + 时间戳
certumsigner sign app.exe

# SHA-1（老系统要求时）
certumsigner sign legacy.dll --sha1

# 整个目录递归，跳过确认
certumsigner sign dist/ --recursive --yes

# 离线/无时间戳；保留原文件
certumsigner sign app.exe --no-timestamp --backup

# 看会用什么证书
certumsigner cert
```

时间戳（RFC3161）默认连 `http://time.certum.pl/`：

```bash
certumsigner config --tsa http://timestamp.digicert.com   # 记住一个替代 TSA
certumsigner sign app.exe --tsa http://timestamp.digicert.com   # 只本次生效
certumsigner sign app.exe --tsa worker                    # 强制走 Worker 的 /v1/timestamp
```

直连 TSA 失败时（企业网安全软件常返回 403「检测到风险软件的网络连接」），客户端会**自动**
改走 Worker 的 `/v1/timestamp` 再试一次，日志里会写明切换原因；只有两条路都失败才降级成
不带时间戳的签名。TSA 地址的优先级是：`--tsa` > `CERTUM_SIGNER_TSA` > 配置文件 `tsa_url` >
内置 `tsa_name`（默认 DigiCert）。

### 3. 校验与排查

```bash
certumsigner hash app.exe          # 打印 Authenticode 摘要（十六进制）
certumsigner verify app.exe        # Windows：WinVerifyTrust；Linux 提示用 osslsigncode
certumsigner --gui                 # 打开图形界面
```

GUI 是自绘的 Win32 界面（手写绘制，不依赖任何 UI 框架），侧边栏两页（签名 / 设置），
登录与选 Key 各占一页：

- 侧边栏带 logo、导航、底部语言（中文 / EN）与主题按钮；账号名显示在左下角。
- 登录页是居中卡片，平台地址 / 用户名 / 口令三个输入框，错误提示在按钮上方。
- 选 Key 页用自绘列表（名称 + 前缀 + 每日额度），下面是新建区（名称 + 证书下拉）。
- 签名页：虚线拖拽区、队列（自绘状态胶囊 + × 删除）、`开始签名` / `验证签名`、
  等宽字体的日志面板；签名走后台线程，界面不卡。
- 设置页用卡片分区（连接 / 签名选项 / 界面 / 关于），改完立即落盘。
- 全部文案内置中英两套，主题有明暗两套（`auto` 读系统的 `AppsUseLightTheme`），
  窗口按显示器 DPI 缩放（125% / 150% 下布局一致）。

### 中文路径 / 含空格路径

`D:\下载\测试目录\签名 副本.exe` 这类路径在 CLI 和 GUI 下都支持：命令行参数用
`CommandLineToArgvW` 取宽字符再转 UTF-8，文件读写走 `std::filesystem::u8path`，
不会按系统代码页（GBK）解释而打不开文件。

## 签名流程（和 signtool 的差别）

```
文件 ──Authenticode 摘要(SHA1/SHA256)──►  SpcIndirectDataContent
                                              │
                        ┌─────────────────────┴──────────────┐
                        │ 组装 authenticatedAttributes       │
                        │ （contentType + messageDigest）    │
                        └─────────────────────┬──────────────┘
                                              │ 对 attrs 求哈希
                                              ▼
                                   POST /v1/sign  → 云端 HSM
                                              │ 返回 RSA 签名
                                              ▼
             PKCS#7（含证书链，可选 RFC3161 时间戳）→ 写入 PE 证书表
```

几点实现约定：

- 摘要算法、SignerInfo 里的摘要算法、证书里的签名算法三者保持一致（SHA-1 或 SHA-256）。
- PKCS#7 用**老式**结构：`eContent` 是 `SpcIndirectDataContent` 本身，不是 OCTET STRING 包装。
  这也是为什么没有用 OpenSSL 的 CMS API，而是自己拼 DER。
- 云端返回签名后，本地会先用证书公钥验一遍（`EVP_DigestVerify`），
  确认「签名确实对应这段 attributes」才写进文件——防止摘要错位或证书对不上。
- 时间戳走 `http://time.certum.pl/`（RFC 3161）。时间戳失败只警告，不阻断签名。
- 重复签名会先把旧的证书表截掉再写新的，不会越签越大。

## 限制

- 只处理 PE 文件（`.exe/.dll/.sys/.ocx/...`）。MSI、CAB、PowerShell 脚本不在范围内。
- 签名会改动文件，请自行保证构建产物可重写；`--backup` 可留一份 `.orig`。
- MSVC 默认 `/MD` 构建出的 exe 依赖 `MSVCP140.dll` / `VCRUNTIME140.dll`（VC++ 2015-2022 运行库）。
  要单文件分发就静态链接 CRT（`-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded`），
  此时 OpenSSL 也得用 `/MT` 编。
- Linux 上无法用 `WinVerifyTrust` 校验，请用 `osslsigncode verify` 或回 Windows 用 `signtool verify /pa`。
- SHA-1 摘要对真实 Certum EV 卡片会被云端拒绝（`digest.algorithm.error`），实际只能用 SHA-256；
  客户端会原样显示 Worker 返回的原因。

## 实测记录（2026-11，Windows x64）

编译：MSVC 14.44.35207 + Windows SDK 10.0.22621 + 静态 OpenSSL 3.5.9，
`/W4 /permissive- /utf-8` 下 14 个源文件零告警，CLI 与 Win32 GUI 均链接成 `certumsigner.exe`。

签名链路用本地模拟签名服务验证（自签 RSA-2048 证书 + 真实 PKCS#1 v1.5 签名，不碰 Certum 云端）：

| 项 | 结果 |
| --- | --- |
| `hash`（SHA-256 / SHA-1） | 与 `signify` 独立实现逐字节一致（`notepad.exe`：`27264aac…79ec` / `479352d4…`） |
| `cert` | 正确解析主题、有效期、SHA-256 指纹 |
| `sign`（SHA-256 / SHA-1） | 自检通过、写回证书表，`signify` 解析出 1 个嵌入式签名 |
| `signify` 验签 | 摘要与签名均通过，只报自签证书 `CERTIFICATE_ERROR`（符合预期） |
| 篡改文件 1 字节后 `signify` 验签 | `INVALID_DIGEST`，说明签名确实绑定了内容 |
| `certumsigner verify` | `WinVerifyTrust` 返回 `0x800B0109`（仅证书链不受信，非无签名/摘要错误） |
| 真实 RFC 3161 时间戳 | `http://time.certum.pl/` 请求成功，令牌写入 `unsignedAttrs` |
| 时间戳被拦 → 代理回退 | 直连 TSA 失败时自动改走 Worker `/v1/timestamp`，时间戳写入后 `WinVerifyTrust` 仍为 `签名有效` |
| 重复签名 | 旧证书表被替换，仍只有 1 个签名，体积不膨胀 |
| 目录批量 / `--recursive` / `--yes` | 只处理 PE 扩展名，含子目录，逐个自检通过 |
| `--backup` | 生成 `<文件>.orig`，内容为签名前原件 |
| 自检拦截 | 服务器返回不匹配的签名时报「云端签名与证书/摘要不匹配」并拒绝写入 |
| 错误路径 | 非 PE 文件、空文件、连接失败（WinHTTP 12029）、缺 API Key 都有明确中文提示 |
| 中文 + 空格路径 | `hash` / `sign` / `verify` 对 `D:\下载\测试目录\签名 副本.exe` 均正常（摘要 `27264aac…79ec`） |
| Win32 GUI | 125% DPI 下 1043×1062 窗口，1025×1015 客户区，逐像素核对无裁切；自绘按钮无系统灰边 |

未实测：Linux（libcurl + GTK3）构建、GUI 交互。

真实 Certum 云端（2026-11，同一台 Windows x64 机器）：

| 项 | 结果 |
| --- | --- |
| `cert`（经本地 Worker） | EV 代码签名证书正常解析，SHA-256 `9c4944b9…64b1`，卡片序列号正确 |
| `sign`（真实 SHA-256 云端签名） | 自检通过，`signify` 解析出 1 个嵌入式签名 |
| `certumsigner verify` | **`签名有效`**（Certum EV 根链被 Windows 信任） |
| 篡改 1 字节 | `0x80096010` 摘要与签名不符 |
| 真实 Certum 时间戳 | 令牌写入 `unsignedAttrs` 后仍 `签名有效` |
| `sign`（`--sha1`） | 云端拒绝：`digest.algorithm.error`，Worker 映射为「这张证书只能签 SHA256」 |

注意：本机装了腾讯 iOA，未签名的 `certumsigner.exe` 直连 `time.certum.pl` 会被拦（HTTP 403，
响应体提示“检测到风险软件的网络连接”），与签名逻辑无关；把 exe 加白名单或改用可访问的时间戳源即可。

新版 GUI 的实测记录（同一台机器，`wrangler dev` 本地 Worker）：

| 项 | 结果 |
| --- | --- |
| 登录 | 正确口令进入选 Key 页；错口令/缺字段显示错误提示；口令框回车可提交 |
| 选 Key | 列表显示 `alice-cli` 与每日额度；换发前弹确认框，换发后弹窗显示新明文并落盘 |
| 批量签名 | 命令行带 3 个文件参数启动，队列 3 条，全部 `成功`，日志含 DigiCert 时间戳 |
| 验证 | `WinVerifyTrust` 返回 `签名有效`，日志列出文件名 |
| 设置页 | SHA-256/SHA-1、TSA 下拉（默认 DigiCert）、备份开关、语言、主题切换均即时生效并写盘 |
| 界面 | 明/暗 × 中/英 逐屏截图核对，125% 缩放下无裁切、无控件重叠 |
| 重新登录 | 清空本地 Key、回到登录页，配置文件里 `api_key` 变空 |

## 许可

[GNU Affero General Public License v3.0](../LICENSE)（AGPL-3.0）。
