/**
 * 用户门户：登录、查看自己的 Key 与调用记录、自助创建 Key。
 * 只能使用管理员分配给自己的 Certum 凭据。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env, UserRecord, UserSessionRecord } from "../types";
import { authenticateUser, getUser, userExpired } from "../store/users";
import { listCredentials } from "../store/credentials";
import { createApiKey, deleteApiKey, findApiKeyById, listKeysOfUser, setApiKeyEnabled } from "../store/keys";
import { getDailyUsage } from "../store/keys";
import { readUserLogs } from "../store/stats";
import { constantTimeEqual } from "../lib/encoding";
import { USER_COOKIE, createUserSession, readUserSession, revokeUserSession } from "../store/user-sessions";
import { localizeError, translator } from "../ui/i18n";
import type { Translate } from "../ui/i18n";
import { readPrefs } from "../ui/prefs";
import { userDashboardPage, userLoginPage, userLogsPage } from "../ui/user-pages";

export type UserEnv = {
  Bindings: Env;
  Variables: { userSession: UserSessionRecord; user: UserRecord };
};

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 8;

/** 页面共用的语言/主题上下文 */
function pageContext(c: Context<UserEnv>) {
  const prefs = readPrefs(c);
  const url = new URL(c.req.url);
  return { prefs, t: translator(prefs.lang), self: url.pathname + url.search };
}

/** 表单处理里用的短别名：tr(c)("msg.xxx") */
function tr(c: Context<UserEnv>): Translate {
  return translator(readPrefs(c).lang);
}

type FormValue = string | string[];

function isSecureRequest(c: Context<UserEnv>): boolean {
  return new URL(c.req.url).protocol === "https:";
}

async function readForm(c: Context<UserEnv>): Promise<Record<string, FormValue>> {
  const body = await c.req.parseBody();
  const out: Record<string, FormValue> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") out[key] = value;
    else if (Array.isArray(value)) out[key] = value.filter((item): item is string => typeof item === "string");
  }
  return out;
}

function one(form: Record<string, FormValue>, name: string): string {
  const value = form[name];
  return typeof value === "string" ? value.trim() : "";
}

async function checkCsrf(c: Context<UserEnv>, form: Record<string, FormValue>): Promise<boolean> {
  const session = c.get("userSession");
  return !!session && constantTimeEqual(one(form, "csrf"), session.csrf);
}

async function bumpFailure(env: Env, ip: string): Promise<void> {
  const key = `userfail:${ip}`;
  const raw = await env.CERTUM_KV.get<{ count: number; firstAt: number }>(key, "json");
  const now = Date.now();
  const bucket = raw && now - raw.firstAt < WINDOW_MS ? raw : { count: 0, firstAt: now };
  bucket.count += 1;
  await env.CERTUM_KV.put(key, JSON.stringify(bucket), { expirationTtl: Math.floor(WINDOW_MS / 1000) });
}

async function failures(env: Env, ip: string): Promise<number> {
  const raw = await env.CERTUM_KV.get<{ count: number; firstAt: number }>(`userfail:${ip}`, "json");
  return raw && Date.now() - raw.firstAt < WINDOW_MS ? raw.count : 0;
}

function backWith(c: Context<UserEnv>, path: string, kind: "ok" | "error", message: string): Response {
  return c.redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}

function queryMessages(c: Context<UserEnv>): { notice?: string; error?: string } {
  const url = new URL(c.req.url);
  return { notice: url.searchParams.get("ok") ?? undefined, error: url.searchParams.get("error") ?? undefined };
}

async function consumeReveal(c: Context<UserEnv>): Promise<string | undefined> {
  const id = new URL(c.req.url).searchParams.get("reveal");
  if (!id) return undefined;
  const value = await c.env.CERTUM_KV.get(`reveal:${id}`);
  if (value) await c.env.CERTUM_KV.delete(`reveal:${id}`);
  return value ?? undefined;
}

async function loadUser(c: Context<UserEnv>): Promise<UserRecord | null> {
  return getUser(c.env, c.get("userSession").userId);
}

async function renderDashboard(c: Context<UserEnv>, extra: { notice?: string; error?: string; revealedKey?: string } = {}): Promise<string> {
  const user = c.get("user") ?? (await loadUser(c));
  const context = pageContext(c);
  if (!user) {
    return userLoginPage({ prefs: context.prefs, t: context.t, self: "/user/login", error: context.t("login.errBadUser") });
  }

  const [keys, allCredentials, logs] = await Promise.all([
    listKeysOfUser(c.env, user.id),
    listCredentials(c.env),
    readUserLogs(c.env, user.id, 30),
  ]);
  const credentials = allCredentials.filter((cred) => user.credentialIds.includes(cred.id));

  const usage: Record<string, number> = {};
  for (const key of keys) usage[key.id] = await getDailyUsage(c.env, key.id);

  return userDashboardPage({
    ...context,
    ...queryMessages(c),
    ...extra,
    csrf: c.get("userSession").csrf,
    user,
    credentials,
    keys,
    usage,
    logs,
  });
}

export const user = new Hono<UserEnv>();

