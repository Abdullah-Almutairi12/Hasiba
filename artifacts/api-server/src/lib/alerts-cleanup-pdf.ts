/**
 * Task #178: shared generator for the nightly-cleanup history PDF.
 *
 * Extracted out of `routes/admin.ts` so both the on-demand download
 * endpoint (`GET /admin/system-settings/alerts-cleanup-runs.pdf`) and
 * the scheduled email worker (`alerts-cleanup-report-email.ts`) can
 * emit the same Arabic-aware, page-numbered, branded PDF.
 */

import { db, alertsCleanupRunsTable } from "@workspace/db";
import { and, desc, gte, lte } from "drizzle-orm";

export interface AlertsCleanupPdfWindow {
  from: Date | null;
  to: Date | null;
}

export interface AlertsCleanupPdfResult {
  buffer: Buffer;
  filename: string;
  rowCount: number;
}

export async function buildAlertsCleanupPdf(
  window: AlertsCleanupPdfWindow,
): Promise<AlertsCleanupPdfResult> {
  const { from, to } = window;
  const conds = [] as Array<ReturnType<typeof gte>>;
  if (from) conds.push(gte(alertsCleanupRunsTable.ranAt, from));
  if (to) conds.push(lte(alertsCleanupRunsTable.ranAt, to));
  const rows = await db
    .select()
    .from(alertsCleanupRunsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(alertsCleanupRunsTable.ranAt));

  const PDFDocument = (await import("pdfkit")).default;
  const { registerArabicFonts } = await import("./pdf/arabic-font");
  const { drawBrandedHeader, drawBrandedFooter, loadBrand, BRAND } =
    await import("./pdf/branding-header");
  const company = await loadBrand();

  const doc = new PDFDocument({
    size: "A4",
    margin: 40,
    bufferPages: true,
    info: { Title: "Alerts Cleanup History" },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done: Promise<Buffer> = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const { useReg, useBold, T } = registerArabicFonts(
    doc as unknown as Parameters<typeof registerArabicFonts>[0],
  );
  const fmtDate = (d: Date | null) =>
    d ? d.toISOString().slice(0, 10) : "—";
  const rangeLabel = T(
    `النطاق / Range: ${fmtDate(from)} → ${fmtDate(to)}  ·  ${rows.length} تشغيل / runs`,
  );
  const startY = drawBrandedHeader(
    doc as unknown as Parameters<typeof drawBrandedHeader>[0],
    company,
    {
      title: "Alerts Cleanup History  /  سجل تنظيف التنبيهات",
      subtitle: rangeLabel,
    },
  );

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const fullWidth = right - left;
  const cols = [
    { w: fullWidth * 0.5, label: "Ran at / وقت التشغيل" },
    { w: fullWidth * 0.25, label: "Rows deleted / المحذوفات" },
    { w: fullWidth * 0.25, label: "Retention / الاحتفاظ" },
  ];
  const colX = (i: number) =>
    left + cols.slice(0, i).reduce((s, c) => s + c.w, 0);

  const headerH = 22;
  const rowH = 18;
  const tableTop = startY;

  doc.rect(left, tableTop, fullWidth, headerH).fill(BRAND.accent);
  useBold();
  doc.fillColor("#ffffff").fontSize(10);
  cols.forEach((c, i) => {
    doc.text(T(c.label), colX(i) + 4, tableTop + 6, {
      width: c.w - 8,
      align: "center",
    });
  });
  useReg();

  let y = tableTop + headerH;
  const bottomLimit = doc.page.height - doc.page.margins.bottom - 30;
  doc.fillColor("#111827").fontSize(9);
  rows.forEach((r, idx) => {
    if (y + rowH > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
      doc.rect(left, y, fullWidth, headerH).fill(BRAND.accent);
      useBold();
      doc.fillColor("#ffffff").fontSize(10);
      cols.forEach((c, i) => {
        doc.text(T(c.label), colX(i) + 4, y + 6, {
          width: c.w - 8,
          align: "center",
        });
      });
      useReg();
      y += headerH;
      doc.fillColor("#111827").fontSize(9);
    }
    if (idx % 2 === 0) {
      doc.fillColor("#f8fafc").rect(left, y, fullWidth, rowH).fill();
      doc.fillColor("#111827");
    }
    const cells = [
      r.ranAt.toISOString().replace("T", " ").slice(0, 19),
      String(r.rowsDeleted),
      `${r.retentionDays} يوم / days`,
    ];
    cells.forEach((cell, i) => {
      doc.text(T(cell), colX(i) + 4, y + 4, {
        width: cols[i]!.w - 8,
        align: "center",
      });
    });
    y += rowH;
  });

  if (rows.length === 0) {
    doc
      .fontSize(11)
      .fillColor(BRAND.muted)
      .text(
        T(
          "لا توجد عمليات تنظيف في هذا النطاق / No cleanup runs in this range.",
        ),
        left,
        y + 16,
        { width: fullWidth, align: "center" },
      );
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    drawBrandedFooter(
      doc as unknown as Parameters<typeof drawBrandedFooter>[0],
      company,
      `Page ${i + 1} of ${range.count}`,
    );
  }

  doc.end();
  const buffer = await done;
  const filename = `alerts-cleanup-runs-${new Date()
    .toISOString()
    .slice(0, 10)}.pdf`;
  return { buffer, filename, rowCount: rows.length };
}
