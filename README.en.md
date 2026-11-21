<div align="center">
  <img src="docs/assets/logo.svg" width="112" height="112" alt="logo" />

  <p><em>Turn Certum SimplySign cloud signing into an HTTP API, then sign your own PE files with a C++ client</em></p>
  <p>The private key never leaves Certum — no SimplySign Desktop and no signtool on your machine</p>
  <p>Cloud side runs on Cloudflare Workers (Hono + KV); the client is C++17: Win32 GUI on Windows, GTK3 GUI + CLI on Linux</p>

<a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg" alt="License" /></a>
<a href="https://github.com/PIKACHUIM/CertumSigner/releases"><img src="https://img.shields.io/github/v/release/PIKACHUIM/CertumSigner?sort=date&label=release" alt="Release" /></a>
<a href="https://github.com/PIKACHUIM/CertumSigner/actions/workflows/beta.yml"><img src="https://img.shields.io/github/actions/workflow/status/PIKACHUIM/CertumSigner/beta.yml?branch=main&label=client%20build" alt="Client build" /></a>
<a href="https://github.com/PIKACHUIM/CertumSigner/stargazers"><img src="https://img.shields.io/github/stars/PIKACHUIM/CertumSigner?color=%23ED8936&logo=github" alt="Stars" /></a>
<a href="https://github.com/PIKACHUIM/CertumSigner/forks"><img src="https://img.shields.io/github/forks/PIKACHUIM/CertumSigner?color=%239F7AEA&logo=github" alt="Forks" /></a>

English | [简体中文](README.md)

[Downloads](https://github.com/PIKACHUIM/CertumSigner/releases) · [Quick deploy](#deploy-in-one-click) · [API](#api) · [Client docs](client/README.md) · [License](LICENSE)

</div>

---

## Deploy in one click

<div align="center">

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/PIKACHUIM/CertumSigner/tree/main/worker)

</div>

> [!IMPORTANT]
> - **Fork** this repo before clicking the button: it deploys straight from `worker/wrangler.jsonc`, which is a template — the KV id and route are placeholders.
> - After forking, replace `kv_namespaces[0].id` with your own `wrangler kv namespace create CERTUM_KV` output, and point `routes` at your domain (delete the block to use `*.workers.dev`).
> - The first visit to `/admin` opens the **setup page**: choose an admin username and password and you are signed in. Credentials are stored as PBKDF2 hashes in KV and the session key is generated during setup, so **no secret is required**.
> - Before setup, whoever opens `/admin` first can create the admin account — finish the wizard right after deploying.

Day-to-day updates (no need to redeploy from the button):

```bash
cd worker
npm install
npx wrangler deploy
```

## What it does

Certum SimplySign only offers "sign this digest with an RSA key". Normally that means signtool on a Windows box running SimplySign Desktop, with a one-time code typed in by hand. This project moves the whole path to the cloud: the Worker signs in to Certum with email + TOTP, fetches the card and certificate, and exposes signing as an API keyed by a Bearer token; the client computes the Authenticode digest, builds PKCS#7 and writes the certificate table back into the PE itself.

```
┌──────────────────────┐  1. email + TOTP sign-in (CAS/OAuth2)
│ Cloudflare Worker    │───────────────► cloudsign.webnotarius.pl
│ Hono + KV            │  2. card / certificate, session cached 30 min per credential
│                      │  3. POST digest → cloud HSM returns the RSA signature
└───┬───────────┬──────┘
    │           │  Bearer csk_xxx (each key is bound to one credential)
    │           ▼
    │   ┌────────────────────┐  Authenticode digest → sign → PKCS#7 → write back to the PE
    │   │ C++ client         │  Windows: hand-drawn Win32 GUI / Linux: GTK3 GUI
    │   └────────────────────┘
    │
    ├── /        landing page: feature overview + client downloads
    ├── /admin   admin console: overview, users, credentials, keys, logs, settings
    └── /user    user portal: create your own keys, check usage and call history
```

### Cloud side (Worker)

