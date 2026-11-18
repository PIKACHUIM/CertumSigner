# CertumSigner

**中文** · [English](README.en.md)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/PIKACHUIM/CertumSigner/tree/main/worker)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
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
    ├── /        主页：功能介绍 + 客户端下载（登录入口默认指向 /user/login）
    ├── /admin  管理员后台：概览、用户、凭据、Key、系统设置（另含全部记录页）
    └── /user   用户门户：登录后自己建 Key、看用量与调用记录
```

## 目录

```
worker/        Cloudflare Worker（Hono + KV），管理后台 + 用户门户 + 签名 API
client/        C++17 客户端（Windows/Linux，CLI + GUI，CMake）
docs/          Certum 云签名协议逆向记录
```

## 一键部署

点上面的 **Deploy to Cloudflare Workers** 按钮，按提示授权并创建 KV。部署完成后打开
`https://<你的域名>/admin`，会直接进入**初始化页**：设置管理员用户名与口令，提交后自动登录控制台。
账号存在 KV 里，口令只保存 PBKDF2 哈希；会话密钥在初始化时自动生成，不需要再手动设 secret。

想显式指定会话密钥时再设一个 secret（可选，不设就用初始化时生成的值）：

| Secret | 说明 |
| --- | --- |
| `SESSION_SECRET` | 可选，会话 cookie 的 HMAC 密钥 |

需要「注册 / 找回密码」时再配置邮件（可选，不配置则这两个开关不可用）：

| 名称 | 说明 |
| --- | --- |
| `RESEND_API_KEY` | secret，Resend 的 API Key |
| 发件人 | 在后台「系统设置 → 服务与地址」填，例如 `CertumSigner <noreply@example.com>` |

自定义域名在 `worker/wrangler.jsonc` 的 `routes` 里改（本仓库写的是 `sign.example.com`），
部署后把同一个地址填进「系统设置 → 基础地址」，邮件里的链接就会用它。

部署完成后打开 `https://<你的域名>/`：

1. 主页可以直接下载 Windows / Linux 客户端，右上角进入用户登录或管理员后台。
2. 首次使用进 `/admin`：**凭据** → 「新建凭据」：填标签、Certum 邮箱、TOTP 种子
   （`otpauth://` URI 或裸 Base32），需要选卡片时再填证书 SHA-1；保存后点「登录测试」。
3. **用户** → 新建用户：填邮箱（就是登录名）和口令（PBKDF2-SHA256），再按需设有效期
   （留空 = 永久）、用户级每日限额与可用凭据。邮箱全局唯一，没有再单独的用户名字段。
4. **系统设置**：先在「服务与地址」填基础地址（邮件链接用，例如 `https://sign.example.com`）、
   Certum API、TSA、发件人、中间证书 PEM、是否记录签名明细；下面再按需开启登录图形验证码、
   自助注册、找回密码、发信验证码。这些值存在 KV，保存即生效，不必改 `wrangler.jsonc` 或重部署。
5. 用户访问 `/user/login` 登录后自己建 Key；管理员也可以在 **Key** 页面替用户建。

## 能做什么

- **多套 Certum 凭据**：邮箱 + TOTP 种子 + 证书 SHA-1 指纹作为一条「凭据」存在 KV，
  可以同时挂多套（不同账号/不同卡片），各自独立缓存登录会话与卡片信息。
- **管理员后台**（`/admin`）：
  - 概览：请求量、成功/失败、按算法分布、近 7 天曲线、最近签名（每条可看详情）。
  - 用户：弹窗新建/编辑用户，设置有效期、用户级每日限额、邮箱与可用证书（多选），可停用/删除。
  - 凭据：弹窗新增/编辑（标签、邮箱、TOTP 种子、证书指纹），启用/停用、强制重新登录、刷新证书。
  - Key：查看全部 Key 的归属用户、绑定凭据、用量，可停用/删除。
  - 记录：`/admin/logs` 是完整明细页（侧边栏有「签名记录」入口，概览的「查看全部记录」也能进），
    每条都能打开弹窗看时间、Key、凭据、摘要前缀、结果、耗时、IP、UA 与错误信息。
  - 设置：`/admin/settings` 控制登录图形验证码、自助注册、找回密码、发信验证码，并显示邮件服务状态。
