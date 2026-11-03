import { z } from "zod/v4";
import { createHash } from "node:crypto";
import { canonical } from "./financial-transaction";
import { type ImportDocument, type ImportIssue } from "./product-import";
import { supplierVat } from "./supplier-identity";

export const SUPPLIER_IMPORT_FIELDS = ["name", "vatNumber", "email", "phone", "address", "notes"] as const;
export type DirectorySupplier = { name: string; vatNumber: string | null; email: string | null; phone: string | null; address: string | null; notes: string | null };
export type ExistingSupplier = { id: number; name: string; vatNumber: string | null };
export function validateSupplierImport(doc: ImportDocument, existing: ExistingSupplier[]) {
  const errors: ImportIssue[] = [];
  const warnings: { row: number; name: string; matches: ExistingSupplier[] }[] = [];
  const suppliers: DirectorySupplier[] = [];
  const issue = (row: number, field: string, message: string) => errors.push({ row, field, message });
  const mapping = Object.entries(doc.mapping), indices = mapping.map(([, c]) => c);
  if (new Set(indices).size !== indices.length) issue(1, "mapping", "لا يمكن ربط العمود نفسه بحقلين");
  for (const [field, col] of mapping) {
    if (!(SUPPLIER_IMPORT_FIELDS as readonly string[]).includes(field) || col >= doc.headers.length)
      issue(1, field, "حقل أو عمود غير مدعوم");
  }
  if (doc.mapping.name === undefined) issue(1, "name", "ربط اسم المورد مطلوب");
  doc.headers.forEach((header, col) => {
    if (!indices.includes(col)) issue(1, header, "عمود غير مربوط؛ أزله من الملف بدل إسقاطه بصمت");
    if (/company|tenant|balance|invoice|bank|iban|account|linked|رصيد|فاتورة|شركة|شركات|بنك|بنكي|حساب|قيد/i.test(header))
      issue(1, header, "الشركات والأرصدة والفواتير والبنوك والقيود ليست ضمن استيراد الدليل");
  });
  const seenVat = new Set(existing.flatMap(s => s.vatNumber === null ? [] : [s.vatNumber]));
  const prior: ExistingSupplier[] = [...existing].sort((a,b) => a.id-b.id);
  doc.rows.forEach((cells, i) => {
    const row = i + 2, start = errors.length;
    if (cells.length > doc.headers.length) issue(row, "row", "خلايا بلا عناوين");
    const text = (field: string) => {
      const value = cells[doc.mapping[field]];
      if (value === undefined || value === null || value === "") return null;
      if (typeof value !== "string") {
        issue(row, field, "استخدم خلية نصية وأعد إدخال القيمة من مصدرها الأصلي؛ تنسيق الرقم بعد فقد الأصفار أو الدقة لا يستعيدها");
        return null;
      }
      // VAT identity uses literal nonblank values, exactly like the directory.
      const result = field === "vatNumber" ? supplierVat(value) : value.trim() || null;
      const safePhone = field === "phone" && /^\+?\d[\d ()-]*$/.test(result ?? "");
      if (result && (/^[=+@-]/.test(result) && !safePhone || result.length > 128 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)))
        issue(row, field, "نص غير صالح أو صيغة غير مسموحة أو طول يتجاوز 128 حرفًا");
      return result;
    };
    const s: DirectorySupplier = { name: text("name") ?? "", vatNumber: text("vatNumber"),
      email: text("email"), phone: text("phone"), address: text("address"), notes: text("notes") };
    if (!s.name) issue(row, "name", "اسم المورد مطلوب");
    if (s.email && !z.email().safeParse(s.email).success) issue(row, "email", "البريد الإلكتروني غير صالح");
    if (s.vatNumber !== null) {
      if (seenVat.has(s.vatNumber)) {
        const found = existing.find(e => e.vatNumber === s.vatNumber);
        issue(row, "vatNumber", found ? `الرقم موجود لدى المورد #${found.id}: ${found.name} داخل الشركة؛ لن تُغيّر بياناته` : "الرقم مكرر داخل دفعة الاستيراد");
      }
      seenVat.add(s.vatNumber);
    }
    const matches = prior.filter(p => p.name.trim() === s.name && (s.vatNumber === null || p.vatNumber !== s.vatNumber));
    if (matches.length) warnings.push({ row, name: s.name, matches });
    prior.push({ id: -row, name: s.name, vatNumber: s.vatNumber });
    if (errors.length === start) suppliers.push(s);
  });
  return { errors, warnings, suppliers, total: doc.rows.length, validRows: suppliers.length,
    canCommit: errors.length === 0 && suppliers.length === doc.rows.length };
}
export const supplierReviewFacts = (value: ReturnType<typeof validateSupplierImport>) =>
  createHash("sha256").update(canonical(value.warnings)).digest("hex");
