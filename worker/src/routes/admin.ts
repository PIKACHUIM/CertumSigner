/**
 * 管理后台：概览 / 用户 / Certum 凭据 / API Key / 签名记录，多页面。
 * 表单全部带 CSRF token；会话放 KV，可吊销。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AdminSessionRecord, ApiKeyRecord, CredentialRecord, Env, UserRecord } from "../types";
import { CertumError } from "../certum/errors";
import { getCardFor, getSessionFor, peekCard, peekSession, refreshCardFor } from "../certum/session";
import { constantTimeEqual } from "../lib/encoding";
import { createCaptcha, verifyCaptcha } from "../lib/captcha";
import { mailConfigured } from "../lib/mail";
import { ADMIN_COOKIE, createAdminSession, readAdminSession, revokeAdminSession, revokeAllAdminSessions } from "../store/admin";
import {
  ADMIN_PASSWORD_MIN,
  adminAuthState,
  checkAdminCredentials,
  createAdminAccount,
  setAdminPassword,
  touchAdminLogin,
} from "../store/admin-account";
import { readSettings, writeSettings } from "../store/settings";
import { readConfig, writeConfig } from "../store/config";
import { createApiKey, deleteApiKey, deleteKeysOfUser, listApiKeys, listKeysOfUser, setApiKeyEnabled } from "../store/keys";
import {
  createCredential,
  deleteCredential,
  getCredential,
  importCredentialFromEnv,
  listCredentials,
  setCredentialEnabled,
  updateCredential,
} from "../store/credentials";
import {
  createUser,
  deleteUser,
  detachCredentialFromUsers,
  getUser,
  listUsers,
  setUserEnabled,
  updateUser,
} from "../store/users";
import { readRecentLogs, readStats } from "../store/stats";
import { localizeError, translator } from "../ui/i18n";
import type { Translate } from "../ui/i18n";
import { readPrefs } from "../ui/prefs";
import {
  adminCredentialsPage,
  adminDashboardPage,
  adminKeysPage,
  adminLoginPage,
  adminLogsPage,
  adminSettingsPage,
  adminSetupPage,
  adminUserPage,
  adminUsersPage,
  type CredentialStatus,
} from "../ui/admin-pages";

export type AdminEnv = {
  Bindings: Env;
  Variables: { adminSession: AdminSessionRecord };
};

const TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;

/** 每个页面都要的语言/主题上下文；self 带上查询串，切换偏好后跳回原处 */
function pageContext(c: Context<AdminEnv>) {
  const prefs = readPrefs(c);
  const url = new URL(c.req.url);
  return { prefs, t: translator(prefs.lang), self: url.pathname + url.search };
}

/** 表单校验失败时按当前语言回显 */
function csrfFail(c: Context<AdminEnv>): Response {
  return c.html(`<h1>${translator(readPrefs(c).lang)("msg.csrf")}</h1>`, 403);
}

/** 表单处理里用的短别名：tr(c)("msg.xxx") */
function tr(c: Context<AdminEnv>): Translate {
  return translator(readPrefs(c).lang);
}

type FormValue = string | string[];

function isSecureRequest(c: Context<AdminEnv>): boolean {
  return new URL(c.req.url).protocol === "https:";
}

