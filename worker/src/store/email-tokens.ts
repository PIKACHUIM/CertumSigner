/**
 * 邮件一次性令牌：注册验证 24 小时，找回密码 1 小时。
 * token 本身是随机串，KV 里存的是令牌对应的用户与用途。
 */
import type { Env } from "../types";
import { randomToken } from "../lib/encoding";

export type EmailTokenPurpose = "verify" | "reset";

export interface EmailTokenRecord {
  token: string;
  userId: string;
  email: string;
  purpose: EmailTokenPurpose;
  createdAt: number;
  expiresAt: number;
}

const PREFIX = "emailtok:";
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

export async function createEmailToken(
  env: Env,
  input: { userId: string; email: string; purpose: EmailTokenPurpose; ttlMs: number },
): Promise<string> {
  const token = randomToken(24);
  const now = Date.now();
  const record: EmailTokenRecord = {
    token,
    userId: input.userId,
    email: input.email,
    purpose: input.purpose,
    createdAt: now,
    expiresAt: now + input.ttlMs,
  };
  await env.CERTUM_KV.put(`${PREFIX}${token}`, JSON.stringify(record), {
    expirationTtl: Math.max(60, Math.floor(input.ttlMs / 1000)),
  });
  return token;
}

export async function peekEmailToken(env: Env, token: string): Promise<EmailTokenRecord | null> {
  const clean = (token ?? "").trim();
  if (!clean || clean.length > 128) return null;
  const record = await env.CERTUM_KV.get<EmailTokenRecord>(`${PREFIX}${clean}`, "json");
  if (!record || record.expiresAt < Date.now()) return null;
  return record;
}

/** 用过即作废；用途不匹配时也顺手删掉，避免被跨流程复用 */
export async function consumeEmailToken(
  env: Env,
  token: string,
  purpose: EmailTokenPurpose,
): Promise<EmailTokenRecord | null> {
  const record = await peekEmailToken(env, token);
  if (!record || record.purpose !== purpose) return null;
  await env.CERTUM_KV.delete(`${PREFIX}${record.token}`);
  return record;
}
