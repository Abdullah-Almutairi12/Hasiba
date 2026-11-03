import { z } from "zod/v4";
import { createHash } from "node:crypto";
import { canonical } from "./financial-transaction";
import type { ImportDocument, ImportIssue } from "./product-import";
import { isReservedPosCustomerTaxNumber } from "./pos-walkin-customer";

export const CUSTOMER_IMPORT_FIELDS = ["name", "phone", "email", "taxNumber", "billingAddress", "shippingAddress"] as const;
export type CustomerDirectoryRecord = Record<typeof CUSTOMER_IMPORT_FIELDS[number], string | null> & { name: string };
export type CustomerMatch = Pick<CustomerDirectoryRecord, "name" | "phone" | "email" | "taxNumber"> & { id: number };
export function validateCustomerImport(doc: ImportDocument, existing: CustomerMatch[]) {
  const errors: ImportIssue[] = [], warnings: { row: number; name: string; matches: CustomerMatch[] }[] = [];
  const customers: CustomerDirectoryRecord[] = [];
  const previewRows: { row: number; values: Record<typeof CUSTOMER_IMPORT_FIELDS[number], string | number | null>;
    status: "valid" | "error"; errors: ImportIssue[] }[] = [];
  const issue = (row: number, field: string, message: string) => errors.push({ row, field, message });
  const mapping = Object.entries(doc.mapping), indices = mapping.map(([, c]) => c);
  if (new Set(indices).size !== indices.length) issue(1, "mapping", "لا يمكن ربط العمود نفسه بحقلين");
  for (const [field, col] of mapping) if (!(CUSTOMER_IMPORT_FIELDS as readonly string[]).includes(field) || col >= doc.headers.length)
    issue(1, field, "حقل أو عمود غير مدعوم");
  if (doc.mapping.name === undefined) issue(1, "name", "ربط اسم العميل مطلوب");
  doc.headers.forEach((header, col) => {
    if (!indices.includes(col)) issue(1, header, "عمود غير مربوط؛ أزله من الملف بدل إسقاطه بصمت");
    const title = header.normalize("NFKC").trim().replace(/\s+/gu, " ");
    const naturalName = doc.mapping.name === col &&
      /^(?:اسم (?:الشركة|شركة العميل)|(?:(?:customer|client) )?company(?: name)?)$/i.test(title);
    const naturalAddress = (doc.mapping.billingAddress === col || doc.mapping.shippingAddress === col) &&
      /^(?:(?:(?:customer|client) )?company (?:(?:billing|shipping) )?address|عنوان (?:الشركة|شركة العميل))$/i.test(title);
    if (!naturalName && !naturalAddress && /company|tenant|balance|invoice|bank|iban|account|linked|credit|payment|price.?list|total.?spent|total.?orders|رصيد|فاتورة|شركة|شركات|بنك|بنكي|حساب|قيد|ائتمان|تحصيل|دفع|قائمة.*سعر/i.test(header))
      issue(1, header, "الملكية والأرصدة والفواتير والحقول المالية ليست ضمن استيراد دليل العملاء");
  });
  const prior: CustomerMatch[] = [...existing].sort((a, b) => a.id - b.id);
  const normalized = (s: string | null) => s?.trim().toLocaleLowerCase() || null;
  doc.rows.forEach((cells, i) => {
    const row = i + 2, start = errors.length;
    if (cells.length > doc.headers.length) issue(row, "row", "خلايا بلا عناوين");
    const text = (field: string) => {
      const value = cells[doc.mapping[field]];
      if (value == null || value === "") return null;
      if (typeof value !== "string") {
        issue(row, field, "استخدم خلية نصية وأعد إدخال القيمة من مصدرها الأصلي؛ التنسيق بعد فقد الأصفار أو الدقة لا يستعيدها");
        return null;
      }
      const result = value.trim() || null;
      const safePhone = field === "phone" && /^\+?\d[\d ()-]*$/.test(result ?? "");
      if (result && (/^[=+@-]/.test(result) && !safePhone || result.length > 128 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)))
        issue(row, field, "نص غير صالح أو صيغة غير مسموحة أو طول يتجاوز 128 حرفًا");
      return result;
    };
    const c: CustomerDirectoryRecord = { name: text("name") ?? "", phone: text("phone"), email: text("email"),
      taxNumber: text("taxNumber"), billingAddress: text("billingAddress"), shippingAddress: text("shippingAddress") };
    if (!c.name) issue(row, "name", "اسم العميل مطلوب");
    if (isReservedPosCustomerTaxNumber(c.taxNumber))
      issue(row, "taxNumber", "هذا الرمز محجوز للعميل النقدي الداخلي؛ لا يمكن استيراده أو تجاوزه بتأكيد التشابه");
    if (c.email && !z.email().safeParse(c.email).success) issue(row, "email", "البريد الإلكتروني غير صالح");
    const matches = prior.filter(p => (["name", "phone", "email", "taxNumber"] as const)
      .some(f => normalized(c[f]) !== null && normalized(c[f]) === normalized(p[f])));
    if (matches.length) warnings.push({ row, name: c.name, matches });
    prior.push({ id: -row, name: c.name, phone: c.phone, email: c.email, taxNumber: c.taxNumber });
    const rowErrors = errors.slice(start);
    previewRows.push({ row, values: Object.fromEntries(CUSTOMER_IMPORT_FIELDS.map(f => [f, cells[doc.mapping[f]] ?? null])) as typeof previewRows[number]["values"],
      status: rowErrors.length ? "error" : "valid", errors: rowErrors });
    if (!rowErrors.length) customers.push(c);
  });
  return { errors, warnings, customers, previewRows, total: doc.rows.length, validRows: customers.length,
    canCommit: errors.length === 0 && customers.length === doc.rows.length };
}
export const customerReviewFacts = (value: ReturnType<typeof validateCustomerImport>) =>
  createHash("sha256").update(canonical(value.warnings)).digest("hex");
