/**
 * Certum 凭据（邮箱 + TOTP 种子 + 证书指纹）存 KV。
 *
 * 这是敏感数据：拿到 otpUri 就能登录对应 Certum 账号并调用云端 HSM 签名。
 * KV 在 Cloudflare 侧是静态加密的，但任何能读这个 namespace 的代码/令牌都能拿到明文，
 * 所以生产环境请收紧 API Token 权限（只给这个 namespace 的 KV 读写）。
 */
import type { CredentialRecord, Env, ScanMode } from "../types";
import { randomToken } from "../lib/encoding.ts";
import { base32Decode, parseOtpUri, resolveOtpConfig, type OtpConfig } from "../lib/totp.ts";

const PREFIX = "cred:";
export const CRED_SESSION_PREFIX = "certum:sess:";
export const CRED_CARD_PREFIX = "certum:card:";

const SCAN_MODES: readonly ScanMode[] = ["off", "manual", "auto"];

export function normalizeScanMode(value: unknown): ScanMode {
  return SCAN_MODES.includes(value as ScanMode) ? (value as ScanMode) : "off";
}

export function clampScanRisk(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(100, Math.max(0, Math.floor(number)));
}

export interface CreateCredentialInput {
  label: string;
  email: string;
  /** otpauth:// URI 或裸 Base32 种子 */
  otp: string;
  certificateSha1?: string;
  scanMode?: ScanMode;
  scanMaxRisk?: number;
  createdBy: string;
}

