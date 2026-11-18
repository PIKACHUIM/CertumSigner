/**
 * 管理员账号：首次打开后台时由 /admin/setup 创建，口令以 PBKDF2 存在 KV。
 *
 * 三种状态：
 *   unconfigured —— 既没有 KV 账号也没有 ADMIN_PASSWORD，只能进初始化页
 *   account      —— 有 KV 账号，用户名 + 口令登录（推荐）
 *   env          —— 只有 ADMIN_PASSWORD secret，沿用旧版单密码登录
 */
import type { AdminAccountRecord, Env } from "../types";
import { constantTimeEqual, randomId } from "../lib/encoding.ts";
import { hashPassword, verifyPassword } from "../lib/passwords.ts";
import { ensureSessionSecret } from "../lib/session-secret.ts";
import { validUsername } from "./users.ts";

const ACCOUNT_KEY = "admin:account";

/** 管理员口令下限：比普通用户更严一点，控制台权限更大 */
export const ADMIN_PASSWORD_MIN = 10;

export type AdminAuthMode = "unconfigured" | "account" | "env";

export interface AdminAuthState {
  mode: AdminAuthMode;
  account?: AdminAccountRecord;
}

export async function readAdminAccount(env: Env): Promise<AdminAccountRecord | null> {
  const record = await env.CERTUM_KV.get<AdminAccountRecord>(ACCOUNT_KEY, "json");
  if (!record || !record.passwordHash || !record.username) return null;
  return record;
}

export async function adminAuthState(env: Env): Promise<AdminAuthState> {
  const account = await readAdminAccount(env);
  if (account) return { mode: "account", account };
  if ((env.ADMIN_PASSWORD ?? "").trim()) return { mode: "env" };
  return { mode: "unconfigured" };
}

function checkPasswordLength(password: string): void {
  if (password.length < ADMIN_PASSWORD_MIN) {
    throw new Error(`管理员口令至少 ${ADMIN_PASSWORD_MIN} 位`);
  }
  if (password.length > 200) throw new Error("口令过长");
}

export async function createAdminAccount(
  env: Env,
  input: { username: string; password: string },
): Promise<AdminAccountRecord> {
  const username = validUsername(input.username);
  checkPasswordLength(input.password);
  if (await readAdminAccount(env)) throw new Error("已经初始化过管理员账号");

  const now = Date.now();
  const record: AdminAccountRecord = {
    id: randomId("adm_"),
    username,
    passwordHash: await hashPassword(input.password),
    createdAt: now,
    updatedAt: now,
  };
  await env.CERTUM_KV.put(ACCOUNT_KEY, JSON.stringify(record));
  // 顺手准备好会话密钥，省掉一次 wrangler secret put
  await ensureSessionSecret(env);
  return record;
}

export async function setAdminPassword(env: Env, password: string): Promise<AdminAccountRecord> {
  const account = await readAdminAccount(env);
  if (!account) throw new Error("还没有创建管理员账号");
  checkPasswordLength(password);
  account.passwordHash = await hashPassword(password);
  account.updatedAt = Date.now();
  await env.CERTUM_KV.put(ACCOUNT_KEY, JSON.stringify(account));
  return account;
}

/**
 * 校验用户名 + 口令。用户名不对时也走一遍 PBKDF2，
 * 避免用响应时间判断用户名是否存在。
 */
export async function checkAdminCredentials(env: Env, username: string, password: string): Promise<boolean> {
  const account = await readAdminAccount(env);
  if (!account || !password) return false;
  const matched = constantTimeEqual(account.username.toLowerCase(), username.trim().toLowerCase());
  const ok = await verifyPassword(password, account.passwordHash);
  return matched && ok;
}

export async function touchAdminLogin(env: Env, account: AdminAccountRecord): Promise<void> {
  const now = Date.now();
  account.lastLoginAt = now;
  await env.CERTUM_KV.put(ACCOUNT_KEY, JSON.stringify(account));
}
