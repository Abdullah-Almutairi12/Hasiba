import PDFDocument from "pdfkit";
import { registerArabicFonts } from "./arabic-font";
import { type CompanyInfo, getCompanyInfoFromEnv } from "./purchase-order";
import type { VatReturn } from "../vat-return";

const fmt = (n: number | null) => n===null ? "غير متاح" :
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

/**
 * Render the quarterly ZATCA VAT-return as a single-page PDF. Mirrors
 * the supplier-invoice chrome (Amiri Arabic font, bilingual labels) so
 * accountants can re-key the numbers straight into the ZATCA portal.
 */
export function buildVatReturnPdf(
  vr: VatReturn,
  company: CompanyInfo = getCompanyInfoFromEnv(),
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      info: { Title: `VAT Return ${vr.year}-Q${vr.quarter}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { useReg, useBold, T } = registerArabicFonts(doc);

    // ----- Header -----
    useBold();
    doc
      .fontSize(18)
      .fillColor("#0f172a")
      .text(T(company.nameEn), 40, 40, { width: 515, align: "left" });
    useReg();
    doc
      .fontSize(12)
      .fillColor("#475569")
      .text(T(company.nameAr), 40, doc.y, { width: 515 });
    doc
      .fontSize(9)
      .fillColor("#64748b")
      .text(T(`VAT / الرقم الضريبي: ${vr.vatNumber ?? company.vatNumber}`), 40, doc.y, {
        width: 515,
      });

    doc.moveDown(0.5);
    doc.strokeColor("#cbd5e1").lineWidth(1)
      .moveTo(40, doc.y).lineTo(555, doc.y).stroke();
    doc.moveDown(0.6);

    // ----- Title -----
    useBold();
    doc.fontSize(20).fillColor("#0f172a")
      .text(T("Quarterly VAT Return  /  الإقرار الضريبي الربعي"), { align: "center" });
    doc.fontSize(13).fillColor("#1e40af")
      .text(T(`${vr.year} — Q${vr.quarter}`), { align: "center" });
    useReg();
    doc.fontSize(10).fillColor("#475569")
      .text(T(`Period / الفترة: ${vr.periodStart}  →  ${vr.periodEnd}`), { align: "center" });
    doc.moveDown(1);

    // ----- Tenant block -----
    useBold();
    doc.fontSize(11).fillColor("#0f172a")
      .text(T("Tenant / المنشأة"), 40, doc.y);
    useReg();
    doc.fontSize(10).fillColor("#111827")
      .text(T(`${vr.companyName}`), 40, doc.y);
    if (vr.vatNumber) {
      doc.text(T(`VAT / الرقم الضريبي: ${vr.vatNumber}`), 40, doc.y);
    }
    doc.moveDown(1);

    // ----- Supplies (sales side) -----
    section(doc, useBold, useReg, T, "Taxable supplies  /  التوريدات الخاضعة", [
      ["Standard-rated 15% / خاضع 15٪", fmt(vr.supplies.standardRated)],
      ["Zero-rated / خاضع للنسبة الصفرية", fmt(vr.supplies.zeroRated)],
      ["Exempt / معفى", fmt(vr.supplies.exempt)],
    ]);

    // ----- Output VAT -----
    section(doc, useBold, useReg, T, "Output VAT  /  ضريبة المخرجات", [
      ["POS sales tax / ضريبة نقاط البيع", fmt(vr.outputVat.pos)],
      ["Customer invoices VAT / ضريبة فواتير العملاء", fmt(vr.outputVat.customerInvoices)],
      ["Total output VAT / إجمالي ضريبة المخرجات", fmt(vr.outputVat.total), true],
    ]);

    // ----- Input VAT -----
    section(doc, useBold, useReg, T, "Input VAT  /  ضريبة المدخلات", [
      ["Recoverable from journals / المسترد من القيود", fmt(vr.inputVat.fromJournals)],
      ["Total input VAT / إجمالي ضريبة المدخلات", fmt(vr.inputVat.total), true],
    ]);

    // ----- Net -----
    doc.moveDown(0.5);
    const netY = doc.y;
    const netColor = vr.netPayable >= 0 ? "#b91c1c" : "#047857";
    doc.rect(40, netY, 515, 36).fill("#f1f5f9");
    useBold();
    doc.fillColor("#0f172a").fontSize(12)
      .text(T("Net VAT payable to ZATCA  /  الصافي المستحق لهيئة الزكاة"), 50, netY + 12, {
        width: 380,
      });
    doc.fillColor(netColor).fontSize(14)
      .text(`${fmt(vr.netPayable)} SAR`, 430, netY + 11, { width: 115, align: "right" });
    useReg();
    doc.y = netY + 42;
    if (vr.netPayable < 0) {
      doc.fontSize(9).fillColor("#047857")
        .text(T("Refundable balance — request refund or carry forward."), 40, doc.y, {
          width: 515,
        });
    }

    // ----- Footer -----
    doc.moveDown(2);
    doc.fontSize(8).fillColor("#64748b")
      .text(
        `Generated ${vr.generatedAt.slice(0, 19).replace("T", " ")} UTC`,
        40,
        doc.y,
        { align: "center", width: 515 },
      );

    doc.end();
  });
}

function section(
  doc: PDFKit.PDFDocument,
  useBold: () => void,
  useReg: () => void,
  T: (s: string) => string,
  title: string,
  rows: Array<[string, string, boolean?]>,
) {
  useBold();
  doc.fontSize(12).fillColor("#0f172a").text(T(title), 40, doc.y);
  useReg();
  doc.moveDown(0.3);
  const tableTop = doc.y;
  doc.strokeColor("#e5e7eb").lineWidth(0.5)
    .moveTo(40, tableTop).lineTo(555, tableTop).stroke();
  let y = tableTop + 4;
  for (const [label, value, bold] of rows) {
    if (bold) useBold();
    else useReg();
    doc.fontSize(10).fillColor(bold ? "#0f172a" : "#374151");
    doc.text(T(label), 50, y, { width: 360 });
    doc.text(value, 410, y, { width: 135, align: "right" });
    y += 18;
    if (bold) useReg();
  }
  doc.strokeColor("#e5e7eb").lineWidth(0.5)
    .moveTo(40, y + 2).lineTo(555, y + 2).stroke();
  doc.y = y + 10;
}
