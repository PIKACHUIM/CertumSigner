/** 服务端渲染的公共外壳：主题变量、明暗模式、多语言、弹窗组件（无前端构建） */
import type { Translate } from "./i18n";
import { MODES, THEMES, prefsHref, type Mode, type Prefs, type ThemeId } from "./prefs";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fmtTime(ms?: number | null): string {
  if (!ms) return "—";
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())} UTC`;
}

export function fmtDateInput(ms?: number | null): string {
  if (!ms) return "";
  return new Date(ms).toISOString().slice(0, 16);
}

export type Tone = "ok" | "warn" | "bad" | "muted" | "brand";

export function pill(text: string, tone: Tone = "muted"): string {
  return `<span class="pill pill--${tone}">${escapeHtml(text)}</span>`;
}

export interface NavItem {
  href: string;
  label: string;
  icon?: string;
}

export interface ShellOptions {
  title: string;
  nav: NavItem[];
  active: string;
  /** 当前路径（含查询串），用于主题/语言切换后跳回原处 */
  self?: string;
  brand?: string;
  subtitle?: string;
  userLabel?: string;
  csrf?: string;
  notice?: string;
  error?: string;
  prefs: Prefs;
  t: Translate;
  body: string;
}

/* --------------------------------- 变量 ---------------------------------- */

const LIGHT = `
  --bg: #f5f7fb;
  --bg-glow: radial-gradient(1100px 620px at 8% -12%, color-mix(in srgb, var(--brand) 14%, transparent), transparent 70%);
  --panel: #ffffff;
  --panel-2: #f8fafc;
  --line: #e3e8f2;
  --line-2: #eef2f8;
  --ink: #0e1626;
  --muted: #5c6b85;
  --muted-2: #8a97ad;
  --side-bg: #ffffff;
  --side-ink: #3c4a61;
  --side-line: #e8edf6;
  --side-active: var(--brand-soft);
  --side-active-ink: var(--brand);
  --shadow: 0 1px 2px rgba(15, 23, 42, .05), 0 10px 30px -18px rgba(15, 23, 42, .28);
  --shadow-lg: 0 24px 70px -30px rgba(15, 23, 42, .45);
  --ok: #067647; --ok-soft: #ecfdf3; --ok-line: #abefc6;
  --warn: #b54708; --warn-soft: #fffaeb; --warn-line: #fedf89;
  --bad: #b42318; --bad-soft: #fef3f2; --bad-line: #fecdca;
  --neutral-soft: #f2f4f7;
  --code-bg: #0b1220;
`;

const DARK = `
  --bg: #070b14;
  --bg-glow: radial-gradient(1100px 620px at 8% -12%, color-mix(in srgb, var(--brand) 22%, transparent), transparent 70%);
  --panel: #0e1524;
  --panel-2: #131c2e;
  --line: #1e2a40;
  --line-2: #182234;
  --ink: #e8eefb;
  --muted: #94a3bd;
  --muted-2: #6b7a95;
  --side-bg: #080d17;
  --side-ink: #a9b6cc;
  --side-line: #16203300;
  --side-active: rgba(255, 255, 255, .07);
  --side-active-ink: #ffffff;
  --shadow: 0 1px 0 rgba(255, 255, 255, .03), 0 22px 50px -30px rgba(0, 0, 0, .9);
  --shadow-lg: 0 30px 80px -30px rgba(0, 0, 0, .95);
  --ok: #4ade80; --ok-soft: rgba(34, 197, 94, .14); --ok-line: rgba(34, 197, 94, .3);
  --warn: #fbbf24; --warn-soft: rgba(245, 158, 11, .14); --warn-line: rgba(245, 158, 11, .3);
  --bad: #f87171; --bad-soft: rgba(239, 68, 68, .14); --bad-line: rgba(239, 68, 68, .3);
  --neutral-soft: rgba(148, 163, 184, .12);
  --code-bg: #060a12;
`;

interface Accent {
  light: string;
  dark: string;
}

const ACCENTS: Record<ThemeId, Accent> = {
  aurora: {
    light: `--brand: #4f46e5; --brand-strong: #4338ca; --brand-2: #0891b2; --brand-soft: #eef0ff;
            --brand-ink: #ffffff; --ring: rgba(79, 70, 229, .18); --grad: linear-gradient(135deg, #4f46e5, #06b6d4);`,
    dark: `--brand: #818cf8; --brand-strong: #a5b4fc; --brand-2: #22d3ee; --brand-soft: rgba(129, 140, 248, .16);
           --brand-ink: #0b1220; --ring: rgba(129, 140, 248, .22); --grad: linear-gradient(135deg, #6366f1, #22d3ee);`,
  },
  nebula: {
    light: `--brand: #9333ea; --brand-strong: #7e22ce; --brand-2: #db2777; --brand-soft: #f7edff;
            --brand-ink: #ffffff; --ring: rgba(147, 51, 234, .18); --grad: linear-gradient(135deg, #a855f7, #ec4899);`,
    dark: `--brand: #c084fc; --brand-strong: #d8b4fe; --brand-2: #f472b6; --brand-soft: rgba(192, 132, 252, .16);
           --brand-ink: #14061f; --ring: rgba(192, 132, 252, .22); --grad: linear-gradient(135deg, #a855f7, #f472b6);`,
  },
  jade: {
    light: `--brand: #059669; --brand-strong: #047857; --brand-2: #0284c7; --brand-soft: #e7f8f1;
            --brand-ink: #ffffff; --ring: rgba(5, 150, 105, .18); --grad: linear-gradient(135deg, #10b981, #0ea5e9);`,
    dark: `--brand: #34d399; --brand-strong: #6ee7b7; --brand-2: #38bdf8; --brand-soft: rgba(52, 211, 153, .16);
           --brand-ink: #04120c; --ring: rgba(52, 211, 153, .22); --grad: linear-gradient(135deg, #10b981, #38bdf8);`,
  },
  graphite: {
    light: `--brand: #475569; --brand-strong: #334155; --brand-2: #64748b; --brand-soft: #eef1f6;
            --brand-ink: #ffffff; --ring: rgba(71, 85, 105, .18); --grad: linear-gradient(135deg, #475569, #94a3b8);`,
    dark: `--brand: #cbd5e1; --brand-strong: #e2e8f0; --brand-2: #94a3b8; --brand-soft: rgba(203, 213, 225, .14);
           --brand-ink: #0b1220; --ring: rgba(203, 213, 225, .22); --grad: linear-gradient(135deg, #94a3b8, #cbd5e1);`,
  },
};

