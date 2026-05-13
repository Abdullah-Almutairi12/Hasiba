import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { Response } from "express";
import type { BuiltReport } from "./query-builder";
import { rowsToCsv } from "./query-builder";

export function streamCsv(res: Response, name: string, report: BuiltReport): void {
  const headers = report.outputColumns.map((c) => c.label);
  const rows = report.rows.map((r) =>
    report.outputColumns.map((c) => {
      const v = r[c.key];
      return v == null ? "" : (v as string | number);
    }),
  );
  const csv = rowsToCsv(headers, rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.csv"`);
  res.send(csv);
}

export async function streamXlsx(res: Response, name: string, report: BuiltReport): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "حاسبة.AI";
  wb.created = new Date();
  const ws = wb.addWorksheet(name.slice(0, 30) || "Report", { views: [{ rightToLeft: true }] });
  const headers = report.outputColumns.map((c) => c.label);
  ws.addRow([name]);
  ws.mergeCells(1, 1, 1, headers.length || 1);
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.addRow([]);
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    cell.alignment = { horizontal: "center" };
  });
  for (const r of report.rows) {
    ws.addRow(report.outputColumns.map((c) => r[c.key] as string | number | null));
  }
  ws.columns.forEach((col) => {
    let max = 12;
    for (const r of report.rows) {
      const v = String(r[col.number ? report.outputColumns[col.number - 1]?.key ?? "" : ""] ?? "");
      if (v.length + 2 > max) max = v.length + 2;
    }
    col.width = Math.min(max, 60);
  });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

export function streamPdf(res: Response, name: string, report: BuiltReport): void {
  const headers = report.outputColumns.map((c) => c.label);
  const doc = new PDFDocument({ size: "A4", margin: 36, layout: "landscape", info: { Title: name } });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.pdf"`);
  doc.pipe(res);
  doc.fontSize(18).text(name, { align: "center" });
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor("#666").text(`Generated: ${new Date().toISOString().slice(0, 19).replace("T", " ")}`, { align: "center" });
  doc.moveDown(1);
  const tableTop = doc.y;
  const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / Math.max(headers.length, 1);
  doc.fontSize(10).rect(doc.page.margins.left, tableTop, doc.page.width - doc.page.margins.left - doc.page.margins.right, 22).fill("#2563EB");
  doc.fillColor("#fff");
  headers.forEach((h, i) => {
    doc.text(String(h), doc.page.margins.left + i * colWidth + 4, tableTop + 6, { width: colWidth - 8, align: "center" });
  });
  let y = tableTop + 24;
  doc.fillColor("#000").fontSize(9);
  for (const r of report.rows) {
    if (y > doc.page.height - doc.page.margins.bottom - 30) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    report.outputColumns.forEach((c, i) => {
      doc.text(String(r[c.key] ?? ""), doc.page.margins.left + i * colWidth + 4, y, { width: colWidth - 8, align: "center" });
    });
    y += 18;
  }
  doc.fontSize(9).fillColor("#666").text(`Total rows: ${report.rowCount}`, doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 20);
  doc.end();
}
