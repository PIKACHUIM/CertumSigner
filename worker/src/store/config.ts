/**
 * 运行时配置：能在后台改的都放 KV（`settings:config`），环境变量只作为回退。
 *
 * 这样部署时不用把基础地址、TSA、发件人、证书链塞进 wrangler.jsonc，
 * 改完保存即可生效；老部署里已有的环境变量仍然会被读到。
 */
import type { Env } from "../types";
import { DEFAULT_API_BASE } from "../certum/config.ts";

const CONFIG_KEY = "settings:config";

export const DEFAULT_TSA_UPSTREAM = "http://time.certum.pl/";

export interface RuntimeConfig {
  /** 对外基础地址，邮件里的绝对链接用；空 = 按本次请求的 Origin 推导 */
  publicBaseUrl: string;
  /** Certum 云签名 API 根地址 */
  certumApiBase: string;
  /** 额外中间证书（PEM，多张用换行分隔） */
  certumChainPem: string;
  /** 发件人，例如 "CertumSigner <noreply@example.com>"；API Key 仍是 secret */
  resendFrom: string;
  /** /v1/timestamp 转发的 RFC3161 服务 */
  tsaUpstream: string;
  /** 是否记录签名明细日志（关掉只留统计） */
  logSignatures: boolean;
  updatedAt?: number;
}

type StoredConfig = Partial<Omit<RuntimeConfig, "updatedAt">> & { updatedAt?: number };

function text(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = (value ?? "").trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/** KV 里存了就用存储值，否则退回环境变量，再否则用默认值 */
export async function readConfig(env: Env): Promise<RuntimeConfig> {
  const stored = (await env.CERTUM_KV.get<StoredConfig>(CONFIG_KEY, "json")) ?? {};
  return {
    publicBaseUrl: text(stored.publicBaseUrl, env.PUBLIC_BASE_URL).replace(/\/+$/, ""),
    certumApiBase: (text(stored.certumApiBase, env.CERTUM_API_BASE) || DEFAULT_API_BASE).replace(/\/+$/, ""),
    certumChainPem: text(stored.certumChainPem, env.CERTUM_CHAIN_PEM),
    resendFrom: text(stored.resendFrom, env.RESEND_FROM),
    tsaUpstream: (text(stored.tsaUpstream, env.TSA_UPSTREAM) || DEFAULT_TSA_UPSTREAM).replace(/\/+$/, ""),
    logSignatures:
      typeof stored.logSignatures === "boolean" ? stored.logSignatures : env.LOG_SIGNATURES !== "0",
    updatedAt: stored.updatedAt,
  };
}

/** 只写 KV，字段按 patch 覆盖；空字符串表示「清掉，回到默认/环境变量」 */
export async function writeConfig(env: Env, patch: Partial<Omit<RuntimeConfig, "updatedAt">>): Promise<RuntimeConfig> {
  const stored = (await env.CERTUM_KV.get<StoredConfig>(CONFIG_KEY, "json")) ?? {};
  const next: StoredConfig = { ...stored, ...patch, updatedAt: Date.now() };
  // 空值不必落盘，交给默认值/环境变量兜底
  for (const key of ["publicBaseUrl", "certumApiBase", "certumChainPem", "resendFrom", "tsaUpstream"] as const) {
    if (typeof next[key] === "string" && !next[key]!.trim()) delete next[key];
  }
  await env.CERTUM_KV.put(CONFIG_KEY, JSON.stringify(next));
  return readConfig(env);
}