async function readForm(c: Context<AdminEnv>): Promise<Record<string, FormValue>> {
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

function many(form: Record<string, FormValue>, name: string): string[] {
  const value = form[name];
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

async function checkCsrf(c: Context<AdminEnv>, form: Record<string, FormValue>): Promise<boolean> {
  const session = c.get("adminSession");
  const token = one(form, "csrf");
  return !!session && constantTimeEqual(token, session.csrf);
}

function clientIp(c: Context<AdminEnv>): string {
  return c.req.header("cf-connecting-ip") ?? "unknown";
}

async function bumpLoginFailure(env: Env, scope: string, ip: string): Promise<number> {
  const key = `${scope}fail:${ip}`;
  const raw = await env.CERTUM_KV.get<{ count: number; firstAt: number }>(key, "json");
  const now = Date.now();
  const bucket = raw && now - raw.firstAt < LOGIN_WINDOW_MS ? raw : { count: 0, firstAt: now };
  bucket.count += 1;
  await env.CERTUM_KV.put(key, JSON.stringify(bucket), { expirationTtl: Math.floor(LOGIN_WINDOW_MS / 1000) });
  return bucket.count;
}

async function loginFailures(env: Env, scope: string, ip: string): Promise<number> {
  const raw = await env.CERTUM_KV.get<{ count: number; firstAt: number }>(`${scope}fail:${ip}`, "json");
  if (!raw) return 0;
  return Date.now() - raw.firstAt < LOGIN_WINDOW_MS ? raw.count : 0;
}

/** 解析 datetime-local（按 UTC 解释） */
function parseWhen(raw: string): number | undefined | null {
  const text = raw.trim();
  if (!text) return undefined;
  const normalized = text.length === 16 ? `${text}:00Z` : `${text}Z`;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function backWith(c: Context<AdminEnv>, path: string, kind: "ok" | "error", message: string): Response {
  return c.redirect(`${path}?${kind}=${encodeURIComponent(message)}`);
}

async function credentialStatuses(env: Env, credentials: CredentialRecord[]): Promise<Record<string, CredentialStatus>> {
  const out: Record<string, CredentialStatus> = {};
  for (const cred of credentials) {
    const session = await peekSession(env, cred);
    const card = await peekCard(env, cred);
    out[cred.id] = {
      sessionExpiresAt: session?.expiresAt,
      cardSerial: card?.serial,
      cardFingerprint1: card?.fingerprint1,
    };
  }
  return out;
}

async function consumeReveal(c: Context<AdminEnv>): Promise<string | undefined> {
  const id = new URL(c.req.url).searchParams.get("reveal");
  if (!id) return undefined;
  const value = await c.env.CERTUM_KV.get(`reveal:${id}`);
  if (value) await c.env.CERTUM_KV.delete(`reveal:${id}`);
  return value ?? undefined;
}

function queryMessages(c: Context<AdminEnv>): { notice?: string; error?: string } {
  const url = new URL(c.req.url);
  return {
    notice: url.searchParams.get("ok") ?? undefined,
    error: url.searchParams.get("error") ?? undefined,
  };
}

export const admin = new Hono<AdminEnv>();

/* ------------------------------ 初始化管理员 ------------------------------ */

admin.get("/admin/setup", async (c) => {
  const state = await adminAuthState(c.env);
  // 已经初始化过（KV 账号或旧版 ADMIN_PASSWORD）就没必要再暴露这个页面
  if (state.mode !== "unconfigured") return c.redirect("/admin/login");
  const context = pageContext(c);
  return c.html(adminSetupPage({ prefs: context.prefs, t: context.t, self: context.self }));
});

admin.post("/admin/setup", async (c) => {
  const context = pageContext(c);
  const { t } = context;
  if ((await adminAuthState(c.env)).mode !== "unconfigured") return c.redirect("/admin/login");

  const form = await readForm(c);
  const username = one(form, "username");
  const password = one(form, "password");
  const confirm = one(form, "confirm");
  const render = (error: string, status: 400 | 500 = 400) =>
    c.html(adminSetupPage({ ...context, self: "/admin/setup", error, username }), status);

  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return render(t("setup.errUser"));
  if (password.length < ADMIN_PASSWORD_MIN) return render(t("setup.errShort"));
  if (password !== confirm) return render(t("setup.errMismatch"));

  try {
    await createAdminAccount(c.env, { username, password });
  } catch (error) {
    return render(localizeError(t, error instanceof Error ? error.message : String(error)), 500);
  }

  const { cookie } = await createAdminSession(c.env, TTL_MS);
  setCookie(c, ADMIN_COOKIE, cookie, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  });
  return c.redirect(`/admin?ok=${encodeURIComponent(t("setup.done"))}`);
});

admin.get("/admin/login", async (c) => {
  const state = await adminAuthState(c.env);
  if (state.mode === "unconfigured") return c.redirect("/admin/setup");
  const existing = await readAdminSession(c.env, getCookie(c, ADMIN_COOKIE));
  if (existing) return c.redirect("/admin");
  const context = pageContext(c);
  const settings = await readSettings(c.env);
  return c.html(
    adminLoginPage({
      prefs: context.prefs,
      t: context.t,
      self: context.self,
      useUsername: state.mode === "account",
      captcha: settings.loginCaptcha ? await createCaptcha(c.env) : undefined,
    }),
  );
});

admin.post("/admin/login", async (c) => {
  const context = pageContext(c);
  const { t } = context;
  const settings = await readSettings(c.env);
  const state = await adminAuthState(c.env);
  if (state.mode === "unconfigured") return c.redirect("/admin/setup");

  // 验证码是一次性的：任何失败页都要重新生成一张
  const loginPage = async (error?: string, status: 401 | 429 = 401, username = "") =>
    c.html(
      adminLoginPage({
        prefs: context.prefs,
        t,
        self: "/admin/login",
        error,
        username,
        useUsername: state.mode === "account",
        captcha: settings.loginCaptcha ? await createCaptcha(c.env) : undefined,
      }),
      status,
    );

  const ip = clientIp(c);
  if ((await loginFailures(c.env, "admin", ip)) >= LOGIN_MAX_FAILURES) {
    return loginPage(t("login.errTooMany"), 429);
  }

  const form = await readForm(c);
  if (settings.loginCaptcha && !(await verifyCaptcha(c.env, one(form, "captchaId"), one(form, "captcha")))) {
    await bumpLoginFailure(c.env, "admin", ip);
    return loginPage(t("login.errCaptcha"), 401, one(form, "username"));
  }

  const username = one(form, "username");
  const password = one(form, "password");
  const ok =
    state.mode === "account"
      ? await checkAdminCredentials(c.env, username, password)
      : constantTimeEqual(password, (c.env.ADMIN_PASSWORD ?? "").trim());

  if (!password || !ok) {
    await bumpLoginFailure(c.env, "admin", ip);
    return loginPage(t("login.errBadPassword"), 401, username);
  }

  await c.env.CERTUM_KV.delete(`adminfail:${ip}`);
  if (state.account) await touchAdminLogin(c.env, state.account);
  const { cookie } = await createAdminSession(c.env, TTL_MS);
  setCookie(c, ADMIN_COOKIE, cookie, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  });
  return c.redirect("/admin");
});

const secure = new Hono<AdminEnv>();

secure.use("*", async (c, next) => {
  const record = await readAdminSession(c.env, getCookie(c, ADMIN_COOKIE));
  if (!record) {
    if (c.req.method === "GET") {
      // 还没初始化就直接去建账号，少一次跳转
      const state = await adminAuthState(c.env);
      return c.redirect(state.mode === "unconfigured" ? "/admin/setup" : "/admin/login");
    }
    return c.json({ ok: false, error: { code: "unauthorized", message: "会话已失效，请重新登录" } }, 401);
  }
  if (record.expiresAt < Date.now()) {
    if (c.req.method === "GET") return c.redirect("/admin/login");
    return c.json({ ok: false, error: { code: "expired", message: "会话已过期" } }, 401);
  }
  c.set("adminSession", record);
  await next();
});

secure.get("/", async (c) => {
  const [users, credentials, keys, stats, logs] = await Promise.all([
    listUsers(c.env),
    listCredentials(c.env),
    listApiKeys(c.env),
    readStats(c.env, 7),
    readRecentLogs(c.env, 20),
  ]);
  const messages = queryMessages(c);
  const revealedKey = await consumeReveal(c);
  const ctx = pageContext(c);
  const { t } = ctx;

  return c.html(
    adminDashboardPage({
      ...ctx,
      ...messages,
      csrf: c.get("adminSession").csrf,
      users,
      credentials,
      keys,
      statuses: await credentialStatuses(c.env, credentials),
      stats,
      logs,
      userName: new Map(users.map((user) => [user.id, user.username])),
      credName: new Map(credentials.map((cred) => [cred.id, cred.label])),
      ...(revealedKey ? { notice: t("msg.newKey", { key: revealedKey }) } : {}),
    }),
  );
});

secure.post("/logout", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);

  await revokeAdminSession(c.env, getCookie(c, ADMIN_COOKIE));
  deleteCookie(c, ADMIN_COOKIE, { path: "/" });
  return c.redirect("/admin/login");
});

