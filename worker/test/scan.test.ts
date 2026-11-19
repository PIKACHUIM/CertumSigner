import test from "node:test";
import assert from "node:assert/strict";

import type { CredentialRecord, Env, ScanVerdict } from "../src/types.ts";
import type { RuntimeConfig } from "../src/store/config.ts";
import {
  evaluateVerdict,
  lookupVerdict,
  pollScanAnalysis,
  readScanSettings,
  riskScore,
  scanPolicyOf,
  uploadForScan,
} from "../src/scan/index.ts";
import { sha256Hex } from "../src/lib/encoding.ts";

function verdict(overrides: Partial<ScanVerdict> = {}): ScanVerdict {
  return {
    provider: "virustotal",
    sha256: "a".repeat(64),
    malicious: 0,
    suspicious: 0,
    undetected: 70,
    harmless: 0,
    total: 70,
    ...overrides,
  };
}

function credential(overrides: Partial<CredentialRecord> = {}): CredentialRecord {
  return {
    id: "cred_test",
    label: "test",
    email: "test@example.com",
    otpUri: "otpauth://totp/test?secret=JBSWY3DPEHPK3PXP",
    enabled: true,
    createdAt: 0,
    createdBy: "admin",
    ...overrides,
  };
}

test("风险等级 = 报毒引擎 + 可疑引擎", () => {
  assert.equal(riskScore(verdict({ malicious: 2, suspicious: 1 })), 3);
});

test("风险阈值是闭区间：等于上限也允许签名", () => {
  const clean = verdict();
  assert.deepEqual(evaluateVerdict(clean, 0), { risk: 0, allowed: true });

  const flagged = verdict({ malicious: 1, suspicious: 1 });
  assert.deepEqual(evaluateVerdict(flagged, 2), { risk: 2, allowed: true });
  assert.deepEqual(evaluateVerdict(flagged, 1), { risk: 2, allowed: false });
});

test("旧凭据没有 scanMode 时按不扫描处理", () => {
  assert.deepEqual(scanPolicyOf(credential()), { mode: "off", maxRisk: 0 });
  assert.deepEqual(scanPolicyOf(credential({ scanMode: "auto", scanMaxRisk: 3 })), {
    mode: "auto",
    maxRisk: 3,
  });
  assert.deepEqual(scanPolicyOf(credential({ scanMode: "manual" })), { mode: "manual", maxRisk: 0 });
});

test("查杀服务默认地址随 provider 切换，配置地址优先", () => {
  const base = {
    scanProvider: "virustotal",
    scanApiKey: "key",
    scanBaseUrl: "",
    scanMaxUploadMb: 32,
    scanCacheMinutes: 1440,
  } as RuntimeConfig;

  assert.equal(readScanSettings(base).baseUrl, "https://www.virustotal.com/api/v3");
  assert.equal(
    readScanSettings({ ...base, scanProvider: "metadefender" }).baseUrl,
    "https://api.metadefender.com/v4",
  );
  assert.equal(readScanSettings({ ...base, scanBaseUrl: "https://proxy.example.com/vt/" }).baseUrl, "https://proxy.example.com/vt");
});

/* ------------------------------ 带 mock 的链路 ------------------------------ */

class MemoryKV {
  store = new Map<string, string>();

  async get(key: string, type?: string): Promise<unknown> {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

function settings(overrides: Partial<RuntimeConfig> = {}) {
  return readScanSettings({
    scanProvider: "virustotal",
    scanApiKey: "vt-key",
    scanBaseUrl: "https://vt.test/api/v3",
    scanMaxUploadMb: 32,
    scanCacheMinutes: 60,
    ...overrides,
  } as RuntimeConfig);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("VirusTotal 按 hash 查询并缓存结果，不重复消耗配额", async () => {
  const sha = "a".repeat(64);
  const env = { CERTUM_KV: new MemoryKV() } as unknown as Env;
  const realFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = (async (input: unknown) => {
    calls++;
    const url = String(input);
    assert.ok(url.endsWith(`/files/${sha}`), `unexpected URL: ${url}`);
    return json({
      data: {
        attributes: {
          last_analysis_stats: { malicious: 2, suspicious: 1, undetected: 60, harmless: 7 },
          last_analysis_date: 1_700_000_000,
        },
      },
    });
  }) as typeof fetch;

  try {
    const first = await lookupVerdict(env, settings(), sha);
    const second = await lookupVerdict(env, settings(), sha);
    assert.equal(calls, 1);
    assert.ok(first);
    assert.equal(riskScore(first), 3);
    assert.equal(first.total, 70);
    assert.equal(first.scanDate, 1_700_000_000_000);
    assert.deepEqual(second, first);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("上传时校验 SHA-256，轮询完成后写入结果缓存", async () => {
  const bytes = new TextEncoder().encode("hello certumsigner");
  const sha = await sha256Hex(bytes);
  const env = { CERTUM_KV: new MemoryKV() } as unknown as Env;
  const realFetch = globalThis.fetch;
  let lookups = 0;

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/files") && init?.method === "POST") {
      return json({ data: { type: "analysis", id: "an_test" } });
    }
    if (url.endsWith("/analyses/an_test")) {
      lookups++;
      return json({
        data: {
          attributes: {
            status: "completed",
            stats: { malicious: 0, suspicious: 0, undetected: 61, harmless: 9 },
            date: 1_700_000_100,
          },
        },
        meta: { file_info: { sha256: sha } },
      });
    }
    throw new Error(`unexpected URL: ${url}`);
  }) as typeof fetch;

  try {
    const uploaded = await uploadForScan(env, settings(), bytes, "app.exe", sha);
    assert.equal(uploaded.id, "an_test");
    assert.equal(uploaded.sha256, sha);

    const state = await pollScanAnalysis(env, settings(), "an_test");
    assert.ok(state);
    assert.equal(state.done, true);
    assert.equal(state.verdict?.sha256, sha);
    assert.deepEqual(evaluateVerdict(state.verdict!, 0), { risk: 0, allowed: true });

    // 已完成的 state 直接返回，不再打 provider
    await pollScanAnalysis(env, settings(), "an_test");
    assert.equal(lookups, 1);

    // 轮询完成后结果已按 hash 缓存，查询不再回源
    const before = lookups;
    const cached = await lookupVerdict(env, settings(), sha);
    assert.equal(cached?.malicious, 0);
    assert.equal(lookups, before);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("声明的 SHA-256 与上传内容不一致时拒绝上传", async () => {
  const bytes = new TextEncoder().encode("content");
  const env = { CERTUM_KV: new MemoryKV() } as unknown as Env;
  await assert.rejects(
    uploadForScan(env, settings(), bytes, "app.exe", "b".repeat(64)),
    (error: unknown) =>
      typeof error === "object" && error !== null && (error as { code?: string }).code === "scan_hash_mismatch",
  );
});

