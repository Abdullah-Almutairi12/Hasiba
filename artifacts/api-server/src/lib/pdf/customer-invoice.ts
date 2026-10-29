import PDFDocument from "pdfkit";
import { registerArabicFonts } from "./arabic-font";
import {
  type CompanyInfo,
  getCompanyInfoFromEnv,
} from "./purchase-order";

export type CustomerInvoicePdfLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  lineTotal: number;
};

export type CustomerInvoicePdfInput = {
  reference: string;
  invoiceDate: string;
  dueDate: string | null;
  currencyCode: string;
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  amountPaid: number;
  status: string;
  notes: string | null;
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    vatNumber: string | null;
  };
  lines: CustomerInvoicePdfLine[];
  /** Optional ZATCA QR data URL (data:image/png;base64,...) drawn in
   *  the footer so the customer can scan it from the printed copy. */
  zatcaQrDataUrl?: string | null;
  saleMetadata?: Array<[string,string]>;
};

const fmtMoney = (n: number, currency: string) =>
  `${currency} ${n.toFixed(2)}`;

/**
 * Render a bilingual (English + Arabic) Customer Invoice PDF. Mirrors the
 * Purchase Order PDF header / footer layout (logo, company info, bank
 * details, terms) so the printed document is consistent across modules.
 */
export function buildCustomerInvoicePdf(
  input: CustomerInvoicePdfInput,
  company: CompanyInfo = getCompanyInfoFromEnv(),
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      info: { Title: `Tax Invoice ${input.reference}` },
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
      .text(T("Tax Invoice  /  فاتورة ضريبية"), { align: "center" });
    doc.fontSize(12).fillColor("#1e40af")
      .text(T(input.reference), { align: "center" });
    useReg();
    doc.moveDown(0.5);

    // ----- Meta + Customer blocks -----
    const metaTop = doc.y;
    doc.fontSize(10).fillColor("#111827");
    doc.text(T(`Invoice date / تاريخ الفاتورة: ${input.invoiceDate}`), 40, metaTop);
    doc.text(T(`Due date / تاريخ الاستحقاق: ${input.dueDate ?? "—"}`));
    doc.text(T(`Currency / العملة: ${input.currencyCode}`));
    doc.text(T(`Status / الحالة: ${input.status}`));

    const customerTop = metaTop;
    useBold();
    doc.fontSize(11).fillColor("#0f172a")
      .text(T("Bill to / فاتورة إلى"), 320, customerTop, { width: 235 });
    useReg();
    doc.fontSize(10).fillColor("#111827")
      .text(T(input.customer.name), 320, doc.y, { width: 235 });
    if (input.customer.vatNumber) {
      doc.text(T(`VAT: ${input.customer.vatNumber}`), 320, doc.y, { width: 235 });
    }
    if (input.customer.email) {
      doc.text(T(input.customer.email), 320, doc.y, { width: 235 });
    }
    if (input.customer.phone) {
      doc.text(T(input.customer.phone), 320, doc.y, { width: 235 });
    }
    if (input.customer.address) {
      doc.text(T(input.customer.address), 320, doc.y, { width: 235 });
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
    const amountDue = input.total - input.amountPaid;
    const totRows: Array<[string, string]> = [
      ["Subtotal / المجموع قبل الضريبة", fmtMoney(input.subtotal, input.currencyCode)],
    ];
    if (input.discount > 0) {
      totRows.push(["Discount / الخصم", `- ${fmtMoney(input.discount, input.currencyCode)}`]);
    }
    totRows.push(
      ["VAT / ضريبة القيمة المضافة", fmtMoney(input.vat, input.currencyCode)],
      ["Total / الإجمالي", fmtMoney(input.total, input.currencyCode)],
    );
    if (input.amountPaid > 0) {
      totRows.push(
        ["Paid / المدفوع", fmtMoney(input.amountPaid, input.currencyCode)],
        ["Amount due / المتبقي", fmtMoney(Math.max(0, amountDue), input.currencyCode)],
      );
    }
    doc.fontSize(10).fillColor("#111827");
    for (const [label, val] of totRows) {
      const isTotal = label.startsWith("Total");
      const isDue = label.startsWith("Amount due");
      if (isTotal || isDue) { useBold(); doc.fontSize(12).fillColor("#0f172a"); }
      doc.text(T(label), 320, y, { width: 130, align: "right" });
      doc.text(val, 450, y, { width: 105, align: "right" });
      y += isTotal || isDue ? 22 : 16;
      if (isTotal || isDue) { useReg(); doc.fontSize(10); }
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
        // QR decode/render failed — skip silently.
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
