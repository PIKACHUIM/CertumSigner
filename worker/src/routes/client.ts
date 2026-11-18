/**
 * 桌面客户端用的 JSON 接口：用户名口令登录 → 选择/新建 API Key。
 *
 * 客户端只在首次登录时用这些接口拿 Key，之后签名直接走 /v1/*（Bearer csk_…），
 * 所以这里的会话 token 复用了用户门户的会话（sid.hmac），可以随时在 KV 里吊销。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { ApiKeyRecord, Env, UserRecord, UserSessionRecord } from "../types";
import { authenticateUser, getUser, userExpired } from "../store/users";
import { listCredentials } from "../store/credentials";
import { createApiKey, findApiKeyById, listKeysOfUser, rotateApiKey } from "../store/keys";
import { createUserSession, readUserSession, revokeUserSession } from "../store/user-sessions";

export type ClientEnv = {
  Bindings: Env;
  Variables: { clientSession: UserSessionRecord; clientUser: UserRecord };
};

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 8;

interface KeyView {
  id: string;
  name: string;
  prefix: string;
  credentialId: string;
  enabled: boolean;
  dailyQuota: number;
  createdAt: number;
}

interface CredentialView {
  id: string;
  label: string;
  email: string;
}

function keyView(record: ApiKeyRecord): KeyView {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    credentialId: record.credentialId,
    enabled: record.enabled,
    dailyQuota: record.dailyQuota,
    createdAt: record.createdAt,
  };
}

function fail(c: Context<ClientEnv>, status: 400 | 401 | 403 | 404 | 429 | 500, code: string, message: string, extra?: Record<string, unknown>): Response {
  return c.json({ ok: false, error: { code, message }, ...extra }, status);
}

function clientIp(c: Context<ClientEnv>): string {
  return c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

async function bumpFailure(env: Env, ip: string): Promise<void> {
  const key = `clientfail:${ip}`;
  const now = Date.now();
  const raw = await env.CERTUM_KV.get<{ count: number; firstAt: number }>(key, "json");
  const bucket = raw && now - raw.firstAt < FAIL_WINDOW_MS ? raw : { count: 0, firstAt: now };
  bucket.count += 1;
  await env.CERTUM_KV.put(key, JSON.stringify(bucket), { expirationTtl: Math.floor(FAIL_WINDOW_MS / 1000) });
}

async function failureCount(env: Env, ip: string): Promise<number> {
  const raw = await env.CERTUM_KV.get<{ count: number; firstAt: number }>(`clientfail:${ip}`, "json");
  if (!raw) return 0;
  return Date.now() - raw.firstAt < FAIL_WINDOW_MS ? raw.count : 0;
}

/** 请求体：JSON 或表单都接受，桌面端用 JSON，浏览器调试用表单 */
async function readBody(c: Context<ClientEnv>): Promise<Record<string, string>> {
  const type = c.req.header("content-type") ?? "";
  if (type.includes("application/json")) {
    const data = await c.req.json<Record<string, unknown>>().catch(() => null);
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(data ?? {})) {
      if (typeof value === "string") out[key] = value.trim();
      else if (typeof value === "number") out[key] = String(value);
    }
    return out;
  }
  const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") out[key] = value.trim();
  }
  return out;
}

