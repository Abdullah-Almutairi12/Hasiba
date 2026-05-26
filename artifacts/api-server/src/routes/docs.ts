import { Router, type IRouter, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import {
  DOC_CATEGORIES,
  allModules,
  findModule,
  type DocModule,
  type Lang,
} from "@workspace/docs-content";
import { registerArabicFonts } from "../lib/pdf/arabic-font";

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
  useBold();
  doc
    .fontSize(20)
    .fillColor("#0f172a")
    .text(T(`${String(m.position).padStart(2, "0")}. ${m.title[lang]}`), {
      align: lang === "ar" ? "right" : "left",
    });
  doc.moveDown(0.3);
  useReg();
  doc
    .fontSize(11)
    .fillColor("#475569")
    .text(T(m.summary[lang]), { align: lang === "ar" ? "right" : "left" });
  doc.moveDown(0.4);
  doc
    .fontSize(9)
    .fillColor("#64748b")
    .text(
      T(
        `${lang === "ar" ? "المسار في التطبيق" : "App path"}: ${m.appPath ?? "—"}  •  ${
          lang === "ar" ? "الأدوار" : "Roles"
        }: ${m.roles.join(", ")}`,
      ),
      { align: lang === "ar" ? "right" : "left" },
    );
  doc.moveDown(0.6);

  for (const s of m.sections) {
    useBold();
    doc
      .fontSize(13)
      .fillColor("#0f172a")
      .text(T(s.heading[lang]), { align: lang === "ar" ? "right" : "left" });
    useReg();
    doc
      .fontSize(10.5)
      .fillColor("#111827")
      .text(T(s.body[lang]), { align: lang === "ar" ? "right" : "left" });
    doc.moveDown(0.4);
  }

  if (m.tips && m.tips.length) {
    useBold();
    doc
      .fontSize(11)
      .fillColor("#92400e")
      .text(T(lang === "ar" ? "نصائح" : "Tips"), {
        align: lang === "ar" ? "right" : "left",
      });
    useReg();
    doc.fillColor("#78350f").fontSize(10);
    for (const t of m.tips) {
      doc.text(T(`• ${t[lang]}`), { align: lang === "ar" ? "right" : "left" });
    }
    doc.moveDown(0.4);
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

    const { useReg, useBold, T } = registerArabicFonts(doc);

    useBold();
    doc
      .fontSize(28)
      .fillColor("#0f172a")
      .text(T(title), { align: "center" });
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

    if (modules.length > 1) {
      useBold();
      doc
        .fontSize(16)
        .fillColor("#0f172a")
        .text(T(lang === "ar" ? "الفهرس" : "Table of contents"), {
          align: lang === "ar" ? "right" : "left",
        });
      useReg();
      doc.fontSize(11).fillColor("#1e40af");
      for (const cat of DOC_CATEGORIES) {
        useBold();
        doc
          .fontSize(11)
          .fillColor("#0f172a")
          .text(T(cat.title[lang]), { align: lang === "ar" ? "right" : "left" });
        useReg();
        doc.fontSize(10.5).fillColor("#334155");
        for (const m of cat.modules) {
          doc.text(
            T(`${String(m.position).padStart(2, "0")}. ${m.title[lang]}`),
            { align: lang === "ar" ? "right" : "left" },
          );
        }
        doc.moveDown(0.2);
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

/**
 * GET /api/docs/export?lang=ar|en[&module=slug]
 * Public docs PDF — returns a single-module PDF when `module` is set,
 * otherwise the full manual.
 */
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
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${filename}"`,
    );
    res.setHeader("Cache-Control", "public, max-age=300");
    res.end(buf);
  } catch (err) {
    req.log.error({ err }, "docs.export failed");
    res.status(500).json({ error: "pdf_generation_failed" });
  }
});

/**
 * GET /api/docs/manifest — JSON snapshot of all categories/modules in
 * both languages. Useful for the in-app /help search and for external
 * docs consumers.
 */
router.get("/docs/manifest", (_req: Request, res: Response) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({ categories: DOC_CATEGORIES });
});

export default router;
