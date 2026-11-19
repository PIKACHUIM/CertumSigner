/**
 * 病毒查杀：按原始文件 SHA-256 查询 / 上传，结果缓存在 KV。
 *
 * 为什么按原始文件而不是 Authenticode 摘要：
 * VirusTotal / MetaDefender 的库按文件内容建索引，客户端签名前本来就要读一遍文件，
 * 顺手算一个普通 SHA-256 成本很低，也能在 /v1/sign 里作为「这个文件扫过」的凭据。
 *
 * 内置两个 provider：
 *   - virustotal   免费公共 API：4 次/分钟、500 次/天，直传上限 32 MB
 *   - metadefender 社区免费版：hash 查询 1000 次/天、扫描 150 次/天，文件上限 750 MB
 * Cloudmersive 免费版只有 600 次/月、3.5 MB 且不支持按 hash 查询，暂不内置。
 */
import type { CredentialRecord, Env, ScanMode, ScanProviderId, ScanVerdict } from "../types";
import type { RuntimeConfig } from "../store/config";
import { sha256Hex } from "../lib/encoding.ts";

export interface ScanPolicy {
  mode: ScanMode;
  /** 允许签名的最大风险 = malicious + suspicious；0 表示必须全绿 */
  maxRisk: number;
}

export interface ScanSettings {
  provider: ScanProviderId;
  apiKey: string;
  baseUrl: string;
  maxUploadMb: number;
  cacheMinutes: number;
}

export interface ScanAnalysisState {
  provider: ScanProviderId;
  sha256: string;
  done: boolean;
  verdict?: ScanVerdict;
  /** 上次真正请求 provider 的时间，用来节流免费配额 */
  checkedAt: number;
  createdAt: number;
}

export class ScanError extends Error {
  code: string;
  status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ScanError";
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_BASE: Record<ScanProviderId, string> = {
  virustotal: "https://www.virustotal.com/api/v3",
  metadefender: "https://api.metadefender.com/v4",
};

const VERDICT_PREFIX = "scan:verdict:";
const MISS_PREFIX = "scan:miss:";
const ANALYSIS_PREFIX = "scan:analysis:";
const MISS_TTL = 60;
const ANALYSIS_TTL = 60 * 60;
/** 免费配额很紧，轮询结果至少间隔 10 秒才回源 */
const POLL_INTERVAL_MS = 10_000;

export function readScanSettings(config: RuntimeConfig): ScanSettings {
  return {
    provider: config.scanProvider,
    apiKey: config.scanApiKey,
    baseUrl: (config.scanBaseUrl || DEFAULT_BASE[config.scanProvider]).replace(/\/+$/, ""),
    maxUploadMb: config.scanMaxUploadMb,
    cacheMinutes: config.scanCacheMinutes,
  };
}

export function isScanConfigured(settings: ScanSettings): boolean {
  return !!settings.apiKey;
}

export function scanPolicyOf(credential: CredentialRecord): ScanPolicy {
  return {
    mode: credential.scanMode === "manual" || credential.scanMode === "auto" ? credential.scanMode : "off",
    maxRisk: Number.isFinite(credential.scanMaxRisk) ? Math.max(0, Math.floor(credential.scanMaxRisk!)) : 0,
  };
}

/** 风险等级 = 恶意引擎数 + 可疑引擎数；不同 provider 的字段差异在这里抹平 */
export function riskScore(verdict: ScanVerdict): number {
  return verdict.malicious + verdict.suspicious;
}

export function evaluateVerdict(verdict: ScanVerdict, maxRisk: number): { risk: number; allowed: boolean } {
  const risk = riskScore(verdict);
  return { risk, allowed: risk <= maxRisk };
}

export function scanUploadLimitBytes(settings: ScanSettings): number {
  return settings.maxUploadMb * 1024 * 1024;
}

function verdictKey(provider: string, sha256: string): string {
  return `${VERDICT_PREFIX}${provider}:${sha256}`;
}

function missKey(provider: string, sha256: string): string {
  return `${MISS_PREFIX}${provider}:${sha256}`;
}

function analysisKey(provider: string, id: string): string {
  return `${ANALYSIS_PREFIX}${provider}:${id}`;
}

function integer(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function totalOf(stats: Record<string, unknown>): number {
  let total = 0;
  for (const value of Object.values(stats)) {
    if (typeof value === "number" && Number.isFinite(value)) total += value;
  }
  return total;
}

function providerMessage(provider: ScanProviderId, status: number): string {
  const name = provider === "virustotal" ? "VirusTotal" : "MetaDefender";
  if (status === 401 || status === 403) return `${name} 拒绝了 API Key（HTTP ${status}），请检查系统设置里的查杀 Key`;
  if (status === 429) {
    return provider === "virustotal"
      ? "VirusTotal 免费公共 API 限流（4 次/分钟、500 次/天），请稍后重试或换用 MetaDefender"
      : "MetaDefender 免费额度已用完（约 150 次扫描/天、1000 次 hash 查询/天），请稍后重试";
  }
  if (status === 413) return `${name} 拒绝了这个文件：文件超过该套餐的上传上限`;
  return `${name} 返回 HTTP ${status}`;
}

async function requestJson(
  provider: ScanProviderId,
  url: string,
  init: RequestInit,
): Promise<{ status: number; json: unknown }> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new ScanError("scan_unreachable", 502, `连不上查杀服务：${String(error)}`);
  }
  const text = await response.text().catch(() => "");
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, json };
}

