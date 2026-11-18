/**
 * 会话与证书的生命周期管理（按 Certum 凭据隔离）。
 *
 * 每套凭据（邮箱 + TOTP 种子 + 证书指纹）自己有一条会话和一份证书缓存：
 *   certum:sess:<credId>   30 分钟 token
 *   certum:card:<credId>   12 小时证书
 * 多个用户共用同一套凭据时也会命中同一份缓存，不会重复跑 OTP 登录。
 */
import type { CardCache, CertumSession, CredentialRecord, Env, SignAlgorithm } from "../types";
import { CertumApi, type CardCertificate } from "./api";
import { resolveEndpoints, type CertumEndpoints } from "./config";
import { CertumError } from "./errors";
import { loginWithOtp, refreshToken } from "./login";
import { credentialOtp, CRED_CARD_PREFIX, CRED_SESSION_PREFIX } from "../store/credentials.ts";
import { readConfig } from "../store/config.ts";
import { pemToDer, splitPemChain } from "../lib/pem";
import { normalizeHex, sha1Hex, sha256Hex } from "../lib/encoding";

const SESSION_SKEW_MS = 120_000;
const CARD_TTL_MS = 12 * 60 * 60 * 1000;

const memorySessions = new Map<string, CertumSession>();
const pendingLogins = new Map<string, Promise<CertumSession>>();

/** API 根地址来自 KV 配置（后台可改），客户端常量仍用环境变量兜底 */
async function endpointsFor(env: Env): Promise<CertumEndpoints> {
  const config = await readConfig(env);
  return resolveEndpoints({
    apiBase: config.certumApiBase,
    clientId: env.CERTUM_CLIENT_ID,
    clientSecret: env.CERTUM_CLIENT_SECRET,
  });
}

function sessionKey(cred: CredentialRecord): string {
  return `${CRED_SESSION_PREFIX}${cred.id}`;
}

function cardKey(cred: CredentialRecord): string {
  return `${CRED_CARD_PREFIX}${cred.id}`;
}

function requireEnabled(cred: CredentialRecord): void {
  if (!cred.enabled) {
    throw new CertumError("credential_disabled", `凭据「${cred.label}」已停用`, 403);
  }
}

async function saveSession(env: Env, cred: CredentialRecord, session: CertumSession): Promise<void> {
  memorySessions.set(cred.id, session);
  const ttl = Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000));
  await env.CERTUM_KV.put(sessionKey(cred), JSON.stringify(session), { expirationTtl: ttl });
}

async function loginFresh(env: Env, cred: CredentialRecord): Promise<CertumSession> {
  requireEnabled(cred);
  const endpoints = await endpointsFor(env);
  const otp = credentialOtp(cred);
  const result = await loginWithOtp(endpoints, cred.email.trim(), otp, 3);
  const now = Date.now();
  const session: CertumSession = {
    token: result.token,
    refreshToken: result.refreshToken,
    expiresAt: now + Math.max(300, result.expiresIn - 60) * 1000,
    email: cred.email,
    createdAt: now,
    refreshedAt: now,
  };
  await saveSession(env, cred, session);
  return session;
}

/** 拿一个可用会话：内存 → KV → refresh_token → 完整 OTP 登录 */
export async function getSessionFor(
  env: Env,
  cred: CredentialRecord,
  options: { force?: boolean } = {},
): Promise<CertumSession> {
  requireEnabled(cred);

  if (!options.force) {
    const cachedMemory = memorySessions.get(cred.id);
    if (cachedMemory && cachedMemory.expiresAt - Date.now() > SESSION_SKEW_MS) return cachedMemory;

    const cached = await env.CERTUM_KV.get<CertumSession>(sessionKey(cred), "json");
    if (cached && cached.expiresAt - Date.now() > SESSION_SKEW_MS) {
      memorySessions.set(cred.id, cached);
      return cached;
    }

    if (cached?.refreshToken) {
      const refreshed = await refreshToken(await endpointsFor(env), cached.refreshToken);
      if (refreshed) {
        const now = Date.now();
        const session: CertumSession = {
          token: refreshed.token,
          refreshToken: refreshed.refreshToken,
          expiresAt: now + Math.max(300, refreshed.expiresIn - 60) * 1000,
          email: cached.email,
          createdAt: cached.createdAt,
          refreshedAt: now,
        };
        await saveSession(env, cred, session);
        return session;
      }
    }
  }

  // 并发去重：同一套凭据同时来 10 个签名，也只跑一次登录
  let pending = pendingLogins.get(cred.id);
  if (!pending) {
    pending = loginFresh(env, cred).finally(() => {
      pendingLogins.delete(cred.id);
    });
    pendingLogins.set(cred.id, pending);
  }
  return pending;
}

