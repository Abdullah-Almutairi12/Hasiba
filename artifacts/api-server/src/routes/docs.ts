import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router, type IRouter, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import {
  DOC_CATEGORIES,
  DOCS_VERSION,
  FAQ,
  GLOSSARY,
  QUICK_START,
  allModules,
  findModule,
  type DocModule,
  type Lang,
} from "@workspace/docs-content";
import { registerArabicFonts } from "../lib/pdf/arabic-font";

const SCREENSHOT_ROOTS = [
  path.resolve(fileURLToPath(import.meta.url), "../../../docs/public/screenshots"),
  path.resolve(process.cwd(), "artifacts/docs/public/screenshots"),
];

function resolveScreenshot(slug: string, lang: Lang): string | null {
  for (const root of SCREENSHOT_ROOTS) {
    const p = path.join(root, lang, `${slug}.png`);
    if (existsSync(p)) return p;
  }
  return null;
}

const router: IRouter = Router();

function parseLang(v: unknown): Lang {
  return v === "en" ? "en" : "ar";
}

function writeModule(
  doc: PDFKit.PDFDocument,
  m: DocModule,
  lang: Lang,
  T: (s: string) => string,
  useReg: () => void,
  useBold: () => void,
) {
  const align = lang === "ar" ? "right" : "left";

  useBold();
  doc
    .fontSize(20)
    .fillColor("#0f172a")
    .text(T(`${String(m.position).padStart(2, "0")}. ${m.title[lang]}`), { align });
  doc.moveDown(0.3);
  useReg();
  doc.fontSize(11).fillColor("#475569").text(T(m.summary[lang]), { align });
  doc.moveDown(0.4);
  doc
    .fontSize(9)
    .fillColor("#64748b")
    .text(
      T(
        `${lang === "ar" ? "المسار" : "Path"}: ${m.appPath ?? "—"}  •  ${
          lang === "ar" ? "الأدوار" : "Roles"
        }: ${m.roles.join(", ")}  •  ${lang === "ar" ? "آخر تحديث" : "Updated"}: ${m.lastUpdated}`,
      ),
      { align },
    );
  doc.moveDown(0.5);

  const shot = resolveScreenshot(m.slug, lang);
  if (shot) {
    try {
      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      doc.image(shot, { fit: [pageWidth, 260], align: "center" });
      doc.moveDown(0.3);
      // Descriptive alt-equivalent caption (renders inline for sighted users;
      // also makes the PDF self-describing when text-extracted by screen
      // readers since pdfkit does not expose semantic alt tags directly).
      const altText = (m.screenshotAlt ?? m.summary)[lang];
      useReg();
      doc
        .fontSize(9)
        .fillColor("#475569")
        .text(T(`${lang === "ar" ? "وصف الصورة" : "Image"}: ${altText}`), { align });
      doc.moveDown(0.3);
      if (m.hotspots && m.hotspots.length) {
        useBold();
        doc
          .fontSize(10)
          .fillColor("#0f172a")
          .text(T(lang === "ar" ? "مفتاح المخطط:" : "Map legend:"), { align });
        useReg();
        doc.fontSize(10).fillColor("#1f2937");
        for (const h of m.hotspots) {
          doc.text(T(`${h.n}. ${h.label[lang]}`), { align });
        }
      }
      doc.moveDown(0.4);
    } catch {
      // ignore – malformed PNGs shouldn't break the export
    }
  }

  if (m.prerequisites && m.prerequisites.length) {
    useBold();
    doc.fontSize(12).fillColor("#0f172a").text(T(lang === "ar" ? "قبل أن تبدأ" : "Before you begin"), { align });
    useReg();
    doc.fontSize(10.5).fillColor("#1f2937");
    for (const p of m.prerequisites) {
      doc.text(T(`• ${p[lang]}`), { align });
    }
    doc.moveDown(0.4);
  }

  if (m.steps && m.steps.length) {
    useBold();
    doc.fontSize(13).fillColor("#0f172a").text(T(lang === "ar" ? "الخطوات" : "Steps"), { align });
    useReg();
    doc.fontSize(10.5).fillColor("#111827");
    m.steps.forEach((s, i) => {
      doc.text(T(`${i + 1}. ${s.action[lang]}`), { align });
      if (s.result) {
        doc.fillColor("#475569").text(T(`   → ${s.result[lang]}`), { align });
        doc.fillColor("#111827");
      }
    });
    doc.moveDown(0.4);
  }

  for (const s of m.sections ?? []) {
    useBold();
    doc.fontSize(13).fillColor("#0f172a").text(T(s.heading[lang]), { align });
    useReg();
    doc.fontSize(10.5).fillColor("#111827").text(T(s.body[lang]), { align });
    doc.moveDown(0.4);
  }

  if (m.scenarios && m.scenarios.length) {
    useBold();
    doc.fontSize(13).fillColor("#0f172a").text(T(lang === "ar" ? "سيناريوهات شائعة" : "Common scenarios"), { align });
    useReg();
    for (const s of m.scenarios) {
      useBold();
      doc.fontSize(11).fillColor("#0f172a").text(T(s.title[lang]), { align });
      useReg();
      doc.fontSize(10.5).fillColor("#111827").text(T(s.body[lang]), { align });
      doc.moveDown(0.2);
    }
    doc.moveDown(0.3);
  }

  if (m.callouts && m.callouts.length) {
    for (const c of m.callouts) {
      const labels: Record<string, [string, string, string]> = {
        note: ["ملاحظة", "Note", "#0369a1"],
        tip: ["نصيحة", "Tip", "#b45309"],
        warning: ["تحذير", "Warning", "#b91c1c"],
        "best-practice": ["أفضل ممارسة", "Best practice", "#047857"],
      };
      const [ar, en, color] = labels[c.kind];
      useBold();
      doc.fontSize(11).fillColor(color).text(T(`${lang === "ar" ? ar : en}:`), { align });
      useReg();
      doc.fontSize(10.5).fillColor("#1f2937").text(T(c.body[lang]), { align });
      doc.moveDown(0.3);
    }
  }

  if (m.tips && m.tips.length) {
    useBold();
    doc.fontSize(11).fillColor("#92400e").text(T(lang === "ar" ? "نصائح" : "Tips"), { align });
    useReg();
    doc.fillColor("#78350f").fontSize(10);
    for (const t of m.tips) {
      doc.text(T(`• ${t[lang]}`), { align });
    }
    doc.moveDown(0.4);
  }

  if (m.troubleshooting && m.troubleshooting.length) {
    useBold();
    doc.fontSize(13).fillColor("#0f172a").text(T(lang === "ar" ? "استكشاف الأخطاء" : "Troubleshooting"), { align });
    useReg();
    for (const f of m.troubleshooting) {
      useBold();
      doc.fontSize(11).fillColor("#0f172a").text(T(`Q: ${f.q[lang]}`), { align });
      useReg();
      doc.fontSize(10.5).fillColor("#111827").text(T(`A: ${f.a[lang]}`), { align });
      doc.moveDown(0.2);
    }
    doc.moveDown(0.3);
  }

  if (m.related && m.related.length) {
    const names = m.related
      .map((s) => findModule(s))
      .filter((x): x is DocModule => x !== null)
      .map((x) => x.title[lang])
      .join(" • ");
    if (names) {
      useReg();
      doc.fontSize(9).fillColor("#64748b").text(
        T(`${lang === "ar" ? "وحدات ذات صلة" : "Related"}: ${names}`),
        { align },
      );
      doc.moveDown(0.3);
    }
  }
}

