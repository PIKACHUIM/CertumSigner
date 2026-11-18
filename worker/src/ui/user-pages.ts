/** 用户门户页面 */
import type { ApiKeyRecord, CredentialRecord, SignLogRecord, UserRecord } from "../types";
import type { Translate } from "./i18n";
import type { Prefs } from "./prefs";
import {
  captchaField,
  detailModal,
  emptyRow,
  escapeHtml,
  fmtTime,
  formModal,
  loginShell,
  navIcon,
  pill,
  revealBanner,
  shell,
  statCard,
  type CaptchaView,
  type NavItem,
} from "./layout";

export interface UserPageData {
  user: UserRecord;
  credentials: CredentialRecord[];
  keys: ApiKeyRecord[];
  usage: Record<string, number>;
  /** 用户级当日已用签名数 */
  userUsage?: number;
  logs: SignLogRecord[];
  csrf: string;
  notice?: string;
  error?: string;
  revealedKey?: string;
  prefs: Prefs;
  t: Translate;
  self: string;
}

function nav(t: Translate): NavItem[] {
  return [
    { href: "/user", label: t("nav.myKeys"), icon: navIcon("keys") },
    { href: "/user/logs", label: t("nav.myLogs"), icon: navIcon("logs") },
  ];
}

function userShell(active: string, title: string, subtitle: string, data: UserPageData, body: string): string {
  return shell({
    title,
    subtitle,
    active,
    self: data.self,
    nav: nav(data.t),
    csrf: data.csrf,
    userLabel: `${data.t("chrome.signedInAs")}：${data.user.email}`,
    prefs: data.prefs,
    t: data.t,
    notice: data.notice,
    error: data.error,
    body,
  });
}

export function userLoginPage(data: {
  prefs: Prefs;
  t: Translate;
  self: string;
  error?: string;
  notice?: string;
  captcha?: CaptchaView;
  canRegister?: boolean;
  canReset?: boolean;
}): string {
  const { t } = data;
  const links = [
    data.canRegister
      ? `<span>${escapeHtml(t("login.noAccountHint"))} <a href="/user/register">${escapeHtml(t("login.registerLink"))}</a></span>`
      : `<span>${escapeHtml(t("login.noAccount"))}</span>`,
    data.canReset ? `<a href="/user/reset">${escapeHtml(t("login.forgotLink"))}</a>` : "",
  ]
    .filter(Boolean)
    .join("");

  return loginShell({
    title: t("login.userTitle"),
    subtitle: t("login.userSubtitle"),
    action: "/user/login",
    prefs: data.prefs,
    t,
    self: data.self,
    error: data.error,
    notice: data.notice,
    captcha: data.captcha,
    body: `<label class="auth__field">${escapeHtml(t("login.email"))}
      <div class="auth__box"><input type="email" name="email" autocomplete="username" autofocus required></div>
    </label>
    <label class="auth__field">${escapeHtml(t("login.userPassword"))}
      <div class="auth__box">
        <input type="password" name="password" autocomplete="current-password" required>
        <button type="button" class="auth__peek" data-peek data-show="${escapeHtml(
          t("login.show"),
        )}" data-hide="${escapeHtml(t("login.hide"))}">${escapeHtml(t("login.show"))}</button>
      </div>
    </label>
    ${data.captcha ? captchaField(data.captcha, t) : ""}
    <button class="btn btn--primary auth__submit" type="submit">
      <span>${escapeHtml(t("login.submit"))}</span><span class="arrow">→</span>
    </button>
    <div class="auth__links">${links}</div>
    <p class="login-foot">${escapeHtml(t("login.toAdmin"))} <a href="/admin/login">${escapeHtml(
      t("login.adminLink"),
    )}</a></p>`,
  });
}

/** 结果 / 不可用提示页：不套表单，只给一个返回按钮 */
export function userMessagePage(data: {
  prefs: Prefs;
  t: Translate;
  self: string;
  title: string;
  subtitle: string;
  notice?: string;
  error?: string;
  backHref?: string;
  backLabel?: string;
}): string {
  const { t } = data;
  return loginShell({
    title: data.title,
    subtitle: data.subtitle,
    action: "/user/login",
    prefs: data.prefs,
    t,
    self: data.self,
    notice: data.notice,
    error: data.error,
    wide: true,
    formless: true,
    body: `<div class="auth__done">
      <a class="btn btn--primary" href="${escapeHtml(data.backHref ?? "/user/login")}">${escapeHtml(
        data.backLabel ?? t("reset.backLogin"),
      )}</a>
    </div>`,
  });
}

