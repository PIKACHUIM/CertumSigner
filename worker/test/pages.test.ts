import test from "node:test";
import assert from "node:assert/strict";
import type { ApiKeyRecord, CredentialRecord, StatsBucket, UserRecord } from "../src/types.ts";
import { adminKeysPage, adminUserPage } from "../src/ui/admin-pages.ts";
import { userDashboardPage } from "../src/ui/user-pages.ts";
import { translator } from "../src/ui/i18n.ts";
import type { Prefs } from "../src/ui/prefs.ts";

const prefs: Prefs = { lang: "zh", theme: "aurora", mode: "auto" };
const t = translator("zh");
const csrf = "csrf-token";

const credential: CredentialRecord = {
  id: "cred_a",
  label: "第一张证书",
  email: "a@example.com",
  otpUri: "otpauth://totp/Certum:a@example.com?secret=JBSWY3DPEHPK3PXP",
  enabled: true,
  createdAt: 1,
  createdBy: "admin",
};

function makeUser(credentialIds: string[]): UserRecord {
  return {
    id: "user_1",
    email: "owner@example.com",
    passwordHash: "pbkdf2$100000$xx$yy",
    emailVerified: true,
    enabled: true,
    credentialIds,
    dailyQuota: 0,
    createdAt: 1,
    createdBy: "admin",
  };
}

function makeKey(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: "key_1",
    name: "桌面端",
    hash: "hash",
    prefix: "csk_Tzkb_1kF",
    createdAt: 1,
    createdBy: "admin",
    enabled: true,
    dailyQuota: 0,
    totalSigns: 0,
    userId: "user_1",
    credentialId: "cred_a",
    ...overrides,
  };
}

const emptyStats: StatsBucket = { requests: 0, ok: 0, fail: 0, sha1: 0, sha256: 0, sha384: 0, sha512: 0, signatures: 0 };

test("后台密钥列表标出证书已撤销分配的密钥", () => {
  const html = adminKeysPage({
    csrf,
    prefs,
    t,
    self: "/admin/keys",
    keys: [makeKey()],
    users: [makeUser([])],
    credentials: [credential],
  });
  assert.ok(html.includes("证书已撤销分配"), "撤销分配后要在列表里提示");
});

test("证书仍分配时不误报", () => {
  const html = adminKeysPage({
    csrf,
    prefs,
    t,
    self: "/admin/keys",
    keys: [makeKey()],
    users: [makeUser(["cred_a"])],
    credentials: [credential],
  });
  assert.ok(!html.includes("证书已撤销分配"));
});

test("平台密钥没有主人，不做分配校验", () => {
  const html = adminKeysPage({
    csrf,
    prefs,
    t,
    self: "/admin/keys",
    keys: [makeKey({ userId: undefined })],
    users: [makeUser([])],
    credentials: [credential],
  });
  assert.ok(!html.includes("证书已撤销分配"));
});

test("用户详情页同样标出失效密钥，编辑弹窗带上说明", () => {
  const html = adminUserPage({
    csrf,
    prefs,
    t,
    self: "/admin/users/user_1",
    user: makeUser([]),
    credentials: [credential],
    keys: [makeKey()],
    stats: { total: emptyStats },
  });
  assert.ok(html.includes("证书已撤销分配"));
  assert.ok(html.includes("重新分配证书或重建密钥"), "编辑弹窗要说明为什么签不了");
});

test("用户门户的密钥列表标出证书已撤销分配", () => {
  const html = userDashboardPage({
    csrf,
    prefs,
    t,
    self: "/user",
    user: makeUser([]),
    credentials: [],
    keys: [makeKey()],
    usage: {},
    logs: [],
  });
  assert.ok(html.includes("证书已撤销分配"));
});

test("后台用户详情显示总限额与已用量（扣掉重置基准）", () => {
  const html = adminUserPage({
    csrf,
    prefs,
    t,
    self: "/admin/users/user_1",
    user: { ...makeUser(["cred_a"]), totalQuota: 100, totalUsedBase: 2 },
    credentials: [credential],
    keys: [makeKey({ totalSigns: 7 }), makeKey({ id: "key_2", hash: "h2", totalSigns: 5 })],
    stats: { total: emptyStats },
  });
  assert.ok(html.includes("10/100"), "已用 12 减基准 2 应显示 10/100");
  assert.ok(html.includes("重置总用量"), "要提供重置按钮");
});

test("没设总限额时显示不限而不是 0", () => {
  const html = adminUserPage({
    csrf,
    prefs,
    t,
    self: "/admin/users/user_1",
    user: makeUser(["cred_a"]),
    credentials: [credential],
    keys: [makeKey({ totalSigns: 3 })],
    stats: { total: emptyStats },
  });
  assert.ok(html.includes("3/不限") || html.includes("3/Unlimited"), "不限时不能把上限显示成 0");
});

test("用户门户展示账号总配额，且不再暴露 Key 级额度输入", () => {
  const html = userDashboardPage({
    csrf,
    prefs,
    t,
    self: "/user",
    user: { ...makeUser(["cred_a"]), totalQuota: 50 },
    credentials: [credential],
    keys: [makeKey({ totalSigns: 8 })],
    usage: {},
    logs: [],
  });
  assert.ok(html.includes("总配额: 8/50"), "门户要能看到总配额进度");
  assert.ok(!html.includes('name="dailyQuota"'), "用户不能自己设置 Key 级额度");
});
