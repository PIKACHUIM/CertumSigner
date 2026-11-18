/**
 * 对外签名 API。
 *
 *   POST /v1/sign         { hash | hashes, algorithm, encoding }
 *   GET  /v1/certificate  签名证书 + 可选证书链
 *   GET  /v1/whoami       当前 Key 的身份与额度
 *   POST /v1/timestamp    RFC3161 时间戳代理（客户端出网被拦时走这里）
 *
 * 鉴权：Authorization: Bearer csk_xxx（也接受 X-Api-Key，方便一些 CI 插件）。
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiKeyRecord, CredentialRecord, Env, SignAlgorithm, SignLogRecord } from "../types";
import { CertumError } from "../certum/errors";
import { chainPem, getCardFor, signDigestsFor } from "../certum/session";
import { base64Decode } from "../lib/pem";
import { normalizeHex, randomId, toHex } from "../lib/encoding";
import { bumpDailyUsage, bumpUserDailyUsage, getDailyUsage, getUserDailyUsage, touchApiKey, verifyApiKey } from "../store/keys";
import { getCredential } from "../store/credentials";
import { getUser } from "../store/users";
import { readStats, recordSign } from "../store/stats";
import { readConfig } from "../store/config.ts";

export type AppEnv = {
  Bindings: Env;
  Variables: { apiKey: ApiKeyRecord; credential: CredentialRecord };
};

const MAX_DIGESTS = 16;

export const v1 = new Hono<AppEnv>();

function jsonError(c: Context<AppEnv>, status: number, code: string, message: string) {
  return c.json({ ok: false, error: { code, message } }, status as ContentfulStatusCode);
}

/** 提取并校验 Key */
v1.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") return next();

  const header = c.req.header("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  const raw = bearer || c.req.header("x-api-key")?.trim() || "";
  if (!raw) {
    return c.json({ ok: false, error: { code: "unauthorized", message: "缺少 API Key（Authorization: Bearer csk_…）" } }, 401);
  }

  const record = await verifyApiKey(c.env, raw);
  if (!record) {
    return c.json({ ok: false, error: { code: "unauthorized", message: "API Key 无效、已停用或已过期" } }, 401);
  }

  // 每把 Key 绑定一套 Certum 凭据，没有兜底
  const credential = await getCredential(c.env, record.credentialId);
  if (!credential) {
    return c.json(
      { ok: false, error: { code: "credential_missing", message: "该 Key 没有绑定可用的 Certum 凭据，请联系管理员" } },
      403,
    );
  }
  if (!credential.enabled) {
    return c.json(
      { ok: false, error: { code: "credential_disabled", message: `凭据「${credential.label}」已停用` } },
      403,
    );
  }

  c.set("apiKey", record);
  c.set("credential", credential);
  await next();
});

interface SignBody {
  hash?: string;
  hashes?: string[];
  algorithm?: string;
  encoding?: string;
}

function normalizeAlgorithm(raw: string | undefined): SignAlgorithm {
  const value = (raw ?? "sha256").toLowerCase().replace(/[-_]/g, "");
  if (value === "sha1") return "sha1";
  if (value === "sha256") return "sha256";
  if (value === "sha384") return "sha384";
  if (value === "sha512") return "sha512";
  throw new CertumError("bad_algorithm", `不支持的摘要算法: ${raw}（支持 sha1 / sha256 / sha384 / sha512）`, 400);
}

const DIGEST_HEX_LENGTH: Record<SignAlgorithm, number> = { sha1: 40, sha256: 64, sha384: 96, sha512: 128 };

/** 记日志用：算法非法时退回 sha256，别让日志本身抛错 */
function safeAlgorithm(raw: string | undefined): SignAlgorithm {
  try {
    return normalizeAlgorithm(raw);
  } catch {
    return "sha256";
  }
}

function normalizeDigests(input: string[], encoding: string, algorithm: SignAlgorithm): string[] {
  const expected = DIGEST_HEX_LENGTH[algorithm];
  return input.map((item, index) => {
    const trimmed = item.trim();
    if (!trimmed) throw new CertumError("bad_hash", `第 ${index + 1} 个摘要为空`, 400);

    let hex: string;
    if (encoding === "base64") {
      try {
        hex = toHex(base64Decode(trimmed));
      } catch {
        throw new CertumError("bad_hash", `第 ${index + 1} 个摘要不是合法 base64`, 400);
      }
    } else {
      hex = normalizeHex(trimmed);
    }

    if (hex.length !== expected) {
      throw new CertumError(
        "bad_hash",
        `第 ${index + 1} 个摘要长度 ${hex.length}，${algorithm.toUpperCase()} 要求 ${expected} 位十六进制`,
        400,
      );
    }
    return hex;
  });
}