- **主页**（`/`）：产品介绍 + Windows / Linux × x64 / arm64 × GUI / CLI 客户端下载，
  文件由 GitHub Actions 构建并发布到 latest release。
- **用户门户**（`/user`）：邮箱 + 口令登录后，从管理员分配给自己的证书里选一套自建 API Key
  （明文只在创建后显示一次，5 分钟过期），随时调整每把 Key 的每日限额、停用/删除，
  并查看自己的调用记录（同样有详情弹窗）。
- **限额**：Key 级与用户级每日额度同时生效（0 = 不限）；用户可自设 Key 限额，
  管理员可调整该账号名下所有 Key 合计的用户级限额。`/v1/sign` 在调用云端前就返回
  `429 quota_exceeded`。
- **注册 / 找回密码**（默认关闭）：可在系统设置里开启；注册必须完成邮箱验证才能登录，
  找回密码通过 Resend 发送一次性链接（1 小时有效）。两个流程都可以额外要求图形验证码。
- **登录验证码**：系统设置里可开关，用户与管理员登录共用；验证码是服务端生成的 SVG，
  一次性使用，5 分钟过期。
- **界面偏好**：侧边栏固定六项——系统概览 / 签名用户 / 证书凭据 / 认证密钥 / 签名记录 / 系统设置。
  右上角三个下拉分别切语言（中文 / English）、明暗（跟随系统 / 暗色 / 亮色）、
  主题（极光 / 星云 / 青碧 / 石墨），首次访问按浏览器的 `Accept-Language` 与
  `prefers-color-scheme` 决定，选择结果写进 cookie（`cs_lang` / `cs_mode` / `cs_theme`，一年有效）。
  全部服务端渲染，弹窗用原生 `<dialog>`，没有前端构建步骤。
- **按哈希代理签名**：`POST /v1/sign` 传一条或一批摘要，`algorithm` 支持 SHA-1 / SHA-256 /
  SHA-384 / SHA-512；返回对应算法的 RSA 签名；
  支持单次最多 16 个摘要（云端一次调用签完）。
- **客户端**：C++ 自己算 Authenticode 摘要、自己拼 PKCS#7、自己写 PE 证书表；
  摘要算法可多选并用一份文件写多份签名；带 RFC3161 时间戳，签名前会用证书公钥自检，
  签完可以先 `verify`。

## 客户端

Windows 是一个自绘 Win32 程序，侧边栏四个入口走完整个流程：

```
登录 ──► 签名 ⇄ 凭据 ⇄ 设置
          （登录后自动进签名页，需要时再去凭据页换 Key）
```

1. **登录**：填平台地址（你的 Worker 域名）、邮箱、口令。口令框里按回车也能提交。
2. **凭据**：列出账号下已有的 Key（含每日额度），选一把就会**换发新明文**
   （旧值立即失效，界面上会先确认）；也可以填名称、选证书，直接新建一把。
   登录后会自动挑 Key：本机已保存的 Key 仍然存在就直接进签名页，账号下只有一把 Key
   就自动换发并进入（不弹确认），一把都没有但有可用证书时自动新建，
   只有多把 Key 且都对不上本机记录时才需要手选。
3. **签名**：拖文件进窗口或点上传，队列里可以逐条删除/清空，一次勾选批量签名；
   每行有等待 / 签名中 / 成功 / 失败状态胶囊，签完可以 `验证签名`（`WinVerifyTrust`）。
4. **设置**：
   - 连接：平台地址、API Key（可显示/隐藏）、当前账号与 Key 名。
   - 签名选项：摘要算法 **可多选**（SHA-1 / SHA-256 / SHA-384 / SHA-512，默认只勾 SHA-256，
     每种算法各生成一份签名写进同一张证书表）、是否加时间戳、内置 TSA（DigiCert / Symantec /
     GeoTrust / Comodo / WoSign / GlobalSign / Entrust / GoDaddy / Certum，默认 **DigiCert**）、
     是否备份原文件。
   - 界面：语言（中文 / English / 跟随系统）、主题（跟随系统 / 暗色 / 亮色）。
   - 关于：软件许可（MIT，点开是应用内的许可页，不是弹窗）、项目地址、重新登录。

