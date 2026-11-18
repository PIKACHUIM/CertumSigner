/**
 * 用户口令哈希：PBKDF2-SHA256（15 万次迭代）+ 16 字节随机盐。
 * Workers 没有 scrypt/argon2，PBKDF2 是 WebCrypto 里唯一可用的慢哈希。
 * 存储格式：pbkdf2$<iterations>$<salt-b64>$<hash-b64>
 */
import { base64Decode, base64Encode } from "./pem.ts";
import { randomBytes } from "./encoding.ts";

const ITERATIONS = 150_000;
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
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${base64Encode(salt)}$${base64Encode(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.trim().split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10_000) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = base64Decode(parts[2]!);
    expected = base64Decode(parts[3]!);
  } catch {
    return false;
  }

  const actual = await derive(password, salt, iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}
