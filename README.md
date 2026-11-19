<div align="center">
  <img src="docs/assets/logo.svg" width="112" height="112" alt="logo" />

  <p><em>把 Certum SimplySign 云签名变成 HTTP 接口，再用一个 C++ 客户端给自己的 PE 文件做 Authenticode 签名</em></p>
  <p>私钥始终留在 Certum 云端 —— 本机不装 SimplySign Desktop，也不需要 signtool</p>
  <p>云端跑在 Cloudflare Workers（Hono + KV），客户端是 C++17：Windows Win32 GUI / Linux GTK3 GUI + CLI</p>

<a href="LICENSE"><img src="https://img.shields.io/github/license/PIKACHUIM/CertumSigner?color=blue" alt="License" /></a>
<a href="https://github.com/PIKACHUIM/CertumSigner/releases"><img src="https://img.shields.io/github/v/release/PIKACHUIM/CertumSigner?include_prereleases&sort=date&label=release" alt="Release" /></a>
<a href="https://github.com/PIKACHUIM/CertumSigner/actions/workflows/beta.yml"><img src="https://img.shields.io/github/actions/workflow/status/PIKACHUIM/CertumSigner/beta.yml?branch=main&label=client%20build" alt="Client build" /></a>
<a href="https://github.com/PIKACHUIM/CertumSigner/stargazers"><img src="https://img.shields.io/github/stars/PIKACHUIM/CertumSigner?color=%23ED8936&logo=github" alt="Stars" /></a>
<a href="https://github.com/PIKACHUIM/CertumSigner/forks"><img src="https://img.shields.io/github/forks/PIKACHUIM/CertumSigner?color=%239F7AEA&logo=github" alt="Forks" /></a>

[English](README.en.md) | 简体中文

[客户端下载](https://github.com/PIKACHUIM/CertumSigner/releases) · [快速部署](#一键部署) · [接口说明](#api) · [客户端文档](client/README.md) · [许可证](LICENSE)

</div>

---

## 一键部署

<div align="center">

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/PIKACHUIM/CertumSigner/tree/main/worker)

</div>

> [!IMPORTANT]
> - 先 **Fork** 本仓库再点按钮：部署按钮会直接读仓库里的 `worker/wrangler.jsonc`，其中的 KV id 与 `sign.example.com` 是作者的实例。
> - Fork 后把 `kv_namespaces[0].id` 换成自己 `wrangler kv namespace create CERTUM_KV` 得到的 id，`routes` 改成自己的域名（整段删掉则用 `*.workers.dev`）。
> - 首次打开 `/admin` 会进入**初始化页**：设置管理员用户名与密码，提交后自动登录控制台。账号与密码只以 PBKDF2 哈希存在 KV，会话密钥在初始化时自动生成，**不需要**手动设 secret。
> - 未初始化之前，谁先打开 `/admin` 谁就能建管理员账号，所以部署完请立刻完成初始化。

日常更新（不重新点按钮）：

```bash
cd worker
npm install
npx wrangler deploy
```

## 功能简介

Certum SimplySign 只提供「对一段摘要做 RSA 签名」的能力，签名工具（signtool）跑在装了 SimplySign Desktop 的 Windows 上，而且要人工填一次动态口令。本项目把这段链路整个搬到云端：Worker 用邮箱 + TOTP 登录 Certum，拿到卡片和证书，再把「签名」包装成一个带 Bearer Key 的接口；客户端自己算 Authenticode 摘要、自己拼 PKCS#7、自己写回 PE 的证书表。