侧边栏底部是账号区：圆形头像（邮箱首字母）+ 邮箱 + 当前 Key 名，下面是语言、明暗、退出登录
三个图标按钮，位置跟着窗口实际高度贴底（下拉框同样是自绘的，暗色下不会出现白色原生列表）。

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
{"hashes": ["<hash1>", "<hash2>"], "algorithm": "sha256", "encoding": "hex"}
```

`algorithm` 取 `sha256`（默认）/ `sha1` / `sha384` / `sha512`，也接受 `sha-256`、`SHA256` 之类写法；
摘要长度分别要求 64 / 40 / 96 / 128 位十六进制，长度不符返回 `bad_hash`，取值不认识返回
`bad_algorithm`。

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
| `POST /api/client/login` | 邮箱 + 口令换会话 token，同时返回可用的 Key 与证书列表；请求体也接受旧客户端用的 `username` 字段 |
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
| `POST /v1/timestamp` | RFC3161 时间戳代理：请求体是 TSQ，返回 TSR（客户端出网被拦时用） |
| `GET /captcha` | 生成一次性图形验证码（`{id, svg}`，5 分钟有效） |
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
cp .dev.vars.example .dev.vars   # 可选：本地要用发信等功能时再填
npx wrangler kv namespace create CERTUM_KV   # 把返回的 id 填进 wrangler.jsonc
npm run dev                      # http://127.0.0.1:8787 ，首次打开 /admin 进初始化页
npm test                         # TOTP / multipart / 编码 / KV 存储 / 管理员账号的单元测试
npm run typecheck
```

手工部署（不用一键按钮）：

```bash
npm run deploy
# 打开 https://<你的域名>/admin ，按提示创建管理员账号
npx wrangler secret put RESEND_API_KEY   # 可选，开启注册/找回密码时再配
```


推 `v*` tag 或手动运行 `.github/workflows/release.yml`，会构建 Windows / Linux × x64 / arm64
的 GUI 与 CLI 共 8 个产物，并发布到 tag 为 `latest` 的 release；主页下载链接直接指向这些文件。

## 环境变量

只保留两个可选 secret；其余配置全部在后台「系统设置 → 服务与地址」里改（存 KV）：

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `SESSION_SECRET` | secret | 可选，会话 cookie 的 HMAC 密钥；不设则用初始化时生成并存 KV 的随机值 |
| `RESEND_API_KEY` | secret | 可选，Resend 发信 Key；不填则注册 / 找回密码不可用 |

后台可改的运行时配置：基础地址、Certum API 根地址、TSA 上游、Resend 发件人、中间证书 PEM、
签名明细日志开关。`wrangler.jsonc` 里没有 `vars`，登录用的邮箱与 TOTP 种子来自 KV 里的凭据。

## 安全设计

- **OTP 种子存在 KV 的凭据记录里**，客户端拿不到，也不参与签名；KV 是静态加密的，
  但能读这个 namespace 的 API Token 就能读到明文，生产环境请把 Token 权限收紧到单个 KV namespace。
- **API Key 只存哈希**（SHA-256），明文只在创建后显示一次，5 分钟后自动删除；
  换发明文（`/reveal`）也是「删旧哈希、发新值」，旧值立刻失效。
  Key 绑定 `userId` + `credentialId`，停用用户或停用凭据都会立即让 Key 失效。
- **用户口令**用 PBKDF2-HMAC-SHA256（1 万次迭代）加盐存储；**管理员账号**同样只存 PBKDF2 哈希
  （口令至少 10 位），会话 7 天 / 12 小时，都记在 KV 里可吊销，写操作校验 CSRF，
  登录失败按 IP 限速（10 分钟 8 次，客户端登录接口 8 次/10 分钟）。
  迭代次数固定 1 万次：Workers 运行时对 PBKDF2 的硬上限是 10 万次（超了直接抛
  `iteration counts above 100000 are not supported`），而免费版只有 10ms CPU，
  1 万次约 2~3ms，10 万次约 23ms。哈希里记录了迭代次数，但校验只认 1 万次，
  不匹配一律当作口令错误（不做旧格式兼容）；改动该常量等于让所有已存口令失效。
  管理员账号建好后 `/admin/setup` 会自动关闭；**未初始化之前谁先打开 `/admin` 谁就能建账号**，
  所以部署完请立刻完成初始化。
