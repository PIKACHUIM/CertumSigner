/**
 * 系统开关：验证码方式、自助注册、找回密码、发信验证码。
 * 全部存在同一个 KV 记录里，管理员后台修改，默认全部关闭。
 */
import type { Env } from "../types";

/** off = 不校验；svg = 自绘数字图形码；turnstile = Cloudflare Turnstile */
export type CaptchaMode = "off" | "svg" | "turnstile";

const CAPTCHA_MODES: readonly CaptchaMode[] = ["off", "svg", "turnstile"];

export interface SystemSettings {
  /** 登录（用户 / 管理员 / 桌面客户端）用哪种验证码 */
  captchaMode: CaptchaMode;
  /** 开放自助注册（注册后必须邮箱验证） */
  registerEnabled: boolean;
  /** 开放找回密码 */
  resetEnabled: boolean;
  /** 注册 / 找回密码发信前需要验证码（走 captchaMode 的方式） */
  emailCaptcha: boolean;
  updatedAt?: number;
}

const KEY = "settings:system";

export const DEFAULT_SETTINGS: SystemSettings = {
  captchaMode: "off",
  registerEnabled: false,
  resetEnabled: false,
  emailCaptcha: false,
};

function normalizeMode(value: unknown): CaptchaMode {
  return CAPTCHA_MODES.includes(value as CaptchaMode) ? (value as CaptchaMode) : "off";
}

export async function readSettings(env: Env): Promise<SystemSettings> {
  const raw = await env.CERTUM_KV.get<Partial<SystemSettings> & { loginCaptcha?: boolean }>(KEY, "json");
  const stored = raw ?? {};
  // 老记录只有 loginCaptcha 开关：打开就等价于图形验证码
  const captchaMode =
    stored.captchaMode === undefined && stored.loginCaptcha ? "svg" : normalizeMode(stored.captchaMode);
  return {
    captchaMode,
    registerEnabled: stored.registerEnabled ?? DEFAULT_SETTINGS.registerEnabled,
    resetEnabled: stored.resetEnabled ?? DEFAULT_SETTINGS.resetEnabled,
    emailCaptcha: stored.emailCaptcha ?? DEFAULT_SETTINGS.emailCaptcha,
    updatedAt: stored.updatedAt,
  };
}

export async function writeSettings(env: Env, patch: Partial<SystemSettings>): Promise<SystemSettings> {
  const current = await readSettings(env);
  const next: SystemSettings = {
    captchaMode: patch.captchaMode === undefined ? current.captchaMode : normalizeMode(patch.captchaMode),
    registerEnabled: patch.registerEnabled ?? current.registerEnabled,
    resetEnabled: patch.resetEnabled ?? current.resetEnabled,
    emailCaptcha: patch.emailCaptcha ?? current.emailCaptcha,
    updatedAt: Date.now(),
  };
  await env.CERTUM_KV.put(KEY, JSON.stringify(next));
  return next;
}
