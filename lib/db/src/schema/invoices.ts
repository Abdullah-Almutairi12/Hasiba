import { pgTable, serial, text, integer, numeric, real, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { suppliersTable } from "./suppliers";
import { companiesTable } from "./companies";

export const invoicesTable = pgTable("invoices", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull(),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  supplierName: text("supplier_name").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"),
  confidence: real("confidence"),
  fileUrl: text("file_url"),
  invoiceDate: timestamp("invoice_date"),
  dueDate: timestamp("due_date"),
  poId: integer("po_id"),
  notes: text("notes"),
  lineEvidenceVersion: integer("line_evidence_version"),
  billedQuantitiesApplied: boolean("billed_quantities_applied").notNull().default(false),
  lifecycleVersion: integer("lifecycle_version"),
  currencyCode:text("currency_code"),
  createdBy: integer("created_by"),
  branchId: integer("branch_id"),
  supplierDocumentNumber: text("supplier_document_number"),
  normalizedDocumentNumber: text("normalized_document_number"),
  documentType: text("document_type").notNull().default("invoice"),
  invoiceKind: text("invoice_kind").notNull().default("goods"),
  netAmount: numeric("net_amount",{precision:18,scale:2}),
  vatAmount: numeric("vat_amount",{precision:18,scale:2}),
  expenseAccountId: integer("expense_account_id"),
  reviewedBy: integer("reviewed_by"),
  reviewAuthority: text("review_authority"),
  reviewedSource: text("reviewed_source"),
  journalEntryId: integer("journal_entry_id"),
  // Audit lock: set true when the invoice is approved/finalised. Locked
  // invoices cannot be deleted or have financial fields edited — only a
  // reverse invoice (qiyud 3aksi) may neutralise them.
  isLocked: boolean("is_locked").notNull().default(false),
  lockedAt: timestamp("locked_at"),
  // Self-referencing reversal trail: reversesId points to the original
  // locked invoice; reversedById points to the reversing invoice.
  reversesId: integer("reverses_id"),
  reversedById: integer("reversed_by_id"),
  reversedReason: text("reversed_reason"),
  /** Nullable in Phase 1; becomes NOT NULL in Phase 2 once tenant scoping lands. */
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
  /** Multi-Company Phase 5: true when this supplier invoice was auto-generated as the mirror of a sales invoice in another company. */
  isIntercompany: boolean("is_intercompany").notNull().default(false),
  /** Multi-Company Phase 5: id of the source/destination company in the intercompany pair. */
  counterpartyCompanyId: integer("counterparty_company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true, status: true, confidence: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
