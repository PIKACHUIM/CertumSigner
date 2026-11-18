/**
 * 会话 cookie 的 HMAC 密钥来源，按优先级：
 *   1. SESSION_SECRET（secret）
 *   2. ADMIN_PASSWORD（旧版部署只有这一个 secret）
 *   3. 初始化流程写进 KV 的随机值（`admin:secret`）
 *
 * 第 3 种让「没配任何 secret 的全新部署」也能在 /admin/setup 建好账号后直接登录，
 * 不必再回头去 `wrangler secret put`。
 */
import type { Env } from "../types";
import { randomToken } from "./encoding.ts";

const SECRET_KEY = "admin:secret";

/** 已经可用的密钥；没有任何来源时返回空串，由调用方决定报错还是引导初始化 */
export async function readSessionSecret(env: Env): Promise<string> {
  const fromEnv = (env.SESSION_SECRET || env.ADMIN_PASSWORD || "").trim();
  if (fromEnv) return fromEnv;
  const stored = await env.CERTUM_KV.get(SECRET_KEY);
  return (stored ?? "").trim();
}

/** 初始化时调用：没有密钥就生成一个 32 字节随机值存 KV */
export async function ensureSessionSecret(env: Env): Promise<string> {
  const current = await readSessionSecret(env);
  if (current) return current;
  const generated = randomToken(32);
  await env.CERTUM_KV.put(SECRET_KEY, generated);
  return generated;
}

export async function requireSessionSecret(env: Env): Promise<string> {
  const secret = await readSessionSecret(env);
  if (!secret) throw new Error("缺少 SESSION_SECRET，请先完成 /admin/setup 初始化");
  return secret;
}
