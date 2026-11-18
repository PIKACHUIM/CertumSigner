import test from "node:test";
import assert from "node:assert/strict";
import type { Env } from "../src/types.ts";
import { DEFAULT_TSA_UPSTREAM, readConfig, writeConfig } from "../src/store/config.ts";
import { DEFAULT_API_BASE, resolveEndpoints } from "../src/certum/config.ts";

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

function makeEnv() {
  const kv = memoryKV();
  const env = { CERTUM_KV: kv } as unknown as Env;
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

test("保存后读回 KV 配置并去掉尾部斜杠", async () => {
  const { env } = makeEnv();
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

test("清空的字段回落到默认值，其他字段保留", async () => {
  const { env } = makeEnv();
  await writeConfig(env, { tsaUpstream: "", publicBaseUrl: "https://a.example.com" });
  const config = await readConfig(env);
  assert.equal(config.tsaUpstream, DEFAULT_TSA_UPSTREAM.replace(/\/+$/, ""));
  assert.equal(config.publicBaseUrl, "https://a.example.com");
});

test("日志开关可以关掉再打开", async () => {
  const { env } = makeEnv();
  await writeConfig(env, { logSignatures: false });
  assert.equal((await readConfig(env)).logSignatures, false);
  await writeConfig(env, { logSignatures: true });
  assert.equal((await readConfig(env)).logSignatures, true);
});

test("证书链 PEM 的换行原样保存", async () => {
  const { env } = makeEnv();
  const pem = "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----";
  await writeConfig(env, { certumChainPem: pem });
  assert.equal((await readConfig(env)).certumChainPem, pem);
});

test("resolveEndpoints 用默认值或自定义 apiBase 拼出同样的路径", () => {
  const base = resolveEndpoints({});
  assert.equal(base.apiBase, DEFAULT_API_BASE);
  assert.equal(base.tokenUrl, `${DEFAULT_API_BASE}/idp/oauth2.0/accessToken`);
  assert.equal(base.loginUrl, `${DEFAULT_API_BASE}/idp/login`);

  const custom = resolveEndpoints({ apiBase: "https://api.example.com/" });
  assert.equal(custom.apiBase, "https://api.example.com");
  assert.equal(custom.authorizeUrl, "https://api.example.com/idp/oauth2.0/authorize");
});
