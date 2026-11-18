/** PEM / DER 小工具 */

export function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function base64Decode(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ""));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function derToPem(der: Uint8Array, label = "CERTIFICATE"): string {
  const b64 = base64Encode(der);
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/** 取第一个 CERTIFICATE 块；没有就返回 null */
export function pemToDer(pem: string): Uint8Array | null {
  const match = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem);
  if (!match?.[1]) return null;
  try {
    return base64Decode(match[1]);
  } catch {
    return null;
  }
}

/** 拆出多张证书（证书链场景） */
export function splitPemChain(pem: string): string[] {
  const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  return blocks ?? [];
}