/* ---------------------------------- 用户 ---------------------------------- */

secure.get("/users", async (c) => {
  const [users, credentials, keys] = await Promise.all([listUsers(c.env), listCredentials(c.env), listApiKeys(c.env)]);
  const keyCounts: Record<string, number> = {};
  for (const key of keys) {
    if (key.userId) keyCounts[key.userId] = (keyCounts[key.userId] ?? 0) + 1;
  }
  return c.html(
    adminUsersPage({
      ...pageContext(c),
      ...queryMessages(c),
      csrf: c.get("adminSession").csrf,
      users,
      credentials,
      keyCounts,
    }),
  );
});

secure.post("/users", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);

  try {
    const expiresAt = parseWhen(one(form, "expiresAt"));
    if (expiresAt === null) throw new Error(tr(c)("msg.badExpiry"));
    const user = await createUser(c.env, {
      username: one(form, "username"),
      password: one(form, "password"),
      email: one(form, "email") || undefined,
      expiresAt: expiresAt ?? undefined,
      credentialIds: many(form, "credentialIds"),
      dailyQuota: Number(one(form, "dailyQuota") || "0") || 0,
      createdBy: c.get("adminSession").id,
    });
    return backWith(c, "/admin/users", "ok", tr(c)("msg.userCreated", { name: user.username }));
  } catch (error) {
    return backWith(c, "/admin/users", "error", localizeError(tr(c), error instanceof Error ? error.message : String(error)));
  }
});

