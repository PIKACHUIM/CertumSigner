/**
 * 用户门户：登录、查看自己的 Key 与调用记录、自助创建 Key。
 * 只能使用管理员分配给自己的 Certum 凭据。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { ApiKeyRecord, Env, ScanVerdict, UserRecord, UserSessionRecord } from "../types";
import { authenticateUserDetailed, createUser, deleteUser, findUserByEmail, getUser, updateUser, userExpired } from "../store/users";
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
import { constantTimeEqual, sha256Hex } from "../lib/encoding";
import { readConfig } from "../store/config";
import {
  SCAN_BUFFER_LIMIT_BYTES,
  ScanError,
  evaluateVerdict,
  isScanConfigured,
  lookupVerdict,
  pollScanAnalysis,
  readScanSettings,
  scanUploadLimitBytes,
  uploadForScan,
} from "../scan";
import { issueCaptcha, verifyCaptchaFor } from "../lib/captcha";
import { mailConfigured, mailTemplate, sendMail, siteBase } from "../lib/mail";
import { createEmailToken, peekEmailToken, consumeEmailToken, RESET_TTL_MS, VERIFY_TTL_MS } from "../store/email-tokens";
import { readSettings } from "../store/settings";
import type { CaptchaMode, SystemSettings } from "../store/settings";
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
  userScanPage,
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

/** 新建 Key 后把明文和整条记录一起暂存：KV 的 list 是最终一致的，列表里可能还看不到它 */
interface RevealedKey {
  plaintext: string;
  key: ApiKeyRecord;
}

async function consumeReveal(c: Context<UserEnv>): Promise<RevealedKey | undefined> {
  const id = new URL(c.req.url).searchParams.get("reveal");
  if (!id) return undefined;
  const raw = await c.env.CERTUM_KV.get(`reveal:${id}`);
  if (!raw) return undefined;
  await c.env.CERTUM_KV.delete(`reveal:${id}`);
  try {
    return JSON.parse(raw) as RevealedKey;
  } catch {
    return undefined;
  }
}

async function loadUser(c: Context<UserEnv>): Promise<UserRecord | null> {
  return getUser(c.env, c.get("userSession").userId);
}

async function renderDashboard(
  c: Context<UserEnv>,
  extra: { notice?: string; error?: string; revealedKey?: string; freshKey?: ApiKeyRecord } = {},
): Promise<string> {
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
  const shownKeys =
    extra.freshKey && !keys.some((key) => key.id === extra.freshKey!.id) ? [extra.freshKey, ...keys] : keys;

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
    keys: shownKeys,
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
    captcha: await issueCaptcha(c.env, settings.captchaMode),
    canRegister: settings.registerEnabled,
    canReset: settings.resetEnabled,
  };
}

/** 注册 / 找回密码的发信验证码：开关关闭就不校验，全局方式是「关闭」时退回图形码 */
function emailCaptchaMode(settings: SystemSettings): CaptchaMode {
  if (!settings.emailCaptcha) return "off";
  return settings.captchaMode === "off" ? "svg" : settings.captchaMode;
}

function passwordProblem(password: string, password2: string, t: Translate): string | null {
  if (password.length < 8) return t("register.errPassword");
  if (password !== password2) return t("register.errMismatch");
  return null;
}

