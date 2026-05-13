import { pgTable, serial, text, integer, jsonb, timestamp, boolean, numeric } from "drizzle-orm/pg-core";

export const reportDefinitionsTable = pgTable("report_definitions", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  dataSource: text("data_source").notNull(),
  config: jsonb("config").notNull().default({}),
  chartType: text("chart_type").notNull().default("table"),
  ownerUserId: integer("owner_user_id").notNull(),
  sharedWithRole: text("shared_with_role"),
  tags: jsonb("tags").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type ReportDefinition = typeof reportDefinitionsTable.$inferSelect;

export const reportSubscriptionsTable = pgTable("report_subscriptions", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id").notNull(),
  ownerUserId: integer("owner_user_id").notNull(),
  recipients: jsonb("recipients").notNull().default([]),
  cadence: text("cadence").notNull().default("weekly"),
  format: text("format").notNull().default("xlsx"),
  isActive: boolean("is_active").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type ReportSubscription = typeof reportSubscriptionsTable.$inferSelect;

export const dashboardsTable = pgTable("dashboards", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: integer("owner_user_id").notNull(),
  isHome: boolean("is_home").notNull().default(false),
  layout: jsonb("layout").notNull().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Dashboard = typeof dashboardsTable.$inferSelect;

export const dashboardWidgetsTable = pgTable("dashboard_widgets", {
  id: serial("id").primaryKey(),
  dashboardId: integer("dashboard_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  config: jsonb("config").notNull().default({}),
  position: integer("position").notNull().default(0),
  width: integer("width").notNull().default(4),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type DashboardWidget = typeof dashboardWidgetsTable.$inferSelect;

export const kpiAlertsTable = pgTable("kpi_alerts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: integer("owner_user_id").notNull(),
  reportId: integer("report_id"),
  metricColumn: text("metric_column").notNull(),
  operator: text("operator").notNull(),
  threshold: numeric("threshold", { precision: 18, scale: 4 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  lastEvaluatedAt: timestamp("last_evaluated_at"),
  lastValue: numeric("last_value", { precision: 18, scale: 4 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type KpiAlert = typeof kpiAlertsTable.$inferSelect;

export const kpiAlertHistoryTable = pgTable("kpi_alert_history", {
  id: serial("id").primaryKey(),
  alertId: integer("alert_id").notNull(),
  triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
  observedValue: numeric("observed_value", { precision: 18, scale: 4 }).notNull(),
  threshold: numeric("threshold", { precision: 18, scale: 4 }).notNull(),
  message: text("message").notNull(),
});

export type KpiAlertHistory = typeof kpiAlertHistoryTable.$inferSelect;
