/**
 * 发信：Resend HTTP API（Workers 里不能直接发 SMTP）。
 * API Key / 发件人走 secret，代码里不出现任何真实凭据。
 */
import type { Env } from "../types";
import { readConfig } from "../store/config.ts";

const ENDPOINT = "https://api.resend.com/emails";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function mailConfigured(env: Env): Promise<boolean> {
  const config = await readConfig(env);
  return !!((env.RESEND_API_KEY ?? "").trim() && config.resendFrom);
}

/** 邮件里的绝对地址：优先后台配置的基础地址，否则按本次请求推导 */
export async function siteBase(env: Env, requestUrl: string): Promise<string> {
  const config = await readConfig(env);
  return config.publicBaseUrl || new URL(requestUrl).origin;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 统一的邮件外观：浅色卡片 + 一个大按钮，链接同时给纯文本兜底 */
export function mailTemplate(options: {
  title: string;
  lead: string;
  button: string;
  link: string;
  hint: string;
  footer: string;
}): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f5f9;font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;color:#1f2937">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:28px">
    <div style="font-weight:700;font-size:15px;color:#4f46e5">CertumSigner</div>
    <h1 style="font-size:20px;margin:16px 0 8px">${escapeHtml(options.title)}</h1>
    <p style="font-size:14px;line-height:1.7;color:#4b5563;margin:0 0 20px">${escapeHtml(options.lead)}</p>
    <a href="${escapeHtml(options.link)}"
      style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px">${escapeHtml(
        options.button,
      )}</a>
    <p style="font-size:12.5px;line-height:1.7;color:#6b7280;margin:20px 0 0">${escapeHtml(options.hint)}</p>
    <p style="font-size:12px;line-height:1.7;color:#9ca3af;margin:14px 0 0;word-break:break-all">${escapeHtml(options.link)}</p>
    <hr style="border:0;border-top:1px solid #eef0f4;margin:22px 0 14px">
    <p style="font-size:12px;color:#9ca3af;margin:0">${escapeHtml(options.footer)}</p>
  </div>
</body></html>`;
}

export async function sendMail(env: Env, message: MailMessage): Promise<void> {
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  const config = await readConfig(env);
  const from = config.resendFrom;
  if (!apiKey || !from) throw new Error("邮件服务未配置（缺少 RESEND_API_KEY 或发件人）");

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`邮件发送失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`);
  }
}