function accentCss(): string {
  return (Object.keys(ACCENTS) as ThemeId[])
    .map(
      (id) => `
html[data-theme="${id}"] { ${ACCENTS[id].light} }
html[data-mode="dark"][data-theme="${id}"] { ${ACCENTS[id].dark} }
@media (prefers-color-scheme: dark) {
  html[data-mode="auto"][data-theme="${id}"] { ${ACCENTS[id].dark} }
}`,
    )
    .join("");
}

const CSS = `
html { ${LIGHT} }html[data-mode="dark"] { ${DARK} }
@media (prefers-color-scheme: dark) { html[data-mode="auto"] { ${DARK} } }
${accentCss()}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  background-image: var(--bg-glow);
  background-repeat: no-repeat;
  background-attachment: fixed;
  color: var(--ink);
  font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
  transition: background-color .2s ease, color .2s ease;
}
a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }

.shell { display: grid; grid-template-columns: 244px minmax(0, 1fr); min-height: 100vh; }

/* ------------------------------- 侧边栏 -------------------------------- */
.side {
  background: var(--side-bg); color: var(--side-ink); padding: 20px 14px;
  display: flex; flex-direction: column; gap: 22px;
  position: sticky; top: 0; height: 100vh; border-right: 1px solid var(--side-line);
}
html[data-mode="dark"] .side { border-right-color: var(--line); }
.brand { display: flex; align-items: center; gap: 10px; color: var(--ink); padding: 2px 6px; }
.brand:hover { text-decoration: none; }
.brand .logo {
  width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; flex: none;
  background: var(--grad); color: #fff; font-weight: 800; font-size: 15px;
  box-shadow: 0 6px 16px -8px color-mix(in srgb, var(--brand) 70%, transparent);
}
.brand .name { font-weight: 700; letter-spacing: .2px; line-height: 1.2; }
.brand .tag { display: block; font-size: 11px; color: var(--muted-2); font-weight: 500; letter-spacing: .3px; }

.nav { display: flex; flex-direction: column; gap: 3px; }
.nav a {
  color: var(--side-ink); padding: 9px 11px; border-radius: 10px; font-weight: 550;
  display: flex; gap: 10px; align-items: center; font-size: 13.5px; position: relative; white-space: nowrap;
}
.nav a svg { width: 17px; height: 17px; flex: none; opacity: .85; }
.nav a:hover { background: var(--side-active); color: var(--ink); text-decoration: none; }
.nav a.on { background: var(--side-active); color: var(--side-active-ink); }
.nav a.on::before {
  content: ""; position: absolute; left: -14px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0;
  background: var(--brand);
}
.side-foot { margin-top: auto; display: grid; gap: 10px; font-size: 12px; color: var(--muted-2); }
.side-foot .who { color: var(--ink); font-weight: 600; font-size: 12.5px; }
.linkbtn { background: none; border: 0; color: var(--muted); padding: 0; cursor: pointer; font: inherit; text-align: left; }
.linkbtn:hover { color: var(--brand); }

/* -------------------------------- 主区域 -------------------------------- */
.main { padding: 24px 32px 64px; min-width: 0; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 20px; }
.head h1 { margin: 0; font-size: 21px; letter-spacing: -.3px; }
.head p { margin: 5px 0 0; color: var(--muted); font-size: 13px; }

.toolbar { display: flex; gap: 8px; align-items: center; flex: none; }
.menu { position: relative; }
.menu > summary {
  list-style: none; cursor: pointer; user-select: none;
  display: flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px;
  border: 1px solid var(--line); border-radius: 9px; background: var(--panel); color: var(--muted);
  font-size: 12.5px; font-weight: 600;
}
.menu > summary::-webkit-details-marker { display: none; }
.menu > summary:hover { color: var(--ink); border-color: var(--muted-2); }
.menu svg { width: 15px; height: 15px; }
.menu__list {
  position: absolute; right: 0; top: 38px; z-index: 40; min-width: 168px; padding: 6px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow-lg);
}
.menu__list a {
  display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: 8px;
  color: var(--ink); font-size: 13px; font-weight: 500;
}
.menu__list a:hover { background: var(--panel-2); text-decoration: none; }
.menu__list a.on { background: var(--brand-soft); color: var(--brand); }
.menu__list .sep { height: 1px; background: var(--line); margin: 5px 6px; }
.dot { width: 12px; height: 12px; border-radius: 50%; flex: none; box-shadow: inset 0 0 0 1px rgba(255,255,255,.25); }

/* --------------------------------- 卡片 --------------------------------- */
.grid { display: grid; gap: 16px; }
.cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.card {
  background: var(--panel); border: 1px solid var(--line); border-radius: 16px;
  box-shadow: var(--shadow); padding: 18px 20px; min-width: 0;
}
.card h2 { margin: 0 0 14px; font-size: 15px; letter-spacing: -.1px; }
.card .hint { color: var(--muted); font-size: 12.5px; margin: -8px 0 14px; }
.stat { position: relative; overflow: hidden; }
.stat::after {
  content: ""; position: absolute; inset: auto -30px -60px auto; width: 140px; height: 140px; border-radius: 50%;
  background: var(--grad); opacity: .07; filter: blur(6px);
}
.stat .k { color: var(--muted); font-size: 12.5px; }
.stat .v { font-size: 27px; font-weight: 680; letter-spacing: -.8px; margin-top: 2px; font-variant-numeric: tabular-nums; }
.stat .s { color: var(--muted-2); font-size: 12px; margin-top: 2px; }

/* --------------------------------- 表格 --------------------------------- */
.table { width: 100%; border-collapse: collapse; }
.table th {
  text-align: left; font-size: 11.5px; color: var(--muted-2); font-weight: 650; text-transform: uppercase;
  letter-spacing: .05em; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap;
}
.table td { padding: 11px 10px; border-bottom: 1px solid var(--line-2); vertical-align: middle; }
.table tr:last-child td { border-bottom: 0; }
.table tbody tr:hover td { background: color-mix(in srgb, var(--brand) 4%, transparent); }
.table .empty { color: var(--muted); text-align: center; padding: 26px 10px; }
.table-wrap { overflow-x: auto; }

.pill {
  display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px; border-radius: 999px;
  font-size: 12px; font-weight: 600; white-space: nowrap; border: 1px solid transparent;
}
.pill--ok { background: var(--ok-soft); color: var(--ok); border-color: var(--ok-line); }
.pill--warn { background: var(--warn-soft); color: var(--warn); border-color: var(--warn-line); }
.pill--bad { background: var(--bad-soft); color: var(--bad); border-color: var(--bad-line); }
.pill--muted { background: var(--neutral-soft); color: var(--muted); }
.pill--brand { background: var(--brand-soft); color: var(--brand); }

/* --------------------------------- 按钮 --------------------------------- */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border-radius: 10px; border: 1px solid var(--line); background: var(--panel); color: var(--ink);
  padding: 8px 14px; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap;
  transition: background-color .15s ease, border-color .15s ease, color .15s ease;
}
.btn:hover { border-color: var(--muted-2); background: var(--panel-2); text-decoration: none; }
.btn--primary { background: var(--brand); border-color: var(--brand); color: var(--brand-ink); }
.btn--primary:hover { background: var(--brand-strong); border-color: var(--brand-strong); color: var(--brand-ink); }
.btn--danger { color: var(--bad); border-color: var(--bad-line); background: transparent; }
.btn--danger:hover { background: var(--bad-soft); border-color: var(--bad); }
.btn--sm { padding: 5px 10px; font-size: 12.5px; border-radius: 8px; }
.btn--ghost { border-color: transparent; background: transparent; color: var(--muted); }
.btn--ghost:hover { background: var(--neutral-soft); color: var(--ink); }
.iconbtn {
  border: 0; background: transparent; color: var(--muted); cursor: pointer; font-size: 18px; line-height: 1;
  width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center;
}
.iconbtn:hover { background: var(--neutral-soft); color: var(--ink); }

/* --------------------------------- 表单 --------------------------------- */
form.inline { display: inline; }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.row--end { justify-content: flex-end; }
.stack { display: grid; gap: 12px; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 14px; }
.form-grid .wide { grid-column: 1 / -1; }
label.field { display: grid; gap: 6px; font-size: 12.5px; color: var(--muted); font-weight: 600; }
input[type=text], input[type=password], input[type=number], input[type=datetime-local], select, textarea {
  width: 100%; border: 1px solid var(--line); border-radius: 10px; padding: 9px 11px; font: inherit;
  color: var(--ink); background: var(--panel-2); outline: none; transition: border-color .15s ease, box-shadow .15s ease;
}
input:focus, select:focus, textarea:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--ring); }
textarea { min-height: 82px; resize: vertical; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12.5px; }
.checks { display: grid; gap: 6px; }
.checks label { display: flex; gap: 8px; align-items: center; font-size: 13px; color: var(--ink); font-weight: 500; }
.checks input { width: auto; accent-color: var(--brand); }
.muted { color: var(--muted); }
.small { font-size: 12.5px; }

.note { border-radius: 12px; padding: 11px 14px; font-size: 13px; margin-bottom: 16px; border: 1px solid transparent; }
.note--ok { background: var(--ok-soft); color: var(--ok); border-color: var(--ok-line); }
.note--bad { background: var(--bad-soft); color: var(--bad); border-color: var(--bad-line); }
.note--warn { background: var(--warn-soft); color: var(--warn); border-color: var(--warn-line); }
.reveal { background: var(--code-bg); color: #e6edf7; border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; margin-bottom: 16px; }
.reveal code { font-size: 14px; color: #7dd3fc; word-break: break-all; }
.dl { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 9px 14px; margin: 0; font-size: 13px; }
.dl dt { color: var(--muted); }
.dl dd { margin: 0; word-break: break-word; }

/* --------------------------------- 弹窗 --------------------------------- */
.modal {
  border: 0; padding: 0; background: transparent; max-width: min(680px, calc(100vw - 32px)); width: 100%;
  color: var(--ink);
}
.modal::backdrop { background: rgba(8, 12, 20, .55); backdrop-filter: blur(3px); }
.modal__card {
  background: var(--panel); border: 1px solid var(--line); border-radius: 18px; box-shadow: var(--shadow-lg);
  padding: 20px 22px 18px; display: grid; gap: 14px; max-height: calc(100vh - 80px); overflow: auto;
  animation: pop .16s ease-out;
}
@keyframes pop { from { opacity: 0; transform: translateY(6px) scale(.99); } to { opacity: 1; transform: none; } }
.modal__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.modal__head h2 { margin: 0; font-size: 16px; letter-spacing: -.2px; }
.modal__head p { margin: 4px 0 0; color: var(--muted); font-size: 12.5px; }
.modal__foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }
.modal--wide { max-width: min(820px, calc(100vw - 32px)); }
.kv { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 10px 16px; font-size: 13px; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; word-break: break-word; }
.kv .mono { font-size: 12px; }

/* --------------------------------- 登录 --------------------------------- */
.login-wrap {
  min-height: 100vh; display: grid; place-items: center; padding: 30px;
  background-image: var(--bg-glow); background-repeat: no-repeat; background-attachment: fixed;
}
.login-card {
  width: 100%; max-width: 396px; background: var(--panel); border: 1px solid var(--line); border-radius: 20px;
  box-shadow: var(--shadow-lg); padding: 26px 26px 22px;
}
.login-card h1 { margin: 16px 0 4px; font-size: 20px; }
.login-card p.sub { margin: 0 0 20px; color: var(--muted); font-size: 13px; }
.login-brand { display: flex; align-items: center; gap: 10px; font-weight: 700; }
.login-brand .logo {
  width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center;
  background: var(--grad); color: #fff; font-weight: 800;
}
.login-foot { margin: 18px 0 0; font-size: 12.5px; color: var(--muted); }
.login-tools { position: absolute; right: 20px; top: 18px; z-index: 20; }

/* ------------------------------- 登录 / 认证 ------------------------------ */
.auth { display: grid; grid-template-columns: minmax(0, 1.04fr) minmax(0, 1fr); min-height: 100vh; background: var(--bg); }
.auth__aside {
  position: relative; overflow: hidden; display: flex; flex-direction: column; min-height: 100vh;
  padding: 40px 56px 30px; color: #e8eefb;
  background:
    radial-gradient(760px 420px at 12% -10%, color-mix(in srgb, var(--brand) 42%, transparent), transparent 68%),
    radial-gradient(620px 420px at 92% 108%, color-mix(in srgb, var(--brand-2) 20%, transparent), transparent 70%),
    #0d1526;
}
.auth__brand { display: flex; align-items: center; gap: 12px; color: #fff; font-weight: 700; letter-spacing: .2px; }
.auth__brand:hover { text-decoration: none; }
.auth__brand .logo {
  width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; flex: none;
  background: var(--grad); color: #fff; font-weight: 800; font-size: 15px;
  box-shadow: 0 10px 26px -12px color-mix(in srgb, var(--brand) 90%, transparent);
}
.auth__brand .tag {
  display: block; font-size: 10px; letter-spacing: .18em; text-transform: uppercase;
  color: #8fa1c2; font-weight: 650; margin-top: 3px;
}
.auth__intro { margin-top: auto; max-width: 560px; padding: 56px 0 40px; }
.auth__kicker { font-size: 10.5px; letter-spacing: .2em; text-transform: uppercase; color: #8ea0c0; font-weight: 650; }
.auth__intro h1 { margin: 15px 0 34px; font-size: clamp(27px, 3vw, 40px); line-height: 1.2; letter-spacing: -.025em; font-weight: 650; color: #fff; }
.auth__steps { list-style: none; margin: 0; padding: 0; display: grid; }
.auth__steps li {
  position: relative; display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; gap: 14px; align-items: center;
  padding: 15px 0; border-top: 1px solid rgba(255, 255, 255, .09);
}
.auth__steps li:last-child { border-bottom: 1px solid rgba(255, 255, 255, .09); }
.auth__steps .n { font-size: 11px; letter-spacing: .1em; color: #6e81a2; font-variant-numeric: tabular-nums; }
.auth__steps b { display: block; font-size: 13.5px; font-weight: 600; color: #c3cfe4; }
.auth__steps small { display: block; font-size: 11.5px; color: #7c8dab; margin-top: 2px; }
.auth__steps em { font-style: normal; font-size: 11px; color: #6e81a2; white-space: nowrap; }
.auth__steps li.done b { color: #fff; }
.auth__steps li.now b { color: #fff; }
.auth__steps li.now { padding-left: 18px; }
.auth__steps li.now::before { content: ""; position: absolute; left: 0; top: 15px; bottom: 15px; width: 2px; border-radius: 2px; background: var(--brand-2); }
.auth__steps li.now .n, .auth__steps li.now em { color: var(--brand-2); }
.auth__foot { margin-top: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11px; color: #7386a6; }
.auth__foot svg { width: 14px; height: 14px; }
.auth__foot span + span::before { content: "·"; margin-right: 8px; color: #4e6080; }

.auth__main { position: relative; display: flex; align-items: center; justify-content: center; padding: 56px 40px; background: var(--bg); background-image: var(--bg-glow); background-repeat: no-repeat; background-attachment: fixed; }
.auth__panel { width: 100%; max-width: 352px; }
.auth__panel--wide { max-width: 420px; }
.auth__back { position: absolute; left: 26px; top: 24px; font-size: 12.5px; color: var(--muted); }
.auth__back:hover { color: var(--brand); text-decoration: none; }
.auth__mobilebrand { display: none; align-items: center; gap: 10px; font-weight: 700; margin-bottom: 26px; color: var(--ink); }
.auth__mobilebrand .logo { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: var(--grad); color: #fff; font-weight: 800; }
.auth__eyebrow { display: flex; align-items: center; gap: 8px; font-size: 11.5px; font-weight: 650; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
.auth__eyebrow i { width: 6px; height: 6px; border-radius: 50%; background: var(--brand); flex: none; }
.auth__panel h2 { margin: 10px 0 10px; font-size: 28px; letter-spacing: -.03em; font-weight: 650; }
.auth__panel .sub { margin: 0 0 26px; color: var(--muted); font-size: 13px; line-height: 1.6; }
.auth__panel .note { margin-bottom: 16px; }
.auth__field { display: grid; gap: 7px; margin-bottom: 14px; font-size: 12.5px; font-weight: 600; color: var(--muted); }
.auth__box { display: flex; align-items: stretch; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; transition: border-color .15s ease, box-shadow .15s ease; }
.auth__box:focus-within { border-color: var(--brand); box-shadow: 0 0 0 3px var(--ring); }
.auth__box input { border: 0; border-radius: 0; background: transparent; padding: 11px 12px; box-shadow: none; }
.auth__box input:focus { border: 0; box-shadow: none; }
.auth__peek {
  border: 0; border-left: 1px solid var(--line); background: transparent; color: var(--muted);
  font: inherit; font-size: 12px; font-weight: 600; padding: 0 13px; cursor: pointer; flex: none;
}
.auth__peek:hover { color: var(--brand); }
.auth__captcha { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.auth__captcha .cap { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; line-height: 0; background: #f4f5f9; flex: none; }
.auth__captcha .cap svg { display: block; }
.auth__captcha input[type=text] { width: 96px; flex: none; text-align: center; letter-spacing: .22em; font-weight: 650; }
.auth__captcha .refresh { flex: none; height: 40px; padding: 0 12px; font-size: 12px; }
.auth__hint { margin: -2px 0 16px; font-size: 11.5px; line-height: 1.6; color: var(--muted-2); }
.auth__submit { width: 100%; height: 44px; justify-content: space-between; padding: 0 16px; margin-top: 8px; border-radius: 9px; }
.auth__submit .arrow { font-size: 16px; line-height: 1; opacity: .9; }
.auth__links { display: flex; justify-content: space-between; align-items: center; gap: 10px 16px; flex-wrap: wrap; margin-top: 16px; font-size: 12.5px; color: var(--muted); }
.auth__meta { display: flex; justify-content: space-between; gap: 12px; margin-top: 44px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 10.5px; letter-spacing: .06em; color: var(--muted-2); text-transform: uppercase; }
.auth__done { display: grid; gap: 10px; justify-items: start; }
.auth__done .mark { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: var(--ok-soft); color: var(--ok); border: 1px solid var(--ok-line); font-size: 20px; }

@media (max-width: 900px) {
  .auth { grid-template-columns: 1fr; }
  .auth__aside { display: none; }
  .auth__main { min-height: 100vh; padding: 54px 22px 40px; }
  .auth__mobilebrand { display: flex; }
  .auth__back { display: none; }
  .auth__meta { margin-top: 34px; }
}

@media (max-width: 960px) {
  .shell { grid-template-columns: 1fr; align-content: start; }
  .side {
    position: static; height: auto; flex-direction: row; align-items: center; align-content: flex-start;
    gap: 10px 12px; flex-wrap: wrap;
    border-right: 0; border-bottom: 1px solid var(--side-line); padding: 12px 14px;
  }
  .brand .tag { display: none; }
  .brand, .nav, .nav a, .side-foot { flex: none; }
  .side-foot { white-space: nowrap; }
  .nav { flex-direction: row; }
  .nav a.on::before { display: none; }
  .side-foot { margin: 0 0 0 auto; display: flex; align-items: center; gap: 12px; }
  .main { padding: 18px 16px 40px; }
  .head { flex-direction: column; }
  .hide-sm { display: none; }
  .cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cols-2 { grid-template-columns: 1fr; }
  .form-grid { grid-template-columns: 1fr; }
  .kv, .dl { grid-template-columns: 1fr; gap: 4px 0; }
  .kv dt, .dl dt { font-size: 12px; }
  /* 弹窗里仍用两列，避免详情被拉成一长条 */
  .modal .kv { grid-template-columns: 112px minmax(0, 1fr); gap: 8px 14px; }
  .modal .kv dt { font-size: 12.5px; }
}

@media (max-width: 700px) {
  /* 手机：品牌与身份同一行，导航独占下一行，省掉一行高度 */
  .side { padding: 10px 12px; gap: 8px 10px; }
  .side-foot { order: 2; }
  .nav { order: 3; flex-basis: 100%; gap: 2px; }
  .nav a { padding: 7px 9px; font-size: 12.5px; gap: 7px; }
  .head h1 { font-size: 19px; }
  .card { padding: 14px; }
  .card > h2 { font-size: 15px; }
  .table { font-size: 12.5px; }
  .table th { padding: 8px 8px; }
  .table td { padding: 9px 8px; }
  .table td:last-child, .table th:last-child { white-space: nowrap; }
  .table td.small { white-space: nowrap; }
  .table td .row { flex-wrap: wrap; gap: 6px; }
  .btn--sm { padding: 4px 8px; font-size: 12px; }
  .hide-xs { display: none; }
}
`;

