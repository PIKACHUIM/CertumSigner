/**
 * 图形验证码：Workers 里没有 canvas，这里直接拼一张 SVG。
 * 答案单独存 KV（5 分钟、一次性），页面上只出现图片和随机 id。
 */
import type { Env } from "../types";
import { randomBytes, randomToken, constantTimeEqual } from "./encoding";

const PREFIX = "captcha:";
const TTL_SECONDS = 300;

export interface Captcha {
  id: string;
  svg: string;
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
