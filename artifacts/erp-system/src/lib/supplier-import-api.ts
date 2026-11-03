import { getWorkspaceResponsibility, WORKSPACE_RESPONSIBILITY_HEADER } from "@workspace/api-client-react";

export const SUPPLIER_IMPORT_PATH = "/api/suppliers/imports";
const endpoint = () => `${import.meta.env.BASE_URL.replace(/\/$/, "")}${SUPPLIER_IMPORT_PATH}`;

export const SUPPLIER_FIELDS = ["name", "vatNumber", "email", "phone", "address", "notes"] as const;
export type SupplierField = (typeof SUPPLIER_FIELDS)[number];
export type SupplierCell = string | number | null;
export type SupplierImportOptions = {
  fields: string[];
  required: string[];
  limits: { bytes: number; rows: number; columns: number; cellLength: number };
  mode: "create-only";
  atomic: true;
};
export type SupplierImportDocument = { headers: string[]; rows: SupplierCell[][]; mapping: Record<string, number> };
export type SupplierMatch = { id: number; name: string; vatNumber: string | null };
export type SupplierImportPreview = {
  errors: { row: number; field: string; message: string }[];
  warnings: { row: number; name: string; matches: SupplierMatch[] }[];
  suppliers: Record<SupplierField, string | null>[];
  total: number;
  validRows: number;
  canCommit: boolean;
  token: string | null;
};
export type SupplierImportOutcome = {
  state: "completed" | "closed";
  accepted: number;
  rejected: number;
  suppliers?: { id: number; name: string; vatNumber: string | null }[];
};
export type SupplierImportAction =
  | { action: "parse"; fileName: string; base64: string }
  | { action: "preview"; document: SupplierImportDocument; confirmSimilarNames: boolean }
  | { action: "commit" | "recover" | "close"; token: string };

export class SupplierImportError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function headers(responsibility: string | null, extra: Record<string, string> = {}) {
  return { ...extra, ...(responsibility ? { [WORKSPACE_RESPONSIBILITY_HEADER]: responsibility } : {}) };
}

async function readJson(response: Response) {
  try { return await response.json(); } catch { return {}; }
}

export const currentResponsibility = () => getWorkspaceResponsibility();

export async function supplierImportOptions(): Promise<SupplierImportOptions> {
  const response = await fetch(endpoint(), { credentials: "include", headers: headers(getWorkspaceResponsibility()) });
  const data = await readJson(response);
  if (!response.ok) throw new SupplierImportError(data.error ?? "تعذر تحميل صلاحية استيراد الموردين", response.status);
  return data;
}

/**
 * `responsibility` undefined = current header; for commit/recover/close callers
 * pass the exact value persisted with the intent (may be null).
 */
export async function supplierImport<T>(body: SupplierImportAction, key?: string, responsibility?: string | null): Promise<T> {
  const resp = responsibility === undefined ? getWorkspaceResponsibility() : responsibility;
  const response = await fetch(endpoint(), {
    method: "POST",
    credentials: "include",
    headers: headers(resp, { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }),
    body: JSON.stringify(body),
  });
  const data = await readJson(response);
  if (!response.ok) throw new SupplierImportError(data.error ?? "تعذر تأكيد نتيجة استيراد الموردين", response.status);
  return data;
}
