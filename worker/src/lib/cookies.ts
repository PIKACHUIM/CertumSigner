/**
 * 最小 Cookie 罐子。
 *
 * Workers 的 fetch 不带 cookie 语义（没有浏览器那种自动存取），
 * 而 Certum 的 CAS 登录依赖会话 cookie 在 authorize → login → callback 之间传递，
 * 所以这里自己收 Set-Cookie、自己拼 Cookie 头。
 */
export class CookieJar {
  private readonly store = new Map<string, string>();

  absorb(headers: Headers): void {
    let list: string[] = [];
    const maybe = headers as Headers & { getSetCookie?: () => string[] };
    if (typeof maybe.getSetCookie === "function") {
      list = maybe.getSetCookie();
    } else {
      const merged = headers.get("set-cookie");
      if (merged) list = [merged];
    }

    for (const raw of list) {
      const first = raw.split(";")[0] ?? "";
      const eq = first.indexOf("=");
      if (eq <= 0) continue;
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      // 服务端用空值 + 过期时间清理会话时，跟着删掉
      if (!value || /expires=thu, 01 jan 1970/i.test(raw)) this.store.delete(name);
      else this.store.set(name, value);
    }
  }

  header(): string {
    return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get size(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }
}