export function userRegisterPage(data: {
  prefs: Prefs;
  t: Translate;
  self: string;
  error?: string;
  notice?: string;
  captcha?: CaptchaView;
}): string {
  const { t } = data;
  return loginShell({
    title: t("register.title"),
    subtitle: t("register.subtitle"),
    action: "/user/register",
    prefs: data.prefs,
    t,
    self: data.self,
    error: data.error,
    notice: data.notice,
    captcha: data.captcha,
    wide: true,
    body: `<label class="auth__field">${escapeHtml(t("register.email"))}
      <div class="auth__box"><input type="email" name="email" autocomplete="username" autofocus required></div>
    </label>
    <label class="auth__field">${escapeHtml(t("register.password"))}
      <div class="auth__box">
        <input type="password" name="password" autocomplete="new-password" minlength="8" required>
        <button type="button" class="auth__peek" data-peek data-show="${escapeHtml(
          t("login.show"),
        )}" data-hide="${escapeHtml(t("login.hide"))}">${escapeHtml(t("login.show"))}</button>
      </div>
    </label>
    <label class="auth__field">${escapeHtml(t("register.password2"))}
      <div class="auth__box"><input type="password" name="password2" autocomplete="new-password" minlength="8" required></div>
    </label>
    ${data.captcha ? captchaField(data.captcha, t) : ""}
    <button class="btn btn--primary auth__submit" type="submit">
      <span>${escapeHtml(t("register.submit"))}</span><span class="arrow">→</span>
    </button>
    <div class="auth__links"><span>${escapeHtml(t("register.hasAccount"))} <a href="/user/login">${escapeHtml(
      t("register.toLogin"),
    )}</a></span></div>`,
  });
}

export function userRegisterDonePage(data: {
  prefs: Prefs;
  t: Translate;
  self: string;
  email: string;
}): string {
  const { t } = data;
  return loginShell({
    title: t("register.done"),
    subtitle: t("register.doneHint", { email: data.email }),
    action: "/user/login",
    prefs: data.prefs,
    t,
    self: data.self,
    wide: true,
    formless: true,
    body: `<div class="auth__done">
      <span class="mark">✓</span>
      <a class="btn btn--primary" href="/user/login" style="margin-top:6px">${escapeHtml(t("register.toLogin"))}</a>
    </div>`,
  });
}

export function userVerifyPage(data: {
  prefs: Prefs;
  t: Translate;
  self: string;
  token?: string;
  error?: string;
  done?: boolean;
}): string {
  const { t } = data;
  if (data.done) {
    return loginShell({
      title: t("register.verifyTitle"),
      subtitle: t("register.verifyOk"),
      action: "/user/login",
      prefs: data.prefs,
      t,
      self: data.self,
      wide: true,
      formless: true,
      body: `<div class="auth__done">
        <span class="mark">✓</span>
        <a class="btn btn--primary" href="/user/login">${escapeHtml(t("register.toLogin"))}</a>
      </div>`,
    });
  }
  if (!data.token || data.error) {
    return loginShell({
      title: t("register.verifyTitle"),
      subtitle: data.error ?? t("register.verifyFail"),
      action: "/user/login",
      prefs: data.prefs,
      t,
      self: data.self,
      wide: true,
      formless: true,
      body: `<div class="auth__done">
        <a class="btn btn--primary" href="/user/login">${escapeHtml(t("register.toLogin"))}</a>
      </div>`,
    });
  }
  return loginShell({
    title: t("register.verifyTitle"),
    subtitle: t("register.verifyLead"),
    action: "/user/verify",
    prefs: data.prefs,
    t,
    self: data.self,
    wide: true,
    body: `<input type="hidden" name="token" value="${escapeHtml(data.token ?? "")}">
      <button class="btn btn--primary auth__submit" type="submit">
        <span>${escapeHtml(t("register.verifyButton"))}</span><span class="arrow">→</span>
      </button>`,
  });
}

export function userResetPage(data: {
  prefs: Prefs;
  t: Translate;
  self: string;
  error?: string;
  notice?: string;
  captcha?: CaptchaView;
}): string {
  const { t } = data;
  return loginShell({
    title: t("reset.title"),
    subtitle: t("reset.subtitle"),
    action: "/user/reset",
    prefs: data.prefs,
    t,
    self: data.self,
    error: data.error,
    notice: data.notice,
    captcha: data.captcha,
    body: `<label class="auth__field">${escapeHtml(t("reset.account"))}
      <div class="auth__box"><input type="email" name="account" autocomplete="username" autofocus required></div>
    </label>
    ${data.captcha ? captchaField(data.captcha, t) : ""}
    <button class="btn btn--primary auth__submit" type="submit">
      <span>${escapeHtml(t("reset.submit"))}</span><span class="arrow">→</span>
    </button>
    <div class="auth__links"><a href="/user/login">← ${escapeHtml(t("reset.backLogin"))}</a></div>`,
  });
}

