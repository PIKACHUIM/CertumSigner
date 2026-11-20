import test from "node:test";
import assert from "node:assert/strict";
import type { Env } from "../src/types.ts";
import { sha256Hex } from "../src/lib/encoding.ts";
import {
  createApiKey,
  createApiKeyFromHash,
  deleteApiKey,
  findApiKeyById,
  rotateApiKeyToHash,
  verifyApiKey,
} from "../src/store/keys.ts";
import { createUser } from "../src/store/users.ts";

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
    async list(options?: { prefix?: string }) {
      const names = [...store.keys()].filter((name) => !options?.prefix || name.startsWith(options.prefix));
      return { keys: names.map((name) => ({ name })), list_complete: true, cacheStatus: null };
    },
  };
}

function makeEnv() {
  const kv = memoryKV();
  const env = { CERTUM_KV: kv } as unknown as Env;
  return { env, kv };
}

/** 模拟客户端本地生成：csk_ + 32 位 base64url，只把哈希发给平台 */
function clientKey() {
  const bytes = new Uint8Array(24);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 0xff;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const plaintext = `csk_${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  return { plaintext, prefix: plaintext.slice(0, 12) };
}

/** Key 绑在真实用户上才会校验归属，所以先建一个账号 */
async function makeUser(env: Env) {
  const user = await createUser(env, {
    email: `key-${Math.random().toString(16).slice(2)}@example.com`,
    password: "password-123",
    createdBy: "admin",
  });
  return user.id;
}

test("客户端本地生成的 Key：平台只存哈希，明文能通过校验", async () => {
  const { env, kv } = makeEnv();
  const ownerId = await makeUser(env);
  const local = clientKey();
  const hash = await sha256Hex(local.plaintext);

  const record = await createApiKeyFromHash(env, {
    name: "笔记本",
    createdBy: ownerId,
    userId: ownerId,
    credentialId: "cred_1",
    hash,
    prefix: local.prefix,
  });

  assert.equal(record.hash, hash);
  assert.equal(record.prefix, local.prefix);
  assert.equal(record.userId, ownerId);

  const verified = await verifyApiKey(env, local.plaintext);
  assert.equal(verified?.id, record.id);

  // 库里除了哈希没有明文
  const dump = [...kv.store.values()].join("\n");
  assert.ok(!dump.includes(local.plaintext));
  assert.ok(dump.includes(hash));
});

test("同一个哈希不能注册两次", async () => {
  const { env } = makeEnv();
  const local = clientKey();
  const hash = await sha256Hex(local.plaintext);
  const input = {
    name: "a",
    createdBy: "user_1",
    userId: "user_1",
    credentialId: "cred_1",
    hash,
    prefix: local.prefix,
  };
  await createApiKeyFromHash(env, input);
  await assert.rejects(() => createApiKeyFromHash(env, { ...input, name: "b" }), /已经注册过/);
});

test("哈希或前缀格式不对直接拒绝", async () => {
  const { env } = makeEnv();
  const base = { name: "a", createdBy: "u", userId: "u", credentialId: "c" };
  await assert.rejects(
    () => createApiKeyFromHash(env, { ...base, hash: "abc", prefix: "csk_abcdefgh" }),
    /哈希格式/,
  );
  await assert.rejects(
    () => createApiKeyFromHash(env, { ...base, hash: "a".repeat(64), prefix: "bad" }),
    /前缀格式/,
  );
});

test("换发后旧 Key 立即失效，名称与绑定的凭据不变", async () => {
  const { env } = makeEnv();
  const ownerId = await makeUser(env);
  const first = clientKey();
  const record = await createApiKeyFromHash(env, {
    name: "笔记本",
    createdBy: ownerId,
    userId: ownerId,
    credentialId: "cred_1",
    hash: await sha256Hex(first.plaintext),
    prefix: first.prefix,
  });

  const second = clientKey();
  second.plaintext = `${second.plaintext}x`;
  second.prefix = second.plaintext.slice(0, 12);
  const rotated = await rotateApiKeyToHash(env, record.id, await sha256Hex(second.plaintext), second.prefix);

  assert.equal(rotated?.id, record.id);
  assert.equal(rotated?.name, "笔记本");
  assert.equal(rotated?.credentialId, "cred_1");
  assert.equal(await verifyApiKey(env, first.plaintext), null);
  assert.equal((await verifyApiKey(env, second.plaintext))?.id, record.id);
});

test("删除平台 Key 后哈希记录一并消失", async () => {
  const { env } = makeEnv();
  const local = clientKey();
  const record = await createApiKeyFromHash(env, {
    name: "a",
    createdBy: "user_1",
    userId: "user_1",
    credentialId: "cred_1",
    hash: await sha256Hex(local.plaintext),
    prefix: local.prefix,
  });

  assert.equal(await deleteApiKey(env, record.id), true);
  assert.equal(await findApiKeyById(env, record.id), null);
  assert.equal(await verifyApiKey(env, local.plaintext), null);
});

test("旧路径（服务端生成明文）仍可用，便于旧客户端", async () => {
  const { env } = makeEnv();
  const ownerId = await makeUser(env);
  const created = await createApiKey(env, {
    name: "旧客户端",
    createdBy: ownerId,
    userId: ownerId,
    credentialId: "cred_1",
  });
  assert.match(created.plaintext, /^csk_/);
  assert.equal((await verifyApiKey(env, created.plaintext))?.id, created.record.id);
});
