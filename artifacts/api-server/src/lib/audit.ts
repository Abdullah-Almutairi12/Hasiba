import type { Request } from "express";
import { db, auditLogsTable } from "@workspace/db";

/**
 * Centralized audit-logging helper. Fire-and-forget — failures must never break
 * the main request flow, so all errors are swallowed and logged via req.log.
 *
 * Tenant scoping (Phase 2): `companyId` is sourced from the session and
 * stamped on every row so the audit trail is scoped to the tenant whose
 * action produced it.
 */
export type AuditSeverity = "info" | "warning" | "critical";

export interface AuditEntry {
  action: string;
  entity: string;
  details?: string;
  severity?: AuditSeverity;
}

export async function recordAudit(req: Request, entry: AuditEntry): Promise<void> {
  try {
    const sess = (req as { session?: { userId?: number; userName?: string; userRole?: string; companyId?: number } }).session;
    const companyId = sess?.companyId;
    // audit_logs.company_id is NOT NULL (Phase-2 tenant isolation, migration
    // 0008). If the request reached us without a bound company (auth/public
    // routes, webhooks, anonymous health checks…) there is no tenant scope
    // to attach the audit row to, so we skip persistence rather than insert
    // an orphan row that would fail the NOT NULL constraint.
    if (typeof companyId !== "number") {
      req.log?.debug?.({ entry }, "audit log skipped: no tenant context");
      return;
    }
    const userId = sess?.userId ?? null;
    const userName = sess?.userName ?? "نظام";
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    await db.insert(auditLogsTable).values({
      userId,
      userName,
      action: entry.action,
      entity: entry.entity,
      details: entry.details ?? null,
      ipAddress: ip,
      severity: entry.severity ?? "info",
      companyId,
    });
  } catch (err) {
    req.log?.warn?.({ err, entry }, "audit log failed");
  }
}
