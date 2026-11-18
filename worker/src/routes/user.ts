/**
 * 用户门户：登录、查看自己的 Key 与调用记录、自助创建 Key。
 * 只能使用管理员分配给自己的 Certum 凭据。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env, UserRecord, UserSessionRecord } from "../types";
import { authenticateUserDetailed, createUser, deleteUser, findUserByLogin, getUser, updateUser, userExpired } from "../store/users";
import { listCredentials } from "../store/credentials";
import {
  createApiKey,
  deleteApiKey,
  findApiKeyById,
  getDailyUsage,
  getUserDailyUsage,
  listKeysOfUser,
  setApiKeyEnabled,
  updateApiKey,
} from "../store/keys";
import { readUserLogs } from "../store/stats";
import { constantTimeEqual } from "../lib/encoding";
import { createCaptcha, verifyCaptcha } from "../lib/captcha";
import { mailConfigured, mailTemplate, sendMail, siteBase } from "../lib/mail";
import { createEmailToken, peekEmailToken, consumeEmailToken, RESET_TTL_MS, VERIFY_TTL_MS } from "../store/email-tokens";
import { readSettings } from "../store/settings";
import {
  USER_COOKIE,
  createUserSession,
  readUserSession,
  revokeUserSession,
  revokeUserSessionsOf,
} from "../store/user-sessions";
import { localizeError, translator } from "../ui/i18n";
import type { Translate } from "../ui/i18n";
import { readPrefs } from "../ui/prefs";
import {
  userDashboardPage,
  userLoginPage,
  userLogsPage,
  userMessagePage,
  userRegisterDonePage,
  userRegisterPage,
  userResetConfirmPage,
  userResetPage,
  userVerifyPage,
} from "../ui/user-pages";

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
  const userUsage = await getUserDailyUsage(c.env, user.id);

  return userDashboardPage({
    ...context,
    ...queryMessages(c),
    ...extra,
    csrf: c.get("userSession").csrf,
    user,
    credentials,
    keys,
    usage,
    userUsage,
    logs,
  });
}

export const user = new Hono<UserEnv>();

/** 登录页 / 密码问题都要带上的开关状态 */
async function authView(c: Context<UserEnv>) {
  const settings = await readSettings(c.env);
  return {
    settings,
    context: pageContext(c),
    captcha: settings.loginCaptcha ? await createCaptcha(c.env) : undefined,
    canRegister: settings.registerEnabled,
    canReset: settings.resetEnabled,
  };
}

async function captchaPassed(c: Context<UserEnv>, form: Record<string, FormValue>, enabled: boolean): Promise<boolean> {
  if (!enabled) return true;
  return verifyCaptcha(c.env, one(form, "captchaId"), one(form, "captcha"));
}

function passwordProblem(password: string, password2: string, t: Translate): string | null {
  if (password.length < 8) return t("register.errPassword");
  if (password !== password2) return t("register.errMismatch");
  return null;
}

async function sendVerifyMail(c: Context<UserEnv>, account: UserRecord, token: string): Promise<void> {
  const { t } = pageContext(c);
  const link = `${siteBase(c.env, c.req.url)}/user/verify?token=${encodeURIComponent(token)}`;
  await sendMail(c.env, {
    to: account.email!,
    subject: t("register.mailSubject"),
    text: `${t("register.mailLead")}\n\n${t("register.mailText")}\n${link}`,
    html: mailTemplate({
      title: t("register.mailTitle"),
      lead: t("register.mailLead"),
      button: t("register.mailButton"),
      link,
      hint: t("register.mailHint"),
      footer: "CertumSigner",
    }),
  });
}

async function sendResetMail(c: Context<UserEnv>, account: UserRecord, token: string): Promise<void> {
  const { t } = pageContext(c);
  const link = `${siteBase(c.env, c.req.url)}/user/reset/confirm?token=${encodeURIComponent(token)}`;
  await sendMail(c.env, {
    to: account.email!,
    subject: t("reset.mailSubject"),
    text: `${t("reset.mailLead")}\n\n${link}`,
    html: mailTemplate({
      title: t("reset.mailTitle"),
      lead: t("reset.mailLead"),
      button: t("reset.mailButton"),
      link,
      hint: t("reset.mailHint"),
      footer: "CertumSigner",
    }),
  });
}

user.get("/user/login", async (c) => {
  const existing = await readUserSession(c.env, getCookie(c, USER_COOKIE));
  if (existing) return c.redirect("/user");
  const view = await authView(c);
  return c.html(
    userLoginPage({
      ...view.context,
      captcha: view.captcha,
      canRegister: view.canRegister,
      canReset: view.canReset,
    }),
  );
});

