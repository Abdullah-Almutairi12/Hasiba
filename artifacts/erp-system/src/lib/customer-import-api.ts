import { getWorkspaceResponsibility, WORKSPACE_RESPONSIBILITY_HEADER } from "@workspace/api-client-react";
import type {
  CustomerImportMatch as GeneratedMatch,
  CustomerImportOutcome as GeneratedOutcome,
  CustomerImportPreview as GeneratedPreview,
} from "@workspace/api-client-react";

export const CUSTOMER_IMPORT_PATH = "/api/customers/imports";
const endpoint = () => `${import.meta.env.BASE_URL.replace(/\/$/, "")}${CUSTOMER_IMPORT_PATH}`;

export const CUSTOMER_FIELDS = ["name", "phone", "email", "taxNumber", "billingAddress", "shippingAddress"] as const;
export type CustomerField = (typeof CUSTOMER_FIELDS)[number];
export type CustomerCell = string | number | null;
export type CustomerImportOptions = {
  fields: string[];
  required: string[];
  limits: { bytes: number; rows: number; columns: number; cellLength: number };
  mode: "create-only";
  atomic: true;
  /** True for managed (responsibility-scoped) users: directory fields only, no finance. */
  directoryOnly?: boolean;
};
export type CustomerImportDocument = { headers: string[]; rows: CustomerCell[][]; mapping: Record<string, number> };
export type CustomerMatch = GeneratedMatch;
export type CustomerImportPreview = GeneratedPreview;
export type CustomerImportOutcome = GeneratedOutcome;
export type CustomerImportAction =
  | { action: "parse"; fileName: string; base64: string }
  | { action: "preview"; document: CustomerImportDocument; confirmSimilarNames: boolean }
  | { action: "commit" | "recover" | "close"; token: string };

export class CustomerImportError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function headers(responsibility: string | null, extra: Record<string, string> = {}) {
  return { ...extra, ...(responsibility ? { [WORKSPACE_RESPONSIBILITY_HEADER]: responsibility } : {}) };
}

async function readJson(response: Response) {
  try { return await response.json(); } catch { return {}; }
}

export const currentResponsibility = () => getWorkspaceResponsibility();

/** Authoritative permission check: 403 means the user cannot create customers by import. */
export async function customerImportOptions(): Promise<CustomerImportOptions> {
  const response = await fetch(endpoint(), { credentials: "include", headers: headers(getWorkspaceResponsibility()) });
  const data = await readJson(response);
  if (!response.ok) throw new CustomerImportError(data.error ?? "تعذر تحميل صلاحية استيراد العملاء", response.status);
  return data;
}

/**
 * `responsibility` undefined = current header; for commit/recover/close callers
 * pass the exact value persisted with the intent (may be null).
 */
export async function customerImport<T>(body: CustomerImportAction, key?: string, responsibility?: string | null): Promise<T> {
  const resp = responsibility === undefined ? getWorkspaceResponsibility() : responsibility;
  const response = await fetch(endpoint(), {
    method: "POST",
    credentials: "include",
    headers: headers(resp, { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }),
    body: JSON.stringify(body),
  });
  const data = await readJson(response);
  if (!response.ok) throw new CustomerImportError(data.error ?? "تعذر تأكيد نتيجة استيراد العملاء", response.status);
  return data;
}
