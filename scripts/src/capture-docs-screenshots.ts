/**
 * Capture screenshots of every documented module page from the live
 * ERP and write them to `artifacts/docs/public/screenshots/{ar,en}/<slug>.png`.
 *
 * Intended to run after a successful deployment so that the user
 * manual stays visually in sync with the app. Best-effort: missing
 * Playwright, missing credentials, or missing routes do NOT fail the
 * post-merge pipeline — we just log and skip.
 *
 * Required env (the script no-ops unless DOCS_CAPTURE_ENABLED=1 to
 * avoid accidentally logging into a real production tenant and
 * publishing live customer screenshots into the public docs site):
 *   DOCS_CAPTURE_ENABLED=1  — explicit opt-in (REQUIRED).
 *   DOCS_CAPTURE_BASE_URL   — e.g. https://your-repl.replit.app
 *                             (defaults to http://localhost:80)
 *   DOCS_CAPTURE_EMAIL      — login email for a dedicated demo user.
 *   DOCS_CAPTURE_PASSWORD   — password for that demo user.
 *
 * Operators MUST point this at a dedicated demo tenant — never at
 * the production tenant — since the captured PNGs are written to
 * `artifacts/docs/public/screenshots/` and served unauthenticated.
 */
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { allModules } from "@workspace/docs-content";

const BASE_URL = process.env.DOCS_CAPTURE_BASE_URL ?? "http://localhost:80";
const EMAIL = process.env.DOCS_CAPTURE_EMAIL ?? "";
const PASSWORD = process.env.DOCS_CAPTURE_PASSWORD ?? "";

const OUT_ROOT = join(
  process.cwd(),
  "artifacts",
  "docs",
  "public",
  "screenshots",
);

interface ChromiumLauncher {
  launch: (opts: { headless: boolean }) => Promise<unknown>;
}

async function loadChromium(): Promise<ChromiumLauncher | null> {
  try {
    // Avoid a static `import "playwright"` so the script can be
    // typechecked without playwright as a dev dependency.
    const mod: unknown = await (Function('return import("playwright")')() as Promise<unknown>);
    return (mod as { chromium: ChromiumLauncher }).chromium;
  } catch {
    return null;
  }
}

async function main() {
  if (process.env.DOCS_CAPTURE_ENABLED !== "1") {
    console.log(
      "[docs-screenshots] DOCS_CAPTURE_ENABLED!=1 — skipping (set =1 + demo creds to enable).",
    );
    return;
  }
  const chromium = await loadChromium();
  if (!chromium) {
    console.warn(
      "[docs-screenshots] playwright not installed — skipping capture.",
    );
    return;
  }

  const browser = (await chromium.launch({ headless: true })) as {
    newContext: (opts?: unknown) => Promise<unknown>;
    close: () => Promise<void>;
  };

  for (const lang of ["ar", "en"] as const) {
    const outDir = join(OUT_ROOT, lang);
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const ctx = (await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: lang === "ar" ? "ar-SA" : "en-US",
    })) as {
      newPage: () => Promise<unknown>;
      close: () => Promise<void>;
    };
    const page = (await ctx.newPage()) as {
      goto: (u: string, o?: unknown) => Promise<unknown>;
      fill: (sel: string, val: string) => Promise<unknown>;
      click: (sel: string) => Promise<unknown>;
      waitForLoadState: (s: string) => Promise<unknown>;
      waitForTimeout: (ms: number) => Promise<unknown>;
      evaluate: (fn: (l: string) => unknown, arg: string) => Promise<unknown>;
      screenshot: (o: { fullPage?: boolean; type?: string }) => Promise<Buffer>;
    };

    // Best-effort login. If credentials are missing or login fails, we
    // still try to capture any public pages (e.g. /welcome).
    if (EMAIL && PASSWORD) {
      try {
        await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
        await page.fill('input[type="email"]', EMAIL);
        await page.fill('input[type="password"]', PASSWORD);
        await page.click('button[type="submit"]');
        await page.waitForLoadState("networkidle");
      } catch (err) {
        console.warn(`[docs-screenshots] login failed (${lang}):`, err);
      }
    }

    // Switch UI language to match capture lang.
    try {
      await page.evaluate(
        (l: string) => {
          (globalThis as { localStorage?: { setItem: (k: string, v: string) => void } })
            .localStorage?.setItem("hasba.lang", l);
        },
        lang,
      );
    } catch {
      /* no-op */
    }

    for (const m of allModules()) {
      if (!m.appPath) continue;
      const url = `${BASE_URL}${m.appPath}`;
      const out = join(outDir, `${m.slug}.png`);
      try {
        await page.goto(url, { waitUntil: "networkidle" });
        await page.waitForTimeout(800);
        const buf = await page.screenshot({ fullPage: false, type: "png" });
        if (!existsSync(dirname(out))) mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, buf);
        console.log(`[docs-screenshots] ${lang}/${m.slug}.png OK`);
      } catch (err) {
        console.warn(`[docs-screenshots] ${lang}/${m.slug} failed:`, err);
      }
    }

    await ctx.close();
  }

  await browser.close();
}

main().catch((err) => {
  console.error("[docs-screenshots] fatal:", err);
  // Never fail post-merge.
  process.exit(0);
});
