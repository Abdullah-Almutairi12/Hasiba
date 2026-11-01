const endpoint = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/products/imports`;
export type ImportCell = string | number | null;
export type ImportDocument = { headers: string[]; rows: ImportCell[][]; mapping: Record<string, number> };
export type ImportOptions = { fields: string[]; required: string[]; units: string[]; categories: { id: number; nameAr: string; name: string }[]; limits: { bytes: number; rows: number; columns: number; cellLength: number }; mode: "create-only"; atomic: true; defaults: { stock: number; minStock: number; trackingMode: string; costingMethod: string } };
export type ImportPreview = { errors: { row: number; field: string; message: string }[]; products: Record<string, string | number | null>[]; total: number; validRows: number; canCommit: boolean; token: string | null };
export type ImportOutcome = { state: "completed" | "closed"; accepted: number; rejected: number; products?: { id: number; sku: string; barcode: string | null; nameAr: string }[] };
export type ImportAction = { action: "parse"; fileName: string; base64: string } | { action: "preview"; document: ImportDocument } | { action: "commit" | "recover" | "close"; token: string };
export class ProductImportError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function importOptions(): Promise<ImportOptions> {
  const response = await fetch(endpoint, { credentials: "include" });
  const data = await response.json();
  if (!response.ok) throw new ProductImportError(data.error ?? "تعذر تحميل صلاحية الاستيراد", response.status);
  return data;
}
export async function productImport<T>(body: ImportAction, key?: string): Promise<T> {
  const response = await fetch(endpoint, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new ProductImportError(data.error ?? "تعذر تأكيد نتيجة الاستيراد", response.status);
  return data;
}