async function sendVerifyMail(c: Context<UserEnv>, account: UserRecord, token: string): Promise<void> {
  const { t } = pageContext(c);
  const link = `${(await siteBase(c.env, c.req.url))}/user/verify?token=${encodeURIComponent(token)}`;
  await sendMail(c.env, {
    to: account.email,
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
  const link = `${(await siteBase(c.env, c.req.url))}/user/reset/confirm?token=${encodeURIComponent(token)}`;
  await sendMail(c.env, {
    to: account.email,
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
        captcha: await issueCaptcha(c.env, settings.captchaMode),
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
  const captchaOk = await verifyCaptchaFor(c.env, settings.captchaMode, {
    id: one(form, "captchaId"),
    answer: one(form, "captcha"),
    token: one(form, "cf-turnstile-response"),
    ip,
  });
  if (!captchaOk) {
    await bumpFailure(c.env, ip);
    return loginPage(t("login.errCaptcha"), 401);
  }

  const email = one(form, "email");
  const password = one(form, "password");
  const result = await authenticateUserDetailed(c.env, email, password);

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
      error: (await mailConfigured(c.env)) ? undefined : context.t("settings.mailMissing"),
      captcha: await issueCaptcha(c.env, emailCaptchaMode(settings)),
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
  const registerCaptcha = emailCaptchaMode(settings);
  const registerPage = async (error: string) =>
    c.html(
      userRegisterPage({
        ...context,
        error,
        captcha: await issueCaptcha(c.env, registerCaptcha),
      }),
      400,
    );

  if (
    !(await verifyCaptchaFor(c.env, registerCaptcha, {
      id: one(form, "captchaId"),
      answer: one(form, "captcha"),
      token: one(form, "cf-turnstile-response"),
      ip: c.req.header("cf-connecting-ip") ?? "unknown",
    }))
  ) {
    return registerPage(t("login.errCaptcha"));
  }

  const password = one(form, "password");
  const problem = passwordProblem(password, one(form, "password2"), t);
  if (problem) {
    return registerPage(problem);
  }

  if (!(await mailConfigured(c.env))) {
    return registerPage(t("settings.mailMissing"));
  }

  try {
    const account = await createUser(c.env, {
      email: one(form, "email"),
      password,
      emailVerified: false,
      createdBy: "self-register",
      dailyQuota: 0,
    });

    const token = await createEmailToken(c.env, {
      userId: account.id,
      email: account.email,
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
      userRegisterDonePage({ ...context, email: account.email }),
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
  if (!account || account.email !== record.email) {
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
  if (!(await mailConfigured(c.env))) {
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
      captcha: await issueCaptcha(c.env, emailCaptchaMode(settings)),
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
  if (
    !(await verifyCaptchaFor(c.env, emailCaptchaMode(settings), {
      id: one(form, "captchaId"),
      answer: one(form, "captcha"),
      token: one(form, "cf-turnstile-response"),
      ip: c.req.header("cf-connecting-ip") ?? "unknown",
    }))
  ) {
    return c.html(
      userResetPage({
        ...context,
        error: t("login.errCaptcha"),
        captcha: await issueCaptcha(c.env, emailCaptchaMode(settings)),
      }),
      400,
    );
  }
  if (!(await mailConfigured(c.env))) {
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
  const account = await findUserByEmail(c.env, one(form, "account"));
  if (account) {
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
  if (!account || account.email !== record.email) {
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
  const revealed = await consumeReveal(c);
  return c.html(await renderDashboard(c, { revealedKey: revealed?.plaintext, freshKey: revealed?.key }));
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
    await c.env.CERTUM_KV.put(`reveal:${revealId}`, JSON.stringify({ plaintext: created.plaintext, key: created.record }), {
      expirationTtl: 300,
    });
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

secure.post("/keys/:id/update", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return c.html(`<h1>${tr(c)("msg.csrf")}</h1>`, 403);

  const key = await ownKey(c, c.req.param("id"));
  if (!key) return backWith(c, "/user", "error", tr(c)("msg.notFoundKey"));
  const quota = Number(one(form, "dailyQuota") || "0");
  try {
    await updateApiKey(c.env, key.id, {
      name: one(form, "name") || key.name,
      dailyQuota: Number.isFinite(quota) ? quota : 0,
    });
    return backWith(c, "/user", "ok", tr(c)("msg.keyUpdated"));
  } catch (error) {
    return backWith(c, "/user", "error", localizeError(tr(c), error instanceof Error ? error.message : String(error)));
  }
});

secure.post("/keys/:id/delete", async (c) => {
  const form = await readForm(c);
  if (!(await checkCsrf(c, form))) return c.html(`<h1>${tr(c)("msg.csrf")}</h1>`, 403);

  const key = await ownKey(c, c.req.param("id"));
  if (!key) return backWith(c, "/user", "error", tr(c)("msg.notFoundKey"));
  await deleteApiKey(c.env, key.id);
  return backWith(c, "/user", "ok", tr(c)("msg.keyDeleted"));
});

/* -------------------------------- 病毒扫描 -------------------------------- */

secure.get("/scan", async (c) => {
  const account = c.get("user");
  const context = pageContext(c);
  const messages = queryMessages(c);
  const config = await readConfig(c.env);
  const settings = readScanSettings(config);
  const url = new URL(c.req.url);
  const sha = (url.searchParams.get("sha256") ?? "").trim().toLowerCase();
  const validSha = /^[0-9a-f]{64}$/.test(sha) ? sha : "";
  const analysisId = url.searchParams.get("analysis") ?? "";

  let verdict: ScanVerdict | null = null;
  let pending = false;
  let error: string | undefined;
  if (settings.apiKey && (validSha || analysisId)) {
    try {
      if (analysisId) {
        const state = await pollScanAnalysis(c.env, settings, analysisId);
        if (state?.done) verdict = state.verdict ?? null;
        else pending = !!state;
      } else if (validSha) {
        verdict = await lookupVerdict(c.env, settings, validSha);
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }

  // 能否签名取该用户名下最严格的证书策略；没有开启扫描的证书时只显示风险
  let risk: number | undefined;
  let allowed: boolean | undefined;
  if (verdict) {
    const credentials = (await listCredentials(c.env)).filter(
      (cred) => account.credentialIds.includes(cred.id) && (cred.scanMode ?? "off") !== "off",
    );
    if (credentials.length > 0) {
      const maxRisk = Math.min(...credentials.map((cred) => Math.max(0, Math.floor(cred.scanMaxRisk ?? 0))));
      const evaluation = evaluateVerdict(verdict, maxRisk);
      risk = evaluation.risk;
      allowed = evaluation.allowed;
    } else {
      risk = verdict.malicious + verdict.suspicious;
    }
  }

  return c.html(
    userScanPage({
      ...context,
      ...messages,
      csrf: c.get("userSession").csrf,
      user: account,
      provider: settings.provider,
      configured: isScanConfigured(settings),
      maxUploadMb: Math.min(settings.maxUploadMb, Math.floor(SCAN_BUFFER_LIMIT_BYTES / 1048576)),
      sha256: validSha || undefined,
      verdict: verdict ?? undefined,
      risk,
      allowed,
      pending,
      error: messages.error ?? error,
    }),
  );
});

secure.post("/scan", async (c) => {
  // 门户用 multipart 表单，会整份读进内存；超过缓冲上限必须在解析前挡掉
  const declaredRaw = c.req.header("content-length");
  const declared = declaredRaw ? Number(declaredRaw) : 0;
  if (Number.isFinite(declared) && declared > SCAN_BUFFER_LIMIT_BYTES + 1048576) {
    return backWith(c, "/user/scan", "error", tr(c)("scan.tooLargePortal"));
  }

  const form = await c.req.parseBody();
  const csrf = typeof form["csrf"] === "string" ? form["csrf"] : "";
  if (!constantTimeEqual(csrf, c.get("userSession").csrf)) {
    return c.html(`<h1>${tr(c)("msg.csrf")}</h1>`, 403);
  }

  const config = await readConfig(c.env);
  const settings = readScanSettings(config);
  if (!isScanConfigured(settings)) return backWith(c, "/user/scan", "error", tr(c)("scan.notConfigured"));

  const file = form["file"];
  if (!(file instanceof File)) return backWith(c, "/user/scan", "error", tr(c)("scan.chooseFile"));
  if (file.size <= 0) return backWith(c, "/user/scan", "error", tr(c)("scan.chooseFile"));
  if (file.size > SCAN_BUFFER_LIMIT_BYTES || file.size > scanUploadLimitBytes(settings)) {
    return backWith(c, "/user/scan", "error", tr(c)("scan.tooLargePortal"));
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = await sha256Hex(bytes);
    // 已经扫过就直接看结果，不浪费配额重复上传
    const existing = await lookupVerdict(c.env, settings, sha256);
    if (existing) return c.redirect(`/user/scan?sha256=${sha256}`);

    const result = await uploadForScan(c.env, settings, bytes, file.name || `${sha256}.bin`, sha256);
    return c.redirect(
      `/user/scan?sha256=${result.sha256}&analysis=${encodeURIComponent(result.id)}&pending=1`,
    );
  } catch (caught) {
    const message =
      caught instanceof ScanError || caught instanceof Error ? caught.message : String(caught);
    return backWith(c, "/user/scan", "error", message);
  }
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