secure.get("/users/:id", async (c) => {
  const user = await getUser(c.env, c.req.param("id"));
  if (!user) return backWith(c, "/admin/users", "error", tr(c)("msg.notFoundUser"));
  const [credentials, keys, stats] = await Promise.all([
    listCredentials(c.env),
    listKeysOfUser(c.env, user.id),
    readStats(c.env, 1),
  ]);
  return c.html(
    adminUserPage({
      ...pageContext(c),
      ...queryMessages(c),
      csrf: c.get("adminSession").csrf,
      user,
      credentials,
      keys,
      stats: { total: stats.total },
      revealedKey: await consumeReveal(c),
    }),
  );
});

secure.post("/users/:id/toggle", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);
  const enabled = one(form, "enabled") === "1";
  const ok = await setUserEnabled(c.env, c.req.param("id"), enabled);
  return backWith(c, `/admin/users/${c.req.param("id")}`, ok ? "ok" : "error", ok ? (enabled ? tr(c)("msg.enabled") : tr(c)("msg.disabled")) : tr(c)("msg.notFoundUser"));
});

secure.post("/users/:id/update", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);

  const expiresRaw = one(form, "expiresAt");
  const expiresAt = parseWhen(expiresRaw);
  if (expiresAt === null) return backWith(c, `/admin/users/${c.req.param("id")}`, "error", tr(c)("msg.badExpiry"));

  try {
    const ok = await updateUser(c.env, c.req.param("id"), {
      expiresAt: expiresAt === undefined ? null : expiresAt,
      credentialIds: many(form, "credentialIds"),
      password: one(form, "password") || undefined,
      email: one(form, "email") || null,
      // 管理员改邮箱视为已核验，避免把用户锁在验证邮件之外
      emailVerified: true,
      dailyQuota: Number(one(form, "dailyQuota") || "0") || 0,
    });
    return backWith(c, `/admin/users/${c.req.param("id")}`, ok ? "ok" : "error", ok ? tr(c)("msg.saved") : tr(c)("msg.notFoundUser"));
  } catch (error) {
    return backWith(c, `/admin/users/${c.req.param("id")}`, "error", localizeError(tr(c), error instanceof Error ? error.message : String(error)));
  }
});

