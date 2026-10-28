import type { PrintDocument } from "./print-document";
import type { Page } from "playwright-core";
import { PDFDocument } from "pdf-lib";

/** Prospective layout only. The v1 stylesheet/markup remain untouched for
 * snapshots without an explicit layoutVersion. This is not a design schema. */
export function invoiceLayoutV2(html: string, input: PrintDocument): string {
  const columns = input.headers.length;
  const widths = columns === 5 ? [43, 8, 18, 10, 21] :
    columns === 4 ? [46, 9, 21, 24] : columns === 3 ? [56, 14, 30] : null;
  const css = `
    header{margin-bottom:10px;padding-bottom:8px}
    h1{margin:8px 0 4px}p{margin:4px 0}
    dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 18px;columns:auto;padding:8px}
    .metadata-pair{display:grid;grid-template-columns:minmax(65px,1fr) minmax(0,2fr);gap:4px;break-inside:avoid}
    dt,dd{display:block;float:none;margin:0;overflow-wrap:anywhere}
    table.line-items{margin:10px 0}table.line-items th,table.line-items td{padding:6px 5px}
    table.line-items td:not(:first-child){font-variant-numeric:tabular-nums}
    .totals{margin-top:8px;margin-bottom:8px}
    .totals td{padding:5px 7px}.totals tr:last-child{font-size:14px}
    .document-end{display:flow-root;break-inside:avoid}
    .document-end .qr{margin:8px auto}.note{margin-top:6px}
    .design-footer{margin:6px 0 0;padding-top:5px}
    ${input.thermalWidth ? `
      body{font-size:11px;line-height:1.5}
      header{display:block;text-align:center}header h1{font-size:16px}
      dl{display:block;padding:0;margin:8px 0}
      .metadata-pair{grid-template-columns:minmax(40px,1fr) minmax(0,2fr);margin:3px 0}
      table.line-items{font-size:10px}
      table.line-items th,table.line-items td{padding:4px 2px}
      .totals{width:100%}.totals td{padding:4px 2px}
      .totals tr:last-child{font-size:12px}
      .thermal-sheet{display:flow-root;break-inside:avoid}
      .thermal-sheet+.thermal-sheet{break-before:page}
    ` : ""}
  `;
  html = html.replace("</style>", `${css}</style>`)
    .replace(/<dt>([\s\S]*?)<\/dt><dd>([\s\S]*?)<\/dd>/g,
      '<div class="metadata-pair"><dt>$1</dt><dd>$2</dd></div>');
  if (columns) html = html.replace("<table>", `<table class="line-items">${widths ?
    `<colgroup>${widths.map(w => `<col style="width:${w}%">`).join("")}</colgroup>` : ""}`);
  // Keep the financial summary, original QR, notes and custom footer together
  // when they fit. Oversized genuine content still fragments normally in CSS.
  html = html.replace('<table class="totals">', '<div class="document-end"><table class="totals">')
    .replace("</body>", input.totals?.length ? "</div></body>" : "</body>");
  return html;
}

/** Same DOM/font engine, bounded sheets with a separately measured final page.
 * Only trusted code is evaluated; all document values are already escaped.
 * No PDF crop, text loss, external converter or alternative financial renderer. */
export const paginateThermalV2 = String.raw`(() => {
  const body=document.body, source=Array.from(body.children);
  const width=Number(body.dataset.thermalWidth);
  if(width!==58 && width!==80)throw new Error("INVALID_THERMAL_WIDTH");
  // Four extra millimetres cover Chromium's print fragmentation rounding
  // (collapsed table/image margins differ from the continuous DOM height).
  const maxPixels=(1000-16)*96/25.4, sheets=[];
  body.replaceChildren();
  const next=()=>{
    const sheet=document.createElement("div");sheet.className="thermal-sheet";
    body.append(sheet);sheets.push(sheet);return sheet;
  };
  let sheet=next();
  const height=()=>sheet.getBoundingClientRect().height;
  const append=node=>{
    sheet.append(node);
    if(height()>maxPixels && sheet.children.length>1){node.remove();sheet=next();sheet.append(node);}
  };
  for(const node of source){
    if(node.matches("table.line-items")){
      let table,tbody;
      const open=()=>{
        table=node.cloneNode(false);
        for(const child of node.children)if(child.tagName!=="TBODY")table.append(child.cloneNode(true));
        tbody=document.createElement("tbody");table.append(tbody);sheet.append(table);
      };
      open();
      for(const row of node.querySelectorAll("tbody>tr")){
        tbody.append(row);
        if(height()>maxPixels){
          row.remove();
          if(!tbody.children.length)table.remove();
          sheet=next();open();tbody.append(row);
          if(height()>maxPixels)throw new Error("THERMAL_ROW_EXCEEDS_SAFE_SHEET");
        }
      }
    }else if(node.matches(".document-end")){
      // Each child is a complete totals table, QR or paragraph. They can move
      // independently on a roll, never duplicate or disappear between sheets.
      for(const child of Array.from(node.children))append(child);
    }else append(node);
  }
  const dimensions=[];
  for(let i=0;i<sheets.length;i++){
    const s=sheets[i],h=Math.max(60,Math.ceil(s.getBoundingClientRect().height*25.4/96+16));
    if(h>1000)throw new Error("THERMAL_BLOCK_EXCEEDS_SAFE_SHEET");
    dimensions.push(h);
  }
  window.__thermalSheets=sheets;
  return dimensions;
})()`;

/** Chromium can fragment named pages differently from the measured DOM,
 * orphaning a QR despite apparent available space. Render each bounded sheet
 * through the SAME native renderer, then assemble its original vector pages.
 * pdf-lib never lays out text, changes financial data or crops PDF content. */
export async function renderThermalV2(page: Page, width: 58 | 80, options: NonNullable<Parameters<Page["pdf"]>[0]>): Promise<Buffer> {
  const heights = await page.evaluate(paginateThermalV2) as number[];
  const merged = await PDFDocument.create();
  for (let i = 0; i < heights.length; i++) {
    await page.evaluate(`(() => {
      document.body.replaceChildren(window.__thermalSheets[${i}]);
      document.styleSheets[0].insertRule("@page{size:${width}mm ${heights[i]}mm;margin:4mm 3mm 8mm}",document.styleSheets[0].cssRules.length);
    })()`);
    const bytes = await page.pdf({...options, footerTemplate:
      `<div style="font:9px sans-serif;width:100%;text-align:center;color:#516071">${i+1} / ${heights.length}</div>`});
    const native = await PDFDocument.load(bytes);
    if (native.getPageCount() !== 1) throw new Error("THERMAL_LAYOUT_OVERFLOW");
    if (heights.length === 1) return bytes;
    const [sheet] = await merged.copyPages(native, [0]);
    merged.addPage(sheet!);
  }
  return Buffer.from(await merged.save());
}
