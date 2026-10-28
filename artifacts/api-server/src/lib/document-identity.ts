import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { CompanyInfo } from "./pdf/purchase-order";
import { FinancialRequestError } from "./financial-transaction";
import { objectStorageClient } from "./objectStorage";
import { captureInvoiceDesign, type InvoiceDesignSnapshot } from "./invoice-design";

export type IdentityTx = Pick<typeof db, "execute">;
export type DocumentKind = "invoice" | "pos" | "credit" | "refund" | "closing";
export interface IssuerSnapshot extends CompanyInfo {
  invoiceDesign?: InvoiceDesignSnapshot;
  companyId: number;
  revision: number;
  vatEnabled: boolean;
  crNumber: string;
  logoObjectKey: string | null;
  receiptWidths: number[];
  capturedAt: string;
  verifiedSnapshot: boolean;
}
export const missingIssuer = (companyId: number): IssuerSnapshot => ({
  companyId, revision: 0, nameAr: "هوية الإصدار غير محفوظة — مستند تاريخي",
  nameEn: "Historical issuer identity unavailable", vatNumber: "", address: "",
  phone: "", email: "", bankName: "", bankIban: "", termsAr: "", termsEn: "",
  crNumber: "", vatEnabled: true, logoObjectKey: null, receiptWidths: [80],
  capturedAt: "", verifiedSnapshot: false,
});
export async function captureIssuer(tx: IdentityTx, companyId: number): Promise<IssuerSnapshot> {
  // Separate statement: after waiting for a profile writer, read its newly
  // committed identity/profile together rather than an older JOIN snapshot.
  await tx.execute(sql`SELECT id FROM companies WHERE id=${companyId} FOR SHARE`);
  const { rows } = await tx.execute(sql`SELECT c.*,p.revision,p.profile FROM companies c
    LEFT JOIN company_print_profiles p ON p.company_id=c.id WHERE c.id=${companyId}`);
  const c = rows[0];
  if (!c) throw new FinancialRequestError("الشركة غير متاحة", 404);
  const p = (c.profile ?? {}) as Record<string, unknown>;
  const str = (key: string) => typeof p[key] === "string" ? String(p[key]) : "";
  const a = (c.address ?? {}) as Record<string, unknown>;
  return {
    companyId, revision: Number(c.revision ?? 0), nameAr: String(c.name),
    nameEn: String(c.name_en ?? c.name), vatNumber: String(c.vat_number ?? ""),
    crNumber: String(c.cr_number ?? ""),
    address: Object.values(a).filter(v => typeof v === "string").join("، "),
    phone: str("phone"), email: str("email"), bankName: str("bankName"),
    bankIban: str("bankIban"), termsAr: str("termsAr"), termsEn: str("termsEn"),
    logoObjectKey: str("logoObjectKey") || null,
    receiptWidths: Array.isArray(p.receiptWidths) ? p.receiptWidths as number[] : [80],
    vatEnabled: c.vat_registration_status === "registered" || c.vat_registration_status === "voluntary",
    capturedAt: new Date().toISOString(), verifiedSnapshot: true,
  };
}
export async function saveIssuer(tx: IdentityTx, kind: DocumentKind, documentId: number, issuer: IssuerSnapshot, preserveDesign = false) {
  if (!preserveDesign && (kind === "invoice" || kind === "pos")) {
    const source = kind === "invoice"
      ? await tx.execute(sql`SELECT branch_id FROM customer_invoices WHERE id=${documentId} AND company_id=${issuer.companyId}`)
      : await tx.execute(sql`SELECT s.branch_id FROM pos_orders o JOIN pos_sessions s ON s.id=o.session_id
          WHERE o.id=${documentId} AND o.company_id=${issuer.companyId}`);
    // Reversal/copy paths preserve an already captured design.
    if (!issuer.invoiceDesign) issuer = { ...issuer,
      invoiceDesign: await captureInvoiceDesign(tx, issuer.companyId, source.rows[0]?.branch_id == null ? null : Number(source.rows[0].branch_id)) };
  }
  await tx.execute(sql`INSERT INTO document_issuer_snapshots(company_id,document_kind,document_id,issuer)
    VALUES(${issuer.companyId},${kind},${documentId},${JSON.stringify(issuer)}::jsonb) ON CONFLICT DO NOTHING`);
}
export async function documentIssuer(companyId: number, kind: DocumentKind, documentId: number) {
  const { rows } = await db.execute(sql`SELECT issuer FROM document_issuer_snapshots
    WHERE company_id=${companyId} AND document_kind=${kind} AND document_id=${documentId}`);
  return rows[0]?.issuer as IssuerSnapshot | undefined ?? missingIssuer(companyId);
}
/** Read only an immutable, tenant-owned object; never fetch a supplied HTTP URL. */
export async function issuerLogo(issuer: IssuerSnapshot): Promise<string | null> {
  if (!issuer.logoObjectKey) return null;
  const { rows } = await db.execute(sql`SELECT * FROM company_print_logos
    WHERE company_id=${issuer.companyId} AND object_key=${issuer.logoObjectKey}`);
  const row = rows[0];
  if (!row) throw new FinancialRequestError("ملف الشعار غير موثق لهذه الشركة", 409);
  const parts = (process.env.PRIVATE_OBJECT_DIR ?? "").replace(/^\/+|\/+$/g, "").split("/");
  const bucket = parts.shift();
  if (!bucket) throw new Error("PRINT_LOGO_STORAGE_UNAVAILABLE");
  const [buffer] = await objectStorageClient.bucket(bucket)
    .file([...parts, issuer.logoObjectKey].join("/")).download();
  if (buffer.length > 2 * 1024 * 1024 || createHash("sha256").update(buffer).digest("hex") !== row.digest) {
    throw new FinancialRequestError("تغير ملف الشعار التاريخي أو تجاوز الحجم المسموح", 409);
  }
  return `data:${row.content_type};base64,${buffer.toString("base64")}`;
}
/** QR checks compare stored identity/money, not official ZATCA clearance. */
export function inspectIssuerQr(qr: string | null, issuer: IssuerSnapshot, total: number, vat: number) {
  const fields: Record<number, string> = {};
  try {
    if (!qr) return { status: "unverifiable", reason: "لا يوجد رمز محفوظ", officialValidation: false };
    const bytes = Buffer.from(qr, "base64");
    for (let i = 0; i < bytes.length;) {
      const tag = bytes[i++], length = bytes[i++];
      if (!tag || length == null || i + length > bytes.length || fields[tag] != null) throw new Error("TLV");
      fields[tag] = bytes.subarray(i, i + length).toString("utf8"); i += length;
    }
    if (![1,2,3,4,5].every(k => fields[k] != null)) throw new Error("TLV");
    if (!issuer.verifiedSnapshot) return { status: "unverifiable", reason: "لا توجد هوية إصدار محفوظة للمقارنة", officialValidation: false };
    const checks = {
      name: fields[1] === issuer.nameAr, vatNumber: fields[2] === issuer.vatNumber,
      total: Math.abs(Number(fields[4]) - total) < 0.005,
      vat: Math.abs(Number(fields[5]) - vat) < 0.005,
      timestamp: Number.isFinite(Date.parse(fields[3]!)),
    };
    return { status: Object.values(checks).every(Boolean) ? "matched" : "mismatch", checks, officialValidation: false };
  } catch { return { status: "unverifiable", reason: "تعذر فك الرمز المحفوظ", officialValidation: false }; }
}
