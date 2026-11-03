import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "./journal-posting";
import { canonical } from "./financial-transaction";
import { assertPosDeviceAuthority } from "./pos-device-authority";

/** Acquire before source/member row locks; retained until commit or rollback. */
export async function lockApprovalAuthority(connection: DbOrTx) {
  await connection.execute(sql`SELECT pg_advisory_xact_lock_shared(174223,35)`);
  await assertPosDeviceAuthority(connection);
}

/** A directory importer already owns a relation lock. Never wait here:
 * existing writers take the authority fence before their implicit DML locks.
 * A queued authority writer must therefore make this attempt roll back,
 * not form a fence/relation cycle. The caller retains its durable intent.
 */
export async function tryLockApprovalAuthority(connection: DbOrTx) {
  const result = await connection.execute(sql`SELECT pg_try_advisory_xact_lock_shared(174223,35) AS acquired`);
  return result.rows[0]?.acquired === true;
}

/** Administrative transactions take the writer side before company row locks. */
export async function lockApprovalAuthorityWrite(connection: DbOrTx) {
  await connection.execute(sql`SELECT pg_advisory_xact_lock(174223,35)`);
}

export function authorityFingerprint(facts: unknown) {
  return createHash("sha256").update(canonical(facts)).digest("hex");
}
