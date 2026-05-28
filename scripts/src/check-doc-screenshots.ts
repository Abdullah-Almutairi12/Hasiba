import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { allModules } from "@workspace/docs-content";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const SCREENSHOTS_ROOT = join(REPO_ROOT, "artifacts", "docs", "public", "screenshots");
const LANGS = ["ar", "en"] as const;

function listSvgSlugs(dir: string): Set<string> {
  if (!existsSync(dir)) return new Set();
  return new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith(".svg"))
      .map((f) => f.slice(0, -".svg".length)),
  );
}

function diff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x)).sort();
}

const moduleSlugs = new Set(allModules().map((m) => m.slug));
const errors: string[] = [];

for (const lang of LANGS) {
  const dir = join(SCREENSHOTS_ROOT, lang);
  if (!existsSync(dir)) {
    errors.push(`Missing screenshots directory: ${dir}`);
    continue;
  }
  const svgSlugs = listSvgSlugs(dir);
  const missing = diff(moduleSlugs, svgSlugs);
  const orphan = diff(svgSlugs, moduleSlugs);
  if (missing.length > 0) {
    errors.push(
      `[${lang}] Missing screenshot SVGs for modules: ${missing.join(", ")}\n` +
        `  → expected files under ${dir}/<slug>.svg`,
    );
  }
  if (orphan.length > 0) {
    errors.push(
      `[${lang}] Orphan screenshot SVGs without a matching module: ${orphan.join(", ")}\n` +
        `  → remove the file(s) under ${dir} or add the module to lib/docs-content/src/index.ts`,
    );
  }
}

if (errors.length > 0) {
  console.error("Doc screenshot drift detected:\n");
  for (const e of errors) console.error("  " + e);
  console.error(
    `\nFix by either adding the missing screenshot SVGs, removing orphan files, ` +
      `or updating allModules() in lib/docs-content/src/index.ts so the two sets match.`,
  );
  process.exit(1);
}

console.log(
  `✓ Doc screenshots in sync: ${moduleSlugs.size} module(s) × ${LANGS.length} language(s).`,
);
