import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
} from "drizzle-orm/pg-core";
import { suppliersTable } from "./suppliers";
import { productsTable } from "./products";
import { warehousesTable } from "./warehouses";
import { usersTable } from "./users";
import { invoicesTable } from "./invoices";
import { branchesTable } from "./branches";
import { companiesTable } from "./companies";

// =========================================================================
// Purchase Requisitions (internal request to buy)
// =========================================================================
export const purchaseRequisitionsTable = pgTable("purchase_requisitions", {
  id: serial("id").primaryKey(),
  // Tenant key. Backfilled at boot via branches.company_id; new rows
  // must stamp it explicitly from the session.
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  reference: text("reference").notNull().unique(),
  requesterId: integer("requester_id").references(() => usersTable.id),
  branchId: integer("branch_id").references(() => branchesTable.id),
  warehouseId: integer("warehouse_id").references(() => warehousesTable.id),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  approvedBy: integer("approved_by").references(() => usersTable.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const purchaseRequisitionLinesTable = pgTable("purchase_requisition_lines", {
  id: serial("id").primaryKey(),
  // Denormalized tenant key so line-only queries can scope without
  // joining the parent header.
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  requisitionId: integer("requisition_id")
    .notNull()
    .references(() => purchaseRequisitionsTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  estimatedCost: numeric("estimated_cost", { precision: 18, scale: 4 }).notNull().default("0"),
  neededBy: date("needed_by"),
});

// =========================================================================
// RFQ — Request for Quotation
// =========================================================================
export const rfqsTable = pgTable("rfqs", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  requisitionId: integer("requisition_id").references(() => purchaseRequisitionsTable.id),
  status: text("status").notNull().default("draft"), // draft, sent, closed, awarded
  dueDate: date("due_date"),
  notes: text("notes"),
  awardedSupplierId: integer("awarded_supplier_id").references(() => suppliersTable.id),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const rfqSuppliersTable = pgTable("rfq_suppliers", {
  id: serial("id").primaryKey(),
  rfqId: integer("rfq_id").notNull().references(() => rfqsTable.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id),
  sentAt: timestamp("sent_at"),
  respondedAt: timestamp("responded_at"),
});

export const rfqQuoteLinesTable = pgTable("rfq_quote_lines", {
  id: serial("id").primaryKey(),
  rfqId: integer("rfq_id").notNull().references(() => rfqsTable.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id),
  productId: integer("product_id").references(() => productsTable.id),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull(),
  leadTimeDays: integer("lead_time_days").notNull().default(0),
});

// =========================================================================
// Purchase Orders
// =========================================================================
export const purchaseOrdersTable = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id),
  supplierName: text("supplier_name").notNull(),
  warehouseId: integer("warehouse_id").references(() => warehousesTable.id),
  status: text("status").notNull().default("draft"),
  // draft, confirmed, partially_received, fully_received, closed, cancelled
  orderDate: date("order_date").notNull(),
  expectedDate: date("expected_date"),
  currencyCode: text("currency_code").notNull().default("SAR"),
  exchangeRate: numeric("exchange_rate", { precision: 18, scale: 8 }).notNull().default("1"),
  subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull().default("0"),
  vat: numeric("vat", { precision: 18, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 18, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  requisitionId: integer("requisition_id").references(() => purchaseRequisitionsTable.id),
  rfqId: integer("rfq_id").references(() => rfqsTable.id),
  agreementId: integer("agreement_id"),
  requiresApproval: boolean("requires_approval").notNull().default(false),
  approvedBy: integer("approved_by").references(() => usersTable.id),
  approvedAt: timestamp("approved_at"),
  // Stamped when the PO PDF is emailed out to the supplier so the UI can
  // show "Sent on <date>" and prevent accidental double sends.
  sentToSupplierAt: timestamp("sent_to_supplier_at"),
  sentToSupplierEmail: text("sent_to_supplier_email"),
  /** Multi-Company Phase 5: true when this PO was auto-generated as the mirror of a sales order/PO in another company (loop guard). */
  isIntercompany: boolean("is_intercompany").notNull().default(false),
  /** Multi-Company Phase 5: id of the counterparty company in the intercompany pair. */
  counterpartyCompanyId: integer("counterparty_company_id"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const purchaseOrderLinesTable = pgTable("purchase_order_lines", {
  id: serial("id").primaryKey(),
  poId: integer("po_id").notNull().references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  receivedQty: numeric("received_qty", { precision: 18, scale: 4 }).notNull().default("0"),
  billedQty: numeric("billed_qty", { precision: 18, scale: 4 }).notNull().default("0"),
  unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull(),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("15"),
  lineTotal: numeric("line_total", { precision: 18, scale: 2 }).notNull(),
});

// =========================================================================
// Goods Receipts (GRN)
// =========================================================================
export const goodsReceiptsTable = pgTable("goods_receipts", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  poId: integer("po_id").notNull().references(() => purchaseOrdersTable.id),
  warehouseId: integer("warehouse_id").notNull().references(() => warehousesTable.id),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  receivedBy: integer("received_by").references(() => usersTable.id),
  notes: text("notes"),
});

export const goodsReceiptLinesTable = pgTable("goods_receipt_lines", {
  id: serial("id").primaryKey(),
  grnId: integer("grn_id").notNull().references(() => goodsReceiptsTable.id, { onDelete: "cascade" }),
  poLineId: integer("po_line_id").notNull().references(() => purchaseOrderLinesTable.id),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 18, scale: 4 }).notNull(),
});

// =========================================================================
// Payment Runs (AP settlement)
// =========================================================================
export const paymentRunsTable = pgTable("payment_runs", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  paymentDate: date("payment_date").notNull(),
  paymentMethod: text("payment_method").notNull().default("bank"), // cash | bank
  bankAccountId: integer("bank_account_id"),
  totalAmount: numeric("total_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("draft"), // draft | executed | cancelled
  notes: text("notes"),
  createdBy: integer("created_by").references(() => usersTable.id),
  executedAt: timestamp("executed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const paymentRunLinesTable = pgTable("payment_run_lines", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull().references(() => paymentRunsTable.id, { onDelete: "cascade" }),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id),
  invoiceId: integer("invoice_id").references(() => invoicesTable.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  journalEntryId: integer("journal_entry_id"),
});

// =========================================================================
// Blanket Agreements (long-term price/volume contracts)
// =========================================================================
export const blanketAgreementsTable = pgTable("blanket_agreements", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  supplierId: integer("supplier_id").notNull().references(() => suppliersTable.id),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  totalCommittedValue: numeric("total_committed_value", { precision: 18, scale: 2 }).notNull().default("0"),
  releasedValue: numeric("released_value", { precision: 18, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("active"), // active | expired | cancelled
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const blanketAgreementItemsTable = pgTable("blanket_agreement_items", {
  id: serial("id").primaryKey(),
  agreementId: integer("agreement_id")
    .notNull()
    .references(() => blanketAgreementsTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  agreedPrice: numeric("agreed_price", { precision: 18, scale: 4 }).notNull(),
  agreedQty: numeric("agreed_qty", { precision: 18, scale: 4 }).notNull(),
  releasedQty: numeric("released_qty", { precision: 18, scale: 4 }).notNull().default("0"),
});

// Type re-exports
export type PurchaseRequisition = typeof purchaseRequisitionsTable.$inferSelect;
export type PurchaseOrder = typeof purchaseOrdersTable.$inferSelect;
export type GoodsReceipt = typeof goodsReceiptsTable.$inferSelect;
export type PaymentRun = typeof paymentRunsTable.$inferSelect;
export type BlanketAgreement = typeof blanketAgreementsTable.$inferSelect;
