import {
  pgTable,
  serial,
  text,
  numeric,
  boolean,
  timestamp,
  integer,
  date,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { companiesTable } from "./companies";

// ===== Currencies =====

export const currenciesTable = pgTable("currencies", {
  code: text("code").primaryKey(), // ISO-4217: SAR, USD, EUR
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  symbol: text("symbol").notNull(),
  decimals: integer("decimals").notNull().default(2),
  isBase: boolean("is_base").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const exchangeRatesTable = pgTable(
  "exchange_rates",
  {
    id: serial("id").primaryKey(),
    fromCurrency: text("from_currency")
      .notNull()
      .references(() => currenciesTable.code),
    toCurrency: text("to_currency")
      .notNull()
      .references(() => currenciesTable.code),
    rate: numeric("rate", { precision: 18, scale: 8 }).notNull(),
    rateDate: date("rate_date").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("exchange_rates_unique").on(
      t.fromCurrency,
      t.toCurrency,
      t.rateDate,
    ),
  }),
);

// ===== Chart of Accounts =====

export const ACCOUNT_TYPES = [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const accountsTable = pgTable(
  "accounts",
  {
    id: serial("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    nameAr: text("name_ar").notNull(),
    type: text("type").notNull(), // AccountType
    parentId: integer("parent_id"),
    isGroup: boolean("is_group").notNull().default(false),
    currencyCode: text("currency_code")
      .notNull()
      .default("SAR")
      .references(() => currenciesTable.code),
    isActive: boolean("is_active").notNull().default(true),
    description: text("description"),
    systemKey: text("system_key").unique(), // for hard-coded lookups, e.g. "cash", "ap", "vat_input"
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    parentIdx: index("accounts_parent_idx").on(t.parentId),
    typeIdx: index("accounts_type_idx").on(t.type),
  }),
);

// ===== Fiscal Year & Periods =====

export const fiscalYearsTable = pgTable("fiscal_years", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(), // "2026"
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  status: text("status").notNull().default("open"), // open / closed
  closedAt: timestamp("closed_at"),
  closedBy: integer("closed_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  companyName: uniqueIndex("fiscal_years_company_name").on(t.companyId, t.name),
}));

export const fiscalPeriodsTable = pgTable(
  "fiscal_periods",
  {
    id: serial("id").primaryKey(),
    fiscalYearId: integer("fiscal_year_id")
      .notNull()
      .references(() => fiscalYearsTable.id, { onDelete: "cascade" }),
    // Stable machine code per period (e.g. "2026-M01", "2026-Y"). Used by
    // reports and external callers that can't rely on auto-increment ids.
    code: text("code"),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: text("status").notNull().default("open"), // open / closed / locked
    closedAt: timestamp("closed_at"),
    closedBy: integer("closed_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    yearIdx: index("fiscal_periods_year_idx").on(t.fiscalYearId),
  }),
);

// ===== Journal Entries =====

export const JOURNAL_STATUSES = ["draft", "posted", "reversed"] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export const JOURNAL_SOURCES = [
  "manual",
  "pos",
  "supplier_invoice",
  "payment",
  "bank",
  "system",
  "fx_revaluation",
  "period_close",
] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];

export const journalEntriesTable = pgTable(
  "journal_entries",
  {
    id: serial("id").primaryKey(),
    entryNumber: text("entry_number").notNull().unique(),
    entryDate: date("entry_date").notNull(),
    periodId: integer("period_id").references(() => fiscalPeriodsTable.id),
    description: text("description").notNull(),
    reference: text("reference"),
    currencyCode: text("currency_code")
      .notNull()
      .default("SAR")
      .references(() => currenciesTable.code),
    exchangeRate: numeric("exchange_rate", {
      precision: 18,
      scale: 8,
    })
      .notNull()
      .default("1"),
    status: text("status").notNull().default("draft"),
    source: text("source").notNull().default("manual"),
    sourceRef: text("source_ref"),
    createdBy: integer("created_by").references(() => usersTable.id),
    postedBy: integer("posted_by").references(() => usersTable.id),
    postedAt: timestamp("posted_at"),
    reversedBy: integer("reversed_by").references(() => usersTable.id),
    reversedAt: timestamp("reversed_at"),
    reversalOf: integer("reversal_of"),
    /** Tenant scope (Phase 2): NOT NULL with restrict to prevent silent orphans. */
    companyId: integer("company_id").notNull().references(() => companiesTable.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    dateIdx: index("journal_entries_date_idx").on(t.entryDate),
    statusIdx: index("journal_entries_status_idx").on(t.status),
    periodIdx: index("journal_entries_period_idx").on(t.periodId),
    sourceIdx: index("journal_entries_source_idx").on(t.source, t.sourceRef),
  }),
);

export const journalEntryLinesTable = pgTable(
  "journal_entry_lines",
  {
    id: serial("id").primaryKey(),
    entryId: integer("entry_id")
      .notNull()
      .references(() => journalEntriesTable.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accountsTable.id),
    description: text("description"),
    debit: numeric("debit", { precision: 18, scale: 2 }).notNull().default("0"),
    credit: numeric("credit", { precision: 18, scale: 2 }).notNull().default("0"),
    baseDebit: numeric("base_debit", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
    baseCredit: numeric("base_credit", { precision: 18, scale: 2 })
      .notNull()
      .default("0"),
  },
  (t) => ({
    entryIdx: index("jel_entry_idx").on(t.entryId),
    accountIdx: index("jel_account_idx").on(t.accountId),
  }),
);

// ===== Bank Accounts & Reconciliation =====

export const bankAccountsTable = pgTable("bank_accounts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  bankName: text("bank_name").notNull(),
  accountNumber: text("account_number").notNull(),
  iban: text("iban"),
  currencyCode: text("currency_code")
    .notNull()
    .default("SAR")
    .references(() => currenciesTable.code),
  glAccountId: integer("gl_account_id")
    .notNull()
    .references(() => accountsTable.id),
  openingBalance: numeric("opening_balance", { precision: 18, scale: 2 })
    .notNull()
    .default("0"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const bankStatementsTable = pgTable("bank_statements", {
  id: serial("id").primaryKey(),
  bankAccountId: integer("bank_account_id")
    .notNull()
    .references(() => bankAccountsTable.id, { onDelete: "cascade" }),
  statementDate: date("statement_date").notNull(),
  startingBalance: numeric("starting_balance", { precision: 18, scale: 2 })
    .notNull(),
  endingBalance: numeric("ending_balance", { precision: 18, scale: 2 })
    .notNull(),
  fileName: text("file_name"),
  importedBy: integer("imported_by").references(() => usersTable.id),
  importedAt: timestamp("imported_at").notNull().defaultNow(),
});

export const bankStatementLinesTable = pgTable(
  "bank_statement_lines",
  {
    id: serial("id").primaryKey(),
    statementId: integer("statement_id")
      .notNull()
      .references(() => bankStatementsTable.id, { onDelete: "cascade" }),
    txDate: date("tx_date").notNull(),
    description: text("description").notNull(),
    reference: text("reference"),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(), // signed
    matchedLineId: integer("matched_line_id").references(
      () => journalEntryLinesTable.id,
    ),
    reconciledAt: timestamp("reconciled_at"),
    reconciledBy: integer("reconciled_by").references(() => usersTable.id),
  },
  (t) => ({
    stmtIdx: index("bsl_stmt_idx").on(t.statementId),
  }),
);

// ===== Zod schemas =====

export const insertAccountSchema = createInsertSchema(accountsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accountsTable.$inferSelect;

export const insertJournalEntrySchema = createInsertSchema(
  journalEntriesTable,
).omit({
  id: true,
  createdAt: true,
  postedAt: true,
  postedBy: true,
  reversedAt: true,
  reversedBy: true,
  reversalOf: true,
});
export type InsertJournalEntry = z.infer<typeof insertJournalEntrySchema>;
export type JournalEntry = typeof journalEntriesTable.$inferSelect;
export type JournalEntryLine = typeof journalEntryLinesTable.$inferSelect;

export type Currency = typeof currenciesTable.$inferSelect;
export type ExchangeRate = typeof exchangeRatesTable.$inferSelect;
export type FiscalYear = typeof fiscalYearsTable.$inferSelect;
export type FiscalPeriod = typeof fiscalPeriodsTable.$inferSelect;
export type BankAccount = typeof bankAccountsTable.$inferSelect;
export type BankStatement = typeof bankStatementsTable.$inferSelect;
export type BankStatementLine = typeof bankStatementLinesTable.$inferSelect;