function ensureOk(provider: ScanProviderId, status: number): void {
  if (status >= 200 && status < 300) return;
  const code =
    status === 401 || status === 403
      ? "scan_auth_failed"
      : status === 429
        ? "scan_rate_limited"
        : status === 413
          ? "scan_file_too_large"
          : status >= 500
            ? "scan_provider_unavailable"
            : "scan_provider_error";
  throw new ScanError(code, status === 413 ? 413 : status === 429 ? 429 : 502, providerMessage(provider, status));
}

interface ProviderAdapter {
  lookup(settings: ScanSettings, sha256: string): Promise<ScanVerdict | null>;
  upload(settings: ScanSettings, bytes: Uint8Array, filename: string, sha256: string): Promise<string>;
  analysis(settings: ScanSettings, id: string): Promise<{ done: boolean; verdict?: ScanVerdict }>;
}

const virustotal: ProviderAdapter = {
  async lookup(settings, sha256) {
    const { status, json } = await requestJson("virustotal", `${settings.baseUrl}/files/${sha256}`, {
      headers: { "x-apikey": settings.apiKey, accept: "application/json" },
    });
    if (status === 404) return null;
    ensureOk("virustotal", status);

    const data = json as { data?: { attributes?: Record<string, any> } } | null;
    const attributes = data?.data?.attributes ?? {};
    const stats = (attributes.last_analysis_stats ?? {}) as Record<string, unknown>;
    return {
      provider: "virustotal",
      sha256,
      malicious: integer(stats.malicious),
      suspicious: integer(stats.suspicious),
      undetected: integer(stats.undetected),
      harmless: integer(stats.harmless),
      total: totalOf(stats),
      permalink: `https://www.virustotal.com/gui/file/${sha256}`,
      scanDate: attributes.last_analysis_date ? integer(attributes.last_analysis_date) * 1000 : undefined,
    };
  },

  async upload(settings, bytes, filename) {
    const form = new FormData();
    form.append("file", new File([bytes], filename || "upload.bin", { type: "application/octet-stream" }));
    const { status, json } = await requestJson("virustotal", `${settings.baseUrl}/files`, {
      method: "POST",
      headers: { "x-apikey": settings.apiKey, accept: "application/json" },
      body: form,
    });
    ensureOk("virustotal", status);
    const id = (json as { data?: { id?: string } } | null)?.data?.id;
    if (!id) throw new ScanError("scan_upload_failed", 502, "VirusTotal 没有返回分析 ID");
    return id;
  },

  async analysis(settings, id) {
    const { status, json } = await requestJson("virustotal", `${settings.baseUrl}/analyses/${id}`, {
      headers: { "x-apikey": settings.apiKey, accept: "application/json" },
    });
    if (status === 404) throw new ScanError("scan_analysis_not_found", 404, "查杀任务不存在或已过期");
    ensureOk("virustotal", status);

    const data = json as
      | { data?: { attributes?: Record<string, any> }; meta?: { file_info?: { sha256?: string } } }
      | null;
    const attributes = data?.data?.attributes ?? {};
    if (attributes.status !== "completed") return { done: false };

    const stats = (attributes.stats ?? {}) as Record<string, unknown>;
    const sha256 = data?.meta?.file_info?.sha256 ?? "";
    return {
      done: true,
      verdict: {
        provider: "virustotal",
        sha256,
        malicious: integer(stats.malicious),
        suspicious: integer(stats.suspicious),
        undetected: integer(stats.undetected),
        harmless: integer(stats.harmless),
        total: totalOf(stats),
        permalink: sha256 ? `https://www.virustotal.com/gui/file/${sha256}` : undefined,
        scanDate: attributes.date ? integer(attributes.date) * 1000 : undefined,
      },
    };
  },
};

