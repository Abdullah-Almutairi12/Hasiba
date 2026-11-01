import ExcelJS from "exceljs";
import { inflateRawSync } from "node:zlib";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod/v4";
import { FinancialRequestError, canonical } from "./financial-transaction";

export const IMPORT_LIMITS = { bytes: 262144, rows: 500, columns: 12, cellLength: 128 };
export const IMPORT_FIELDS = ["nameAr", "name", "sku", "categoryId", "price", "costPrice", "unit", "barcode"] as const;
export const IMPORT_UNITS = ["قطعة", "حبة", "علبة", "كرتون", "كجم", "كيلوجرام", "لتر", "متر", "piece", "unit", "box", "kg", "liter"];
export const importCell = z.union([z.string().max(128), z.number().finite(), z.null()]);
export const importDocument = z.object({
  headers: z.array(z.string().min(1).max(128)).min(1).max(12),
  rows: z.array(z.array(importCell).max(12)).min(1).max(500),
  mapping: z.record(z.string(), z.number().int().min(0).max(11)),
}).strict();
export type ImportDocument = z.infer<typeof importDocument>;
export type ImportProduct = { name: string; nameAr: string; sku: string; barcode: string | null; categoryId: number; price: string; costPrice: string; unit: string };
export type ImportIssue = { row: number; field: string; message: string };
export const importError = (message: string, status = 400) => new FinancialRequestError(message, status);

/** Bound actual inflation, not just attacker-controlled ZIP metadata, before ExcelJS. No extraction. */
function inspectWorkbookZip(bytes: Buffer) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)) throw importError("ملف XLSX غير صالح");
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16), total = 0;
  if (!count || count > 256) throw importError("المصنف يتجاوز حدود الأرشيف المسموحة");
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || bytes.readUInt32LE(at) !== 0x02014b50) throw importError("أرشيف XLSX غير صالح");
    const flags = bytes.readUInt16LE(at + 8), method = bytes.readUInt16LE(at + 10);
    const packed = bytes.readUInt32LE(at + 20), declared = bytes.readUInt32LE(at + 24);
    const n = bytes.readUInt16LE(at + 28), extra = bytes.readUInt16LE(at + 30), comment = bytes.readUInt16LE(at + 32);
    const local = bytes.readUInt32LE(at + 42), name = bytes.subarray(at + 46, at + 46 + n).toString("utf8");
    if ((flags & 1) || ![0, 8].includes(method) || declared > 4194304 || name.includes("..") ||
      /vbaProject|externalLinks/i.test(name) || local + 30 > at || bytes.readUInt32LE(local) !== 0x04034b50) {
      throw importError("المصنف مشفر أو يحتوي محتوى غير مدعوم أو يتجاوز الحدود");
    }
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + packed > at) throw importError("أرشيف XLSX غير صالح");
    const data = bytes.subarray(start, start + packed);
    const plain = method === 8 ? inflateRawSync(data, { maxOutputLength: 4194304 }) : data;
    total += plain.length;
    if (plain.length !== declared || total > 16777216) throw importError("محتوى المصنف يتجاوز الحدود");
    if (/xl\/worksheets\/.*\.xml$/.test(name)) {
      const xml = plain.toString("utf8");
      for (const m of xml.matchAll(/<row\b[^>]*\br="(\d+)"/g)) {
        if (Number(m[1]) > 501) throw importError("الحد الأقصى 500 صف بيانات");
      }
      for (const m of xml.matchAll(/<c\b[^>]*\br="([A-Z]+)\d+"/g)) {
        let col = 0; for (const c of m[1]) col = col * 26 + c.charCodeAt(0) - 64;
        if (col > 12) throw importError("الحد الأقصى 12 عمودًا");
      }
    }
    at += 46 + n + extra + comment;
  }
}

