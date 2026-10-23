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
import type { ComplianceReportSummary } from "./compliance/report-section";

export interface AlertsCleanupPdfWindow {
  from: Date | null;
  to: Date | null;
}

export interface AlertsCleanupPdfResult {
  buffer: Buffer;
  filename: string;
  rowCount: number;
  complianceAlertCount: number;
}

export interface AlertsCleanupPdfOptions {
  /**
   * Phase 3: optional compliance section appended below the cleanup
   * runs table. When provided, the PDF emits a per-kind summary,
   * a table of recent alerts and a table of active intercompany
   * agreement PDFs (with their `/api/storage/objects/...` links).
   */
  compliance?: ComplianceReportSummary;
}

export async function buildAlertsCleanupPdf(
  window: AlertsCleanupPdfWindow,
  options: AlertsCleanupPdfOptions = {},
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

  const {buildPrintPdf}=await import("./pdf/print-document");
  const c=options.compliance;
  const buffer=await buildPrintPdf({title:"سجل تنظيف التنبيهات",subtitle:`${from?.toISOString().slice(0,10)??"البداية"} — ${to?.toISOString().slice(0,10)??"النهاية"}`,headers:["وقت التشغيل","المحذوفات","الاحتفاظ بالأيام"],rows:rows.map(r=>[r.ranAt.toISOString(),r.rowsDeleted,r.retentionDays]),
    sections:c?[{title:"ملخص الامتثال",body:`المفتوح: ${c.counts.openTotal}\nتسعير التحويل: ${c.counts.transferPricing}\nاتفاقية مفقودة: ${c.counts.agreementMissing}\nالزكاة: ${c.counts.zakat}`},{title:"التنبيهات",body:c.alerts.map(a=>`${a.createdAt.toISOString().slice(0,10)} | ${a.companyName} | ${a.kind} | ${a.ref??""} | ${a.message} | ${a.status}`).join("\n\n")},{title:"اتفاقيات بين الشركات",body:c.agreements.map(a=>`${a.companyName} | ${a.counterpartyName} | ${a.title} | ${a.effectiveFrom} — ${a.effectiveTo??""}\n${a.pdfUrl}`).join("\n\n")}]:[]});
  return {buffer,filename:`alerts-cleanup-runs-${new Date().toISOString().slice(0,10)}.pdf`,rowCount:rows.length,complianceAlertCount:c?.alerts.length??0};
}
/** Historical PDFKit reference; not used by HTTP or scheduled delivery. */
async function legacyAlertsCleanupPdf(window:AlertsCleanupPdfWindow,options:AlertsCleanupPdfOptions={}):Promise<AlertsCleanupPdfResult>{
  const {from,to}=window;
  const rows=await db.select().from(alertsCleanupRunsTable).where(and(...[from?gte(alertsCleanupRunsTable.ranAt,from):undefined,to?lte(alertsCleanupRunsTable.ranAt,to):undefined].filter((x):x is NonNullable<typeof x>=>x!=null))).orderBy(desc(alertsCleanupRunsTable.ranAt));

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
    y += 32;
  }

  // Phase 3 — compliance section (transfer pricing + zakat + agreements).
  if (options.compliance) {
    const c = options.compliance;
    if (y + 80 > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
    } else {
      y += 24;
    }
    useBold();
    doc.fillColor("#0f172a").fontSize(13).text(
      T("الامتثال / Compliance"),
      left,
      y,
      { width: fullWidth, align: "right" },
    );
    useReg();
    y += 22;
    doc.fillColor("#334155").fontSize(10).text(
      T(
        `تسعير تحويلي: ${c.counts.transferPricing}  ·  اتفاقيات مفقودة: ${c.counts.agreementMissing}  ·  زكاة: ${c.counts.zakat}  ·  مفتوحة: ${c.counts.openTotal}`,
      ),
      left,
      y,
      { width: fullWidth, align: "right" },
    );
    y += 18;

    const cAlertCols = [
      { w: fullWidth * 0.16, label: "التاريخ / Date" },
      { w: fullWidth * 0.18, label: "الشركة / Company" },
      { w: fullWidth * 0.16, label: "النوع / Kind" },
      { w: fullWidth * 0.4, label: "الرسالة / Message" },
      { w: fullWidth * 0.1, label: "الحالة / Status" },
    ];
    const cColX = (i: number) =>
      left + cAlertCols.slice(0, i).reduce((s, col) => s + col.w, 0);
    doc.rect(left, y, fullWidth, headerH).fill(BRAND.accent);
    useBold();
    doc.fillColor("#ffffff").fontSize(10);
    cAlertCols.forEach((col, i) => {
      doc.text(T(col.label), cColX(i) + 4, y + 6, {
        width: col.w - 8,
        align: "center",
      });
    });
    useReg();
    y += headerH;
    doc.fillColor("#111827").fontSize(9);

    if (c.alerts.length === 0) {
      doc
        .fillColor(BRAND.muted)
        .text(
          T("لا توجد تنبيهات امتثال / No compliance alerts in this range."),
          left,
          y + 6,
          { width: fullWidth, align: "center" },
        );
      y += 22;
    } else {
      c.alerts.forEach((a, idx) => {
        if (y + rowH > bottomLimit) {
          doc.addPage();
          y = doc.page.margins.top;
        }
        if (idx % 2 === 0) {
          doc.fillColor("#f8fafc").rect(left, y, fullWidth, rowH).fill();
          doc.fillColor("#111827");
        }
        const cells = [
          a.createdAt.toISOString().slice(0, 10),
          a.companyName,
          a.kind,
          (a.ref ? `[${a.ref}] ` : "") + a.message,
          a.status,
        ];
        cells.forEach((cell, i) => {
          doc.text(T(String(cell)), cColX(i) + 4, y + 4, {
            width: cAlertCols[i]!.w - 8,
            align: "center",
          });
        });
        y += rowH;
      });
    }

    // Active intercompany agreement PDFs.
    y += 14;
    if (y + 60 > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    useBold();
    doc.fillColor("#0f172a").fontSize(12).text(
      T("اتفاقيات بين الشركات السارية / Active Intercompany Agreements"),
      left,
      y,
      { width: fullWidth, align: "right" },
    );
    useReg();
    y += 18;
    if (c.agreements.length === 0) {
      doc
        .fontSize(10)
        .fillColor(BRAND.muted)
        .text(
          T("لم يتم رفع أي اتفاقية / No agreements on file."),
          left,
          y,
          { width: fullWidth, align: "center" },
        );
      y += 18;
    } else {
      doc.fontSize(9).fillColor("#0f172a");
      const baseUrl = (process.env["PUBLIC_BASE_URL"] ?? "").replace(/\/$/, "");
      c.agreements.forEach((ag, idx) => {
        if (y + rowH > bottomLimit) {
          doc.addPage();
          y = doc.page.margins.top;
        }
        if (idx % 2 === 0) {
          doc.fillColor("#f8fafc").rect(left, y, fullWidth, rowH).fill();
          doc.fillColor("#0f172a");
        }
        const linkText = `${ag.companyName} ⇄ ${ag.counterpartyName}: ${ag.title} (${ag.effectiveFrom} → ${ag.effectiveTo ?? "∞"})`;
        const link = `${baseUrl}${ag.pdfUrl}`;
        doc.text(T(linkText), left + 4, y + 4, {
          width: fullWidth - 8,
          align: "right",
          link,
          underline: true,
        });
        y += rowH;
      });
    }
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
  return {
    buffer,
    filename,
    rowCount: rows.length,
    complianceAlertCount: options.compliance?.alerts.length ?? 0,
  };
}
