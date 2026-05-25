import { registerArabicFonts } from "./arabic-font";
import { getCompanyInfo, type CompanyInfo } from "./purchase-order";

/** pdfkit's PDFDocument type without pulling the full module type here. */
type PdfDoc = {
  page: { width: number; height: number; margins: { left: number; right: number; top: number; bottom: number } };
  y: number;
  image: (src: Buffer, x: number, y: number, opts: { fit: [number, number] }) => unknown;
  fontSize: (n: number) => PdfDoc;
  fillColor: (c: string) => PdfDoc;
  strokeColor: (c: string) => PdfDoc;
  font: (n: string) => unknown;
  text: (s: string, x?: number, y?: number, opts?: { width?: number; align?: "left" | "center" | "right" }) => PdfDoc;
  moveTo: (x: number, y: number) => PdfDoc;
  lineTo: (x: number, y: number) => PdfDoc;
  stroke: () => PdfDoc;
  rect: (x: number, y: number, w: number, h: number) => PdfDoc;
  fill: (c?: string) => PdfDoc;
  moveDown: (n?: number) => PdfDoc;
  registerFont: (name: string, src: Buffer) => unknown;
};

/** Brand colors for all generated PDFs. Kept here so a future white-label
 *  change can swap palette in one place. */
export const BRAND = {
  primary: "#0f172a",
  accent: "#2563EB",
  muted: "#475569",
  subtle: "#64748b",
  hairline: "#e2e8f0",
} as const;

export type BrandedHeaderOptions = {
  title: string;
  subtitle?: string | null;
  /** ISO timestamp shown in the meta line. Defaults to `new Date()`. */
  generatedAt?: Date;
};

/**
 * Draw a consistent branded header at the top of any PDF: logo (if any),
 * bilingual company name, VAT/contact line, then a primary-colored title
 * + optional subtitle and "Generated at" meta. Returns the new cursor Y
 * so callers can keep writing content below.
 */
export function drawBrandedHeader(
  doc: PdfDoc,
  company: CompanyInfo,
  opts: BrandedHeaderOptions,
): number {
  const { useReg, useBold, T } = registerArabicFonts(doc);
  const left = doc.page.margins.left;
  const top = doc.page.margins.top;
  const right = doc.page.width - doc.page.margins.right;
  const fullWidth = right - left;

  let logoDrawn = false;
  if (company.logo) {
    try {
      doc.image(company.logo.data, right - 95, top, { fit: [95, 60] });
      logoDrawn = true;
    } catch {
      /* corrupt image — fall back to text-only */
    }
  }
  const textWidth = logoDrawn ? fullWidth - 110 : fullWidth;

  useBold();
  doc.fontSize(16).fillColor(BRAND.primary)
    .text(T(company.nameEn), left, top, { width: textWidth, align: "left" });
  useReg();
  doc.fontSize(11).fillColor(BRAND.muted)
    .text(T(company.nameAr), left, doc.y, { width: textWidth, align: "left" });
  doc.fontSize(8).fillColor(BRAND.subtle)
    .text(
      T(
        `${company.address} · ${company.phone} · ${company.email}${
          company.vatNumber && company.vatNumber !== "—" ? ` · VAT ${company.vatNumber}` : ""
        }`,
      ),
      left,
      doc.y + 2,
      { width: textWidth, align: "left" },
    );

  const ruleY = Math.max(doc.y, top + 60) + 8;
  doc.moveTo(left, ruleY).lineTo(right, ruleY).strokeColor(BRAND.hairline).stroke();

  useBold();
  doc.fontSize(16).fillColor(BRAND.primary)
    .text(T(opts.title), left, ruleY + 10, { width: fullWidth, align: "center" });

  let cursorY = doc.y;
  if (opts.subtitle) {
    useReg();
    doc.fontSize(10).fillColor(BRAND.muted)
      .text(T(opts.subtitle), left, cursorY + 2, { width: fullWidth, align: "center" });
    cursorY = doc.y;
  }

  useReg();
  const ts = (opts.generatedAt ?? new Date())
    .toISOString().slice(0, 19).replace("T", " ");
  doc.fontSize(8).fillColor(BRAND.subtle)
    .text(`Generated: ${ts}`, left, cursorY + 2, { width: fullWidth, align: "center" });

  return doc.y + 6;
}

/**
 * Draw a small bottom-of-page footer with company name and page-X-of-Y
 * style text. Caller passes the page index since pdfkit doesn't expose
 * page count until the doc is finalized.
 */
export function drawBrandedFooter(doc: PdfDoc, company: CompanyInfo, pageLabel: string): void {
  const { useReg, T } = registerArabicFonts(doc);
  useReg();
  const y = doc.page.height - doc.page.margins.bottom + 8;
  doc.fontSize(8).fillColor(BRAND.subtle)
    .text(
      T(`${company.nameAr} · ${company.nameEn} · ${pageLabel}`),
      doc.page.margins.left,
      y,
      { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: "center" },
    );
}

/** Convenience: resolve company info from DB+env in one call. */
export async function loadBrand(): Promise<CompanyInfo> {
  return getCompanyInfo();
}