function csvRows(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0];
  const separator = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, ended = false;
  const addCell = () => { if (cell.length > 128) throw importError("طول الخلية يتجاوز 128 حرفًا"); row.push(cell); cell = ""; ended = false; };
  const addRow = () => { addCell(); rows.push(row); row = []; if (rows.length > 501) throw importError("الحد الأقصى 500 صف بيانات"); };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') { quoted = false; ended = true; } else cell += c;
    } else if (c === '"' && !cell && !ended) quoted = true;
    else if (c === separator) addCell();
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; addRow(); }
    else { if (ended || c === '"') throw importError("اقتباس CSV غير صحيح"); cell += c; }
    if (row.length > 12 || cell.length > 128) throw importError("الملف يتجاوز حدود الأعمدة أو الخلايا");
  }
  if (quoted) throw importError("اقتباس CSV غير مغلق");
  if (cell || row.length || ended) addRow();
  return rows;
}

export async function parseImportFile(fileName: string, base64: string) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw importError("ترميز الملف غير صالح");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length || bytes.length > IMPORT_LIMITS.bytes || bytes.toString("base64") !== base64) throw importError("حجم الملف غير صالح؛ الحد 256 كيلوبايت");
  let rows: (string | number | null)[][];
  if (/\.csv$/i.test(fileName)) rows = csvRows(new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""));
  else if (/\.xlsx$/i.test(fileName)) {
    inspectWorkbookZip(bytes);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    if (workbook.worksheets.length !== 1) throw importError("استخدم ورقة بيانات واحدة فقط");
    const sheet = workbook.worksheets[0];
    if (sheet.rowCount > 501 || sheet.columnCount > 12) throw importError("المصنف يتجاوز 500 صف أو 12 عمودًا");
    rows = [];
    for (let n = 1; n <= sheet.rowCount; n++) {
      const row: (string | number | null)[] = [];
      for (let c = 1; c <= sheet.columnCount; c++) {
        const value = sheet.getRow(n).getCell(c).value;
        if (value !== null && typeof value !== "string" && typeof value !== "number") throw importError(`الصف ${n}: الصيغ والروابط والخلايا المركبة غير مدعومة`);
        row.push(importCell.parse(value));
      }
      rows.push(row);
    }
  } else throw importError("الأنواع المدعومة CSV وXLSX فقط");
  while (rows.length && rows.at(-1)!.every(v => v === null || v === "")) rows.pop();
  if (rows.length < 2) throw importError("يلزم رأس أعمدة وصف بيانات واحد على الأقل");
  const headers = rows.shift()!;
  if (headers.some(v => typeof v !== "string" || !v.trim())) throw importError("كل عمود يحتاج عنوانًا نصيًا");
  return { headers: headers as string[], rows };
}