/** 统一成 otpauth:// URI；裸种子补上 Certum 默认参数 */
export function normalizeOtpInput(input: string, email: string): string {
  const text = input.trim();
  if (!text) throw new Error("OTP 种子不能为空");

  if (/^otpauth:\/\//i.test(text)) {
    const parsed = parseOtpUri(text);
    base32Decode(parsed.secret!);
    return text;
  }

  const secret = text.replace(/[\s-]/g, "").replace(/=+$/, "").toUpperCase();
  if (!/^[A-Z2-7]+$/.test(secret)) throw new Error("OTP 种子只能是 Base32 字符（A-Z、2-7）");
  base32Decode(secret);
  const label = encodeURIComponent(`Certum:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Certum&algorithm=SHA256&digits=6&period=30`;
}

/** 列表里只展示非敏感参数，种子用 **** 代替 */
export function maskOtpUri(uri: string): string {
  try {
    const parsed = parseOtpUri(uri);
    const params = new URLSearchParams(uri.slice(uri.indexOf("?") + 1));
    const algorithm = params.get("algorithm") ?? "SHA1";
    const digits = params.get("digits") ?? "6";
    const period = params.get("period") ?? "30";
    return `secret ****${parsed.secret!.slice(-4)} · ${algorithm} · ${digits} 位 · ${period}s`;
  } catch {
    return "无法解析";
  }
}

export function credentialOtp(cred: CredentialRecord): OtpConfig {
  return resolveOtpConfig({ uri: cred.otpUri });
}

export async function createCredential(env: Env, input: CreateCredentialInput): Promise<CredentialRecord> {
  const label = input.label.trim() || input.email.trim();
  const email = input.email.trim();
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error("邮箱格式不正确");

  const otpUri = normalizeOtpInput(input.otp, email);
  const record: CredentialRecord = {
    id: `cred_${randomToken(8).replace(/[^A-Za-z0-9]/g, "").slice(0, 12)}`,
    label: label.slice(0, 60),
    email,
    otpUri,
    certificateSha1: normalizeSha1(input.certificateSha1),
    scanMode: normalizeScanMode(input.scanMode),
    scanMaxRisk: clampScanRisk(input.scanMaxRisk),
    enabled: true,
    createdAt: Date.now(),
    createdBy: input.createdBy,
  };
  await env.CERTUM_KV.put(`${PREFIX}${record.id}`, JSON.stringify(record));
  return record;
}

function normalizeSha1(raw: string | undefined): string | undefined {
  const clean = (raw ?? "").replace(/[\s:]/g, "").toLowerCase();
  if (!clean) return undefined;
  if (!/^[0-9a-f]{40}$/.test(clean)) throw new Error("证书 SHA-1 必须是 40 位十六进制");
  return clean;
}

/**
 * 这次修改要不要扔掉已缓存的 Certum 会话 / 证书卡片。
 *
 * 改了登录邮箱或 TOTP 种子 = 换了另一个 Certum 账号，旧会话仍会以老账号身份签名；
 * 换了证书指纹 = 旧卡片缓存指向另一张证书。两种情况都必须让缓存立刻失效，
 * 否则管理员改完设置后签名结果还是旧的。
 */
export function credentialCacheImpact(
  existing: Pick<CredentialRecord, "email" | "certificateSha1">,
  patch: { email?: string; otp?: string; certificateSha1?: string },
): { session: boolean; card: boolean } {
  const emailChanged =
    patch.email !== undefined && !!patch.email.trim() && patch.email.trim().toLowerCase() !== existing.email.toLowerCase();
  const session = emailChanged || !!patch.otp?.trim();

  let certChanged = false;
  if (patch.certificateSha1 !== undefined) {
    try {
      certChanged = normalizeSha1(patch.certificateSha1) !== existing.certificateSha1;
    } catch {
      // 非法指纹会在 updateCredential 里报错，这里不必重复处理
      certChanged = false;
    }
  }
  return { session, card: session || certChanged };
}

export async function listCredentials(env: Env): Promise<CredentialRecord[]> {
  const list = await env.CERTUM_KV.list({ prefix: PREFIX, limit: 1000 });
  const records: CredentialRecord[] = [];
  for (const item of list.keys) {
    const record = await env.CERTUM_KV.get<CredentialRecord>(item.name, "json");
    if (record) records.push(record);
  }
  return records.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getCredential(env: Env, id: string): Promise<CredentialRecord | null> {
  if (!id) return null;
  return env.CERTUM_KV.get<CredentialRecord>(`${PREFIX}${id}`, "json");
}

export async function saveCredential(env: Env, record: CredentialRecord): Promise<void> {
  await env.CERTUM_KV.put(`${PREFIX}${record.id}`, JSON.stringify(record));
}

export async function setCredentialEnabled(env: Env, id: string, enabled: boolean): Promise<boolean> {
  const record = await getCredential(env, id);
  if (!record) return false;
  record.enabled = enabled;
  await saveCredential(env, record);
  return true;
}

export async function updateCredential(
  env: Env,
  id: string,
  patch: {
    label?: string;
    email?: string;
    otp?: string;
    certificateSha1?: string;
    scanMode?: ScanMode;
    scanMaxRisk?: number;
  },
): Promise<boolean> {
  const record = await getCredential(env, id);
  if (!record) return false;
  if (patch.label !== undefined) record.label = patch.label.trim().slice(0, 60) || record.label;
  if (patch.email !== undefined && patch.email.trim()) record.email = patch.email.trim();
  if (patch.otp !== undefined && patch.otp.trim()) {
    record.otpUri = normalizeOtpInput(patch.otp, record.email);
  }
  if (patch.certificateSha1 !== undefined) record.certificateSha1 = normalizeSha1(patch.certificateSha1);
  if (patch.scanMode !== undefined) record.scanMode = normalizeScanMode(patch.scanMode);
  if (patch.scanMaxRisk !== undefined) record.scanMaxRisk = clampScanRisk(patch.scanMaxRisk);
  record.lastError = undefined;
  await saveCredential(env, record);
  return true;
}

export async function deleteCredential(env: Env, id: string): Promise<boolean> {
  const record = await getCredential(env, id);
  if (!record) return false;
  await Promise.all([
    env.CERTUM_KV.delete(`${PREFIX}${id}`),
    env.CERTUM_KV.delete(`${CRED_SESSION_PREFIX}${id}`),
    env.CERTUM_KV.delete(`${CRED_CARD_PREFIX}${id}`),
  ]);
  return true;
}

