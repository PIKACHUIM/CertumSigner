# CertumSigner

[中文](README.md) · **English**

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/PIKACHUIM/CertumSigner/tree/main/worker)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange.svg)](https://workers.cloudflare.com/)

Turn Certum SimplySign cloud signing into an HTTP API on Cloudflare Workers, and pair it with a C++
desktop client that signs your PE files on Windows and Linux. **The private key never leaves Certum's
cloud** — no SimplySign Desktop, no signtool.

Project home: <https://github.com/PIKACHUIM/CertumSigner>

```
┌──────────────────────┐  (1) email + TOTP auto login (CAS/OAuth2)
│ Cloudflare Worker    │───────────────► cloudsign.webnotarius.pl
│ Hono + KV            │  (2) fetch card / certificate, cache tokens per credential (30 min)
│                      │  (3) POST digest → cloud HSM returns an RSA signature
└───┬───────────┬──────┘
    │           │  Bearer csk_xxx (each key is bound to one credential)
    │           ▼
    │   ┌────────────────────┐  Authenticode digest → request signature → build PKCS#7 → write PE
    │   │ C++ client         │  Windows: hand-drawn Win32 GUI / Linux: GTK3 GUI
    │   └────────────────────┘
    │
    ├── /        home page: features + client downloads (sign-in defaults to /user/login)
    ├── /admin  admin console: overview, users, credentials, keys, settings (plus a full log page)
    └── /user   user portal: create your own keys, see quota and call history
```

## Layout

```
worker/        Cloudflare Worker (Hono + KV): admin console, user portal, signing API
client/        C++17 client (Windows/Linux, CLI + GUI, CMake)
docs/          Notes from reverse engineering the Certum cloud signing protocol
```

## One-click deploy

Click **Deploy to Cloudflare Workers** above, authorize and create the KV namespace. Then open
`https://<your-domain>/admin`: it goes straight to the **setup page**, where you pick the admin username and
password. The account lives in KV with only a PBKDF2 hash; the session key is generated during setup, so no
manual secret is needed.

The old way (setting an `ADMIN_PASSWORD` secret) still works — use one or the other:

| Secret | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | legacy `/admin` password; ignored once a KV account exists |
| `SESSION_SECRET` | optional HMAC key for cookies; falls back to the key generated at setup |

For registration / password reset, also configure email (optional; both toggles stay unusable without it):

| Name | Purpose |
| --- | --- |
| `RESEND_API_KEY` | secret, Resend API key |
| `RESEND_FROM` | var, a verified sender such as `CertumSigner <noreply@example.com>` |
| `PUBLIC_BASE_URL` | var, optional base URL for links in emails; derived from the request when empty |

Then open `https://<your-domain>/`:

1. The home page links to Windows / Linux builds and to the user sign-in / admin console.
2. In `/admin`: **Credentials → New credential**: label, Certum email, TOTP seed (`otpauth://` URI or raw
   Base32), plus the certificate SHA-1 when you need a specific card. Use **Test login** to confirm the
   email/password pair can obtain a token.
3. **Users → New user**: set a password (PBKDF2-SHA256), an optional expiry, a user-level daily quota,
   an optional email and the certificates this user may sign with.
4. **Settings**: enable the sign-in captcha, self-registration, password reset and the email captcha.
5. Users sign in at `/user/login` to create their own keys; admins can also create keys from **Keys**.

## Features

- **Multiple Certum credentials**: email + TOTP seed + certificate SHA-1 stored as one record in KV.
  Several accounts/cards can live side by side, each with its own cached login session and card info.
- **Admin console** (`/admin`): overview metrics, 7-day chart, recent signatures with a detail dialog,
  user/credential/key management (create, edit, enable, disable, delete), forced re-login,
  certificate refresh, import from environment variables, and a **Settings** page for the sign-in
  captcha, self-registration, password reset and email captcha.
- **Home page** (`/`): feature overview plus Windows / Linux × x64 / arm64 × GUI / CLI downloads,
  built by GitHub Actions and published to the latest release.
- **User portal** (`/user`): log in with username/password, create a key from the certificates the admin
  assigned to you (the secret is shown once, for 5 minutes), adjust each key's daily limit, disable or
  delete it later, and inspect your own call history.
- **Quotas**: per-key and per-user daily limits apply together (0 = unlimited). Users can change their
  own key limits; admins can change the account-wide limit. `/v1/sign` rejects over-quota calls with
  `429 quota_exceeded` before contacting the cloud.
- **Registration / password reset** (off by default): can be enabled in Settings. Registration requires
  email verification before sign-in; reset links are sent through Resend and are valid for one hour.
  Both flows can additionally require a captcha.
- **Sign-in captcha**: a server-rendered, single-use SVG captcha (5-minute TTL) shared by user and
  admin sign-in, controlled by a Settings toggle.
- **UI preferences**: language (中文 / English), light/dark (system/dark/light) and four accent themes,
  picked from the browser on first visit and remembered in cookies (`cs_lang` / `cs_mode` / `cs_theme`)
  for a year. Server rendered, native `<dialog>` modals, no frontend build step.
- **Sign by digest**: `POST /v1/sign` accepts one or up to 16 digests per call (`algorithm`: SHA-1 /
  SHA-256 / SHA-384 / SHA-512) and returns the matching RSA signatures — one upstream call per batch.
- **Client**: computes the Authenticode digest, builds PKCS#7, writes the PE certificate table, adds an
  RFC3161 timestamp, self-checks the signature with the certificate's public key before writing, and can
  verify the result afterwards. Digests are a multi-select, so one file can carry several signatures.

## Client

On Windows it is a hand-drawn Win32 app with four sidebar entries:

```
Sign in ──► Sign ⇄ Credentials ⇄ Settings
        (after sign-in it lands on Sign; visit Credentials to switch keys)
```

1. **Sign in**: server URL (your Worker domain), username, password. Enter in the password box submits.
2. **Credentials**: lists the keys of your account (with daily quota). Picking an existing key
   **issues a new secret** and invalidates the old one (you are asked first); or type a name, pick a
   certificate and create a new key right there. Key selection is automatic after sign-in: a saved
   key that still exists goes straight to Sign, a single key is re-issued silently and Sign opens,
   no key at all but an assigned certificate creates one, and only multiple unknown keys need a manual pick.
3. **Sign**: drop files into the window or click to upload, remove/clear rows, then sign the whole batch.
   Each row shows queued / signing / signed / failed; `Verify` runs `WinVerifyTrust` on the selected file.
4. **Settings**:
   - Connection: server URL, API key (show/hide), current account and key name.
   - Signing: digest algorithms are a **multi-select** (SHA-1 / SHA-256 / SHA-384 / SHA-512, only
     SHA-256 ticked by default; each ticked algorithm produces its own signature in the same certificate
     table), timestamp on/off, built-in TSA list (DigiCert / Symantec / GeoTrust / Comodo / WoSign /
     GlobalSign / Entrust / GoDaddy / Certum, **DigiCert** by default), keep a backup.
   - Appearance: language (中文 / English / system) and theme (system / dark / light).
   - About: license (MIT — opens an in-app license page, not a modal dialog), project URL, sign in again.

The bottom of the sidebar holds the account block — round avatar (first letter of the username), user
name and current key name — above three icon buttons for language, light/dark and sign-out. They stay
pinned to the real window bottom when the window grows, and the drop-downs are custom-drawn so no white
native list box appears in dark mode.

The API key and preferences are stored in `%APPDATA%\CertumSigner\config.json`; the next launch goes
straight to the signing screen, and an invalid key falls back to the sign-in page. Dropping files onto
`certumsigner.exe` or choosing it from "Open with" pre-fills the queue.

Build steps and CLI usage: [`client/README.md`](client/README.md).

```bash
certumsigner config --server https://sign.example.com --api-key csk_xxx
certumsigner sign dist/app.exe
certumsigner sign dist/ --recursive --yes --sha256
certumsigner --gui
```

Chinese and space-containing paths (e.g. `D:\下载\签名 副本.exe`) work in both the CLI and the GUI.

## API

Auth: `Authorization: Bearer csk_…` (or `X-Api-Key`). The key's credential decides which certificate is used.

### `POST /v1/sign`

```bash
curl -X POST https://sign.example.com/v1/sign \
  -H "Authorization: Bearer csk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"hash":"<64 hex chars, SHA-256>","algorithm":"sha256"}'
```

Batch (one upstream call, up to 16 digests):

```json
{"hashes": ["<hash1>", "<hash2>"], "algorithm": "sha256", "encoding": "hex"}
```

`algorithm` is one of `sha256` (default), `sha1`, `sha384`, `sha512`; spellings such as `sha-256` or
`SHA256` are normalised. Digests must be 64 / 40 / 96 / 128 hex chars respectively — a length mismatch
returns `bad_hash`, an unknown name returns `bad_algorithm`.

Success:

```json
{
  "ok": true,
  "algorithm": "sha256",
  "signatures": ["<1024 hex chars, RSA-4096 signature>"],
  "certificate": {
    "pem": "-----BEGIN CERTIFICATE-----\n...",
    "chain": [],
    "serial": "<card serial>",
    "fingerprint256": "<SHA-256 of the DER certificate>"
  },
  "credential": { "id": "cred_xxx", "label": "…", "email": "…" },
  "meta": { "keyId": "...", "keyName": "CI", "count": 1, "durationMs": 842, "requestId": "..." }
}
```

Errors are `{"ok":false,"error":{"code":"...","message":"..."}}` with codes such as
`bad_hash` / `bad_algorithm` / `unauthorized` / `quota_exceeded` / `credential_missing` /
`credential_disabled` / `digest_algorithm_unsupported` / `task_failed` / `signature_missing`.

### Desktop client endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /api/client/login` | username + password → session token, plus the available keys and certificates |
| `GET /api/client/session` | validate the token |
| `POST /api/client/logout` | revoke the token |
| `GET /api/client/keys` | list keys of the account |
| `POST /api/client/keys` | create a key (returns the secret once) |
| `POST /api/client/keys/:id/reveal` | re-issue the secret of an existing key; the old one stops working |

### Others

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/certificate` | signing certificate PEM + optional chain |
| `GET /v1/whoami` | owning user, key/user quotas, usage today, bound credential |
| `GET /v1/stats` | global statistics + your own and account usage |
| `POST /v1/timestamp` | RFC3161 proxy: request body is a TSQ, response is the TSR |
| `GET /captcha` | issue a single-use captcha (`{id, svg}`, 5-minute TTL) |
| `GET /prefs?lang=&mode=&theme=&back=` | switch language/mode/theme, set cookies, 302 back (site-relative only) |
| `GET /health` | liveness check (no upstream requests) |

Admin JSON stats: `GET /admin/api/stats`.

### When the TSA is blocked

Corporate security agents (Tencent iOA in our tests) block unsigned binaries from reaching the internet,
so a direct TSA request returns HTTP 403 with `检测到风险软件的网络连接`. The client then automatically
retries through `POST /v1/timestamp` (same Bearer key) and the Worker forwards to `TSA_UPSTREAM`.
Use `--tsa worker` to force the proxy.

## Local development

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars   # optional CERTUM_* for import; ADMIN_PASSWORD can stay empty
npx wrangler kv namespace create CERTUM_KV   # put the returned id into wrangler.jsonc
npm run dev                      # http://127.0.0.1:8787 ; /admin opens the setup page first
npm test                         # TOTP / multipart / encoding / KV / admin-account unit tests
npm run typecheck
```

Manual deploy:

```bash
npm run deploy
# open https://<your-domain>/admin and create the administrator account
npx wrangler secret put RESEND_API_KEY   # optional, needed for registration/reset
```

To keep the legacy flow, set `ADMIN_PASSWORD` before deploying instead; neither secret is mandatory.

Pushing a `v*` tag or running `.github/workflows/release.yml` manually builds eight artifacts
(Windows / Linux × x64 / arm64 × GUI / CLI) and publishes them to the `latest` release; the home page
links straight to those files.

## Environment variables

| Name | Type | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | secret | optional legacy `/admin` password; ignored when a KV account exists |
| `SESSION_SECRET` | secret | optional cookie HMAC key; defaults to the key generated at setup |
| `CERTUM_EMAIL` | var | only used by "import from environment" |
| `CERTUM_OTP_URI` | secret | same, `otpauth://` URI (preferred) |
| `CERTUM_OTP_SECRET` | secret | same, raw Base32 seed |
| `CERTUM_CERTIFICATE_SHA1` | var | same, written into the imported credential |
| `CERTUM_API_BASE` | var | defaults to `https://cloudsign.webnotarius.pl` |
| `CERTUM_CHAIN_PEM` | var | optional intermediate PEM(s), newline separated |
| `LOG_SIGNATURES` | var | `0` disables per-signature logs (stats only) |
| `TSA_UPSTREAM` | var | RFC3161 upstream for `/v1/timestamp`, defaults to `http://time.certum.pl/` |
| `RESEND_API_KEY` | secret | optional Resend key; registration/reset stay disabled without it |
| `RESEND_FROM` | var | optional verified Resend sender |
| `PUBLIC_BASE_URL` | var | optional base URL for email links; derived from the request when empty |

At runtime the email and seed come from the KV credential, so `CERTUM_*` is no longer required.

## Security

- **TOTP seeds live in the KV credential records**; clients never see them and they are not used for
  signing. KV is encrypted at rest, but an API token that can read the namespace can read them in
  plaintext — scope the token to that single namespace in production.
- **API keys are stored as SHA-256 hashes only**; the secret is shown once and deleted after 5 minutes.
  Re-issuing (`/reveal`) deletes the old hash and returns a new secret. Keys are bound to `userId` +
  `credentialId`; disabling a user or credential invalidates them immediately.
- **Passwords** use salted PBKDF2-SHA256 (150k iterations); the administrator account stores only a
  PBKDF2 hash too (10+ characters). User sessions last 7 days, admin sessions 12 hours, both revocable in
  KV. Writes check CSRF, logins are rate limited per IP (8 failures per 10 minutes; 8 per 10 minutes for
  the client API). `/admin/setup` closes itself once the account exists — **before that, whoever opens
  `/admin` first can create the account**, so finish setup right after deploying (or set an
  `ADMIN_PASSWORD` secret first to hold the door).
- The signing API is strict: digest length must match the algorithm (40 / 64 / 96 / 128 hex chars), at
  most 16 digests per call, with per-key and per-user daily quotas.
- The client verifies the returned signature with the certificate's public key before writing the file.

## Known limitations

- Statistics use read-modify-write on KV, so **counts can be lost under concurrency**; use a Durable
  Object if you need exact numbers.
- Opening the console or the credentials page may trigger a Certum login on demand (up to 3 OTP retries
  when the session is missing), so a wrong credential produces a few failed requests.
- SHA-1 digests are rejected by Certum EV cards (`digest.algorithm.error`), and `/v1/sign` returns
  `digest_algorithm_unsupported`; `SHA256` / `SHA384` / `SHA512` all work in practice, so legacy SHA-1
  signing needs a certificate that still accepts it.
- PE files only (`.exe/.dll/.sys/.ocx`); no MSI, CAB or scripts.
- Workers limits subrequests: one signature typically uses 3–8, so keep batches to a dozen digests.
- Registration / password reset are off by default; without Resend only an admin can reset a password.
- Windows arm64 and Linux client builds come from CI and have not been run locally.

## Verification

- Worker: `npx tsc --noEmit` clean; `npm test` 28 passing (TOTP against RFC 6238 vectors, multipart,
  encoding/hashing, KV storage, password hashing, admin account setup/password change).
- New features exercised under `wrangler dev` (Nov 2026): home page downloads, two-column sign-in with
  captcha (wrong code → 401 and a new image, refresh button issues a new id, password show/hide),
  persisted settings toggles, registration reporting a clear error without Resend, email verification
  tokens (unverified sign-in 401 → verified sign-in 302), reset token (old password 401 / new password
  302), user-level quota (usage 5 / limit 1 → `/v1/sign` 429 `已超出账号今日限额`), self-service key quota
  updates. GitHub Actions run `44286722376` finished green (all four platform jobs) and published the
  eight artifacts to the [latest release](https://github.com/PIKACHUIM/CertumSigner/releases/tag/latest):
  `certumsigner-windows-{x64,arm64}-{gui,cli}.zip` (1.7-2.1 MB) and
  `certumsigner-linux-{x64,arm64}-{gui,cli}.tar.gz` (110-132 KB). Windows links OpenSSL statically via
  vcpkg `openssl:*-windows-static-md`; the Linux GTK3 GUI compiled for the first time on CI. The archives
  were not downloaded and executed, only listed by name and size.
- Admin setup flow (Nov 2026, fresh KV under `wrangler dev`): `/admin` and `/admin/login` both 302 to
  `/admin/setup` while unconfigured; short password, mismatched confirmation and invalid username each
  render their own message; creating the account 302s to `/admin?ok=…` already signed in; once configured
  `/admin/setup` 302s back to the login page; wrong username/password 401, and a legacy `ADMIN_PASSWORD`
  is ignored once a KV account exists (401); the settings page password change was checked for wrong
  current password, short new password, mismatch and success, with the old password then 401 and the new
  one 302, with other browser sessions revoked (302 back to sign-in) while the current browser receives a
  fresh cookie; env-only mode hides the username field and the password form.
- Exercised under `wrangler dev`: admin login, overview, user create/password/expiry/disable/enable,
  credential create (with non-ASCII label)/edit/disable/enable/delete/force login/refresh certificate,
  key create (secret shown once)/disable/delete, log page, stats JSON; user login, portal, self-service
  key creation (assigned certificates only), `/v1/whoami` 401 after disabling, 401 after deletion,
  logs scoped to the owner.
- Client API exercised: login (correct/wrong password/missing fields), session check, key creation,
  `reveal`, 401 on expired tokens.
- Web UI: four themes × light/dark, `/prefs` cookie and 302, Chinese/English switch (including login
  failures, CSRF and validation messages), create/edit and detail dialogs, no overflow at 900px and
  phone widths.
- Mobile (Nov 2026): every page checked at 390px and 563px viewports (`/`, `/user/login`,
  `/admin/login`, `/admin`, `/admin/users`, `/admin/credentials`, `/admin/keys`, `/admin/logs`,
  `/admin/settings`, `/user`, `/user/logs`) with `documentElement.scrollWidth == clientWidth`, so nothing
  is cut off on the right; secondary columns (time, e-mail, notes, scripts) hide on narrow screens,
  tables scroll only inside their own container, the nav drops its icons and wraps below 700px, and
  dialogs shrink to the viewport.
- C++ client: builds with MSVC 14.44 + Windows SDK 10.0.22621 + static OpenSSL 3.5.9, zero warnings
  under `/W4 /permissive-`; both the CLI and the Win32 GUI link.
- Win32 GUI: sign-in → key selection (re-issue dialog) → batch signing of 3 files, all `signed` →
  `WinVerifyTrust` reports a valid signature → settings (TSA / digest / backup / language / theme) →
  sign in again and the software-license entry in Settings; layout checked at 125% scaling, dark and
  English screens captured screen by screen.
- Status of the current round (mobile layout, MIT in-app license page, multi-select digests): Worker side
  `npx tsc --noEmit`, `npm test` and the `wrangler dev` checks below are green; on the C++ side
  `digest` / `settings` / `spc` / `signer` / `cli` / `api` / `gui_win` compile warning-free per file with
  MSVC `/W4 /permissive-`; `pe.cpp` / `pkcs7.cpp` (no OpenSSL dev package on this machine) and
  `gui_gtk.cpp` (no GTK3 here) were left to CI, and Actions run `44295635910` finished green on all four
  platforms, refreshing the eight artifacts in the
  [latest release](https://github.com/PIKACHUIM/CertumSigner/releases/tag/latest) — so both the Win32 and
  the GTK3 GUI do build (that run also caught a `tsa.cpp` call still passing `false` where `hash_bytes`
  now wants an algorithm name; fixed). Still to confirm by hand: the license page and digest pills at
  runtime, and the `WinVerifyTrust` result for a file carrying several signatures.
- **Real Certum path verified** (Nov 2026, Windows x64): email + TOTP login works; `/v1/certificate`
  returns the EV code signing certificate with the configured fingerprint (card `7507400891785917`);
  `/v1/sign` returns a 512-byte signature for a real SHA-256 digest, and after the client writes it into
  the PE, `WinVerifyTrust` reports **valid**, still valid after adding a real Certum timestamp.
- Linux (libcurl + GTK3) compiles on CI; the binary and its GUI interaction remain untested; MSI/CAB
  unsupported.

## License

[MIT](LICENSE) (© 2026 pikachuren).

"Settings → License" in the client opens an in-app page holding the MIT text from `LICENSE`, using the
same card style as the rest of the app instead of a system modal dialog.
