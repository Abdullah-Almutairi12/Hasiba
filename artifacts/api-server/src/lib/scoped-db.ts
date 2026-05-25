import type { Request } from "express";
import { eq, and, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/**
 * Multi-tenant scoping helpers. The Phase 2 design keeps Drizzle's native
 * query builder (joins, returning, transactions, raw SQL) intact and adds
 * thin, type-safe helpers that the route layer composes into existing
 * `where(...)` / `values(...)` calls.
 *
 * Usage pattern in a route:
 *
 *   const scoped = scopedDb(req);
 *   await db.select().from(productsTable).where(scoped.scope(productsTable));
 *   await db.insert(productsTable).values(scoped.stamp({ name, sku, ... }));
 *
 * Tables that carry a `company_id` FK are listed in the schema; this helper
 * accepts any Drizzle table whose generated type exposes a `companyId`
 * column, so accidental use against a non-scoped table is rejected at
 * compile time.
 */

/** Minimal structural type for a Drizzle table with a companyId column. */
export interface ScopedTable {
  companyId: PgColumn;
}

/**
 * Wrapper bound to a single request's tenant. Constructed via {@link scopedDb}
 * — never instantiate directly so that an unauthenticated request cannot
 * accidentally produce one with `companyId = 0` or similar.
 */
export class ScopedDb {
  /**
   * @param companyId The validated tenant id sourced from `req.session.companyId`.
   *                  Always > 0; the constructor refuses zero/negative values
   *                  to make a missing-context bug fail loudly at the source.
   */
  constructor(public readonly companyId: number) {
    if (!Number.isInteger(companyId) || companyId <= 0) {
      throw new Error(`ScopedDb: invalid companyId=${companyId}`);
    }
  }

  /** Equality predicate `table.company_id = $companyId` — drop into `where()`. */
  scope(table: ScopedTable): SQL {
    return eq(table.companyId, this.companyId);
  }

  /**
   * Combine the company scope with any number of extra predicates via AND.
   * Returns a non-null `SQL` because the company scope itself is always
   * present, so the result is safe to pass directly to `where()`.
   */
  scoped(table: ScopedTable, ...extras: Array<SQL | undefined>): SQL {
    const conds = extras.filter((c): c is SQL => c !== undefined);
    const combined = and(this.scope(table), ...conds);
    if (!combined) throw new Error("ScopedDb.scoped: combined predicate was undefined");
    return combined;
  }

  /**
   * Inject the tenant id into an insert payload. Caller-supplied `companyId`
   * (if any) is overridden so a route cannot accidentally write into another
   * tenant's table by trusting client input.
   */
  stamp<T extends Record<string, unknown>>(values: T): T & { companyId: number } {
    return { ...values, companyId: this.companyId };
  }
}

/**
 * Read the authoritative tenant id off the session. Throws if the request
 * was not gated by `requireCompanyContext` first — callers should rely on
 * the middleware rather than catching this themselves.
 */
export function getCompanyId(req: Request): number {
  const cid = req.session?.companyId;
  if (!Number.isInteger(cid) || (cid as number) <= 0) {
    throw new Error(
      "Missing companyId on session — route is not gated by requireCompanyContext",
    );
  }
  return cid as number;
}

/** Construct a {@link ScopedDb} bound to the current request's tenant. */
export function scopedDb(req: Request): ScopedDb {
  return new ScopedDb(getCompanyId(req));
}
