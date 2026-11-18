import test from "node:test";
import assert from "node:assert/strict";
import type { Env } from "../src/types.ts";
import {
  authenticateUserDetailed,
  createUser,
  deleteUser,
  findUserByEmail,
  updateUser,
} from "../src/store/users.ts";

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

function makeEnv() {
  const kv = memoryKV();
  const env = { CERTUM_KV: kv } as unknown as Env;
  return { env, kv };
}

test("用户用邮箱做登录标识，大小写归一化", async () => {
  const { env } = makeEnv();
  const user = await createUser(env, {
    email: "Alice@Example.COM",
    password: "password-123",
    createdBy: "admin",
  });

  assert.equal(user.email, "alice@example.com");
  assert.equal((await findUserByEmail(env, "ALICE@example.com"))?.id, user.id);
});

test("同一邮箱不能建两个账号", async () => {
  const { env } = makeEnv();
  await createUser(env, { email: "dup@example.com", password: "password-123", createdBy: "admin" });
  await assert.rejects(
    () => createUser(env, { email: "DUP@example.com", password: "password-456", createdBy: "admin" }),
    /该邮箱已被占用/,
  );
});

test("按邮箱登录；未验证邮箱返回 unverified", async () => {
  const { env } = makeEnv();
  await createUser(env, {
    email: "pending@example.com",
    password: "password-123",
    emailVerified: false,
    createdBy: "self-register",
  });

  const result = await authenticateUserDetailed(env, "pending@example.com", "password-123");
  assert.equal(result.status, "unverified");
  assert.equal((await authenticateUserDetailed(env, "pending@example.com", "wrong-password")).status, "bad");
  assert.equal((await authenticateUserDetailed(env, "nobody@example.com", "password-123")).status, "bad");
});

test("改邮箱会重建索引，旧邮箱立即失效；删除账号后索引也清理", async () => {
  const { env } = makeEnv();
  const user = await createUser(env, { email: "old@example.com", password: "password-123", createdBy: "admin" });

  assert.equal(await updateUser(env, user.id, { email: "New@Example.com" }), true);
  assert.equal(await findUserByEmail(env, "old@example.com"), null);
  assert.equal((await findUserByEmail(env, "new@example.com"))?.id, user.id);

  assert.equal(await deleteUser(env, user.id), true);
  assert.equal(await findUserByEmail(env, "new@example.com"), null);
});
