/**
 * Generate annotated screenshot stand-ins for every documented module
 * and write them to `artifacts/docs/public/screenshots/{ar,en}/<slug>.{svg,png}`.
 *
 * Each generated image is a stylised mockup of the module's main screen
 * — sidebar nav, header chrome, page title and body placeholders — with
 * numbered callout circles drawn at the hotspot percentages declared in
 * `lib/docs-content` (the same data drives the in-app docs legend and
 * the PDF legend, so the numbers stay in sync across surfaces).
 *
 * This script is the offline fallback used until the live capture
 * pipeline (`capture-docs-screenshots.ts`) is wired up against a demo
 * tenant. Re-run it whenever module slugs, app paths, or hotspots
 * change so the on-disk PNGs match the data model.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { allModules, type DocModule, type Lang } from "@workspace/docs-content";

// Resolve relative to the repo root so the script works regardless of
// whether pnpm runs it from `scripts/` (via --filter) or from the
// monorepo root.
const REPO_ROOT = resolve(process.cwd(), process.cwd().endsWith("/scripts") ? ".." : ".");
const OUT_ROOT = resolve(REPO_ROOT, "artifacts/docs/public/screenshots");

const WIDTH = 1280;
const HEIGHT = 720;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildSvg(m: DocModule, lang: Lang): string {
  const isRtl = lang === "ar";
  const title = esc(m.title[lang]);
  const summary = esc(m.summary[lang]);
  const appPath = esc(m.appPath ?? "/");
  const dir = isRtl ? "rtl" : "ltr";
  const textAnchor = isRtl ? "end" : "start";
  const titleX = isRtl ? WIDTH - 280 : 280;
  const sideX = isRtl ? WIDTH - 232 : 24;
  const fontStack = "'IBM Plex Sans Arabic','Inter','Segoe UI',sans-serif";

  const navItems = [
    { ar: "لوحة القيادة", en: "Dashboard" },
    { ar: "نقطة البيع", en: "POS" },
    { ar: "المنتجات", en: "Products" },
    { ar: "العملاء", en: "Customers" },
    { ar: "المحاسبة", en: "Accounting" },
    { ar: "التقارير", en: "Reports" },
    { ar: "الفروع", en: "Branches" },
    { ar: "الإعدادات", en: "Settings" },
  ];

  const navHtml = navItems
    .map((item, i) => {
      const y = 96 + i * 56;
      const active = item[lang] === m.title[lang];
      const bg = active ? "#1e293b" : "transparent";
      const fg = active ? "#38bdf8" : "#cbd5e1";
      return `
        <rect x="${sideX}" y="${y}" width="208" height="40" rx="8" fill="${bg}"/>
        <text x="${sideX + (isRtl ? 192 : 16)}" y="${y + 26}" fill="${fg}" font-size="14" font-weight="500" text-anchor="${isRtl ? "end" : "start"}" direction="${dir}">${esc(item[lang])}</text>
      `;
    })
    .join("");

  // Stylised content tiles to suggest "real screen" without faking specific data.
  const tiles = `
    <rect x="${isRtl ? 100 : 264}" y="180" width="240" height="120" rx="12" fill="#ffffff" stroke="#e2e8f0"/>
    <rect x="${isRtl ? 360 : 524}" y="180" width="240" height="120" rx="12" fill="#ffffff" stroke="#e2e8f0"/>
    <rect x="${isRtl ? 620 : 784}" y="180" width="240" height="120" rx="12" fill="#ffffff" stroke="#e2e8f0"/>
    <rect x="${isRtl ? 880 : 1044}" y="180" width="156" height="120" rx="12" fill="#ffffff" stroke="#e2e8f0"/>
    <rect x="${isRtl ? 100 : 264}" y="320" width="640" height="280" rx="12" fill="#ffffff" stroke="#e2e8f0"/>
    <rect x="${isRtl ? 760 : 924}" y="320" width="276" height="280" rx="12" fill="#ffffff" stroke="#e2e8f0"/>
  `;

  // Hotspot markers (numbered circles) drawn at percentage coords.
  const markers = (m.hotspots ?? [])
    .map((h) => {
      const cx = (h.x / 100) * WIDTH;
      const cy = (h.y / 100) * HEIGHT;
      return `
        <circle cx="${cx}" cy="${cy}" r="22" fill="#0ea5e9" stroke="#ffffff" stroke-width="3"/>
        <text x="${cx}" y="${cy + 6}" fill="#ffffff" font-size="20" font-weight="700" text-anchor="middle">${h.n}</text>
      `;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="${fontStack}" direction="${dir}">
  <defs>
    <linearGradient id="appbg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f8fafc"/>
      <stop offset="100%" stop-color="#eef2f7"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#appbg)"/>
  <!-- Top app bar -->
  <rect x="0" y="0" width="${WIDTH}" height="56" fill="#0f172a"/>
  <text x="${isRtl ? WIDTH - 24 : 24}" y="36" fill="#f8fafc" font-size="16" font-weight="700" text-anchor="${textAnchor}">حاسبة.AI</text>
  <text x="${isRtl ? 24 : WIDTH - 24}" y="36" fill="#94a3b8" font-size="13" text-anchor="${isRtl ? "start" : "end"}">${appPath}</text>
  <!-- Sidebar -->
  <rect x="${isRtl ? WIDTH - 256 : 0}" y="56" width="256" height="${HEIGHT - 56}" fill="#0f172a"/>
  ${navHtml}
  <!-- Header -->
  <text x="${titleX}" y="120" fill="#0f172a" font-size="28" font-weight="700" text-anchor="${textAnchor}">${title}</text>
  <text x="${titleX}" y="150" fill="#64748b" font-size="14" text-anchor="${textAnchor}">${summary}</text>
  <!-- Content tiles -->
  ${tiles}
  <!-- Hotspot markers -->
  ${markers}
</svg>`;
}

function main() {
  let okCount = 0;
  for (const lang of ["ar", "en"] as const) {
    for (const m of allModules()) {
      const svg = buildSvg(m, lang);
      const dir = join(OUT_ROOT, lang);
      mkdirSync(dirname(join(dir, `${m.slug}.svg`)), { recursive: true });
      writeFileSync(join(dir, `${m.slug}.svg`), svg, "utf8");
      const png = new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } }).render().asPng();
      writeFileSync(join(dir, `${m.slug}.png`), png);
      okCount += 1;
    }
  }
  console.log(`[gen-doc-screenshots] wrote ${okCount} svg+png pairs to ${OUT_ROOT}`);
}

main();