export function userResetConfirmPage(data: {
  prefs: Prefs;
  t: Translate;
  self: string;
  token?: string;
  error?: string;
  done?: boolean;
}): string {
  const { t } = data;
  if (data.done) {
    return loginShell({
      title: t("reset.title"),
      subtitle: t("reset.ok"),
      action: "/user/login",
      prefs: data.prefs,
      t,
      self: data.self,
      formless: true,
      body: `<div class="auth__done">
        <span class="mark">✓</span>
        <a class="btn btn--primary" href="/user/login">${escapeHtml(t("reset.backLogin"))}</a>
      </div>`,
    });
  }
  if (!data.token || data.error) {
    return loginShell({
      title: t("reset.title"),
      subtitle: data.error ?? t("reset.fail"),
      action: "/user/login",
      prefs: data.prefs,
      t,
      self: data.self,
      formless: true,
      body: `<div class="auth__done">
        <a class="btn btn--primary" href="/user/login">${escapeHtml(t("reset.backLogin"))}</a>
      </div>`,
    });
  }
  return loginShell({
    title: t("reset.newTitle"),
    subtitle: t("reset.newSubtitle"),
    action: "/user/reset/confirm",
    prefs: data.prefs,
    t,
    self: data.self,
    body: `<input type="hidden" name="token" value="${escapeHtml(data.token ?? "")}">
      <label class="auth__field">${escapeHtml(t("reset.newPassword"))}
        <div class="auth__box">
          <input type="password" name="password" autocomplete="new-password" minlength="8" autofocus required>
          <button type="button" class="auth__peek" data-peek data-show="${escapeHtml(
            t("login.show"),
          )}" data-hide="${escapeHtml(t("login.hide"))}">${escapeHtml(t("login.show"))}</button>
        </div>
      </label>
      <label class="auth__field">${escapeHtml(t("reset.confirm"))}
        <div class="auth__box"><input type="password" name="password2" autocomplete="new-password" minlength="8" required></div>
      </label>
      <button class="btn btn--primary auth__submit" type="submit">
        <span>${escapeHtml(t("common.save"))}</span><span class="arrow">→</span>
      </button>`,
  });
}

function logDialogId(log: SignLogRecord): string {
  return `log-${log.id.replace(/[^A-Za-z0-9]/g, "")}`;
}

function logDetailDialog(log: SignLogRecord, t: Translate): string {
  const rows: Array<[string, string]> = [
    [t("logs.requestId"), `<span class="mono">${escapeHtml(log.id)}</span>`],
    [t("logs.time"), escapeHtml(fmtTime(log.at))],
    [t("logs.key"), `${escapeHtml(log.keyName)} <span class="mono muted">${escapeHtml(log.keyId)}</span>`],
    [t("logs.algorithm"), escapeHtml(log.algorithm.toUpperCase())],
    [t("logs.digest"), `<span class="mono">${escapeHtml(log.digestPrefix)}…</span>`],
    [t("logs.digestCount"), escapeHtml(String(log.count))],
    [t("logs.result"), log.ok ? pill(t("common.success"), "ok") : pill(t("common.failure"), "bad")],
    [t("logs.duration"), `${log.durationMs} ms`],
    [t("logs.ip"), `<span class="mono">${escapeHtml(log.ip || "—")}</span>`],
    [t("logs.userAgent"), escapeHtml(log.userAgent || "—")],
    [t("logs.errorInfo"), log.error ? `<span style="color:var(--bad)">${escapeHtml(log.error)}</span>` : "—"],
  ];
  return detailModal({ id: logDialogId(log), title: t("logs.detailTitle"), rows, close: t("common.close") });
}