const metadefender: ProviderAdapter = {
  async lookup(settings, sha256) {
    const { status, json } = await requestJson("metadefender", `${settings.baseUrl}/hash/${sha256}`, {
      headers: { apikey: settings.apiKey, accept: "application/json" },
    });
    if (status === 404) return null;
    ensureOk("metadefender", status);
    return verdictFromMetadefender(json, sha256);
  },

  async upload(settings, bytes, filename) {
    const form = new FormData();
    form.append("file", new File([bytes], filename || "upload.bin", { type: "application/octet-stream" }));
    const { status, json } = await requestJson("metadefender", `${settings.baseUrl}/file`, {
      method: "POST",
      headers: { apikey: settings.apiKey, accept: "application/json" },
      body: form,
    });
    ensureOk("metadefender", status);
    const id = (json as { data_id?: string } | null)?.data_id;
    if (!id) throw new ScanError("scan_upload_failed", 502, "MetaDefender 没有返回 data_id");
    return id;
  },

  async analysis(settings, id) {
    const { status, json } = await requestJson("metadefender", `${settings.baseUrl}/file/${id}`, {
      headers: { apikey: settings.apiKey, accept: "application/json" },
    });
    if (status === 404) throw new ScanError("scan_analysis_not_found", 404, "查杀任务不存在或已过期");
    ensureOk("metadefender", status);

    const data = json as Record<string, any> | null;
    const progress = data?.process_info?.progress_percentage;
    const ready = !!data?.scan_results && (progress === undefined || Number(progress) >= 100);
    if (!ready) return { done: false };
    return { done: true, verdict: verdictFromMetadefender(data, "") };
  },
};

function verdictFromMetadefender(json: unknown, sha256: string): ScanVerdict {
  const data = (json ?? {}) as Record<string, any>;
  const results = data.scan_results ?? {};
  const total = integer(results.total_avs);
  const detected = integer(results.total_detected_avs);
  const suspicious = /suspicious/i.test(String(results.scan_all_result_a ?? "")) ? 1 : 0;
  const fileSha = String(data.file_info?.sha256 ?? sha256).toLowerCase();
  const scannedAt = data.file_info?.upload_timestamp ? Date.parse(String(data.file_info.upload_timestamp)) : NaN;
  return {
    provider: "metadefender",
    sha256: fileSha,
    malicious: detected,
    suspicious,
    undetected: Math.max(0, total - detected - suspicious),
    harmless: 0,
    total,
    permalink: fileSha ? `https://metadefender.opswat.com/results/file/${fileSha}/hash/overview` : undefined,
    scanDate: Number.isFinite(scannedAt) ? scannedAt : undefined,
  };
}

function adapterOf(provider: ScanProviderId): ProviderAdapter {
  return provider === "metadefender" ? metadefender : virustotal;
}

async function cacheVerdict(env: Env, settings: ScanSettings, verdict: ScanVerdict): Promise<void> {
  const ttl = Math.max(60, Math.floor(settings.cacheMinutes) * 60);
  await env.CERTUM_KV.put(verdictKey(settings.provider, verdict.sha256), JSON.stringify(verdict), {
    expirationTtl: ttl,
  });
}

