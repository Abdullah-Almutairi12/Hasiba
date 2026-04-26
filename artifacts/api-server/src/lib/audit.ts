import type { Request } from "express";
import { db, auditLogsTable } from "@workspace/db";

/**
 * Centralized audit-logging helper. Fire-and-forget — failures must never break
 * the main request flow, so all errors are swallowed and logged via req.log.
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
    const sess = (req as { session?: { userId?: number; userName?: string; userRole?: string } }).session;
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
    });
  } catch (err) {
    req.log?.warn?.({ err, entry }, "audit log failed");
  }
}