- 签名接口不放任任何字节：摘要长度必须精确匹配算法（40 / 64 / 96 / 128 位十六进制），
  单次最多 16 条，Key 级与用户级每日限额同时生效。
- 云端返回的签名在客户端本地会用证书公钥验一遍再写文件，防止摘要错位。

## 已知限制

- 统计用 KV 读-改-写实现，**高并发时会丢计数**；要精确计数请换成 Durable Object。
- 打开后台或凭据页会按需触发 Certum 登录（未登录时最多重试 3 次 OTP），凭据错误时会有几次失败请求。
- `SHA1` 摘要对 Certum EV 卡片会被云端拒绝（`digest.algorithm.error`），`/v1/sign` 返回
  `digest_algorithm_unsupported`；实测可用的是 `SHA256` / `SHA384` / `SHA512`，要签老系统兼容的
  SHA-1 只能换一张支持它的证书。
- 只签 PE 文件（`.exe/.dll/.sys/.ocx` 等），不支持 MSI / CAB / 脚本。
- Workers 有子请求数限制：一次签名通常 3~8 个请求，批量签名请控制在十几条摘要内。
- 注册 / 找回密码默认关闭；没配 Resend 时只能由管理员在用户详情页重置口令。
- Windows arm64 与 Linux 客户端的构建由 CI 完成，本机未逐一验证运行效果。

## 验证状态

- Worker：`npx tsc --noEmit` 通过；`npm test` 39 项通过（TOTP 命中 RFC 6238 向量、
  multipart 解析、编码/哈希、KV 存储与口令哈希（含 10 万次迭代上限守卫、不兼容旧迭代次数）、
  用户邮箱唯一性与改邮箱重建索引、管理员账号初始化/改口令、运行时配置的默认值/保存与回读）。
- 新增功能实测（`wrangler dev`，2026-11）：主页下载区、双栏登录页与图形验证码
  （错误验证码 401 且换图、刷新按钮换 id、口令显示/隐藏）、系统设置开关持久化、
  注册在未配置 Resend 时给出明确错误、邮箱验证令牌（未验证登录 401 → 验证后登录 302）、
  找回密码重置后旧口令 401 / 新口令 302、用户级配额（用量 5 / 上限 1 时 `/v1/sign` 返回 429
  「已超出账号今日限额」）、用户自助修改 Key 限额。
