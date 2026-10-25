import { db } from "@workspace/db";
import { protectLastAdministrator } from "./administration-authority";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Compatibility entrypoint: administration continuity, not legal ownership.
 * Caller holds authority writer fence + company's row lock. */
export async function assertAnotherActiveOwner(tx: Transaction, companyId: number, userId: number) {
  await protectLastAdministrator(tx,companyId,userId);
}
