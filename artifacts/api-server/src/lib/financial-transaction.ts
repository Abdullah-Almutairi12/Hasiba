import { createHash } from "node:crypto";
import type { Request } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, financialRequestsTable } from "@workspace/db";
import { getCompanyId } from "./scoped-db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Snapshot = { value: unknown; dates: string[][] };
export class FinancialRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
  get httpStatus() { return this.status; }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(
    (k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
  ).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function snapshot(value: unknown): Snapshot {
  const dates: string[][] = [];
  function visit(item: unknown, path: string[]): unknown {
    if (item instanceof Date) { dates.push(path); return item.toISOString(); }
    if (Array.isArray(item)) return item.map((v, i) => visit(v, [...path, String(i)]));
    if (item && typeof item === "object") return Object.fromEntries(
      Object.entries(item).map(([k, v]) => [k, visit(v, [...path, k])]),
    );
    return item ?? null;
  }
  return { value: visit(value, []), dates };
}
function restore<T>(saved: Snapshot): T {
  let value = saved.value;
  for (const path of saved.dates) {
    if (!path.length) { value = new Date(value as string); continue; }
    let target = value as Record<string, unknown>;
    for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
    const last = path[path.length - 1];
    target[last] = new Date(target[last] as string);
  }
  return value as T;
}

/**
 * Same company + actor + endpoint + key means ONE financial intent.
 * Equal payloads with different keys remain legitimate separate transactions.
 * Errors roll back both the business writes and receipt; retries can succeed.
 */
export async function financialTransaction<T>(req: Request, work: (tx: Tx) => Promise<T>): Promise<T> {
  const key = req.get("Idempotency-Key");
  if (!key) return db.transaction(work);
  if (key && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(key)) {
    throw new FinancialRequestError("مفتاح إعادة الطلب غير صالح", 400);
  }
  const companyId = getCompanyId(req);
  const userId = req.session?.userId;
  if (!userId) throw new FinancialRequestError("يلزم تسجيل الدخول", 401);
  const operation = `${req.method}:${req.baseUrl}:${String(req.route?.path)}`;
  const requestHash = createHash("sha256").update(canonical({ params: req.params, body: req.body, query: req.query })).digest("hex");
  return db.transaction(async (tx) => {
    const lock = JSON.stringify([companyId, userId, operation, key]);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);
    const [previous] = await tx.select().from(financialRequestsTable).where(and(
      eq(financialRequestsTable.companyId, companyId), eq(financialRequestsTable.userId, userId),
      eq(financialRequestsTable.operation, operation), eq(financialRequestsTable.requestKey, key),
    ));
    if (previous) {
      if (previous.requestHash !== requestHash) {
        throw new FinancialRequestError("استُخدم مفتاح الطلب لبيانات مختلفة. ابدأ عملية جديدة.", 409);
      }
      req.res?.setHeader("Idempotency-Replayed", "true");
      return restore<T>(previous.result as Snapshot);
    }
    const result = await work(tx);
    await tx.insert(financialRequestsTable).values({
      companyId, userId, operation, requestKey: key, requestHash, result: snapshot(result),
    });
    return result;
  });
}