/** 主页等自定义页面复用同一套主题变量与基础组件样式 */
export const PAGE_CSS = CSS;

/* --------------------------------- 图标 ---------------------------------- */
const ICONS = {
  overview:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
  users:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.1 2.9-4.8 5.5-4.8s4.9 1.7 5.5 4.8"/><path d="M16.5 6.4a3 3 0 0 1 0 5.6"/><path d="M18 19c-.2-1.6-.7-2.9-1.6-3.9 2.4.2 3.9 1.8 4.3 3.9"/></svg>',
  credentials:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M7 10h4"/><path d="M7 14h2.5"/><circle cx="16.5" cy="12" r="2.3"/><path d="M16.5 14.3V17"/></svg>',
  keys:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="8" cy="8" r="4"/><path d="M11 11l8 8"/><path d="M16 16l2-2"/><path d="M18.5 18.5l2-2"/></svg>',
  logs:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M14 4v5h5"/><path d="M8 13h8M8 17h5"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.4a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.11a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.88 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.11a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.88.34H9.1A1.7 1.7 0 0 0 10.13 3.7V3a2 2 0 1 1 4 0v.11a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.88v.05a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.11a1.7 1.7 0 0 0-1.49 1.03z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a7 7 0 1 0 10.5 10.5z"/></svg>',
  auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/></svg>',
  globe:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5S14.4 18.2 12 20.5c-2.4-2.3-3.6-5.2-3.6-8.5S9.6 5.8 12 3.5z"/></svg>',
  palette:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.9 2-1.9 0-1.6-1.2-1.9-1.2-3.1 0-1 .8-1.8 1.9-1.8H17a4 4 0 0 0 4-4C21 6.3 17 3 12 3z"/><circle cx="7.8" cy="10.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="11" cy="7.4" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.4" cy="8.4" r="1.1" fill="currentColor" stroke="none"/></svg>',
};

