/**
 * API Key：明文只在创建时返回一次，KV 里只存 SHA-256，泄库也拿不回可用 key。
 */
import type { ApiKeyRecord, Env } from "../types";
import { randomId, randomToken, sha256Hex, toHex, randomBytes } from "../lib/encoding.ts";
import { getUser, userExpired } from "./users.ts";

const PREFIX = "key:";

export interface CreateKeyInput {
  name: string;
  dailyQuota?: number;
  expiresAt?: number;
  createdBy: string;
  /** 归属用户；管理员建的“平台 Key”留空 */
  userId?: string;
  /** 绑定哪套 Certum 凭据 */
  credentialId: string;
}

export interface CreatedKey {
  /** 只有这一次能看到 */
  plaintext: string;
  record: ApiKeyRecord;
}

function storageKey(hash: string): string {
  return `${PREFIX}${hash}`;
}

function normalizeKeyName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error("Key 名称不能为空");
  if (name.length > 64) throw new Error("Key 名称过长（最多 64 字符）");
  return name;
}

/** 客户端本地生成 Key 时只上传哈希与前缀，服务端永远拿不到明文 */
function clientHash(value: string): string {
  const hash = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("Key 哈希格式不正确（需要 64 位十六进制）");
  return hash;
}

function clientPrefix(value: string): string {
  const prefix = value.trim();
  if (!/^csk_[A-Za-z0-9_-]{6,32}$/.test(prefix)) throw new Error("Key 前缀格式不正确");
  return prefix;
}

function buildRecord(input: CreateKeyInput, hash: string, prefix: string): ApiKeyRecord {
  return {
    id: randomId(),
    name: normalizeKeyName(input.name),
    hash,
    prefix,
    createdAt: Date.now(),
    createdBy: input.createdBy,
    enabled: true,
    dailyQuota: Math.max(0, Math.floor(input.dailyQuota ?? 0)),
    expiresAt: input.expiresAt,
    totalSigns: 0,
    userId: input.userId,
    credentialId: input.credentialId,
  };
}

export async function createApiKey(env: Env, input: CreateKeyInput): Promise<CreatedKey> {
  const plaintext = `csk_${randomToken(24)}`;
  const hash = await sha256Hex(plaintext);
  const record = buildRecord(input, hash, plaintext.slice(0, 12));

  await env.CERTUM_KV.put(storageKey(hash), JSON.stringify(record));
  return { plaintext, record };
}

/**
 * 注册客户端自己生成的 Key：只收 SHA-256 与前缀。
 * 明文从未离开客户端，平台侧即使读库也只能拿到哈希。
 */
export async function createApiKeyFromHash(
  env: Env,
  input: CreateKeyInput & { hash: string; prefix: string },
): Promise<ApiKeyRecord> {
  const hash = clientHash(input.hash);
  const prefix = clientPrefix(input.prefix);
  if (await env.CERTUM_KV.get(storageKey(hash))) throw new Error("这把 Key 已经注册过了");

  const record = buildRecord(input, hash, prefix);
  await env.CERTUM_KV.put(storageKey(hash), JSON.stringify(record));
  return record;
}

export async function listApiKeys(env: Env): Promise<ApiKeyRecord[]> {
  const list = await env.CERTUM_KV.list({ prefix: PREFIX, limit: 1000 });
  const records: ApiKeyRecord[] = [];
  for (const item of list.keys) {
    const record = await env.CERTUM_KV.get<ApiKeyRecord>(item.name, "json");
    if (record) records.push(record);
  }
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listKeysOfUser(env: Env, userId: string): Promise<ApiKeyRecord[]> {
  return (await listApiKeys(env)).filter((key) => key.userId === userId);
}

export async function listPlatformKeys(env: Env): Promise<ApiKeyRecord[]> {
  return (await listApiKeys(env)).filter((key) => !key.userId);
}

export async function findApiKeyById(env: Env, id: string): Promise<ApiKeyRecord | null> {
  const list = await env.CERTUM_KV.list({ prefix: PREFIX, limit: 1000 });
  for (const item of list.keys) {
    const record = await env.CERTUM_KV.get<ApiKeyRecord>(item.name, "json");
    if (record?.id === id) return record;
  }
  return null;
}

export async function saveApiKey(env: Env, record: ApiKeyRecord): Promise<void> {
  await env.CERTUM_KV.put(storageKey(record.hash), JSON.stringify(record));
}

export async function verifyApiKey(env: Env, raw: string): Promise<ApiKeyRecord | null> {
  const key = raw.trim();
  if (!key || key.length < 16) return null;

  const record = await env.CERTUM_KV.get<ApiKeyRecord>(storageKey(await sha256Hex(key)), "json");
  if (!record) return null;
  if (!record.enabled) return null;
  if (record.expiresAt && record.expiresAt < Date.now()) return null;
  // Key 属于某个用户时，用户被停用/过期后 Key 立即失效
  if (record.userId) {
    const owner = await getUser(env, record.userId);
    if (!owner || !owner.enabled || userExpired(owner)) return null;
  }
  return record;
}

/** 记录使用情况；节流到每分钟最多写一次，避免签名频繁时把 KV 写配额打满 */
export async function touchApiKey(env: Env, record: ApiKeyRecord, signedCount: number): Promise<void> {
  const now = Date.now();
  const shouldTouch = !record.lastUsedAt || now - record.lastUsedAt > 60_000;
  if (!shouldTouch) return;
  record.lastUsedAt = now;
  record.totalSigns += signedCount;
  await saveApiKey(env, record);
}

export async function setApiKeyEnabled(env: Env, id: string, enabled: boolean): Promise<boolean> {
  const record = await findApiKeyById(env, id);
  if (!record) return false;
  record.enabled = enabled;
  await saveApiKey(env, record);
  return true;
}

/** 改名称 / 每日限额（0 = 不限） / 归属 / 绑定凭据；不传的字段保持不变 */
export async function updateApiKey(
  env: Env,
  id: string,
  patch: { name?: string; dailyQuota?: number; userId?: string | null; credentialId?: string },
): Promise<boolean> {
  const record = await findApiKeyById(env, id);
  if (!record) return false;
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("Key 名称不能为空");
    if (name.length > 64) throw new Error("Key 名称过长（最多 64 字符）");
    record.name = name;
  }
  if (patch.dailyQuota !== undefined) record.dailyQuota = Math.max(0, Math.floor(patch.dailyQuota));
  // null 表示收回归属，变回平台密钥
  if (patch.userId !== undefined) record.userId = patch.userId || undefined;
  if (patch.credentialId !== undefined) record.credentialId = patch.credentialId;
  await saveApiKey(env, record);
  return true;
}

