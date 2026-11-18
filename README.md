# CertumSigner

**中文** · [English](README.en.md)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/PIKACHUIM/CertumSigner/tree/main/worker)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange.svg)](https://workers.cloudflare.com/)

用 Cloudflare Workers 把 Certum SimplySign 云签名变成 HTTP 接口，再配一个 C++ 桌面客户端，
让 Windows / Linux 都能给自己的 PE 文件做 Authenticode 签名——**私钥始终在 Certum 云端，
本机不装 SimplySign Desktop，也不需要 signtool**。

项目地址：<https://github.com/PIKACHUIM/CertumSigner>

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
    ├── /admin  管理员后台：概览、用户、凭据、Key（另含全部记录页）
    └── /user   用户门户：登录后自己建 Key、看用量与调用记录
```

## 目录

```
worker/        Cloudflare Worker（Hono + KV），管理后台 + 用户门户 + 签名 API
client/        C++17 客户端（Windows/Linux，CLI + GUI，CMake）
docs/          Certum 云签名协议逆向记录
```

## 一键部署

点上面的 **Deploy to Cloudflare Workers** 按钮，按提示授权并创建 KV，然后只需要设两个 secret：

| Secret | 说明 |
| --- | --- |
| `ADMIN_PASSWORD` | `/admin` 登录口令 |
| `SESSION_SECRET` | cookie 的 HMAC 密钥，随便 32+ 位随机串 |

部署完成后打开 `https://<你的域名>/admin`：

1. **凭据** → 「新建凭据」：填标签、Certum 邮箱、TOTP 种子（`otpauth://` URI 或裸 Base32），
   需要选卡片时再填证书 SHA-1；保存后点「登录测试」验证邮箱 + 口令能换到 token。
2. **用户** → 新建用户：设口令（PBKDF2-SHA256）、有效期（留空 = 永久）、勾选可用凭据。
3. 用户访问 `/user` 自己建 Key；管理员也可以在 **Key** 页面替用户建。

## 能做什么

- **多套 Certum 凭据**：邮箱 + TOTP 种子 + 证书 SHA-1 指纹作为一条「凭据」存在 KV，
  可以同时挂多套（不同账号/不同卡片），各自独立缓存登录会话与卡片信息。
- **管理员后台**（`/admin`）：
  - 概览：请求量、成功/失败、按算法分布、近 7 天曲线、最近签名（每条可看详情）。
  - 用户：弹窗新建/编辑用户，设置有效期、可用的证书（多选），可停用/删除。
  - 凭据：弹窗新增/编辑（标签、邮箱、TOTP 种子、证书指纹），启用/停用、强制重新登录、刷新证书、
    从环境变量一次性导入。
  - Key：查看全部 Key 的归属用户、绑定凭据、用量，可停用/删除。
  - 记录：`/admin/logs` 是完整明细页（侧边栏不放入口，从概览的「查看全部记录」进入），
    每条都能打开弹窗看时间、Key、凭据、摘要前缀、结果、耗时、IP、UA 与错误信息。
- **用户门户**（`/user`）：用户名口令登录后，从管理员分配给自己的证书里选一套自建 API Key
  （明文只在创建后显示一次，5 分钟过期），随时停用/删除，并查看自己的调用记录（同样有详情弹窗）。
- **界面偏好**：侧边栏固定四项——系统概览 / 签名用户 / 证书凭据 / 认证密钥。
  右上角三个下拉分别切语言（中文 / English）、明暗（跟随系统 / 暗色 / 亮色）、
  主题（极光 / 星云 / 青碧 / 石墨），首次访问按浏览器的 `Accept-Language` 与
  `prefers-color-scheme` 决定，选择结果写进 cookie（`cs_lang` / `cs_mode` / `cs_theme`，一年有效）。
  全部服务端渲染，弹窗用原生 `<dialog>`，没有前端构建步骤。
- **按哈希代理签名**：`POST /v1/sign` 传一条或一批 SHA-1/SHA-256 摘要，返回 RSA 签名；
  支持单次最多 16 个摘要（云端一次调用签完）。
- **客户端**：C++ 自己算 Authenticode 摘要、自己拼 PKCS#7、自己写 PE 证书表；
  带 RFC3161 时间戳，签名前会用证书公钥自检，签完可以先 `verify`。

## 客户端

Windows 是一个自绘 Win32 程序，三页走完整个流程：

```
登录 ──► 选择 / 新建 API Key ──► 签名
                                  └─ 设置（随时可回）
```

1. **登录**：填平台地址（你的 Worker 域名）、用户名、口令。口令框里按回车也能提交。
2. **选择 API Key**：列出账号下已有的 Key（含每日额度），选一把就会**换发新明文**
   （旧值立即失效，界面上会先确认）；也可以填名称、选证书，直接新建一把。
3. **签名**：拖文件进窗口或点上传，队列里可以逐条删除/清空，一次勾选批量签名；
   每行有等待 / 签名中 / 成功 / 失败状态胶囊，签完可以 `验证签名`（`WinVerifyTrust`）。
4. **设置**：
   - 连接：平台地址、API Key（可显示/隐藏）、当前账号与 Key 名。
   - 签名选项：SHA-256 / SHA-1、是否加时间戳、内置 TSA（DigiCert / Symantec / GeoTrust /
     Comodo / WoSign / GlobalSign / Entrust / GoDaddy / Certum，默认 **DigiCert**）、是否备份原文件。
   - 界面：语言（中文 / English / 跟随系统）、主题（跟随系统 / 暗色 / 亮色）。
   - 关于：软件许可（AGPL-3.0）、项目地址、重新登录。

登录后 API Key 与偏好写在 `%APPDATA%\CertumSigner\config.json`，下次启动直接进签名页；
Key 失效时会自动退回登录页。把文件拖到 `certumsigner.exe` 上、或在「打开方式」里选它，
也会直接带进队列。

命令行用法与构建步骤见 [`client/README.md`](client/README.md)。

```bash
certumsigner config --server https://sign.example.com --api-key csk_xxx
certumsigner sign dist/app.exe
certumsigner sign dist/ --recursive --yes --sha256
certumsigner --gui
```

中文/含空格路径（例如 `D:\下载\签名 副本.exe`）在 CLI 和 GUI 下都已支持。

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
{"hashes": ["<hash1>", "<hash2>"], "algorithm": "sha1", "encoding": "hex"}
```

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

失败响应统一为 `{"ok":false,"error":{"code":"...","message":"..."}}`：
`bad_hash` / `bad_algorithm` / `unauthorized` / `quota_exceeded` / `credential_missing` /
`credential_disabled` / `digest_algorithm_unsupported` / `task_failed` / `signature_missing` 等。

### 桌面客户端登录接口

| 接口 | 说明 |
| --- | --- |
| `POST /api/client/login` | 用户名 + 口令换会话 token，同时返回可用的 Key 与证书列表 |
| `GET /api/client/session` | 校验 token 是否还有效 |
| `POST /api/client/logout` | 注销当前 token |
| `GET /api/client/keys` | 列出账号下的 Key |
| `POST /api/client/keys` | 新建 Key（返回明文，只此一次） |
| `POST /api/client/keys/:id/reveal` | 为已有 Key 换发新明文，旧值立即失效 |

### 其它

| 接口 | 说明 |
| --- | --- |
| `GET /v1/certificate` | 当前凭据的签名证书 PEM + 可选证书链 |
| `GET /v1/whoami` | 当前 Key 的归属用户、限额、今日用量、绑定凭据 |
| `GET /v1/stats` | 全局统计 + 自己的用量 |
| `POST /v1/timestamp` | RFC3161 时间戳代理：请求体是 TSQ，返回 TSR（客户端出网被拦时用） |
| `GET /prefs?lang=&mode=&theme=&back=` | 切换界面语言/明暗/主题，写 cookie 后 302 回 `back`（只接受站内相对路径） |
| `GET /health` | 探活（不触发云端请求） |

管理后台 JSON 统计：`GET /admin/api/stats`（需管理员登录）。

### 时间戳被拦怎么办

企业网里的安全软件（实测腾讯 iOA）会拦未签名程序的出网请求，客户端直连 TSA 会拿到
HTTP 403 + `检测到风险软件的网络连接`。客户端的处理是：直连失败就自动改走
`POST /v1/timestamp`（即 `http(s)://<你的域名>/v1/timestamp`，带同一个 Bearer Key），
由 Worker 转发到 `TSA_UPSTREAM`。想强制走代理可以 `--tsa worker`。

## 本地开发

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars   # ADMIN_PASSWORD / SESSION_SECRET / 可选的 CERTUM_* 导入用
npx wrangler kv namespace create CERTUM_KV   # 把返回的 id 填进 wrangler.jsonc
npm run dev                      # http://127.0.0.1:8787
npm test                         # TOTP / multipart / 编码 / KV 存储的单元测试
npm run typecheck
```

手工部署（不用一键按钮）：

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npm run deploy
```

## 环境变量

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `ADMIN_PASSWORD` | secret | `/admin` 登录密码（必填） |
| `SESSION_SECRET` | secret | cookie 的 HMAC 密钥，不填则退回用 `ADMIN_PASSWORD` |
| `CERTUM_EMAIL` | var | 仅用于「从环境变量导入」凭据 |
| `CERTUM_OTP_URI` | secret | 同上，`otpauth://` URI（优先） |
| `CERTUM_OTP_SECRET` | secret | 同上，不给 URI 时直接给 Base32 种子 |
| `CERTUM_CERTIFICATE_SHA1` | var | 同上，导入时写入凭据的证书指纹 |
| `CERTUM_API_BASE` | var | 默认 `https://cloudsign.webnotarius.pl` |
| `CERTUM_CHAIN_PEM` | var | 可选，中间证书 PEM（多张用换行分隔），随证书一起返回给客户端 |
| `LOG_SIGNATURES` | var | 设 `0` 关闭签名明细日志（只留统计） |
| `TSA_UPSTREAM` | var | `/v1/timestamp` 转发的 RFC3161 服务，默认 `http://time.certum.pl/` |

正常运行时登录用的邮箱和种子来自 KV 里的凭据，`CERTUM_*` 不再是必需品。

## 安全设计

- **OTP 种子存在 KV 的凭据记录里**，客户端拿不到，也不参与签名；KV 是静态加密的，
  但能读这个 namespace 的 API Token 就能读到明文，生产环境请把 Token 权限收紧到单个 KV namespace。
- **API Key 只存哈希**（SHA-256），明文只在创建后显示一次，5 分钟后自动删除；
  换发明文（`/reveal`）也是「删旧哈希、发新值」，旧值立刻失效。
  Key 绑定 `userId` + `credentialId`，停用用户或停用凭据都会立即让 Key 失效。
- **用户口令**用 PBKDF2-SHA256（15 万次）加盐存储；用户会话 7 天，管理员会话 12 小时，
  都记在 KV 里可吊销，写操作校验 CSRF，登录失败按 IP 限速（10 分钟 8 次，
  客户端登录接口 8 次/10 分钟）。
- 签名接口不放任任何字节：摘要长度必须精确匹配算法（40 / 64 位十六进制），
  单次最多 16 条，可选每 Key 每日限额。
- 云端返回的签名在客户端本地会用证书公钥验一遍再写文件，防止摘要错位。

## 已知限制

- 统计用 KV 读-改-写实现，**高并发时会丢计数**；要精确计数请换成 Durable Object。
- 打开后台或凭据页会按需触发 Certum 登录（未登录时最多重试 3 次 OTP），凭据错误时会有几次失败请求。
- `SHA1` 摘要对 Certum EV 卡片会被云端拒绝（`digest.algorithm.error`），实际只能用 `SHA256`；
  `/v1/sign` 会返回 `digest_algorithm_unsupported`。
- 只签 PE 文件（`.exe/.dll/.sys/.ocx` 等），不支持 MSI / CAB / 脚本。
- Workers 有子请求数限制：一次签名通常 3~8 个请求，批量签名请控制在十几条摘要内。
- 没有「忘记口令」流程：用户口令丢了只能由管理员在用户详情页重置。

## 验证状态

- Worker：`npx tsc --noEmit` 通过；`npm test` 21 项通过（TOTP 命中 RFC 6238 向量、
  multipart 解析、编码/哈希、KV 存储与口令哈希）。
- `wrangler dev` 下逐条实测：管理员登录、概览、用户新建/改口令/改有效期/停用/启用、
  凭据新建（含中文标签）/编辑/停用/启用/删除/强制登录/刷新证书、Key 创建（明文只显示一次）/
  停用/删除、日志页、统计 JSON；用户登录、门户、自建 Key（必须选已分配证书）、
  停用后 `/v1/whoami` 立即 401、删除后 401、用户日志只含自己的记录。
- 客户端接口实测：登录（正确/错误口令/缺字段）、会话校验、新建 Key、`reveal` 换发明文、
  token 失效返回 401。
- 界面逐项实测：四套主题 × 明暗切换、`/prefs` 写 cookie 后 302 回原页、中英文切换
  （含登录失败、CSRF、表单校验等提示）、新建/编辑弹窗、记录详情弹窗、
  900px 与手机宽度下侧边栏不换行错位、页面无横向滚动。
- C++ 客户端：MSVC 14.44 + Windows SDK 10.0.22621 + 静态 OpenSSL 3.5.9 编译通过
  （`/W4 /permissive-` 零告警）；CLI 与 Win32 GUI 都链接成可执行文件。
- Win32 GUI 实测：登录 → 选 Key（换发明文弹窗）→ 拖拽批量签名 3 个文件全部成功 →
  `WinVerifyTrust` 校验通过 → 设置页 TSA / 算法 / 备份 / 语言（中英）/ 主题（明暗）切换 →
  重新登录、许可弹窗；125% 缩放下布局无裁切；暗色与英文界面逐屏截图核对。
- **真实 Certum 链路已跑通**（2026-11，Windows x64）：邮箱 + TOTP 登录成功；
  `/v1/certificate` 返回 EV 代码签名证书，指纹与凭据配置一致（卡片 `7507400891785917`）；
  `/v1/sign` 用真实 SHA-256 摘要换回 512 字节签名，客户端写进 PE 后
  `WinVerifyTrust` 返回 **`签名有效`**；加真实 Certum 时间戳后仍然有效。
- Linux（libcurl + GTK3）构建与 GUI 交互仍未实测；MSI/CAB 不支持。

## 许可

[GNU Affero General Public License v3.0](LICENSE)（AGPL-3.0）。

这是一个网络服务程序：如果你修改后把它作为服务提供给他人使用，必须同时提供修改后的源码。
