import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import type { IdentityTx } from "./document-identity";
import { FinancialRequestError } from "./financial-transaction";
import type { EditorSnapshot } from "./invoice-editor-schema";

export const invoicePresets = [
  { id: "formal", name: "رسمي", description: "رأس رسمي وجدول محدد وحدود واضحة" },
  { id: "simple", name: "مبسط", description: "تعريف مختصر وبيانات متتابعة ومساحات خفيفة" },
  { id: "commercial", name: "تجاري", description: "هوية جانبية وبيانات طرفين ومجاميع بارزة" },
  { id: "modern", name: "حديث", description: "عنوان مميز وبيانات مرجعية موزعة على أعمدة" },
  { id: "ink", name: "موفر للحبر", description: "كثافة أعلى وحدود أفقية دون خلفيات ممتلئة" },
] as const;
// No HTML, CSS, executable expressions, arbitrary fonts or external resources.
export const InvoiceDesignSchema = z.object({
  version: z.literal(1),
  preset: z.enum(["formal", "simple", "commercial", "modern", "ink"]),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  font: z.enum(["Tajawal", "sans-serif"]),
  fontSize: z.number().int().min(11).max(16),
  logoMode: z.enum(["identity", "custom", "none"]),
  logoObjectKey: z.string().max(300).nullable(),
  logoPosition: z.enum(["start", "center", "end"]),
  logoWidth: z.number().int().min(18).max(48),
  header: z.string().trim().max(250),
  footer: z.string().trim().max(500),
  note: z.string().trim().max(1000),
  showContact: z.boolean(),
  showBank: z.boolean(),
}).strict().superRefine((d, ctx) => {
  if (d.logoMode === "custom" && !d.logoObjectKey)
    ctx.addIssue({ code: "custom", message: "اختر شعارًا مملوكًا للمنشأة", path: ["logoObjectKey"] });
});
export type InvoiceDesign = z.infer<typeof InvoiceDesignSchema>;
export const defaultInvoiceDesign: InvoiceDesign = {
  version: 1, preset: "formal", accent: "#285886", font: "Tajawal", fontSize: 12,
  logoMode: "identity", logoObjectKey: null, logoPosition: "start", logoWidth: 36,
  header: "", footer: "", note: "", showContact: true, showBank: true,
};
export interface InvoiceDesignSnapshot {
  schemaVersion: 1;
  /** Absent means the original renderer; never infer from current settings. */
  layoutVersion?: 2 | 3;
  editor?: EditorSnapshot;
  design: InvoiceDesign;
  source: "company" | "branch" | "default";
  companyRevision: number;
  branchRevision: number;
  branchId: number | null;
}
export async function validateDesignAssets(tx: IdentityTx, companyId: number, value: unknown) {
  const design = InvoiceDesignSchema.parse(value);
  if (design.logoObjectKey) {
    const result = await tx.execute(sql`SELECT 1 FROM company_print_logos
      WHERE company_id=${companyId} AND object_key=${design.logoObjectKey}`);
    if (!result.rows.length) throw new FinancialRequestError("الشعار ليس مملوكًا للمنشأة", 400);
  }
  return design;
}
/** Called under the issuer's company fence in the issuing financial transaction.
 * Settings writers use that same fence, so root/branch versions are coherent. */
export async function captureInvoiceDesign(tx: IdentityTx, companyId: number, branchId: number | null): Promise<InvoiceDesignSnapshot> {
  const { rows } = await tx.execute(sql`SELECT branch_id,revision,templates FROM app_settings
    WHERE company_id=${companyId} AND (branch_id IS NULL OR branch_id=${branchId})`);
  const root = rows.find(r => r.branch_id == null), branch = rows.find(r => r.branch_id === branchId && branchId != null);
  const child = (branch?.templates as Record<string, unknown> | undefined)?.invoiceDesign;
  const parent = (root?.templates as Record<string, unknown> | undefined)?.invoiceDesign;
  const activations = (await tx.execute(sql`SELECT a.scope_key,a.release_id,r.id,r.design FROM invoice_editor_activation a
    LEFT JOIN invoice_editor_releases r ON r.id=a.release_id AND r.company_id=a.company_id
    WHERE a.company_id=${companyId} AND (a.scope_key=0 OR a.scope_key=${branchId ?? 0})
    ORDER BY a.scope_key DESC`)).rows;
  const branchActivation = branchId == null ? undefined : activations.find(a => Number(a.scope_key) === branchId);
  const rootActivation = activations.find(a => Number(a.scope_key) === 0);
  // An existing 2a branch customization is not silently replaced by publishing
  // a company editor default. An explicit branch inherit action supersedes it.
  const selected = branchActivation?.release_id ? branchActivation :
    (!child || branchActivation) && rootActivation?.release_id ? rootActivation : undefined;
  if (selected) {
    const { EditorDesignSchema } = await import("./invoice-editor-schema");
    const published = EditorDesignSchema.parse(selected.design);
    await validateDesignAssets(tx, companyId, published.base);
    return { schemaVersion: 1, layoutVersion: 3, design: published.base,
      editor: { rendererVersion: 3, releaseId: String(selected.id), design: published },
      source: Number(selected.scope_key) === 0 ? "company" : "branch",
      companyRevision: Number(root?.revision ?? 0), branchRevision: Number(branch?.revision ?? 0), branchId };
  }
  const inherited = branchActivation && !branchActivation.release_id;
  const design = await validateDesignAssets(tx, companyId, inherited ? parent ?? defaultInvoiceDesign : child ?? parent ?? defaultInvoiceDesign);
  return { schemaVersion: 1, layoutVersion: 2, design, source: child && !inherited ? "branch" : parent ? "company" : "default",
    companyRevision: Number(root?.revision ?? 0), branchRevision: Number(branch?.revision ?? 0), branchId };
}
