import { integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

// Committed atomically with the financial transaction, never before/after it.
export const financialRequestsTable = pgTable("financial_requests", {
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  userId: integer("user_id").notNull(),
  operation: text("operation").notNull(),
  requestKey: text("request_key").notNull(),
  requestHash: text("request_hash").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.companyId, t.userId, t.operation, t.requestKey] })]);
