import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const __nodeRequire =
  typeof require === "function" ? require : createRequire(import.meta.url);

const arabicReshaper: { convertArabic: (s: string) => string } =
  __nodeRequire("arabic-reshaper");
const bidiFactory: () => {
  getEmbeddingLevels: (s: string, dir?: "ltr" | "rtl") => unknown;
  getReorderedString: (s: string, levels: unknown) => string;
} = __nodeRequire("bidi-js");
const bidi = bidiFactory();

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** True if the string contains any Arabic code points. */
export function hasArabic(s: string): boolean {
  return !!s && ARABIC_RE.test(s);
}

/**
 * Reshape + bidi-reorder a string so it renders correctly with a static
 * Arabic font (Amiri) inside pdfkit which does no shaping itself.
 * Latin-only strings pass through unchanged.
 */
export function shapeArabic(s: string): string {
  if (!s) return s;
  if (!ARABIC_RE.test(s)) return s;
  const reshaped = arabicReshaper.convertArabic(s);
  const levels = bidi.getEmbeddingLevels(reshaped, "ltr");
  return bidi.getReorderedString(reshaped, levels);
}

/**
 * Locate a bundled font next to this module. In dev (tsx) the files live
 * under `./fonts/`. In a production esbuild bundle, build.mjs copies the
 * directory to `<distDir>/fonts/`.
 */
function findFont(filename: string): string | null {
  const candidates: string[] = [];
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.join(here, "fonts", filename));
  } catch {
    /* not ESM context */
  }
  if (typeof __dirname === "string") {
    candidates.push(path.join(__dirname, "fonts", filename));
    candidates.push(path.join(__dirname, "..", "fonts", filename));
  }
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

let cachedFontReg: Buffer | null = null;
let cachedFontBold: Buffer | null = null;

export function loadArabicFonts(): {
  regular: Buffer | null;
  bold: Buffer | null;
} {
  if (!cachedFontReg) {
    const p = findFont("Amiri-Regular.ttf");
    if (p) cachedFontReg = readFileSync(p);
  }
  if (!cachedFontBold) {
    const p = findFont("Amiri-Bold.ttf");
    if (p) cachedFontBold = readFileSync(p);
  }
  return { regular: cachedFontReg, bold: cachedFontBold };
}

export const ARABIC_FONT_REG = "ArabicBody";
export const ARABIC_FONT_BOLD = "ArabicBodyBold";

type PdfDocLike = {
  registerFont: (name: string, src: Buffer) => unknown;
  font: (name: string) => unknown;
};

/**
 * Register the bundled Amiri Arabic font on a pdfkit document and return
 * `useReg` / `useBold` helpers plus a `T` text-shaper. When the font files
 * are missing we transparently fall back to Helvetica so callers keep
 * working in a degraded mode rather than crashing.
 */
export function registerArabicFonts(doc: PdfDocLike): {
  useReg: () => void;
  useBold: () => void;
  T: (s: string) => string;
  hasArabicFont: boolean;
} {
  const fonts = loadArabicFonts();
  if (fonts.regular) doc.registerFont(ARABIC_FONT_REG, fonts.regular);
  if (fonts.bold) doc.registerFont(ARABIC_FONT_BOLD, fonts.bold);
  const useReg = () => {
    doc.font(fonts.regular ? ARABIC_FONT_REG : "Helvetica");
  };
  const useBold = () => {
    doc.font(
      fonts.bold
        ? ARABIC_FONT_BOLD
        : fonts.regular
          ? ARABIC_FONT_REG
          : "Helvetica-Bold",
    );
  };
  return {
    useReg,
    useBold,
    T: shapeArabic,
    hasArabicFont: !!fonts.regular,
  };
}
