import { EditorDesignSchema, type EditorDesign } from "../invoice-editor-schema";
import type { PrintDocument } from "./print-document";

/** Trusted structural transformation of our own escaped HTML, never user HTML.
 * Deliberately separate from the frozen legacy/v2 rendering paths. */
export function invoiceLayoutV3(html: string, input: PrintDocument, value: EditorDesign): string {
  const design = EditorDesignSchema.parse(value);
  // The accepted 58mm renderer is not redesigned by this editor.
  if (input.thermalWidth === 58) return html;
  const layout = input.thermalWidth ? design.thermal80 : design.a4;
  const match = (pattern: RegExp) => html.match(pattern)?.[0] ?? "";
  const header = match(/<header>[\s\S]*?<\/header>/);
  const metadata = match(/<dl>[\s\S]*?<\/dl>/);
  const pairs = metadata.match(/<div class="metadata-pair">[\s\S]*?<\/div>/g) ?? [];
  const customer = pairs.filter(pair => /<dt>[\s\S]*?(?:الطرف|العميل)/.test(pair));
  const references = pairs.filter(pair => !customer.includes(pair));
  let items = match(/<table class="line-items">[\s\S]*?<\/table>/);
  const count = input.headers.length;
  let widths = count === 5 ? [...layout.widths] :
    count === 4 ? layout.widths.filter((_, i) => i !== 3) : Array(count).fill(100 / Math.max(count, 1));
  const sum = widths.reduce((a, b) => a + b, 0);
  widths = widths.map(w => w / sum * (layout.showSequence ? 95 : 100));
  if (layout.showSequence) {
    widths.unshift(5);
    let index = 0;
    items = items.replace("<thead><tr>", "<thead><tr><th>#</th>")
      .replace(/<tbody>([\s\S]*?)<\/tbody>/, (_, body: string) =>
        `<tbody>${body.replace(/<tr>/g, () => `<tr><td>${++index}</td>`)}</tbody>`);
  }
  items = items.replace(/<colgroup>[\s\S]*?<\/colgroup>/,
    `<colgroup>${widths.map(w => `<col style="width:${w}%">`).join("")}</colgroup>`);
  const blocks: Record<string, string> = {
    identity: header,
    customer: customer.length ? `<dl class="editor-customer">${customer.join("")}</dl>` : "",
    references: references.length ? `<dl class="editor-references">${references.join("")}</dl>` : "",
    items,
    totals: match(/<table class="totals">[\s\S]*?<\/table>/),
    qr: match(/<img class="qr"[^>]*>/),
    notes: (html.match(/<p class="note">[\s\S]*?<\/p>/g) ?? []).join(""),
    footer: match(/<p class="design-footer">[\s\S]*?<\/p>/),
  };
  const thermal = !!input.thermalWidth;
  const css = `
    @page{size:${thermal ? "80mm 297mm" : "A4 portrait"};margin:${layout.margin}mm ${layout.margin}mm ${thermal ? 8 : 18}mm}
    body{${thermal ? `width:${80 - 2 * layout.margin}mm;` : ""}font-size:${thermal ? 11 : design.base.fontSize}px}
    body>header,body>dl,body>table,body>.note,body>.qr,body>.design-footer{margin-top:${layout.gap}mm;margin-bottom:${layout.gap}mm}
    header{display:block;text-align:${layout.align};break-inside:avoid}
    header .brand-logo{margin-top:${layout.logoGap}mm;margin-bottom:${layout.logoGap}mm}
    dl{display:grid;grid-template-columns:repeat(${layout.metadataColumns},minmax(0,1fr))}
    .metadata-pair{min-width:0}
    .totals,.qr,.design-footer{break-inside:avoid}
    table.line-items{font-size:${thermal ? 10 : design.base.fontSize}px}
  `;
  // Keep an adjacent ending run together on A4; QR/notes must not become a
  // note-only final page. Thermal's existing document-end handler still splits
  // complete children on the roll, preserving bounded measured sheets.
  const ending = new Set(["totals", "qr", "notes", "footer"]);
  const ordered: string[] = [];
  for (let i = 0; i < layout.order.length;) {
    const key = layout.order[i]!;
    // A long item table can fill the preceding page exactly, leaving only a
    // small summary page even when the summary itself stays together. Keep
    // its last three original rows with an immediately following ending run.
    // Rows are MOVED, not copied, and repeated headers contain no line facts.
    if (key === "items" && ending.has(layout.order[i + 1] ?? "")) {
      const tbody = items.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
      const rows = tbody.match(/<tr>[\s\S]*?<\/tr>/g) ?? [];
      if (rows.length > 3) {
        const head = items.slice(0, items.indexOf("<tbody>"));
        ordered.push(`${head}<tbody>${rows.slice(0, -3).join("")}</tbody></table>`);
        const tail = `${head}<tbody>${rows.slice(-3).join("")}</tbody></table>`;
        i++;
        const end: string[] = [];
        while (i < layout.order.length && ending.has(layout.order[i]!)) end.push(blocks[layout.order[i++]!]!);
        ordered.push(`<div class="document-end">${tail}${end.join("\n")}</div>`);
        continue;
      }
    }
    if (!ending.has(key)) { ordered.push(blocks[key]!); i++; continue; }
    const run: string[] = [];
    while (i < layout.order.length && ending.has(layout.order[i]!)) run.push(blocks[layout.order[i++]!]!);
    ordered.push(`<div class="document-end">${run.join("\n")}</div>`);
  }
  // Line-item tables remain direct flow children so the accepted paginator
  // splits rows and repeats table headers, not an unbreakable invoice wrapper.
  return html.replace("</style>", css + "</style>")
    .replace(/(<body[^>]*>)[\s\S]*<\/body>/, (_all, opening: string) => `${opening}${ordered.join("\n")}</body>`);
}
