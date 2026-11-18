import test from "node:test";
import assert from "node:assert/strict";
import type { Env } from "../src/types.ts";
import { DEFAULT_TSA_UPSTREAM, readConfig, writeConfig } from "../src/store/config.ts";
import { DEFAULT_API_BASE } from "../src/certum/config.ts";

function memoryKV() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string, type?: string) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function makeEnv(patch: Partial<Record<string, string>> = {}) {
  const kv = memoryKV();
  const env = { CERTUM_KV: kv, CERTUM_EMAIL: "", ADMIN_PASSWORD: "", SESSION_SECRET: "", ...patch } as unknown as Env;
  return { env, kv };
}

test("没有任何配置时用默认值", async () => {
  const { env } = makeEnv();
  const config = await readConfig(env);
  assert.equal(config.certumApiBase, DEFAULT_API_BASE);
  assert.equal(config.tsaUpstream, DEFAULT_TSA_UPSTREAM.replace(/\/+$/, ""));
  assert.equal(config.publicBaseUrl, "");
  assert.equal(config.resendFrom, "");
  assert.equal(config.certumChainPem, "");
  assert.equal(config.logSignatures, true);
});

test("环境变量作为回退，LOG_SIGNATURES=0 关闭日志", async () => {
  const { env } = makeEnv({
    PUBLIC_BASE_URL: "https://env.example.com/",
    CERTUM_API_BASE: "https://api.env.example.com/",
    TSA_UPSTREAM: "https://tsa.env.example.com/",
    RESEND_FROM: "Env <env@example.com>",
    LOG_SIGNATURES: "0",
  });
  const config = await readConfig(env);
  assert.equal(config.publicBaseUrl, "https://env.example.com");
  assert.equal(config.certumApiBase, "https://api.env.example.com");
  assert.equal(config.tsaUpstream, "https://tsa.env.example.com");
  assert.equal(config.resendFrom, "Env <env@example.com>");
  assert.equal(config.logSignatures, false);
});

test("KV 配置覆盖环境变量并去掉尾部斜杠", async () => {
  const { env } = makeEnv({ PUBLIC_BASE_URL: "https://env.example.com", LOG_SIGNATURES: "0" });
  await writeConfig(env, {
    publicBaseUrl: "https://sign.example.com/",
    certumApiBase: "https://api.kv.example.com/",
    logSignatures: true,
  });

  const config = await readConfig(env);
  assert.equal(config.publicBaseUrl, "https://sign.example.com");
  assert.equal(config.certumApiBase, "https://api.kv.example.com");
  assert.equal(config.logSignatures, true);
});

test("清空字段等于回到默认值/环境变量", async () => {
  const { env } = makeEnv({ TSA_UPSTREAM: "https://tsa.env.example.com/" });
  await writeConfig(env, { tsaUpstream: "", publicBaseUrl: "https://a.example.com" });
  const config = await readConfig(env);
  assert.equal(config.tsaUpstream, "https://tsa.env.example.com");
  assert.equal(config.publicBaseUrl, "https://a.example.com");
});

test("证书链 PEM 的换行原样保存", async () => {
  const { env } = makeEnv();
  const pem = "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----";
  await writeConfig(env, { certumChainPem: pem });
  assert.equal((await readConfig(env)).certumChainPem, pem);
});
