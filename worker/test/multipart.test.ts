import test from "node:test";
import assert from "node:assert/strict";
import { boundaryOf, findPart, parseMultipart } from "../src/lib/multipart.ts";
import { fromHex, normalizeHex, sha256Hex, toHex, constantTimeEqual } from "../src/lib/encoding.ts";

const boundary = "----BoundaryABC123";

function buildBody(parts: Array<{ name: string; value: string; filename?: string; type?: string }>): Uint8Array {
  let text = "";
  for (const part of parts) {
    text += `--${boundary}\r\n`;
    const filename = part.filename ? `; filename="${part.filename}"` : "";
    text += `Content-Disposition: form-data; name="${part.name}"${filename}\r\n`;
    text += `Content-Type: ${part.type ?? "application/octet-stream"}\r\n\r\n`;
    text += part.value;
    text += "\r\n";
  }
  text += `--${boundary}--\r\n`;
  return new TextEncoder().encode(text);
}

test("解析出 multipart 里的证书段", () => {
  const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
  const body = buildBody([
    { name: "res", value: "{}", type: "application/json" },
    { name: "certificate", value: pem, filename: "blob" },
  ]);

  const parts = parseMultipart(body, boundary);
  assert.equal(parts.length, 2);
  assert.equal(parts[0]?.name, "res");
  const cert = findPart(body, `multipart/form-data; boundary=${boundary}`, "certificate");
  assert.ok(cert);
  assert.equal(new TextDecoder().decode(cert!.data), pem);
  assert.equal(cert!.filename, "blob");
});

test("多段之间不会串内容", () => {
  const body = buildBody([
    { name: "a", value: "AAA" },
    { name: "b", value: "BBBB" },
    { name: "c", value: "CC" },
  ]);
  const parts = parseMultipart(body, boundary);
  assert.deepEqual(
    parts.map((p) => new TextDecoder().decode(p.data)),
    ["AAA", "BBBB", "CC"],
  );
});

test("找不到的段返回 null", () => {
  const body = buildBody([{ name: "a", value: "AAA" }]);
  assert.equal(findPart(body, `multipart/form-data; boundary="${boundary}"`, "missing"), null);
  assert.equal(findPart(body, "application/json", "a"), null);
});

test("从 Content-Type 提取 boundary", () => {
  assert.equal(boundaryOf('multipart/form-data; boundary="abc-1"'), "abc-1");
  assert.equal(boundaryOf("multipart/form-data; boundary=abc-1"), "abc-1");
  assert.equal(boundaryOf("application/json"), null);
});

test("hex 编解码与规范化", () => {
  const bytes = fromHex("00ff10Ab");
  assert.equal(toHex(bytes), "00ff10ab");
  assert.equal(normalizeHex("AA:BB CC\nDD"), "aabbccdd");
  assert.throws(() => fromHex("abc"));
  assert.throws(() => fromHex("zz"));
});

test("sha256 与常量时间比较", async () => {
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(constantTimeEqual("same", "same"), true);
  assert.equal(constantTimeEqual("same", "diff"), false);
  assert.equal(constantTimeEqual("short", "longer"), false);
});