v1.post("/sign", async (c) => {
  const started = Date.now();
  const key = c.get("apiKey") as ApiKeyRecord;
  const credential = c.get("credential") as CredentialRecord;

  let body: SignBody;
  try {
    body = (await c.req.json()) as SignBody;
  } catch {
    return jsonError(c, 400, "bad_json", "请求体必须是 JSON");
  }

  try {
    const algorithm = normalizeAlgorithm(body.algorithm);
    const encoding = (body.encoding ?? "hex").toLowerCase();
    if (encoding !== "hex" && encoding !== "base64") {
      return jsonError(c, 400, "bad_encoding", "encoding 只能是 hex 或 base64");
    }

    const rawList = body.hashes ?? (body.hash ? [body.hash] : []);
    if (!Array.isArray(rawList) || rawList.length === 0) {
      return jsonError(c, 400, "bad_request", "缺少 hash（或 hashes 数组）");
    }
    if (rawList.length > MAX_DIGESTS) {
      return jsonError(c, 400, "too_many", `一次最多 ${MAX_DIGESTS} 个摘要`);
    }

    const digests = normalizeDigests(rawList, encoding, algorithm);

    if (key.dailyQuota > 0) {
      const used = await getDailyUsage(c.env, key.id);
      if (used + digests.length > key.dailyQuota) {
        return jsonError(c, 429, "quota_exceeded", `已超出今日限额（${used}/${key.dailyQuota}）`);
      }
    }

    // 用户级额度：该用户名下所有 Key 共用，0 = 不限
    if (key.userId) {
      const owner = await getUser(c.env, key.userId);
      if (owner && owner.dailyQuota > 0) {
        const used = await getUserDailyUsage(c.env, key.userId);
        if (used + digests.length > owner.dailyQuota) {
          return jsonError(
            c,
            429,
            "quota_exceeded",
            `已超出账号今日限额（${used}/${owner.dailyQuota}）`,
          );
        }
      }
    }

    const { signatures, card } = await signDigestsFor(c.env, credential, digests, algorithm);
    const duration = Date.now() - started;

    const log: SignLogRecord = {
      id: randomId(),
      at: started,
      keyId: key.id,
      keyName: key.name,
      algorithm,
      digestPrefix: digests[0]!.slice(0, 16),
      count: digests.length,
      ok: true,
      durationMs: duration,
      ip: c.req.header("cf-connecting-ip") ?? "unknown",
      userAgent: (c.req.header("user-agent") ?? "").slice(0, 120),
      userId: key.userId,
      credentialId: credential.id,
    };

    c.executionCtx.waitUntil(
      (async () => {
        await recordSign(c.env, { record: log, algorithm, ok: true, count: digests.length });
        await touchApiKey(c.env, key, digests.length);
        await bumpDailyUsage(c.env, key.id, digests.length);
        if (key.userId) await bumpUserDailyUsage(c.env, key.userId, digests.length);
      })(),
    );

    return c.json({
      ok: true,
      algorithm,
      signatures: signatures.map((sig) => sig.toLowerCase()),
      certificate: {
        pem: card.certificatePem,
        chain: await chainPem(c.env),
        serial: card.serial,
        fingerprint1: card.fingerprint1 ?? null,
        fingerprint256: card.fingerprint256,
      },
      meta: {
        keyId: key.id,
        keyName: key.name,
        credentialId: credential.id,
        credentialLabel: credential.label,
        count: digests.length,
        durationMs: duration,
        requestId: log.id,
      },
    });
  } catch (error) {
    const duration = Date.now() - started;
    const certumError = error instanceof CertumError ? error : null;
    const status = certumError?.status ?? 500;
    const code = certumError?.code ?? "internal_error";
    const message = certumError?.message ?? `内部错误：${String(error)}`;

    const log: SignLogRecord = {
      id: randomId(),
      at: started,
      keyId: key.id,
      keyName: key.name,
      algorithm: safeAlgorithm(body.algorithm),
      digestPrefix: (body.hash ?? body.hashes?.[0] ?? "").slice(0, 16),
      count: body.hashes?.length ?? (body.hash ? 1 : 0),
      ok: false,
      durationMs: duration,
      ip: c.req.header("cf-connecting-ip") ?? "unknown",
      userAgent: (c.req.header("user-agent") ?? "").slice(0, 120),
      error: `${code}: ${message}`.slice(0, 240),
      userId: key.userId,
      credentialId: credential.id,
    };
    c.executionCtx.waitUntil(recordSign(c.env, { record: log, algorithm: log.algorithm, ok: false, count: 0 }));

    return c.json({ ok: false, error: { code, message } }, status as ContentfulStatusCode);
  }
});