export function validateImport(doc: ImportDocument, categoryIds: Set<number>, existing: { sku: string; barcode: string | null }[]) {
  const errors: ImportIssue[] = [], products: ImportProduct[] = [];
  const issue = (row: number, field: string, message: string) => errors.push({ row, field, message });
  const mapped = Object.entries(doc.mapping);
  for (const [field, index] of mapped) if (!(IMPORT_FIELDS as readonly string[]).includes(field) || index >= doc.headers.length) issue(1, field, "حقل أو عمود غير مدعوم");
  const indices = mapped.map(([, index]) => index);
  if (new Set(indices).size !== indices.length) issue(1, "mapping", "لا يمكن ربط العمود نفسه بحقلين");
  doc.headers.forEach((header, index) => {
    if (!indices.includes(index)) issue(1, header, "عمود غير مربوط أو غير مدعوم؛ أزله من الملف بدل إسقاطه بصمت");
    if (/stock|quantity|balance|variant|tracking|costing|tax|vat|رصيد|كمية|متغير|تتبع|ضريبة/i.test(header)) issue(1, header, "أرصدة المخزون والضريبة والمتغيرات والتتبع ليست ضمن هذا الاستيراد");
  });
  for (const field of IMPORT_FIELDS.filter(f => f !== "barcode")) if (doc.mapping[field] === undefined) issue(1, field, "ربط هذا الحقل مطلوب");
  const skus = new Set(existing.map(p => p.sku)), barcodes = new Set(existing.flatMap(p => p.barcode ? [p.barcode] : []));
  doc.rows.forEach((values, i) => {
    const n = i + 2, startErrors = errors.length;
    if (values.length > doc.headers.length) issue(n, "row", "صف يحتوي خلايا بلا عناوين");
    const text = (field: string, required = true) => {
      const v = values[doc.mapping[field]];
      if (v == null || v === "") { if (required) issue(n, field, "قيمة مطلوبة"); return ""; }
      if (typeof v !== "string") { issue(n, field, "استخدم نصًا؛ أكواد الأصناف والباركود يجب تنسيقها كنص لحفظ الأصفار الأولى"); return ""; }
      const s = v.trim();
      if ((required && !s) || s.length > 128 || /^[=+@]/.test(s)) issue(n, field, "نص فارغ أو طويل أو يبدأ بصيغة غير مسموحة");
      return s;
    };
    const money = (field: string) => {
      const raw = values[doc.mapping[field]];
      const s = raw == null ? "" : String(raw).trim();
      if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(s)) { issue(n, field, "مبلغ مطلوب غير سالب بحد أقصى منزلتين عشريتين، دون فواصل"); return ""; }
      const [whole, fraction = ""] = s.split(".");
      return `${BigInt(whole)}.${fraction.padEnd(2, "0")}`;
    };
    const sku = text("sku"), barcode = text("barcode", false) || null;
    const categoryId = Number(values[doc.mapping.categoryId]);
    const p = { nameAr: text("nameAr"), name: text("name"), sku, barcode, categoryId, price: money("price"), costPrice: money("costPrice"), unit: text("unit") };
    if (!Number.isSafeInteger(categoryId) || !categoryIds.has(categoryId)) issue(n, "categoryId", "معرّف تصنيف غير صالح؛ استخدم قائمة التصنيفات");
    if (!IMPORT_UNITS.includes(p.unit)) issue(n, "unit", "وحدة غير مدعومة؛ استخدم الوحدات المعروضة");
    if (sku && skus.has(sku)) issue(n, "sku", "كود مكرر في الملف أو في أصناف الشركة");
    if (barcode && barcodes.has(barcode)) issue(n, "barcode", "باركود مكرر في الملف أو في أصناف الشركة");
    if (sku) skus.add(sku); if (barcode) barcodes.add(barcode);
    if (errors.length === startErrors) products.push(p);
  });
  return { errors, products, total: doc.rows.length, validRows: products.length, canCommit: errors.length === 0 && products.length === doc.rows.length };
}

function secret() { if (!process.env.SESSION_SECRET) throw new Error("Import signing is not configured"); return process.env.SESSION_SECRET; }
export function signImport(companyId: number, userId: number, document: ImportDocument) {
  // Bound the signed body too: escaped CSV cells must not produce an intent
  // that exceeds the JSON transport/token limit and cannot later be recovered.
  if (Buffer.byteLength(JSON.stringify(document), "utf8") > 450000)
    throw new FinancialRequestError("بيانات المعاينة بعد الترميز تتجاوز 450000 بايت؛ قسّم الملف إلى دفعات أصغر", 413);
  const payload = Buffer.from(canonical({ companyId, userId, document, expires: Date.now() + 900000 })).toString("base64url");
  return `${payload}.${createHmac("sha256", secret()).update(payload).digest("hex")}`;
}
export function readImport(token: string, companyId: number, userId: number, allowExpired = false): ImportDocument {
  const [payload, signature, extra] = token.split(".");
  const expected = createHmac("sha256", secret()).update(payload ?? "").digest("hex");
  if (extra || !signature || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw importError("دليل المعاينة غير صالح");
  const saved = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (saved.companyId !== companyId || saved.userId !== userId) throw importError("المعاينة لا تخص الحساب والشركة الحاليين", 403);
  if (!allowExpired && saved.expires < Date.now()) throw importError("انتهت المعاينة؛ أغلق المحاولة بأمان ثم أعد المراجعة", 409);
  return importDocument.parse(saved.document);
}
