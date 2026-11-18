/** 云端错误：区分“凭据/网络问题”和“我们自己的 bug”，日志里也便于定位 */
export class CertumError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: string;

  constructor(code: string, message: string, status = 502, detail?: string) {
    super(message);
    this.name = "CertumError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** 把可能很长的响应体截断，避免把整页 HTML 塞进日志/响应 */
export function snippet(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
