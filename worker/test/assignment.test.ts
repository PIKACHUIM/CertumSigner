import test from "node:test";
import assert from "node:assert/strict";

import { assignmentIssue } from "../src/lib/assignment.ts";

const owner = (credentialIds: string[]) => ({ credentialIds });

test("证书仍分配给账号时不报错", () => {
  assert.equal(assignmentIssue(owner(["cred_a", "cred_b"]), "cred_a", "第一张证书"), null);
});

test("证书被换成另一张后拒绝", () => {
  const issue = assignmentIssue(owner(["cred_b"]), "cred_a", "第一张证书");
  assert.ok(issue);
  assert.equal(issue.code, "credential_not_assigned");
  assert.ok(issue.message.includes("第一张证书"), "提示里要写清是哪张证书");
});

test("证书被清空后同样拒绝", () => {
  const issue = assignmentIssue(owner([]), "cred_a", "第一张证书");
  assert.ok(issue);
  assert.equal(issue.code, "credential_not_assigned");
});

test("没有证书名时提示也不为空", () => {
  const issue = assignmentIssue(owner(["cred_b"]), "cred_a", "");
  assert.ok(issue);
  assert.ok(issue.message.includes("已不再分配给你"));
});

test("账号被删掉时给出账号级提示", () => {
  const issue = assignmentIssue(null, "cred_a", "第一张证书");
  assert.ok(issue);
  assert.equal(issue.code, "account_unavailable");
});
