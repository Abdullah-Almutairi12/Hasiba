/**
 * Shared XLSX / PDF rendering for tabular financial reports.
 *
 * Both `routes/exports.ts` (single-company) and the consolidated
 * exports in `routes/financial-reports.ts` (multi-company) feed
 * `{ title, headers, rows }` into these renderers so layout and
 * branding stay identical.
 */

import type { Response } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { registerArabicFonts } from "./pdf/arabic-font";
import {
  BRAND,
  drawBrandedFooter,
  drawBrandedHeader,
  loadBrand,
} from "./pdf/branding-header";

export type Cell = string | number | null | undefined;

export interface RenderInput {
  /** Filename slug used in `Content-Disposition`. */
  slug: string;
  title: string;
  /** Optional secondary line printed under the title (e.g. company list). */
  subtitle?: string | null;
  headers: string[];
  rows: Cell[][];
}

/** Stream the report to `res` as an .xlsx file. */
export async function renderXlsx(res: Response, input: RenderInput): Promise<void> {
  const { slug, title, subtitle, headers, rows } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = "حاسبة.AI";
  wb.created = new Date();
  const ws = wb.addWorksheet(title.slice(0, 30), {
    views: [{ rightToLeft: true }],
  });

  ws.mergeCells(1, 1, 1, headers.length);
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { bold: true, size: 16 };
  ws.getCell(1, 1).alignment = { horizontal: "center" };

  if (subtitle) {
    ws.mergeCells(2, 1, 2, headers.length);
    ws.getCell(2, 1).value = subtitle;
    ws.getCell(2, 1).font = { size: 10, color: { argb: "FF475569" } };
    ws.getCell(2, 1).alignment = { horizontal: "center" };
  }

  ws.addRow([]);
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2563EB" },
    };
    cell.alignment = { horizontal: "center" };
  });

  rows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((col) => {
    const colIdx = col.number;
    if (typeof colIdx !== "number") return;
    col.width = Math.max(
      14,
      ...rows.map((r) => String(r[colIdx - 1] ?? "").length + 2),
    );
  });

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${slug}-${new Date().toISOString().slice(0, 10)}.xlsx"`,
  );
  await wb.xlsx.write(res);
  res.end();
}

/** Stream the report to `res` as a branded landscape A4 PDF. */
export async function renderPdf(res: Response, input: RenderInput): Promise<void> {
  const { slug, title, subtitle, headers, rows } = input;
  const doc = new PDFDocument({
    size: "A4",
    margin: 36,
    layout: "landscape",
    info: { Title: title },
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${slug}-${new Date().toISOString().slice(0, 10)}.pdf"`,
  );
  doc.pipe(res);

  const company = await loadBrand();
  const { useReg, useBold, T } = registerArabicFonts(doc);
  const startY = drawBrandedHeader(doc, company, { title, subtitle: subtitle ?? null });

  const tableTop = startY;
  const colWidth =
    (doc.page.width - doc.page.margins.left - doc.page.margins.right) /
    headers.length;

  doc
    .fontSize(10)
    .fillColor("#fff")
    .rect(
      doc.page.margins.left,
      tableTop,
      doc.page.width - doc.page.margins.left - doc.page.margins.right,
      22,
    )
    .fill(BRAND.accent);
  doc.fillColor("#fff");
  useBold();
  headers.forEach((h, i) => {
    doc.text(T(h), doc.page.margins.left + i * colWidth + 4, tableTop + 6, {
      width: colWidth - 8,
      align: "center",
    });
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
      doc.text(
        T(String(cell ?? "")),
        doc.page.margins.left + i * colWidth + 4,
        y,
        { width: colWidth - 8, align: "center" },
      );
    });
    doc
      .moveTo(doc.page.margins.left, y + 14)
      .lineTo(doc.page.width - doc.page.margins.right, y + 14)
      .strokeColor("#eee")
      .stroke();
    y += 18;
  }

  doc
    .fontSize(9)
    .fillColor("#666")
    .text(
      `Total rows: ${rows.length}`,
      doc.page.margins.left,
      doc.page.height - doc.page.margins.bottom - 20,
    );
  drawBrandedFooter(doc, company, `${slug} export`);
  doc.end();
}
