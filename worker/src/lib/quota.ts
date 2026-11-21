/**
 * 额度判定的纯函数，方便单测覆盖边界（0 = 不限、刚好用完、超出）。
 * Key 级每日额度、用户级每日额度、用户级总限额共用同一套语义。
 */

/** 本批签名会不会超限；quota <= 0 表示不限 */
export function quotaReached(used: number, quota: number, incoming: number): boolean {
  if (!Number.isFinite(quota) || quota <= 0) return false;
  const already = Number.isFinite(used) ? Math.max(0, used) : 0;
  const add = Number.isFinite(incoming) ? Math.max(0, incoming) : 0;
  return already + add > quota;
}

/** 剩余次数；不限时返回 null，方便 UI 区分「无限」和「0」 */
export function quotaRemaining(used: number, quota: number): number | null {
  if (!Number.isFinite(quota) || quota <= 0) return null;
  return Math.max(0, quota - (Number.isFinite(used) ? Math.max(0, used) : 0));
}

/** 累计用量 = 名下所有 Key 的 totalSigns 之和 - 重置基准 */
export function totalUsed(totalSigns: readonly number[], base = 0): number {
  const sum = totalSigns.reduce((acc, value) => acc + (Number.isFinite(value) && value > 0 ? Math.floor(value) : 0), 0);
  const offset = Number.isFinite(base) && base > 0 ? Math.floor(base) : 0;
  return Math.max(0, sum - offset);
}

/** 表单里的额度数字：负数、NaN、小数统一成非负整数 */
export function normalizeQuota(raw: unknown): number {
  const value = typeof raw === "number" ? raw : Number(raw ?? 0);
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}
