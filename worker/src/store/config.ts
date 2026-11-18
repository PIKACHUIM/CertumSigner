/**
 * 运行时配置：全部存在 KV（`settings:config`），后台「系统设置 → 服务与地址」改。
 * 部署时不用把基础地址、TSA、发件人、证书链塞进 wrangler.jsonc，保存即生效。
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
  /** Resend API Key，存在 KV，后台「服务与地址」里填 */
  resendApiKey: string;
  /** 发件人，例如 "CertumSigner <noreply@example.com>" */
  resendFrom: string;
  /** Turnstile 站点密钥（公开，渲染到登录页） */
  turnstileSiteKey: string;
  /** Turnstile 服务端密钥（不回传浏览器） */
  turnstileSecretKey: string;
  /** /v1/timestamp 转发的 RFC3161 服务 */
  tsaUpstream: string;
  /** 是否记录签名明细日志（关掉只留统计） */
  logSignatures: boolean;
  updatedAt?: number;
}

type StoredConfig = Partial<Omit<RuntimeConfig, "updatedAt">> & { updatedAt?: number };

function text(value?: string): string {
  return (value ?? "").trim();
}

/** KV 里的值优先，缺失时用默认值 */
export async function readConfig(env: Env): Promise<RuntimeConfig> {
  const stored = (await env.CERTUM_KV.get<StoredConfig>(CONFIG_KEY, "json")) ?? {};
  return {
    publicBaseUrl: text(stored.publicBaseUrl).replace(/\/+$/, ""),
    certumApiBase: (text(stored.certumApiBase) || DEFAULT_API_BASE).replace(/\/+$/, ""),
    certumChainPem: text(stored.certumChainPem),
    resendApiKey: text(stored.resendApiKey),
    resendFrom: text(stored.resendFrom),
    turnstileSiteKey: text(stored.turnstileSiteKey),
    turnstileSecretKey: text(stored.turnstileSecretKey),
    tsaUpstream: (text(stored.tsaUpstream) || DEFAULT_TSA_UPSTREAM).replace(/\/+$/, ""),
    logSignatures: typeof stored.logSignatures === "boolean" ? stored.logSignatures : true,
    updatedAt: stored.updatedAt,
  };
}

/** 只写 KV，字段按 patch 覆盖；空字符串表示「清掉，回到默认/环境变量」 */
export async function writeConfig(env: Env, patch: Partial<Omit<RuntimeConfig, "updatedAt">>): Promise<RuntimeConfig> {
  const stored = (await env.CERTUM_KV.get<StoredConfig>(CONFIG_KEY, "json")) ?? {};
  const next: StoredConfig = { ...stored, ...patch, updatedAt: Date.now() };
  // 空值不必落盘，交给默认值兜底
  for (const key of [
    "publicBaseUrl",
    "certumApiBase",
    "certumChainPem",
    "resendApiKey",
    "resendFrom",
    "turnstileSiteKey",
    "turnstileSecretKey",
    "tsaUpstream",
  ] as const) {
    if (typeof next[key] === "string" && !next[key]!.trim()) delete next[key];
  }
  await env.CERTUM_KV.put(CONFIG_KEY, JSON.stringify(next));
  return readConfig(env);
}
