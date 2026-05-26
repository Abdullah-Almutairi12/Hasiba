import PDFDocument from "pdfkit";
import { registerArabicFonts } from "./arabic-font";

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
  /** When false (tenant is not VAT-registered), the PDF omits the
   *  VAT% column from the lines table and the Subtotal/VAT rows
   *  from the totals block, showing only a single Total line. */
  vatEnabled?: boolean;
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
  /** Raw image bytes for the company logo — drawn in the PDF header
   *  when present. pdfkit supports PNG and JPEG; SVG is skipped. */
  logo?: { data: Buffer; contentType: string } | null;
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

/**
 * Resolve CompanyInfo at runtime by reading the `company_settings`
 * singleton, falling back to environment variables for any field the
 * admin hasn't filled in yet. Imported dynamically so this PDF module
 * stays usable from contexts that don't have the DB initialised.
 */
async function loadLogoFromObjectKey(
  objectKey: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  try {
    const privateDir = process.env["PRIVATE_OBJECT_DIR"] ?? "";
    if (!privateDir) return null;
    const trimmed = privateDir.replace(/^\/+|\/+$/g, "");
    const [bucketName, ...prefixParts] = trimmed.split("/");
    if (!bucketName) return null;
    const prefix = prefixParts.join("/");
    const objectName = prefix ? `${prefix}/${objectKey}` : objectKey;
    const { objectStorageClient } = await import("../objectStorage");
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [metadata] = await file.getMetadata();
    const contentType =
      (metadata.contentType as string | undefined) ?? "image/png";
    // pdfkit's doc.image() only understands PNG / JPEG. Skip SVG / WEBP
    // rather than crashing the PDF render.
    if (!/^image\/(png|jpe?g)$/i.test(contentType)) return null;
    const [buf] = await file.download();
    return { data: buf, contentType };
  } catch {
    return null;
  }
}

export async function getCompanyInfo(): Promise<CompanyInfo> {
  const env = getCompanyInfoFromEnv();
  try {
    const { db, companySettingsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const [row] = await db
      .select()
      .from(companySettingsTable)
      .where(eq(companySettingsTable.id, 1))
      .limit(1);
    if (!row) return env;
    const pick = (v: string | null, fallback: string) =>
      v && v.trim().length > 0 ? v : fallback;
    const logo = row.logoObjectKey
      ? await loadLogoFromObjectKey(row.logoObjectKey)
      : null;
    return {
      nameEn: pick(row.nameEn, env.nameEn),
      nameAr: pick(row.nameAr, env.nameAr),
      vatNumber: pick(row.vatNumber, env.vatNumber),
      address: pick(row.address, env.address),
      email: pick(row.email, env.email),
      phone: pick(row.phone, env.phone),
      bankName: pick(row.bankName, env.bankName),
      bankIban: pick(row.bankIban, env.bankIban),
      termsEn: pick(row.termsEn, env.termsEn),
      termsAr: pick(row.termsAr, env.termsAr),
      logo,
    };
  } catch {
    return env;
  }
}

const fmtMoney = (n: number, currency: string) =>
  `${currency} ${n.toFixed(2)}`;

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

    const { useReg, useBold, T } = registerArabicFonts(doc);

    // ----- Header -----
    // If a logo is configured we draw it on the right side of the header
    // block; the company name + contact text stays on the left at x=40.
    let logoDrawn = false;
    if (company.logo) {
      try {
        doc.image(company.logo.data, 460, 40, {
          fit: [95, 60],
        });
        logoDrawn = true;
      } catch {
        // Corrupt / unsupported image — fall back to text-only header.
      }
    }
    const headerTextWidth = logoDrawn ? 400 : 515;
    useBold();
    doc.fontSize(18).fillColor("#0f172a")
      .text(T(company.nameEn), 40, 40, { width: headerTextWidth, align: "left" });
    useReg();
    doc.fontSize(12).fillColor("#475569")
      .text(T(company.nameAr), 40, doc.y, { width: headerTextWidth, align: "left" });
    doc.fontSize(9).fillColor("#64748b")
      .text(T(company.address), 40, doc.y, { width: headerTextWidth })
      .text(T(`Email: ${company.email}    Phone: ${company.phone}`), 40, doc.y, { width: headerTextWidth })
      .text(T(`VAT / الرقم الضريبي: ${company.vatNumber}`), 40, doc.y, { width: headerTextWidth });
    if (logoDrawn && doc.y < 110) doc.y = 110;

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
    const vatEnabled = input.vatEnabled !== false;
    const tableTop = doc.y + 5;
    const cols = vatEnabled
      ? [
          { x: 40, w: 230, label: "Description / الوصف", align: "left" as const },
          { x: 270, w: 50, label: "Qty / كمية", align: "right" as const },
          { x: 320, w: 70, label: "Unit / السعر", align: "right" as const },
          { x: 390, w: 50, label: "VAT% / ض.", align: "right" as const },
          { x: 440, w: 115, label: "Total / الإجمالي", align: "right" as const },
        ]
      : [
          { x: 40, w: 260, label: "Description / الوصف", align: "left" as const },
          { x: 300, w: 60, label: "Qty / كمية", align: "right" as const },
          { x: 360, w: 90, label: "Unit / السعر", align: "right" as const },
          { x: 450, w: 105, label: "Total / الإجمالي", align: "right" as const },
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
      if (vatEnabled) {
        doc.text(`${ln.taxRate}%`, cols[3].x + 4, y + 4, { width: cols[3].w - 8, align: "right" });
        doc.text(fmtMoney(ln.lineTotal, input.currencyCode), cols[4].x + 4, y + 4, { width: cols[4].w - 8, align: "right" });
      } else {
        doc.text(fmtMoney(ln.lineTotal, input.currencyCode), cols[3].x + 4, y + 4, { width: cols[3].w - 8, align: "right" });
      }
      y += rowH;
      if (y > 720) {
        doc.addPage();
        y = 40;
      }
    }

    doc.strokeColor("#cbd5e1").lineWidth(0.5).moveTo(40, y).lineTo(555, y).stroke();
    y += 8;

    // ----- Totals -----
    const totRows: Array<[string, string]> = vatEnabled
      ? [
          ["Subtotal / المجموع قبل الضريبة", fmtMoney(input.subtotal, input.currencyCode)],
          ["VAT / ضريبة القيمة المضافة", fmtMoney(input.vat, input.currencyCode)],
          ["Total / الإجمالي", fmtMoney(input.total, input.currencyCode)],
        ]
      : [["Total / الإجمالي", fmtMoney(input.total, input.currencyCode)]];
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
