import PDFDocument from "pdfkit";
import { registerArabicFonts } from "./arabic-font";
import {
  type CompanyInfo,
  getCompanyInfoFromEnv,
} from "./purchase-order";

export type SupplierInvoicePdfLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  lineTotal: number;
};

export type SupplierInvoicePdfInput = {
  invoiceNumber: string;
  invoiceDate: string | null;
  dueDate: string | null;
  currencyCode: string;
  amount: number;
  status: string;
  notes: string | null;
  poReference: string | null;
  supplier: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    vatNumber: string | null;
  };
  /** Optional: when the invoice is linked to a PO, lines copied from
   *  that PO so the printed document shows what was billed. When empty,
   *  the PDF prints a single summary row using the invoice total. */
  lines: SupplierInvoicePdfLine[];
  zatcaQrDataUrl?: string | null;
};

const fmtMoney = (n: number, currency: string) =>
  `${currency} ${n.toFixed(2)}`;

/**
 * Render a bilingual (English + Arabic) Supplier Invoice PDF using the
 * same header / footer chrome as the Purchase Order PDF.
 */
export function buildSupplierInvoicePdf(
  input: SupplierInvoicePdfInput,
  company: CompanyInfo = getCompanyInfoFromEnv(),
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      info: { Title: `Supplier Invoice ${input.invoiceNumber}` },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { useReg, useBold, T } = registerArabicFonts(doc);

    // ----- Header -----
    let logoDrawn = false;
    if (company.logo) {
      try {
        doc.image(company.logo.data, 460, 40, { fit: [95, 60] });
        logoDrawn = true;
      } catch {
        // ignore
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
      .text(T("Supplier Invoice  /  فاتورة مورد"), { align: "center" });
    doc.fontSize(12).fillColor("#1e40af")
      .text(T(input.invoiceNumber), { align: "center" });
    useReg();
    doc.moveDown(0.5);

    // ----- Meta + Supplier blocks -----
    const metaTop = doc.y;
    doc.fontSize(10).fillColor("#111827");
    doc.text(T(`Invoice date / تاريخ الفاتورة: ${input.invoiceDate ?? "—"}`), 40, metaTop);
    doc.text(T(`Due date / تاريخ الاستحقاق: ${input.dueDate ?? "—"}`));
    doc.text(T(`Currency / العملة: ${input.currencyCode}`));
    doc.text(T(`Status / الحالة: ${input.status}`));
    if (input.poReference) {
      doc.text(T(`PO / أمر الشراء: ${input.poReference}`));
    }

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
    const rows: SupplierInvoicePdfLine[] = input.lines.length > 0
      ? input.lines
      : [{
          description: "Supplier invoice total / إجمالي فاتورة المورد",
          quantity: 1,
          unitPrice: input.amount,
          taxRate: 0,
          lineTotal: input.amount,
        }];
    for (const ln of rows) {
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
    doc.fontSize(12).fillColor("#0f172a");
    useBold();
    doc.text(T("Total / الإجمالي"), 320, y, { width: 130, align: "right" });
    doc.text(fmtMoney(input.amount, input.currencyCode), 450, y, { width: 105, align: "right" });
    useReg();
    y += 22;

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

    // ----- ZATCA QR -----
    if (input.zatcaQrDataUrl) {
      y = Math.max(y, doc.y) + 12;
      if (y > 680) { doc.addPage(); y = 40; }
      try {
        const b64 = input.zatcaQrDataUrl.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
        const qrBuf = Buffer.from(b64, "base64");
        doc.image(qrBuf, 40, y, { fit: [90, 90] });
        useReg();
        doc.fontSize(8).fillColor("#64748b")
          .text(T("ZATCA QR / رمز هيئة الزكاة"), 140, y + 36, { width: 200 });
        y += 100;
      } catch {
        // ignore
      }
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