```
┌──────────────────────┐  ① 邮箱 + TOTP 自动登录（CAS/OAuth2）
│ Cloudflare Worker    │───────────────► cloudsign.webnotarius.pl
│ Hono + KV            │  ② 取卡片 / 证书，token 按凭据缓存 30 分钟
│                      │  ③ POST 摘要 → 云端 HSM 返回 RSA 签名
└───┬───────────┬──────┘
    │           │  Bearer csk_xxx（每把 Key 绑定一套凭据）
    │           ▼
    │   ┌────────────────────┐  Authenticode 摘要 → 请求签名 → 拼 PKCS#7 → 写回 PE
    │   │ C++ 客户端         │  Windows：自绘 Win32 GUI / Linux：GTK3 GUI
    │   └────────────────────┘
    │
    ├── /        主页：功能介绍 + 客户端下载
    ├── /admin   管理员后台：概览、用户、凭据、Key、记录、系统设置
    └── /user    用户门户：登录后自建 Key、看用量与调用记录
```

### 云端（Worker）

- **多套 Certum 凭据**：邮箱 + TOTP 种子 + 证书 SHA-1 指纹作为一条「凭据」存在 KV，可同时挂多套（不同账号 / 不同卡片），各自独立缓存登录会话与卡片信息。
- **按哈希代理签名**：`POST /v1/sign` 传一条或一批摘要，`algorithm` 支持 SHA-1 / SHA-256 / SHA-384 / SHA-512，一次云端调用最多 16 条。
- **管理员后台**（`/admin`）：请求量 / 成功失败 / 算法分布 / 近 7 天曲线 / 最近签名；用户、凭据、Key 的增删改与停用；完整签名记录（每条可看时间、Key、凭据、摘要前缀、结果、耗时、IP、UA 与错误）。
- **用户门户**（`/user`）：邮箱 + 密码登录，从管理员分配的证书里挑一套自建 Key，改名称与每日限额，查看自己的调用记录。明文只在创建后显示一次，列表里默认只露前几位。
- **限额**：Key 级与用户级每日额度同时生效（0 = 不限），`/v1/sign` 在调用云端前就返回 `429 quota_exceeded`。
- **注册 / 找回密码**（默认关闭）：注册必须完成邮箱验证才能登录，找回密码通过 Resend 发送一次性链接（1 小时有效）。
- **登录验证码**（默认关闭）：勾选后用户、管理员与桌面客户端登录都要验证码，类型可选 4 位数字图形码或 Cloudflare Turnstile（密钥没填齐时自动退回图形码）。
- **界面**：服务端渲染，无前端构建；侧边栏固定六项，右上角切换语言（中 / 英）、明暗（跟随系统 / 暗 / 亮）、四套主题，选择写进 cookie。

### 桌面客户端

- **一条命令签完**：`certumsigner sign app.exe`，默认 SHA-256 + RFC3161 时间戳。
- **多算法**：SHA-1 / SHA-256 / SHA-384 / SHA-512 可多选，第一个算法写进证书表，其余以嵌套签名（`SPC_NESTED_SIGNATURE`）挂在同一条记录里。
- **自己拼 PKCS#7**：不依赖 signtool，`/v1/sign` 之外的一切都在本地完成；签名前用证书公钥自检，签完可 `verify`。
- **图形界面**：Windows 是自绘 Win32（双击不弹控制台），Linux 是 GTK3；拖文件进窗口即可批量签名，实时状态胶囊，可跳过已有签名的文件。
- **时间戳兜底**：直连 TSA 被企业安全软件拦掉时，自动改走 Worker 的 `/v1/timestamp` 转发。
- **中英双语 + 明暗主题**，中文与含空格路径完整支持。

## 客户端

不想自己编译就直接下载：Windows / Linux × x64 / arm64 × GUI / CLI 共 8 个产物，全部由 GitHub Actions 构建。

