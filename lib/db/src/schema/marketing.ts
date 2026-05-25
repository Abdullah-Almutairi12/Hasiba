import { pgTable, serial, text, integer, numeric, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // email | social | sms | ads | event
  channel: text("channel").notNull().default("email"),
  // draft | scheduled | active | paused | completed
  status: text("status").notNull().default("draft"),
  budget: numeric("budget", { precision: 12, scale: 2 }).notNull().default("0"),
  spent: numeric("spent", { precision: 12, scale: 2 }).notNull().default("0"),
  reach: integer("reach").notNull().default(0),
  conversions: integer("conversions").notNull().default(0),
  startDate: date("start_date"),
  endDate: date("end_date"),
  description: text("description"),
  /** Tenant scope (Phase 2): NOT NULL with restrict to prevent silent orphans. */
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  company: text("company"),
  source: text("source").notNull().default("manual"), // manual | web | campaign | referral
  campaignId: integer("campaign_id"),
  ownerId: integer("owner_id"),
  // new | contacted | qualified | proposal | won | lost
  status: text("status").notNull().default("new"),
  estimatedValue: numeric("estimated_value", { precision: 12, scale: 2 }).notNull().default("0"),
  score: integer("score").notNull().default(0), // 0–100
  notes: text("notes"),
  /** Tenant scope (Phase 2): NOT NULL with restrict to prevent silent orphans. */
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({ id: true, createdAt: true });
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;

export const insertLeadSchema = createInsertSchema(leadsTable).omit({ id: true, createdAt: true });
export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leadsTable.$inferSelect;