export function navIcon(name: "overview" | "users" | "credentials" | "keys" | "logs" | "settings"): string {
  return ICONS[name];
}

/* ------------------------------- 偏好工具栏 ------------------------------- */

function modeIcon(mode: Mode): string {
  return mode === "dark" ? ICONS.moon : mode === "light" ? ICONS.sun : ICONS.auto;
}

export function toolbar(prefs: Prefs, t: Translate, self: string): string {
  const langLabel = prefs.lang === "zh" ? "中" : "EN";
  const modeLabel = t(prefs.mode === "dark" ? "chrome.dark" : prefs.mode === "light" ? "chrome.light" : "chrome.auto");
  const theme = THEMES.find((item) => item.id === prefs.theme) ?? THEMES[0]!;

  const langItems = [
    { value: "zh", label: "中文" },
    { value: "en", label: "English" },
  ]
    .map(
      (item) =>
        `<a href="${prefsHref("lang", item.value, self)}" class="${prefs.lang === item.value ? "on" : ""}">${item.label}</a>`,
    )
    .join("");

  const modeItems = MODES.map((mode) => {
    const label = t(mode === "dark" ? "chrome.dark" : mode === "light" ? "chrome.light" : "chrome.auto");
    return `<a href="${prefsHref("mode", mode, self)}" class="${prefs.mode === mode ? "on" : ""}">${modeIcon(
      mode,
    )}${escapeHtml(label)}</a>`;
  }).join("");

  const themeItems = THEMES.map(
    (item) =>
      `<a href="${prefsHref("theme", item.id, self)}" class="${prefs.theme === item.id ? "on" : ""}">
         <span class="dot" style="background:linear-gradient(135deg,${item.dot},${item.dot2})"></span>${escapeHtml(
           t(item.key as "theme.aurora"),
         )}
       </a>`,
  ).join("");

  return `<div class="toolbar">
    <details class="menu">
      <summary title="${escapeHtml(t("chrome.language"))}">${ICONS.globe}${langLabel}</summary>
      <div class="menu__list">${langItems}</div>
    </details>
    <details class="menu">
      <summary title="${escapeHtml(t("chrome.mode"))}">${modeIcon(prefs.mode)}<span class="hide-sm">${escapeHtml(
        modeLabel,
      )}</span></summary>
      <div class="menu__list">${modeItems}</div>
    </details>
    <details class="menu">
      <summary title="${escapeHtml(t("chrome.theme"))}">${ICONS.palette}<span class="hide-sm">${escapeHtml(
        t(theme.key as "theme.aurora"),
      )}</span></summary>
      <div class="menu__list">${themeItems}</div>
    </details>
  </div>`;
}