function bearer(c: Context<ClientEnv>): string {
  const header = c.req.header("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return c.req.header("x-session")?.trim() ?? "";
}

export const clientApi = new Hono<ClientEnv>();

/* --------------------------------- 登录 ---------------------------------- */

clientApi.post("/login", async (c) => {
  const ip = clientIp(c);
  if ((await failureCount(c.env, ip)) >= MAX_FAILURES) {
    return fail(c, 429, "too_many_attempts", "尝试次数过多，请 10 分钟后再试");
  }

  const body = await readBody(c);
  const username = body.username ?? "";
  const password = body.password ?? "";
  if (!username || !password) {
    return fail(c, 400, "missing_fields", "请填写用户名和口令");
  }

  const account = await authenticateUser(c.env, username, password);
  if (!account) {
    await bumpFailure(c.env, ip);
    return fail(c, 401, "bad_credentials", "用户名或口令错误");
  }

  await c.env.CERTUM_KV.delete(`clientfail:${ip}`);
  const { record, cookie } = await createUserSession(c.env, account.id, TTL_MS);

  const [keys, credentials] = await Promise.all([
    listKeysOfUser(c.env, account.id),
    listCredentials(c.env),
  ]);

  return c.json({
    ok: true,
    token: cookie,
    expiresAt: record.expiresAt,
    user: { id: account.id, username: account.username, expiresAt: account.expiresAt ?? 0 },
    credentials: credentials
      .filter((cred) => account.credentialIds.includes(cred.id))
      .map((cred): CredentialView => ({ id: cred.id, label: cred.label, email: cred.email })),
    keys: keys.map(keyView),
  });
});

/* -------------------------------- 会话校验 ------------------------------- */

const secure = new Hono<ClientEnv>();

secure.use("*", async (c, next) => {
  const token = bearer(c);
  const session = await readUserSession(c.env, token);
  if (!session) return fail(c, 401, "unauthorized", "会话已失效，请重新登录");

  const account = await getUser(c.env, session.userId);
  if (!account || !account.enabled || userExpired(account)) {
    await revokeUserSession(c.env, token);
    return fail(c, 403, "account_unavailable", "账号已停用或已过期");
  }

  c.set("clientSession", session);
  c.set("clientUser", account);
  await next();
});

secure.get("/session", async (c) => {
  const account = c.get("clientUser");
  const session = c.get("clientSession");
  const [keys, credentials] = await Promise.all([
    listKeysOfUser(c.env, account.id),
    listCredentials(c.env),
  ]);

  return c.json({
    ok: true,
    expiresAt: session.expiresAt,
    user: { id: account.id, username: account.username, expiresAt: account.expiresAt ?? 0 },
    credentials: credentials
      .filter((cred) => account.credentialIds.includes(cred.id))
      .map((cred): CredentialView => ({ id: cred.id, label: cred.label, email: cred.email })),
    keys: keys.map(keyView),
  });
});

secure.post("/logout", async (c) => {
  await revokeUserSession(c.env, bearer(c));
  return c.json({ ok: true });
});

/* --------------------------------- Key ---------------------------------- */

secure.get("/keys", async (c) => {
  const keys = await listKeysOfUser(c.env, c.get("clientUser").id);
  return c.json({ ok: true, keys: keys.map(keyView) });
});

secure.post("/keys", async (c) => {
  const account = c.get("clientUser");
  const body = await readBody(c);

  const credentialId = body.credentialId ?? "";
  if (!credentialId) return fail(c, 400, "credential_required", "请选择证书凭据");
  if (!account.credentialIds.includes(credentialId)) {
    return fail(c, 403, "credential_not_assigned", "这套证书没有分配给你");
  }

  const name = body.name || "我的 Key";
  const quota = Number(body.dailyQuota ?? "0");

  try {
    const created = await createApiKey(c.env, {
      name,
      dailyQuota: Number.isFinite(quota) ? Math.max(0, Math.floor(quota)) : 0,
      createdBy: account.id,
      userId: account.id,
      credentialId,
    });
    return c.json({
      ok: true,
      plaintext: created.plaintext,
      key: keyView(created.record),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(c, 400, "create_failed", message);
  }
});

/** 选择已有 Key：换发新明文（旧值立即失效），否则客户端拿不到可用的 Key */
secure.post("/keys/:id/reveal", async (c) => {
  const account = c.get("clientUser");
  const id = c.req.param("id");
  const record = await findApiKeyById(c.env, id);
  if (!record || record.userId !== account.id) {
    return fail(c, 404, "key_not_found", "找不到该 Key");
  }
  if (!record.enabled) return fail(c, 403, "key_disabled", "该 Key 已停用");

  const rotated = await rotateApiKey(c.env, id);
  if (!rotated) return fail(c, 404, "key_not_found", "找不到该 Key");
  return c.json({ ok: true, plaintext: rotated.plaintext, key: keyView(rotated.record) });
});

clientApi.route("/", secure);
