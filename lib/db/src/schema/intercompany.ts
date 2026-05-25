import { pgTable, serial, text, integer, timestamp, index, uniqueIndex, numeric } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

/**
 * Multi-Company Phase 5: links a source document (sales invoice OR
 * purchase order) in one company to its auto-generated mirror document
 * (supplier invoice OR sales order) in a sibling company.
 *
 * One row per source document — unique on (kind, source_doc_id). The link
 * is created inside the same DB transaction that creates the source
 * document, so its existence is a guarantee the mirror also exists.
 *
 * Status:
 *   - matched:   mirror is live and amounts match the source.
 *   - unmatched: manual review state — source and mirror amounts diverge.
 *   - void:      source was cancelled/reversed; mirror has been reversed.
 *   - resynced:  mirror was forcefully recreated via the
 *                "Send to counterparty" action after a source edit.
 */
export const intercompanyLinksTable = pgTable(
  "intercompany_links",
  {
    id: serial("id").primaryKey(),
    /** 'sales_invoice' or 'purchase_order' — what kind of source document this row mirrors. */
    kind: text("kind").notNull(),
    sourceCompanyId: integer("source_company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    sourceDocId: integer("source_doc_id").notNull(),
    sourceRef: text("source_ref").notNull(),
    targetCompanyId: integer("target_company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    targetDocId: integer("target_doc_id").notNull(),
    targetRef: text("target_ref").notNull(),
    status: text("status").notNull().default("matched"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqSource: uniqueIndex("intercompany_links_source_unique").on(t.kind, t.sourceDocId),
    targetIdx: index("intercompany_links_target_idx").on(t.kind, t.targetDocId),
    sourceCompanyIdx: index("intercompany_links_source_company_idx").on(t.sourceCompanyId),
  }),
);

export type IntercompanyLink = typeof intercompanyLinksTable.$inferSelect;

/**
 * Phase 6 add-on: persisted record of intercompany pricing-policy
 * mismatches. The consolidated PL/BS reports surface a transient
 * "imbalance" banner when a matched link's source and mirror amounts
 * diverge — this table turns that finding into a durable review queue
 * so finance can triage with one-click resync/void/ignore.
 *
 * One row per (link_id, basis) — `basis` is 'subtotal' for P&L-side
 * differences and 'open' for outstanding AR/AP differences. Both can
 * coexist for the same link.
 *
 * Status flow:
 *   - open:     the most recent scan still finds a mismatch.
 *   - resolved: a later scan found the amounts now agree (auto-flipped).
 *   - ignored:  finance accepted the difference (e.g. legitimate FX
 *               or rounding) and silenced it explicitly.
 */
export const intercompanyImbalancesTable = pgTable(
  "intercompany_imbalances",
  {
    id: serial("id").primaryKey(),
    linkId: integer("link_id").notNull().references(() => intercompanyLinksTable.id, { onDelete: "cascade" }),
    basis: text("basis").notNull(),
    kind: text("kind").notNull(),
    sourceCompanyId: integer("source_company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    sourceRef: text("source_ref").notNull(),
    targetCompanyId: integer("target_company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    targetRef: text("target_ref").notNull(),
    sourceAmount: numeric("source_amount", { precision: 18, scale: 4 }).notNull(),
    targetAmount: numeric("target_amount", { precision: 18, scale: 4 }).notNull(),
    difference: numeric("difference", { precision: 18, scale: 4 }).notNull(),
    status: text("status").notNull().default("open"),
    notes: text("notes"),
    detectedAt: timestamp("detected_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
    resolvedBy: integer("resolved_by"),
  },
  (t) => ({
    uniqLinkBasis: uniqueIndex("intercompany_imbalances_link_basis_unique").on(t.linkId, t.basis),
    statusIdx: index("intercompany_imbalances_status_idx").on(t.status),
    sourceCompanyIdx: index("intercompany_imbalances_source_company_idx").on(t.sourceCompanyId),
    targetCompanyIdx: index("intercompany_imbalances_target_company_idx").on(t.targetCompanyId),
  }),
);

export type IntercompanyImbalance = typeof intercompanyImbalancesTable.$inferSelect;
