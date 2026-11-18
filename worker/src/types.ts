/**
 * 全局环境与数据结构定义。
 */

export interface Env {
  /** KV：API Key、统计、日志、会话、证书缓存都在这里 */
  CERTUM_KV: KVNamespace;

  /** SimplySign 登录邮箱 */
  CERTUM_EMAIL: string;
  /** otpauth:// URI（优先） */
  CERTUM_OTP_URI?: string;
  /** 或者直接给 Base32 种子 */
  CERTUM_OTP_SECRET?: string;
  CERTUM_OTP_ALGORITHM?: string;
  CERTUM_OTP_DIGITS?: string;
  CERTUM_OTP_PERIOD?: string;

  /** 云签名 API 根地址，默认 https://cloudsign.webnotarius.pl */
  CERTUM_API_BASE?: string;
  /** SimplySign Desktop 内置的公开 OAuth 客户端常量，一般不用改 */
  CERTUM_CLIENT_ID?: string;
  CERTUM_CLIENT_SECRET?: string;
  /** 额外中间证书（PEM），返回给客户端拼 PKCS#7 用 */
  CERTUM_CHAIN_PEM?: string;
  /** 账号下有多张卡片时，用证书 DER 的 SHA-1 指纹挑出要用的那张 */
  CERTUM_CERTIFICATE_SHA1?: string;

  /** 旧版管理员密码（secret）；没有 KV 管理员账号时作为回退登录方式 */
  ADMIN_PASSWORD: string;
  /** 管理员会话签名密钥（secret）；不配置时由初始化流程生成并存 KV */
  SESSION_SECRET: string;
  /** 设为 "0" 可关闭签名明细日志 */
  LOG_SIGNATURES?: string;
  /** /v1/timestamp 转发用的 RFC3161 服务，默认 http://time.certum.pl/ */
  TSA_UPSTREAM?: string;

  /** Resend 发信 API Key（secret）；不配置则注册/找回密码不可用 */
  RESEND_API_KEY?: string;
  /** 发件人，例如 "CertumSigner <noreply@example.com>" */
  RESEND_FROM?: string;
  /** 站点对外地址（可选），用于邮件里的绝对链接；默认按请求推导 */
  PUBLIC_BASE_URL?: string;
}

export type SignAlgorithm = "sha1" | "sha256" | "sha384" | "sha512";

/** 云端凭据（登录后缓存到 KV，避免每次签名都走一遍 OTP 登录） */
export interface CertumSession {
  token: string;
  refreshToken?: string;
  /** 毫秒时间戳 */
  expiresAt: number;
  email: string;
  createdAt: number;
  refreshedAt: number;
}

/** 云端 “卡片” + 签名证书缓存 */
export interface CardCache {
  serial: string;
  /** 服务端原样返回的 PEM，签名请求必须原样回传 */
  certificatePem: string;
  /** 服务端返回的原始字节（base64）；签名请求里要一字不差地回传 */
  certificateRawB64: string;
  /** 证书 DER 的 SHA-1 指纹（与 CERTUM_CERTIFICATE_SHA1 对应） */
  fingerprint1?: string;
  /** 证书 DER 的 SHA-256 指纹（供人核对，不是私钥信息） */
  fingerprint256: string;
  fetchedAt: number;
}

/** Certum 凭据：邮箱 + TOTP 种子 + 要用的证书指纹，存在 KV 里可以配多套 */
export interface CredentialRecord {
  id: string;
  label: string;
  email: string;
  /** otpauth:// URI，secret 就在里面 */
  otpUri: string;
  /** 证书 DER 的 SHA-1（可选）：账号下多张卡时用来挑证书 */
  certificateSha1?: string;
  enabled: boolean;
  createdAt: number;
  createdBy: string;
  lastUsedAt?: number;
  lastError?: string;
}

/** 普通用户：可以登录门户、自己建 API Key，只能使用分配给自己的凭据 */
export interface UserRecord {
  id: string;
  username: string;
  /** pbkdf2$迭代次数$salt$hash（Base64） */
  passwordHash: string;
  /** 注册/找回密码用的邮箱；管理员创建的用户可以没有 */
  email?: string;
  /** 通过邮件验证过邮箱；老用户没有该字段按已验证处理 */
  emailVerified?: boolean;
  enabled: boolean;
  expiresAt?: number;
  credentialIds: string[];
  /** 用户级每日签名上限，0 = 不限（Key 级额度仍然各自生效） */
  dailyQuota: number;
  createdAt: number;
  createdBy: string;
  lastLoginAt?: number;
}

export interface UserSessionRecord {
  id: string;
  userId: string;
  csrf: string;
  createdAt: number;
  expiresAt: number;
}

export interface ApiKeyRecord {
  id: string;
  /** 展示名 */
  name: string;
  /** 明文只返回一次，KV 里只存 SHA-256 */
  hash: string;
  /** 便于在列表里认出是哪把（前 12 位） */
  prefix: string;
  createdAt: number;
  createdBy: string;
  enabled: boolean;
  /** 0 = 不限 */
  dailyQuota: number;
  expiresAt?: number;
  lastUsedAt?: number;
  totalSigns: number;
  /** 归属用户；管理员建的空表示“平台 Key” */
  userId?: string;
  /** 绑定到哪套 Certum 凭据 */
  credentialId?: string;
}

export interface SignLogRecord {
  id: string;
  at: number;
  keyId: string;
  keyName: string;
  algorithm: SignAlgorithm;
  /** 摘要前 16 位十六进制，足够定位又不至于把业务哈希全存下来 */
  digestPrefix: string;
  count: number;
  ok: boolean;
  durationMs: number;
  ip: string;
  userAgent: string;
  error?: string;
  userId?: string;
  credentialId?: string;
}

export interface StatsBucket {
  requests: number;
  ok: number;
  fail: number;
  sha1: number;
  sha256: number;
  sha384: number;
  sha512: number;
  /** 云端签发的签名个数（批量为一次请求多个摘要） */
  signatures: number;
}

export interface AdminSessionRecord {
  id: string;
  csrf: string;
  createdAt: number;
  expiresAt: number;
}

/** 管理员账号：首次部署时在 /admin/setup 创建，口令只存 PBKDF2 哈希 */
export interface AdminAccountRecord {
  id: string;
  username: string;
  /** pbkdf2$迭代次数$salt$hash（Base64） */
  passwordHash: string;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
}
