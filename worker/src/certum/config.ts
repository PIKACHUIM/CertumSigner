/**
 * Certum 云签名接口的固定常量。
 *
 * 来源：SimplySign Desktop（本机安装的 9.x，.NET 4.6.1）反编译 + 实际 HTTPS 抓包。
 * 这些 client_id / client_secret 是随桌面客户端一起分发给所有用户的**公开客户端**凭据，
 * 不是账号持有人的机密；真正的机密是账号邮箱 + TOTP 种子。
 */

export interface CertumEndpoints {
  apiBase: string;
  authorizeUrl: string;
  loginUrl: string;
  tokenUrl: string;
  scope: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}

export const DEFAULT_API_BASE = "https://cloudsign.webnotarius.pl";
/** SimplySign Desktop 内置的 Web 登录 OAuth 客户端（20 字符，非 64 位 hex 的 PKCS#11 客户端） */
export const DEFAULT_CLIENT_ID = "44rvDKKEWY53a7xBeF5w";
export const DEFAULT_CLIENT_SECRET = "BRSE2u2nY3p3m77QHTt8";

export function resolveEndpoints(env: {
  CERTUM_API_BASE?: string;
  CERTUM_CLIENT_ID?: string;
  CERTUM_CLIENT_SECRET?: string;
}): CertumEndpoints {
  const apiBase = (env.CERTUM_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/+$/, "");
  return {
    apiBase,
    authorizeUrl: `${apiBase}/idp/oauth2.0/authorize`,
    loginUrl: `${apiBase}/idp/login`,
    tokenUrl: `${apiBase}/idp/oauth2.0/accessToken`,
    scope: `${apiBase}/idp/oauth2.0/profile`,
    redirectUri: `${apiBase}/redirect`,
    clientId: env.CERTUM_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID,
    clientSecret: env.CERTUM_CLIENT_SECRET?.trim() || DEFAULT_CLIENT_SECRET,
  };
}