- **Multiple Certum credentials**: email + TOTP seed + certificate SHA-1 fingerprint is one credential in KV; keep as many as you need (different accounts / cards), each with its own cached sign-in session and card info.
- **Digest signing proxy**: `POST /v1/sign` takes one digest or a batch, `algorithm` supports SHA-1 / SHA-256 / SHA-384 / SHA-512, up to 16 digests per cloud call.
- **Malware scanning (optional, per credential)**: each credential can require `off / manual upload / auto upload` and a maximum risk level. Lookups and uploads are relayed by the Worker, backed by VirusTotal or MetaDefender Cloud, cached by raw-file SHA-256.
- **Admin console** (`/admin`): request volume, success/failure, algorithm mix, 7-day chart, recent signatures; create/edit/disable users, credentials and keys; a full signing log with time, key, credential, digest prefix, result, duration, IP, UA and error.
- **User portal** (`/user`): sign in with email + password, create a key from the certificates an admin assigned, rename it (key-level quota stays under admin control), and inspect your own calls. When a certificate requires scanning, a Virus Scan page lets you upload unknown files manually. A key's plaintext is shown once; lists only ever display its prefix.
- **Quotas**: key-level daily quota, user-level daily quota and a user-level **total quota** apply together (0 = unlimited); `/v1/sign` returns `429 quota_exceeded` before touching Certum. The total quota sums every signature made by the account's keys and the console can reset it at any time; each account holds at most 20 keys, and key-level quotas can only be set by an admin.
- **Registration / password reset** (off by default): registration requires email verification before sign-in; reset sends a one-hour link through Resend.
- **Sign-in captcha** (off by default): once enabled, user, admin and desktop-client sign-in all need one, either a 4-digit image captcha or Cloudflare Turnstile (falls back to the image captcha when its keys are missing).
- **UI**: fully server-rendered, no frontend build; fixed six-item sidebar plus language (zh/en), light/dark and four themes in the top bar, stored in cookies.

### Desktop client

- **One command**: `certumsigner sign app.exe`, SHA-256 + RFC3161 timestamp by default.
- **Several algorithms at once**: SHA-1 / SHA-256 / SHA-384 / SHA-512 can be combined; the first goes into the certificate table, the rest ride along as nested signatures (`SPC_NESTED_SIGNATURE`).
- **Own PKCS#7**: no signtool involved. Everything except the RSA signature happens locally, and the returned signature is verified against the certificate public key before it is written.
- **GUI**: hand-drawn Win32 on Windows (no console window), GTK3 on Linux; drop files in, batch sign, live status pills, optionally skip files that are already signed.
- **Timestamp fallback**: when enterprise security software blocks the TSA, the client retries through the Worker's `/v1/timestamp` proxy.
- **Pre-sign malware check**: when the certificate requires it, the client hashes the raw file; auto mode uploads through the Worker and polls, manual mode points to `/user/scan` or `certumsigner scan`.
- **Bilingual UI with light/dark themes**, and proper support for Chinese and space-containing paths.

## Client

Grab a build if you do not want to compile: 8 artifacts, Windows / Linux × x64 / arm64 × GUI / CLI, all built by GitHub Actions.

