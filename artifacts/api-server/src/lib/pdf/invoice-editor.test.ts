import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import QRCode from "qrcode";
import { defaultInvoiceDesign, invoicePresets } from "../invoice-design";
import { defaultEditorLayout, type EditorDesign } from "../invoice-editor-schema";
import { buildPrintPdf, printHtml, type PrintDocument } from "./print-document";
const out = resolve(process.cwd(), "../../generated-artifacts/invoice-editor-2b/matrix");
const inspect = String.raw`
import pymupdf,sys,json,re,hashlib
d=pymupdf.open(sys.argv[1]);out=[]
for p in d:
 b=[b for b in p.get_text("blocks") if not re.fullmatch(r"\s*\d+\s*/\s*\d+\s*",b[4])]
 out.append({"text":p.get_text(),"width":p.rect.width*25.4/72,"height":p.rect.height*25.4/72,
 "tail":(p.rect.height-max([b[3] for b in b]or[0]))*25.4/72,"pixels":hashlib.sha256(p.get_pixmap().samples).hexdigest()})
print(json.dumps(out))
`;
function record(name: string, pdf: Buffer): Array<{ text: string; width: number; height: number; tail: number; pixels: string }> {
  mkdirSync(out, { recursive: true });
  const path = resolve(out, `${name}.pdf`); writeFileSync(path, pdf);
  const pages = JSON.parse(execFileSync("python", ["-c", inspect, path], { encoding: "utf8" }));
  writeFileSync(resolve(out, `${name}.json`), JSON.stringify(pages, null, 2)); return pages;
}
const editor = (): EditorDesign => ({ schemaVersion: 1, name: "تصميم متقدم",
  base: { ...defaultInvoiceDesign, header: "CUSTOM-HEADER", note: "CUSTOM-NOTE", footer: "CUSTOM-FOOTER" },
  a4: { ...structuredClone(defaultEditorLayout), order: ["identity", "references", "customer", "items", "totals", "qr", "notes", "footer"] },
  thermal80: { ...structuredClone(defaultEditorLayout), margin: 3, metadataColumns: 1 } });
async function input(length: number, width?: 58 | 80): Promise<PrintDocument> {
  const design = editor();
  return { title: "فاتورة ضريبية — سلام الإقرار ABC-2026", layoutVersion: 3,
    invoiceDesign: design.base, editor: { rendererVersion: 3, releaseId: "synthetic", design }, thermalWidth: width,
    metadata: [["المرجع", "EDITOR-001"], ["العميل", "عميل عربي / English"], ["التاريخ", "28/10/2026"]],
    headers: ["الوصف", "الكمية", "سعر الوحدة", "الضريبة %", "الإجمالي"],
    rows: Array.from({ length }, (_, i) => [`ROW${String(i + 1).padStart(3, "0")} سلام الإقرار / Long Arabic English item ABC`, 2, 100, 15, 230]),
    totals: [["الإجمالي", length * 230]], notes: ["ORIGINAL-NOTE — بيانات مصدر محفوظة"],
    qr: await QRCode.toDataURL("EDITOR-SYNTHETIC-NOT-ZATCA-ACCEPTANCE", { margin: 2 }),
  };
}
describe("2b versioned print flow retains facts and accepted thermal bounds", () => {
  it("literal replacement tokens and HTML in custom text cannot duplicate or replace trusted source blocks", async () => {
    const doc = await input(3);
    doc.invoiceDesign!.note = "$& $1 <script>not executable</script>";
    const html = printHtml(doc);
    expect(html.match(/ROW001/g)).toHaveLength(1);
    expect(html).toContain("$&amp; $1 &lt;script&gt;not executable&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });
  for (const preset of invoicePresets) for (const length of [3, 80]) {
    it(`${preset.id} advanced ${length} rows preserves all source facts and readable tail`, async () => {
      const doc = await input(length);
      doc.editor!.design.base.preset = preset.id;
      doc.editor!.design.a4.showSequence = true;
      const pages = record(`${preset.id}-${length}-a4`, await buildPrintPdf(doc));
      const text = pages.map(p => p.text).join("\n");
      expect(text.match(/ROW\d{3}/g)).toHaveLength(length);
      for (const value of ["EDITOR-001", "CUSTOM-HEADER", "CUSTOM-NOTE", "CUSTOM-FOOTER", "ORIGINAL-NOTE"])
        expect(text).toContain(value);
      if (length === 3) expect(pages).toHaveLength(1);
      expect(pages.at(-1)!.tail).toBeLessThan(220);
    }, 60_000);
  }
  for (const width of [58, 80] as const) it(`${width}mm remains bounded and has no repeated or missing items`, async () => {
    const pages = record(`long-${width}`, await buildPrintPdf(await input(80, width)));
    expect(pages.map(p => p.text).join("\n").match(/ROW\d{3}/g)).toHaveLength(80);
    for (const page of pages) {
      expect(page.width).toBeCloseTo(width, 0); expect(page.height).toBeLessThan(1001);
      expect(page.tail).toBeLessThan(25);
    }
  }, 60_000);
  it("v3 settings cannot reinterpret unversioned/v2 snapshots; same 58mm snapshot follows accepted v2 output", async () => {
    const doc = await input(3, 58);
    const v2 = { ...doc, layoutVersion: 2 as const, editor: undefined };
    expect(printHtml(doc)).toBe(printHtml(v2));
    const a = record("historical58-v2", await buildPrintPdf(v2));
    const b = record("historical58-editor", await buildPrintPdf(doc));
    expect(b.map(p => [p.text, p.pixels])).toEqual(a.map(p => [p.text, p.pixels]));
    const unversioned = { ...doc, layoutVersion: undefined, editor: undefined };
    expect(printHtml(unversioned)).not.toContain("editor-customer");
    expect(printHtml(v2)).not.toContain("editor-customer");
  }, 60_000);
});
