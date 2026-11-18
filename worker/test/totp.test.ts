import test from "node:test";
import assert from "node:assert/strict";
import { base32Decode, parseOtpUri, resolveOtpConfig, secondsLeft, totpAt } from "../src/lib/totp.ts";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

test("base32 解码 RFC 4648 已知值", () => {
  const decoded = base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.equal(new TextDecoder().decode(decoded), "12345678901234567890");
});

test("base32 解码容忍小写、空格与填充", () => {
  const decoded = base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq====");
  assert.equal(new TextDecoder().decode(decoded), "12345678901234567890");
});

test("TOTP SHA-1 命中 RFC 6238 测试向量", async () => {
  const cfg = { secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", digits: 8, period: 30, algorithm: "SHA1" as const };
  assert.equal(await totpAt(cfg, 59), "94287082");
  assert.equal(await totpAt(cfg, 1111111109), "07081804");
  assert.equal(await totpAt(cfg, 1234567890), "89005924");
});

test("TOTP SHA-256 命中 RFC 6238 测试向量（Certum 默认算法）", async () => {
  const seed = new TextEncoder().encode("12345678901234567890123456789012");
  const cfg = { secret: base32Encode(seed), digits: 8, period: 30, algorithm: "SHA256" as const };
  assert.equal(await totpAt(cfg, 59), "46119246");
  assert.equal(await totpAt(cfg, 1111111109), "68084774");
});

test("TOTP 输出位数由 digits 控制", async () => {
  const seed = new TextEncoder().encode("12345678901234567890123456789012");
  const cfg = { secret: base32Encode(seed), digits: 6, period: 30, algorithm: "SHA256" as const };
  const code = await totpAt(cfg, 59);
  assert.equal(code.length, 6);
  assert.equal(code, "119246");
});

test("解析 otpauth URI", () => {
  const parsed = parseOtpUri(
    "otpauth://totp/Certum:someone@example.com?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=6&period=30",
  );
  assert.equal(parsed.secret, "JBSWY3DPEHPK3PXP");
  assert.equal(parsed.algorithm, "SHA256");
  assert.equal(parsed.digits, 6);
  assert.equal(parsed.period, 30);
});

test("URI 优先于裸种子，且非法种子立刻报错", () => {
  const cfg = resolveOtpConfig({
    uri: "otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&algorithm=SHA1&digits=6&period=30",
    secret: "SHOULD_NOT_WIN",
  });
  assert.equal(cfg.secret, "JBSWY3DPEHPK3PXP");
  assert.equal(cfg.algorithm, "SHA1");

  assert.throws(() => resolveOtpConfig({ secret: "!!!!" }), /Base32/);
  assert.throws(() => resolveOtpConfig({}), /OTP 种子不能为空/);
});

test("剩余有效时间在 1..period 之间", () => {
  const cfg = { secret: "JBSWY3DPEHPK3PXP", digits: 6, period: 30, algorithm: "SHA1" as const };
  const left = secondsLeft(cfg, 59_000);
  assert.ok(left >= 1 && left <= 30);
});
