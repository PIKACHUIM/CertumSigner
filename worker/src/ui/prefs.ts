/** 外观偏好（语言 / 主题 / 明暗）：全部落 cookie，服务端渲染时直接生效，无闪烁 */
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { detectLang, normalizeLang, type Lang } from "./i18n";

export type ThemeId = "aurora" | "nebula" | "jade" | "graphite";
export type Mode = "auto" | "dark" | "light";

export interface ThemeMeta {
  id: ThemeId;
  /** i18n key */
  key: string;
  /** 主题选择器上的色点 */
  dot: string;
  dot2: string;
}

export const THEMES: ThemeMeta[] = [
  { id: "aurora", key: "theme.aurora", dot: "#6366f1", dot2: "#22d3ee" },
  { id: "nebula", key: "theme.nebula", dot: "#a855f7", dot2: "#f472b6" },
  { id: "jade", key: "theme.jade", dot: "#10b981", dot2: "#38bdf8" },
  { id: "graphite", key: "theme.graphite", dot: "#64748b", dot2: "#94a3b8" },
];

export const MODES: Mode[] = ["auto", "dark", "light"];

export interface Prefs {
  lang: Lang;
  theme: ThemeId;
  mode: Mode;
}

const COOKIE = { lang: "cs_lang", theme: "cs_theme", mode: "cs_mode" } as const;
const ONE_YEAR = 60 * 60 * 24 * 365;

function normalizeTheme(value?: string | null): ThemeId | null {
  const found = THEMES.find((item) => item.id === value);
  return found ? found.id : null;
}

function normalizeMode(value?: string | null): Mode | null {
  return value === "dark" || value === "light" || value === "auto" ? value : null;
}

export function readPrefs(c: Context): Prefs {
  const lang = normalizeLang(getCookie(c, COOKIE.lang)) ?? detectLang(c.req.header("accept-language"));
  const theme = normalizeTheme(getCookie(c, COOKIE.theme)) ?? "aurora";
  const mode = normalizeMode(getCookie(c, COOKIE.mode)) ?? "auto";
  return { lang, theme, mode };
}

/** 只写入参数里给出的字段，其余保持不变 */
export function applyPrefs(c: Context, patch: { lang?: string; theme?: string; mode?: string }): Prefs {
  const current = readPrefs(c);
  const next: Prefs = {
    lang: normalizeLang(patch.lang) ?? current.lang,
    theme: normalizeTheme(patch.theme) ?? current.theme,
    mode: normalizeMode(patch.mode) ?? current.mode,
  };
  setCookie(c, COOKIE.lang, next.lang, { path: "/", maxAge: ONE_YEAR, sameSite: "Lax" });
  setCookie(c, COOKIE.theme, next.theme, { path: "/", maxAge: ONE_YEAR, sameSite: "Lax" });
  setCookie(c, COOKIE.mode, next.mode, { path: "/", maxAge: ONE_YEAR, sameSite: "Lax" });
  return next;
}

/** 只允许站内相对路径，避免开放重定向 */
export function safeBack(raw: string | null | undefined, fallback: string): string {
  const text = (raw ?? "").trim();
  if (!text.startsWith("/") || text.startsWith("//")) return fallback;
  if (text.startsWith("/prefs")) return fallback;
  return text;
}

/** 把当前路径 + 查询串转成带回跳参数的偏好链接 */
export function prefsHref(kind: "lang" | "theme" | "mode", value: string, current: string): string {
  return `/prefs?${kind}=${encodeURIComponent(value)}&back=${encodeURIComponent(current)}`;
}