export async function invalidateSessionFor(env: Env, cred: CredentialRecord): Promise<void> {
  memorySessions.delete(cred.id);
  await env.CERTUM_KV.delete(sessionKey(cred));
}

/** 只读缓存，不发网络请求（后台页面用） */
export async function peekSession(env: Env, cred: CredentialRecord): Promise<CertumSession | null> {
  const cached = memorySessions.get(cred.id) ?? (await env.CERTUM_KV.get<CertumSession>(sessionKey(cred), "json"));
  if (!cached || cached.expiresAt <= Date.now()) return null;
  return cached;
}

export async function peekCard(env: Env, cred: CredentialRecord): Promise<CardCache | null> {
  const cached = await env.CERTUM_KV.get<CardCache>(cardKey(cred), "json");
  if (!cached || Date.now() - cached.fetchedAt > CARD_TTL_MS) return null;
  return cached;
}

/** 拉卡片 + 证书，结果缓存到 KV */
export async function refreshCardFor(env: Env, cred: CredentialRecord): Promise<CardCache> {
  const session = await getSessionFor(env, cred);
  const api = new CertumApi(await endpointsFor(env), session.token);

  const cards = await api.listCards();
  if (cards.length === 0) throw new CertumError("no_card", "账号下没有可用的云签名卡片", 404);

  const wanted = normalizeHex(cred.certificateSha1 ?? "");
  let card = cards[0]!;
  let certificate: CardCertificate | null = null;
  let fingerprint1 = "";

  if (wanted) {
    const seen: string[] = [];
    for (const candidate of cards) {
      const current = await api.fetchCertificate(candidate.serial);
      const currentDer = pemToDer(current.pem);
      if (!currentDer) continue;
      const fingerprint = await sha1Hex(currentDer);
      seen.push(`${candidate.serial}=${fingerprint}`);
      if (fingerprint === wanted) {
        card = candidate;
        certificate = current;
        fingerprint1 = fingerprint;
        break;
      }
    }
    if (!certificate) {
      throw new CertumError(
        "certificate_not_found",
        `账号下没有 SHA-1 为 ${wanted} 的证书（卡片：${seen.join(", ") || "证书均无法解析"}）`,
        404,
      );
    }
  } else {
    certificate = await api.fetchCertificate(card.serial);
  }

  const der = pemToDer(certificate.pem);
  if (!der) throw new CertumError("bad_certificate", "云端返回的证书无法解析", 502);
  if (!fingerprint1) fingerprint1 = await sha1Hex(der);

  const cache: CardCache = {
    serial: card.serial,
    certificatePem: certificate.pem,
    certificateRawB64: bytesToBase64(certificate.raw),
    fingerprint1,
    fingerprint256: await sha256Hex(der),
    fetchedAt: Date.now(),
  };
  await env.CERTUM_KV.put(cardKey(cred), JSON.stringify(cache), { expirationTtl: 24 * 60 * 60 });
  cred.lastUsedAt = Date.now();
  cred.lastError = undefined;
  await env.CERTUM_KV.put(`cred:${cred.id}`, JSON.stringify(cred));
  return cache;
}

export async function getCardFor(
  env: Env,
  cred: CredentialRecord,
  options: { force?: boolean } = {},
): Promise<CardCache> {
  if (!options.force) {
    const cached = await peekCard(env, cred);
    if (cached) return cached;
  }
  return refreshCardFor(env, cred);
}

export async function chainPem(env: Env): Promise<string[]> {
  const config = await readConfig(env);
  return splitPemChain(config.certumChainPem);
}

/**
 * 对一组摘要求签名。
 * 会话失效（云端 401）时自动重新登录并重试一次。
 */
export async function signDigestsFor(
  env: Env,
  cred: CredentialRecord,
  digests: string[],
  algorithm: SignAlgorithm,
): Promise<{ signatures: string[]; card: CardCache }> {
  const cache = await getCardFor(env, cred);
  const endpoints = await endpointsFor(env);

  const attempt = async (force: boolean): Promise<string[]> => {
    const session = await getSessionFor(env, cred, { force });
    const api = new CertumApi(endpoints, session.token);
    return api.signDigests(cache.serial, base64ToBytes(cache.certificateRawB64), digests, algorithm);
  };

  try {
    return { signatures: await attempt(false), card: cache };
  } catch (error) {
    if (error instanceof CertumError && error.code === "unauthorized") {
      await invalidateSessionFor(env, cred);
      return { signatures: await attempt(true), card: cache };
    }
    throw error;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
