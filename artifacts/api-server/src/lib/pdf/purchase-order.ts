import PDFDocument from "pdfkit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
// CJS-only deps – use require so esbuild bundles them as-is.
const __nodeRequire =
  typeof require === "function" ? require : createRequire(import.meta.url);
const arabicReshaper: { convertArabic: (s: string) => string } =
  __nodeRequire("arabic-reshaper");
const bidiFactory: () => {
  getEmbeddingLevels: (s: string, dir?: "ltr" | "rtl") => unknown;
  getReorderedString: (s: string, levels: unknown) => string;
} = __nodeRequire("bidi-js");
const bidi = bidiFactory();

export type PoPdfLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  lineTotal: number;
};

export type PoPdfInput = {
  reference: string;
  orderDate: string;
  expectedDate: string | null;
  currencyCode: string;
  subtotal: number;
  vat: number;
  total: number;
  notes: string | null;
  supplier: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    vatNumber: string | null;
  };
  lines: PoPdfLine[];
};

export type CompanyInfo = {
  nameEn: string;
  nameAr: string;
  vatNumber: string;
  address: string;
  email: string;
  phone: string;
  bankName: string;
  bankIban: string;
  termsEn: string;
  termsAr: string;
};

export function getCompanyInfoFromEnv(): CompanyInfo {
  return {
    nameEn: process.env.COMPANY_NAME_EN ?? "Hasaba.AI",
    nameAr: process.env.COMPANY_NAME_AR ?? "حاسبة.AI",
    vatNumber: process.env.COMPANY_VAT ?? "—",
    address: process.env.COMPANY_ADDRESS ?? "Riyadh, Saudi Arabia",
    email: process.env.COMPANY_EMAIL ?? process.env.SMTP_FROM ?? "no-reply@hasaba.ai",
    phone: process.env.COMPANY_PHONE ?? "—",
    bankName: process.env.COMPANY_BANK_NAME ?? "Al Rajhi Bank",
    bankIban: process.env.COMPANY_BANK_IBAN ?? "SA00 0000 0000 0000 0000 0000",
    termsEn:
      process.env.COMPANY_PO_TERMS_EN ??
      "Please confirm receipt of this purchase order. Goods must match the agreed specifications. Payment per agreed terms after delivery and invoice receipt.",
    termsAr:
      process.env.COMPANY_PO_TERMS_AR ??
      "يرجى تأكيد استلام أمر الشراء. يجب أن تطابق البضاعة المواصفات المتفق عليها. يتم الدفع وفق الشروط المتفق عليها بعد التسليم واستلام الفاتورة.",
  };
}

const fmtMoney = (n: number, currency: string) =>
  `${currency} ${n.toFixed(2)}`;

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Reshape + bidi-reorder a string so it renders correctly with a static
 * Arabic font (Amiri) inside pdfkit which does no shaping itself.
 *
 * Latin-only strings pass through unchanged. Mixed strings are reordered
 * with the Unicode Bidi Algorithm.
 */
function shape(s: string): string {
  if (!s) return s;
  if (!ARABIC_RE.test(s)) return s;
  const reshaped = arabicReshaper.convertArabic(s);
  const levels = bidi.getEmbeddingLevels(reshaped, "ltr");
  return bidi.getReorderedString(reshaped, levels);
}

/**
 * Locate the bundled Amiri TTF. In dev (tsx) the file lives next to this
 * source under `./fonts/`. In a production esbuild bundle build.mjs copies
 * the directory to `<distDir>/fonts/`.
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
function loadFonts(): { regular: Buffer | null; bold: Buffer | null } {
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

/**
 * Render a bilingual (English + Arabic) Purchase Order PDF using the
 * embedded Amiri Arabic font + arabic-reshaper + bidi-js so Arabic text
 * renders with correct glyph shapes and right-to-left ordering.
 */