secure.post("/users/:id/delete", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);
  const id = c.req.param("id");
  const revoked = await deleteKeysOfUser(c.env, id);
  const ok = await deleteUser(c.env, id);
  return backWith(c, "/admin/users", ok ? "ok" : "error", ok ? tr(c)("msg.userDeleted", { n: revoked }) : tr(c)("msg.notFoundUser"));
});

/* --------------------------------- 凭据 ---------------------------------- */

secure.get("/credentials", async (c) => {
  const credentials = await listCredentials(c.env);
  return c.html(
    adminCredentialsPage({
      ...pageContext(c),
      ...queryMessages(c),
      csrf: c.get("adminSession").csrf,
      credentials,
      statuses: await credentialStatuses(c.env, credentials),
      importedFromEnv: false,
    }),
  );
});

secure.post("/credentials", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);

  try {
    const cred = await createCredential(c.env, {
      label: one(form, "label"),
      email: one(form, "email"),
      otp: one(form, "otp"),
      certificateSha1: one(form, "certificateSha1") || undefined,
      createdBy: c.get("adminSession").id,
    });
    return backWith(c, "/admin/credentials", "ok", tr(c)("msg.credSaved", { name: cred.label }));
  } catch (error) {
    return backWith(c, "/admin/credentials", "error", localizeError(tr(c), error instanceof Error ? error.message : String(error)));
  }
});

secure.post("/credentials/:id/update", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);

  const id = c.req.param("id");
  const existing = await getCredential(c.env, id);
  if (!existing) return backWith(c, "/admin/credentials", "error", tr(c)("msg.notFoundCred"));

  try {
    const ok = await updateCredential(c.env, id, {
      label: one(form, "label") || undefined,
      email: one(form, "email") || undefined,
      otp: one(form, "otp") || undefined,
      // 空字符串表示「清掉证书指纹」，与「没提交」区分开
      certificateSha1: one(form, "certificateSha1"),
    });
    return backWith(c, "/admin/credentials", ok ? "ok" : "error", ok ? tr(c)("msg.credUpdated", { name: existing.label }) : tr(c)("msg.notFoundCred"));
  } catch (error) {
    return backWith(c, "/admin/credentials", "error", localizeError(tr(c), error instanceof Error ? error.message : String(error)));
  }
});

secure.post("/credentials/import-env", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);
  try {
    const cred = await importCredentialFromEnv(c.env, c.get("adminSession").id);
    if (!cred) return backWith(c, "/admin/credentials", "error", tr(c)("msg.credMissingEnv"));
    return backWith(c, "/admin/credentials", "ok", tr(c)("msg.credImported", { name: cred.label }));
  } catch (error) {
    return backWith(c, "/admin/credentials", "error", localizeError(tr(c), error instanceof Error ? error.message : String(error)));
  }
});

secure.post("/credentials/:id/toggle", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);
  const enabled = one(form, "enabled") === "1";
  const ok = await setCredentialEnabled(c.env, c.req.param("id"), enabled);
  return backWith(c, "/admin/credentials", ok ? "ok" : "error", ok ? (enabled ? tr(c)("msg.credEnabled") : tr(c)("msg.credDisabled")) : tr(c)("msg.notFoundCred"));
});

secure.post("/credentials/:id/delete", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);
  const id = c.req.param("id");
  const cred = await getCredential(c.env, id);
  if (!cred) return backWith(c, "/admin/credentials", "error", tr(c)("msg.notFoundCred"));
  await detachCredentialFromUsers(c.env, id);
  await deleteCredential(c.env, id);
  return backWith(c, "/admin/credentials", "ok", tr(c)("msg.credDeleted", { name: cred.label }));
});

secure.post("/credentials/:id/login", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);
  const cred = await getCredential(c.env, c.req.param("id"));
  if (!cred) return backWith(c, "/admin/credentials", "error", tr(c)("msg.notFoundCred"));

  try {
    const session = await getSessionFor(c.env, cred, { force: true });
    await getCardFor(c.env, cred);
    return backWith(c, "/admin/credentials", "ok", tr(c)("msg.credLoginOk", { email: session.email, expiry: new Date(session.expiresAt).toISOString() }));
  } catch (error) {
    cred.lastError = error instanceof Error ? error.message : String(error);
    await c.env.CERTUM_KV.put(`cred:${cred.id}`, JSON.stringify(cred));
    return backWith(c, "/admin/credentials", "error", tr(c)("msg.credLoginFail", { error: cred.lastError }));
  }
});