| 平台 \ 架构 | x64 | arm64 |
| --- | --- | --- |
| Windows（GUI / CLI） | [下载](https://github.com/PIKACHUIM/CertumSigner/releases/latest/download/certumsigner-windows-x64-gui.zip) · [CLI](https://github.com/PIKACHUIM/CertumSigner/releases/latest/download/certumsigner-windows-x64-cli.zip) | [下载](https://github.com/PIKACHUIM/CertumSigner/releases/latest/download/certumsigner-windows-arm64-gui.zip) · [CLI](https://github.com/PIKACHUIM/CertumSigner/releases/latest/download/certumsigner-windows-arm64-cli.zip) |
| Linux（GTK3 / CLI） | [下载](https://github.com/PIKACHUIM/CertumSigner/releases/latest/download/certumsigner-linux-x64-gui.tar.gz) · [CLI](https://github.com/PIKACHUIM/CertumSigner/releases/latest/download/certumsigner-linux-x64-cli.tar.gz) | [下载](https://github.com/PIKACHUIM/CertumSigner/releases/latest/download/certumsigner-linux-arm64-gui.tar.gz) · [CLI](https://github.com/PIKACHUIM/CertumSigner/releases/latest/download/certumsigner-linux-arm64-cli.tar.gz) |

链接指向**最新正式版**；想试每次客户端改动的最新构建，去 [`beta` 预发布](https://github.com/PIKACHUIM/CertumSigner/releases/tag/beta)。Windows 产物静态链接 OpenSSL，解压即用。

### 图形界面三步

Windows 是自绘 Win32 程序，侧边栏四个入口走完整个流程：

```
登录 ──► 签名 ⇄ 凭据 ⇄ 设置
```

1. **登录**：填平台地址（你的 Worker 域名）、邮箱、密码，回车即可提交。
2. **凭据**：列出账号下的 Key（含每日额度），选一把会**换发新明文**（旧值立即失效，点之前先确认）；也可以填名称、选证书直接新建一把。登录后会自动挑 Key：本机已保存的 Key 还在就直接进签名页，账号下只有一把就静默换发，一把都没有但有可用证书时自动新建。
3. **签名**：拖文件进窗口或点上传，队列里逐条可删、可批量签，每行显示等待 / 签名中 / 成功 / 失败 / 已跳过；签完点 `验证签名`（Windows 走 `WinVerifyTrust`）。

设置页分四块：连接（平台地址、API Key）、签名选项（算法多选、时间戳、内置 TSA、是否备份原文件）、界面（语言 / 主题）、关于（应用内 AGPL 许可页、项目地址、重新登录）。配置写在 `%APPDATA%\CertumSigner\config.json`，下次启动直接进签名页。

### 命令行

```bash
# 配置（只做一次）
certumsigner config --server https://sign.example.com --api-key csk_xxx

# 签名
certumsigner sign dist/app.exe                    # SHA-256 + 时间戳
certumsigner sign dist/ --recursive --yes         # 整个目录
certumsigner sign app.exe --sha256 --sha384       # 同一文件写多份签名
certumsigner sign legacy.dll --sha1               # 老系统要求时（EV 卡片会拒绝）
certumsigner sign app.exe --no-timestamp --backup # 不加时间戳、保留原文件

# 校验与排查
certumsigner hash app.exe                         # 打印 Authenticode 摘要
certumsigner verify app.exe                       # Windows：WinVerifyTrust
certumsigner --gui                                # 打开图形界面
```

环境变量 `CERTUM_SIGNER_SERVER` / `CERTUM_SIGNER_API_KEY` 优先于配置文件，适合 CI。完整参数、配置字段与构建步骤见 [`client/README.md`](client/README.md)。

## 手动部署

<details>
<summary>展开查看前置要求、本地开发与多实例部署</summary>

### 前置要求

- Node.js 18+（`wrangler` 4.x 需要）
- 一个 Cloudflare 账号，一个 KV namespace

### 本地开发

```bash
cd worker
npm install
npx wrangler kv namespace create CERTUM_KV   # 把返回的 id 填进 wrangler.jsonc
npm run dev                                  # http://127.0.0.1:8787
npm test                                     # TOTP / multipart / 编码 / KV 存储 / 管理员账号
npm run typecheck
```

首次打开 `http://127.0.0.1:8787/admin` 会进初始化页。要用发信（注册 / 找回密码）时，在后台「系统设置 → 邮箱与发信」里填 Resend 的 API Key 与发件人即可，不必设 secret。

### 生产部署

```bash
cd worker
npx wrangler deploy
# 打开 https://<你的域名>/admin 完成初始化
```

自定义域名在 `worker/wrangler.jsonc` 的 `routes` 里改；部署后把同一个地址填进「系统设置 → 邮箱与发信 → 基础地址」，邮件里的链接就会用它。

### 多实例

同一份代码可以开多套完全隔离的实例（不同 Worker、不同 KV、不同域名），各建一份配置即可。仓库里带了一个例子 `worker/wrangler.signui.jsonc`（`signui-work` / `signui-kvdb` / `signui.example.com`）：

```bash
cd worker
npx wrangler kv namespace create signui-kvdb       # 新 id 填进新配置
npx wrangler deploy --config wrangler.signui.jsonc
```

两套实例的 KV 完全隔离，管理员账号、凭据、Key 都不共享；首次访问新域名同样会进 `/admin/setup`。

</details>

## 部署配置

Worker 只认一个可选 secret，其余全部在后台「系统设置」里改，存 KV、保存即生效：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `SESSION_SECRET` | secret（可选） | 会话 cookie 的 HMAC 密钥；不设则用初始化时生成并存进 KV 的随机值 |
| `CERTUM_KV` | KV 绑定 | 账号、凭据、Key、会话、统计与运行时配置都存这里 |

后台可改的运行时配置：

| 分组 | 项目 |
| --- | --- |
| 账号自助 | 登录需要验证码（关 / 4 位数字图形码 / Cloudflare Turnstile + Site Key / Secret Key）、开放自助注册、开放找回密码 |
| 邮箱与发信 | 基础地址（邮件链接用）、发件人、Resend API Key、发信前是否需要验证码、邮件服务状态 |
| 服务与地址 | Certum API 根地址、TSA 上游、中间证书 PEM、是否记录签名明细 |

## 技术架构

| 层 | 实现 |
| --- | --- |
| 运行时 | Cloudflare Workers（也支持 `wrangler dev` 本地跑） |
| Web 框架 | Hono 4 + TypeScript |
| 存储 | KV（`CERTUM_KV`）：用户、凭据、Key、会话、统计、运行时配置、验证码 |
| 页面 | 服务端渲染 + 原生 `<dialog>`，无前端构建步骤 |
| 客户端 | C++17 / CMake，WinHTTP（Windows）与 libcurl（Linux），Win32 自绘 GUI 与 GTK3 GUI |
| 密码学 | OpenSSL 3（客户端），PBKDF2-HMAC-SHA256 与 WebCrypto（Worker） |

```
worker/        Cloudflare Worker：管理后台 + 用户门户 + 签名 API
client/        C++17 客户端：CLI + Win32 / GTK3 GUI
docs/          Certum 云签名协议逆向记录
```

## API

鉴权：`Authorization: Bearer csk_…`（也接受 `X-Api-Key`）。Key 绑定的凭据决定用哪张证书。

### `POST /v1/sign`

```bash
curl -X POST https://sign.example.com/v1/sign \
  -H "Authorization: Bearer csk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"hash":"<64 位 SHA-256 十六进制>","algorithm":"sha256"}'
```

批量（一次云端调用，最多 16 条）：

```json
{"hashes": ["<hash1>", "<hash2>"], "algorithm": "sha256", "encoding": "hex"}
```

`algorithm` 取 `sha256`（默认）/ `sha1` / `sha384` / `sha512`，也接受 `sha-256`、`SHA256` 之类写法；摘要长度分别要求 64 / 40 / 96 / 128 位十六进制，长度不符返回 `bad_hash`，取值不认识返回 `bad_algorithm`。

成功响应：

```json
{
  "ok": true,
  "algorithm": "sha256",
  "signatures": ["<1024 位十六进制，RSA-4096 签名>"],
  "certificate": {
    "pem": "-----BEGIN CERTIFICATE-----\n...",
    "chain": [],
    "serial": "<卡片序列号>",
    "fingerprint256": "<证书 DER 的 SHA-256>"
  },
  "credential": { "id": "cred_xxx", "label": "…", "email": "…" },
  "meta": { "keyId": "...", "keyName": "CI", "count": 1, "durationMs": 842, "requestId": "..." }
}
```

失败响应统一为 `{"ok":false,"error":{"code":"...","message":"..."}}`：`bad_hash` / `bad_algorithm` / `unauthorized` / `quota_exceeded` / `credential_missing` / `credential_disabled` / `digest_algorithm_unsupported` / `task_failed` / `signature_missing` 等。

### 桌面客户端接口

| 接口 | 说明 |
| --- | --- |
| `POST /api/client/login` | 邮箱 + 密码换会话 token，同时返回可用的 Key 与证书列表；也接受旧客户端的 `username` 字段；开启登录验证码时需额外带 `captchaId` + `captcha`（固定数字图形码） |
| `GET /api/client/captcha` | 取一张 4 位数字图形验证码（`id` + `svg` + `dataUrl`） |
| `GET /api/client/session` | 校验 token 是否还有效 |
| `POST /api/client/logout` | 注销当前 token |
| `GET /api/client/keys` | 列出账号下的 Key |
| `POST /api/client/keys` | 新建 Key（返回明文，只此一次） |
| `POST /api/client/keys/:id/reveal` | 为已有 Key 换发新明文，旧值立即失效 |

### 其它

| 接口 | 说明 |
| --- | --- |
| `GET /v1/certificate` | 当前凭据的签名证书 PEM + 可选证书链 |
| `GET /v1/whoami` | 当前 Key 的归属用户、Key 限额 / 用户限额、今日用量、绑定凭据 |
| `GET /v1/stats` | 全局统计 + 自己与账号的用量 |
| `POST /v1/timestamp` | RFC3161 时间戳代理：请求体是 TSQ，返回 TSR |
| `GET /captcha` | 生成一次性图形验证码（`{id, svg}`，5 分钟有效） |
| `GET /prefs?lang=&mode=&theme=&back=` | 切换界面语言 / 明暗 / 主题，写 cookie 后 302 回 `back` |
| `GET /health` | 探活（不触发云端请求） |

管理后台 JSON 统计：`GET /admin/api/stats`（需管理员登录）。

### 时间戳被拦怎么办

企业网里的安全软件（实测腾讯 iOA）会拦未签名程序的出网请求，客户端直连 TSA 会拿到 HTTP 403 + `检测到风险软件的网络连接`。客户端的处理是：直连失败就自动改走 `POST /v1/timestamp`（带同一个 Bearer Key），由 Worker 转发到 TSA 上游。想强制走代理可以 `--tsa worker`。

## 发布与版本

| 触发 | 结果 |
| --- | --- |
| 推 `v*` tag（如 `v1.0`） | 构建 8 个产物，发布带版本号的正式 Release，并设为 Latest |
| `client/` 或 `LICENSE` 合进 `main` | 自动构建并刷新 [`beta`](https://github.com/PIKACHUIM/CertumSigner/releases/tag/beta) 预发布（不算 Latest） |
| Actions 里手动运行 `Release` | 用输入的 tag 名发布正式版 |

```bash
git tag v1.0 && git push origin v1.0        # 发正式版
```

早期的滚动 `latest` release 已下线：主页与 README 里的 `/releases/latest` 会自动跟随最新**正式版**，`beta` 是预发布，不会顶掉它。构建流程在 `.github/workflows/build-clients.yml`（可复用），发布入口分别是 `release.yml` 与 `beta.yml`。

## 安全设计

- **OTP 种子存在 KV 的凭据记录里**，客户端拿不到，也不参与签名；KV 是静态加密的，但能读这个 namespace 的 API Token 就能读到明文，生产环境请把 Token 权限收紧到单个 namespace。
- **API Key 只存 SHA-256 哈希**，明文只在创建后显示一次（5 分钟后自动删除）；`/reveal` 是「删旧哈希、发新值」，旧值立刻失效。Key 绑定 `userId` + `credentialId`，停用用户或凭据都会立即失效。
- **密码**用 PBKDF2-HMAC-SHA256（1 万次迭代）加盐存储，用户与管理员同一套；会话记在 KV 里可吊销，写操作校验 CSRF，登录失败按 IP 限速。
  迭代次数固定 1 万次：Workers 对 PBKDF2 的硬上限是 10 万次，而免费版只有 10ms CPU，1 万次约 2~3ms。改动该常量等于让所有已存密码失效。
- **签名接口不放任任何字节**：摘要长度必须精确匹配算法，单次最多 16 条，云端返回的签名会在客户端用证书公钥验一遍再写文件。

## 已知限制

- 统计用 KV 读-改-写实现，**高并发时会丢计数**；要精确计数请换 Durable Object。
- 打开后台或凭据页会按需触发 Certum 登录（未登录时最多重试 3 次 OTP），凭据错误时会有几次失败请求。
- `SHA1` 摘要对 Certum EV 卡片会被云端拒绝，`/v1/sign` 返回 `digest_algorithm_unsupported`；要签老系统兼容的 SHA-1 只能换一张支持它的证书。
- 只签 PE 文件（`.exe/.dll/.sys/.ocx` 等），不支持 MSI / CAB / 脚本。
- Workers 有子请求数限制：一次签名通常 3~8 个请求，批量签名请控制在十几条摘要内。
- 注册 / 找回密码默认关闭；没配 Resend 时只能由管理员在用户详情页重置密码。

## 验证状态

<details>
<summary>展开查看实测记录</summary>

- Worker：`npx tsc --noEmit` 通过，`npm test` 39 项通过（TOTP 命中 RFC 6238 向量、multipart 解析、编码 / 哈希、KV 存储与密码哈希、用户邮箱唯一性、管理员账号初始化与改密码、运行时配置保存回读）。
- 真实 Certum 链路已跑通（2026-11，Windows x64）：邮箱 + TOTP 登录成功，`/v1/certificate` 返回 EV 代码签名证书，`/v1/sign` 用真实 SHA-256 摘要换回 512 字节签名，写进 PE 后 `WinVerifyTrust` 返回**签名有效**；加真实 Certum 时间戳后仍有效。
- 界面：四套主题 × 明暗、中英切换、弹窗、900px 与手机宽度（390 / 563px）逐页核对无横向滚动；登录验证码刷新与校验、系统设置持久化、用户级配额、用户自助改 Key 限额均实测。
- 客户端：MSVC 14.44 + Windows SDK 10.0.22621 + 静态 OpenSSL 3.5.9 以 `/W4 /permissive-` 零告警编译；Win32 GUI 走通登录 → 换发 Key → 拖拽批量签名 → `WinVerifyTrust` 校验；125% 缩放下布局不裁切。
- GitHub Actions：4 个平台任务全部 success，8 个产物文件名与主页下载链接一致。Linux GTK3 GUI 在 CI 上真实编译通过，运行时交互未逐一实测。

</details>

## 帮助支持

- 遇到 Bug 或想要新功能：去 [Issues](https://github.com/PIKACHUIM/CertumSigner/issues)
- 使用问题、部署经验：去 [Discussions](https://github.com/PIKACHUIM/CertumSigner/discussions)（没有就开一个）
- Certum 云端协议细节：见 [`docs/certum-api.md`](docs/certum-api.md)

## 开源许可

本项目基于 [AGPL-3.0-or-later](LICENSE) 发布（© 2026 pikachuren）。客户端「设置 → 软件许可」打开的是应用内许可页，正文是 AGPL-3.0 声明，并给出[官方全文](https://www.gnu.org/licenses/agpl-3.0.txt)与仓库源码地址。

## 致谢

- [Certum SimplySign](https://www.certum.pl/) 提供云端签名能力
- [Hono](https://hono.dev/) / [Cloudflare Workers](https://workers.cloudflare.com/) 提供运行时与框架
- [OpenSSL](https://www.openssl.org/)、[libcurl](https://curl.se/libcurl/)、[GTK](https://www.gtk.org/) 支撑客户端