v1.get("/certificate", async (c) => {
  const credential = c.get("credential") as CredentialRecord;
  try {
    const card = await getCardFor(c.env, credential);
    return c.json({
      ok: true,
      certificate: {
        pem: card.certificatePem,
        chain: await chainPem(c.env),
        serial: card.serial,
        fingerprint1: card.fingerprint1 ?? null,
        fingerprint256: card.fingerprint256,
        fetchedAt: card.fetchedAt,
      },
      credential: { id: credential.id, label: credential.label },
    });
  } catch (error) {
    const certumError = error instanceof CertumError ? error : null;
    return c.json(
      {
        ok: false,
        error: {
          code: certumError?.code ?? "internal_error",
          message: certumError?.message ?? `拉取证书失败：${String(error)}`,
        },
      },
      (certumError?.status ?? 500) as ContentfulStatusCode,
    );
  }
});

v1.get("/whoami", async (c) => {
  const key = c.get("apiKey") as ApiKeyRecord;
  const credential = c.get("credential") as CredentialRecord;
  const used = await getDailyUsage(c.env, key.id);
  const owner = key.userId ? await getUser(c.env, key.userId) : null;
  const userUsed = key.userId ? await getUserDailyUsage(c.env, key.userId) : 0;
  return c.json({
    ok: true,
    key: {
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      dailyQuota: key.dailyQuota,
      usedToday: used,
      totalSigns: key.totalSigns,
      expiresAt: key.expiresAt ?? null,
      userId: key.userId ?? null,
    },
    user: owner
      ? { id: owner.id, username: owner.username, dailyQuota: owner.dailyQuota, usedToday: userUsed }
      : null,
    credential: {
      id: credential.id,
      label: credential.label,
      email: credential.email,
      certificateSha1: credential.certificateSha1 ?? null,
    },
  });
});

v1.get("/stats", async (c) => {
  const key = c.get("apiKey") as ApiKeyRecord;
  const stats = await readStats(c.env, 7);
  const used = await getDailyUsage(c.env, key.id);
  const owner = key.userId ? await getUser(c.env, key.userId) : null;
  const userUsed = key.userId ? await getUserDailyUsage(c.env, key.userId) : 0;
  return c.json({
    ok: true,
    key: { id: key.id, name: key.name, dailyQuota: key.dailyQuota, usedToday: used, totalSigns: key.totalSigns },
    user: owner
      ? { id: owner.id, username: owner.username, dailyQuota: owner.dailyQuota, usedToday: userUsed }
      : null,
    today: stats.today,
    total: stats.total,
  });
});

/**
 * RFC3161 时间戳代理：把 TSQ 原样转发给上游 TSA，再把 TSR 原样返回。
 *
 * 存在的理由：企业网里的安全软件（实测腾讯 iOA）会拦未签名程序的出网请求，
 * 返回 403 +「检测到风险软件的网络连接」，但客户端到 Worker 的连接是通的。
 */
v1.post("/timestamp", async (c) => {
  const query = await c.req.arrayBuffer();
  if (query.byteLength === 0 || query.byteLength > 64 * 1024) {
    return jsonError(c, 400, "bad_timestamp_query", "时间戳请求为空或超过 64 KB");
  }

  const upstream = (await readConfig(c.env)).tsaUpstream;
  let response: Response;
  try {
    response = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/timestamp-query", accept: "application/timestamp-reply" },
      body: query,
    });
  } catch (error) {
    return jsonError(c, 502, "timestamp_upstream_failed", `连不上时间戳服务 ${upstream}：${String(error)}`);
  }

  if (!response.ok) {
    const status = response.status >= 400 && response.status < 600 ? response.status : 502;
    return jsonError(c, status, "timestamp_upstream_rejected", `时间戳服务 ${upstream} 返回 HTTP ${response.status}`);
  }

  return new Response(await response.arrayBuffer(), {
    status: 200,
    headers: { "content-type": "application/timestamp-reply" },
  });
});