/* --------------------------------- 组件 ---------------------------------- */

const SCRIPT = `<script>
(() => {
  const closeAll = (except) => {
    document.querySelectorAll('details.menu[open]').forEach((node) => { if (node !== except) node.open = false; });
  };
  document.addEventListener('click', (event) => {
    const opener = event.target.closest('[data-open]');
    if (opener) {
      const dialog = document.getElementById(opener.getAttribute('data-open'));
      if (dialog && typeof dialog.showModal === 'function') { dialog.showModal(); }
      else if (dialog) { dialog.setAttribute('open', 'open'); }
      event.preventDefault();
      return;
    }
    const closer = event.target.closest('[data-close]');
    if (closer) {
      const dialog = closer.closest('dialog');
      if (dialog) dialog.close();
      return;
    }
    if (event.target.tagName === 'DIALOG') { event.target.close(); return; }
    if (!event.target.closest('details.menu')) closeAll(null);
  });
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('close', () => { dialog.removeAttribute('open'); });
  });
})();
</script>`;

export function shell(options: ShellOptions): string {
  const self = options.self ?? options.active;
  const nav = options.nav
    .map(
      (item) =>
        `<a href="${escapeHtml(item.href)}" class="${item.href === options.active ? "on" : ""}">${
          item.icon ?? ""
        }<span>${escapeHtml(item.label)}</span></a>`,
    )
    .join("");

  const notice = options.notice ? `<div class="note note--ok">${escapeHtml(options.notice)}</div>` : "";
  const error = options.error ? `<div class="note note--bad">${escapeHtml(options.error)}</div>` : "";
  const logoutForm = options.csrf
    ? `<form class="inline" method="post" action="${options.active.startsWith("/user") ? "/user/logout" : "/admin/logout"}">
         <input type="hidden" name="csrf" value="${escapeHtml(options.csrf)}">
         <button class="linkbtn" type="submit">${escapeHtml(options.t("chrome.logout"))}</button>
       </form>`
    : "";

  return `<!doctype html>
<html lang="${options.prefs.lang === "zh" ? "zh-CN" : "en"}" data-theme="${options.prefs.theme}" data-mode="${
    options.prefs.mode
  }">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(options.title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="shell">
  <aside class="side">
    <a class="brand" href="${options.active.startsWith("/user") ? "/user" : "/admin"}">
      <span class="logo">C</span>
      <span class="name">${escapeHtml(options.brand ?? "CertumSigner")}<span class="tag">${escapeHtml(
        options.t("brand.tagline"),
      )}</span></span>
    </a>
    <nav class="nav">${nav}</nav>
    <div class="side-foot">
      ${options.userLabel ? `<div class="who">${escapeHtml(options.userLabel)}</div>` : ""}
      ${logoutForm}
    </div>
  </aside>
  <main class="main">
    <div class="head">
      <div>
        <h1>${escapeHtml(options.title)}</h1>
        ${options.subtitle ? `<p>${escapeHtml(options.subtitle)}</p>` : ""}
      </div>
      ${toolbar(options.prefs, options.t, self)}
    </div>
    ${notice}${error}
    ${options.body}
  </main>
</div>
${SCRIPT}
</body>
</html>`;
}