user.post("/user/login", async (c) => {
  const context = pageContext(c);
  const settings = await readSettings(c.env);
  const { t } = context;
  // 验证码一次性：每次失败都换一张
  const loginPage = async (error: string, status: 401 | 429) =>
    c.html(
      userLoginPage({
        ...context,
        error,
        captcha: settings.loginCaptcha ? await createCaptcha(c.env) : undefined,
        canRegister: settings.registerEnabled,
        canReset: settings.resetEnabled,
      }),
      status,
    );

  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if ((await failures(c.env, ip)) >= MAX_FAILURES) {
    return loginPage(t("login.errTooMany"), 429);
  }

  const form = await readForm(c);
  if (!(await captchaPassed(c, form, settings.loginCaptcha))) {
    await bumpFailure(c.env, ip);
    return loginPage(t("login.errCaptcha"), 401);
  }

  const username = one(form, "username");
  const password = one(form, "password");
  const result = await authenticateUserDetailed(c.env, username, password);

  if (result.status === "unverified") {
    await bumpFailure(c.env, ip);
    return loginPage(t("login.errUnverified"), 401);
  }
  if (result.status !== "ok") {
    await bumpFailure(c.env, ip);
    return loginPage(t("login.errBadUser"), 401);
  }

  await c.env.CERTUM_KV.delete(`userfail:${ip}`);
  const { cookie } = await createUserSession(c.env, result.user.id, TTL_MS);
  setCookie(c, USER_COOKIE, cookie, {
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor(TTL_MS / 1000),
  });
  return c.redirect("/user");
});

/* ------------------------------- 自助注册 -------------------------------- */

user.get("/user/register", async (c) => {
  const context = pageContext(c);
  const settings = await readSettings(c.env);
  if (!settings.registerEnabled) {
    return c.html(
      userMessagePage({
        ...context,
        title: context.t("register.title"),
        subtitle: context.t("register.subtitle"),
        error: context.t("register.disabled"),
        backHref: "/user/login",
        backLabel: context.t("register.toLogin"),
      }),
      403,
    );
  }
  return c.html(
    userRegisterPage({
      ...context,
      error: mailConfigured(c.env) ? undefined : context.t("settings.mailMissing"),
      captcha: settings.emailCaptcha ? await createCaptcha(c.env) : undefined,
    }),
  );
});

user.post("/user/register", async (c) => {
  const context = pageContext(c);
  const { t } = context;
  const settings = await readSettings(c.env);
  if (!settings.registerEnabled) {
    return c.html(
      userMessagePage({
        ...context,
        title: t("register.title"),
        subtitle: t("register.subtitle"),
        error: t("register.disabled"),
        backHref: "/user/login",
        backLabel: t("register.toLogin"),
      }),
      403,
    );
  }

  const form = await readForm(c);
  const registerPage = async (error: string) =>
    c.html(
      userRegisterPage({
        ...context,
        error,
        captcha: settings.emailCaptcha ? await createCaptcha(c.env) : undefined,
      }),
      400,
    );

  if (!(await captchaPassed(c, form, settings.emailCaptcha))) {
    return c.html(
      userRegisterPage({
        ...context,
        error: t("login.errCaptcha"),
        captcha: await createCaptcha(c.env),
      }),
      400,
    );
  }

  const password = one(form, "password");
  const problem = passwordProblem(password, one(form, "password2"), t);
  if (problem) {
    return c.html(
      userRegisterPage({ ...context, error: problem, captcha: settings.emailCaptcha ? await createCaptcha(c.env) : undefined }),
      400,
    );
  }

  if (!mailConfigured(c.env)) {
    return registerPage(t("settings.mailMissing"));
  }

  try {
    const account = await createUser(c.env, {
      username: one(form, "username"),
      password,
      email: one(form, "email"),
      emailVerified: false,
      createdBy: "self-register",
      dailyQuota: 0,
    });

    const token = await createEmailToken(c.env, {
      userId: account.id,
      email: account.email!,
      purpose: "verify",
      ttlMs: VERIFY_TTL_MS,
    });

    try {
      await sendVerifyMail(c, account, token);
    } catch (error) {
      // 邮件没发出去就回滚账号，避免留下无法登录的孤儿用户
      await deleteUser(c.env, account.id);
      return registerPage(t("register.errMail", { error: error instanceof Error ? error.message : String(error) }));
    }

    return c.html(
      userRegisterDonePage({ ...context, email: account.email ?? one(form, "email") }),
    );
  } catch (error) {
    return registerPage(localizeError(t, error instanceof Error ? error.message : String(error)));
  }
});

user.get("/user/verify", async (c) => {
  const context = pageContext(c);
  const token = new URL(c.req.url).searchParams.get("token") ?? "";
  const record = await peekEmailToken(c.env, token);
  if (!record || record.purpose !== "verify") {
    return c.html(
      userVerifyPage({ ...context, error: context.t("register.verifyFail") }),
      400,
    );
  }
  return c.html(userVerifyPage({ ...context, token }));
});

user.post("/user/verify", async (c) => {
  const context = pageContext(c);
  const { t } = context;
  const form = await readForm(c);
  const record = await consumeEmailToken(c.env, one(form, "token"), "verify");
  if (!record) return c.html(userVerifyPage({ ...context, error: t("register.verifyFail") }), 400);

  const account = await getUser(c.env, record.userId);
  if (!account || !account.email || account.email !== record.email) {
    return c.html(userVerifyPage({ ...context, error: t("register.verifyFail") }), 400);
  }
  await updateUser(c.env, account.id, { emailVerified: true });
  return c.html(userVerifyPage({ ...context, done: true }));
});