user.get("/user/login", async (c) => {
  const existing = await readUserSession(c.env, getCookie(c, USER_COOKIE));
  if (existing) return c.redirect("/user");
  return c.html(userLoginPage(pageContext(c)));
});

user.post("/user/login", async (c) => {
  const context = pageContext(c);
  const { t } = context;
  const loginPage = (error: string, status: 401 | 429) =>
    c.html(userLoginPage({ prefs: context.prefs, t, self: "/user/login", error }), status);

  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if ((await failures(c.env, ip)) >= MAX_FAILURES) {
    return loginPage(t("login.errTooMany"), 429);
  }

  const form = await readForm(c);
  const username = one(form, "username");
  const password = one(form, "password");
  const account = await authenticateUser(c.env, username, password);

  if (!account) {
    await bumpFailure(c.env, ip);
    return loginPage(t("login.errBadUser"), 401);
  }

  await c.env.CERTUM_KV.delete(`userfail:${ip}`);
  const { cookie } = await createUserSession(c.env, account.id, TTL_MS);
  setCookie(c, USER_COOKIE, cookie, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  });
  return c.redirect("/user");
});

const secure = new Hono<UserEnv>();

secure.use("*", async (c, next) => {
  const session = await readUserSession(c.env, getCookie(c, USER_COOKIE));
  if (!session) {
    if (c.req.method === "GET") return c.redirect("/user/login");
    return c.json({ ok: false, error: { code: "unauthorized", message: "会话已失效，请重新登录" } }, 401);
  }

  const account = await getUser(c.env, session.userId);
  if (!account || !account.enabled || userExpired(account)) {
    await revokeUserSession(c.env, getCookie(c, USER_COOKIE));
    deleteCookie(c, USER_COOKIE, { path: "/" });
    if (c.req.method === "GET") return c.redirect("/user/login");
    return c.json({ ok: false, error: { code: "account_unavailable", message: "账号已停用或已过期" } }, 403);
  }

  c.set("userSession", session);
  c.set("user", account);
  await next();
});

secure.get("/", async (c) => {
  return c.html(await renderDashboard(c, { revealedKey: await consumeReveal(c) }));
});

secure.post("/logout", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return c.html(`<h1>${tr(c)("msg.csrf")}</h1>`, 403);
  await revokeUserSession(c.env, getCookie(c, USER_COOKIE));
  deleteCookie(c, USER_COOKIE, { path: "/" });
  return c.redirect("/user/login");
});

secure.post("/keys", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return c.html(`<h1>${tr(c)("msg.csrf")}</h1>`, 403);

  const account = c.get("user");
  try {
    const credentialId = one(form, "credentialId");
    if (!account.credentialIds.includes(credentialId)) throw new Error(tr(c)("msg.credNotAssigned"));

    const quota = Number(one(form, "dailyQuota") || "0");
    const created = await createApiKey(c.env, {
      name: one(form, "name") || tr(c)("msg.myKeyDefault"),
      dailyQuota: Number.isFinite(quota) ? quota : 0,
      createdBy: account.id,
      userId: account.id,
      credentialId,
    });

    const revealId = crypto.randomUUID();
    await c.env.CERTUM_KV.put(`reveal:${revealId}`, created.plaintext, { expirationTtl: 300 });
    return c.redirect(`/user?reveal=${revealId}`);
  } catch (error) {
    return backWith(c, "/user", "error", localizeError(tr(c), error instanceof Error ? error.message : String(error)));
  }
});

async function ownKey(c: Context<UserEnv>, id: string) {
  const key = await findApiKeyById(c.env, id);
  if (!key || key.userId !== c.get("user").id) return null;
  return key;
}

secure.post("/keys/:id/toggle", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return c.html(`<h1>${tr(c)("msg.csrf")}</h1>`, 403);

  const key = await ownKey(c, c.req.param("id"));
  if (!key) return backWith(c, "/user", "error", tr(c)("msg.notFoundKey"));
  const enabled = one(form, "enabled") === "1";
  await setApiKeyEnabled(c.env, key.id, enabled);
  return backWith(c, "/user", "ok", enabled ? tr(c)("msg.keyEnabled") : tr(c)("msg.keyDisabled"));
});

secure.post("/keys/:id/delete", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return c.html(`<h1>${tr(c)("msg.csrf")}</h1>`, 403);

  const key = await ownKey(c, c.req.param("id"));
  if (!key) return backWith(c, "/user", "error", tr(c)("msg.notFoundKey"));
  await deleteApiKey(c.env, key.id);
  return backWith(c, "/user", "ok", tr(c)("msg.keyDeleted"));
});

secure.get("/logs", async (c) => {
  const account = c.get("user");
  const [logs, keys, credentials] = await Promise.all([
    readUserLogs(c.env, account.id, 100),
    listKeysOfUser(c.env, account.id),
    listCredentials(c.env),
  ]);
  return c.html(
    userLogsPage({
      ...pageContext(c),
      ...queryMessages(c),
      csrf: c.get("userSession").csrf,
      user: account,
      keys,
      usage: {},
      credentials: credentials.filter((cred) => account.credentialIds.includes(cred.id)),
      logs,
    }),
  );
});

user.route("/user", secure);
