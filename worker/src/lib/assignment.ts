import type { UserRecord } from "../types";

/**
 * Key 绑定的证书必须仍分配给 Key 的主人。
 *
 * 后台把证书从账号上撤掉（或换成另一张）之后，旧 Key 立刻不能再拿这套证书签名，
 * 否则「只勾了另一张证书」的账号还能用被撤掉的那张出签名。
 */
export interface AssignmentIssue {
  code: "account_unavailable" | "credential_not_assigned";
  message: string;
}

export function assignmentIssue(
  owner: Pick<UserRecord, "credentialIds"> | null,
  credentialId: string,
  credentialLabel: string,
): AssignmentIssue | null {
  if (!owner) {
    return { code: "account_unavailable", message: "这把 Key 的账号已被删除，请联系管理员" };
  }
  if (!owner.credentialIds.includes(credentialId)) {
    return {
      code: "credential_not_assigned",
      message: `这把 Key 绑定的证书${credentialLabel ? `「${credentialLabel}」` : ""}已不再分配给你，请在后台重新分配，或删除后重建 Key`,
    };
  }
  return null;
}
