import test from "node:test";
import assert from "node:assert/strict";
import { credentialCacheImpact } from "../src/store/credentials.ts";

const existing = { email: "old@example.com", certificateSha1: "a".repeat(40) };

test("只改名字/查杀设置时不动缓存", () => {
  const impact = credentialCacheImpact(existing, {
    email: "old@example.com",
    certificateSha1: existing.certificateSha1,
  });
  assert.equal(impact.session, false);
  assert.equal(impact.card, false);
});

test("改登录邮箱要作废会话与卡片", () => {
  const impact = credentialCacheImpact(existing, { email: "new@example.com" });
  assert.equal(impact.session, true);
  assert.equal(impact.card, true);
});

test("邮箱大小写不同不算换账号", () => {
  const impact = credentialCacheImpact(existing, { email: "OLD@Example.com" });
  assert.equal(impact.session, false);
});

test("换 TOTP 种子要作废会话", () => {
  const impact = credentialCacheImpact(existing, { otp: "JBSWY3DPEHPK3PXP" });
  assert.equal(impact.session, true);
  assert.equal(impact.card, true);
});

test("只换证书指纹时保留会话、丢掉卡片缓存", () => {
  const impact = credentialCacheImpact(existing, { certificateSha1: "b".repeat(40) });
  assert.equal(impact.session, false);
  assert.equal(impact.card, true);
});

test("清掉证书指纹也要丢卡片缓存", () => {
  const impact = credentialCacheImpact(existing, { certificateSha1: "" });
  assert.equal(impact.card, true);
});

test("指纹没变（含冒号大写写法）时不动缓存", () => {
  const impact = credentialCacheImpact(existing, {
    certificateSha1: "AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA:AA",
  });
  assert.equal(impact.card, false);
});
