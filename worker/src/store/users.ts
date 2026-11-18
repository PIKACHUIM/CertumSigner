/**
 * 普通用户：登录门户、自己建 API Key。用户名唯一，用 `uname:<小写>` 做索引。
 */
import type { Env, UserRecord } from "../types";
import { randomId } from "../lib/encoding.ts";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "../lib/passwords.ts";

const PREFIX = "user:";
const NAME_PREFIX = "uname:";
const MAIL_PREFIX = "umail:";

export function validUsername(raw: string): string {
  const name = raw.trim();
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(name)) {
    throw new Error("用户名只能是 3~32 位字母、数字、下划线、点或短横线");
  }
  return name;
}

export function validEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    throw new Error("邮箱格式不正确");
  }
  return email;
}

async function putNameIndex(env: Env, username: string, id: string): Promise<void> {
  await env.CERTUM_KV.put(`${NAME_PREFIX}${username.toLowerCase()}`, id);
}

async function clearMailIndex(env: Env, email?: string): Promise<void> {
  if (email) await env.CERTUM_KV.delete(`${MAIL_PREFIX}${email.toLowerCase()}`);
}

export interface CreateUserInput {
  username: string;
  password: string;
  email?: string;
  /** 管理员建的账号默认视为已验证；自助注册要显式传 false */
  emailVerified?: boolean;
  expiresAt?: number;
  credentialIds?: string[];
  dailyQuota?: number;
  createdBy: string;
}

export async function createUser(env: Env, input: CreateUserInput): Promise<UserRecord> {
  const username = validUsername(input.username);
  const existing = await env.CERTUM_KV.get(`${NAME_PREFIX}${username.toLowerCase()}`);
  if (existing) throw new Error("用户名已被占用");

  const email = input.email?.trim() ? validEmail(input.email) : undefined;
  if (email) {
    const owner = await env.CERTUM_KV.get(`${MAIL_PREFIX}${email}`);
    if (owner) throw new Error("该邮箱已被其他账号使用");
  }

  const record: UserRecord = {
    id: `user_${randomId()}`,
    username,
    passwordHash: await hashPassword(input.password),
    email,
    emailVerified: email ? input.emailVerified ?? true : undefined,
    enabled: true,
    expiresAt: input.expiresAt,
    credentialIds: input.credentialIds ?? [],
    dailyQuota: Math.max(0, Math.floor(input.dailyQuota ?? 0)),
    createdAt: Date.now(),
    createdBy: input.createdBy,
  };
  await env.CERTUM_KV.put(`${PREFIX}${record.id}`, JSON.stringify(record));
  await putNameIndex(env, username, record.id);
  if (email) await env.CERTUM_KV.put(`${MAIL_PREFIX}${email}`, record.id);
  return record;
}

export async function listUsers(env: Env): Promise<UserRecord[]> {
  const list = await env.CERTUM_KV.list({ prefix: PREFIX, limit: 1000 });
  const records: UserRecord[] = [];
  for (const item of list.keys) {
    const record = await env.CERTUM_KV.get<UserRecord>(item.name, "json");
    if (record) records.push(record);
  }
  return records.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getUser(env: Env, id: string): Promise<UserRecord | null> {
  if (!id) return null;
  const record = await env.CERTUM_KV.get<UserRecord>(`${PREFIX}${id}`, "json");
  return record ?? null;
}

export async function findUserByUsername(env: Env, username: string): Promise<UserRecord | null> {
  const id = await env.CERTUM_KV.get(`${NAME_PREFIX}${username.trim().toLowerCase()}`);
  if (!id) return null;
  return getUser(env, id);
}

export async function findUserByEmail(env: Env, email: string): Promise<UserRecord | null> {
  const id = await env.CERTUM_KV.get(`${MAIL_PREFIX}${email.trim().toLowerCase()}`);
  if (!id) return null;
  return getUser(env, id);
}

/** 账号或邮箱都能登录/找回：带 @ 的按邮箱解析 */
export async function findUserByLogin(env: Env, login: string): Promise<UserRecord | null> {
  const text = login.trim();
  if (!text) return null;
  return text.includes("@") ? findUserByEmail(env, text) : findUserByUsername(env, text);
}

export async function saveUser(env: Env, record: UserRecord): Promise<void> {
  await env.CERTUM_KV.put(`${PREFIX}${record.id}`, JSON.stringify(record));
}

export function userExpired(user: UserRecord, now = Date.now()): boolean {
  return !!user.expiresAt && user.expiresAt <= now;
}

export type UserAuthResult =
  | { status: "ok"; user: UserRecord }
  | { status: "unverified" }
  | { status: "bad" };

/**
 * 先校验口令再透露账号状态（停用 / 未验证），避免不知道口令就能探测账号。
 * 用户不存在时也跑一次哈希，避免用响应时间探测用户名。
 */
export async function authenticateUserDetailed(
  env: Env,
  username: string,
  password: string,
): Promise<UserAuthResult> {
  const user = await findUserByUsername(env, username);
  if (!user) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return { status: "bad" };
  }
  if (!(await verifyPassword(password, user.passwordHash))) return { status: "bad" };
  if (!user.enabled || userExpired(user)) return { status: "bad" };
  if (user.email && user.emailVerified === false) return { status: "unverified" };

  user.lastLoginAt = Date.now();
  await saveUser(env, user);
  return { status: "ok", user };
}