export interface CaptchaView {
  id: string;
  svg: string;
}

/** 登录 / 注册 / 找回密码共用的验证码字段 */
export function captchaField(captcha: CaptchaView, t: Translate): string {
  return `<div class="auth__field">${escapeHtml(t("login.captcha"))}
      <div class="auth__captcha">
        <span class="cap" data-captcha-img>${captcha.svg}</span>
        <input type="hidden" name="captchaId" value="${escapeHtml(captcha.id)}" data-captcha-id>
        <input type="text" name="captcha" inputmode="numeric" autocomplete="off" maxlength="4" required
          aria-label="${escapeHtml(t("login.captcha"))}">
        <button type="button" class="btn btn--sm refresh" data-captcha-refresh>${escapeHtml(
          t("login.captchaRefresh"),
        )}</button>
      </div>
    </div>
    <p class="auth__hint">${escapeHtml(t("login.captchaHint"))}</p>`;
}

const AUTH_SCRIPT = `<script>
(() => {
  document.querySelectorAll('[data-peek]').forEach((button) => {
    const box = button.closest('.auth__box');
    const input = box && box.querySelector('input');
    if (!input) return;
    button.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? button.dataset.hide : button.dataset.show;
    });
  });
  document.querySelectorAll('[data-captcha-refresh]').forEach((button) => {
    button.addEventListener('click', async () => {
      const form = button.closest('form') || document;
      button.disabled = true;
      try {
        const response = await fetch('/captcha', { cache: 'no-store', headers: { accept: 'application/json' } });
        if (!response.ok) return;
        const data = await response.json();
        const image = form.querySelector('[data-captcha-img]');
        const id = form.querySelector('[data-captcha-id]');
        const answer = form.querySelector('input[name="captcha"]');
        if (image) image.innerHTML = data.svg;
        if (id) id.value = data.id;
        if (answer) { answer.value = ''; answer.focus(); }
      } catch (error) {
        /* 刷新失败时保留旧图，用户可以再点一次 */
      } finally {
        button.disabled = false;
      }
    });
  });
})();
</script>`;

