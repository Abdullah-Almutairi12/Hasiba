import type { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { db, portalSessionsTable } from "@workspace/db";
import { and, eq, gt, isNull } from "drizzle-orm";

export type PortalKind = "customer" | "supplier" | "employee";

export interface PortalSessionContext {
  portal: PortalKind;
  principalId: number;
  email: string;
  sessionId: number;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function extractBearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || typeof h !== "string") return null;
  const [scheme, value] = h.split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !value) return null;
  return value;
}

export function requirePortalSession(kinds?: PortalKind[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = extractBearer(req);
      if (!token) {
        res.status(401).json({ error: "غير مسجل دخول للبوابة" });
        return;
      }
      const tokenHash = hashToken(token);
      const [row] = await db
        .select()
        .from(portalSessionsTable)
        .where(
          and(
            eq(portalSessionsTable.tokenHash, tokenHash),
            isNull(portalSessionsTable.revokedAt),
            gt(portalSessionsTable.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!row) {
        res.status(401).json({ error: "جلسة منتهية" });
        return;
      }
      if (kinds && !kinds.includes(row.portal as PortalKind)) {
        res.status(403).json({ error: "هذه البوابة غير مسموحة لهذا الحساب" });
        return;
      }
      req.portal = {
        portal: row.portal as PortalKind,
        principalId: row.principalId,
        email: row.email,
        sessionId: row.id,
      };
      // Touch last_seen_at (fire-and-forget).
      db.update(portalSessionsTable)
        .set({ lastSeenAt: new Date() })
        .where(eq(portalSessionsTable.id, row.id))
        .catch(() => undefined);
      next();
    } catch (err) {
      req.log.error({ err }, "portal session lookup failed");
      res.status(500).json({ error: "حدث خطأ في الخادم" });
    }
  };
}
