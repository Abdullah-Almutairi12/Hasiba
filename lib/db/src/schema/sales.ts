import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  timestamp,
  date,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { customersTable } from "./customers";
import { productsTable } from "./products";
import { warehousesTable } from "./warehouses";
import { branchesTable } from "./branches";
import { usersTable } from "./users";
import { companiesTable } from "./companies";

// =====================================================================
// Pricelists
// =====================================================================
export const pricelistsTable = pgTable("pricelists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  currencyCode: text("currency_code").notNull().default("SAR"),
  segment: text("segment"), // retail | wholesale | vip | distributor | null = generic
  startDate: date("start_date"),
  endDate: date("end_date"),
  isActive: boolean("is_active").notNull().default(true),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const pricelistItemsTable = pgTable(
  "pricelist_items",
  {
    id: serial("id").primaryKey(),
    pricelistId: integer("pricelist_id")
      .notNull()
      .references(() => pricelistsTable.id, { onDelete: "cascade" }),
    productId: integer("product_id").references(() => productsTable.id, {
      onDelete: "cascade",
    }),
    minQuantity: numeric("min_quantity", { precision: 18, scale: 4 })
      .notNull()
      .default("1"),
    unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull(),
    // Optional discount instead of fixed price (percent over product list price)
    discountPct: numeric("discount_pct", { precision: 5, scale: 2 }),
  },
  (t) => ({
    listIdx: index("pricelist_items_list_idx").on(t.pricelistId),
    productIdx: index("pricelist_items_product_idx").on(t.productId),
  }),
);

// =====================================================================
// Discount rules (catalogue of named discounts with reason → GL account)
// =====================================================================
export const discountRulesTable = pgTable("discount_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  kind: text("kind").notNull().default("percent"), // percent | fixed
  value: numeric("value", { precision: 18, scale: 4 }).notNull().default("0"),
  scope: text("scope").notNull().default("line"), // line | order
  reasonCode: text("reason_code").notNull(),
  accountSystemKey: text("account_system_key").notNull().default("sales_discount"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// =====================================================================
// Commission plans
// =====================================================================
export const commissionPlansTable = pgTable("commission_plans", {
  id: serial("id").primaryKey(),
  /** Legacy NULL ownership is unproven; never infer a company from the caller. */
  companyId: integer("company_id").references(() => companiesTable.id),
  name: text("name").notNull(),
  // Percent of net revenue per period
  rate: numeric("rate", { precision: 5, scale: 2 }).notNull().default("0"),
  // Quota per period (revenue) above which a bonus rate applies
  quota: numeric("quota", { precision: 18, scale: 2 }).notNull().default("0"),
  bonusRate: numeric("bonus_rate", { precision: 5, scale: 2 })
    .notNull()
    .default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Assign a plan to a sales rep (user)
export const salesRepAssignmentsTable = pgTable("sales_rep_assignments", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  planId: integer("plan_id")
    .notNull()
    .references(() => commissionPlansTable.id),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// =====================================================================
// Quotations
// =====================================================================
export const QUOTATION_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
] as const;

export const quotationsTable = pgTable("quotations", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  reference: text("reference").notNull().unique(),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customersTable.id),
  customerName: text("customer_name").notNull(),
  pricelistId: integer("pricelist_id").references(() => pricelistsTable.id),
  salesRepId: integer("sales_rep_id").references(() => usersTable.id),
  branchId: integer("branch_id").references(() => branchesTable.id),
  status: text("status").notNull().default("draft"),
  quoteDate: date("quote_date").notNull(),
  validUntil: date("valid_until"),
  currencyCode: text("currency_code").notNull().default("SAR"),
  subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 18, scale: 2 }).notNull().default("0"),
  vat: numeric("vat", { precision: 18, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 18, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  sentAt: timestamp("sent_at"),
  acceptedAt: timestamp("accepted_at"),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  // Snapshot of the discount-rule engine output at quote time:
  // [{ id, name, reasonCode, accountSystemKey, amount, scope }]
  // Persisted so the same reason-code → GL bucket mapping flows through to
  // the SO and the SO-derived invoice without re-running rules (which would
  // double-apply line scope and re-stack any current order promo).
  appliedDiscounts: jsonb("applied_discounts"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const quotationLinesTable = pgTable("quotation_lines", {
  id: serial("id").primaryKey(),
  quotationId: integer("quotation_id")
    .notNull()
    .references(() => quotationsTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull(),
  discountPct: numeric("discount_pct", { precision: 5, scale: 2 })
    .notNull()
    .default("0"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("15"),
  lineTotal: numeric("line_total", { precision: 18, scale: 2 }).notNull(),
});

// =====================================================================
// Sales orders
// =====================================================================
export const SO_STATUSES = [
  "draft",
  "confirmed",
  "partially_delivered",
  "fully_delivered",
  "invoiced",
  "done",
  "cancelled",
] as const;

export const salesOrdersTable = pgTable("sales_orders", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  reference: text("reference").notNull().unique(),
  quotationId: integer("quotation_id").references(() => quotationsTable.id),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customersTable.id),
  customerName: text("customer_name").notNull(),
  pricelistId: integer("pricelist_id").references(() => pricelistsTable.id),
  salesRepId: integer("sales_rep_id").references(() => usersTable.id),
  branchId: integer("branch_id").references(() => branchesTable.id),
  warehouseId: integer("warehouse_id").references(() => warehousesTable.id),
  status: text("status").notNull().default("draft"),
  orderDate: date("order_date").notNull(),
  expectedDate: date("expected_date"),
  currencyCode: text("currency_code").notNull().default("SAR"),
  subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull().default("0"),
  discount: numeric("discount", { precision: 18, scale: 2 }).notNull().default("0"),
  vat: numeric("vat", { precision: 18, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 18, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  source: text("source").notNull().default("manual"), // manual | quote | pos | portal
  // See quotationsTable.appliedDiscounts. Carried over (or re-computed at
  // SO-creation time when no quote exists) and consumed by the invoice JE
  // so per-rule discount accounts survive the Quote→SO→Invoice lifecycle.
  appliedDiscounts: jsonb("applied_discounts"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const salesOrderLinesTable = pgTable("sales_order_lines", {
  id: serial("id").primaryKey(),
  soId: integer("so_id")
    .notNull()
    .references(() => salesOrdersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  deliveredQty: numeric("delivered_qty", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  invoicedQty: numeric("invoiced_qty", { precision: 18, scale: 4 })
    .notNull()
    .default("0"),
  unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull(),
  discountPct: numeric("discount_pct", { precision: 5, scale: 2 })
    .notNull()
    .default("0"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("15"),
  lineTotal: numeric("line_total", { precision: 18, scale: 2 }).notNull(),
});

// =====================================================================
// Delivery orders
// =====================================================================
export const DO_STATUSES = [
  "draft",
  "ready",
  "delivered",
  "cancelled",
] as const;

export const deliveryOrdersTable = pgTable("delivery_orders", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  reference: text("reference").notNull().unique(),
  soId: integer("so_id")
    .notNull()
    .references(() => salesOrdersTable.id),
  warehouseId: integer("warehouse_id")
    .notNull()
    .references(() => warehousesTable.id),
  status: text("status").notNull().default("draft"),
  deliveryDate: date("delivery_date").notNull(),
  notes: text("notes"),
  // Optional carrier selection — when set on creation we auto-call
  // the carrier adapter to create an AWB and link the resulting
  // shipment back via shipmentId.
  carrierId: integer("carrier_id"),
  shipmentId: integer("shipment_id"),
  createdBy: integer("created_by").references(() => usersTable.id),
  deliveredAt: timestamp("delivered_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const deliveryOrderLinesTable = pgTable("delivery_order_lines", {
  id: serial("id").primaryKey(),
  doId: integer("do_id")
    .notNull()
    .references(() => deliveryOrdersTable.id, { onDelete: "cascade" }),
  soLineId: integer("so_line_id")
    .notNull()
    .references(() => salesOrderLinesTable.id),
  productId: integer("product_id").references(() => productsTable.id),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
});

// =====================================================================
// Customer invoices (AR)
// =====================================================================
export const CUSTOMER_INVOICE_STATUSES = [
  "draft",
  "open",
  "partially_paid",
  "paid",
  "cancelled",
] as const;

export const customerInvoicesTable = pgTable(
  "customer_invoices",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "restrict" }),
    reference: text("reference").notNull().unique(),
    soId: integer("so_id").references(() => salesOrdersTable.id),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id),
    customerName: text("customer_name").notNull(),
    branchId: integer("branch_id").references(() => branchesTable.id),
    salesRepId: integer("sales_rep_id").references(() => usersTable.id),
    status: text("status").notNull().default("draft"),
    invoiceDate: date("invoice_date").notNull(),
    dueDate: date("due_date"),
    currencyCode: text("currency_code").notNull().default("SAR"),
    subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull().default("0"),
    discount: numeric("discount", { precision: 18, scale: 2 }).notNull().default("0"),
    vat: numeric("vat", { precision: 18, scale: 2 }).notNull().default("0"),
    total: numeric("total", { precision: 18, scale: 2 }).notNull().default("0"),
    amountPaid: numeric("amount_paid", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    notes: text("notes"),
    // ZATCA QR cache (TLV-base64). Generated on demand.
    zatcaQr: text("zatca_qr"),
    source: text("source").notNull().default("manual"), // manual | so | pos
    sourceRef: text("source_ref"),
    // Per-rule discount breakdown actually posted to the GL on this invoice
    // (after proportional scaling for partial invoicing of an SO). Mirrors
    // the JE: sum(amount) <= invoice.discount; remainder goes to sales_discount.
    appliedDiscounts: jsonb("applied_discounts"),
    // Audit lock — see invoicesTable for the same pattern. Set true at
    // creation (issuance) since the customer invoice posts its journal
    // entry inside the same transaction and therefore is immediately
    // finalised. Reversal is the only legal way to neutralise it.
    isLocked: boolean("is_locked").notNull().default(false),
    lockedAt: timestamp("locked_at"),
    reversesId: integer("reverses_id"),
    reversedById: integer("reversed_by_id"),
    reversedReason: text("reversed_reason"),
    // Audit fields for emailing the customer the branded invoice PDF
    // (mirrors `sent_to_supplier_*` on purchase_orders).
    sentToCustomerAt: timestamp("sent_to_customer_at"),
    sentToCustomerEmail: text("sent_to_customer_email"),
    /** Multi-Company Phase 5: true when auto-generated as a mirror in this company (loop guard). */
    isIntercompany: boolean("is_intercompany").notNull().default(false),
    /** Multi-Company Phase 5: id of the counterparty company in the intercompany pair. */
    counterpartyCompanyId: integer("counterparty_company_id"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    custIdx: index("customer_invoices_customer_idx").on(t.customerId),
    statusIdx: index("customer_invoices_status_idx").on(t.status),
    dueIdx: index("customer_invoices_due_idx").on(t.dueDate),
    reversesIdx: index("customer_invoices_reverses_idx").on(t.reversesId),
  }),
);

export const customerInvoiceLinesTable = pgTable("customer_invoice_lines", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => customerInvoicesTable.id, { onDelete: "cascade" }),
  soLineId: integer("so_line_id").references(() => salesOrderLinesTable.id),
  productId: integer("product_id").references(() => productsTable.id),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull(),
  discountPct: numeric("discount_pct", { precision: 5, scale: 2 })
    .notNull()
    .default("0"),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("15"),
  lineTotal: numeric("line_total", { precision: 18, scale: 2 }).notNull(),
});

// =====================================================================
// Customer receipts (incoming payments)
// =====================================================================
export const customerReceiptsTable = pgTable("customer_receipts", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customersTable.id),
  customerName: text("customer_name").notNull(),
  receiptDate: date("receipt_date").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currencyCode: text("currency_code").notNull().default("SAR"),
  paymentMethod: text("payment_method").notNull().default("cash"), // cash | bank | card | transfer | stc
  bankRef: text("bank_ref"),
  journalEntryId: integer("journal_entry_id"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const customerReceiptAllocationsTable = pgTable(
  "customer_receipt_allocations",
  {
    id: serial("id").primaryKey(),
    receiptId: integer("receipt_id")
      .notNull()
      .references(() => customerReceiptsTable.id, { onDelete: "cascade" }),
    invoiceId: integer("invoice_id")
      .notNull()
      .references(() => customerInvoicesTable.id),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  },
  (t) => ({
    receiptIdx: index("cra_receipt_idx").on(t.receiptId),
    invoiceIdx: index("cra_invoice_idx").on(t.invoiceId),
  }),
);

// =====================================================================
// Credit notes (customer returns / refunds)
// =====================================================================
export const CREDIT_NOTE_STATUSES = [
  "draft",
  "issued",
  "applied",
  "cancelled",
] as const;

export const creditNotesTable = pgTable("credit_notes", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  reference: text("reference").notNull().unique(),
  invoiceId: integer("invoice_id").references(() => customerInvoicesTable.id),
  customerId: integer("customer_id")
    .notNull()
    .references(() => customersTable.id),
  customerName: text("customer_name").notNull(),
  noteDate: date("note_date").notNull(),
  reason: text("reason"),
  restock: boolean("restock").notNull().default(true),
  // Nullable for legacy notes: never infer their historical rounding allocation.
  inventoryCost: numeric("inventory_cost", { precision: 18, scale: 2 }),
  // Only the rounding carry, excluding economic COGS from replacement stock.
  cancellationRounding: numeric("cancellation_rounding", { precision: 18, scale: 2 }),
  warehouseId: integer("warehouse_id").references(() => warehousesTable.id),
  currencyCode: text("currency_code").notNull().default("SAR"),
  subtotal: numeric("subtotal", { precision: 18, scale: 2 }).notNull().default("0"),
  vat: numeric("vat", { precision: 18, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 18, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("draft"),
  journalEntryId: integer("journal_entry_id"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const creditNoteLinesTable = pgTable("credit_note_lines", {
  id: serial("id").primaryKey(),
  noteId: integer("note_id")
    .notNull()
    .references(() => creditNotesTable.id, { onDelete: "cascade" }),
  invoiceLineId: integer("invoice_line_id").references(
    () => customerInvoiceLinesTable.id,
  ),
  productId: integer("product_id").references(() => productsTable.id),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull(),
  taxRate: numeric("tax_rate", { precision: 5, scale: 2 }).notNull().default("15"),
  lineTotal: numeric("line_total", { precision: 18, scale: 2 }).notNull(),
});

// =====================================================================
// CRM — Opportunities
// =====================================================================
export const opportunityStagesTable = pgTable("opportunity_stages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  sequence: integer("sequence").notNull().default(0),
  // Probability hint used in expected-revenue calculations (0..100)
  probability: integer("probability").notNull().default(0),
  isWon: boolean("is_won").notNull().default(false),
  isLost: boolean("is_lost").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
});

export const opportunitiesTable = pgTable(
  "opportunities",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    customerId: integer("customer_id").references(() => customersTable.id),
    customerName: text("customer_name"),
    leadId: integer("lead_id"),
    salesRepId: integer("sales_rep_id").references(() => usersTable.id),
    stageId: integer("stage_id")
      .notNull()
      .references(() => opportunityStagesTable.id),
    expectedRevenue: numeric("expected_revenue", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    probability: integer("probability").notNull().default(0),
    expectedCloseDate: date("expected_close_date"),
    closedAt: timestamp("closed_at"),
    winLossReason: text("win_loss_reason"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    stageIdx: index("opportunities_stage_idx").on(t.stageId),
    repIdx: index("opportunities_rep_idx").on(t.salesRepId),
  }),
);

// Types
export type Pricelist = typeof pricelistsTable.$inferSelect;
export type PricelistItem = typeof pricelistItemsTable.$inferSelect;
export type DiscountRule = typeof discountRulesTable.$inferSelect;
export type CommissionPlan = typeof commissionPlansTable.$inferSelect;
export type Quotation = typeof quotationsTable.$inferSelect;
export type QuotationLine = typeof quotationLinesTable.$inferSelect;
export type SalesOrder = typeof salesOrdersTable.$inferSelect;
export type SalesOrderLine = typeof salesOrderLinesTable.$inferSelect;
export type DeliveryOrder = typeof deliveryOrdersTable.$inferSelect;
export type DeliveryOrderLine = typeof deliveryOrderLinesTable.$inferSelect;
export type CustomerInvoice = typeof customerInvoicesTable.$inferSelect;
export type CustomerInvoiceLine = typeof customerInvoiceLinesTable.$inferSelect;
export type CustomerReceipt = typeof customerReceiptsTable.$inferSelect;
export type CreditNote = typeof creditNotesTable.$inferSelect;
export type Opportunity = typeof opportunitiesTable.$inferSelect;
export type OpportunityStage = typeof opportunityStagesTable.$inferSelect;
