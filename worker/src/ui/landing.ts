/** 站点主页：产品介绍 + 客户端下载（GitHub latest release） */
import { PAGE_CSS, escapeHtml, toolbar } from "./layout.ts";
import type { Translate } from "./i18n";
import type { Prefs } from "./prefs";

const REPO = "PIKACHUIM/CertumSigner";
const RELEASE = `https://github.com/${REPO}/releases/latest`;
const README = `https://github.com/${REPO}#readme`;

const ASSETS = {
  winX64Gui: "certumsigner-windows-x64-gui.zip",
  winX64Cli: "certumsigner-windows-x64-cli.zip",
  winArmGui: "certumsigner-windows-arm64-gui.zip",
  winArmCli: "certumsigner-windows-arm64-cli.zip",
  linuxX64Gui: "certumsigner-linux-x64-gui.tar.gz",
  linuxX64Cli: "certumsigner-linux-x64-cli.tar.gz",
  linuxArmGui: "certumsigner-linux-arm64-gui.tar.gz",
  linuxArmCli: "certumsigner-linux-arm64-cli.tar.gz",
};

const LANDING_CSS = `
.lp-nav {
  position: sticky; top: 0; z-index: 30; display: flex; align-items: center; gap: 20px;
  padding: 13px 30px; border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--bg) 84%, transparent); backdrop-filter: blur(14px);
}
.lp-brand { display: flex; align-items: center; gap: 10px; font-weight: 700; color: var(--ink); }
.lp-brand:hover { text-decoration: none; }
.lp-brand .logo {
  width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center;
  background: var(--grad); color: #fff; font-weight: 800; font-size: 14px;
}
.lp-brand .tag { display: block; font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: var(--muted-2); font-weight: 650; margin-top: 1px; }
.lp-links { display: flex; align-items: center; gap: 20px; margin-left: 14px; font-size: 13px; }
.lp-links a { color: var(--muted); font-weight: 550; }
.lp-links a:hover { color: var(--ink); text-decoration: none; }
.lp-nav .toolbar { margin-left: auto; }
.lp-signin { height: 34px; padding: 0 14px; font-size: 12.5px; }

.lp-wrap { max-width: 1160px; margin: 0 auto; padding: 0 30px; }
.lp-hero {
  position: relative; overflow: hidden; margin: 26px auto 0; max-width: 1160px;
  display: grid; grid-template-columns: minmax(0, 1.06fr) minmax(0, .94fr); gap: 44px; align-items: center;
  padding: 58px 52px 56px; border-radius: 26px; color: #e9effb;
  background:
    radial-gradient(720px 420px at 4% 0%, color-mix(in srgb, var(--brand) 46%, transparent), transparent 66%),
    radial-gradient(600px 420px at 96% 104%, color-mix(in srgb, var(--brand-2) 24%, transparent), transparent 70%),
    #0c1424;
  box-shadow: 0 40px 90px -60px rgba(8, 14, 28, .9);
}
.lp-kicker { font-size: 10.5px; letter-spacing: .2em; text-transform: uppercase; color: #93a5c6; font-weight: 650; }
.lp-hero h1 { margin: 16px 0 18px; font-size: clamp(30px, 3.6vw, 46px); line-height: 1.16; letter-spacing: -.03em; font-weight: 650; color: #fff; }
.lp-hero p.lead { margin: 0 0 28px; max-width: 520px; font-size: 14px; line-height: 1.85; color: #a9b8d1; }
.lp-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.lp-cta {
  display: inline-flex; align-items: center; gap: 10px; height: 42px; padding: 0 20px; border-radius: 10px;
  background: var(--grad); color: #fff; font-weight: 650; font-size: 13.5px; box-shadow: 0 16px 36px -20px color-mix(in srgb, var(--brand) 90%, transparent);
}
.lp-cta:hover { text-decoration: none; filter: brightness(1.06); }
.lp-ghost {
  display: inline-flex; align-items: center; height: 42px; padding: 0 18px; border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, .18); color: #dce5f5; font-weight: 600; font-size: 13px;
}
.lp-ghost:hover { text-decoration: none; background: rgba(255, 255, 255, .06); }
.lp-note { margin: 18px 0 0; font-size: 11.5px; color: #7c8eae; }
.lp-stats { display: flex; gap: 30px; flex-wrap: wrap; margin-top: 34px; padding-top: 22px; border-top: 1px solid rgba(255, 255, 255, .1); }
.lp-stats b { display: block; font-size: 14px; color: #fff; font-weight: 650; }
.lp-stats span { font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: #7c8eae; }

.lp-code { border: 1px solid rgba(255, 255, 255, .12); border-radius: 16px; background: rgba(4, 9, 18, .62); overflow: hidden; }
.lp-code .bar { display: flex; align-items: center; gap: 6px; padding: 11px 14px; border-bottom: 1px solid rgba(255, 255, 255, .08); }
.lp-code .bar i { width: 8px; height: 8px; border-radius: 50%; background: #33415c; }
.lp-code .bar span { margin-left: 8px; font-size: 10.5px; letter-spacing: .12em; color: #7c8eae; text-transform: uppercase; }
.lp-code pre { margin: 0; padding: 18px 18px 20px; font: 12.2px/1.85 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #c3d0e6; overflow-x: auto; }
.lp-code .m { color: #7dd3fc; }
.lp-code .k { color: #c4b5fd; }
.lp-code .s { color: #86efac; }
.lp-code .c { color: #64748b; }
.lp-code .ok { color: #4ade80; }

.lp-section { padding: 66px 0 0; }
.lp-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 26px; flex-wrap: wrap; }
.lp-head h2 { margin: 0; font-size: 24px; letter-spacing: -.02em; }
.lp-head p { margin: 6px 0 0; color: var(--muted); font-size: 13px; max-width: 620px; line-height: 1.7; }
.lp-features { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.lp-feature { background: var(--panel); border: 1px solid var(--line); border-radius: 16px; padding: 20px; box-shadow: var(--shadow); }
.lp-feature .ico { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: var(--brand-soft); color: var(--brand); margin-bottom: 14px; }
.lp-feature .ico svg { width: 18px; height: 18px; }
.lp-feature h3 { margin: 0 0 6px; font-size: 14px; }
.lp-feature p { margin: 0; font-size: 12.5px; line-height: 1.7; color: var(--muted); }

.lp-downloads { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.lp-dl { background: var(--panel); border: 1px solid var(--line); border-radius: 18px; padding: 20px 22px; box-shadow: var(--shadow); }
.lp-dl-head { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.lp-dl-head .ico { width: 32px; height: 32px; border-radius: 9px; display: grid; place-items: center; background: var(--neutral-soft); color: var(--ink); }
.lp-dl-head .ico svg { width: 17px; height: 17px; }
.lp-dl-head h3 { margin: 0; font-size: 15px; }
.lp-dl-head span { font-size: 11px; color: var(--muted-2); letter-spacing: .06em; text-transform: uppercase; }
.lp-dl-row { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 12px; align-items: center; padding: 13px 0; border-top: 1px solid var(--line-2); }
.lp-dl-row:first-of-type { margin-top: 8px; }
.lp-arch { font-size: 12px; font-weight: 650; color: var(--muted); letter-spacing: .04em; }
.lp-dl-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.lp-dl-btn {
  display: inline-flex; align-items: center; gap: 7px; padding: 8px 13px; border-radius: 9px;
  border: 1px solid var(--line); background: var(--panel-2); color: var(--ink); font-size: 12.5px; font-weight: 600;
}
.lp-dl-btn:hover { text-decoration: none; border-color: var(--brand); color: var(--brand); }
.lp-dl-btn.primary { background: var(--brand-soft); border-color: color-mix(in srgb, var(--brand) 26%, transparent); color: var(--brand); }
.lp-dl-btn small { font-weight: 500; color: var(--muted-2); }
.lp-dl-note { margin: 16px 0 0; font-size: 12px; color: var(--muted-2); }
.lp-dl-note a { color: var(--muted); text-decoration: underline; }

.lp-docs {
  margin-top: 66px; display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap;
  border: 1px solid var(--line); border-radius: 20px; padding: 26px 28px;
  background: linear-gradient(135deg, var(--brand-soft), transparent 62%), var(--panel);
}
.lp-docs h2 { margin: 0 0 6px; font-size: 18px; }
.lp-docs p { margin: 0; color: var(--muted); font-size: 13px; }
.lp-footer {
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  margin-top: 54px; padding: 22px 0 34px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted-2);
}
.lp-footer a { color: var(--muted); }

@media (max-width: 980px) {
  .lp-hero { grid-template-columns: 1fr; padding: 40px 30px; gap: 30px; border-radius: 20px; }
  .lp-features { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .lp-nav { padding: 11px 16px; gap: 10px; }
  .lp-links { display: none; }
  .lp-wrap { padding: 0 16px; }
  .lp-hero { margin-top: 14px; padding: 30px 22px 32px; }
  .lp-stats { gap: 20px; }
  .lp-section { padding-top: 46px; }
  .lp-features, .lp-downloads { grid-template-columns: 1fr; }
  .lp-dl-row { grid-template-columns: 1fr; gap: 8px; }
  .lp-docs { margin-top: 46px; padding: 20px; }
}
`;

