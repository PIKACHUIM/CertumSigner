/**
 * RFC 6238 TOTP —— Certum 的二维码就是标准 otpauth URI，
 * 密码字段填的不是账号密码，而是每 30 秒一换的 6 位动态口令。
 *
 * 注意：Certum 的 URI 里 algorithm=SHA256，不是 RFC 默认的 SHA1。
 * 用 SHA-1 对 SHA-256 种子算出来的码永远是错的，而且不会报错，只会登录失败。
 */

export type OtpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface OtpConfig {
  secret: string;
  digits: number;
  period: number;
  algorithm: OtpAlgorithm;
}

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!clean) throw new Error("TOTP 种子为空");

  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`TOTP 种子里有非法 Base32 字符: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function normalizeAlgorithm(raw: string | undefined): OtpAlgorithm {
  const value = (raw ?? "SHA1").toUpperCase().replace(/[-_]/g, "");
  if (value === "SHA1" || value === "SHA256" || value === "SHA512") return value;
  throw new Error(`不支持的 TOTP 算法: ${raw}`);
}

/** 解析 otpauth://totp/...?...，忽略 label/issuer，只取参数 */
export function parseOtpUri(uri: string): Partial<OtpConfig> {
  const text = uri.trim();
  if (!/^otpauth:\/\//i.test(text)) throw new Error("CERTUM_OTP_URI 不是 otpauth:// 开头的 URI");
  const queryIndex = text.indexOf("?");
  if (queryIndex < 0) throw new Error("otpauth URI 缺少参数");
  const params = new URLSearchParams(text.slice(queryIndex + 1));

  const secret = params.get("secret") ?? undefined;
  if (!secret) throw new Error("otpauth URI 里没有 secret 参数");

  return {
    secret,
    digits: params.get("digits") ? Number(params.get("digits")) : undefined,
    period: params.get("period") ? Number(params.get("period")) : undefined,
    algorithm: params.get("algorithm") ? normalizeAlgorithm(params.get("algorithm")!) : undefined,
  };
}

/** 从 otpauth URI 或裸 Base32 种子拼出完整的 TOTP 配置；缺种子直接报错 */
export function resolveOtpConfig(input: { uri?: string; secret?: string }): OtpConfig {
  const base: OtpConfig = { secret: "", digits: 6, period: 30, algorithm: "SHA1" };
  let merged: Partial<OtpConfig> = {};

  if (input.uri && input.uri.trim()) {
    merged = parseOtpUri(input.uri.trim());
  } else if (input.secret && input.secret.trim()) {
    merged = { secret: input.secret.trim() };
  }

  if (!merged.secret) throw new Error("OTP 种子不能为空");

  const cfg: OtpConfig = {
    secret: merged.secret,
    digits: merged.digits ?? base.digits,
    period: merged.period ?? base.period,
    algorithm: merged.algorithm ?? base.algorithm,
  };

  if (!Number.isInteger(cfg.digits) || cfg.digits < 6 || cfg.digits > 10) {
    throw new Error(`TOTP digits 不合法: ${cfg.digits}`);
  }
  if (!Number.isInteger(cfg.period) || cfg.period < 10 || cfg.period > 120) {
    throw new Error(`TOTP period 不合法: ${cfg.period}`);
  }
  // 提前解码一次，坏种子在启动/首次登录时暴露，而不是在切割口令时抛一个含糊的异常
  base32Decode(cfg.secret);
  return cfg;
}

/** 计算指定时间片（Unix 秒）的动态口令 */
export async function totpAt(cfg: OtpConfig, unixSeconds: number): Promise<string> {
  const key = base32Decode(cfg.secret);
  const counter = Math.floor(unixSeconds / cfg.period);

  const counterBytes = new Uint8Array(8);
  let remaining = counter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: cfg.algorithm === "SHA1" ? "SHA-1" : cfg.algorithm === "SHA256" ? "SHA-256" : "SHA-512" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, counterBytes));

  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);

  return (binary % 10 ** cfg.digits).toString().padStart(cfg.digits, "0");
}

export function totpNow(cfg: OtpConfig): Promise<string> {
  return totpAt(cfg, Math.floor(Date.now() / 1000));
}

/** 当前口令还剩几秒，便于在日志里提示“验证码快过期” */
export function secondsLeft(cfg: OtpConfig, now = Date.now()): number {
  return cfg.period - (Math.floor(now / 1000) % cfg.period);
}