export function buildPurchaseOrderPdf(
  input: PoPdfInput,
  company: CompanyInfo = getCompanyInfoFromEnv(),
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      info: { Title: `Purchase Order ${input.reference}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const fonts = loadFonts();
    const FONT_REG = "Body";
    const FONT_BOLD = "BodyBold";
    if (fonts.regular) doc.registerFont(FONT_REG, fonts.regular);
    if (fonts.bold) doc.registerFont(FONT_BOLD, fonts.bold);
    const useReg = () => doc.font(fonts.regular ? FONT_REG : "Helvetica");
    const useBold = () =>
      doc.font(
        fonts.bold ? FONT_BOLD : fonts.regular ? FONT_REG : "Helvetica-Bold",
      );
    const T = (s: string) => shape(s);

    // ----- Header -----
    useBold();
    doc.fontSize(18).fillColor("#0f172a").text(T(company.nameEn), { align: "left" });
    useReg();
    doc.fontSize(12).fillColor("#475569").text(T(company.nameAr), { align: "left" });
    doc.fontSize(9).fillColor("#64748b")
      .text(T(company.address))
      .text(T(`Email: ${company.email}    Phone: ${company.phone}`))
      .text(T(`VAT / الرقم الضريبي: ${company.vatNumber}`));

    doc.moveDown(0.5);
    doc.strokeColor("#cbd5e1").lineWidth(1)
      .moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.5);

    // ----- Title -----
    useBold();
    doc.fontSize(20).fillColor("#0f172a")
      .text(T("Purchase Order  /  أمر شراء"), { align: "center" });
    doc.fontSize(12).fillColor("#1e40af")
      .text(T(input.reference), { align: "center" });
    useReg();
    doc.moveDown(0.5);

    // ----- Meta + Supplier blocks -----
    const metaTop = doc.y;
    doc.fontSize(10).fillColor("#111827");
    doc.text(T(`Order date / تاريخ الأمر: ${input.orderDate}`), 40, metaTop);
    doc.text(T(`Expected / متوقع: ${input.expectedDate ?? "—"}`));
    doc.text(T(`Currency / العملة: ${input.currencyCode}`));

    const supplierTop = metaTop;
    useBold();
    doc.fontSize(11).fillColor("#0f172a")
      .text(T("Supplier / المورد"), 320, supplierTop, { width: 235 });
    useReg();
    doc.fontSize(10).fillColor("#111827")
      .text(T(input.supplier.name), 320, doc.y, { width: 235 });
    if (input.supplier.vatNumber) {
      doc.text(T(`VAT: ${input.supplier.vatNumber}`), 320, doc.y, { width: 235 });
    }
    if (input.supplier.email) {
      doc.text(T(input.supplier.email), 320, doc.y, { width: 235 });
    }
    if (input.supplier.phone) {
      doc.text(T(input.supplier.phone), 320, doc.y, { width: 235 });
    }
    if (input.supplier.address) {
      doc.text(T(input.supplier.address), 320, doc.y, { width: 235 });
    }

    doc.moveDown(2);
    doc.x = 40;

    // ----- Lines table -----
    const tableTop = doc.y + 5;
    const cols = [
      { x: 40, w: 230, label: "Description / الوصف", align: "left" as const },
      { x: 270, w: 50, label: "Qty / كمية", align: "right" as const },
      { x: 320, w: 70, label: "Unit / السعر", align: "right" as const },
      { x: 390, w: 50, label: "VAT% / ض.", align: "right" as const },
      { x: 440, w: 115, label: "Total / الإجمالي", align: "right" as const },
    ];

    doc.rect(40, tableTop, 515, 22).fill("#1e3a8a");
    useBold();
    doc.fillColor("#ffffff").fontSize(9);
    cols.forEach((c) => {
      doc.text(T(c.label), c.x + 4, tableTop + 7, { width: c.w - 8, align: c.align });
    });
    useReg();

    let y = tableTop + 22;
    doc.fillColor("#111827").fontSize(9);
    for (const ln of input.lines) {
      const desc = T(ln.description);
      const rowH = Math.max(
        18,
        doc.heightOfString(desc, { width: cols[0].w - 8 }) + 8,
      );
      if (((y - tableTop) / 22) % 2 < 1) {
        doc.fillColor("#f8fafc").rect(40, y, 515, rowH).fill();
        doc.fillColor("#111827");
      }
      doc.text(desc, cols[0].x + 4, y + 4, { width: cols[0].w - 8 });
      doc.text(String(ln.quantity), cols[1].x + 4, y + 4, { width: cols[1].w - 8, align: "right" });
      doc.text(fmtMoney(ln.unitPrice, input.currencyCode), cols[2].x + 4, y + 4, { width: cols[2].w - 8, align: "right" });
      doc.text(`${ln.taxRate}%`, cols[3].x + 4, y + 4, { width: cols[3].w - 8, align: "right" });
      doc.text(fmtMoney(ln.lineTotal, input.currencyCode), cols[4].x + 4, y + 4, { width: cols[4].w - 8, align: "right" });
      y += rowH;
      if (y > 720) {
        doc.addPage();
        y = 40;
      }
    }

    doc.strokeColor("#cbd5e1").lineWidth(0.5).moveTo(40, y).lineTo(555, y).stroke();
    y += 8;

    // ----- Totals -----
    const totRows: Array<[string, string]> = [
      ["Subtotal / المجموع قبل الضريبة", fmtMoney(input.subtotal, input.currencyCode)],
      ["VAT / ضريبة القيمة المضافة", fmtMoney(input.vat, input.currencyCode)],
      ["Total / الإجمالي", fmtMoney(input.total, input.currencyCode)],
    ];
    doc.fontSize(10).fillColor("#111827");
    for (const [label, val] of totRows) {
      const isTotal = label.startsWith("Total");
      if (isTotal) { useBold(); doc.fontSize(12).fillColor("#0f172a"); }
      doc.text(T(label), 320, y, { width: 130, align: "right" });
      doc.text(val, 450, y, { width: 105, align: "right" });
      y += isTotal ? 22 : 16;
      if (isTotal) { useReg(); doc.fontSize(10); }
    }

    // ----- Notes -----
    if (input.notes) {
      y += 10;
      useBold();
      doc.fontSize(10).fillColor("#0f172a").text(T("Notes / ملاحظات:"), 40, y);
      useReg();
      y = doc.y + 2;
      doc.fontSize(9).fillColor("#374151").text(T(input.notes), 40, y, { width: 515 });
      y = doc.y;
    }

    // ----- Terms & bank -----
    y = Math.max(y, doc.y) + 16;
    if (y > 700) { doc.addPage(); y = 40; }
    useBold();
    doc.fontSize(10).fillColor("#0f172a").text(T("Terms / الشروط:"), 40, y);
    useReg();
    doc.fontSize(9).fillColor("#374151");
    doc.text(T(company.termsEn), 40, doc.y + 2, { width: 515 });
    doc.text(T(company.termsAr), 40, doc.y + 2, { width: 515 });

    doc.moveDown(0.8);
    useBold();
    doc.fontSize(10).fillColor("#0f172a").text(T("Bank details / تفاصيل البنك:"));
    useReg();
    doc.fontSize(9).fillColor("#374151")
      .text(T(`Bank / البنك: ${company.bankName}`))
      .text(T(`IBAN: ${company.bankIban}`))
      .text(T(`Beneficiary / المستفيد: ${company.nameEn} — ${company.nameAr}`));

    doc.moveDown(1.5);
    doc.fontSize(8).fillColor("#64748b")
      .text(
        `Generated ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`,
        { align: "center" },
      );

    doc.end();
  });
}
