import test from "node:test";
import assert from "node:assert/strict";
import type { Env } from "../src/types.ts";
import {
  ADMIN_PASSWORD_MIN,
  adminAuthState,
  checkAdminCredentials,
  createAdminAccount,
  readAdminAccount,
  setAdminPassword,
} from "../src/store/admin-account.ts";
import { readSessionSecret } from "../src/lib/session-secret.ts";

/** 够用的内存 KV：只需要 get / put / delete / list */
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

function makeEnv(patch: Partial<Record<string, string>> = {}) {
  const kv = memoryKV();
  const env = {
    CERTUM_KV: kv,
    CERTUM_EMAIL: "",
    ADMIN_PASSWORD: "",
    SESSION_SECRET: "",
    ...patch,
  } as unknown as Env;
  return { env, kv };
}

const STRONG = "correct-horse-battery";

test("全新部署是 unconfigured，且没有会话密钥", async () => {
  const { env } = makeEnv();
  assert.equal((await adminAuthState(env)).mode, "unconfigured");
  assert.equal(await readSessionSecret(env), "");
});

test("只有 ADMIN_PASSWORD 的旧部署仍是 env 模式", async () => {
  const { env } = makeEnv({ ADMIN_PASSWORD: "legacy-pass-123" });
  assert.equal((await adminAuthState(env)).mode, "env");
  assert.equal(await readSessionSecret(env), "legacy-pass-123");
});

test("初始化后变成 account 模式，口令只存哈希", async () => {
  const { env, kv } = makeEnv();
  const account = await createAdminAccount(env, { username: "ops", password: STRONG });

  assert.equal(account.username, "ops");
  assert.match(account.passwordHash, /^pbkdf2\$/);
  assert.ok(!account.passwordHash.includes(STRONG));

  const state = await adminAuthState(env);
  assert.equal(state.mode, "account");
  assert.equal(state.account?.username, "ops");

  const stored = kv.store.get("admin:account");
  assert.ok(stored && !stored.includes(STRONG));
});

test("初始化会顺手生成并保存会话密钥", async () => {
  const { env, kv } = makeEnv();
  await createAdminAccount(env, { username: "ops", password: STRONG });

  const secret = await readSessionSecret(env);
  assert.ok(secret.length >= 32);
  assert.equal(kv.store.get("admin:secret"), secret);
});

test("用户名或口令错误都返回 false", async () => {
  const { env } = makeEnv();
  await createAdminAccount(env, { username: "ops", password: STRONG });

  assert.equal(await checkAdminCredentials(env, "ops", STRONG), true);
  assert.equal(await checkAdminCredentials(env, "OPS", STRONG), true);
  assert.equal(await checkAdminCredentials(env, "ops", "wrong-password"), false);
  assert.equal(await checkAdminCredentials(env, "other", STRONG), false);
  assert.equal(await checkAdminCredentials(env, "ops", ""), false);
});

test("口令太短、用户名非法、重复初始化都被拒绝", async () => {
  const { env } = makeEnv();
  await assert.rejects(
    () => createAdminAccount(env, { username: "ops", password: STRONG.slice(0, ADMIN_PASSWORD_MIN - 1) }),
    /至少 10 位/,
  );
  await assert.rejects(() => createAdminAccount(env, { username: "a b", password: STRONG }), /用户名只能是/);

  await createAdminAccount(env, { username: "ops", password: STRONG });
  await assert.rejects(() => createAdminAccount(env, { username: "ops2", password: STRONG }), /已经初始化过/);
});

test("改口令后旧口令失效", async () => {
  const { env } = makeEnv();
  await createAdminAccount(env, { username: "ops", password: STRONG });
  await setAdminPassword(env, "another-strong-pass");

  assert.equal(await checkAdminCredentials(env, "ops", STRONG), false);
  assert.equal(await checkAdminCredentials(env, "ops", "another-strong-pass"), true);

  const account = await readAdminAccount(env);
  assert.ok((account?.updatedAt ?? 0) >= (account?.createdAt ?? 0));
});
