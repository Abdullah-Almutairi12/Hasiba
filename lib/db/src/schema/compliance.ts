import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { usersTable } from "./users";

/**
 * Phase 3 — Transfer Pricing & Zakat Compliance.
 *
 * Single durable queue for every compliance finding raised by the
 * engine. Hand-resolved or auto-resolved (e.g. when a follow-up scan
 * sees the underlying problem is gone). Drives the
 * `/compliance` console and the weekly/monthly emailed PDF.
 *
 * `kind`:
 *   - 'transfer_pricing'   — intercompany line price deviates from
 *                            the product's market reference by more
 *                            than ±15%.
 *   - 'agreement_missing'  — a transfer-pricing finding fired but no
 *                            active intercompany agreement PDF covers
 *                            the (source, target) company pair on the
 *                            transaction date. Mandatory remediation.
 *   - 'zakat'              — intercompany open balance with one
 *                            counterparty exceeds the configured
 *                            threshold and may distort the zakat base.
 *
 * `details` is a free-form jsonb bag intentionally typed loosely on
 * the server (validated structurally per-kind in the lib). The UI
 * only reads well-known keys (deviationPct, lineDescription,
 * benchmarkPrice, actualPrice, netOpenAmount, counterpartyCompanyId).
 */
export const complianceAlertsTable = pgTable(
  "compliance_alerts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    severity: text("severity").notNull().default("warning"),
    refType: text("ref_type").notNull(),
    refId: integer("ref_id").notNull(),
    ref: text("ref"),
    counterpartyCompanyId: integer("counterparty_company_id"),
    message: text("message").notNull(),
    deviationPct: numeric("deviation_pct", { precision: 9, scale: 4 }),
    details: jsonb("details").notNull().default({}),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: integer("resolved_by").references(() => usersTable.id),
    resolvedNote: text("resolved_note"),
  },
  (t) => ({
    companyStatusIdx: index("compliance_alerts_company_status_idx").on(
      t.companyId,
      t.status,
    ),
    kindIdx: index("compliance_alerts_kind_idx").on(t.companyId, t.kind),
    refIdx: index("compliance_alerts_ref_idx").on(t.refType, t.refId),
  }),
);

export type ComplianceAlert = typeof complianceAlertsTable.$inferSelect;
export type InsertComplianceAlert = typeof complianceAlertsTable.$inferInsert;

/**
 * Phase 3 — signed intercompany agreement registry.
 *
 * Holds the PDF of the master service/transfer-pricing agreement
 * between this company and a sibling (`counterpartyCompanyId`). A row
 * is considered "active" on date D when isActive=true and
 * effectiveFrom <= D <= COALESCE(effectiveTo, infinity).
 *
 * Storage: pdfUrl is a relative `/api/storage/objects/...` URL
 * produced by POST /storage/attachments (already PDF-sniffed).
 */
export const intercompanyAgreementsTable = pgTable(
  "intercompany_agreements",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    counterpartyCompanyId: integer("counterparty_company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    pdfUrl: text("pdf_url").notNull(),
    pdfFilename: text("pdf_filename"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    uploadedBy: integer("uploaded_by").references(() => usersTable.id),
    uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  },
  (t) => ({
    pairIdx: index("intercompany_agreements_pair_idx").on(
      t.companyId,
      t.counterpartyCompanyId,
      t.isActive,
    ),
  }),
);

export type IntercompanyAgreement =
  typeof intercompanyAgreementsTable.$inferSelect;
export type InsertIntercompanyAgreement =
  typeof intercompanyAgreementsTable.$inferInsert;
