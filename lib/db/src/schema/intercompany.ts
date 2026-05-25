import { pgTable, serial, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
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
