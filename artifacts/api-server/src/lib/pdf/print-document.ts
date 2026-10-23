import { chromium,type Browser } from "playwright-core";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {createHash} from "node:crypto";
import type { Response } from "express";
import type { CompanyInfo } from "./purchase-order";

export type PrintCell = string | number | null | undefined;
export interface PrintDocument {
  title: string;
  subtitle?: string | null;
  language?: "ar" | "en";
  company?: CompanyInfo;
  headers: string[];
  rows: PrintCell[][];
  totals?: Array<[string, PrintCell]>;
  notes?: string[];
  qr?: string | null;
  landscape?: boolean;
  metadata?: Array<[string,string]>;
  sections?: Array<{ title:string;body:string;image?:string }>;
}
export const escapePrint = (v: unknown) => String(v ?? "").replace(/[\u20c1\ufdfc]/g,"ر.س").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[c]!);
export function printBrowserHtml(input:PrintDocument):string{
  const script="Promise.all([document.fonts.load('12px Tajawal'),document.fonts.load('700 12px Tajawal')]).then(()=>document.fonts.ready).then(()=>window.print())";
  const hash=createHash("sha256").update(script).digest("base64");
  return printHtml(input).replace("default-src 'none';",`default-src 'none';script-src 'sha256-${hash}';`).replace("</body>",`<script>${script}</script></body>`);
}
let active = 0;
let cachedFonts: string | undefined;
export function printFonts(): string {
  if (cachedFonts) return cachedFonts;
  const bases = [join(dirname(fileURLToPath(import.meta.url)), "fonts"), ...(typeof __dirname === "string" ? [join(__dirname,"fonts")] : [])];
  const base = bases.find(p => existsSync(join(p,"Tajawal-Regular.ttf")) && existsSync(join(p,"Tajawal-Bold.ttf")));
  if (!base) throw new Error("PRINT_FONTS_MISSING");
  cachedFonts = [ ["Regular",400],["Bold",700] ].map(([file,weight]) => `@font-face{font-family:Tajawal;font-weight:${weight};src:url(data:font/ttf;base64,${readFileSync(join(base,`Tajawal-${file}.ttf`)).toString("base64")}) format('truetype');font-display:block}`).join("");
  return cachedFonts;
}
const cell = (v: PrintCell) => `<bdi dir="auto">${escapePrint(v).replace(/(?<![A-Za-z0-9])(?:\([+\-\u2212]\d[\d.,-]*\)|[+\-\u2212]\d[\d.,-]*)/gu, value => `<bdi class="numeric-ltr" dir="ltr">${value}</bdi>`)}</bdi>`;
export function printHtml(input: PrintDocument): string {
  const lang = input.language ?? "ar";
  const c=input.company;
  const image = (url: string | null | undefined,className="qr") => url && /^data:image\/(?:png|jpeg);base64,[a-zA-Z0-9+/=\s]+$/.test(url) ? `<img class="${className}" src="${url}" alt="">` : "";
  return `<!doctype html><html lang="${lang}" dir="${lang==="ar"?"rtl":"ltr"}"><head><meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:">
  <title>${escapePrint(input.title)}</title><style>${printFonts()}
  @page{size:A4 ${input.landscape?"landscape":"portrait"};margin:15mm 12mm 18mm}
  *{box-sizing:border-box}body{margin:0;background:white;color:#142033;font:12px/1.65 Tajawal,sans-serif;font-feature-settings:"liga" 0,"rlig" 0}
  h1{font-size:23px;color:#152d50;margin:12px 0 5px}h2{font-size:16px;margin:0}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:5px 0}
  header{border-bottom:2px solid #285886;padding-bottom:10px;margin-bottom:14px}b,strong,th{font-weight:700}
  .muted{color:#526172;font-size:11px}.subtitle{margin-bottom:14px}table{width:100%;table-layout:fixed;border-collapse:collapse;margin:12px 0}
  thead{display:table-header-group}tfoot{display:table-footer-group}th{background:#edf2f7;color:#102e4b}
  th,td{padding:7px 8px;border-bottom:1px solid #dce3ea;vertical-align:top;overflow-wrap:anywhere;text-align:start}
  td{white-space:pre-wrap}tr{break-inside:avoid}bdi{unicode-bidi:plaintext}bdi.numeric-ltr{direction:ltr;unicode-bidi:isolate}.totals{width:65%;margin-inline-start:auto;break-inside:avoid}
  .totals tr:last-child{font-weight:700;background:#eef3f8;font-size:15px}.qr{width:30mm;height:30mm;image-rendering:pixelated;object-fit:contain}
  .note{font-size:11px;margin-top:12px}h1,h2{break-after:avoid}
  section{margin:18px 0}.illustration{display:block;width:100%;max-height:170mm;object-fit:contain}
  dl{display:grid;grid-template-columns:1fr 2fr;gap:5px 12px;margin:12px 0}dt{font-weight:700}dd{margin:0}
  </style></head><body><header>${c?`<h2>${cell(lang==="ar"?c.nameAr:c.nameEn)}</h2><p>${cell(c.address)}</p><p class="muted">${cell(c.vatNumber)} · ${cell(c.phone)} · ${cell(c.email)}</p>`:""}<h1>${cell(input.title)}</h1></header>
  ${input.subtitle?`<p class="subtitle">${cell(input.subtitle)}</p>`:""}
  ${input.metadata?.length?`<dl>${input.metadata.map(([label,value])=>`<dt>${cell(label)}</dt><dd>${cell(value)}</dd>`).join("")}</dl>`:""}
  ${input.headers.length?`<table><thead><tr>${input.headers.map(h=>`<th>${cell(h)}</th>`).join("")}</tr></thead><tbody>${input.rows.length?input.rows.map(r=>`<tr>${r.map(v=>`<td>${cell(v)}</td>`).join("")}</tr>`).join(""):`<tr><td colspan="${Math.max(1,input.headers.length)}">${lang==="ar"?"لا توجد عمليات مؤهلة في النطاق المختار":"No eligible transactions in the selected scope"}</td></tr>`}</tbody></table>`:""}
  ${input.totals?.length?`<table class="totals"><tbody>${input.totals.map(r=>`<tr><td>${cell(r[0])}</td><td>${cell(r[1])}</td></tr>`).join("")}</tbody></table>`:""}
  ${image(input.qr)}${(input.notes??[]).map(n=>`<p class="note">${cell(n)}</p>`).join("")}
  ${(input.sections??[]).map(s=>`<section><h2>${cell(s.title)}</h2>${image(s.image,"illustration")}<p>${cell(s.body)}</p></section>`).join("")}</body></html>`;
}
export async function buildPrintPdf(input: PrintDocument): Promise<Buffer> {
  if (active >= 2) throw new Error("PRINT_BUSY_RETRY");
  const html = printHtml(input); // Fail before launch and HTTP headers when assets are missing.
  active++;
  let browser:Browser|undefined;
  try {
    const executablePath=execFileSync("which",["chromium"],{encoding:"utf8"}).trim();
    browser=await chromium.launch({executablePath,headless:true,args:["--no-sandbox","--disable-dev-shm-usage","--disable-background-networking"],timeout:20000});
    const context=await browser.newContext({javaScriptEnabled:false,locale:input.language==="en"?"en-US":"ar-SA",timezoneId:"Asia/Riyadh",serviceWorkers:"block"});
    await context.route("**/*",r=>r.abort()); // No HTTP/file requests from untrusted fields.
    const page=await context.newPage();
    await page.setContent(html,{waitUntil:"load",timeout:20000});
    await page.emulateMedia({media:"print",colorScheme:"light"});
    const deadline=setTimeout(()=>{void browser?.close().catch(()=>{});},30000);
    try{
      await page.evaluate(`(async()=>{await document.fonts.load("12px Tajawal");await document.fonts.load("700 12px Tajawal");await document.fonts.ready;if(!document.fonts.check("12px Tajawal")||!document.fonts.check("700 12px Tajawal"))throw new Error("PRINT_FONTS_NOT_LOADED");})()`);
      return await page.pdf({format:"A4",landscape:input.landscape,preferCSSPageSize:true,printBackground:true,tagged:true,displayHeaderFooter:true,headerTemplate:"<span></span>",footerTemplate:'<div style="font:9px sans-serif;width:100%;text-align:center;color:#516071"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
    }finally{clearTimeout(deadline);}
  } finally {
    try { await browser?.close(); } finally { active--; }
  }
}
export async function sendPrintPdf(res: Response, slug: string, input: PrintDocument) {
  const pdf=await buildPrintPdf(input);
  res.setHeader("Content-Type","application/pdf");
  res.setHeader("Cache-Control","private, no-store");
  res.setHeader("X-Content-Type-Options","nosniff");
  res.setHeader("Content-Disposition",`inline; filename="${slug.replace(/[^a-zA-Z0-9_.-]/g,"_")}.pdf"; filename*=UTF-8''${encodeURIComponent(slug)}.pdf`);
  res.send(pdf);
}
