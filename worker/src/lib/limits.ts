/** 与资源限制有关的常量，集中放一处方便测试与调参 */

/** 每个账号最多能持有多少把 API Key：防止无限建 Key 绕过额度或把 KV 撑大 */
export const MAX_KEYS_PER_USER = 20;

export function keyLimitReached(count: number): boolean {
  return Number.isFinite(count) && count >= MAX_KEYS_PER_USER;
}
