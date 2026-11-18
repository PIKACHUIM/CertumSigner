import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../src/lib/passwords.ts";
import { maskOtpUri, normalizeOtpInput } from "../src/store/credentials.ts";

test("PBKDF2 口令哈希可验证，错误口令被拒绝", async () => {
  const stored = await hashPassword("correct horse battery staple");
  assert.match(stored, /^pbkdf2\$150000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(await verifyPassword("correct horse battery staple", stored), true);
  assert.equal(await verifyPassword("wrong password", stored), false);
});

test("同一口令每次哈希都不同（随机盐）", async () => {
  const a = await hashPassword("same-password-123");
  const b = await hashPassword("same-password-123");
  assert.notEqual(a, b);
  assert.equal(await verifyPassword("same-password-123", a), true);
  assert.equal(await verifyPassword("same-password-123", b), true);
});

test("过短口令直接拒绝", async () => {
  await assert.rejects(() => hashPassword("short"), /至少 8 位/);
});

test("损坏的哈希格式返回 false", async () => {
  assert.equal(await verifyPassword("whatever", "not-a-hash"), false);
  assert.equal(await verifyPassword("whatever", "pbkdf2$abc$xx$yy"), false);
});

test("裸 Base32 种子会补成 Certum 的 otpauth URI", () => {
  const uri = normalizeOtpInput("IZYDM3CNKM4EKV3NPJLG2UJQJNDE2QSIKY2VAQKXIFSFGSBUOAZA", "a@b.com");
  assert.match(uri, /^otpauth:\/\/totp\//);
  const params = new URLSearchParams(uri.slice(uri.indexOf("?") + 1));
  assert.equal(params.get("algorithm"), "SHA256");
  assert.equal(params.get("digits"), "6");
  assert.equal(params.get("period"), "30");
  assert.ok(params.get("secret"));
});

test("非法种子/URI 会被拒绝", () => {
  assert.throws(() => normalizeOtpInput("not base32 !!", "a@b.com"), /Base32/);
  assert.throws(() => normalizeOtpInput("otpauth://totp/x?a=1", "a@b.com"), /secret/);
});

test("掩码不会泄露种子", () => {
  const uri = normalizeOtpInput("IZYDM3CNKM4EKV3NPJLG2UJQJNDE2QSIKY2VAQKXIFSFGSBUOAZA", "a@b.com");
  const masked = maskOtpUri(uri);
  assert.match(masked, /secret \*{4}OAZA/);
  assert.ok(!masked.includes("IZYDM3CNKM4EKV3NPJLG"));
});