const SHIELD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3l7 3v5.2c0 4.3-2.9 7.7-7 9.8-4.1-2.1-7-5.5-7-9.8V6l7-3z"/><path d="M9 12l2.2 2.2L15.4 10"/></svg>';

export function loginShell(options: {
  title: string;
  subtitle: string;
  action: string;
  body: string;
  prefs: Prefs;
  t: Translate;
  self: string;
  error?: string;
  notice?: string;
  footer?: string;
  captcha?: CaptchaView;
  /** 注册 / 找回密码用更宽的卡片 */
  wide?: boolean;
  /** 纯结果页：不套 <form>，正文直接渲染 */
  formless?: boolean;
}): string {
  const { t } = options;
  const steps = [
    { cls: "done", n: "01", title: t("auth.step1Title"), text: t("auth.step1Text"), state: t("auth.step1State") },
    { cls: "now", n: "02", title: t("auth.step2Title"), text: t("auth.step2Text"), state: t("auth.step2State") },
    { cls: "", n: "03", title: t("auth.step3Title"), text: t("auth.step3Text"), state: t("auth.step3State") },
  ]
    .map(
      (step) => `<li class="${step.cls}">
        <span class="n">${step.n}</span>
        <div><b>${escapeHtml(step.title)}</b><small>${escapeHtml(step.text)}</small></div>
        <em>${escapeHtml(step.state)}</em>
      </li>`,
    )
    .join("");

  return `<!doctype html>
<html lang="${options.prefs.lang === "zh" ? "zh-CN" : "en"}" data-theme="${options.prefs.theme}" data-mode="${
    options.prefs.mode
  }">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(options.title)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="login-tools">${toolbar(options.prefs, options.t, options.self)}</div>
<div class="auth">
  <aside class="auth__aside">
    <a class="auth__brand" href="/">
      <span class="logo">C</span>
      <span>CertumSigner<span class="tag">${escapeHtml(t("brand.tagline"))}</span></span>
    </a>
    <div class="auth__intro">
      <div class="auth__kicker">${escapeHtml(t("auth.kicker"))}</div>
      <h1>${escapeHtml(t("auth.heading"))}</h1>
      <ol class="auth__steps">${steps}</ol>
    </div>
    <div class="auth__foot">${SHIELD}<span>${escapeHtml(t("auth.security"))}</span></div>
  </aside>
  <main class="auth__main">
    <a class="auth__back" href="/">← ${escapeHtml(t("login.backHome"))}</a>
    <div class="auth__panel${options.wide ? " auth__panel--wide" : ""}">
      <div class="auth__mobilebrand"><span class="logo">C</span>CertumSigner</div>
      <div class="auth__eyebrow"><i></i>${escapeHtml(t("auth.identity"))}</div>
      <h2>${escapeHtml(options.title)}</h2>
      <p class="sub">${escapeHtml(options.subtitle)}</p>
      ${options.notice ? `<div class="note note--ok">${escapeHtml(options.notice)}</div>` : ""}
      ${options.error ? `<div class="note note--bad">${escapeHtml(options.error)}</div>` : ""}
      ${
        options.formless
          ? options.body
          : `<form method="post" action="${escapeHtml(options.action)}" class="stack">${options.body}</form>`
      }
      ${options.footer ?? ""}
      <div class="auth__meta"><span>${escapeHtml(t("auth.footer"))}</span><span>${escapeHtml(
        t("auth.footerMeta"),
      )}</span></div>
    </div>
  </main>
</div>
${SCRIPT}
${AUTH_SCRIPT}
</body>
</html>`;
}