| Platform \ arch | x64 | arm64 |
| --- | --- | --- |
| Windows (GUI / CLI) | [GUI](https://github.com/PIKACHUIM/CertumSigner/releases/latest/download/certumsigner-windows-x64-gui.zip) · [CLI](https://github.com/PIKACHUIM/CertumSigner/releases/latest/download/certumsigner-windows-x64-cli.zip) | [GUI](https://github.com/PIKACHUIM/CertumSigner/releases/latest/download/certumsigner-windows-arm64-gui.zip) · [CLI](https://github.com/PIKACHUIM/CertumSigner/releases/latest/download/certumsigner-windows-arm64-cli.zip) |
| Linux (GTK3 / CLI) | [GUI](https://github.com/PIKACHUIM/CertumSigner/releases/latest/download/certumsigner-linux-x64-gui.tar.gz) · [CLI](https://github.com/PIKACHUIM/CertumSigner/releases/latest/download/certumsigner-linux-x64-cli.tar.gz) | [GUI](https://github.com/PIKACHUIM/CertumSigner/releases/latest/download/certumsigner-linux-arm64-gui.tar.gz) · [CLI](https://github.com/PIKACHUIM/CertumSigner/releases/latest/download/certumsigner-linux-arm64-cli.tar.gz) |

Those links follow the newest **stable** release; for the build of every client change see the [`beta` prerelease](https://github.com/PIKACHUIM/CertumSigner/releases/tag/beta). Windows builds link OpenSSL statically, so the zip runs as-is.

### GUI in three steps

```
Sign in ──► Sign ⇄ Keys ⇄ Settings
```

1. **Sign in**: server URL (your Worker domain), email, password; Enter submits.
2. **Keys**: synced live with the platform. Each row shows the bound certificate, key prefix, daily quota and whether this machine holds the secret (`Saved locally` / `Platform only` / `Gone on platform`). `Use` switches to a locally stored secret without touching other devices; only when there is no local copy does it offer to rotate. `Rotate` and `Delete` act on the platform and revoke the key everywhere. When creating a key the **secret is generated locally** and only its SHA-256 plus prefix are sent to the platform. After sign-in the client reuses the current key when it still belongs to the account, otherwise it stays on the keys page.
3. **Sign**: drop files in or click upload, delete items individually or sign the batch; each row shows queued / scanning / signing / signed / failed (the failure reason sits on the row's second line) / skipped. `Verify` calls `WinVerifyTrust` on Windows.

Settings is split into connection, signing options (algorithms, timestamp, built-in TSA, backup), interface (language / theme) and about (in-app AGPL notice, project URL, sign out again). Settings live in `%APPDATA%\CertumSigner\config.json`, so the next launch lands on the sign page.

### Command line

```bash
# configure once
certumsigner config --server https://sign.example.com --api-key csk_xxx

# sign
certumsigner sign dist/app.exe                    # SHA-256 + timestamp
certumsigner sign dist/ --recursive --yes         # whole directory
certumsigner sign app.exe --sha256 --sha384       # multiple signatures in one file
certumsigner sign legacy.dll --sha1               # old systems (EV cards reject it)
certumsigner sign app.exe --no-timestamp --backup # no timestamp, keep the original

# malware scan (when the certificate requires manual upload)
certumsigner scan app.exe                         # upload / poll, print the risk level

# inspect
certumsigner hash app.exe                         # print the Authenticode digest
certumsigner verify app.exe                       # Windows: WinVerifyTrust
certumsigner --gui                                # open the GUI
```

`CERTUM_SIGNER_SERVER` / `CERTUM_SIGNER_API_KEY` override the config file, which is handy in CI. Full flags, config fields and build steps: [`client/README.md`](client/README.md).

## Manual deployment

<details>
<summary>Prerequisites, local development and multiple instances</summary>

### Prerequisites

- Node.js 18+ (wrangler 4.x)
- A Cloudflare account and one KV namespace

### Local development

```bash
cd worker
npm install
npx wrangler kv namespace create CERTUM_KV   # copy the id into wrangler.jsonc
npm run dev                                  # http://127.0.0.1:8787
npm test                                     # TOTP / multipart / encoding / KV / admin account
npm run typecheck
```

The first visit to `http://127.0.0.1:8787/admin` opens the setup page. Registration and password reset need Resend: fill in the API key and sender under Settings → Email delivery; no secret is involved.

### Production

```bash
cd worker
npx wrangler deploy
# open https://<your-domain>/admin and finish the setup
```

Custom domain: edit `routes` in `worker/wrangler.jsonc`, then put the same address into Settings → Base URL so email links use it.

### Multiple instances

The same code can run several fully isolated instances (different Worker, KV and domain) from separate configs: copy `worker/wrangler.jsonc` to `wrangler.<name>.jsonc` and change `name`, `routes` and the KV id. `worker/.gitignore` ignores `wrangler.*.jsonc`, so configs holding real domains and KV ids are never committed by accident.

```bash
cd worker
npx wrangler kv namespace create signui-kvdb       # put the new id in the new config
npx wrangler deploy --config wrangler.signuiworker.jsonc
```

KV is not shared: admin account, credentials and keys are separate, and the new domain starts at `/admin/setup` too.
The two live instances are `certum-signer` (`certum.524228.xyz`, primary) and `signui-worker` (no custom route). Do not redeploy retired instance names, or old domains and old KV will come back.

</details>

## Configuration

The Worker only takes one optional secret; everything else lives in Settings (stored in KV, applied on save):

| Name | Type | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | secret (optional) | HMAC key for session cookies; when unset, a random value generated during setup is used |
| `CERTUM_KV` | KV binding | Users, credentials, keys, sessions, stats, runtime config and captchas |

Runtime settings exposed in the admin UI:

| Group | Settings |
| --- | --- |
| Self-service accounts | Require a captcha at sign-in (off / 4-digit image / Cloudflare Turnstile with site and secret keys), allow self-registration, allow password reset |
| Email delivery | Base URL used in email links, sender, Resend API key, email captcha switch, delivery status |
| Services and addresses | Certum API base, TSA upstream, intermediate certificate PEM, signing-log switch |

## Architecture

| Layer | Implementation |
| --- | --- |
| Runtime | Cloudflare Workers (also runs locally via `wrangler dev`) |
| Web framework | Hono 4 + TypeScript |
| Storage | KV (`CERTUM_KV`): users, credentials, keys, sessions, stats, runtime config, captchas |
| Pages | Server-rendered with native `<dialog>`; no frontend build step |
| Client | C++17 / CMake, WinHTTP (Windows) and libcurl (Linux), hand-drawn Win32 GUI and GTK3 GUI |
| Crypto | OpenSSL 3 on the client, PBKDF2-HMAC-SHA256 and WebCrypto in the Worker |

```
worker/        Cloudflare Worker: admin console + user portal + signing API
client/        C++17 client: CLI + Win32 / GTK3 GUI
docs/          Notes on reverse-engineering the Certum cloud signing protocol
```

## API

Auth: `Authorization: Bearer csk_…` (or `X-Api-Key`). The credential bound to the key decides which certificate is used.

### `POST /v1/sign`

```bash
curl -X POST https://sign.example.com/v1/sign \
  -H "Authorization: Bearer csk_xxx" \
  -H "Content-Type: application/json" \
  -d '{"hash":"<64 hex chars, SHA-256>","algorithm":"sha256","file":{"sha256":"<raw-file SHA-256>"}}'
```

`file.sha256` is required only when the certificate enforces scanning: the Worker checks the scan result against it and otherwise returns `scan_proof_required`. Certificates without scanning can omit it.

Batch (one cloud call, up to 16 digests):

```json
{"hashes": ["<hash1>", "<hash2>"], "algorithm": "sha256", "encoding": "hex"}
```

`algorithm` accepts `sha256` (default) / `sha1` / `sha384` / `sha512`, as well as spellings like `sha-256` or `SHA256`. Digest lengths must be exactly 64 / 40 / 96 / 128 hex characters; a wrong length returns `bad_hash`, an unknown name returns `bad_algorithm`.

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

Failures are always `{"ok":false,"error":{"code":"...","message":"..."}}` with codes such as `bad_hash` / `bad_algorithm` / `unauthorized` / `quota_exceeded` / `credential_missing` / `credential_disabled` / `digest_algorithm_unsupported` / `task_failed` / `signature_missing`.

### Desktop client endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /api/client/login` | email + password → session token, plus the available keys and certificates; also accepts the legacy `username` field; when the sign-in captcha is enabled it needs `captchaId` + `captcha` (numeric image captcha, never Turnstile) |
| `GET /api/client/captcha` | issue a 4-digit image captcha (`id` + `svg` + `dataUrl`) |
| `GET /api/client/session` | validate the token and return the account's keys and certificates (used to sync the keys page) |
| `POST /api/client/logout` | revoke the current token |
| `GET /api/client/keys` | list the account's keys |
| `POST /api/client/keys` | create a key: the new client generates the secret locally and uploads only `hash` + `prefix`; without `hash` the server still generates one and returns it once |
| `POST /api/client/keys/:id/reveal` | rotate a key; also accepts a locally generated `hash` + `prefix`, the old value stops working |
| `DELETE /api/client/keys/:id` | delete one of your keys; it stops working everywhere immediately |

### Miscellaneous

| Endpoint | Purpose |
| --- | --- |
| `GET /v1/certificate` | signing certificate PEM of the current credential, plus optional chain |
| `GET /v1/whoami` | owner, key quota, user daily and total quota (used / limit), today's usage and bound credential |
| `GET /v1/stats` | global stats plus your own and the account's usage |
| `GET /v1/scan/policy` | scan mode, risk limit, provider and manual upload URL for the current certificate |
| `GET /v1/scan/check?sha256=` | look up a raw-file SHA-256 (`found=false` means unknown) |
| `POST /v1/scan/upload?sha256=&name=` | relay raw file bytes to the scanning provider; returns an `analysisId` |
| `GET /v1/scan/analysis/:id` | poll an analysis (throttled 20 s internally to save free quota) |
| `POST /v1/timestamp` | RFC3161 proxy: TSQ in, TSR out |
| `GET /captcha` | issue a one-time image captcha (`{id, svg}`, 5-minute TTL) |
| `GET /prefs?lang=&mode=&theme=&back=` | switch language / mode / theme, set cookies and 302 back |
| `GET /health` | liveness probe (no cloud requests) |

Admin JSON stats: `GET /admin/api/stats` (admin session required).

### Malware scanning

The policy lives on the **certificate credential**, so different certificates on the same Worker can behave differently:

| Mode | When the file is unknown | Upload path |
| --- | --- | --- |
| Off | no check | — |
| Manual | the client fails and points to `/user/scan` or `certumsigner scan` | user-initiated |
| Auto | the client uploads and polls before signing | relayed by the Worker |

Risk level = malicious engines + suspicious engines; `0` means fully clean. `/v1/sign` re-checks `file.sha256`: unknown files return `409 scan_required`, excessive risk returns `403 scan_risk_too_high`, and a missing provider key returns `503 scan_not_configured`. Mandatory scanning fails closed.

**Providers and free tiers** (set the API key in Admin → Settings → Malware scanning):

| Provider | Free tier | File size | Notes |
| --- | --- | --- | --- |
| VirusTotal (default) | 4 req/min, 500/day | 32 MB direct; 650 MB large-file channel | hash lookup first, upload only when unknown |
| MetaDefender Cloud | ~1,000 hash lookups/day, 150 scans/day | 750 MB | hash lookup supported; the effective cap is the zone request limit |

**Large files**: uploads up to 32 MB are buffered by the Worker (which also recomputes the SHA-256 to verify the declared value). Larger files are streamed: VirusTotal uses a one-time `/files/upload_url` destination (650 MB per file) and the Worker never holds the file in memory. The Worker's inbound request body is still capped by the **domain plan**: Free / Pro 100 MB, Business 200 MB, Enterprise up to 5 GB via `Maximum Upload Size`. So on Free/Pro the real ceiling is 100 MB; true 650 MB uploads need an Enterprise zone, with no code change.

**Direct upload (`scanDirectUpload`, off by default)**: when enabled under Admin → Settings → Malware scanning, `/v1/scan/upload-target` hands the client a one-time VirusTotal upload URL together with the API key and the client posts the file itself, so no bytes travel through the Worker — faster, and not bound by the 100 MB inbound cap, but **the key reaches the client** and should only be enabled in a fully trusted environment. The client then registers the analysis ID via `/v1/scan/analysis`; the Worker still caches results by SHA-256 and enforces them in `/v1/sign`. With the switch off (the default) uploads stream through the Worker and the key never leaves the server.

Cloudmersive's free tier is 600 calls/month and 3.5 MB, and it only accepts uploads (no hash lookup), so it is not built in.

**Privacy and terms**: the VirusTotal public API adds submitted or queried files to its public corpus and may not be used in commercial products. Use MetaDefender or point the base URL at your own private scanner for sensitive builds, and confirm compliance before uploading.

**Trust model**: the Worker can only verify that the declared SHA-256 is clean in the scanning service; it cannot derive the raw file from the Authenticode digest. For uploads up to 32 MB the Worker recomputes the SHA-256 of the bytes and compares it with the declared value; larger streams cannot be hashed while relaying, so the Worker instead checks the file hash returned by the scanning service and discards the result on a mismatch. The API key holder is trusted; this guards against client bugs and accidental signing, not a malicious key holder.

### When the TSA is blocked

Enterprise security agents (Tencent iOA in our tests) block unsigned binaries from reaching the network, so a direct TSA call returns HTTP 403 with `检测到风险软件的网络连接`. The client reacts by retrying through `POST /v1/timestamp` with the same Bearer key, and the Worker forwards the request upstream. Use `--tsa worker` to force the proxy.

## Releases

| Trigger | Result |
| --- | --- |
| Push a `v*` tag (e.g. `v1.0`) | build 8 artifacts and publish a versioned release, marked Latest |
| `client/src/**`, `client/CMakeLists.txt` or `LICENSE` lands on `main` | build and refresh the [`beta`](https://github.com/PIKACHUIM/CertumSigner/releases/tag/beta) prerelease (never Latest) |
| Run the `Release` workflow manually | publish a release under the tag name you enter |

```bash
git tag v1.0 && git push origin v1.0        # cut a stable release
```

The old rolling `latest` release is gone: `/releases/latest` follows the newest **stable** release, and `beta` being a prerelease never takes that spot. The build lives in `.github/workflows/build-clients.yml` (reusable); `release.yml` and `beta.yml` are the two entry points.

### Signing the Windows binaries

Since `v1.3` the Windows `certumsigner.exe` is Authenticode-signed with the **Finnox Tech Ltd** Certum cloud certificate before it is packaged: CI runs this project's own CLI (`certumsigner sign`), which sends digests to the Worker and gets them signed by Certum's HSM — the private key never leaves the cloud. Two repository secrets are required:

| Secret | Value |
| --- | --- |
| `CERTUM_SIGNER_SERVER` | the platform URL, e.g. `https://certum.524228.xyz` |
| `CERTUM_SIGNER_API_KEY` | a `csk_…` key bound to the Finnox certificate |

Assign the Finnox certificate to the signing account in the admin console, create a key bound to it in the client, then store both values as secrets. Without them `beta` builds only warn and ship unsigned binaries, while a `v*` tag fails on purpose. Signing runs on x64 for both architectures (an x64 CLI signs the arm64 exe), and `WinVerifyTrust` is checked right after signing.

## Security notes

- **OTP seeds live in the KV credential record**; clients never see them and they are not part of signing. KV is encrypted at rest, but an API token that can read the namespace can read them in plaintext — scope production tokens to that single namespace.
- **API keys are stored as SHA-256 hashes only.** Plaintext is shown once (and deleted after 5 minutes); `/reveal` deletes the old hash and issues a new value. Keys bind `userId` + `credentialId`, so disabling a user or credential invalidates them immediately, and revoking a certificate's assignment makes every key bound to it fail with `403 credential_not_assigned` right away (the client, portal and console all flag those keys). The new client **generates the secret locally** and uploads only the hash plus prefix, so the server never sees the plaintext even once; the secret lives in the local `config.json` so `Use` can switch keys without rotating, and after wiping that file the only way back is `Rotate` — which invalidates the value on every other device.
- **Passwords** use salted PBKDF2-HMAC-SHA256 with 10,000 iterations for both users and admins; sessions are revocable KV records, writes check CSRF, and failed sign-ins are rate limited per IP.
  The iteration count is fixed at 10,000: Workers caps PBKDF2 at 100,000 and the free plan only allows 10 ms of CPU (10,000 iterations ≈ 2–3 ms). Changing the constant invalidates every stored password.
- **The signing endpoint accepts no arbitrary bytes**: digest length must match the algorithm exactly, at most 16 digests per call, and the client verifies each signature with the certificate public key before writing the file.

## Known limitations

- Stats use read-modify-write on KV and **lose counts under heavy concurrency**; use a Durable Object if you need exact numbers.
- Opening the console or credential pages may trigger a Certum sign-in (up to 3 OTP retries when not signed in); wrong credentials produce a few failed requests.
- Certum EV cards reject `SHA1` digests: `/v1/sign` returns `digest_algorithm_unsupported`. Use a certificate that supports it if you really need SHA-1.
- Only PE files (`.exe/.dll/.sys/.ocx`), no MSI / CAB / scripts.
- Malware scanning works on the raw-file SHA-256: up to 32 MB is buffered, 32–650 MB is streamed through the VirusTotal large-file channel, but the Worker inbound body is capped by the domain plan (Free / Pro 100 MB), so 650 MB needs an Enterprise zone. Free quotas (4 req/min on VT) also make auto scanning slow; stagger batch signing.
- The VirusTotal public API adds samples to its public corpus and is not licensed for commercial products; use MetaDefender or a private proxy for confidential builds.
- Workers limits subrequests: a single signing call uses 3–8 of them, so keep batches to a dozen or so digests.
- Registration and password reset are off by default; without Resend, only an admin can reset a password from the user detail page.

## Verification status

<details>
<summary>What has actually been tested</summary>

- Worker: `npx tsc --noEmit` passes; `npm test` passes 87 tests (TOTP against RFC 6238 vectors, multipart parsing, encoding/hashing, KV storage and password hashing, unique user emails, admin account setup and password change, runtime config round-trips, scan risk thresholds / result caching / upload SHA-256 verification / streaming large-file relay and hash cross-check / direct-upload target and analysis registration / client-generated key hash registration, rotation and deletion / 403 after a certificate assignment is revoked, the unassigned markers in the console and portal, Certum session/card cache invalidation when a credential's identity changes, total-quota boundaries and reset baselines, and the key-count cap with upload rate limiting).
- Real Certum path works end to end (2026-11, Windows x64): email + TOTP sign-in, `/v1/certificate` returns the EV code-signing certificate, `/v1/sign` turns a real SHA-256 digest into a 512-byte signature, and after writing it into a PE `WinVerifyTrust` reports **valid**; still valid with a real Certum timestamp.
- UI: four themes × light/dark, zh/en switching, dialogs, and mobile widths (390 / 563 px) checked page by page with no horizontal scrolling; captcha refresh and validation, settings persistence, user quotas and self-service key quota edits tested.
- Client: MSVC 14.44 + Windows SDK 10.0.22621 + static OpenSSL 3.5.9 with `/W4 /permissive-` and no warnings; the Win32 GUI completed sign-in → key rotation → drag-and-drop batch signing → `WinVerifyTrust`, and layout holds at 125% scaling.
- GitHub Actions: all four platform jobs succeed and the 8 assets match the download links on the landing page. The Linux GTK3 GUI really compiles in CI; interactive behaviour there is untested.

</details>

## Support

- Bugs and feature requests: [Issues](https://github.com/PIKACHUIM/CertumSigner/issues)
- Usage and deployment questions: [Discussions](https://github.com/PIKACHUIM/CertumSigner/discussions)
- Certum protocol details: [`docs/certum-api.md`](docs/certum-api.md)

## License

Released under [AGPL-3.0-or-later](LICENSE) (© 2026 pikachuren). Settings → License in the client opens an in-app page with the AGPL-3.0 notice plus the [official text](https://www.gnu.org/licenses/agpl-3.0.txt) and the source URL.

## Credits

- [Certum SimplySign](https://www.certum.pl/) for the cloud signing service
- [Hono](https://hono.dev/) and [Cloudflare Workers](https://workers.cloudflare.com/) for the runtime and framework
- [OpenSSL](https://www.openssl.org/), [libcurl](https://curl.se/libcurl/) and [GTK](https://www.gtk.org/) for the client
