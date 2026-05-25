import { Router } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { db, posOrdersTable, productsTable, invoicesTable, suppliersTable, journalEntriesTable, journalEntryLinesTable, accountsTable } from "@workspace/db";
import { sql, desc, gte, and, eq, lte } from "drizzle-orm";
import { recordAudit } from "../lib/audit";
import { registerArabicFonts } from "../lib/pdf/arabic-font";
import { drawBrandedHeader, drawBrandedFooter, loadBrand, BRAND } from "../lib/pdf/branding-header";
import { exportsGuard, reportReadGuard } from "../middlewares/require-role";
import type { Request, Response, NextFunction } from "express";

const router = Router();

type ReportType =
  | "sales"
  | "products"
  | "invoices"
  | "suppliers"
  | "journal"
  | "trial-balance"
  | "profit-loss"
  | "balance-sheet"
  | "cash-flow";

const ALL_REPORT_TYPES: ReportType[] = [
  "sales",
  "products",
  "invoices",
  "suppliers",
  "journal",
  "trial-balance",
  "profit-loss",
  "balance-sheet",
  "cash-flow",
];

// Financial statement exports leak ledger data and must follow the same
// access policy as the JSON `/reports/*` endpoints (reportReadGuard).
// Operational exports (sales, products, invoices, suppliers) keep the
// broader exportsGuard so inventory/marketing can export their own modules.
const FINANCIAL_EXPORT_TYPES = new Set<ReportType>([
  "journal",
  "trial-balance",
  "profit-loss",
  "balance-sheet",
  "cash-flow",
]);

function exportAuthByType(req: Request, res: Response, next: NextFunction) {
  const type = req.params.type as ReportType;
  const guard = FINANCIAL_EXPORT_TYPES.has(type) ? reportReadGuard : exportsGuard;
  return guard(req, res, next);
}

router.use("/exports/:type.xlsx", exportAuthByType);
router.use("/exports/:type.pdf", exportAuthByType);

// Aggregate posted-only line totals per account, optionally filtered by date
// range. Used by the four financial-statement exports below.
async function postedAccountTotals(from?: string, to?: string) {
  const wheres = [eq(journalEntriesTable.status, "posted")];
  if (from) wheres.push(gte(journalEntriesTable.entryDate, from));
  if (to) wheres.push(lte(journalEntriesTable.entryDate, to));
  return db
    .select({
      accountId: accountsTable.id,
      code: accountsTable.code,
      nameAr: accountsTable.nameAr,
      type: accountsTable.type,
      debit: sql<string>`coalesce(sum(${journalEntryLinesTable.baseDebit}::numeric),0)`,
      credit: sql<string>`coalesce(sum(${journalEntryLinesTable.baseCredit}::numeric),0)`,
    })
    .from(accountsTable)
    .innerJoin(journalEntryLinesTable, eq(journalEntryLinesTable.accountId, accountsTable.id))
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
    .where(and(...wheres))
    .groupBy(accountsTable.id, accountsTable.code, accountsTable.nameAr, accountsTable.type);
}