export async function authenticateUser(env: Env, username: string, password: string): Promise<UserRecord | null> {
  const result = await authenticateUserDetailed(env, username, password);
  return result.status === "ok" ? result.user : null;
}

export async function setUserEnabled(env: Env, id: string, enabled: boolean): Promise<boolean> {
  const user = await getUser(env, id);
  if (!user) return false;
  user.enabled = enabled;
  await saveUser(env, user);
  return true;
}

export async function updateUser(
  env: Env,
  id: string,
  patch: {
    expiresAt?: number | null;
    credentialIds?: string[];
    password?: string;
    /** undefined = 不改；null = 清空；字符串 = 设置（同时重置验证状态） */
    email?: string | null;
    emailVerified?: boolean;
    dailyQuota?: number;
  },
): Promise<boolean> {
  const user = await getUser(env, id);
  if (!user) return false;

  if (patch.expiresAt !== undefined) user.expiresAt = patch.expiresAt ?? undefined;
  if (patch.credentialIds) user.credentialIds = [...new Set(patch.credentialIds)];
  if (patch.password) user.passwordHash = await hashPassword(patch.password);
  if (patch.dailyQuota !== undefined) user.dailyQuota = Math.max(0, Math.floor(patch.dailyQuota));

  if (patch.email !== undefined) {
    if (patch.email === null || !patch.email.trim()) {
      await clearMailIndex(env, user.email);
      user.email = undefined;
      user.emailVerified = undefined;
    } else {
      const email = validEmail(patch.email);
      if (email !== user.email) {
        const owner = await env.CERTUM_KV.get(`${MAIL_PREFIX}${email}`);
        if (owner && owner !== user.id) throw new Error("该邮箱已被其他账号使用");
        await clearMailIndex(env, user.email);
        await env.CERTUM_KV.put(`${MAIL_PREFIX}${email}`, user.id);
        user.email = email;
        user.emailVerified = patch.emailVerified ?? false;
      } else if (patch.emailVerified !== undefined) {
        user.emailVerified = patch.emailVerified;
      }
    }
  } else if (patch.emailVerified !== undefined && user.email) {
    user.emailVerified = patch.emailVerified;
  }

  await saveUser(env, user);
  return true;
}

export async function deleteUser(env: Env, id: string): Promise<boolean> {
  const user = await getUser(env, id);
  if (!user) return false;
  await Promise.all([
    env.CERTUM_KV.delete(`${PREFIX}${id}`),
    env.CERTUM_KV.delete(`${NAME_PREFIX}${user.username.toLowerCase()}`),
    clearMailIndex(env, user.email),
  ]);
  return true;
}

/** 删除凭据时把它从所有用户身上摘掉 */
export async function detachCredentialFromUsers(env: Env, credentialId: string): Promise<void> {
  const users = await listUsers(env);
  await Promise.all(
    users
      .filter((user) => user.credentialIds.includes(credentialId))
      .map((user) => {
        user.credentialIds = user.credentialIds.filter((id) => id !== credentialId);
        return saveUser(env, user);
      }),
  );
}
