import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { Response } from "express";
import type { BuiltReport } from "./query-builder";
import { rowsToCsv } from "./query-builder";
import { registerArabicFonts } from "./pdf/arabic-font";
import { drawBrandedHeader, drawBrandedFooter, loadBrand, BRAND } from "./pdf/branding-header";

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
  const { useReg, useBold, T } = registerArabicFonts(doc);
  // loadBrand() is async; consume via a guarded promise since the
  // surrounding signature is sync. We defer the table render until
  // branding loads, but MUST always finalise the doc on any failure
  // path so the HTTP response never hangs.
  doc.on("error", (err) => {
    res.destroy(err instanceof Error ? err : new Error(String(err)));
  });
  renderReportPdf(doc, name, report, T, useReg, useBold).catch((err: unknown) => {
    try {
      doc.fontSize(10).fillColor("#b91c1c").text(
        `Report generation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } catch {
      /* doc may already be in an error state */
    }
    try { doc.end(); } catch { /* noop */ }
  });
  return;
}

async function renderReportPdf(
  doc: PDFKit.PDFDocument,
  name: string,
  report: BuiltReport,
  T: (s: string) => string,
  useReg: () => void,
  useBold: () => void,
): Promise<void> {
  const headers = report.outputColumns.map((c) => c.label);
  const company = await loadBrand();
  const startY = drawBrandedHeader(doc, company, { title: name });
  const tableTop = startY;
  const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / Math.max(headers.length, 1);
  doc.fontSize(10).rect(doc.page.margins.left, tableTop, doc.page.width - doc.page.margins.left - doc.page.margins.right, 22).fill(BRAND.accent);
  doc.fillColor("#fff");
  useBold();
  headers.forEach((h, i) => {
    doc.text(T(String(h)), doc.page.margins.left + i * colWidth + 4, tableTop + 6, { width: colWidth - 8, align: "center" });
  });
  useReg();
  let y = tableTop + 24;
  doc.fillColor("#000").fontSize(9);
  for (const r of report.rows) {
    if (y > doc.page.height - doc.page.margins.bottom - 30) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    report.outputColumns.forEach((c, i) => {
      doc.text(T(String(r[c.key] ?? "")), doc.page.margins.left + i * colWidth + 4, y, { width: colWidth - 8, align: "center" });
    });
    y += 18;
  }
  doc.fontSize(9).fillColor("#666").text(`Total rows: ${report.rowCount}`, doc.page.margins.left, doc.page.height - doc.page.margins.bottom - 20);
  drawBrandedFooter(doc, company, name);
  doc.end();
}
