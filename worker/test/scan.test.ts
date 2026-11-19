import test from "node:test";
import assert from "node:assert/strict";

import type { CredentialRecord, Env, ScanVerdict } from "../src/types.ts";
import type { RuntimeConfig } from "../src/store/config.ts";
import {
  evaluateVerdict,
  lookupVerdict,
  pollScanAnalysis,
  readScanSettings,
  registerAnalysis,
  riskScore,
  scanPolicyOf,
  uploadForScan,
  uploadStreamForScan,
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

test("Base64 分析 ID（带 == 填充）能存进 KV 并编码后回源", async () => {
  const bytes = new TextEncoder().encode("base64 id");
  const sha = await sha256Hex(bytes);
  const env = { CERTUM_KV: new MemoryKV() } as unknown as Env;
  const realFetch = globalThis.fetch;
  // VirusTotal 真实返回的形状：Base64 + == 填充
  const id = "NDM5OGY0Y2MxM2NlNTgwYWRlZTE4OWYwZTU0YTRhMDU6MTc5NTEwMzY4OQ==";
  const requested: string[] = [];

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("/files") && init?.method === "POST") {
      return json({ data: { type: "analysis", id } });
    }
    return json({
      data: { attributes: { status: "completed", stats: { malicious: 1, undetected: 60 }, date: 1_700_000_000 } },
      meta: { file_info: { sha256: sha } },
    });
  }) as typeof fetch;

  try {
    const uploaded = await uploadForScan(env, settings(), bytes, "app.exe", sha);
    assert.equal(uploaded.id, id);

    const state = await pollScanAnalysis(env, settings(), id);
    assert.ok(state);
    assert.equal(state.done, true);
    assert.equal(state.verdict?.malicious, 1);

    // ID 里的 = 必须编码，否则上游按路径参数解析会出错
    const analysisUrl = requested.find((url) => url.includes("/analyses/"));
    assert.ok(analysisUrl, "没有请求 analyses 接口");
    assert.ok(analysisUrl.includes(encodeURIComponent(id)), `分析 ID 未编码：${analysisUrl}`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("大文件走 upload_url 并流式转发，不在内存里拼整份 multipart", async () => {
  const env = { CERTUM_KV: new MemoryKV() } as unknown as Env;
  const realFetch = globalThis.fetch;
  const sha = "c".repeat(64);
  const urls: string[] = [];
  let envelope = "";

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith("/files/upload_url")) return json({ data: "https://bigfiles.test/upload/one" });

    const reader = (init?.body as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    envelope = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("latin1");
    return json({ data: { id: "an_big" } });
  }) as typeof fetch;

  try {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("payload-"));
        controller.enqueue(new TextEncoder().encode("bytes"));
        controller.close();
      },
    });

    const result = await uploadStreamForScan(env, settings(), body, "big.bin", sha, true);
    assert.equal(result.id, "an_big");
    assert.equal(result.sha256, sha);
    assert.ok(urls[0]!.endsWith("/files/upload_url"), `应先取上传地址：${urls[0]}`);
    assert.equal(urls[1], "https://bigfiles.test/upload/one");
    assert.ok(envelope.includes('name="file"; filename="big.bin"'), envelope.slice(0, 200));
    assert.ok(envelope.includes("payload-bytes"));
    assert.ok(envelope.trimEnd().endsWith("--"), "multipart 缺少结束边界");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("流式上传后 provider 返回的文件哈希与声明不一致时拒绝采用", async () => {
  const env = { CERTUM_KV: new MemoryKV() } as unknown as Env;
  const realFetch = globalThis.fetch;
  const declared = "c".repeat(64);
  const reported = "d".repeat(64);

  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.endsWith("/files/upload_url")) return json({ data: "https://bigfiles.test/upload/two" });
    if (url.includes("bigfiles.test")) return json({ data: { id: "an_swap" } });
    return json({
      data: { attributes: { status: "completed", stats: { malicious: 0, undetected: 60 } } },
      meta: { file_info: { sha256: reported } },
    });
  }) as typeof fetch;

  try {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("clean"));
        controller.close();
      },
    });
    await uploadStreamForScan(env, settings(), body, "switch.bin", declared, true);

    await assert.rejects(
      pollScanAnalysis(env, settings(), "an_swap"),
      (error: unknown) =>
        typeof error === "object" && error !== null && (error as { code?: string }).code === "scan_analysis_mismatch",
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("客户端直传的分析 ID 只能登记一次，不能改挂到别的文件", async () => {
  const kv = new MemoryKV();
  const env = { CERTUM_KV: kv } as unknown as Env;
  const sha = "e".repeat(64);

  await registerAnalysis(env, settings(), "an_direct", sha);
  const state = JSON.parse(kv.store.get("scan:analysis:virustotal:an_direct") ?? "{}");
  assert.equal(state.sha256, sha);
  assert.equal(state.unverified, true);
  assert.equal(state.done, false);

  // 同一 ID 换一个哈希必须拒绝，避免拿干净文件的扫描结果冒充别的文件
  await assert.rejects(
    registerAnalysis(env, settings(), "an_direct", "f".repeat(64)),
    (error: unknown) =>
      typeof error === "object" && error !== null && (error as { code?: string }).code === "scan_analysis_conflict",
  );
  // 重复登记同一个哈希是幂等的
  await registerAnalysis(env, settings(), "an_direct", sha);
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

