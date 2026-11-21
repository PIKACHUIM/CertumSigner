/**
 * 极简固定窗口限流：同一个 bucket 在窗口内最多 limit 次。
 *
 * KV 读改写不是原子的，并发下可能多放过一两次；这里的目标是挡住脚本刷接口
 * （比如拿一把 Key 反复往查杀服务上传文件），不是精确计费。
 */
import type { Env } from "../types";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
}

export async function takeRateLimit(
  env: Env,
  bucket: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const key = `rl:${bucket}`;
  const raw = await env.CERTUM_KV.get<{ count: number; firstAt: number }>(key, "json");
  const active = !!raw && now - raw.firstAt < windowSec * 1000;
  const count = (active ? raw!.count : 0) + 1;
  await env.CERTUM_KV.put(
    key,
    JSON.stringify({ count, firstAt: active ? raw!.firstAt : now }),
    { expirationTtl: Math.max(60, Math.floor(windowSec)) },
  );
  return { allowed: count <= limit, count, limit };
}
