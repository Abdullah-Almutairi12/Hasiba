import {
  db,
  accountsTable,
  journalEntriesTable,
  journalEntryLinesTable,
  paymentGatewaysTable,
  paymentIntentsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Post a payment receipt to the GL.
 *
 *   Dr  Bank account         (cash hits the bank)
 *     Cr  Clearing account   (clear the open POS / invoice receivable)
 *
 * Idempotent on (source = 'payment', source_ref = payment_intent.id).
 */
export async function postPaymentReceiptToLedger(intentId: number): Promise<{
  entryId: number | null;
  skipped?: string;
}> {
  const [intent] = await db
    .select()
    .from(paymentIntentsTable)
    .where(eq(paymentIntentsTable.id, intentId));
  if (!intent) return { entryId: null, skipped: "intent_not_found" };
  if (intent.status !== "captured" && intent.status !== "authorized") {
    return { entryId: null, skipped: `status_${intent.status}` };
  }

  const sourceRef = String(intent.id);
  const existing = await db
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(eq(journalEntriesTable.sourceRef, sourceRef))
    .limit(1);
  if (existing[0]) return { entryId: existing[0].id, skipped: "already_posted" };

  const [gateway] = await db
    .select()
    .from(paymentGatewaysTable)
    .where(eq(paymentGatewaysTable.id, intent.gatewayId));
  if (!gateway) return { entryId: null, skipped: "gateway_missing" };

  const [bankAcc] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.systemKey, gateway.bankAccountKey));
  const [clearingAcc] = await db
    .select()
    .from(accountsTable)
    .where(eq(accountsTable.systemKey, gateway.clearingAccountKey));
  if (!bankAcc || !clearingAcc) {
    return { entryId: null, skipped: "missing_chart_accounts" };
  }

  const amt = String(intent.amount);
  const today = new Date().toISOString().slice(0, 10);
  const entryNumber = `PAY-${intent.id}-${Date.now().toString(36)}`;

  const [entry] = await db
    .insert(journalEntriesTable)
    .values({
      entryNumber,
      entryDate: today,
      description: `استلام دفعة عبر ${gateway.displayName}`,
      reference: intent.providerRef ?? null,
      currencyCode: intent.currency,
      status: "posted",
      source: "payment",
      sourceRef,
      postedAt: new Date(),
    })
    .returning({ id: journalEntriesTable.id });

  await db.insert(journalEntryLinesTable).values([
    {
      entryId: entry!.id,
      lineNumber: 1,
      accountId: bankAcc.id,
      description: `Bank ${gateway.provider}`,
      debit: amt,
      credit: "0",
      baseDebit: amt,
      baseCredit: "0",
    },
    {
      entryId: entry!.id,
      lineNumber: 2,
      accountId: clearingAcc.id,
      description: `Clearing ${gateway.provider}`,
      debit: "0",
      credit: amt,
      baseDebit: "0",
      baseCredit: amt,
    },
  ]);

  return { entryId: entry!.id };
}