async function fetchReportRows(
  type: ReportType,
  q: { from?: string; to?: string } = {},
): Promise<{ headers: string[]; rows: Array<Array<string | number>>; title: string }> {
  switch (type) {
    case "sales": {
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const orders = await db
        .select({
          orderNumber: posOrdersTable.orderNumber,
          total: posOrdersTable.total,
          paymentMethod: posOrdersTable.paymentMethod,
          createdAt: posOrdersTable.createdAt,
        })
        .from(posOrdersTable)
        .where(gte(posOrdersTable.createdAt, start))
        .orderBy(desc(posOrdersTable.createdAt));
      return {
        title: "تقرير المبيعات (آخر 30 يوم)",
        headers: ["رقم الطلب", "الإجمالي", "طريقة الدفع", "التاريخ"],
        rows: orders.map((o) => [o.orderNumber, Number(o.total), o.paymentMethod, o.createdAt.toISOString().slice(0, 19).replace("T", " ")]),
      };
    }
    case "products": {
      const rows = await db
        .select({
          sku: productsTable.sku,
          name: productsTable.nameAr,
          stock: productsTable.stock,
          price: productsTable.price,
          costPrice: productsTable.costPrice,
        })
        .from(productsTable)
        .orderBy(desc(productsTable.id));
      return {
        title: "تقرير المنتجات والمخزون",
        headers: ["SKU", "الاسم", "المخزون", "سعر البيع", "سعر التكلفة"],
        rows: rows.map((r) => [r.sku, r.name, r.stock, Number(r.price), Number(r.costPrice)]),
      };
    }
    case "invoices": {
      const rows = await db
        .select({
          invoiceNumber: invoicesTable.invoiceNumber,
          supplierName: invoicesTable.supplierName,
          amount: invoicesTable.amount,
          status: invoicesTable.status,
          createdAt: invoicesTable.createdAt,
        })
        .from(invoicesTable)
        .orderBy(desc(invoicesTable.createdAt))
        .limit(500);
      return {
        title: "تقرير فواتير الموردين",
        headers: ["رقم الفاتورة", "المورد", "المبلغ", "الحالة", "التاريخ"],
        rows: rows.map((r) => [r.invoiceNumber, r.supplierName, Number(r.amount), r.status, r.createdAt.toISOString().slice(0, 10)]),
      };
    }
    case "suppliers": {
      const rows = await db
        .select({
          name: suppliersTable.name,
          vatNumber: suppliersTable.vatNumber,
          phone: suppliersTable.phone,
          email: suppliersTable.email,
          balance: suppliersTable.balance,
          invoicesCount: sql<number>`(select count(*) from ${invoicesTable} where ${invoicesTable.supplierId} = ${suppliersTable.id})`,
        })
        .from(suppliersTable)
        .orderBy(desc(suppliersTable.createdAt));
      return {
        title: "تقرير الموردين",
        headers: ["الاسم", "الرقم الضريبي", "الهاتف", "البريد", "الرصيد", "عدد الفواتير"],
        rows: rows.map((r) => [r.name, r.vatNumber ?? "-", r.phone ?? "-", r.email ?? "-", Number(r.balance), Number(r.invoicesCount)]),
      };
    }
    case "journal": {
      const { eq } = await import("drizzle-orm");
      const rows = await db
        .select({
          entryNumber: journalEntriesTable.entryNumber,
          entryDate: journalEntriesTable.entryDate,
          description: journalEntriesTable.description,
          accountCode: accountsTable.code,
          accountName: accountsTable.nameAr,
          debit: journalEntryLinesTable.debit,
          credit: journalEntryLinesTable.credit,
          reference: journalEntriesTable.reference,
          status: journalEntriesTable.status,
        })
        .from(journalEntryLinesTable)
        .innerJoin(
          journalEntriesTable,
          eq(journalEntriesTable.id, journalEntryLinesTable.entryId),
        )
        .innerJoin(
          accountsTable,
          eq(accountsTable.id, journalEntryLinesTable.accountId),
        )
        .orderBy(desc(journalEntriesTable.entryDate), desc(journalEntriesTable.id))
        .limit(2000);
      return {
        title: "دفتر اليومية",
        headers: ["التاريخ", "رقم القيد", "البيان", "الحساب", "مدين", "دائن", "المرجع", "الحالة"],
        rows: rows.map((r) => [
          r.entryDate,
          r.entryNumber,
          r.description,
          `${r.accountCode} - ${r.accountName}`,
          Number(r.debit),
          Number(r.credit),
          r.reference ?? "-",
          r.status,
        ]),
      };
    }
    case "trial-balance": {
      const totals = await postedAccountTotals(q.from, q.to);
      const range = `${q.from ?? "البداية"} → ${q.to ?? "حتى الآن"}`;
      return {
        title: `ميزان المراجعة (${range})`,
        headers: ["الكود", "الحساب", "النوع", "مدين", "دائن"],
        rows: totals.map((r) => [r.code, r.nameAr, r.type, Number(r.debit), Number(r.credit)]),
      };
    }
    case "profit-loss": {
      const totals = await postedAccountTotals(q.from, q.to);
      const range = `${q.from ?? "البداية"} → ${q.to ?? "حتى الآن"}`;
      const out: Array<Array<string | number>> = [];
      let totalRev = 0;
      let totalExp = 0;
      for (const r of totals) {
        if (r.type === "revenue") {
          const v = Number(r.credit) - Number(r.debit);
          if (v !== 0) out.push([r.code, r.nameAr, "إيراد", v]);
          totalRev += v;
        } else if (r.type === "expense") {
          const v = Number(r.debit) - Number(r.credit);
          if (v !== 0) out.push([r.code, r.nameAr, "مصروف", v]);
          totalExp += v;
        }
      }
      out.push(["", "إجمالي الإيرادات", "", totalRev]);
      out.push(["", "إجمالي المصروفات", "", totalExp]);
      out.push(["", "صافي الربح", "", totalRev - totalExp]);
      return {
        title: `قائمة الدخل (${range})`,
        headers: ["الكود", "الحساب", "النوع", "المبلغ"],
        rows: out,
      };
    }
    case "balance-sheet": {
      const totals = await postedAccountTotals(undefined, q.to);
      const out: Array<Array<string | number>> = [];
      let assets = 0;
      let liabilities = 0;
      let equity = 0;
      let revenue = 0;
      let expense = 0;
      for (const r of totals) {
        if (r.type === "asset") {
          const v = Number(r.debit) - Number(r.credit);
          if (v !== 0) out.push([r.code, r.nameAr, "أصول", v]);
          assets += v;
        } else if (r.type === "liability") {
          const v = Number(r.credit) - Number(r.debit);
          if (v !== 0) out.push([r.code, r.nameAr, "خصوم", v]);
          liabilities += v;
        } else if (r.type === "equity") {
          const v = Number(r.credit) - Number(r.debit);
          if (v !== 0) out.push([r.code, r.nameAr, "حقوق ملكية", v]);
          equity += v;
        } else if (r.type === "revenue") {
          revenue += Number(r.credit) - Number(r.debit);
        } else if (r.type === "expense") {
          expense += Number(r.debit) - Number(r.credit);
        }
      }
      // Match /reports/balance-sheet: roll the period's net income into
      // equity so the sheet ties out before year-end close.
      const netIncome = revenue - expense;
      out.push(["NI", "صافي الدخل (الحالي)", "حقوق ملكية", netIncome]);
      const totalEquity = equity + netIncome;
      out.push(["", "إجمالي الأصول", "", assets]);
      out.push(["", "إجمالي الخصوم", "", liabilities]);
      out.push(["", "حقوق الملكية (شامل صافي الدخل)", "", totalEquity]);
      out.push(["", "الخصوم + حقوق الملكية", "", liabilities + totalEquity]);
      return {
        title: `الميزانية العمومية (${q.to ?? "حتى الآن"})`,
        headers: ["الكود", "الحساب", "النوع", "الرصيد"],
        rows: out,
      };
    }
    case "cash-flow": {
      // MVP: cash-flow approximated from movement on cash + bank accounts.
      const wheres = [eq(journalEntriesTable.status, "posted")];
      if (q.from) wheres.push(gte(journalEntriesTable.entryDate, q.from));
      if (q.to) wheres.push(lte(journalEntriesTable.entryDate, q.to));
      const lines = await db
        .select({
          accountCode: accountsTable.code,
          accountName: accountsTable.nameAr,
          systemKey: accountsTable.systemKey,
          entryDate: journalEntriesTable.entryDate,
          entryNumber: journalEntriesTable.entryNumber,
          description: journalEntriesTable.description,
          debit: journalEntryLinesTable.baseDebit,
          credit: journalEntryLinesTable.baseCredit,
        })
        .from(journalEntryLinesTable)
        .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
        .innerJoin(accountsTable, eq(accountsTable.id, journalEntryLinesTable.accountId))
        .where(and(...wheres, sql`${accountsTable.systemKey} IN ('cash','bank')`))
        .orderBy(journalEntriesTable.entryDate);
      let net = 0;
      const out: Array<Array<string | number>> = lines.map((l) => {
        const v = Number(l.debit) - Number(l.credit);
        net += v;
        return [l.entryDate, l.entryNumber, l.description, l.accountCode, l.accountName, v];
      });
      out.push(["", "", "صافي تغير النقد", "", "", net]);
      return {
        title: `قائمة التدفقات النقدية (${q.from ?? "البداية"} → ${q.to ?? "حتى الآن"})`,
        headers: ["التاريخ", "رقم القيد", "البيان", "الكود", "الحساب", "صافي"],
        rows: out,
      };
    }
  }
}

