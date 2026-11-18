/**
 * 统计与签名明细。
 *
 * KV 没有原子自增，这里用“读-改-写”，并发极高时会丢计数；
 * 对签名代理来说这个精度足够，换取的是零额外依赖。
 */
import type { Env, SignAlgorithm, SignLogRecord, StatsBucket } from "../types";

const TOTAL_KEY = "stats:total";
const DAY_PREFIX = "stats:day:";
const LOG_PREFIX = "log:";
const LOG_TTL_SECONDS = 30 * 24 * 60 * 60;

export const emptyBucket = (): StatsBucket => ({
  requests: 0,
  ok: 0,
  fail: 0,
  sha1: 0,
  sha256: 0,
  signatures: 0,
});

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function bump(bucket: StatsBucket, algorithm: SignAlgorithm, ok: boolean, count: number): StatsBucket {
  bucket.requests += 1;
  if (ok) bucket.ok += 1;
  else bucket.fail += 1;
  if (algorithm === "sha1") bucket.sha1 += 1;
  else bucket.sha256 += 1;
  bucket.signatures += count;
  return bucket;
}

async function readBucket(env: Env, key: string): Promise<StatsBucket> {
  const value = await env.CERTUM_KV.get<StatsBucket>(key, "json");
  return { ...emptyBucket(), ...(value ?? {}) };
}

async function writeBucket(env: Env, key: string, bucket: StatsBucket, ttl?: number): Promise<void> {
  await env.CERTUM_KV.put(key, JSON.stringify(bucket), ttl ? { expirationTtl: ttl } : undefined);
}

/** 一次签名请求结束后调用（放在 waitUntil 里，不阻塞响应） */
export async function recordSign(
  env: Env,
  input: {
    record: SignLogRecord;
    algorithm: SignAlgorithm;
    ok: boolean;
    count: number;
  },
): Promise<void> {
  const dayKey = `${DAY_PREFIX}${today()}`;
  const [total, daily] = await Promise.all([readBucket(env, TOTAL_KEY), readBucket(env, dayKey)]);

  bump(total, input.algorithm, input.ok, input.count);
  bump(daily, input.algorithm, input.ok, input.count);

  const writes: Promise<void>[] = [
    writeBucket(env, TOTAL_KEY, total),
    writeBucket(env, dayKey, daily, 400 * 24 * 60 * 60),
  ];

  if (env.LOG_SIGNATURES !== "0") {
    const inverted = String(9_999_999_999_999 - input.record.at).padStart(13, "0");
    writes.push(
      env.CERTUM_KV.put(`${LOG_PREFIX}${inverted}:${input.record.id}`, JSON.stringify(input.record), {
        expirationTtl: LOG_TTL_SECONDS,
      }),
    );
    if (input.record.userId) {
      writes.push(
        env.CERTUM_KV.put(
          `ulog:${input.record.userId}:${inverted}:${input.record.id}`,
          JSON.stringify(input.record),
          { expirationTtl: LOG_TTL_SECONDS },
        ),
      );
    }
  }

  await Promise.all(writes);
}

export interface StatsSnapshot {
  total: StatsBucket;
  today: StatsBucket;
  days: Array<{ date: string; bucket: StatsBucket }>;
}

export async function readStats(env: Env, days = 7): Promise<StatsSnapshot> {
  const total = await readBucket(env, TOTAL_KEY);
  const todayBucket = await readBucket(env, `${DAY_PREFIX}${today()}`);

  const series: Array<{ date: string; bucket: StatsBucket }> = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    const bucket = await readBucket(env, `${DAY_PREFIX}${date}`);
    series.push({ date, bucket });
  }

  return { total, today: todayBucket, days: series };
}

export async function readRecentLogs(env: Env, limit = 50): Promise<SignLogRecord[]> {
  const list = await env.CERTUM_KV.list({ prefix: LOG_PREFIX, limit });
  const records: SignLogRecord[] = [];
  for (const item of list.keys) {
    const record = await env.CERTUM_KV.get<SignLogRecord>(item.name, "json");
    if (record) records.push(record);
  }
  return records.sort((a, b) => b.at - a.at);
}

/** 用户门户只展示自己的调用记录 */
export async function readUserLogs(env: Env, userId: string, limit = 30): Promise<SignLogRecord[]> {
  const list = await env.CERTUM_KV.list({ prefix: `ulog:${userId}:`, limit });
  const records: SignLogRecord[] = [];
  for (const item of list.keys) {
    const record = await env.CERTUM_KV.get<SignLogRecord>(item.name, "json");
    if (record) records.push(record);
  }
  return records.sort((a, b) => b.at - a.at);
}
