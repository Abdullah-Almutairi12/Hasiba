import { pgTable, serial, text, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";

export const anomalyRulesTable = pgTable("anomaly_rules", {
  id: serial("id").primaryKey(),
  ruleKey: text("rule_key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  eventType: text("event_type").notNull(),
  windowMinutes: integer("window_minutes").notNull().default(60),
  threshold: integer("threshold").notNull().default(3),
  severity: text("severity").notNull().default("medium"),
  isEnabled: boolean("is_enabled").notNull().default(true),
  config: jsonb("config"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AnomalyRule = typeof anomalyRulesTable.$inferSelect;

export const anomalySignalsTable = pgTable("anomaly_signals", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  actorId: integer("actor_id"),
  actorName: text("actor_name"),
  refTable: text("ref_table"),
  refId: integer("ref_id"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AnomalySignal = typeof anomalySignalsTable.$inferSelect;

export const anomalyEventsTable = pgTable("anomaly_events", {
  id: serial("id").primaryKey(),
  ruleKey: text("rule_key").notNull(),
  ruleName: text("rule_name").notNull(),
  actorId: integer("actor_id"),
  actorName: text("actor_name"),
  refTable: text("ref_table"),
  refId: integer("ref_id"),
  payload: jsonb("payload"),
  severity: text("severity").notNull().default("medium"),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedByUserId: integer("acknowledged_by_user_id"),
  acknowledgedByName: text("acknowledged_by_name"),
});

export type AnomalyEvent = typeof anomalyEventsTable.$inferSelect;
