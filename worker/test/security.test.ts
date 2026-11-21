import test from "node:test";
import assert from "node:assert/strict";
import type { Env } from "../src/types.ts";
import { MAX_KEYS_PER_USER, keyLimitReached } from "../src/lib/limits.ts";
import { takeRateLimit } from "../src/lib/ratelimit.ts";

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
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cacheStatus: null };
    },
  };
}

function makeEnv() {
  const env = { CERTUM_KV: memoryKV() } as unknown as Env;
  return env;
}

test("每账号 Key 数量上限：到点即拒", () => {
  assert.equal(keyLimitReached(0), false);
  assert.equal(keyLimitReached(MAX_KEYS_PER_USER - 1), false);
  assert.equal(keyLimitReached(MAX_KEYS_PER_USER), true);
  assert.equal(keyLimitReached(MAX_KEYS_PER_USER + 5), true);
  assert.equal(keyLimitReached(Number.NaN), false);
});

test("限流：窗口内超过上限即拒绝，不同 bucket 互不影响", async () => {
  const env = makeEnv();

  assert.equal((await takeRateLimit(env, "upload:a", 2, 60)).allowed, true);
  assert.equal((await takeRateLimit(env, "upload:a", 2, 60)).allowed, true);
  const third = await takeRateLimit(env, "upload:a", 2, 60);
  assert.equal(third.allowed, false);
  assert.equal(third.count, 3);

  const other = await takeRateLimit(env, "upload:b", 2, 60);
  assert.equal(other.allowed, true);
  assert.equal(other.count, 1);
});

test("限流：窗口过期后重新计数", async () => {
  const env = makeEnv();
  await takeRateLimit(env, "w", 1, 0);
  const second = await takeRateLimit(env, "w", 1, 0);
  assert.equal(second.count, 1);
  assert.equal(second.allowed, true);
});
