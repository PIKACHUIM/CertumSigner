# Certum SimplySign 云签名协议（逆向记录）

本文是 Worker 里 `src/certum/*` 的实现依据：登录怎么走、卡片和证书怎么取、
摘要怎么提交、签名怎么轮询。**只记录协议结构和应用级常量，不含任何账号密钥。**

## 0. 依据与边界

两条证据链：

1. **本机安装的 SimplySign Desktop**（`C:\Program Files\Certum\SimplySign Desktop`）
   - `SimplySignDesktop.exe` 是 .NET 程序（`.exe.config` 声明 `NETFramework,Version=v4.6.1`）
   - 二进制里能直接读到 CAS 登录路径片段 `oauth2.0`、`client_id`，以及证书链的
     CRL/OCSP/AIA 地址（`repository.certum.pl`、`ocsp-certum.com`、`time.certum.pl` 同族）
   - 还有个未公开的启动参数 `/autologin`、`/close`（社区从 ILSpy 里发现），
     但那是“桌面客户端自动填入登录框”，不是本文讲的 HTTP 协议
   - 桌面端并非直接干活：PKCS#11 模块 `SimplySignPKCS_64` 是个瘦壳，
     通过命名管道 + 共享内存把请求交给 Desktop 进程，Desktop 再走 HTTPS
2. **社区已公开的协议抓包记录**（对 SimplySign 2.9.14 做的脱敏 MITM）：
   主机名、OAuth 参数、`/card/v1/...` 端点、SCS1_ATOM 异步任务格式都由此确认。
   本机二进制的明文字符串里没有完整主机名（被拆分或放在资源里），所以主机名以抓包记录为准。

> 这些 `client_id` / `client_secret` 是随桌面客户端分发给所有用户的公开客户端常量
> （RFC 8252 意义上的 public client），不是账号持有人的机密。
> 真正的机密只有两个：账号邮箱 + TOTP 种子。

## 1. 主机与常量

```
API 根       https://cloudsign.webnotarius.pl
登录页        /idp/login
OAuth 授权    /idp/oauth2.0/authorize
OAuth 换 token /idp/oauth2.0/accessToken
回调          https://cloudsign.webnotarius.pl/redirect
scope         https://cloudsign.webnotarius.pl/idp/oauth2.0/profile
时间戳        http://time.certum.pl/   （RFC 3161，和登录无关）
```

## 2. 登录：CAS 授权码流程

不是 ROPC（虽然二进制里有 `GrantFlowResourceOwnerPasswordCredentials` 的枚举），
真正的流程要跳 6 次左右：

```
1. GET /idp/oauth2.0/authorize
        ?response_type=code&client_id=<id>&redirect_uri=<redirect>
        &scope=<scope>&api_key=
   → 302 → /idp/login?service=...

2. GET /idp/login?service=...
   → 200 HTML，页面里有隐藏 input：execution（约 4.7KB）、lt

3. POST /idp/login?service=...
   Content-Type: application/x-www-form-urlencoded
   username=<邮箱>&password=<6 位 TOTP>&execution=<上一步的值>
   &_eventId=submit&geolocation=&submit=LOGIN&lt=
   → 302 … → /redirect?code=<授权码>

4. POST /idp/oauth2.0/accessToken
        ?client_id=<id>&client_secret=<secret>&scope=<scope>
        &code=<授权码>&redirect_uri=<redirect>&grant_type=authorization_code
   → 200 {"access_token":"...","token_type":"bearer","expires_in":1800,"refresh_token":"..."}
```

要点：

- **password 字段填的是 6 位动态口令**，不是账号密码。账号本身没有密码。
- TOTP 参数来自 Certum 后台的二维码（`otpauth://`），默认 `algorithm=SHA256`。
  用 SHA-1 对 SHA-256 种子算出来的码永远是错的，而且不报错，只是登录失败。
- 整个流程依赖 cookie（CAS 的 TGT），Workers 的 `fetch` 不带 cookie 语义，
  所以 Worker 里自己维护 Cookie 罐子，并手动跟随 302。