export function statCard(label: string, value: string | number, sub?: string): string {
  return `<div class="card stat"><div class="k">${escapeHtml(label)}</div><div class="v">${escapeHtml(
    String(value),
  )}</div>${sub ? `<div class="s">${escapeHtml(sub)}</div>` : ""}</div>`;
}

export function emptyRow(cols: number, text = "暂无数据"): string {
  return `<tr><td class="empty" colspan="${cols}">${escapeHtml(text)}</td></tr>`;
}

export interface ModalOptions {
  id: string;
  title: string;
  hint?: string;
  action: string;
  csrf: string;
  body: string;
  submit: string;
  cancel: string;
  wide?: boolean;
  danger?: boolean;
}

/** 弹窗表单：正文在弹窗里，按钮用 data-open 打开（<dialog>，无 JS 时退化为内联显示） */
export function formModal(options: ModalOptions): string {
  return `<dialog class="modal${options.wide ? " modal--wide" : ""}" id="${escapeHtml(options.id)}">
  <form method="post" action="${escapeHtml(options.action)}" class="modal__card">
    <input type="hidden" name="csrf" value="${escapeHtml(options.csrf)}">
    <div class="modal__head">
      <div>
        <h2>${escapeHtml(options.title)}</h2>
        ${options.hint ? `<p>${escapeHtml(options.hint)}</p>` : ""}
      </div>
      <button class="iconbtn" type="button" data-close aria-label="${escapeHtml(options.cancel)}">×</button>
    </div>
    <div class="stack">${options.body}</div>
    <div class="modal__foot">
      <button class="btn" type="button" data-close>${escapeHtml(options.cancel)}</button>
      <button class="btn ${options.danger ? "btn--danger" : "btn--primary"}" type="submit">${escapeHtml(
        options.submit,
      )}</button>
    </div>
  </form>
</dialog>`;
}

/** 只读详情弹窗（签名记录等） */
export function detailModal(options: { id: string; title: string; rows: Array<[string, string]>; close: string }): string {
  const rows = options.rows
    .map(
      ([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${value}</dd>`,
    )
    .join("");
  return `<dialog class="modal" id="${escapeHtml(options.id)}">
  <div class="modal__card">
    <div class="modal__head">
      <h2>${escapeHtml(options.title)}</h2>
      <button class="iconbtn" type="button" data-close aria-label="${escapeHtml(options.close)}">×</button>
    </div>
    <dl class="kv">${rows}</dl>
    <div class="modal__foot">
      <button class="btn" type="button" data-close>${escapeHtml(options.close)}</button>
    </div>
  </div>
</dialog>`;
}
