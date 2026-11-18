/** multipart/form-data 的最小解析器（Workers 的响应体里证书就是 multipart） */

function indexOf(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  if (needle.length === 0) return -1;
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** 从 Content-Type 里取 boundary */
export function boundaryOf(contentType: string | null): string | null {
  if (!contentType) return null;
  const match = /boundary="?([^";]+)"?/i.exec(contentType);
  return match?.[1] ?? null;
}

export interface MultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  data: Uint8Array;
}

/**
 * 解析 multipart 正文。
 * 先按 "--boundary" 切分，再在每个分段里读头部、按 \r\n\r\n 分界取内容，
 * 最后去掉尾部 CRLF——不依赖 DOMParser/FormData，Node 里也能直接测。
 */
export function parseMultipart(body: Uint8Array, boundary: string): MultipartPart[] {
  const delimiter = ascii(`--${boundary}`);
  const crlf = ascii("\r\n");
  const separator = ascii("\r\n\r\n");
  const parts: MultipartPart[] = [];

  let start = indexOf(body, delimiter);
  if (start < 0) return parts;

  while (start >= 0) {
    let cursor = start + delimiter.length;
    // 结束标记 "--"
    if (body[cursor] === 0x2d && body[cursor + 1] === 0x2d) break;
    if (body[cursor] === 0x0d && body[cursor + 1] === 0x0a) cursor += 2;

    const next = indexOf(body, delimiter, cursor);
    if (next < 0) break;

    let chunk = body.subarray(cursor, next);
    // 每段结尾有一个 CRLF，属于分隔符而不是内容
    if (chunk.length >= 2 && chunk[chunk.length - 2] === 0x0d && chunk[chunk.length - 1] === 0x0a) {
      chunk = chunk.subarray(0, chunk.length - 2);
    }

    const sep = indexOf(chunk, separator);
    if (sep >= 0) {
      const headerText = new TextDecoder().decode(chunk.subarray(0, sep));
      const data = chunk.subarray(sep + separator.length);
      const name = /name="([^"]*)"/i.exec(headerText)?.[1] ?? "";
      const filename = /filename="([^"]*)"/i.exec(headerText)?.[1];
      const contentType = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim();
      parts.push({ name, filename, contentType, data });
    }

    start = next;
  }

  return parts;
}

export function findPart(body: Uint8Array, contentType: string | null, name: string): MultipartPart | null {
  const boundary = boundaryOf(contentType);
  if (!boundary) return null;
  return parseMultipart(body, boundary).find((p) => p.name === name) ?? null;
}