- 授权码出现在某一跳的 `Location` 里即可，不必真的去请求 `/redirect`。
- 会话有效期 30 分钟；可以用 `refresh_token` 续期，失败再回退到完整 OTP 登录。
- Worker 里每条凭据各自缓存自己的 token 与卡片信息（KV key 按凭据 id 分隔），
  多套账号/多张卡可以同时在线，互不影响；停用某条凭据只影响绑在它上面的 Key。
- 实测 CAS 偶发对正确的口令返回 HTTP 401（连续 2 次），同一口令再 POST 就成功；
  因此登录必须是“换新码重试”而不是一次定生死（Worker 默认 3 次）。
- 症状对照：`Error: internal error; reference = …` 不是账号问题，是本机网络/安全软件
  让 Worker 到 `cloudsign.webnotarius.pl` 的连接失败（实测同一 URL 时好时坏，
  `example.com` 正常）；重试或放行进程即可。

## 3. 取卡片与证书：异步任务

所有 `POST …/tasks` 都是异步任务：

```
POST /card/v1/cards/tasks
Authorization: Bearer <token>
Content-Type: application/json
→ 202 {"state":"...","atom:link":"<轮询地址>","message":"...","ping-after":500}

GET  <atom:link>
→ 303 {"atom:link":"<结果地址>"}       ← 还在跑就继续跟

GET  <结果地址>
→ 200 真正的载荷
```

卡片列表载荷：

```json
[{"profile":"...","label":"...","cardno":"<序列号>","pinrequired":false,
  "maxkeysno":2,"validthru":"..."}]
```

`pinrequired` 对代码签名证书是 `false`——不需要 PIN，bearer token 就是全部控制权。
这也是为什么**没有** SAD（Signature Activation Data）那一套 `pin/nonce/encryptkeyid`。

证书：

```
POST /card/v1/cards/<serial>/certificates/tasks
→ multipart/form-data，其中 name="certificate" 的部分就是签名证书（PEM）
```

注意：**签名时要把这段字节原样回传**，接口会拒绝 DER 重新编码过的证书。

### 时间戳代理

客户端的 RFC3161 请求（`TimeStampReq` → `TimeStampResp`）可以交给 Worker 转发：
`POST /v1/timestamp`（Bearer 鉴权）把原始 TSQ 发给 `TSA_UPSTREAM`（默认
`http://time.certum.pl/`），再把 TSR 原样返回。这样做是因为企业网的安全软件会拦
未签名程序的出网请求（实测返回 403 +「检测到风险软件的网络连接」），
而客户端到 Worker 的连接是通的。协议本身就是一次 HTTP POST，不涉及登录态。

实测补充（2026-11，EV Code Signing 卡片）：

- 卡片列表里可能有多张卡；每条凭据可以填「证书 SHA-1」（证书 DER 的 SHA-1，
  旧版本对应环境变量 `CERTUM_CERTIFICATE_SHA1`），Worker 逐张比对证书来选卡，
  实测与 `openssl x509 -fingerprint -sha1` 完全一致。
- 证书是 Certum Extended Validation Code Signing 2021 CA 签发的 RSA-4096，
  有效期 3 年，`pinrequired=false`。

## 4. 签名：SCS1_ATOM

```
POST /card/v1/cards/<serial>/certificates/signature
Authorization: Bearer <token>
Content-Type: multipart/form-data

  req          application/json;charset=UTF-8
               {"digests":["<64 位 SHA-256 十六进制>"],"digesttype":"SHA256"}
  certificate  application/octet-stream, filename="blob"
               <第 3 步拿到的 PEM 原始字节>

→ 202 {"state":"...","atom:link":"<轮询>","ping-after":...}

GET /scs1/card/v1/cards/<serial>/certificates/signature/task/<id>
→ 303 {"atom:link":"<结果>"}

GET /scs1/card/v1/cards/<serial>/certificates/signature/<resultId>
→ 200 [{"<摘要十六进制>":"<签名十六进制>"}]
```

