import { pgTable, serial, text, boolean, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // POS-only staff identities have no invented platform email or password.
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  phone: text("phone"),
  role: text("role").notNull(),
  branchId: integer("branch_id"),
  preferredBranchId: integer("preferred_branch_id"),
  isActive: boolean("is_active").notNull().default(true),
  has2fa: boolean("has_2fa").notNull().default(false),
  avatarUrl: text("avatar_url"),
  lastLoginAt: timestamp("last_login_at"),
  lastCleanupReportTestEmail: text("last_cleanup_report_test_email"),
  // Task #198: per-admin remembered UI preferences for the admin panel
  // (selected tab, cleanup runs date filter, etc.). Stored as an opaque
  // JSON bag so we can extend it without further migrations. Keys are
  // validated by the route's Zod schema, not at the DB layer.
  adminPrefs: jsonb("admin_prefs").$type<AdminPrefs>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Per-user audit consent. Owners and admins can read any audit row;
 * everyone else (auditor / accountant / etc.) sees rows whose actor
 * has these flags ON for the corresponding facet. Toggling a flag OFF
 * does NOT erase past rows — it only redacts them at read time, so
 * audit integrity is preserved while still respecting GDPR/PDPL-style
 * "right to limit visibility".
 *
 * Defaults (when unset / null): every flag is `true` for backwards
 * compatibility with the pre-Insight-Mode behaviour.
 */
export type AuditConsent = {
  /** When false: monetary figures in audit `details` are redacted. */
  salesDetails?: boolean;
  /** When false: actor `userName` + emails/phones in `details` are redacted. */
  customerPii?: boolean;
  /** When false: `ipAddress` on the audit row is dropped. */
  locationContext?: boolean;
};

export type AdminPrefs = {
  lastAdminTab?: string | null;
  cleanupRunsFrom?: string | null;
  cleanupRunsTo?: string | null;
  /**
   * Task #259 — "Insight Mode" reframes alerts from monitoring/red
   * copy to opportunity/teal copy. Per-user. Default OFF (classic
   * compliance tone) for backwards compatibility.
   */
  insightMode?: boolean;
  /** Task #259 — per-user audit visibility consent (see AuditConsent). */
  auditConsent?: AuditConsent;
  /**
   * Task #260 — ISO timestamp of the last time `auditConsent` was
   * written by the user. Stamped server-side in
   * PATCH /users/me/preferences so owners can spot stale defaults
   * and freshly-confirmed consents on the Team Privacy panel.
   */
  auditConsentUpdatedAt?: string;
  /**
   * Task #260 — ISO timestamp set when an owner asks this user to
   * re-confirm their audit consent via
   * POST /admin/team-consents/:userId/request-reconfirm. Cleared
   * the next time the user writes their own consent (see PATCH
   * /users/me/preferences).
   */
  auditConsentReconfirmRequestedAt?: string;
  /**
   * Task #260 — id of the owner who issued the latest re-confirm
   * request, alongside `auditConsentReconfirmRequestedAt`. Stored
   * for traceability on the user's side; the authoritative paper
   * trail still lives in `audit_logs`.
   */
  auditConsentReconfirmRequestedBy?: number;
};

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, lastLoginAt: true, passwordHash: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
