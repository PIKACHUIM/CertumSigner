/**
 * 口令哈希：PBKDF2-HMAC-SHA256（1 万次迭代）+ 16 字节随机盐。
 *
 * 为什么是 1 万次：Workers 运行时的 WebCrypto 对 PBKDF2 迭代次数有硬上限 100,000，
 * 超过就直接抛 `Pbkdf2 failed: iteration counts above 100000 are not supported`；
 * 而免费版只有 10ms CPU 预算，10 万次实测约 23ms，1 万次约 2~3ms，剩下的留给页面与 KV 读写。
 * 迭代次数固定，不做旧格式兼容：不匹配的哈希一律当作校验失败。
 */
import { base64Decode, base64Encode } from "./pem.ts";
import { randomBytes } from "./encoding.ts";

/** 改这个值等于让所有已存口令失效，只能配合重置口令使用 */
export const PASSWORD_HASH_ITERATIONS = 10_000;

const SALT_BYTES = 16;
const HASH_BYTES = 32;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 8) throw new Error("口令至少 8 位");
  if (password.length > 200) throw new Error("口令过长");
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, PASSWORD_HASH_ITERATIONS);
  return `pbkdf2$${PASSWORD_HASH_ITERATIONS}$${base64Encode(salt)}$${base64Encode(hash)}`;
}

/** 账号不存在时也跑一次完整派生，避免用响应时间探测用户名 */
export const DUMMY_PASSWORD_HASH =
  `pbkdf2$${PASSWORD_HASH_ITERATIONS}$` +
  `${base64Encode(new Uint8Array(SALT_BYTES))}$${base64Encode(new Uint8Array(HASH_BYTES))}`;

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.trim().split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  if (Number(parts[1]) !== PASSWORD_HASH_ITERATIONS) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64Decode(parts[2]!);
    expected = base64Decode(parts[3]!);
  } catch {
    return false;
  }
  if (salt.length !== SALT_BYTES || expected.length !== HASH_BYTES) return false;

  const actual = await derive(password, salt, PASSWORD_HASH_ITERATIONS);
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}