- `digests` 是数组，可以一次提交多个摘要；返回是「摘要 → 签名」的对象数组。
- RSA-4096 的签名是 512 字节 = 1024 个十六进制字符。
- `digesttype`：实测 `SHA256` 可用；`SHA1` 对 Certum EV Code Signing 卡片会失败，
  任务体返回 `{"state":"failed","message":"digest.algorithm.error"}`，即这张证书只接受 SHA-256。
  Worker 已把该原因翻译成 `digest_algorithm_unsupported`（HTTP 400）。
- 终止条件是「响应体里没有 `atom:link`」，不是某个状态码；
  `state == "failed"` 视为失败。

## 5. 本地要做的部分（客户端）

云端只返回「摘要的 RSA 签名」，Authenticode 的其余部分都在客户端：

1. 算 PE 的 Authenticode 摘要：跳过 `CheckSum`（4 字节）、证书表目录项（8 字节）、
   以及证书表自身。
2. 拼 `SpcIndirectDataContent`。**这里的标签和微软文档是反的**，以实际签名为准
   （下面这段取自 Certum 自己签过名的 `SimplySignDesktop.exe`，逐字节核对过）：
   ```
   SEQUENCE {                                  -- SpcIndirectDataContent
     SEQUENCE {                                -- SpcAttributeTypeAndOptionalValue
       OID 1.3.6.1.4.1.311.2.1.15
       SEQUENCE {                              -- SpcPeImageData（value 是裸 SEQUENCE，没有 [0]）
         BIT STRING ''                         -- flags
         [0] {                                 -- file：[0] EXPLICIT（文档写的是 [2]）
           [2] {                               -- SpcLink.file
             [0] ''                            -- SpcString.unicode 空串
           }
         }
       }
     }
     SEQUENCE { AlgorithmIdentifier, OCTET STRING 文件摘要 }
   }
   ```
3. 拼 authenticatedAttributes：`contentType`（指向 SpcIndirectData）+ `messageDigest`，
   按 DER 排序后用 **SET OF** 编码；签名输入就是这段 SET 的哈希。
4. **messageDigest 算的是 `SpcIndirectDataContent` 的内容字节**（去掉外层 SEQUENCE 的
   tag 和长度），不是整个 TLV。这一点和直觉相反，但和真实签名一致（RFC 2315 §9.3
   的“content octets”）。
5. 云端签名 → 填进 `SignerInfo.encryptedDigest`，`authenticatedAttributes`
   在 SignerInfo 里改成 `[0] IMPLICIT`（内容不变，只是换标签）。
6. 可选：RFC3161 时间戳（messageImprint = 签名的 SHA-256），
   作为 `unsignedAttrs` 里的 `1.3.6.1.4.1.311.3.3.1`。
7. PKCS#7 写进 PE 的证书表（`WIN_CERTIFICATE`，8 字节对齐，更新目录项和校验和）。

### 交叉验证

客户端里这套 DER 拼装逻辑，另外用 Python 写了一份逐字节等价的实现并做了实测：

- Authenticode 摘要与 `signify`（独立实现）对同一个 PE 完全一致；
- 按上面结构生成的 PKCS#7 写进 PE 后，`signify` 能解析、能读出摘要，
  完整验签通过（`verify OK, chains: 1`）；
- 用同一段数据核对 Certum 真实签名的 `SpcPeImageData` 与 `messageDigest` 语义。


## 6. 已知坑

| 现象 | 原因 |
| --- | --- |
| 登录页一直循环 | 老客户端（2.9.10）会以 415 死循环打 `/card/v1/cards/tasks`；2.9.14 才对齐当前 API |
| TOTP 一直错 | 用了默认 SHA-1 去算 SHA-256 种子 |
| 证书 415 / 400 | 少 `Accept: multipart/form-data, application/json`，或证书被重新编码成 DER |
| 签名结果取不到 | 只判断了 202，没有跟 `atom:link`；结果可能是 303 之后的一次 200 |
| 签名无效（messageDigest 不符） | 把 messageDigest 算成了整个 `SpcIndirectDataContent` TLV；正确的是它的内容字节 |
| 结构解析报 “class should have been universal” | 照着微软文档把 `value` 包了 `[0]`、把 `file` 写成 `[2]`；实际正好相反 |
| 签名无效（内容被包成 OCTET STRING） | 那是 CMS，不是 Authenticode 用的老式 PKCS#7 |
