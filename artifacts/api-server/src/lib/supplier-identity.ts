import { and, eq, sql } from "drizzle-orm";
import { suppliersTable } from "@workspace/db";
import type { DbOrTx } from "./journal-posting";
import { FinancialRequestError } from "./financial-transaction";

/** Do not invent a VAT, infer registration or normalize evidenced nonblank IDs. */
export function supplierVat(value: string | null | undefined): string | null {
  return value == null || value.trim() === "" ? null : value;
}

export function supplierVatConflict(error: unknown): boolean {
  let cause = error;
  for (let i = 0; i < 5 && cause && typeof cause === "object"; i++) {
    const e = cause as { code?: string; constraint?: string; cause?: unknown };
    if (e.code === "23505" && ["suppliers_company_vat_number_unique", "suppliers_vat_number_unique"].includes(e.constraint ?? "")) return true;
    cause = e.cause;
  }
  return false;
}

/** Caller owns the transaction. A matching name never authorizes changing VAT.
 * Numbered identities match only (company,VAT). Unnumbered identities may reuse
 * an exact name only among unnumbered records, with no enrichment or merge.
 */
export async function resolveSupplier(tx: DbOrTx, opts: {
  companyId: number; name: string; vatNumber?: string | null;
}): Promise<number> {
  const name = opts.name.trim(), vat = supplierVat(opts.vatNumber);
  if (!name) throw new FinancialRequestError("اسم المورد مطلوب", 400);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["supplier-identity", opts.companyId, vat === null ? ["name", name] : ["vat", vat]])},0))`);
  const predicate = and(eq(suppliersTable.companyId, opts.companyId), vat === null
    ? and(eq(suppliersTable.name, name), sql`nullif(btrim(${suppliersTable.vatNumber}),'') IS NULL`)
    : eq(suppliersTable.vatNumber, vat));
  const [existing] = await tx.select({ id: suppliersTable.id }).from(suppliersTable).where(predicate).limit(1).for("update");
  if (existing) return existing.id;
  const [created] = await tx.insert(suppliersTable).values({ companyId: opts.companyId, name, vatNumber: vat })
    .onConflictDoNothing({ target: [suppliersTable.companyId, suppliersTable.vatNumber] })
    .returning({ id: suppliersTable.id });
  if (created) return created.id;
  // A concurrent explicit directory create may win without using our advisory
  // fence. Re-read its company-local identity; never update its contact facts.
  const [winner] = await tx.select({ id: suppliersTable.id }).from(suppliersTable).where(predicate).limit(1).for("update");
  if (!winner) throw new FinancialRequestError("تغيّرت هوية المورد أثناء الإنشاء؛ أعد مراجعة الطلب", 409);
  return winner.id;
}
