/**
 * Certum Signer —— Cloudflare Workers + Hono
 *
 *   /admin       管理后台（Key、统计、云端会话）
 *   /v1/sign     按哈希代理签名（SHA1 / SHA256）
 *   /health      探活
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { captchaAllowed, createCaptcha } from "./lib/captcha";
import { admin } from "./routes/admin";
import { clientApi } from "./routes/client";
import { user } from "./routes/user";
import { v1 } from "./routes/v1";
import { translator } from "./ui/i18n";
import { landingPage } from "./ui/landing";
import { applyPrefs, readPrefs, safeBack } from "./ui/prefs";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

/**
 * 统一安全响应头。
 *
 * 页面里有内联 <style>/<script>（服务端直出，没有构建步骤），所以 CSP 必须放开
 * 'unsafe-inline'；除此之外只允许本站与 Cloudflare Turnstile 的资源。
 * 这里不改响应体，只在 HTML 上补 CSP，避免影响 JSON 接口。
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "connect-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
].join("; ");

app.use("*", async (c, next) => {
  await next();

  const headers = new Headers(c.res.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  headers.set("referrer-policy", "no-referrer");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("cross-origin-opener-policy", "same-origin");

  if (new URL(c.req.url).protocol === "https:") {
    headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  }
  if ((headers.get("content-type") ?? "").includes("text/html") && !headers.has("content-security-policy")) {
    headers.set("content-security-policy", CSP);
  }

  c.res = new Response(c.res.body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  });
});

app.use(
  "/v1/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Api-Key"],
    maxAge: 86_400,
  }),
);

app.use(
  "/api/client/*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Session"],
    maxAge: 86_400,
  }),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "certum-signer",
    time: new Date().toISOString(),
  }),
);

app.get("/favicon.ico", (c) => c.body(null, 204));

/** 主页：产品介绍 + 客户端下载；登录入口统一从 /user/login 进入 */
app.get("/", (c) => {
  const prefs = readPrefs(c);
  return c.html(landingPage({ prefs, t: translator(prefs.lang) }));
});

/** 图形验证码：返回内联 SVG + 一次性 id，登录/注册/找回共用一个端点 */
app.get("/captcha", async (c) => {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (!(await captchaAllowed(c.env, ip))) {
    return c.json({ ok: false, error: { code: "too_many", message: "验证码请求过于频繁" } }, 429);
  }
  const captcha = await createCaptcha(c.env);
  c.header("cache-control", "no-store");
  return c.json({ ok: true, id: captcha.id, svg: captcha.svg });
});

/** 语言 / 主题 / 明暗切换：写 cookie 后跳回原页面（不带任何业务数据） */
app.get("/prefs", (c) => {
  const url = new URL(c.req.url);
  applyPrefs(c, {
    lang: url.searchParams.get("lang") ?? undefined,
    theme: url.searchParams.get("theme") ?? undefined,
    mode: url.searchParams.get("mode") ?? undefined,
  });
  return c.redirect(safeBack(url.searchParams.get("back"), "/"));
});

app.route("/v1", v1);
app.route("/api/client", clientApi);
app.route("/", admin);
app.route("/", user);

app.notFound((c) =>
  c.json({ ok: false, error: { code: "not_found", message: `接口不存在：${new URL(c.req.url).pathname}` } }, 404),
);

app.onError((error, c) => {
  console.error("[certum-signer] unhandled", error);
  // 不要把内部堆栈回给调用方
  return c.json({ ok: false, error: { code: "internal_error", message: "服务端内部错误" } }, 500);
});

export default app;
