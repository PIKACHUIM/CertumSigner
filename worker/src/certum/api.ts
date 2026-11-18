/**
 * 第 2/3 步：拿到卡片与证书，然后把摘要提交到云端 HSM 换取 RSA 签名。
 *
 * 所有 card/certificate/signature 接口都是异步任务：
 *   POST …/tasks  -> 202 {"atom:link": <轮询地址>, "ping-after": ms}
 *   GET  轮询地址 -> 303 {"atom:link": <结果地址>}
 *   GET  结果地址 -> 200 真正的载荷
 * 唯一的终止条件是「响应体里没有 atom:link」，而不是某个特定状态码。
 */
import { findPart } from "../lib/multipart";
import { derToPem } from "../lib/pem";
import type { SignAlgorithm } from "../types";
import type { CertumEndpoints } from "./config";
import { CertumError, snippet } from "./errors";

/** Certum 的 req.digesttype 取值 */
const DIGEST_TYPE: Record<SignAlgorithm, string> = {
  sha1: "SHA1",
  sha256: "SHA256",
  sha384: "SHA384",
  sha512: "SHA512",
};

export interface CardInfo {
  serial: string;
  label?: string;
  pinRequired?: boolean;
  validThru?: string;
}

export interface CardCertificate {
  /** 给人看 / 给 OpenSSL 解析的 PEM 文本 */
  pem: string;
  /** 服务端原样返回的字节，签名请求必须原样回传 */
  raw: Uint8Array;
}

const REQUEST_TIMEOUT_MS = 30_000;

export class CertumApi {
  constructor(
    private readonly endpoints: CertumEndpoints,
    private token: string,
  ) {}

  setToken(token: string): void {
    this.token = token;
  }

  private abs(link: string): string {
    if (/^https?:\/\//i.test(link)) return link;
    return `${this.endpoints.apiBase}/${link.replace(/^\/+/, "")}`;
  }

  private headers(extra?: Record<string, string>): Headers {
    const headers = new Headers(extra);
    // SCS 接口不带 Accept 会返回 400；证书结果是 multipart，所以两种都接受
    headers.set("accept", "multipart/form-data, application/json");
    headers.set("authorization", `Bearer ${this.token}`);
    return headers;
  }

  private async send(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, headers: this.headers(init.headers as Record<string, string>), signal: controller.signal });
    } catch (error) {
      throw new CertumError("network", `请求 Certum 云端失败：${String(error)}`, 502);
    } finally {
      clearTimeout(timer);
    }
  }

  /** 驱动异步任务直到拿到最终载荷 */
  private async runTask(initial: () => Promise<Response>): Promise<{ contentType: string; body: Uint8Array; text: string }> {
    let res = await initial();

    for (let round = 0; round < 40; round++) {
      const status = res.status;
      const contentType = res.headers.get("content-type") ?? "";
      const body = new Uint8Array(await res.arrayBuffer());

      if (status === 401 || status === 403) {
        throw new CertumError("unauthorized", `云端拒绝了访问（HTTP ${status}），会话可能已过期`, 401);
      }
      if (status >= 400) {
        throw new CertumError(
          "task_failed",
          `云端任务失败（HTTP ${status}）`,
          502,
          snippet(new TextDecoder().decode(body)),
        );
      }

      if (!contentType.includes("multipart")) {
        const text = new TextDecoder().decode(body);
        let json: Record<string, unknown> | null = null;
        if (text.trim().startsWith("{") || text.trim().startsWith("[")) {
          try {
            const parsed = JSON.parse(text) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
          } catch {
            json = null;
          }
        }

        if (json) {
          if (json["state"] === "failed") {
            const reason = typeof json["message"] === "string" ? json["message"] : "";
            // Certum 对不支持的摘要算法只回 digest.algorithm.error，直接翻译成人话
            if (reason === "digest.algorithm.error") {
              throw new CertumError(
                "digest_algorithm_unsupported",
                "云端不接受该摘要算法（digest.algorithm.error）：EV 证书通常只签 SHA256 / SHA384 / SHA512，SHA1 会被拒绝",
                400,
                snippet(text),
              );
            }
            throw new CertumError(
              "task_state_failed",
              `云端任务状态为 failed${reason ? `（${reason}）` : ""}`,
              502,
              snippet(text),
            );
          }
          const link = json["atom:link"];
          if (typeof link === "string" && link) {
            const ping = typeof json["ping-after"] === "number" ? (json["ping-after"] as number) : 500;
            await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(ping, 200), 2000)));
            res = await this.send(this.abs(link), { method: "GET" });
            continue;
          }
        }
      }

      return { contentType, body, text: new TextDecoder().decode(body) };
    }

    throw new CertumError("task_timeout", "云端任务在 40 次轮询后仍未完成", 504);
  }

  async listCards(): Promise<CardInfo[]> {
    const result = await this.runTask(() =>
      this.send(`${this.endpoints.apiBase}/card/v1/cards/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      throw new CertumError("cards_json", "卡片列表不是 JSON", 502, snippet(result.text));
    }
    const list = Array.isArray(parsed) ? parsed : [];
    return list
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => ({
        serial: String(item["cardno"] ?? ""),
        label: typeof item["label"] === "string" ? item["label"] : undefined,
        pinRequired: item["pinrequired"] === true,
        validThru: typeof item["validthru"] === "string" ? item["validthru"] : undefined,
      }))
      .filter((card) => card.serial);
  }

  async fetchCertificate(serial: string): Promise<CardCertificate> {
    const result = await this.runTask(() =>
      this.send(`${this.endpoints.apiBase}/card/v1/cards/${encodeURIComponent(serial)}/certificates/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );

    const part = findPart(result.body, result.contentType, "certificate");
    if (!part) {
      throw new CertumError("certificate_missing", "证书响应里没有 certificate 段", 502, snippet(result.text));
    }

    const bytes = part.data;
    const asText = new TextDecoder().decode(bytes);
    const isPem = asText.includes("-----BEGIN CERTIFICATE-----");
    const pem = isPem ? asText : derToPem(bytes);
    return { pem, raw: bytes };
  }

  /**
   * 请求云端签名。
   * Certum 的 req 结构是 {"digests":[...],"digesttype":"SHA256"}，
   * 支持一次提交多个摘要，返回顺序与请求顺序一致。
   */
  async signDigests(
    serial: string,
    certificateRaw: Uint8Array,
    digests: string[],
    algorithm: SignAlgorithm,
  ): Promise<string[]> {
    const reqJson = JSON.stringify({
      digests: digests.map((d) => d.toLowerCase()),
      digesttype: DIGEST_TYPE[algorithm],
    });

    const form = new FormData();
    form.append("req", new Blob([reqJson], { type: "application/json;charset=UTF-8" }));
    form.append("certificate", new Blob([certificateRaw], { type: "application/octet-stream" }), "blob");

    const result = await this.runTask(() =>
      this.send(`${this.endpoints.apiBase}/card/v1/cards/${encodeURIComponent(serial)}/certificates/signature`, {
        method: "POST",
        body: form,
      }),
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      throw new CertumError("signature_json", "签名结果不是 JSON", 502, snippet(result.text));
    }

    const map = new Map<string, string>();
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object") {
          for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
            if (typeof value === "string") map.set(key.toLowerCase(), value);
          }
        }
      }
    }

    return digests.map((digest) => {
      const found = map.get(digest.toLowerCase());
      if (!found) {
        throw new CertumError(
          "signature_missing",
          `云端没有返回摘要 ${digest.slice(0, 16)}… 的签名`,
          502,
          snippet(result.text),
        );
      }
      return found.toLowerCase();
    });
  }
}