router.get("/exports/:type.xlsx", async (req, res) => {
  const type = req.params.type as ReportType;
  if (!ALL_REPORT_TYPES.includes(type)) {
    return res.status(400).json({ error: "نوع التقرير غير مدعوم" });
  }
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  try {
    const { title, headers, rows } = await fetchReportRows(type, { from, to });
    const wb = new ExcelJS.Workbook();
    wb.creator = "حاسبة.AI";
    wb.created = new Date();
    const ws = wb.addWorksheet(title.slice(0, 30), { views: [{ rightToLeft: true }] });

    ws.mergeCells(1, 1, 1, headers.length);
    ws.getCell(1, 1).value = title;
    ws.getCell(1, 1).font = { bold: true, size: 16 };
    ws.getCell(1, 1).alignment = { horizontal: "center" };

    ws.addRow([]);
    const headerRow = ws.addRow(headers);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
      cell.alignment = { horizontal: "center" };
    });

    rows.forEach((r) => ws.addRow(r));
    ws.columns.forEach((col) => {
      col.width = Math.max(14, ...rows.map((r) => String(r[col.number! - 1] ?? "").length + 2));
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${type}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    void recordAudit(req, { action: "export", entity: "report", details: `Excel: ${type}` });
    await wb.xlsx.write(res);
    return res.end();
  } catch (err) {
    req.log.error({ err }, "xlsx export failed");
    return res.status(500).json({ error: "فشل توليد الملف" });
  }
});

