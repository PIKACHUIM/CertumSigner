/**
 * 验证码：两种方式，自绘 SVG 数字图（答案存 KV）或 Cloudflare Turnstile。
 * 选哪种由后台设置决定，Turnstile 密钥缺失时自动退回 SVG，避免把登录锁死。
 */
import type { Env } from "../types";
import type { CaptchaMode } from "../store/settings";
import { readConfig } from "../store/config";
import { randomBytes, randomToken, constantTimeEqual } from "./encoding";

const PREFIX = "captcha:";
const TTL_SECONDS = 300;
const TURNSTILE_VERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface Captcha {
  id: string;
  svg: string;
}

/** 登录页要渲染的东西：要么是一张图 + 一次性 id，要么是 Turnstile 挂件 */
export type CaptchaView =
  | { mode: "svg"; id: string; svg: string }
  | { mode: "turnstile"; siteKey: string };

/** 校验时要用到的表单值（不同验证码方式取不同字段） */
export interface CaptchaInput {
  id?: string;
  answer?: string;
  /** Turnstile 挂件写入的 cf-turnstile-response */
  token?: string;
  ip?: string;
}


function randomInt(max: number): number {
  const bytes = randomBytes(4);
  const value = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  return value % max;
}

function pick<T>(items: readonly T[]): T {
  return items[randomInt(items.length)]!;
}

const INK = ["#1f2937", "#25324a", "#3b2f5c", "#20343a", "#4a2b2b"];
const NOISE = ["#c7ccd8", "#b9c2d6", "#d3c3cd", "#c2d3c9"];

/** 生成 4 位数字，每个数字单独旋转、上下错位，再叠几条干扰线 */
function renderSvg(code: string): string {
  const digits = code
    .split("")
    .map((digit, index) => {
      const x = 16 + index * 26 + randomInt(4);
      const y = 28 + randomInt(5) - 2;
      const rotate = -16 + randomInt(33);
      const size = 24 + randomInt(4);
      return `<text x="${x}" y="${y}" fill="${pick(INK)}" font-family="ui-monospace,Menlo,Consolas,monospace"
        font-size="${size}" font-weight="700" transform="rotate(${rotate} ${x + 8} ${y - 8})">${digit}</text>`;
    })
    .join("");

  const lines = Array.from({ length: 4 }, () => {
    const x1 = randomInt(24);
    const y1 = randomInt(40);
    const x2 = 96 + randomInt(28);
    const y2 = randomInt(40);
    return `<path d="M${x1} ${y1} Q ${40 + randomInt(50)} ${randomInt(40)} ${x2} ${y2}"
      stroke="${pick(NOISE)}" stroke-width="${1 + randomInt(2)}" fill="none" opacity=".9"/>`;
  }).join("");

  const dots = Array.from({ length: 18 }, () => {
    const x = randomInt(120);
    const y = randomInt(40);
    return `<circle cx="${x}" cy="${y}" r="1" fill="${pick(NOISE)}"/>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40" role="img" aria-label="captcha">
  <rect width="120" height="40" rx="6" fill="#f4f5f9"/>
  ${dots}${lines}${digits}
</svg>`;
}

export async function createCaptcha(env: Env): Promise<Captcha> {
  const code = String(randomInt(9000) + 1000);
  const id = randomToken(12).replace(/[^A-Za-z0-9]/g, "");
  await env.CERTUM_KV.put(`${PREFIX}${id}`, JSON.stringify({ code, at: Date.now() }), {
    expirationTtl: TTL_SECONDS,
  });
  return { id, svg: renderSvg(code) };
}

/** 校验后立即删除，避免同一张图被反复尝试 */
export async function verifyCaptcha(env: Env, id: string, answer: string): Promise<boolean> {
  const clean = (id ?? "").trim();
  if (!clean || clean.length > 64 || !answer) return false;
  const key = `${PREFIX}${clean}`;
  const record = await env.CERTUM_KV.get<{ code: string; at: number }>(key, "json");
  await env.CERTUM_KV.delete(key);
  if (!record) return false;
  if (Date.now() - record.at > TTL_SECONDS * 1000) return false;
  return constantTimeEqual(record.code, answer.trim());
}

/** 简易限流：同一 IP 10 分钟内最多取 60 张，避免被刷 KV 写配额 */
export async function captchaAllowed(env: Env, ip: string): Promise<boolean> {
  const key = `capgen:${ip}`;
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const raw = await env.CERTUM_KV.get<{ count: number; firstAt: number }>(key, "json");
  const bucket = raw && now - raw.firstAt < windowMs ? raw : { count: 0, firstAt: now };
  bucket.count += 1;
  await env.CERTUM_KV.put(key, JSON.stringify(bucket), { expirationTtl: Math.floor(windowMs / 1000) });
  return bucket.count <= 60;
}

/** Turnstile 服务端校验：secret + 前端拿到的 token，一次有效 */
async function verifyTurnstile(secret: string, token: string, ip?: string): Promise<boolean> {
  if (!secret || !token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip && ip !== "unknown") body.set("remoteip", ip);
  try {
    const response = await fetch(TURNSTILE_VERIFY, { method: "POST", body });
    if (!response.ok) return false;
    const data = (await response.json()) as { success?: boolean } | null;
    return data?.success === true;
  } catch {
    // 校验服务不可达时按失败处理：宁可让用户重试，也不放行未经验证的请求
    return false;
  }
}

/**
 * 实际生效的方式：选了 Turnstile 但站点密钥 / 服务端密钥没配齐时退回图形验证码，
 * 免得上线后把所有登录都锁死。
 */
export async function resolveCaptchaMode(env: Env, mode: CaptchaMode): Promise<CaptchaMode> {
  if (mode !== "turnstile") return mode;
  const config = await readConfig(env);
  return config.turnstileSiteKey && config.turnstileSecretKey ? "turnstile" : "svg";
}

/** 生成登录页要用的验证码视图；off 时返回 undefined，页面不渲染该字段 */
export async function issueCaptcha(env: Env, mode: CaptchaMode): Promise<CaptchaView | undefined> {
  const effective = await resolveCaptchaMode(env, mode);
  if (effective === "off") return undefined;
  if (effective === "turnstile") {
    const config = await readConfig(env);
    return { mode: "turnstile", siteKey: config.turnstileSiteKey };
  }
  const captcha = await createCaptcha(env);
  return { mode: "svg", id: captcha.id, svg: captcha.svg };
}

/** 统一校验入口：off 直接放行，其余按当前生效的方式校验 */
export async function verifyCaptchaFor(env: Env, mode: CaptchaMode, input: CaptchaInput): Promise<boolean> {
  const effective = await resolveCaptchaMode(env, mode);
  if (effective === "off") return true;
  if (effective === "turnstile") {
    const config = await readConfig(env);
    return verifyTurnstile(config.turnstileSecretKey, input.token ?? "", input.ip);
  }
  return verifyCaptcha(env, input.id ?? "", input.answer ?? "");
}