function buildPdf(modules: DocModule[], lang: Lang, title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      info: { Title: title },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const fonts = registerArabicFonts(doc);
    const T = fonts.T;

    // Workaround: the bundled Amiri font triggers a known fontkit GPOS
    // anchor crash on some pre-shaped Arabic glyph sequences (null anchor
    // returned from getAnchor → TypeError in applyAnchor). For AR exports
    // wrap fontkit's Font.position in a try/catch so a bad glyph run
    // just falls back to default advance widths instead of 500'ing the
    // whole request.
    const patchActiveFont = () => {
      if (lang !== "ar") return;
      const embedded = (doc as unknown as { _font?: { font?: unknown } })._font;
      const fkFont = embedded?.font as
        | {
            _layoutEngine?: {
              engine?: {
                position?: (run: unknown) => unknown;
                __positionPatched?: boolean;
              };
            };
          }
        | undefined;
      const otEngine = fkFont?._layoutEngine?.engine;
      if (otEngine && typeof otEngine.position === "function" && !otEngine.__positionPatched) {
        const orig = otEngine.position.bind(otEngine);
        otEngine.position = function patched(run: unknown) {
          try {
            return orig(run);
          } catch {
            // Returning null tells LayoutEngine "no GPOS positioning ran",
            // which makes it fall back to UnicodeLayoutEngine for marks.
            return null;
          }
        };
        otEngine.__positionPatched = true;
      }
    };
    const useReg = () => {
      fonts.useReg();
      patchActiveFont();
    };
    const useBold = () => {
      fonts.useBold();
      patchActiveFont();
    };

    useBold();
    doc.fontSize(28).fillColor("#0f172a").text(T(title), { align: "center" });
    useReg();
    doc
      .fontSize(11)
      .fillColor("#475569")
      .text(
        T(
          lang === "ar"
            ? `دليل المستخدم — حاسبة.AI ERP (${new Date().toISOString().slice(0, 10)})`
            : `User Manual — حاسبة.AI ERP (${new Date().toISOString().slice(0, 10)})`,
        ),
        { align: "center" },
      );
    doc.moveDown(1.2);

    const align = lang === "ar" ? "right" : "left";

    useReg();
    doc
      .fontSize(9)
      .fillColor("#94a3b8")
      .text(
        T(`${lang === "ar" ? "إصدار الدليل" : "Docs version"}: ${DOCS_VERSION}`),
        { align: "center" },
      );
    doc.moveDown(0.6);

    if (modules.length > 1) {
      useBold();
      doc.fontSize(16).fillColor("#0f172a").text(T(lang === "ar" ? "الفهرس" : "Table of contents"), { align });
      useReg();
      doc.fontSize(11).fillColor("#1e40af");
      for (const cat of DOC_CATEGORIES) {
        useBold();
        doc.fontSize(11).fillColor("#0f172a").text(T(cat.title[lang]), { align });
        useReg();
        doc.fontSize(10.5).fillColor("#334155");
        for (const m of cat.modules) {
          doc.text(T(`${String(m.position).padStart(2, "0")}. ${m.title[lang]}`), { align });
        }
        doc.moveDown(0.2);
      }
      doc.addPage();

      // Quick Start
      useBold();
      doc.fontSize(20).fillColor("#0f172a").text(T(lang === "ar" ? "البداية السريعة" : "Quick Start"), { align });
      useReg();
      doc.moveDown(0.2);
      doc.fontSize(10.5).fillColor("#475569").text(
        T(
          lang === "ar"
            ? "خمس خطوات تنقلك من إنشاء الحساب إلى أول فاتورة في حوالي 10 دقائق."
            : "Five steps that take you from sign-up to your first invoice in about 10 minutes.",
        ),
        { align },
      );
      doc.moveDown(0.5);
      for (const s of QUICK_START) {
        useBold();
        doc.fontSize(12).fillColor("#0f172a").text(
          T(`${s.index}. ${s.title[lang]}  (${s.minutes} ${lang === "ar" ? "دقيقة" : "min"})`),
          { align },
        );
        useReg();
        doc.fontSize(10.5).fillColor("#111827").text(T(s.body[lang]), { align });
        doc.fontSize(9).fillColor("#64748b").text(
          T(`${lang === "ar" ? "المسار" : "Path"}: ${s.appPath}`),
          { align },
        );
        doc.moveDown(0.3);
      }
      doc.addPage();

      // Glossary
      useBold();
      doc.fontSize(20).fillColor("#0f172a").text(T(lang === "ar" ? "المصطلحات" : "Glossary"), { align });
      doc.moveDown(0.3);
      useReg();
      for (const g of GLOSSARY) {
        useBold();
        doc.fontSize(12).fillColor("#0f172a").text(T(g.term[lang]), { align });
        useReg();
        doc.fontSize(10.5).fillColor("#1f2937").text(T(g.definition[lang]), { align });
        doc.moveDown(0.25);
      }
      doc.addPage();

      // FAQ
      useBold();
      doc.fontSize(20).fillColor("#0f172a").text(T(lang === "ar" ? "الأسئلة الشائعة" : "FAQ"), { align });
      doc.moveDown(0.3);
      for (const f of FAQ) {
        const qLabel = lang === "ar" ? "س" : "Q";
        const aLabel = lang === "ar" ? "ج" : "A";
        useBold();
        doc.fontSize(11).fillColor("#0f172a").text(T(`${qLabel}: ${f.q[lang]}`), { align });
        useReg();
        doc.fontSize(10.5).fillColor("#111827").text(T(`${aLabel}: ${f.a[lang]}`), { align });
        doc.moveDown(0.25);
      }
      doc.addPage();
    }

    modules.forEach((m, i) => {
      writeModule(doc, m, lang, T, useReg, useBold);
      if (i < modules.length - 1) doc.addPage();
    });

    doc.end();
  });
}

router.get("/docs/export", async (req: Request, res: Response) => {
  try {
    const lang = parseLang(req.query.lang);
    const slug = typeof req.query.module === "string" ? req.query.module : null;

    let mods: DocModule[];
    let title: string;
    let filename: string;
    if (slug) {
      const m = findModule(slug);
      if (!m) {
        res.status(404).json({ error: "module_not_found" });
        return;
      }
      mods = [m];
      title = m.title[lang];
      filename = `hasba-docs-${slug}-${lang}.pdf`;
    } else {
      mods = allModules();
      title = lang === "ar" ? "دليل المستخدم الكامل" : "Complete User Manual";
      filename = `hasba-docs-${lang}.pdf`;
    }

    const buf = await buildPdf(mods, lang, title);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.end(buf);
  } catch (err) {
    req.log.error({ err }, "docs.export failed");
    res.status(500).json({ error: "pdf_generation_failed" });
  }
});

router.get("/docs/manifest", (_req: Request, res: Response) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({ categories: DOC_CATEGORIES });
});

export default router;