secure.post("/credentials/:id/certificate", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);
  const cred = await getCredential(c.env, c.req.param("id"));
  if (!cred) return backWith(c, "/admin/credentials", "error", tr(c)("msg.notFoundCred"));

  try {
    const card = await refreshCardFor(c.env, cred);
    return backWith(c, "/admin/credentials", "ok", tr(c)("msg.certRefreshed", { serial: card.serial }));
  } catch (error) {
    const message = error instanceof CertumError ? error.message : String(error);
    return backWith(c, "/admin/credentials", "error", tr(c)("msg.certRefreshFail", { error: message }));
  }
});

/* ---------------------------------- Key ---------------------------------- */

secure.get("/keys", async (c) => {
  const [keys, users, credentials] = await Promise.all([listApiKeys(c.env), listUsers(c.env), listCredentials(c.env)]);
  return c.html(
    adminKeysPage({
      ...pageContext(c),
      ...queryMessages(c),
      csrf: c.get("adminSession").csrf,
      keys,
      users,
      credentials,
      revealedKey: await consumeReveal(c),
    }),
  );
});

secure.post("/keys", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);

  const backPath = one(form, "userId") ? `/admin/users/${one(form, "userId")}` : "/admin/keys";

  try {
    const credentialId = one(form, "credentialId");
    if (!credentialId) throw new Error(tr(c)("msg.pickCred"));
    const credential = await getCredential(c.env, credentialId);
    if (!credential) throw new Error(tr(c)("msg.notFoundCred"));

    const userId = one(form, "userId") || undefined;
    if (userId) {
      const owner = await getUser(c.env, userId);
      if (!owner) throw new Error(tr(c)("msg.notFoundUser"));
      if (!owner.credentialIds.includes(credentialId)) throw new Error(tr(c)("msg.ownerNoCred"));
    }

    const quota = Number(one(form, "dailyQuota") || "0");
    const created = await createApiKey(c.env, {
      name: one(form, "name") || tr(c)("msg.untitled"),
      dailyQuota: Number.isFinite(quota) ? quota : 0,
      createdBy: c.get("adminSession").id,
      userId,
      credentialId,
    });

    const revealId = crypto.randomUUID();
    await c.env.CERTUM_KV.put(`reveal:${revealId}`, created.plaintext, { expirationTtl: 300 });
    return c.redirect(`${backPath}?reveal=${revealId}`);
  } catch (error) {
    return backWith(c, backPath, "error", localizeError(tr(c), error instanceof Error ? error.message : String(error)));
  }
});

secure.post("/keys/:id/toggle", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);
  const enabled = one(form, "enabled") === "1";
  const ok = await setApiKeyEnabled(c.env, c.req.param("id"), enabled);
  return backWith(c, "/admin/keys", ok ? "ok" : "error", ok ? (enabled ? tr(c)("msg.keyEnabled") : tr(c)("msg.keyDisabled")) : tr(c)("msg.notFoundKey"));
});

secure.post("/keys/:id/delete", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);
  const ok = await deleteApiKey(c.env, c.req.param("id"));
  return backWith(c, "/admin/keys", ok ? "ok" : "error", ok ? tr(c)("msg.keyDeleted") : tr(c)("msg.notFoundKey"));
});

/* -------------------------------- 系统设置 -------------------------------- */

secure.get("/settings", async (c) => {
  const [settings, state, config] = await Promise.all([
    readSettings(c.env),
    adminAuthState(c.env),
    readConfig(c.env),
  ]);
  return c.html(
    adminSettingsPage({
      ...pageContext(c),
      ...queryMessages(c),
      csrf: c.get("adminSession").csrf,
      settings,
      config,
      mailReady: (await mailConfigured(c.env)),
      adminMode: state.mode,
      adminUsername: state.account?.username,
    }),
  );
});

