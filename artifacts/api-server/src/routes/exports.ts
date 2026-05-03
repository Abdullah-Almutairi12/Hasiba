import { Router } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { db, posOrdersTable, productsTable, invoicesTable, suppliersTable, journalEntriesTable, journalEntryLinesTable, accountsTable } from "@workspace/db";
import { sql, desc, gte } from "drizzle-orm";
import { recordAudit } from "../lib/audit";
import { exportsGuard } from "../middlewares/require-role";

const router = Router();
// Financial exports include profit, balances, and journal entries — restrict to
// roles that already have read access to the underlying ledger / supplier data.
// Inventory and marketing also legitimately need to export their own modules.
const exportRoles = exportsGuard;
router.use("/exports/:type.xlsx", exportRoles);
router.use("/exports/:type.pdf", exportRoles);

type ReportType = "sales" | "products" | "invoices" | "suppliers" | "journal";

async function fetchReportRows(type: ReportType): Promise<{ headers: string[]; rows: Array<Array<string | number>>; title: string }> {
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
  }
}

router.get("/exports/:type.xlsx", async (req, res) => {
  const type = req.params.type as ReportType;
  if (!["sales", "products", "invoices", "suppliers", "journal"].includes(type)) {
    return res.status(400).json({ error: "نوع التقرير غير مدعوم" });
  }
  try {
    const { title, headers, rows } = await fetchReportRows(type);
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
  if (!["sales", "products", "invoices", "suppliers", "journal"].includes(type)) {
    return res.status(400).json({ error: "نوع التقرير غير مدعوم" });
  }
  try {
    const { title, headers, rows } = await fetchReportRows(type);

    const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape", info: { Title: title } });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${type}-${new Date().toISOString().slice(0, 10)}.pdf"`);
    doc.pipe(res);

    // Note: pdfkit's default font lacks Arabic glyphs. The title/headers will still
    // display as Latin characters; rows show as best-effort. For full Arabic shaping
    // we'd need to embed a TTF (e.g., IBM Plex Sans Arabic). MVP keeps it simple.
    doc.fontSize(18).text(title, { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(9).fillColor("#666").text(`Generated: ${new Date().toISOString().slice(0, 19).replace("T", " ")}`, { align: "center" });
    doc.moveDown(1);

    const tableTop = doc.y;
    const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / headers.length;

    doc.fontSize(10).fillColor("#fff").rect(doc.page.margins.left, tableTop, doc.page.width - doc.page.margins.left - doc.page.margins.right, 22).fill("#2563EB");
    doc.fillColor("#fff");
    headers.forEach((h, i) => {
      doc.text(h, doc.page.margins.left + i * colWidth + 4, tableTop + 6, { width: colWidth - 8, align: "center" });
    });

    let y = tableTop + 24;
    doc.fillColor("#000").fontSize(9);
    for (const row of rows) {
      if (y > doc.page.height - doc.page.margins.bottom - 30) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      row.forEach((cell, i) => {
        doc.text(String(cell), doc.page.margins.left + i * colWidth + 4, y, { width: colWidth - 8, align: "center" });
      });
      doc.moveTo(doc.page.margins.left, y + 14)
        .lineTo(doc.page.width - doc.page.margins.right, y + 14)
        .strokeColor("#eee")
        .stroke();
      y += 18;
    }

    doc.fontSize(9).fillColor("#666").text(`Total rows: ${rows.length}`, doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 20);
    void recordAudit(req, { action: "export", entity: "report", details: `PDF: ${type}` });
    doc.end();
    return;
  } catch (err) {
    req.log.error({ err }, "pdf export failed");
    return res.status(500).json({ error: "فشل توليد الملف" });
  }
});

export default router;
