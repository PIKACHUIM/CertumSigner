import test from "node:test";
import assert from "node:assert/strict";
import type { ApiKeyRecord, Env } from "../src/types.ts";
import { normalizeQuota, quotaReached, quotaRemaining, totalUsed } from "../src/lib/quota.ts";
import { createUser, getUser, updateUser } from "../src/store/users.ts";
import { createApiKey, getUserTotalUsage, touchApiKey } from "../src/store/keys.ts";

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
    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? "";
      return {
        keys: [...store.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      };
    },
  };
}

function makeEnv() {
  const kv = memoryKV();
  const env = { CERTUM_KV: kv } as unknown as Env;
  return { env, kv };
}

test("quotaReached：0 表示不限，边界处不误判", () => {
  assert.equal(quotaReached(9999, 0, 16), false);
  assert.equal(quotaReached(0, 100, 100), false);
  assert.equal(quotaReached(99, 100, 1), false);
  assert.equal(quotaReached(100, 100, 1), true);
  assert.equal(quotaReached(90, 100, 16), true);
  assert.equal(quotaReached(Number.NaN, 100, 1), false);
  assert.equal(quotaReached(0, 100, Number.NaN), false);
});

test("quotaRemaining：不限返回 null，用尽返回 0", () => {
  assert.equal(quotaRemaining(10, 0), null);
  assert.equal(quotaRemaining(10, 100), 90);
  assert.equal(quotaRemaining(100, 100), 0);
  assert.equal(quotaRemaining(200, 100), 0);
});

test("totalUsed：累加名下所有 Key，并扣掉重置基准", () => {
  assert.equal(totalUsed([], 0), 0);
  assert.equal(totalUsed([3, 4, 5], 0), 12);
  assert.equal(totalUsed([3, 4, 5], 10), 2);
  assert.equal(totalUsed([3, 4, 5], 100), 0);
  assert.equal(totalUsed([3, Number.NaN, -5], 0), 3);
});

test("normalizeQuota：负数 / NaN / 小数都收敛成非负整数", () => {
  assert.equal(normalizeQuota("-3"), 0);
  assert.equal(normalizeQuota("12.9"), 12);
  assert.equal(normalizeQuota(undefined), 0);
  assert.equal(normalizeQuota("abc"), 0);
  assert.equal(normalizeQuota(500), 500);
});

test("用户总限额能建、能改，默认 0 = 不限", async () => {
  const { env } = makeEnv();
  const created = await createUser(env, {
    email: "quota@example.com",
    password: "password-123",
    createdBy: "admin",
  });
  assert.equal(created.totalQuota, 0);

  await updateUser(env, created.id, { totalQuota: 1000 });
  assert.equal((await getUser(env, created.id))?.totalQuota, 1000);

  await updateUser(env, created.id, { totalQuota: -5 });
  assert.equal((await getUser(env, created.id))?.totalQuota, 0);
});

test("用户总用量按名下所有 Key 汇总，并在重置后从基准重新计", async () => {
  const { env } = makeEnv();
  const user = await createUser(env, {
    email: "usage@example.com",
    password: "password-123",
    createdBy: "admin",
  });
  const first = await createApiKey(env, {
    name: "k1",
    createdBy: "admin",
    userId: user.id,
    credentialId: "cred_x",
  });
  const second = await createApiKey(env, {
    name: "k2",
    createdBy: "admin",
    userId: user.id,
    credentialId: "cred_x",
  });

  await touchApiKey(env, first.record, 5);
  await touchApiKey(env, second.record, 7);

  assert.equal(await getUserTotalUsage(env, user.id), 12);

  await updateUser(env, user.id, { totalUsedBase: 12 });
  const reloaded = await getUser(env, user.id);
  assert.equal(await getUserTotalUsage(env, user.id, reloaded?.totalUsedBase ?? 0), 0);

  await touchApiKey(env, second.record, 3);
  assert.equal(await getUserTotalUsage(env, user.id, 12), 3);
});

test("同一分钟内的连续签名不再被丢掉（totalSigns 必须逐次累加）", async () => {
  const { env } = makeEnv();
  const { record } = await createApiKey(env, {
    name: "burst",
    createdBy: "admin",
    credentialId: "cred_x",
  });

  await touchApiKey(env, record, 2);
  await touchApiKey(env, record, 3);
  await touchApiKey(env, record, 4);

  assert.equal(record.totalSigns, 9);
  const stored = await env.CERTUM_KV.get<ApiKeyRecord>(`key:${record.hash}`, "json");
  assert.equal(stored?.totalSigns, 9);
});
