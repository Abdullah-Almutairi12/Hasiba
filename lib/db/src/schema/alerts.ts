import { pgTable, serial, text, boolean, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { usersTable } from "./users";

export const alertsTable = pgTable("alerts", {
  id: serial("id").primaryKey(),
  type: text("type").notNull().default("info"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  /** Nullable in Phase 1; becomes NOT NULL in Phase 2 once tenant scoping lands. */
  /**
   * Nullable on purpose: cross-tenant operational alerts emitted by
   * background workers (invoice-email-retry-worker for quotation/PO
   * outboxes, reporting-workers KPI evaluator) cannot derive a single
   * tenant because their parent tables aren't yet tenant-scoped. The
   * dashboard reader (/dashboard/alerts) uses strict eq(companyId,…),
   * so NULL alerts never leak into a specific tenant's feed — they
   * remain visible only via cross-tenant operations views.
   */
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAlertSchema = createInsertSchema(alertsTable).omit({ id: true, createdAt: true });
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alertsTable.$inferSelect;

/**
 * Per-user dismissal of a dashboard alert row. `alertKey` is the
 * stable string identifier surfaced by GET /dashboard/alerts:
 *   - persisted alerts: `alert:<id>`
 *   - synthetic stale-scan banner: `synthetic:stale_scan`
 * The reader treats an alert as hidden when a dismissal exists AND
 * the alert's current trigger timestamp is <= dismissedAt. A new
 * persisted alert (different id) gets its own key, and the synthetic
 * banner re-emerges only after a fresh `scan_nightly` runs (advancing
 * the triggeredAt) and the condition relapses.
 */
export const alertDismissalsTable = pgTable(
  "alert_dismissals",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    alertKey: text("alert_key").notNull(),
    /**
     * FK shortcut for keys of the form `alert:<id>`. Populated on
     * insert so that deleting the underlying `alerts` row cascades
     * and removes the dismissal automatically. NULL for synthetic
     * keys (e.g. `synthetic:stale_scan`) and for legacy rows written
     * before this column existed (the nightly sweep mops those up).
     */
    alertId: integer("alert_id").references(() => alertsTable.id, {
      onDelete: "cascade",
    }),
    /**
     * Free-text justification an accountant supplies when hiding the
     * alert. Persisted alongside the dismissal so external auditors
     * can trace WHY a row was silenced. Capped at 2000 chars by the
     * API layer to keep audit exports bounded.
     */
    justificationNotes: text("justification_notes"),
    /**
     * Relative URL (`/api/storage/objects/...`) to a PDF the
     * accountant uploaded as supporting evidence (e.g. supplier
     * invoice, bank advice). The dismiss endpoint validates the
     * shape; the file itself lives in object storage.
     */
    attachmentUrl: text("attachment_url"),
    dismissedAt: timestamp("dismissed_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("alert_dismissals_user_company_key_uq").on(
      t.userId,
      t.companyId,
      t.alertKey,
    ),
  ],
);

export type AlertDismissal = typeof alertDismissalsTable.$inferSelect;
