/**
 * 用户门户会话：与管理员共用 HMAC cookie 方案，但 cookie 名、KV 前缀、TTL 都独立。
 */
import type { Env, UserSessionRecord } from "../types";
import { base64UrlEncode, constantTimeEqual, randomToken } from "../lib/encoding.ts";
import { readSessionSecret, requireSessionSecret } from "../lib/session-secret.ts";

export const USER_COOKIE = "cs_user";
const PREFIX = "usess:";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function hmac(text: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`user:${text}`));
  return base64UrlEncode(new Uint8Array(mac)).slice(0, 32);
}

export async function createUserSession(
  env: Env,
  userId: string,
  ttlMs = DEFAULT_TTL_MS,
): Promise<{ record: UserSessionRecord; cookie: string }> {
  const now = Date.now();
  const record: UserSessionRecord = {
    id: randomToken(24),
    userId,
    csrf: randomToken(18),
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  await env.CERTUM_KV.put(`${PREFIX}${record.id}`, JSON.stringify(record), {
    expirationTtl: Math.max(60, Math.floor(ttlMs / 1000)),
  });

  const mac = await hmac(record.id, await requireSessionSecret(env));
  return { record, cookie: `${record.id}.${mac}` };
}

export async function readUserSession(env: Env, cookieValue: string | undefined): Promise<UserSessionRecord | null> {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return null;

  const sid = cookieValue.slice(0, dot);
  const mac = cookieValue.slice(dot + 1);
  const secret = await readSessionSecret(env);
  if (!secret) return null;
  const expected = await hmac(sid, secret);
  if (!constantTimeEqual(mac, expected)) return null;

  const record = await env.CERTUM_KV.get<UserSessionRecord>(`${PREFIX}${sid}`, "json");
  if (!record || record.expiresAt < Date.now()) return null;
  return record;
}

export async function revokeUserSession(env: Env, cookieValue: string | undefined): Promise<void> {
  if (!cookieValue) return;
  const sid = cookieValue.split(".")[0];
  if (sid) await env.CERTUM_KV.delete(`${PREFIX}${sid}`);
}

/** 重置密码后强制下线该用户的所有会话 */
export async function revokeUserSessionsOf(env: Env, userId: string): Promise<number> {
  const list = await env.CERTUM_KV.list({ prefix: PREFIX, limit: 1000 });
  let removed = 0;
  for (const item of list.keys) {
    const record = await env.CERTUM_KV.get<UserSessionRecord>(item.name, "json");
    if (record?.userId === userId) {
      await env.CERTUM_KV.delete(item.name);
      removed += 1;
    }
  }
  return removed;
}