export function userDashboardPage(data: UserPageData): string {
  const { t } = data;
  const credName = new Map(data.credentials.map((cred) => [cred.id, cred.label]));
  const totalSigns = data.keys.reduce((sum, key) => sum + key.totalSigns, 0);
  const todaySigns = data.userUsage ?? data.keys.reduce((sum, key) => sum + (data.usage[key.id] ?? 0), 0);

  const rows = data.keys
    .map(
      (key) => `<tr>
        <td><strong>${escapeHtml(key.name)}</strong><div class="small muted mono">${escapeHtml(key.prefix)}…</div></td>
        <td class="small hide-xs">${escapeHtml(
          key.credentialId ? credName.get(key.credentialId) ?? t("keys.deletedCred") : t("keys.defaultCred"),
        )}</td>
        <td>${key.enabled ? pill(t("common.enabled"), "ok") : pill(t("common.disabled"), "bad")}</td>
        <td class="small">${
          key.dailyQuota
            ? `${data.usage[key.id] ?? 0}/${key.dailyQuota}`
            : `${data.usage[key.id] ?? 0}/${t("common.unlimited")}`
        }</td>
        <td class="small hide-xs">${key.totalSigns}</td>
        <td class="small muted">${key.lastUsedAt ? fmtTime(key.lastUsedAt) : escapeHtml(t("common.never"))}</td>
        <td><div class="row">
          <button class="btn btn--sm btn--ghost" type="button" data-open="keyedit-${escapeHtml(key.id)}">${escapeHtml(
            t("keys.edit"),
          )}</button>
          <form class="inline" method="post" action="/user/keys/${escapeHtml(key.id)}/toggle">
            <input type="hidden" name="csrf" value="${escapeHtml(data.csrf)}">
            <input type="hidden" name="enabled" value="${key.enabled ? "0" : "1"}">
            <button class="btn btn--sm btn--ghost" type="submit">${escapeHtml(
              key.enabled ? t("common.disable") : t("common.enable"),
            )}</button>
          </form>
          <form class="inline" method="post" action="/user/keys/${escapeHtml(key.id)}/delete"
            onsubmit="return confirm('${escapeHtml(t("confirm.deleteKey"))}')">
            <input type="hidden" name="csrf" value="${escapeHtml(data.csrf)}">
            <button class="btn btn--sm btn--danger" type="submit">${escapeHtml(t("common.delete"))}</button>
          </form>
        </div></td>
      </tr>`,
    )
    .join("");

  const credentialOptions = data.credentials
    .map((cred) => `<option value="${escapeHtml(cred.id)}">${escapeHtml(cred.label)} · ${escapeHtml(cred.email)}</option>`)
    .join("");

  const recent = data.logs.slice(0, 8);
  const logRows = recent
    .map((log) => {
      const id = logDialogId(log);
      return `<tr>
        <td class="small">${fmtTime(log.at)}</td>
        <td class="small">${escapeHtml(log.keyName)}</td>
        <td class="small hide-xs">${log.algorithm.toUpperCase()} × ${log.count}</td>
        <td>${log.ok ? pill(t("common.success"), "ok") : pill(t("common.failure"), "bad")}</td>
        <td class="small muted hide-xs">${log.durationMs} ms</td>
        <td><div class="row"><button class="btn btn--sm btn--ghost" type="button" data-open="${id}">${escapeHtml(
          t("common.detail"),
        )}</button></div></td>
      </tr>`;
    })
    .join("");

  const dialog = formModal({
    id: "dlg-key-new",
    title: t("me.newKey"),
    hint: t("me.certHint"),
    action: "/user/keys",
    csrf: data.csrf,
    submit: t("keys.create"),
    cancel: t("common.cancel"),
    body: `<div class="form-grid">
      <label class="field">${escapeHtml(t("keys.name"))}<input type="text" name="name" placeholder="laptop" required></label>
      <label class="field">${escapeHtml(t("keys.quota"))}<input type="number" name="dailyQuota" min="0" value="0"></label>
      <label class="field wide">${escapeHtml(t("keys.cert"))}
        <select name="credentialId" required>${
          credentialOptions || `<option value="">${escapeHtml(t("me.noCert"))}</option>`
        }</select>
      </label>
    </div>`,
  });

  const editDialogs = data.keys
    .map((key) =>
      formModal({
        id: `keyedit-${key.id}`,
        title: t("keys.editTitle"),
        hint: t("keys.editHint"),
        action: `/user/keys/${key.id}/update`,
        csrf: data.csrf,
        submit: t("common.save"),
        cancel: t("common.cancel"),
        body: `<div class="form-grid">
          <label class="field wide">${escapeHtml(t("keys.prefix"))}
            <input type="text" value="${escapeHtml(key.prefix)}…" readonly>
          </label>
          <label class="field wide">${escapeHtml(t("keys.name"))}
            <input type="text" name="name" value="${escapeHtml(key.name)}" maxlength="64" required>
          </label>
          <label class="field wide">${escapeHtml(t("keys.quota"))}
            <input type="number" name="dailyQuota" min="0" value="${key.dailyQuota}">
          </label>
        </div>`,
      }),
    )
    .join("");

  const expired = !!data.user.expiresAt && data.user.expiresAt <= Date.now();
  const userQuota = data.user.dailyQuota || 0;
  const userUsed = data.userUsage ?? 0;

  return userShell(
    "/user",
    t("me.title"),
    t("me.subtitle"),
    data,
    `${data.revealedKey ? revealBanner(data.revealedKey, t) : ""}
    <div class="grid cols-4" style="margin-bottom:16px">
      ${statCard(t("me.todaySigns"), todaySigns, t("me.todayHint"))}
      ${statCard(t("me.totalSigns"), totalSigns, t("me.totalHint"))}
      ${statCard(
        t("me.quotaCard"),
        userQuota ? `${userUsed}/${userQuota}` : t("common.unlimited"),
        t("me.quotaHint"),
      )}
      ${statCard(
        t("me.accountExpiry"),
        data.user.expiresAt ? fmtTime(data.user.expiresAt) : t("common.forever"),
        expired ? t("common.expired") : t("common.normal"),
      )}
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="row" style="justify-content:space-between;margin-bottom:6px">
        <h2 style="margin:0">${escapeHtml(t("me.myKeys"))}</h2>
        <button class="btn btn--primary btn--sm" type="button" data-open="dlg-key-new">＋ ${escapeHtml(
          t("me.newKey"),
        )}</button>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>${escapeHtml(t("keys.name"))}</th><th class="hide-xs">${escapeHtml(t("keys.cert"))}</th><th>${escapeHtml(
            t("common.status"),
          )}</th><th>${escapeHtml(t("overview.todaySignatures"))}</th><th class="hide-xs">${escapeHtml(t("users.total"))}</th><th>${escapeHtml(
            t("users.lastUsed"),
          )}</th><th></th></tr></thead>
          <tbody>${rows || emptyRow(7, t("me.noKey"))}</tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:6px">
        <h2 style="margin:0">${escapeHtml(t("me.recent"))}</h2>
        <a class="btn btn--ghost btn--sm" href="/user/logs">${escapeHtml(t("overview.viewAll"))}</a>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>${escapeHtml(t("logs.time"))}</th><th>Key</th><th class="hide-xs">${escapeHtml(t("logs.algorithm"))}</th><th>${escapeHtml(t("logs.result"))}</th><th class="hide-xs">${escapeHtml(t("logs.duration"))}</th><th></th></tr></thead>
          <tbody>${logRows || emptyRow(6, t("logs.empty"))}</tbody>
        </table>
      </div>
    </div>
    ${dialog}
    ${editDialogs}
    ${recent.map((log) => logDetailDialog(log, t)).join("")}`,
  );
}