const ICON = {
  shield:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3l7 3v5.2c0 4.3-2.9 7.7-7 9.8-4.1-2.1-7-5.5-7-9.8V6l7-3z"/><path d="M9 12l2.2 2.2L15.4 10"/></svg>',
  layers:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
  gauge:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 14l3.5-3.5"/><circle cx="12" cy="14" r="1.4" fill="currentColor" stroke="none"/></svg>',
  window:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18"/><path d="M7 6.5h.01M10 6.5h.01"/></svg>',
  windows:
    '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>',
  linux:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9l2.5 2L7 13"/><path d="M12 15h5"/></svg>',
};

function downloadRow(arch: string, gui: string, cli: string, t: Translate): string {
  return `<div class="lp-dl-row">
    <div class="lp-arch">${escapeHtml(arch)}</div>
    <div class="lp-dl-actions">
      <a class="lp-dl-btn primary" href="${RELEASE}/download/${gui}">${escapeHtml(t("home.gui"))} <small>↓</small></a>
      <a class="lp-dl-btn" href="${RELEASE}/download/${cli}">${escapeHtml(t("home.cli"))} <small>↓</small></a>
    </div>
  </div>`;
}

export function landingPage(data: { prefs: Prefs; t: Translate }): string {
  const { t, prefs } = data;

  const features = [
    { icon: ICON.shield, title: t("home.f1Title"), text: t("home.f1Text") },
    { icon: ICON.layers, title: t("home.f2Title"), text: t("home.f2Text") },
    { icon: ICON.gauge, title: t("home.f3Title"), text: t("home.f3Text") },
    { icon: ICON.window, title: t("home.f4Title"), text: t("home.f4Text") },
  ]
    .map(
      (item) => `<article class="lp-feature">
        <div class="ico">${item.icon}</div>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.text)}</p>
      </article>`,
    )
    .join("");

  return `<!doctype html>
<html lang="${prefs.lang === "zh" ? "zh-CN" : "en"}" data-theme="${prefs.theme}" data-mode="${prefs.mode}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>CertumSigner · ${escapeHtml(t("brand.tagline"))}</title>
<style>${PAGE_CSS}${LANDING_CSS}</style>
</head>
<body>
<header class="lp-nav">
  <a class="lp-brand" href="/">
    <span class="logo">C</span>
    <span>CertumSigner<span class="tag">${escapeHtml(t("brand.tagline"))}</span></span>
  </a>
  <nav class="lp-links">
    <a href="#features">${escapeHtml(t("home.navFeatures"))}</a>
    <a href="#download">${escapeHtml(t("home.navDownload"))}</a>
    <a href="${README}" target="_blank" rel="noreferrer">${escapeHtml(t("home.navDocs"))}</a>
  </nav>
  ${toolbar(prefs, t, "/")}
  <a class="btn btn--primary lp-signin" href="/user/login">${escapeHtml(t("home.signIn"))}</a>
</header>

<section class="lp-hero">
  <div>
    <div class="lp-kicker">${escapeHtml(t("home.heroKicker"))}</div>
    <h1>${escapeHtml(t("home.heroTitle"))}</h1>
    <p class="lead">${escapeHtml(t("home.heroLead"))}</p>
    <div class="lp-actions">
      <a class="lp-cta" href="/user/login">${escapeHtml(t("home.heroCta"))}<span>→</span></a>
      <a class="lp-ghost" href="/admin/login">${escapeHtml(t("home.admin"))}</a>
    </div>
    <p class="lp-note">${escapeHtml(t("home.heroNote"))}</p>
    <div class="lp-stats">
      <div><b>${escapeHtml(t("home.statPlatforms"))}</b><span>platform</span></div>
      <div><b>${escapeHtml(t("home.statArch"))}</b><span>arch</span></div>
      <div><b>${escapeHtml(t("home.statForms"))}</b><span>builds</span></div>
    </div>
  </div>
  <div class="lp-code">
    <div class="bar"><i></i><i></i><i></i><span>POST /v1/sign</span></div>
    <pre><span class="k">Authorization</span>: Bearer <span class="m">csk_…</span>

{
  <span class="s">"hashes"</span>: [<span class="s">"9f2c…"</span>, <span class="s">"1a77…"</span>],
  <span class="s">"algorithm"</span>: <span class="s">"sha256"</span>
}

<span class="ok">200 OK</span>
{
  <span class="s">"signatures"</span>: [<span class="s">"a1b2…"</span>],
  <span class="s">"certificate"</span>: { <span class="s">"serial"</span>: <span class="s">"…"</span> }
}
<span class="c">// 私钥不出云端 HSM</span></pre>
  </div>
</section>

<div class="lp-wrap">
  <section class="lp-section" id="features">
    <div class="lp-head">
      <div>
        <h2>${escapeHtml(t("home.featuresTitle"))}</h2>
        <p>${escapeHtml(t("home.featuresLead"))}</p>
      </div>
    </div>
    <div class="lp-features">${features}</div>
  </section>

  <section class="lp-section" id="download">
    <div class="lp-head">
      <div>
        <h2>${escapeHtml(t("home.downloadTitle"))}</h2>
        <p>${escapeHtml(t("home.downloadLead"))}</p>
      </div>
    </div>
    <div class="lp-downloads">
      <article class="lp-dl">
        <div class="lp-dl-head">
          <span class="ico">${ICON.windows}</span>
          <div><h3>${escapeHtml(t("home.platformWindows"))}</h3><span>.zip</span></div>
        </div>
        ${downloadRow(t("home.archX64"), ASSETS.winX64Gui, ASSETS.winX64Cli, t)}
        ${downloadRow(t("home.archArm64"), ASSETS.winArmGui, ASSETS.winArmCli, t)}
        <p class="lp-dl-note">${escapeHtml(t("home.guiHint"))} · ${escapeHtml(t("home.cliHint"))}</p>
      </article>
      <article class="lp-dl">
        <div class="lp-dl-head">
          <span class="ico">${ICON.linux}</span>
          <div><h3>${escapeHtml(t("home.platformLinux"))}</h3><span>.tar.gz</span></div>
        </div>
        ${downloadRow(t("home.archX64"), ASSETS.linuxX64Gui, ASSETS.linuxX64Cli, t)}
        ${downloadRow(t("home.archArm64"), ASSETS.linuxArmGui, ASSETS.linuxArmCli, t)}
        <p class="lp-dl-note">${escapeHtml(t("home.guiHint"))} · ${escapeHtml(t("home.cliHint"))}</p>
      </article>
    </div>
    <p class="lp-dl-note">${escapeHtml(t("home.latestNote"))} <a href="${RELEASE}" target="_blank" rel="noreferrer">GitHub Releases ↗</a></p>
  </section>

  <section class="lp-docs">
    <div>
      <h2>${escapeHtml(t("home.docsTitle"))}</h2>
      <p>${escapeHtml(t("home.docsText"))}</p>
    </div>
    <a class="btn btn--primary" href="${README}" target="_blank" rel="noreferrer">${escapeHtml(t("home.docsLink"))}</a>
  </section>

  <footer class="lp-footer">
    <span>© ${new Date().getUTCFullYear()} CertumSigner · ${escapeHtml(t("home.footer"))}</span>
    <span><a href="/user/login">${escapeHtml(t("home.signIn"))}</a> · <a href="/admin/login">${escapeHtml(
      t("home.admin"),
    )}</a></span>
  </footer>
</div>
<script>
document.addEventListener('click', (event) => {
  document.querySelectorAll('details.menu[open]').forEach((node) => {
    if (!event.target.closest('details.menu')) node.open = false;
  });
});
</script>
</body>
</html>`;
}
