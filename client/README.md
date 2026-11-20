# CertumSigner 客户端

C++17 写的 Certum 云签名客户端，Windows 和 Linux 都能用，CLI + GUI 双入口。
它自己算 Authenticode 摘要、自己拼 PKCS#7、自己写回 PE 的证书表——
只把「对一段哈希做 RSA 签名」这一步交给 Worker（也就是 Certum 云端 HSM）。

不想自己编译可以直接从 [Releases](https://github.com/PIKACHUIM/CertumSigner/releases)
下载正式版（`/releases/latest` 指向最新稳定版）：Windows / Linux × x64 / arm64 × GUI / CLI 共 8 个产物
（同一个可执行文件带 `--gui` 就是图形界面；CLI 构建不含 Win32 / GTK 界面）。
`client/` 每次改动合进 `main` 后会刷新 [beta 预发布](https://github.com/PIKACHUIM/CertumSigner/releases/tag/beta)，
想抢先试新功能可以用它，但不要拿去发版。

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
   用户名、密码；密码框里按回车也能提交。
2. **凭据**：Key 全部在**本机生成**，平台只存 SHA-256 哈希与前缀（`csk_xxxxxx`），
   所以明文只在这台机器上有。页面进来自动与平台同步，每张卡片显示
   `本机已保存` / `仅平台` / `平台已删除` / `当前使用` 四种状态，以及绑定的证书与每日额度。
   卡片上的按钮：`使用`（切当前 Key，不需要联网换发）、`换发`（重新生成明文、平台旧哈希作废，
   影响所有设备，先弹确认）、`删除`（只删平台记录，本机副本一并清掉，同样先确认），
   `同步` 重新拉一次平台列表（没登录会话时直接跳登录页）。
   列表下方的新建卡片填名称 + 选证书（证书下拉旁边有 `刷新证书`，重新向平台拉一次可用证书），
   本地生成后把哈希注册到平台；卡片标题会显示当前可用证书数量。
   登录后会自动挑 Key：本机保存且平台仍在的 Key 直接用（进签名页）；账号下只有一把
   就静默换发并进入；一把都没有但有可用证书时自动新建；多把且都对不上才需要手选。
3. **签名**：拖文件进窗口或点上传，队列里逐条可删，`开始签名` 批量跑，
   每行显示等待 / 签名中 / 成功 / 失败（失败行直接显示原因），签完点 `验证签名` 调 `WinVerifyTrust`。

登录换到的会话 token 与 Key 明文、偏好一起写进配置文件，下次启动直接进签名页并后台同步；
会话或 Key 失效会自动退回登录页。
把文件拖到 `certumsigner.exe` 图标上、或用「打开方式」选它，文件会直接进队列。

**设置页**：平台地址、API Key（可显示/隐藏）、摘要算法（SHA-1 / SHA-256 / SHA-384 / SHA-512
四个胶囊，**可多选**，默认只勾 SHA-256，至少保留一个）、是否加时间戳 +
内置 TSA 下拉（DigiCert / Symantec / GeoTrust / Comodo / WoSign / GlobalSign / Entrust /
GoDaddy / Certum，默认 DigiCert）、是否备份原文件、语言（中文 / English / 跟随系统）、
主题（跟随系统 / 暗色 / 亮色）、软件许可（点开是应用内的许可页，与设置页同一套卡片样式，
不是系统弹窗）、项目地址、重新登录。

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
| `server` / `api_key` | 平台地址与当前 Key 明文（本机生成，平台只有哈希） |
| `username` / `key_name` | 上次登录的账号与 Key 名，只用于界面显示 |
| `session_token` / `session_expires` | `/api/client` 会话 token 与过期时间（毫秒时间戳），用于启动后自动同步、免换发切换 Key |
| `local_keys` | 本机持有的 Key 数组：`id` / `name` / `prefix` / `credential_id` / `credential_label` / `server` / `plaintext` / `created_at` |
| `algorithms` | 要用的摘要算法数组，取值 `sha1` / `sha256` / `sha384` / `sha512`，默认 `["sha256"]`；空数组按 `["sha256"]` 处理 |
| `algorithm` | 兼容旧配置的单个算法字段，写入时取 `algorithms` 第一项；读取时只有 `algorithm` 也能用 |
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

# 一次写三种签名（同一张证书表里每种算法一条）
certumsigner sign app.exe --sha256 --sha384 --sha512
certumsigner sign app.exe --alg sha256,sha384

# SHA-1（老系统要求时；Certum EV 卡片会拒绝）
certumsigner sign legacy.dll --sha1

# 算摘要而不签名，可叠加多个算法
certumsigner hash app.exe --sha1 --sha256 --sha384 --sha512

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

### 2.1 病毒查杀（证书要求时）

管理员给证书设置了「必须扫描」后，签名前会先算**原始文件 SHA-256** 并让 Worker 按它查结果：

- **自动上传**：文件未收录时，客户端经 Worker 中转上传并轮询，完成后继续签名。
- **手动上传**：客户端直接报错并给出两个入口——打开 `https://你的域名/user/scan` 上传，或运行：

```bash
certumsigner scan app.exe
```

`scan` 会打印风险等级（报毒 + 可疑）、引擎统计与结果页链接；风险超过证书允许值时签名会被服务端拒绝（`scan_risk_too_high`）。没有开启查杀的证书不需要这一步，`sign` 行为与以前完全一致。

### 3. 校验与排查

```bash
certumsigner hash app.exe          # 打印 Authenticode 摘要（十六进制）
certumsigner verify app.exe        # Windows：WinVerifyTrust；Linux 提示用 osslsigncode
certumsigner --gui                 # 打开图形界面
```

GUI 是自绘的 Win32 界面（手写绘制，不依赖任何 UI 框架），侧边栏三个入口（签名 / 凭据 / 设置），
登录单独一页：

- 侧边栏带 logo、导航，底部是账号区（圆形首字母头像 + 用户名 + 当前 Key 名）和语言、明暗、
  退出登录三个图标按钮；它们按 `GetClientRect` 的实际高度贴底，窗口放大也跟着走，
  窗口比设计尺寸宽时内容区会整体居中。
- 登录页是居中卡片，平台地址 / 用户名 / 密码三个输入框（文字在圆角框内垂直居中），
  错误提示在按钮上方。
- 凭据页按 Key 卡片列（名称 + 状态胶囊 + 证书名 + 前缀 + 每日额度），列表下方是
  `使用` / `换发` / `删除` / `同步` 四个等宽按钮，再下面是新建卡片（名称 + 证书下拉 + `刷新证书` + 新建）；
  状态分 `本机已保存` / `仅平台` / `平台已删除` / `当前使用`。
- 签名页：虚线拖拽区、队列（自绘状态胶囊 + × 删除）、队列标题栏右侧的「跳过已有签名」
  开关（默认勾选，已有签名表的文件直接标成 `已跳过` 不再重签）、`开始签名` / `验证签名`、
  等宽字体的日志面板；签名走后台线程，界面不卡。
- 可执行文件链接成 GUI 子系统：双击不会弹出控制台黑框；从 cmd / PowerShell 调用时由
  程序自己 `AttachConsole(ATTACH_PARENT_PROCESS)` 接回父控制台，输出照常打印。
  GUI 子系统不阻塞 shell，提示符会先返回，需要在脚本里等待就用 `start /wait certumsigner.exe …`。
- 设置页用卡片分区（连接 / 签名选项 / 界面 / 关于），改完立即落盘。
- 下拉框全部自绘（`WS_POPUP` + owner-draw 列表），暗色下不会出现系统白色列表；
  列表太高会自动向上翻转并夹在显示器工作区内。
- 全部文案内置中英两套，主题有明暗两套（`auto` 读系统的 `AppsUseLightTheme`），
  窗口按显示器 DPI 缩放（125% / 150% 下布局一致）。

### 中文路径 / 含空格路径

`D:\下载\测试目录\签名 副本.exe` 这类路径在 CLI 和 GUI 下都支持：命令行参数用
`CommandLineToArgvW` 取宽字符再转 UTF-8，文件读写走 `std::filesystem::u8path`，
不会按系统代码页（GBK）解释而打不开文件。

## 签名流程（和 signtool 的差别）

```
文件 ──（证书要求查杀时）原始 SHA-256 ──► /v1/scan/check / upload / analysis
  │
  └──Authenticode 摘要(SHA1/SHA256/SHA384/SHA512)──►  SpcIndirectDataContent
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

- 摘要算法、SignerInfo 里的摘要算法、证书里的签名算法三者保持一致（SHA-1 / SHA-256 / SHA-384 /
  SHA-512）。OID 与摘要长度集中在 `src/digest.*`，PE 摘要、PKCS#7、SPC 都从那里取值。
- 勾选多个算法时，每个算法各算一次摘要、各请求一次云端、各取一次时间戳、各生成一个 PKCS#7，
  最后**一次性**写进同一张证书表（多个 `WIN_CERTIFICATE` 顺序排列）。
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
- 病毒查杀按原始文件 SHA-256：VirusTotal 免费版单文件直传 32 MB，更大的文件需先在 `scan`/网页之外的渠道上传；自动扫描受服务商免费配额限制，首次扫描通常要等 1–2 分钟。

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
| `--skip-signed` | 已经有签名的文件直接跳过（图形界面默认勾选） |
| 自检拦截 | 服务器返回不匹配的签名时报「云端签名与证书/摘要不匹配」并拒绝写入 |
| 错误路径 | 非 PE 文件、空文件、连接失败（WinHTTP 12029）、缺 API Key 都有明确中文提示 |
| 中文 + 空格路径 | `hash` / `sign` / `verify` 对 `D:\下载\测试目录\签名 副本.exe` 均正常（摘要 `27264aac…79ec`） |
| Win32 GUI | 125% DPI 下 1043×1062 窗口，1025×1015 客户区，逐像素核对无裁切；自绘按钮无系统灰边 |

未实测：GUI 交互。Linux（libcurl + GTK3）在 GitHub Actions 上已真实编译通过（run `44295635910`，
四个平台任务全部 success），但没有在 Linux 桌面上实际运行过。

真实 Certum 云端（2026-11，同一台 Windows x64 机器）：

| 项 | 结果 |
| --- | --- |
| `cert`（经本地 Worker） | EV 代码签名证书正常解析，SHA-256 `9c4944b9…64b1`，卡片序列号正确 |
| `sign`（真实 SHA-256 云端签名） | 自检通过，`signify` 解析出 1 个嵌入式签名 |
| `certumsigner verify` | **`签名有效`**（Certum EV 根链被 Windows 信任） |
| 篡改 1 字节 | `0x80096010` 摘要与签名不符 |
| 真实 Certum 时间戳 | 令牌写入 `unsignedAttrs` 后仍 `签名有效` |
| `sign`（`--sha1`） | 云端拒绝：`digest.algorithm.error`，Worker 映射为「EV 证书通常只签 SHA256 / SHA384 / SHA512，SHA1 会被拒绝」 |

注意：本机装了腾讯 iOA，未签名的 `certumsigner.exe` 直连 `time.certum.pl` 会被拦（HTTP 403，
响应体提示“检测到风险软件的网络连接”），与签名逻辑无关；把 exe 加白名单或改用可访问的时间戳源即可。

新版 GUI 的实测记录（同一台机器，`wrangler dev` 本地 Worker）：

| 项 | 结果 |
| --- | --- |
| 登录 | 正确密码进入选 Key 页；错密码/缺字段显示错误提示；密码框回车可提交 |
| 选 Key | 卡片显示 `alice-cli` 与每日额度；换发前弹确认框，换发后弹窗显示新明文并落盘 |
| 批量签名 | 命令行带 3 个文件参数启动，队列 3 条，全部 `成功`，日志含 DigiCert 时间戳 |
| 验证 | `WinVerifyTrust` 返回 `签名有效`，日志列出文件名 |
| 设置页 | 摘要算法、TSA 下拉（默认 DigiCert）、备份开关、语言、主题切换均即时生效并写盘 |
| 界面 | 明/暗 × 中/英 逐屏截图核对，125% 缩放下无裁切、无控件重叠 |
| 重新登录 | 清空会话与当前 Key、回到登录页，配置文件里 `api_key` 变空；`local_keys` 里其它 Key 的明文保留 |

1.2 的密钥页重做（本地生成、与平台同步、删除）只有代码与接口层验证
（Worker `npm test` 57 项、MSVC 语法检查），GUI 侧仍需在真机上逐项点一遍再发版。

摘要算法多选的验证（2026-11，`wrangler dev` 本地 Worker + 真实 Certum 凭据）：

| 项 | 结果 |
| --- | --- |
| `POST /v1/sign`，`sha384` + 96 位十六进制 | `ok:true`、`algorithm:"sha384"` |
| `sha384` + 64 位十六进制 | `bad_hash`：「第 1 个摘要长度 64，SHA384 要求 96 位十六进制」 |
| `sha512` + 128 位 / 64 位 | 前者 `ok:true`，后者 `bad_hash`（要求 128） |
| `sha256` + 64 位 | `ok:true` |
| 返回的签名 | 用 Python `cryptography` 的 `Prehashed` 分别验 SHA256 / SHA384 / SHA512，三种都与对应 DigestInfo 匹配 |
| `sha1` | 云端 `digest.algorithm.error` → `digest_algorithm_unsupported` |
| 写法容错 | `sha-384`、`SHA512`、`sha_256` 都能识别（去 `-`/`_` 转小写后匹配） |

未验证：多种摘要算法合并后的实际校验结果。现在的写法是「第一个算法写进证书表，其余算法作为
嵌套签名（`SPC_NESTED_SIGNATURE`，`1.3.6.1.4.1.311.2.4.1`）放进外层签名的未认证属性」——
`WinVerifyTrust` 只读证书表里的第一条记录，所以不能把多份 PKCS#7 并排写进证书表（旧写法还有一个
`dwLength` 只写低字节的 bug，签名超过 255 字节就会被当成截断数据）。本机缺 OpenSSL 开发包，
`pe.cpp` / `pkcs7.cpp` 编不出可执行文件；需要把 CI 产物下载到 Windows 上跑一遍签名与 `signtool verify`。

## 许可

[AGPL-3.0-or-later](../LICENSE)（© 2026 pikachuren）。