router.get("/exports/:type.pdf", async (req, res) => {
  const type = req.params.type as ReportType;
  if (!ALL_REPORT_TYPES.includes(type)) {
    return res.status(400).json({ error: "نوع التقرير غير مدعوم" });
  }
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  try {
    const { title, headers, rows } = await fetchReportRows(type, { from, to });

    const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape", info: { Title: title } });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${type}-${new Date().toISOString().slice(0, 10)}.pdf"`);
    doc.pipe(res);

    const company = await loadBrand();
    const { useReg, useBold, T } = registerArabicFonts(doc);
    const startY = drawBrandedHeader(doc, company, { title });

    const tableTop = startY;
    const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / headers.length;

    doc.fontSize(10).fillColor("#fff").rect(doc.page.margins.left, tableTop, doc.page.width - doc.page.margins.left - doc.page.margins.right, 22).fill(BRAND.accent);
    doc.fillColor("#fff");
    useBold();
    headers.forEach((h, i) => {
      doc.text(T(h), doc.page.margins.left + i * colWidth + 4, tableTop + 6, { width: colWidth - 8, align: "center" });
    });
    useReg();

    let y = tableTop + 24;
    doc.fillColor("#000").fontSize(9);
    for (const row of rows) {
      if (y > doc.page.height - doc.page.margins.bottom - 30) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      row.forEach((cell, i) => {
        doc.text(T(String(cell)), doc.page.margins.left + i * colWidth + 4, y, { width: colWidth - 8, align: "center" });
      });
      doc.moveTo(doc.page.margins.left, y + 14)
        .lineTo(doc.page.width - doc.page.margins.right, y + 14)
        .strokeColor("#eee")
        .stroke();
      y += 18;
    }

    doc.fontSize(9).fillColor("#666").text(`Total rows: ${rows.length}`, doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 20);
    drawBrandedFooter(doc, company, `${type} export`);
    void recordAudit(req, { action: "export", entity: "report", details: `PDF: ${type}` });
    doc.end();
    return;
  } catch (err) {
    req.log.error({ err }, "pdf export failed");
    return res.status(500).json({ error: "فشل توليد الملف" });
  }
});

export default router;
