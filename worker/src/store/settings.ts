/**
 * 系统开关：登录验证码、自助注册、找回密码、发信验证码。
 * 全部存在同一个 KV 记录里，管理员后台修改，默认全部关闭。
 */
import type { Env } from "../types";

export interface SystemSettings {
  /** 登录（用户 / 管理员）时必须输入图形验证码 */
  loginCaptcha: boolean;
  /** 开放自助注册（注册后必须邮箱验证） */
  registerEnabled: boolean;
  /** 开放找回密码 */
  resetEnabled: boolean;
  /** 注册 / 找回密码发信前需要图形验证码 */
  emailCaptcha: boolean;
  updatedAt?: number;
}

const KEY = "settings:system";

export const DEFAULT_SETTINGS: SystemSettings = {
  loginCaptcha: false,
  registerEnabled: false,
  resetEnabled: false,
  emailCaptcha: false,
};

export async function readSettings(env: Env): Promise<SystemSettings> {
  const raw = await env.CERTUM_KV.get<Partial<SystemSettings>>(KEY, "json");
  return { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
}

export async function writeSettings(env: Env, patch: Partial<SystemSettings>): Promise<SystemSettings> {
  const current = await readSettings(env);
  const next: SystemSettings = {
    loginCaptcha: patch.loginCaptcha ?? current.loginCaptcha,
    registerEnabled: patch.registerEnabled ?? current.registerEnabled,
    resetEnabled: patch.resetEnabled ?? current.resetEnabled,
    emailCaptcha: patch.emailCaptcha ?? current.emailCaptcha,
    updatedAt: Date.now(),
  };
  await env.CERTUM_KV.put(KEY, JSON.stringify(next));
  return next;
}