secure.post("/settings", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);

  const on = (name: string) => one(form, name) === "1";
  const fail = (message: string) => backWith(c, "/admin/settings", "error", message);

  const publicBaseUrl = one(form, "publicBaseUrl");
  const certumApiBase = one(form, "certumApiBase");
  const tsaUpstream = one(form, "tsaUpstream");
  const urls: Array<[string, string]> = [
    [publicBaseUrl, tr(c)("settings.publicBaseUrl")],
    [certumApiBase, tr(c)("settings.certumApiBase")],
    [tsaUpstream, tr(c)("settings.tsaUpstream")],
  ];
  for (const [value, label] of urls) {
    if (value && !/^https?:\/\/[^\s]+$/i.test(value)) return fail(tr(c)("settings.badUrl", { name: label }));
  }
  const certumChainPem = one(form, "certumChainPem");
  if (certumChainPem && !certumChainPem.includes("BEGIN CERTIFICATE")) return fail(tr(c)("settings.badPem"));

  await writeSettings(c.env, {
    loginCaptcha: on("loginCaptcha"),
    registerEnabled: on("registerEnabled"),
    resetEnabled: on("resetEnabled"),
    emailCaptcha: on("emailCaptcha"),
  });
  await writeConfig(c.env, {
    publicBaseUrl,
    certumApiBase,
    tsaUpstream,
    resendFrom: one(form, "resendFrom"),
    certumChainPem,
    logSignatures: on("logSignatures"),
  });
  return backWith(c, "/admin/settings", "ok", tr(c)("settings.saved"));
});

secure.post("/settings/password", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return csrfFail(c);

  const state = await adminAuthState(c.env);
  if (state.mode !== "account" || !state.account) {
    return backWith(c, "/admin/settings", "error", tr(c)("settings.passwordEnvMode"));
  }

  const current = one(form, "current");
  const next = one(form, "next");
  const confirm = one(form, "confirm");

  if (!(await checkAdminCredentials(c.env, state.account.username, current))) {
    return backWith(c, "/admin/settings", "error", tr(c)("settings.passwordWrong"));
  }
  if (next.length < ADMIN_PASSWORD_MIN) {
    return backWith(c, "/admin/settings", "error", tr(c)("settings.passwordShort"));
  }
  if (next !== confirm) {
    return backWith(c, "/admin/settings", "error", tr(c)("settings.passwordMismatch"));
  }

  await setAdminPassword(c.env, next);
  // 旧会话全部作废，再给当前浏览器发一张新的，避免「改了口令但旧 cookie 还能用」
  await revokeAllAdminSessions(c.env);
  const { cookie } = await createAdminSession(c.env, TTL_MS);
  setCookie(c, ADMIN_COOKIE, cookie, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  });
  return backWith(c, "/admin/settings", "ok", tr(c)("settings.passwordChanged"));
});

/* --------------------------------- 日志/API -------------------------------- */

secure.get("/logs", async (c) => {
  const [logs, users, credentials] = await Promise.all([
    readRecentLogs(c.env, 100),
    listUsers(c.env),
    listCredentials(c.env),
  ]);
  return c.html(
    adminLogsPage({
      ...pageContext(c),
      ...queryMessages(c),
      csrf: c.get("adminSession").csrf,
      logs,
      userName: new Map(users.map((user) => [user.id, user.username])),
      credName: new Map(credentials.map((cred) => [cred.id, cred.label])),
    }),
  );
});

secure.get("/api/stats", async (c) => {
  const [stats, keys, users, credentials] = await Promise.all([
    readStats(c.env, 7),
    listApiKeys(c.env),
    listUsers(c.env),
    listCredentials(c.env),
  ]);
  return c.json({
    ok: true,
    stats,
    counts: { users: users.length, credentials: credentials.length, keys: keys.length },
    keys: keys.map((key: ApiKeyRecord) => ({
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      enabled: key.enabled,
      totalSigns: key.totalSigns,
      lastUsedAt: key.lastUsedAt ?? null,
      userId: key.userId ?? null,
      credentialId: key.credentialId ?? null,
    })),
  });
});

admin.route("/admin", secure);
