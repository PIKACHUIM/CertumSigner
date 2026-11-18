/**
 * 第 1 步：用邮箱 + TOTP 登录 Certum（CAS 授权码流程），换出 bearer token。
 *
 * 流程（对照 SimplySign Desktop 的实际请求）：
 *   GET  /idp/oauth2.0/authorize?...      -> 302 到登录页
 *   GET  /idp/login?service=...           -> 200，页面里带隐藏的 execution
 *   POST /idp/login?service=...           -> 302 … -> redirect?code=...
 *   POST /idp/oauth2.0/accessToken?...    -> {"access_token": ..., "expires_in": 1800}
 */
import { CookieJar } from "../lib/cookies";
import { totpNow } from "../lib/totp";
import type { OtpConfig } from "../lib/totp";
import type { CertumEndpoints } from "./config";
import { CertumError, snippet } from "./errors";

const UA = "CertumSigner/1.0";

export interface LoginResult {
  token: string;
  refreshToken?: string;
  expiresIn: number;
}

interface HopResult {
  res: Response;
  url: string;
  visited: string[];
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'");
}

function extractHidden(html: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<input[^>]*\\bname=["']${escaped}["'][^>]*\\bvalue=["']([^"']*)["']`, "i"),
    new RegExp(`<input[^>]*\\bvalue=["']([^"']*)["'][^>]*\\bname=["']${escaped}["']`, "i"),
  ];
  for (const re of patterns) {
    const match = re.exec(html);
    if (match?.[1] !== undefined) return decodeEntities(match[1]);
  }
  return null;
}

function codeFromUrl(raw: string): string | null {
  try {
    return new URL(raw).searchParams.get("code");
  } catch {
    return null;
  }
}

/** 手动跟随重定向：Workers 的 fetch 不带 cookie，必须自己一跳一跳走 */
async function follow(
  jar: CookieJar,
  startUrl: string,
  init: { method?: string; body?: string; headers?: Record<string, string> },
  maxHops = 25,
): Promise<HopResult> {
  let url = startUrl;
  let method = init.method ?? "GET";
  let body = init.body;
  const visited: string[] = [startUrl];

  for (let hop = 0; hop < maxHops; hop++) {
    const headers = new Headers(init.headers);
    headers.set("user-agent", UA);
    const cookie = jar.header();
    if (cookie) headers.set("cookie", cookie);

    const res = await fetch(url, { method, body, headers, redirect: "manual" });
    jar.absorb(res.headers);

    const location = res.headers.get("location");
    const redirecting = res.status >= 300 && res.status < 400 && !!location;
    if (!redirecting) return { res, url, visited };

    const next = new URL(location!, url);
    visited.push(next.toString());
    url = next.toString();

    // 303（以及登录 POST 的 302）之后浏览器会改成 GET；不照做的话 CAS 会拒
    if (method === "POST" && (res.status === 303 || res.status === 302)) {
      method = "GET";
      body = undefined;
    }

    // 授权码已经在跳转目标里了，不需要真的去请求 /redirect
    if (next.searchParams.get("code")) return { res, url, visited };
  }

  throw new CertumError("login_redirect_loop", "登录重定向次数过多，CAS 流程异常");
}

/** 单次登录尝试：失败多半是密码过期或邮箱不对 */
async function loginOnce(
  endpoints: CertumEndpoints,
  email: string,
  otp: OtpConfig,
): Promise<LoginResult> {
  const jar = new CookieJar();

  const authorize = new URL(endpoints.authorizeUrl);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", endpoints.clientId);
  authorize.searchParams.set("redirect_uri", endpoints.redirectUri);
  authorize.searchParams.set("scope", endpoints.scope);
  authorize.searchParams.set("api_key", "");

  const landing = await follow(jar, authorize.toString(), { method: "GET" });
  if (!landing.res.ok) {
    throw new CertumError(
      "login_page",
      `打开登录页失败（HTTP ${landing.res.status}）`,
      502,
      snippet(await landing.res.text()),
    );
  }

  const html = await landing.res.text();
  const execution = extractHidden(html, "execution");
  if (!execution) {
    throw new CertumError("login_form", "登录页里找不到 execution 字段，Certum 登录页结构可能变了");
  }

  let service: string | null = null;
  try {
    service = new URL(landing.url).searchParams.get("service");
  } catch {
    service = null;
  }

  const code = await totpNow(otp);
  const form = new URLSearchParams();
  form.set("username", email);
  form.set("password", code);
  form.set("execution", execution);
  form.set("_eventId", "submit");
  form.set("geolocation", "");
  form.set("submit", "LOGIN");
  form.set("lt", "");

  const postUrl = new URL(endpoints.loginUrl);
  if (service) postUrl.searchParams.set("service", service);

  const afterLogin = await follow(jar, postUrl.toString(), {
    method: "POST",
    body: form.toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });

  let authCode: string | null = null;
  for (const visited of [...afterLogin.visited, afterLogin.url]) {
    authCode = codeFromUrl(visited);
    if (authCode) break;
  }

  if (!authCode) {
    const bodyText = await afterLogin.res.text().catch(() => "");
    throw new CertumError(
      "login_rejected",
      `登录没有拿到授权码：邮箱或 TOTP 密码不对（也可能是本机时间偏差超过 30 秒）`,
      401,
      snippet(bodyText),
    );
  }

  const tokenUrl = new URL(endpoints.tokenUrl);
  tokenUrl.searchParams.set("client_id", endpoints.clientId);
  tokenUrl.searchParams.set("client_secret", endpoints.clientSecret);
  tokenUrl.searchParams.set("scope", endpoints.scope);
  tokenUrl.searchParams.set("code", authCode);
  tokenUrl.searchParams.set("redirect_uri", endpoints.redirectUri);
  tokenUrl.searchParams.set("grant_type", "authorization_code");

  const headers: Record<string, string> = { "user-agent": UA };
  const cookie = jar.header();
  if (cookie) headers.cookie = cookie;

  const tokenRes = await fetch(tokenUrl.toString(), { method: "POST", headers, redirect: "manual" });
  const tokenText = await tokenRes.text();
  if (!tokenRes.ok) {
    throw new CertumError(
      "token_exchange",
      `交换 access_token 失败（HTTP ${tokenRes.status}）`,
      502,
      snippet(tokenText),
    );
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(tokenText) as Record<string, unknown>;
  } catch {
    throw new CertumError("token_json", "accessToken 返回的不是 JSON", 502, snippet(tokenText));
  }

  const token = payload["access_token"];
  if (typeof token !== "string" || !token) {
    throw new CertumError("token_missing", "accessToken 响应里没有 access_token", 502, snippet(tokenText));
  }

  const expiresIn = typeof payload["expires_in"] === "number" ? (payload["expires_in"] as number) : 1800;
  const refreshToken = typeof payload["refresh_token"] === "string" ? (payload["refresh_token"] as string) : undefined;
  return { token, refreshToken, expiresIn };
}

/**
 * 登录，失败自动换新密码重试。
 * 失败重试很重要：密码只有 30 秒寿命，网络慢或刚好跨时间片时会白跑一次。
 */
export async function loginWithOtp(
  endpoints: CertumEndpoints,
  email: string,
  otp: OtpConfig,
  attempts = 3,
): Promise<LoginResult> {
  if (!email) throw new CertumError("config", "凭据缺少登录邮箱", 500);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await loginOnce(endpoints, email, otp);
    } catch (error) {
      lastError = error;
      if (error instanceof CertumError && error.code === "login_redirect_loop") throw error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  throw lastError instanceof CertumError
    ? lastError
    : new CertumError("login_failed", `登录失败：${String(lastError)}`, 502);
}

/** 用 refresh_token 续期，失败返回 null 由调用方回退到完整登录 */
export async function refreshToken(
  endpoints: CertumEndpoints,
  token: string,
): Promise<LoginResult | null> {
  const url = new URL(endpoints.tokenUrl);
  url.searchParams.set("client_id", endpoints.clientId);
  url.searchParams.set("client_secret", endpoints.clientSecret);
  url.searchParams.set("scope", endpoints.scope);
  url.searchParams.set("refresh_token", token);
  url.searchParams.set("grant_type", "refresh_token");

  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: { "user-agent": UA },
      redirect: "manual",
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as Record<string, unknown>;
    const accessToken = payload["access_token"];
    if (typeof accessToken !== "string" || !accessToken) return null;
    return {
      token: accessToken,
      refreshToken:
        typeof payload["refresh_token"] === "string" ? (payload["refresh_token"] as string) : token,
      expiresIn: typeof payload["expires_in"] === "number" ? (payload["expires_in"] as number) : 1800,
    };
  } catch {
    return null;
  }
}