- GitHub Actions 已跑通（run `44286722376`，4 个平台任务全部 success），8 个产物发布到
  [latest release](https://github.com/PIKACHUIM/CertumSigner/releases/tag/latest)：
  `certumsigner-windows-{x64,arm64}-{gui,cli}.zip`（1.7~2.1 MB）与
  `certumsigner-linux-{x64,arm64}-{gui,cli}.tar.gz`（110~132 KB），文件名与主页下载链接一致。
  Windows 用 vcpkg `openssl:*-windows-static-md` 静态链接，Linux GTK3 GUI 首次在 CI 上真实编译通过；
  产物只核对了 release 列表与体积，未下载执行。
- `wrangler dev` 下逐条实测：管理员登录、概览、用户新建/改口令/改有效期/停用/启用、
  凭据新建（含中文标签）/编辑/停用/启用/删除/强制登录/刷新证书、Key 创建（明文只显示一次）/
  停用/删除、日志页、统计 JSON；用户登录、门户、自建 Key（必须选已分配证书）、
  停用后 `/v1/whoami` 立即 401、删除后 401、用户日志只含自己的记录。
- 客户端接口实测：登录（正确/错误口令/缺字段）、会话校验、新建 Key、`reveal` 换发明文、
  token 失效返回 401。
- 管理员初始化流程（2026-11，`wrangler dev` 全新 KV）：未初始化时 `/admin` 与 `/admin/login`
  都 302 到 `/admin/setup`；短口令 / 两次不一致 / 非法用户名分别回显提示；创建成功后 302 到
  `/admin?ok=管理员账号已创建` 并直接登录；已初始化后 `/admin/setup` 302 回登录页；
  用户名或口令错误 401；
  设置页改口令（当前口令错 / 新口令过短 / 两次不一致 / 成功）逐项验证，改完旧口令 401、新口令 302，
  其他浏览器上的旧会话被注销（302 回登录页），当前浏览器拿到新 cookie 继续可用。
- 运行时可配置（2026-11，`wrangler dev`）：系统设置「服务与地址」保存基础地址 / Certum API / TSA /
  发件人 / PEM / 日志开关后回显正确（尾部斜杠被归一化、发件人转义正常），`ftp://` 之类地址与不是 PEM 的
  证书链分别被拒绝并回到设置页提示；清空字段即回落到默认值。
- 旧版兼容已移除（2026-11）：`ADMIN_PASSWORD` 登录、运行时配置的环境变量回退、
  「从环境变量导入凭据」全部删掉，`/admin/credentials/import-env` 现在返回 404；
  未初始化时 `/admin/setup` 是唯一入口。
- 界面逐项实测：四套主题 × 明暗切换、`/prefs` 写 cookie 后 302 回原页、中英文切换
  （含登录失败、CSRF、表单校验等提示）、新建/编辑弹窗、记录详情弹窗、
  900px 与手机宽度下侧边栏不换行错位、页面无横向滚动。
- 手机端（2026-11）：390px 与 563px 视口逐页核对（`/`、`/user/login`、`/admin/login`、`/admin`、
  `/admin/users`、`/admin/credentials`、`/admin/keys`、`/admin/logs`、`/admin/settings`、`/user`、
  `/user/logs`），`documentElement.scrollWidth == clientWidth`，整页不再被裁到右边；
  次要列（时间、邮箱、备注、脚本等）在窄屏隐藏，表格只在自己的容器里横向滚动，
  导航在 700px 以下隐藏图标并允许换行，弹窗收窄到视口内。
- C++ 客户端：MSVC 14.44 + Windows SDK 10.0.22621 + 静态 OpenSSL 3.5.9 编译通过
  （`/W4 /permissive-` 零告警）；CLI 与 Win32 GUI 都链接成可执行文件。
- Win32 GUI 实测：登录 → 选 Key（换发明文弹窗）→ 拖拽批量签名 3 个文件全部成功 →
  `WinVerifyTrust` 校验通过 → 设置页 TSA / 算法 / 备份 / 语言（中英）/ 主题（明暗）切换 →
  重新登录、设置页的软件许可入口；125% 缩放下布局无裁切；暗色与英文界面逐屏截图核对。
- 本轮改动（手机端适配、MIT 应用内许可页、摘要算法多选）的验证进度：Worker 侧 `npx tsc --noEmit`、
  `npm test` 与 `wrangler dev` 实测已通过（见下）；C++ 侧 `digest` / `settings` / `spc` / `signer` /
  `cli` / `api` / `gui_win` 用 MSVC `/W4 /permissive-` 单文件编译零告警；
  `pe.cpp` / `pkcs7.cpp`（本机缺 OpenSSL 开发包）与 `gui_gtk.cpp`（本机无 GTK3）交给 CI，
  Actions 运行 `44295635910` 四个平台任务全部 success，8 个产物已刷新到
  [latest release](https://github.com/PIKACHUIM/CertumSigner/releases/tag/latest)，
  说明 Win32 与 GTK3 两个 GUI 都真实编译通过（这次 CI 还抓出了 `tsa.cpp` 里一处
  `hash_bytes(…, false)` 没跟着改成算法名的编译错误，已修）。
  仍待人工验证：许可页与算法胶囊的实际交互、「一份文件多份签名」后的 `WinVerifyTrust` 结果
  —— 需要把产物下载到 Windows 上跑一遍。
- **真实 Certum 链路已跑通**（2026-11，Windows x64）：邮箱 + TOTP 登录成功；
  `/v1/certificate` 返回 EV 代码签名证书，指纹与凭据配置一致（卡片 `7507400891785917`）；
  `/v1/sign` 用真实 SHA-256 摘要换回 512 字节签名，客户端写进 PE 后
  `WinVerifyTrust` 返回 **`签名有效`**；加真实 Certum 时间戳后仍然有效。
- Linux（libcurl + GTK3）已在 CI 上编译通过，运行时与 GUI 交互仍未实测；MSI/CAB 不支持。

## 许可

[MIT](LICENSE)（© 2026 pikachuren）。

客户端「设置 → 软件许可」打开的是应用内页面，正文就是 `LICENSE` 的 MIT 原文，和 APP 其它页面同一套
卡片样式，不再是系统模态弹窗。