/* ------------------------------- 找回密码 -------------------------------- */

user.get("/user/reset", async (c) => {
  const context = pageContext(c);
  const { t } = context;
  const settings = await readSettings(c.env);
  if (!settings.resetEnabled) {
    return c.html(
      userMessagePage({
        ...context,
        title: t("reset.title"),
        subtitle: t("reset.subtitle"),
        error: t("reset.disabled"),
        backHref: "/user/login",
        backLabel: t("reset.backLogin"),
      }),
      403,
    );
  }
  if (!mailConfigured(c.env)) {
    return c.html(
      userMessagePage({
        ...context,
        title: t("reset.title"),
        subtitle: t("reset.subtitle"),
        error: t("settings.mailMissing"),
        backHref: "/user/login",
        backLabel: t("reset.backLogin"),
      }),
      503,
    );
  }
  return c.html(
    userResetPage({
      ...context,
      captcha: settings.emailCaptcha ? await createCaptcha(c.env) : undefined,
    }),
  );
});

user.post("/user/reset", async (c) => {
  const context = pageContext(c);
  const { t } = context;
  const settings = await readSettings(c.env);
  if (!settings.resetEnabled) {
    return c.html(
      userMessagePage({
        ...context,
        title: t("reset.title"),
        subtitle: t("reset.subtitle"),
        error: t("reset.disabled"),
        backHref: "/user/login",
        backLabel: t("reset.backLogin"),
      }),
      403,
    );
  }

  const form = await readForm(c);
  if (!(await captchaPassed(c, form, settings.emailCaptcha))) {
    return c.html(
      userResetPage({
        ...context,
        error: t("login.errCaptcha"),
        captcha: await createCaptcha(c.env),
      }),
      400,
    );
  }
  if (!mailConfigured(c.env)) {
    return c.html(
      userMessagePage({
        ...context,
        title: t("reset.title"),
        subtitle: t("reset.subtitle"),
        error: t("settings.mailMissing"),
        backHref: "/user/login",
        backLabel: t("reset.backLogin"),
      }),
      503,
    );
  }

  // 无论账号是否存在都返回同一句话，避免用找回密码探测用户
  const account = await findUserByLogin(c.env, one(form, "account"));
  if (account?.email) {
    try {
      const token = await createEmailToken(c.env, {
        userId: account.id,
        email: account.email,
        purpose: "reset",
        ttlMs: RESET_TTL_MS,
      });
      await sendResetMail(c, account, token);
    } catch (error) {
      console.error("[certum-signer] reset mail failed", error);
    }
  }

  return c.html(
    userMessagePage({
      ...context,
      title: t("reset.title"),
      subtitle: t("reset.subtitle"),
      notice: t("reset.sent"),
      backHref: "/user/login",
      backLabel: t("reset.backLogin"),
    }),
  );
});

user.get("/user/reset/confirm", async (c) => {
  const context = pageContext(c);
  const token = new URL(c.req.url).searchParams.get("token") ?? "";
  const record = await peekEmailToken(c.env, token);
  if (!record || record.purpose !== "reset") {
    return c.html(userResetConfirmPage({ ...context, error: context.t("reset.fail") }), 400);
  }
  return c.html(userResetConfirmPage({ ...context, token }));
});

user.post("/user/reset/confirm", async (c) => {
  const context = pageContext(c);
  const { t } = context;
  const form = await readForm(c);
  const record = await consumeEmailToken(c.env, one(form, "token"), "reset");
  if (!record) return c.html(userResetConfirmPage({ ...context, error: t("reset.fail") }), 400);

  const account = await getUser(c.env, record.userId);
  if (!account || !account.email || account.email !== record.email) {
    return c.html(userResetConfirmPage({ ...context, error: t("reset.fail") }), 400);
  }

  const password = one(form, "password");
  const problem = passwordProblem(password, one(form, "password2"), t);
  if (problem) {
    return c.html(
      userResetConfirmPage({ ...context, token: one(form, "token"), error: problem }),
      400,
    );
  }

  const ok = await updateUser(c.env, record.userId, { password });
  if (!ok) return c.html(userResetConfirmPage({ ...context, error: t("reset.fail") }), 400);

  await revokeUserSessionsOf(c.env, record.userId);
  return c.html(userResetConfirmPage({ ...context, done: true }));
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

secure.post("/keys/:id/quota", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return c.html(`<h1>${tr(c)("msg.csrf")}</h1>`, 403);

  const key = await ownKey(c, c.req.param("id"));
  if (!key) return backWith(c, "/user", "error", tr(c)("msg.notFoundKey"));
  const quota = Number(one(form, "dailyQuota") || "0");
  await updateApiKey(c.env, key.id, { dailyQuota: Number.isFinite(quota) ? quota : 0 });
  return backWith(c, "/user", "ok", tr(c)("keys.quotaUpdated"));
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
