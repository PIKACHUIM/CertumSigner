/**
 * 管理员会话：cookie 里放 `sid.mac`，sid 是随机值，mac 用 SESSION_SECRET 做 HMAC，
 * 真正的会话记录（含 CSRF token）放 KV，可以随时吊销。
 */
import type { AdminSessionRecord, Env } from "../types";
import { base64UrlEncode, randomToken } from "../lib/encoding";

export const ADMIN_COOKIE = "cs_admin";
const ADMIN_KEY_PREFIX = "admin:";
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

function secretOf(env: Env): string {
  const secret = (env.SESSION_SECRET || env.ADMIN_PASSWORD || "").trim();
  if (!secret) throw new Error("缺少 SESSION_SECRET / ADMIN_PASSWORD，无法签名会话 cookie");
  return secret;
}

async function hmac(text: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return base64UrlEncode(new Uint8Array(mac)).slice(0, 32);
}

export async function createAdminSession(env: Env, ttlMs = DEFAULT_TTL_MS): Promise<{ record: AdminSessionRecord; cookie: string }> {
  const now = Date.now();
  const record: AdminSessionRecord = {
    id: randomToken(24),
    csrf: randomToken(18),
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  await env.CERTUM_KV.put(`${ADMIN_KEY_PREFIX}${record.id}`, JSON.stringify(record), {
    expirationTtl: Math.max(60, Math.floor(ttlMs / 1000)),
  });

  const mac = await hmac(record.id, secretOf(env));
  return { record, cookie: `${record.id}.${mac}` };
}

export async function readAdminSession(env: Env, cookieValue: string | undefined): Promise<AdminSessionRecord | null> {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0) return null;

  const sid = cookieValue.slice(0, dot);
  const mac = cookieValue.slice(dot + 1);
  const expected = await hmac(sid, secretOf(env));
  if (mac !== expected) return null;

  const record = await env.CERTUM_KV.get<AdminSessionRecord>(`${ADMIN_KEY_PREFIX}${sid}`, "json");
  if (!record || record.expiresAt < Date.now()) return null;
  return record;
}

export async function revokeAdminSession(env: Env, cookieValue: string | undefined): Promise<void> {
  if (!cookieValue) return;
  const sid = cookieValue.split(".")[0];
  if (sid) await env.CERTUM_KV.delete(`${ADMIN_KEY_PREFIX}${sid}`);
}
