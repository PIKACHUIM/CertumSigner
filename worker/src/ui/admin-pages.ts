/** 管理后台页面 */
import type { ApiKeyRecord, CredentialRecord, SignLogRecord, StatsBucket, UserRecord } from "../types";
import type { Translate } from "./i18n";
import type { Prefs } from "./prefs";
import {
  captchaField,
  detailModal,
  emptyRow,
  escapeHtml,
  fmtDateInput,
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
import type { SystemSettings } from "../store/settings";
import type { RuntimeConfig } from "../store/config";

export interface CredentialStatus {
  sessionExpiresAt?: number;
  cardSerial?: string;
  cardFingerprint1?: string;
}

export interface AdminNavData {
  csrf: string;
  notice?: string;
  error?: string;
  prefs: Prefs;
  t: Translate;
  /** 当前路径（含查询串），偏好切换后跳回这里 */
  self: string;
}

function nav(t: Translate): NavItem[] {
  return [
    { href: "/admin", label: t("nav.overview"), icon: navIcon("overview") },
    { href: "/admin/users", label: t("nav.users"), icon: navIcon("users") },
    { href: "/admin/credentials", label: t("nav.credentials"), icon: navIcon("credentials") },
    { href: "/admin/keys", label: t("nav.keys"), icon: navIcon("keys") },
    { href: "/admin/logs", label: t("nav.logs"), icon: navIcon("logs") },
    { href: "/admin/settings", label: t("nav.settings"), icon: navIcon("settings") },
  ];
}

function page(active: string, title: string, subtitle: string, data: AdminNavData, body: string): string {
  return shell({
    title,
    subtitle,
    active,
    self: data.self,
    nav: nav(data.t),
    csrf: data.csrf,
    userLabel: data.t("chrome.admin"),
    prefs: data.prefs,
    t: data.t,
    notice: data.notice,
    error: data.error,
    body,
  });
}

export function adminLoginPage(data: {
  prefs: Prefs;
  t: Translate;
  self: string;
  error?: string;
  notice?: string;
  captcha?: CaptchaView;
  /** KV 里存的是「用户名 + 密码」，登录页要显示用户名输入框 */
  useUsername?: boolean;
  username?: string;
}): string {
  const { t } = data;
  const show = escapeHtml(t("login.show"));
  const hide = escapeHtml(t("login.hide"));
  const usernameField = data.useUsername
    ? `<label class="auth__field">${escapeHtml(t("login.username"))}
      <input type="text" name="username" autocomplete="username" value="${escapeHtml(data.username ?? "")}" required autofocus>
    </label>`
    : "";
  return loginShell({
    title: t("login.adminTitle"),
    subtitle: t("login.adminSubtitle"),
    action: "/admin/login",
    prefs: data.prefs,
    t,
    self: data.self,
    error: data.error,
    notice: data.notice,
    captcha: data.captcha,
    body: `${usernameField}<label class="auth__field">${escapeHtml(t("login.password"))}
      <div class="auth__box">
        <input type="password" name="password" autocomplete="current-password" ${
          data.useUsername ? "" : "autofocus "
        }required>
        <button type="button" class="auth__peek" data-peek data-show="${show}" data-hide="${hide}">${show}</button>
      </div>
    </label>
    ${data.captcha ? captchaField(data.captcha, t) : ""}
    <button class="btn btn--primary auth__submit" type="submit">
      <span>${escapeHtml(t("login.submit"))}</span><span class="arrow">→</span>
    </button>
    <div class="auth__links"><span>${escapeHtml(t("login.toUser"))} <a href="/user/login">${escapeHtml(
      t("login.userLink"),
    )}</a></span><a href="/">${escapeHtml(t("login.backHome"))}</a></div>`,
  });
}

export function adminSetupPage(data: {
  prefs: Prefs;
  t: Translate;
  self: string;
  error?: string;
  username?: string;
}): string {
  const { t } = data;
  const show = escapeHtml(t("login.show"));
  const hide = escapeHtml(t("login.hide"));
  return loginShell({
    title: t("setup.title"),
    subtitle: t("setup.subtitle"),
    action: "/admin/setup",
    prefs: data.prefs,
    t,
    self: data.self,
    error: data.error,
    body: `<label class="auth__field">${escapeHtml(t("setup.username"))}
      <input type="text" name="username" autocomplete="username" value="${escapeHtml(
        data.username ?? "admin",
      )}" minlength="3" maxlength="32" required autofocus>
    </label>
    <label class="auth__field">${escapeHtml(t("setup.password"))}
      <div class="auth__box">
        <input type="password" name="password" autocomplete="new-password" minlength="10" required>
        <button type="button" class="auth__peek" data-peek data-show="${show}" data-hide="${hide}">${show}</button>
      </div>
    </label>
    <label class="auth__field">${escapeHtml(t("setup.confirm"))}
      <div class="auth__box">
        <input type="password" name="confirm" autocomplete="new-password" minlength="10" required>
        <button type="button" class="auth__peek" data-peek data-show="${show}" data-hide="${hide}">${show}</button>
      </div>
    </label>
    <p class="small muted" style="margin:0">${escapeHtml(t("setup.hint"))}</p>
    <button class="btn btn--primary auth__submit" type="submit">
      <span>${escapeHtml(t("setup.submit"))}</span><span class="arrow">→</span>
    </button>
    <div class="auth__links"><span>${escapeHtml(t("setup.retryHint"))}</span><a href="/">${escapeHtml(
      t("login.backHome"),
    )}</a></div>`,
  });
}

/* -------------------------------- 概览 ---------------------------------- */

export interface DashboardData extends AdminNavData {
  users: UserRecord[];
  credentials: CredentialRecord[];
  keys: ApiKeyRecord[];
  statuses: Record<string, CredentialStatus>;
  stats: { total: StatsBucket; today: StatsBucket };
  logs: SignLogRecord[];
  userName: Map<string, string>;
  credName: Map<string, string>;
}

export function adminDashboardPage(data: DashboardData): string {
  const { t } = data;
  const enabledCreds = data.credentials.filter((item) => item.enabled).length;
  const enabledUsers = data.users.filter((item) => item.enabled).length;
  const enabledKeys = data.keys.filter((item) => item.enabled).length;

  const credentialRows = data.credentials
    .map((cred) => {
      const status = data.statuses[cred.id] ?? {};
      return `<tr>
        <td><strong>${escapeHtml(cred.label)}</strong><div class="small muted hide-xs">${escapeHtml(cred.email)}</div></td>
        <td>${cred.enabled ? pill(t("common.enabled"), "ok") : pill(t("common.disabled"), "bad")}</td>
        <td class="small mono hide-xs">${
          cred.certificateSha1 ? escapeHtml(cred.certificateSha1.slice(0, 16) + "…") : escapeHtml(t("cred.firstCard"))
        }</td>
        <td class="small">${
          status.sessionExpiresAt ? fmtTime(status.sessionExpiresAt) : `<span class="muted">${escapeHtml(t("cred.notLoggedIn"))}</span>`
        }</td>
        <td class="small mono hide-xs">${status.cardSerial ? escapeHtml(status.cardSerial) : "—"}</td>
      </tr>`;
    })
    .join("");

  const recent = data.logs.slice(0, 8);
  const logRows = recent
    .map((log) => {
      const id = logDialogId(log);
      return `<tr>
        <td class="small">${fmtTime(log.at)}</td>
        <td class="small hide-xs">${escapeHtml(log.keyName)}</td>
        <td class="small">${
          log.userId ? escapeHtml(data.userName.get(log.userId) ?? t("keys.deletedUser")) : escapeHtml(t("common.platform"))
        }</td>
        <td class="small hide-xs">${log.algorithm.toUpperCase()} × ${log.count}</td>
        <td>${log.ok ? pill(t("common.success"), "ok") : pill(t("common.failure"), "bad")}</td>
        <td class="small muted hide-xs">${log.durationMs} ms</td>
        <td><div class="row"><button class="btn btn--sm btn--ghost" type="button" data-open="${id}">${escapeHtml(
          t("common.detail"),
        )}</button></div></td>
      </tr>`;
    })
    .join("");

  return page(
    "/admin",
    t("overview.title"),
    t("overview.subtitle"),
    data,
    `<div class="grid cols-4" style="margin-bottom:16px">
      ${statCard(
        t("overview.todayRequests"),
        data.stats.today.requests,
        t("overview.okFail", { ok: data.stats.today.ok, fail: data.stats.today.fail }),
      )}
      ${statCard(t("overview.todaySignatures"), data.stats.today.signatures, t("overview.cloudSigns"))}
      ${statCard(
        t("overview.users"),
        `${enabledUsers}/${data.users.length}`,
        t("overview.onOff", { on: enabledUsers, total: data.users.length }),
      )}
      ${statCard(
        t("overview.keys"),
        `${enabledKeys}/${data.keys.length}`,
        t("overview.onOff", { on: enabledKeys, total: data.keys.length }),
      )}
    </div>
    <div class="grid cols-2">
      <div class="card">
        <h2>${escapeHtml(t("overview.credentialCard"))} <span class="pill pill--muted">${enabledCreds}/${data.credentials.length}</span></h2>
        <p class="hint">${escapeHtml(t("overview.credentialHint"))}</p>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>${escapeHtml(t("cred.label"))}</th><th>${escapeHtml(t("common.status"))}</th><th class="hide-xs">${escapeHtml(t("cred.certSha1"))}</th><th>${escapeHtml(t("cred.session"))}</th><th class="hide-xs">${escapeHtml(t("cred.card"))}</th></tr></thead>
            <tbody>${credentialRows || emptyRow(5, t("overview.noCred"))}</tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <h2>${escapeHtml(t("overview.recentSigns"))}</h2>
        <p class="hint">${escapeHtml(t("overview.recentHint"))}</p>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>${escapeHtml(t("logs.time"))}</th><th class="hide-xs">Key</th><th>${escapeHtml(
              t("logs.user"),
            )}</th><th class="hide-xs">${escapeHtml(t("logs.algorithm"))}</th><th>${escapeHtml(t("logs.result"))}</th><th class="hide-xs">${escapeHtml(t("logs.duration"))}</th><th></th></tr></thead>
            <tbody>${logRows || emptyRow(7, t("logs.empty"))}</tbody>
          </table>
        </div>
        <div class="row row--end" style="margin-top:12px">
          <a class="btn btn--ghost btn--sm" href="/admin/logs">${escapeHtml(t("overview.viewAll"))}</a>
          <a class="btn btn--ghost btn--sm" href="/admin/users">${escapeHtml(t("overview.manageUsers"))}</a>
        </div>
      </div>
    </div>
    ${recent.map((log) => logDetailDialog(log, data)).join("")}`,
  );
}

/* -------------------------------- 用户 ---------------------------------- */

export interface UsersPageData extends AdminNavData {
  users: UserRecord[];
  credentials: CredentialRecord[];
  keyCounts: Record<string, number>;
}

function credentialChecks(credentials: CredentialRecord[], selected: string[], t: Translate): string {
  return credentials
    .map(
      (cred) => `<label><input type="checkbox" name="credentialIds" value="${escapeHtml(cred.id)}" ${
        selected.includes(cred.id) ? "checked" : ""
      }> ${escapeHtml(cred.label)} <span class="muted small">${escapeHtml(cred.email)}</span></label>`,
    )
    .join("");
}

export function adminUsersPage(data: UsersPageData): string {
  const { t } = data;
  const rows = data.users
    .map((user) => {
      const expired = !!user.expiresAt && user.expiresAt <= Date.now();
      const status = !user.enabled
        ? pill(t("common.disabled"), "bad")
        : expired
          ? pill(t("common.expired"), "warn")
          : pill(t("common.normal"), "ok");
      return `<tr>
        <td><strong>${escapeHtml(user.email)}</strong><div class="small muted mono hide-xs">${escapeHtml(user.id)}</div></td>
        <td>${status}</td>
        <td class="small">${user.expiresAt ? fmtTime(user.expiresAt) : escapeHtml(t("common.forever"))}</td>
        <td class="small hide-xs">${escapeHtml(t("common.items", { n: user.credentialIds.length }))}</td>
        <td class="small hide-xs">${user.dailyQuota ? escapeHtml(t("common.perDay", { n: user.dailyQuota })) : escapeHtml(t("common.unlimited"))}</td>
        <td class="small">${data.keyCounts[user.id] ?? 0}</td>
        <td class="small muted hide-xs">${user.lastLoginAt ? fmtTime(user.lastLoginAt) : escapeHtml(t("common.never"))}</td>
        <td><div class="row">
          <a class="btn btn--sm" href="/admin/users/${escapeHtml(user.id)}">${escapeHtml(t("common.edit"))}</a>
          <form class="inline" method="post" action="/admin/users/${escapeHtml(user.id)}/toggle">
            <input type="hidden" name="csrf" value="${escapeHtml(data.csrf)}">
            <input type="hidden" name="enabled" value="${user.enabled ? "0" : "1"}">
            <button class="btn btn--sm btn--ghost" type="submit">${escapeHtml(
              user.enabled ? t("common.disable") : t("common.enable"),
            )}</button>
          </form>
        </div></td>
      </tr>`;
    })
    .join("");

  const dialog = formModal({
    id: "dlg-user-new",
    title: t("users.new"),
    hint: t("users.hint"),
    action: "/admin/users",
    csrf: data.csrf,
    submit: t("users.create"),
    cancel: t("common.cancel"),
    body: `<div class="form-grid">
      <label class="field wide">${escapeHtml(t("users.email"))}
        <input type="email" name="email" autocomplete="off" placeholder="user@example.com" required>
      </label>
      <label class="field">${escapeHtml(t("users.password"))}
        <input type="password" name="password" autocomplete="new-password" required>
      </label>
      <label class="field">${escapeHtml(t("users.expiresField"))}
        <input type="datetime-local" name="expiresAt">
      </label>
      <label class="field">${escapeHtml(t("users.quotaField"))}
        <input type="number" name="dailyQuota" min="0" value="0">
      </label>
      <div class="field wide">${escapeHtml(t("users.assign"))}
        <div class="checks">${credentialChecks(data.credentials, [], t) || `<span class="small muted">${escapeHtml(
          t("users.noCredits"),
        )}</span>`}</div>
      </div>
    </div>`,
  });

  return page(
    "/admin/users",
    t("users.title"),
    t("users.subtitle"),
    data,
    `<div class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:6px">
        <h2 style="margin:0">${escapeHtml(t("users.list"))}</h2>
        <button class="btn btn--primary btn--sm" type="button" data-open="dlg-user-new">＋ ${escapeHtml(
          t("users.new"),
        )}</button>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>${escapeHtml(t("users.user"))}</th><th>${escapeHtml(t("common.status"))}</th><th>${escapeHtml(
            t("users.expires"),
          )}</th><th class="hide-xs">${escapeHtml(t("users.certs"))}</th><th class="hide-xs">${escapeHtml(t("users.quota"))}</th><th>${escapeHtml(
            t("users.keys"),
          )}</th><th class="hide-xs">${escapeHtml(t("users.lastLogin"))}</th><th></th></tr></thead>
          <tbody>${rows || emptyRow(8, t("users.empty"))}</tbody>
        </table>
      </div>
    </div>
    ${dialog}`,
  );
}

export interface UserDetailData extends AdminNavData {
  user: UserRecord;
  credentials: CredentialRecord[];
  keys: ApiKeyRecord[];
  stats: { total: StatsBucket };
  revealedKey?: string;
}

export function adminUserPage(data: UserDetailData): string {
  const { t, user } = data;
  const expired = !!user.expiresAt && user.expiresAt <= Date.now();

  const keyRows = data.keys
    .map(
      (key) => `<tr>
        <td><strong>${escapeHtml(key.name)}</strong><div class="small muted mono">${escapeHtml(key.prefix)}…</div></td>
        <td>${key.enabled ? pill(t("common.enabled"), "ok") : pill(t("common.disabled"), "bad")}</td>
        <td class="small">${key.dailyQuota ? escapeHtml(t("common.perDay", { n: key.dailyQuota })) : escapeHtml(t("common.unlimited"))}</td>
        <td class="small">${key.totalSigns}</td>
        <td class="small muted">${key.lastUsedAt ? fmtTime(key.lastUsedAt) : escapeHtml(t("common.never"))}</td>
        <td><div class="row">
          <button class="btn btn--sm" type="button" data-open="keyedit-${escapeHtml(key.id)}">${escapeHtml(
            t("keys.edit"),
          )}</button>
          <form class="inline" method="post" action="/admin/keys/${escapeHtml(key.id)}/toggle">
            <input type="hidden" name="csrf" value="${escapeHtml(data.csrf)}">
            <input type="hidden" name="enabled" value="${key.enabled ? "0" : "1"}">
            <button class="btn btn--sm btn--ghost" type="submit">${escapeHtml(
              key.enabled ? t("common.disable") : t("common.enable"),
            )}</button>
          </form>
          <form class="inline" method="post" action="/admin/keys/${escapeHtml(key.id)}/delete"
            onsubmit="return confirm('${escapeHtml(t("confirm.deleteKey"))}')">
            <input type="hidden" name="csrf" value="${escapeHtml(data.csrf)}">
            <button class="btn btn--sm btn--danger" type="submit">${escapeHtml(t("common.delete"))}</button>
          </form>
        </div></td>
      </tr>`,
    )
    .join("");

  const assigned = data.credentials.filter((cred) => user.credentialIds.includes(cred.id));
  const credentialOptions = assigned
    .map((cred) => `<option value="${escapeHtml(cred.id)}">${escapeHtml(cred.label)} · ${escapeHtml(cred.email)}</option>`)
    .join("");

  const editDialog = formModal({
    id: "dlg-user-edit",
    title: t("users.editUser"),
    action: `/admin/users/${user.id}/update`,
    csrf: data.csrf,
    submit: t("common.save"),
    cancel: t("common.cancel"),
    body: `<div class="form-grid">
      <label class="field wide">${escapeHtml(t("users.email"))}
        <input type="email" name="email" autocomplete="off" value="${escapeHtml(user.email)}" required>
      </label>
      <label class="field wide">${escapeHtml(t("users.expiresField"))}
        <input type="datetime-local" name="expiresAt" value="${fmtDateInput(user.expiresAt)}">
      </label>
      <label class="field wide">${escapeHtml(t("users.quotaField"))}
        <input type="number" name="dailyQuota" min="0" value="${user.dailyQuota}">
      </label>
      <label class="field wide">${escapeHtml(t("users.resetPassword"))}
        <input type="password" name="password" autocomplete="new-password" placeholder="${escapeHtml(
          t("users.resetHint"),
        )}">
      </label>
      <div class="field wide">${escapeHtml(t("users.assign"))}
        <div class="checks">${credentialChecks(data.credentials, user.credentialIds, t) || `<span class="small muted">${escapeHtml(
          t("cred.empty"),
        )}</span>`}</div>
      </div>
    </div>`,
  });

  const keyDialog = formModal({
    id: "dlg-key-new",
    title: t("users.createFor"),
    action: "/admin/keys",
    csrf: data.csrf,
    submit: t("keys.create"),
    cancel: t("common.cancel"),
    body: `<input type="hidden" name="userId" value="${escapeHtml(user.id)}">
      <div class="form-grid">
        <label class="field">${escapeHtml(t("users.keyName"))}<input type="text" name="name" placeholder="CI" required></label>
        <label class="field">${escapeHtml(t("keys.quota"))}<input type="number" name="dailyQuota" min="0" value="0"></label>
        <label class="field wide">${escapeHtml(t("keys.cert"))}
          <select name="credentialId" required>${
            credentialOptions || `<option value="">${escapeHtml(t("users.noCredits"))}</option>`
          }</select>
        </label>
      </div>`,
  });

  const keyEditDialogs = data.keys
    .map((key) => {
      const certOptions = assigned
        .map(
          (cred) =>
            `<option value="${escapeHtml(cred.id)}"${cred.id === key.credentialId ? " selected" : ""}>${escapeHtml(
              cred.label,
            )} · ${escapeHtml(cred.email)}</option>`,
        )
        .join("");
      return formModal({
        id: `keyedit-${key.id}`,
        title: t("keys.editTitle"),
        hint: t("keys.editHint"),
        action: `/admin/keys/${key.id}/update`,
        csrf: data.csrf,
        submit: t("common.save"),
        cancel: t("common.cancel"),
        body: `<input type="hidden" name="backTo" value="/admin/users/${escapeHtml(user.id)}">
          <input type="hidden" name="userId" value="${escapeHtml(user.id)}">
          <div class="form-grid">
            <label class="field wide">${escapeHtml(t("keys.prefix"))}
              <input type="text" value="${escapeHtml(key.prefix)}…" readonly>
            </label>
            <label class="field">${escapeHtml(t("keys.name"))}
              <input type="text" name="name" value="${escapeHtml(key.name)}" maxlength="64" required>
            </label>
            <label class="field">${escapeHtml(t("keys.quota"))}
              <input type="number" name="dailyQuota" min="0" value="${key.dailyQuota}">
            </label>
            <label class="field wide">${escapeHtml(t("keys.cert"))}
              <select name="credentialId" required>${
                certOptions || `<option value="">${escapeHtml(t("users.noCredits"))}</option>`
              }</select>
            </label>
          </div>`,
      });
    })
    .join("");

  return page(
    "/admin/users",
    t("users.detailTitle", { name: user.email }),
    t("users.detailSubtitle"),
    data,
    `${data.revealedKey ? revealBanner(data.revealedKey, t) : ""}
    <div class="grid cols-2">
      <div class="card">
        <div class="row" style="justify-content:space-between;margin-bottom:10px">
          <h2 style="margin:0">${escapeHtml(t("users.basic"))}</h2>
          <button class="btn btn--sm" type="button" data-open="dlg-user-edit">${escapeHtml(t("users.editUser"))}</button>
        </div>
        <dl class="dl">
          <dt>${escapeHtml(t("users.userId"))}</dt><dd class="mono">${escapeHtml(user.id)}</dd>
          <dt>${escapeHtml(t("users.email"))}</dt><dd>${escapeHtml(user.email)} ${
            user.emailVerified ? pill(t("users.emailVerified"), "ok") : pill(t("users.emailUnverified"), "warn")
          }</dd>
          <dt>${escapeHtml(t("users.quota"))}</dt><dd>${
            user.dailyQuota ? escapeHtml(t("common.perDay", { n: user.dailyQuota })) : escapeHtml(t("common.unlimited"))
          }</dd>
          <dt>${escapeHtml(t("common.status"))}</dt><dd>${
            !user.enabled
              ? pill(t("common.disabled"), "bad")
              : expired
                ? pill(t("common.expired"), "warn")
                : pill(t("common.normal"), "ok")
          }</dd>
          <dt>${escapeHtml(t("users.expires"))}</dt><dd>${
            user.expiresAt ? fmtTime(user.expiresAt) : escapeHtml(t("common.forever"))
          }</dd>
          <dt>${escapeHtml(t("users.createdAt"))}</dt><dd>${fmtTime(user.createdAt)}</dd>
          <dt>${escapeHtml(t("users.lastLogin"))}</dt><dd>${
            user.lastLoginAt ? fmtTime(user.lastLoginAt) : escapeHtml(t("common.never"))
          }</dd>
          <dt>${escapeHtml(t("users.totalCalls"))}</dt><dd>${escapeHtml(t("common.count", { n: data.stats.total.requests }))}</dd>
          <dt>${escapeHtml(t("users.certs"))}</dt><dd>${
            assigned.length
              ? assigned.map((cred) => escapeHtml(cred.label)).join("、")
              : `<span class="muted">${escapeHtml(t("users.noCredits"))}</span>`
          }</dd>
        </dl>
        <div class="row" style="margin-top:16px">
          <form class="inline" method="post" action="/admin/users/${escapeHtml(user.id)}/toggle">
            <input type="hidden" name="csrf" value="${escapeHtml(data.csrf)}">
            <input type="hidden" name="enabled" value="${user.enabled ? "0" : "1"}">
            <button class="btn btn--sm" type="submit">${escapeHtml(
              user.enabled ? t("users.toggleOff") : t("users.toggleOn"),
            )}</button>
          </form>
          <form class="inline" method="post" action="/admin/users/${escapeHtml(user.id)}/delete"
            onsubmit="return confirm('${escapeHtml(t("confirm.deleteUser"))}')">
            <input type="hidden" name="csrf" value="${escapeHtml(data.csrf)}">
            <button class="btn btn--sm btn--danger" type="submit">${escapeHtml(t("users.deleteUser"))}</button>
          </form>
        </div>
      </div>

      <div class="card">
        <div class="row" style="justify-content:space-between;margin-bottom:10px">
          <h2 style="margin:0">${escapeHtml(t("users.theirKeys"))}</h2>
          <button class="btn btn--primary btn--sm" type="button" data-open="dlg-key-new">＋ ${escapeHtml(
            t("users.createFor"),
          )}</button>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>${escapeHtml(t("keys.name"))}</th><th>${escapeHtml(t("common.status"))}</th><th>${escapeHtml(
              t("users.quota"),
            )}</th><th>${escapeHtml(t("users.total"))}</th><th>${escapeHtml(t("users.lastUsed"))}</th><th></th></tr></thead>
            <tbody>${keyRows || emptyRow(6, t("users.noKeys"))}</tbody>
          </table>
        </div>
      </div>
    </div>
    ${editDialog}${keyDialog}${keyEditDialogs}`,
  );
}

/* -------------------------------- 凭据 ---------------------------------- */

export interface CredentialsPageData extends AdminNavData {
  credentials: CredentialRecord[];
  statuses: Record<string, CredentialStatus>;
}

export function adminCredentialsPage(data: CredentialsPageData): string {
  const { t } = data;

  const rows = data.credentials
    .map((cred) => {
      const status = data.statuses[cred.id] ?? {};
      const scanMode = cred.scanMode ?? "off";
      const scanText =
        scanMode === "off"
          ? t("cred.scanOff")
          : `${t(scanMode === "auto" ? "cred.scanAuto" : "cred.scanManual")} · ${t("cred.scanMaxRiskShort", {
              n: cred.scanMaxRisk ?? 0,
            })}`;
      return `<tr>
        <td><strong>${escapeHtml(cred.label)}</strong><div class="small muted">${escapeHtml(cred.email)}</div>
          <div class="small">${scanMode === "off" ? `<span class="muted">${escapeHtml(scanText)}</span>` : pill(scanText, "muted")}</div>
          ${cred.lastError ? `<div class="small" style="color:var(--bad)">${escapeHtml(cred.lastError.slice(0, 90))}</div>` : ""}</td>
        <td class="small mono hide-xs">${
          cred.certificateSha1 ? escapeHtml(cred.certificateSha1) : `<span class="muted">${escapeHtml(t("cred.firstCard"))}</span>`
        }</td>
        <td>${cred.enabled ? pill(t("common.enabled"), "ok") : pill(t("common.disabled"), "bad")}</td>
        <td class="small">${
          status.sessionExpiresAt ? fmtTime(status.sessionExpiresAt) : `<span class="muted">${escapeHtml(t("cred.notLoggedIn"))}</span>`
        }</td>
        <td class="small mono hide-xs">${status.cardSerial ? escapeHtml(status.cardSerial) : "—"}</td>
        <td><div class="row">
          <button class="btn btn--sm" type="button" data-open="dlg-cred-${escapeHtml(cred.id)}">${escapeHtml(
            t("common.edit"),
          )}</button>
          <form class="inline" method="post" action="/admin/credentials/${escapeHtml(cred.id)}/login">
            <input type="hidden" name="csrf" value="${escapeHtml(data.csrf)}">
            <button class="btn btn--sm btn--ghost" type="submit">${escapeHtml(t("cred.testLogin"))}</button>
          </form>
          <form class="inline" method="post" action="/admin/credentials/${escapeHtml(cred.id)}/certificate">
            <input type="hidden" name="csrf" value="${escapeHtml(data.csrf)}">
            <button class="btn btn--sm btn--ghost" type="submit">${escapeHtml(t("cred.refreshCert"))}</button>
          </form>
          <form class="inline" method="post" action="/admin/credentials/${escapeHtml(cred.id)}/toggle">
            <input type="hidden" name="csrf" value="${escapeHtml(data.csrf)}">
            <input type="hidden" name="enabled" value="${cred.enabled ? "0" : "1"}">
            <button class="btn btn--sm btn--ghost" type="submit">${escapeHtml(
              cred.enabled ? t("common.disable") : t("common.enable"),
            )}</button>
          </form>
          <form class="inline" method="post" action="/admin/credentials/${escapeHtml(cred.id)}/delete"
            onsubmit="return confirm('${escapeHtml(t("confirm.deleteCredential"))}')">
            <input type="hidden" name="csrf" value="${escapeHtml(data.csrf)}">
            <button class="btn btn--sm btn--danger" type="submit">${escapeHtml(t("common.delete"))}</button>
          </form>
        </div></td>
      </tr>`;
    })
    .join("");

  const createDialog = formModal({
    id: "dlg-cred-new",
    title: t("cred.new"),
    hint: t("cred.otpHint"),
    action: "/admin/credentials",
    csrf: data.csrf,
    submit: t("common.save"),
    cancel: t("common.cancel"),
    wide: true,
    body: `<div class="form-grid">
      <label class="field">${escapeHtml(t("cred.labelField"))}<input type="text" name="label" placeholder="prod"></label>
      <label class="field">${escapeHtml(t("cred.email"))}<input type="text" name="email" placeholder="you@example.com" required></label>
      <label class="field wide">${escapeHtml(t("cred.otp"))}
        <textarea name="otp" placeholder="otpauth://totp/Certum:you@example.com?secret=…&algorithm=SHA256" required></textarea>
      </label>
      <label class="field wide">${escapeHtml(t("cred.sha1Field"))}
        <input type="text" name="certificateSha1" placeholder="${escapeHtml(t("cred.sha1Hint"))}">
      </label>
      <label class="field">${escapeHtml(t("cred.scanMode"))}
        <select name="scanMode">
          <option value="off">${escapeHtml(t("cred.scanOff"))}</option>
          <option value="manual">${escapeHtml(t("cred.scanManual"))}</option>
          <option value="auto">${escapeHtml(t("cred.scanAuto"))}</option>
        </select>
        <span class="small muted">${escapeHtml(t("cred.scanModeHint"))}</span>
      </label>
      <label class="field">${escapeHtml(t("cred.scanMaxRisk"))}
        <input type="number" name="scanMaxRisk" min="0" max="100" step="1" value="0">
        <span class="small muted">${escapeHtml(t("cred.scanMaxRiskHint"))}</span>
      </label>
    </div>`,
  });

  const editDialogs = data.credentials
    .map((cred) =>
      formModal({
        id: `dlg-cred-${cred.id}`,
        title: t("cred.editTitle", { name: cred.label }),
        hint: t("cred.otpKeep"),
        action: `/admin/credentials/${cred.id}/update`,
        csrf: data.csrf,
        submit: t("common.save"),
        cancel: t("common.cancel"),
        wide: true,
        body: `<div class="form-grid">
          <label class="field">${escapeHtml(t("cred.labelField"))}
            <input type="text" name="label" value="${escapeHtml(cred.label)}">
          </label>
          <label class="field">${escapeHtml(t("cred.email"))}
            <input type="text" name="email" value="${escapeHtml(cred.email)}" required>
          </label>
          <label class="field wide">${escapeHtml(t("cred.otp"))}
            <textarea name="otp" placeholder="${escapeHtml(t("cred.otpKeep"))}"></textarea>
          </label>
          <label class="field wide">${escapeHtml(t("cred.sha1Field"))}
            <input type="text" name="certificateSha1" value="${escapeHtml(cred.certificateSha1 ?? "")}" placeholder="${escapeHtml(
              t("cred.sha1Hint"),
            )}">
          </label>
          <label class="field">${escapeHtml(t("cred.scanMode"))}
            <select name="scanMode">
              <option value="off" ${(cred.scanMode ?? "off") === "off" ? "selected" : ""}>${escapeHtml(
                t("cred.scanOff"),
              )}</option>
              <option value="manual" ${cred.scanMode === "manual" ? "selected" : ""}>${escapeHtml(
                t("cred.scanManual"),
              )}</option>
              <option value="auto" ${cred.scanMode === "auto" ? "selected" : ""}>${escapeHtml(
                t("cred.scanAuto"),
              )}</option>
            </select>
            <span class="small muted">${escapeHtml(t("cred.scanModeHint"))}</span>
          </label>
          <label class="field">${escapeHtml(t("cred.scanMaxRisk"))}
            <input type="number" name="scanMaxRisk" min="0" max="100" step="1"
              value="${cred.scanMaxRisk ?? 0}">
            <span class="small muted">${escapeHtml(t("cred.scanMaxRiskHint"))}</span>
          </label>
        </div>`,
      }),
    )
    .join("");

  return page(
    "/admin/credentials",
    t("cred.title"),
    t("cred.subtitle"),
    data,
    `<div class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:6px">
        <h2 style="margin:0">${escapeHtml(t("cred.list"))}</h2>
        <div class="row">
          <button class="btn btn--primary btn--sm" type="button" data-open="dlg-cred-new">＋ ${escapeHtml(
            t("cred.new"),
          )}</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>${escapeHtml(t("cred.label"))}</th><th class="hide-xs">${escapeHtml(t("cred.certSha1"))}</th><th>${escapeHtml(
            t("common.status"),
          )}</th><th>${escapeHtml(t("cred.session"))}</th><th class="hide-xs">${escapeHtml(t("cred.card"))}</th><th></th></tr></thead>
          <tbody>${rows || emptyRow(6, t("cred.empty"))}</tbody>
        </table>
      </div>
    </div>
    ${createDialog}${editDialogs}`,
  );
}

/* -------------------------------- 密钥 ---------------------------------- */

export interface KeysPageData extends AdminNavData {
  keys: ApiKeyRecord[];
  users: UserRecord[];
  credentials: CredentialRecord[];
  revealedKey?: string;
}

export function adminKeysPage(data: KeysPageData): string {
  const { t } = data;
  const userName = new Map(data.users.map((user) => [user.id, user.email]));
  const credName = new Map(data.credentials.map((cred) => [cred.id, cred.label]));

  const rows = data.keys
    .map(
      (key) => `<tr>
        <td><strong>${escapeHtml(key.name)}</strong><div class="small muted mono">${escapeHtml(key.prefix)}…</div></td>
        <td class="small">${
          key.userId
            ? escapeHtml(userName.get(key.userId) ?? t("keys.deletedUser"))
            : `<span class="muted">${escapeHtml(t("keys.platformKey"))}</span>`
        }</td>
        <td class="small hide-xs">${escapeHtml(
          key.credentialId ? credName.get(key.credentialId) ?? t("keys.deletedCred") : t("keys.defaultCred"),
        )}</td>
        <td>${key.enabled ? pill(t("common.enabled"), "ok") : pill(t("common.disabled"), "bad")}</td>
        <td class="small">${key.dailyQuota ? escapeHtml(t("common.perDay", { n: key.dailyQuota })) : escapeHtml(t("common.unlimited"))}</td>
        <td class="small hide-xs">${key.totalSigns}</td>
        <td class="small muted hide-xs">${key.lastUsedAt ? fmtTime(key.lastUsedAt) : escapeHtml(t("common.never"))}</td>
        <td><div class="row">
          <button class="btn btn--sm" type="button" data-open="keyedit-${escapeHtml(key.id)}">${escapeHtml(
            t("keys.edit"),
          )}</button>
          <form class="inline" method="post" action="/admin/keys/${escapeHtml(key.id)}/toggle">
            <input type="hidden" name="csrf" value="${escapeHtml(data.csrf)}">
            <input type="hidden" name="enabled" value="${key.enabled ? "0" : "1"}">
            <button class="btn btn--sm btn--ghost" type="submit">${escapeHtml(
              key.enabled ? t("common.disable") : t("common.enable"),
            )}</button>
          </form>
          <form class="inline" method="post" action="/admin/keys/${escapeHtml(key.id)}/delete"
            onsubmit="return confirm('${escapeHtml(t("confirm.deleteKey"))}')">
            <input type="hidden" name="csrf" value="${escapeHtml(data.csrf)}">
            <button class="btn btn--sm btn--danger" type="submit">${escapeHtml(t("common.delete"))}</button>
          </form>
        </div></td>
      </tr>`,
    )
    .join("");

  const userOptions = data.users
    .map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.email)}</option>`)
    .join("");
  const credOptions = data.credentials
    .map((cred) => `<option value="${escapeHtml(cred.id)}">${escapeHtml(cred.label)}（${escapeHtml(cred.email)}）</option>`)
    .join("");

  const dialog = formModal({
    id: "dlg-key-new",
    title: t("keys.new"),
    action: "/admin/keys",
    csrf: data.csrf,
    submit: t("keys.create"),
    cancel: t("common.cancel"),
    body: `<div class="form-grid">
      <label class="field">${escapeHtml(t("keys.name"))}<input type="text" name="name" placeholder="release" required></label>
      <label class="field">${escapeHtml(t("keys.quota"))}<input type="number" name="dailyQuota" min="0" value="0"></label>
      <label class="field">${escapeHtml(t("keys.ownerField"))}
        <select name="userId"><option value="">${escapeHtml(t("keys.platformKey"))}</option>${userOptions}</select>
      </label>
      <label class="field">${escapeHtml(t("keys.cert"))}
        <select name="credentialId" required>${
          credOptions || `<option value="">${escapeHtml(t("keys.noCred"))}</option>`
        }</select>
      </label>
    </div>`,
  });

  const editDialogs = data.keys
    .map((key) => {
      const ownerOptions = [`<option value="">${escapeHtml(t("keys.platformKey"))}</option>`]
        .concat(
          data.users.map(
            (user) =>
              `<option value="${escapeHtml(user.id)}"${user.id === key.userId ? " selected" : ""}>${escapeHtml(
                user.email,
              )}</option>`,
          ),
        )
        .join("");
      const certOptions = data.credentials
        .map(
          (cred) =>
            `<option value="${escapeHtml(cred.id)}"${cred.id === key.credentialId ? " selected" : ""}>${escapeHtml(
              cred.label,
            )}（${escapeHtml(cred.email)}）</option>`,
        )
        .join("");
      return formModal({
        id: `keyedit-${key.id}`,
        title: t("keys.editTitle"),
        hint: t("keys.editHint"),
        action: `/admin/keys/${key.id}/update`,
        csrf: data.csrf,
        submit: t("common.save"),
        cancel: t("common.cancel"),
        body: `<div class="form-grid">
          <label class="field wide">${escapeHtml(t("keys.prefix"))}
            <input type="text" value="${escapeHtml(key.prefix)}…" readonly>
          </label>
          <label class="field">${escapeHtml(t("keys.name"))}
            <input type="text" name="name" value="${escapeHtml(key.name)}" maxlength="64" required>
          </label>
          <label class="field">${escapeHtml(t("keys.quota"))}
            <input type="number" name="dailyQuota" min="0" value="${key.dailyQuota}">
          </label>
          <label class="field">${escapeHtml(t("keys.ownerField"))}
            <select name="userId">${ownerOptions}</select>
          </label>
          <label class="field">${escapeHtml(t("keys.cert"))}
            <select name="credentialId" required>${
              certOptions || `<option value="">${escapeHtml(t("keys.noCred"))}</option>`
            }</select>
          </label>
        </div>`,
      });
    })
    .join("");

  return page(
    "/admin/keys",
    t("keys.title"),
    t("keys.subtitle"),
    data,
    `${data.revealedKey ? revealBanner(data.revealedKey, t) : ""}
    <div class="card">
      <div class="row" style="justify-content:space-between;margin-bottom:6px">
        <h2 style="margin:0">${escapeHtml(t("keys.all"))}</h2>
        <button class="btn btn--primary btn--sm" type="button" data-open="dlg-key-new">＋ ${escapeHtml(
          t("keys.new"),
        )}</button>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>${escapeHtml(t("keys.name"))}</th><th>${escapeHtml(t("keys.owner"))}</th><th class="hide-xs">${escapeHtml(
            t("keys.cert"),
          )}</th><th>${escapeHtml(t("common.status"))}</th><th>${escapeHtml(t("users.quota"))}</th><th class="hide-xs">${escapeHtml(
            t("users.total"),
          )}</th><th class="hide-xs">${escapeHtml(t("users.lastUsed"))}</th><th></th></tr></thead>
          <tbody>${rows || emptyRow(8, t("keys.empty"))}</tbody>
        </table>
      </div>
    </div>
    ${dialog}${editDialogs}`,
  );
}

/* ------------------------------ 签名记录 -------------------------------- */

export interface LogsPageData extends AdminNavData {
  logs: SignLogRecord[];
  userName: Map<string, string>;
  credName: Map<string, string>;
}

/** 弹窗 id 只能含字母数字 */
function logDialogId(log: SignLogRecord): string {
  return `log-${log.id.replace(/[^A-Za-z0-9]/g, "")}`;
}

function logDetailDialog(log: SignLogRecord, data: { t: Translate; userName: Map<string, string>; credName: Map<string, string> }): string {
  const { t } = data;
  const rows: Array<[string, string]> = [
    [t("logs.requestId"), `<span class="mono">${escapeHtml(log.id)}</span>`],
    [t("logs.time"), escapeHtml(fmtTime(log.at))],
    [t("logs.key"), `${escapeHtml(log.keyName)} <span class="mono muted">${escapeHtml(log.keyId)}</span>`],
    [
      t("logs.user"),
      log.userId
        ? `${escapeHtml(data.userName.get(log.userId) ?? t("keys.deletedUser"))} <span class="mono muted">${escapeHtml(
            log.userId,
          )}</span>`
        : escapeHtml(t("common.platform")),
    ],
    [
      t("logs.credential"),
      escapeHtml(log.credentialId ? data.credName.get(log.credentialId) ?? t("keys.deletedCred") : "—"),
    ],
    ...(log.scanSha256
      ? ([
          [t("logs.scan"), `${log.scanRisk ?? 0} · ${log.scanProvider ?? ""}`],
          [t("logs.scanSha"), `<span class="mono">${escapeHtml(log.scanSha256)}</span>`],
        ] as Array<[string, string]>)
      : []),
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

export function adminLogsPage(data: LogsPageData): string {
  const { t } = data;
  const rows = data.logs
    .map((log) => {
      const id = logDialogId(log);
      return `<tr>
        <td class="small">${fmtTime(log.at)}</td>
        <td class="small">${escapeHtml(log.keyName)}</td>
        <td class="small">${
          log.userId ? escapeHtml(data.userName.get(log.userId) ?? t("keys.deletedUser")) : escapeHtml(t("common.platform"))
        }</td>
        <td class="small hide-xs">${log.algorithm.toUpperCase()} × ${log.count}</td>
        <td class="small mono hide-xs">${escapeHtml(log.digestPrefix)}…</td>
        <td>${log.ok ? pill(t("common.success"), "ok") : pill(t("common.failure"), "bad")}</td>
        <td class="small muted hide-xs">${log.durationMs} ms</td>
        <td class="small muted mono hide-xs">${escapeHtml(log.ip)}</td>
        <td><div class="row"><button class="btn btn--sm btn--ghost" type="button" data-open="${id}">${escapeHtml(
          t("common.detail"),
        )}</button></div></td>
      </tr>`;
    })
    .join("");

  return page(
    "/admin/logs",
    t("logs.title"),
    t("logs.subtitle"),
    data,
    `<div class="card">
      <p class="hint" style="margin:0 0 12px">${escapeHtml(t("overview.recentHint"))}</p>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>${escapeHtml(t("logs.time"))}</th><th>Key</th><th>${escapeHtml(t("logs.user"))}</th><th class="hide-xs">${escapeHtml(t("logs.algorithm"))}</th><th class="hide-xs">${escapeHtml(t("logs.digest"))}</th><th>${escapeHtml(t("logs.result"))}</th><th class="hide-xs">${escapeHtml(t("logs.duration"))}</th><th class="hide-xs">${escapeHtml(t("logs.ip"))}</th><th></th></tr></thead>
          <tbody>${rows || emptyRow(9, t("logs.empty"))}</tbody>
        </table>
      </div>
    </div>
    ${data.logs.map((log) => logDetailDialog(log, data)).join("")}`,
  );
}

/* -------------------------------- 系统设置 -------------------------------- */

export interface SettingsPageData extends AdminNavData {
  settings: SystemSettings;
  config: RuntimeConfig;
  /** 只暴露「有没有填过」，密钥本身不回传 */
  hasResendApiKey: boolean;
  hasTurnstileSecret: boolean;
  hasScanApiKey: boolean;
  mailReady: boolean;
  adminUsername?: string;
}

function toggle(name: string, label: string, hint: string, checked: boolean): string {
  return `<div class="field" style="margin-bottom:14px">
    <div class="checks">
      <label><input type="checkbox" name="${name}" value="1" ${checked ? "checked" : ""}> ${escapeHtml(label)}</label>
    </div>
    <p class="small muted" style="margin:0">${escapeHtml(hint)}</p>
  </div>`;
}

export function adminSettingsPage(data: SettingsPageData): string {
  const { t, settings } = data;

  return page(
    "/admin/settings",
    t("settings.title"),
    t("settings.subtitle"),
    data,
    `<form method="post" action="/admin/settings">
      <input type="hidden" name="csrf" value="${escapeHtml(data.csrf)}">
      <div class="grid cols-2" style="margin-bottom:16px">
        <div class="card">
          <h2>${escapeHtml(t("settings.accounts"))}</h2>
          ${toggle("loginCaptcha", t("settings.loginCaptcha"), t("settings.loginCaptchaHint"), settings.captchaMode !== "off")}
          <div class="field" style="margin-bottom:14px">
            <span>${escapeHtml(t("settings.captchaType"))}</span>
            <div class="checks">
              <label><input type="radio" name="captchaProvider" value="svg" ${
                settings.captchaMode === "turnstile" ? "" : "checked"
              }> ${escapeHtml(t("settings.captchaSvg"))}</label>
              <label><input type="radio" name="captchaProvider" value="turnstile" ${
                settings.captchaMode === "turnstile" ? "checked" : ""
              }> ${escapeHtml(t("settings.captchaTurnstile"))}</label>
            </div>
            <span class="small muted">${escapeHtml(t("settings.captchaTypeHint"))}</span>
          </div>
          <div class="form-grid" style="margin-bottom:14px">
            <label class="field">${escapeHtml(t("settings.turnstileSiteKey"))}
              <input type="text" name="turnstileSiteKey" value="${escapeHtml(data.config.turnstileSiteKey)}"
                placeholder="0x4AAAAAAA…" spellcheck="false">
              <span class="small muted">${escapeHtml(t("settings.turnstileSiteKeyHint"))}</span>
            </label>
            <label class="field">${escapeHtml(t("settings.turnstileSecretKey"))}
              <input type="password" name="turnstileSecretKey" autocomplete="new-password" spellcheck="false"
                placeholder="${escapeHtml(
                  data.hasTurnstileSecret ? t("settings.turnstileSecretKeySet") : "0x4AAAAAAA…",
                )}">
              <span class="small muted">${escapeHtml(t("settings.turnstileSecretKeyHint"))}</span>
            </label>
          </div>
          ${
            data.hasTurnstileSecret
              ? `<div class="checks" style="margin-bottom:12px">
                  <label><input type="checkbox" name="clearTurnstileSecret" value="1"> ${escapeHtml(
                    t("settings.clearTurnstileSecret"),
                  )}</label>
                </div>`
              : ""
          }
          ${toggle("registerEnabled", t("settings.register"), t("settings.registerHint"), settings.registerEnabled)}
          ${toggle("resetEnabled", t("settings.reset"), t("settings.resetHint"), settings.resetEnabled)}
        </div>
        <div class="card">
          <h2>${escapeHtml(t("settings.email"))} ${
            data.mailReady ? pill(t("settings.mailReady"), "ok") : pill(t("settings.mailOff"), "warn")
          }</h2>
          <p class="small muted" style="margin:0 0 12px">${escapeHtml(t("settings.emailHint"))}</p>
          <div class="form-grid">
            <label class="field">${escapeHtml(t("settings.publicBaseUrl"))}
              <input type="url" name="publicBaseUrl" value="${escapeHtml(data.config.publicBaseUrl)}"
                placeholder="https://certum.example.com">
              <span class="small muted">${escapeHtml(t("settings.publicBaseUrlHint"))}</span>
            </label>
            <label class="field">${escapeHtml(t("settings.resendFrom"))}
              <input type="text" name="resendFrom" value="${escapeHtml(data.config.resendFrom)}"
                placeholder="CertumSigner &lt;noreply@example.com&gt;">
              <span class="small muted">${escapeHtml(t("settings.resendFromHint"))}</span>
            </label>
            <label class="field wide">${escapeHtml(t("settings.resendApiKey"))}
              <input type="password" name="resendApiKey" autocomplete="new-password" spellcheck="false"
                placeholder="${escapeHtml(data.hasResendApiKey ? t("settings.resendApiKeySet") : "re_…")}">
              <span class="small muted">${escapeHtml(t("settings.resendApiKeyHint"))}</span>
            </label>
          </div>
          ${
            data.hasResendApiKey
              ? `<div class="checks" style="margin-top:10px">
                  <label><input type="checkbox" name="clearResendApiKey" value="1"> ${escapeHtml(
                    t("settings.clearResendApiKey"),
                  )}</label>
                </div>`
              : ""
          }
          <p class="small muted" style="margin:10px 0 0">${escapeHtml(
            data.mailReady ? t("settings.mailReadyHint") : t("settings.mailMissing"),
          )}</p>
          <div style="margin-top:14px">
            ${toggle("emailCaptcha", t("settings.emailCaptcha"), t("settings.emailCaptchaHint"), settings.emailCaptcha)}
          </div>
        </div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <h2>${escapeHtml(t("settings.services"))}</h2>
        <p class="small muted" style="margin:0 0 12px">${escapeHtml(t("settings.servicesHint"))}</p>
        <div class="form-grid">
          <label class="field">${escapeHtml(t("settings.certumApiBase"))}
            <input type="url" name="certumApiBase" value="${escapeHtml(data.config.certumApiBase)}"
              placeholder="https://cloudsign.webnotarius.pl">
            <span class="small muted">${escapeHtml(t("settings.certumApiBaseHint"))}</span>
          </label>
          <label class="field">${escapeHtml(t("settings.tsaUpstream"))}
            <input type="url" name="tsaUpstream" value="${escapeHtml(data.config.tsaUpstream)}"
              placeholder="http://time.certum.pl/">
            <span class="small muted">${escapeHtml(t("settings.tsaUpstreamHint"))}</span>
          </label>
          <label class="field wide">${escapeHtml(t("settings.chainPem"))}
            <textarea name="certumChainPem" rows="4" spellcheck="false"
              placeholder="-----BEGIN CERTIFICATE-----">${escapeHtml(data.config.certumChainPem)}</textarea>
            <span class="small muted">${escapeHtml(t("settings.chainPemHint"))}</span>
          </label>
        </div>
        <div class="checks" style="margin-top:6px">
          <label><input type="checkbox" name="logSignatures" value="1" ${
            data.config.logSignatures ? "checked" : ""
          }> ${escapeHtml(t("settings.logSignatures"))}</label>
        </div>
        <p class="small muted" style="margin:6px 0 0">${escapeHtml(t("settings.logSignaturesHint"))}</p>
        ${
          settings.updatedAt
            ? `<p class="small muted" style="margin:8px 0 0">${escapeHtml(t("settings.updatedAt"))}：${fmtTime(
                settings.updatedAt,
              )}</p>`
            : ""
        }
      </div>
      <div class="card" style="margin-bottom:16px">
        <h2>${escapeHtml(t("settings.scan"))} ${
          data.hasScanApiKey ? pill(t("settings.scanReady"), "ok") : pill(t("settings.scanOff"), "warn")
        }</h2>
        <p class="small muted" style="margin:0 0 12px">${escapeHtml(t("settings.scanHint"))}</p>
        <div class="form-grid">
          <label class="field">${escapeHtml(t("settings.scanProvider"))}
            <select name="scanProvider">
              <option value="virustotal" ${
                data.config.scanProvider === "metadefender" ? "" : "selected"
              }>VirusTotal</option>
              <option value="metadefender" ${
                data.config.scanProvider === "metadefender" ? "selected" : ""
              }>MetaDefender Cloud</option>
            </select>
            <span class="small muted">${escapeHtml(t("settings.scanProviderHint"))}</span>
          </label>
          <label class="field">${escapeHtml(t("settings.scanApiKey"))}
            <input type="password" name="scanApiKey" autocomplete="new-password" spellcheck="false"
              placeholder="${escapeHtml(data.hasScanApiKey ? t("settings.scanApiKeySet") : "vt_… / md_…")}">
            <span class="small muted">${escapeHtml(t("settings.scanApiKeyHint"))}</span>
          </label>
          <label class="field">${escapeHtml(t("settings.scanBaseUrl"))}
            <input type="url" name="scanBaseUrl" value="${escapeHtml(data.config.scanBaseUrl)}"
              placeholder="https://www.virustotal.com/api/v3">
            <span class="small muted">${escapeHtml(t("settings.scanBaseUrlHint"))}</span>
          </label>
          <label class="field">${escapeHtml(t("settings.scanMaxUploadMb"))}
            <input type="number" name="scanMaxUploadMb" min="1" max="650" step="1"
              value="${data.config.scanMaxUploadMb}">
            <span class="small muted">${escapeHtml(t("settings.scanMaxUploadMbHint"))}</span>
          </label>
          <label class="field">${escapeHtml(t("settings.scanCacheMinutes"))}
            <input type="number" name="scanCacheMinutes" min="1" max="10080" step="1"
              value="${data.config.scanCacheMinutes}">
            <span class="small muted">${escapeHtml(t("settings.scanCacheMinutesHint"))}</span>
          </label>
        </div>
        ${
          data.hasScanApiKey
            ? `<div class="checks" style="margin-top:10px">
                <label><input type="checkbox" name="clearScanApiKey" value="1"> ${escapeHtml(
                  t("settings.clearScanApiKey"),
                )}</label>
              </div>`
            : ""
        }
        <p class="small muted" style="margin:10px 0 0">${escapeHtml(t("settings.scanTerms"))}</p>
      </div>
      <div class="row row--end">
        <button class="btn btn--primary" type="submit">${escapeHtml(t("settings.save"))}</button>
      </div>
    </form>
    ${adminAccountCard(data)}`,
  );
}

/** 管理员账号卡片：显示当前用户名 + 改密码（改完会踢掉其他会话） */
function adminAccountCard(data: SettingsPageData): string {
  const { t } = data;
  return `<div class="card" style="margin-top:16px">
    <h2 style="margin:0 0 10px">${escapeHtml(t("settings.adminAccount"))}</h2>
    <p class="small muted" style="margin:0 0 12px">${escapeHtml(
      t("settings.adminUser", { name: data.adminUsername ?? "" }),
    )}</p>
    <form method="post" action="/admin/settings/password">
      <input type="hidden" name="csrf" value="${escapeHtml(data.csrf)}">
      <div class="grid cols-3">
        <label class="field">${escapeHtml(t("settings.currentPassword"))}
          <input type="password" name="current" autocomplete="current-password" required>
        </label>
        <label class="field">${escapeHtml(t("settings.newPassword"))}
          <input type="password" name="next" autocomplete="new-password" minlength="10" required>
        </label>
        <label class="field">${escapeHtml(t("settings.confirmPassword"))}
          <input type="password" name="confirm" autocomplete="new-password" minlength="10" required>
        </label>
      </div>
      <div class="row row--end" style="margin-top:14px">
        <button class="btn btn--primary" type="submit">${escapeHtml(t("settings.changePassword"))}</button>
      </div>
    </form>
  </div>`;
}