/** 查 hash；null = 服务端没有这个文件（未扫描）。网络/配额错误抛 ScanError。 */
export async function lookupVerdict(env: Env, settings: ScanSettings, sha256: string): Promise<ScanVerdict | null> {
  if (!settings.apiKey) {
    throw new ScanError("scan_not_configured", 503, "该证书要求病毒查杀，但管理员还没有配置查杀 API Key");
  }
  const clean = sha256.toLowerCase();
  const cached = await env.CERTUM_KV.get<ScanVerdict>(verdictKey(settings.provider, clean), "json");
  if (cached) return cached;
  if (await env.CERTUM_KV.get(missKey(settings.provider, clean))) return null;

  const verdict = await adapterOf(settings.provider).lookup(settings, clean);
  if (!verdict) {
    await env.CERTUM_KV.put(missKey(settings.provider, clean), "1", { expirationTtl: MISS_TTL });
    return null;
  }
  await cacheVerdict(env, settings, verdict);
  return verdict;
}

/**
 * 上传文件并建立分析任务。bytes 的 SHA-256 会被重新计算并与声明的值比对，
 * 防止客户端拿一个干净文件的 hash 去签另一个文件。
 */
export async function uploadForScan(
  env: Env,
  settings: ScanSettings,
  bytes: Uint8Array,
  filename: string,
  declaredSha256?: string,
): Promise<{ id: string; sha256: string }> {
  if (!settings.apiKey) {
    throw new ScanError("scan_not_configured", 503, "还没有配置查杀 API Key");
  }
  if (bytes.byteLength > scanUploadLimitBytes(settings)) {
    throw new ScanError(
      "scan_file_too_large",
      413,
      `文件 ${(bytes.byteLength / 1048576).toFixed(1)} MB，超过后台设置的上传上限 ${settings.maxUploadMb} MB`,
    );
  }
  const sha256 = await sha256Hex(bytes);
  const declared = (declaredSha256 ?? "").trim().toLowerCase();
  if (declared && declared !== sha256) {
    throw new ScanError("scan_hash_mismatch", 400, "上传内容与声明的 SHA-256 不一致，已拒绝上传");
  }

  const id = await adapterOf(settings.provider).upload(settings, bytes, filename, sha256);
  const state: ScanAnalysisState = {
    provider: settings.provider,
    sha256,
    done: false,
    checkedAt: 0,
    createdAt: Date.now(),
  };
  await Promise.all([
    env.CERTUM_KV.put(analysisKey(settings.provider, id), JSON.stringify(state), { expirationTtl: ANALYSIS_TTL }),
    env.CERTUM_KV.delete(missKey(settings.provider, sha256)),
  ]);
  return { id, sha256 };
}

/** 轮询分析结果；10 秒内重复调用只返回 KV 里的状态，避免打爆免费配额。 */
export async function pollScanAnalysis(
  env: Env,
  settings: ScanSettings,
  id: string,
): Promise<ScanAnalysisState | null> {
  const state = await env.CERTUM_KV.get<ScanAnalysisState>(analysisKey(settings.provider, id), "json");
  if (!state) return null;
  if (state.done) return state;
  if (settings.provider !== state.provider) {
    throw new ScanError("scan_provider_changed", 409, "查杀服务已切换，请重新上传这个文件");
  }
  if (Date.now() - state.checkedAt < POLL_INTERVAL_MS) return state;

  const result = await adapterOf(state.provider).analysis(settings, id);
  state.checkedAt = Date.now();
  if (result.done && result.verdict) {
    const verdict: ScanVerdict = { ...result.verdict, sha256: result.verdict.sha256 || state.sha256 };
    state.done = true;
    state.verdict = verdict;
    await cacheVerdict(env, settings, verdict);
  }
  await env.CERTUM_KV.put(analysisKey(state.provider, id), JSON.stringify(state), { expirationTtl: ANALYSIS_TTL });
  return state;
}
