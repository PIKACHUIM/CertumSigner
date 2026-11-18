/**
 * 普通用户：登录门户、自己建 API Key。用户名唯一，用 `uname:<小写>` 做索引。
 */
import type { Env, UserRecord } from "../types";
import { randomId } from "../lib/encoding";
import { hashPassword, verifyPassword } from "../lib/passwords";

const PREFIX = "user:";
const NAME_PREFIX = "uname:";

function validUsername(raw: string): string {
  const name = raw.trim();
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(name)) {
    throw new Error("用户名只能是 3~32 位字母、数字、下划线、点或短横线");
  }
  return name;
}

async function putNameIndex(env: Env, username: string, id: string): Promise<void> {
  await env.CERTUM_KV.put(`${NAME_PREFIX}${username.toLowerCase()}`, id);
}

export interface CreateUserInput {
  username: string;
  password: string;
  expiresAt?: number;
  credentialIds?: string[];
  createdBy: string;
}

export async function createUser(env: Env, input: CreateUserInput): Promise<UserRecord> {
  const username = validUsername(input.username);
  const existing = await env.CERTUM_KV.get(`${NAME_PREFIX}${username.toLowerCase()}`);
  if (existing) throw new Error("用户名已被占用");

  const record: UserRecord = {
    id: `user_${randomId()}`,
    username,
    passwordHash: await hashPassword(input.password),
    enabled: true,
    expiresAt: input.expiresAt,
    credentialIds: input.credentialIds ?? [],
    createdAt: Date.now(),
    createdBy: input.createdBy,
  };
  await env.CERTUM_KV.put(`${PREFIX}${record.id}`, JSON.stringify(record));
  await putNameIndex(env, username, record.id);
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
  return env.CERTUM_KV.get<UserRecord>(`${PREFIX}${id}`, "json");
}

export async function findUserByUsername(env: Env, username: string): Promise<UserRecord | null> {
  const id = await env.CERTUM_KV.get(`${NAME_PREFIX}${username.trim().toLowerCase()}`);
  if (!id) return null;
  return getUser(env, id);
}

export async function saveUser(env: Env, record: UserRecord): Promise<void> {
  await env.CERTUM_KV.put(`${PREFIX}${record.id}`, JSON.stringify(record));
}

export function userExpired(user: UserRecord, now = Date.now()): boolean {
  return !!user.expiresAt && user.expiresAt <= now;
}

export async function authenticateUser(env: Env, username: string, password: string): Promise<UserRecord | null> {
  const user = await findUserByUsername(env, username);
  if (!user) {
    // 用户不存在时也跑一次哈希，避免用响应时间探测用户名
    await verifyPassword(password, "pbkdf2$150000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    return null;
  }
  if (!user.enabled || userExpired(user)) return null;
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  user.lastLoginAt = Date.now();
  await saveUser(env, user);
  return user;
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
  patch: { expiresAt?: number | null; credentialIds?: string[]; password?: string },
): Promise<boolean> {
  const user = await getUser(env, id);
  if (!user) return false;
  if (patch.expiresAt !== undefined) user.expiresAt = patch.expiresAt ?? undefined;
  if (patch.credentialIds) user.credentialIds = [...new Set(patch.credentialIds)];
  if (patch.password) user.passwordHash = await hashPassword(patch.password);
  await saveUser(env, user);
  return true;
}

export async function deleteUser(env: Env, id: string): Promise<boolean> {
  const user = await getUser(env, id);
  if (!user) return false;
  await Promise.all([
    env.CERTUM_KV.delete(`${PREFIX}${id}`),
    env.CERTUM_KV.delete(`${NAME_PREFIX}${user.username.toLowerCase()}`),
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