export async function deleteApiKey(env: Env, id: string): Promise<boolean> {
  const record = await findApiKeyById(env, id);
  if (!record) return false;
  await env.CERTUM_KV.delete(storageKey(record.hash));
  return true;
}

/**
 * 给已有 Key 换一个新的明文（旧值立即失效）。
 * KV 里只存哈希，客户端「登录后选择已有 Key」只能走这条路拿到可用的明文。
 */
export async function rotateApiKey(env: Env, id: string): Promise<CreatedKey | null> {
  const record = await findApiKeyById(env, id);
  if (!record) return null;

  const plaintext = `csk_${randomToken(24)}`;
  const hash = await sha256Hex(plaintext);
  await env.CERTUM_KV.delete(storageKey(record.hash));

  record.hash = hash;
  record.prefix = plaintext.slice(0, 12);
  record.lastUsedAt = undefined;
  await saveApiKey(env, record);
  return { plaintext, record };
}

export function newKeyId(): string {
  return toHex(randomBytes(6));
}

/** 客户端换发：新明文同样在客户端生成，服务端只接收新哈希 */
export async function rotateApiKeyToHash(
  env: Env,
  id: string,
  rawHash: string,
  rawPrefix: string,
): Promise<ApiKeyRecord | null> {
  const record = await findApiKeyById(env, id);
  if (!record) return null;

  const hash = clientHash(rawHash);
  const prefix = clientPrefix(rawPrefix);
  if (hash !== record.hash && (await env.CERTUM_KV.get(storageKey(hash)))) {
    throw new Error("这把 Key 已经注册过了");
  }

  await env.CERTUM_KV.delete(storageKey(record.hash));
  record.hash = hash;
  record.prefix = prefix;
  record.lastUsedAt = undefined;
  await saveApiKey(env, record);
  return record;
}

/** 删除用户时顺手吊销他的所有 Key */
export async function deleteKeysOfUser(env: Env, userId: string): Promise<number> {
  const keys = await listKeysOfUser(env, userId);
  await Promise.all(keys.map((key) => env.CERTUM_KV.delete(storageKey(key.hash))));
  return keys.length;
}

/** 每日用量（用于限额），按 UTC 日期分桶，两天后自动过期 */
function quotaKey(id: string): string {
  return `keyuse:${id}:${new Date().toISOString().slice(0, 10)}`;
}

export async function getDailyUsage(env: Env, id: string): Promise<number> {
  const value = await env.CERTUM_KV.get(quotaKey(id));
  const parsed = Number(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function bumpDailyUsage(env: Env, id: string, count: number): Promise<void> {
  const current = await getDailyUsage(env, id);
  await env.CERTUM_KV.put(quotaKey(id), String(current + count), { expirationTtl: 2 * 24 * 60 * 60 });
}

/** 用户级每日用量：该用户名下所有 Key 的签名合计 */
function userQuotaKey(id: string): string {
  return `useruse:${id}:${new Date().toISOString().slice(0, 10)}`;
}

export async function getUserDailyUsage(env: Env, id: string): Promise<number> {
  const value = await env.CERTUM_KV.get(userQuotaKey(id));
  const parsed = Number(value ?? "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function bumpUserDailyUsage(env: Env, id: string, count: number): Promise<void> {
  const current = await getUserDailyUsage(env, id);
  await env.CERTUM_KV.put(userQuotaKey(id), String(current + count), { expirationTtl: 2 * 24 * 60 * 60 });
}