export function userLogsPage(data: UserPageData): string {
  const { t } = data;
  const rows = data.logs
    .map((log) => {
      const id = logDialogId(log);
      return `<tr>
        <td class="small">${fmtTime(log.at)}</td>
        <td class="small">${escapeHtml(log.keyName)}</td>
        <td class="small hide-xs">${log.algorithm.toUpperCase()} × ${log.count}</td>
        <td class="small mono">${escapeHtml(log.digestPrefix)}…</td>
        <td>${log.ok ? pill(t("common.success"), "ok") : pill(t("common.failure"), "bad")}</td>
        <td class="small muted hide-xs">${log.durationMs} ms</td>
        <td><div class="row"><button class="btn btn--sm btn--ghost" type="button" data-open="${id}">${escapeHtml(
          t("common.detail"),
        )}</button></div></td>
      </tr>`;
    })
    .join("");

  return userShell(
    "/user/logs",
    t("nav.myLogs"),
    t("me.logsSubtitle"),
    data,
    `<div class="card">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>${escapeHtml(t("logs.time"))}</th><th>Key</th><th class="hide-xs">${escapeHtml(t("logs.algorithm"))}</th><th>${escapeHtml(t("logs.digest"))}</th><th>${escapeHtml(t("logs.result"))}</th><th class="hide-xs">${escapeHtml(t("logs.duration"))}</th><th></th></tr></thead>
          <tbody>${rows || emptyRow(7, t("logs.empty"))}</tbody>
        </table>
      </div>
    </div>
    ${data.logs.map((log) => logDetailDialog(log, t)).join("")}`,
  );
}
