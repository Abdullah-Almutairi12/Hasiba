import { pgTable, serial, jsonb, timestamp } from "drizzle-orm/pg-core";

// Singleton row (id = 1) holding the entire system-wide configuration
// surfaced in the /settings page. We keep each tab's payload in its own
// jsonb column so the API can patch one section without touching others
// and so we don't have to migrate the schema every time we add a field.
export const appSettingsTable = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  company: jsonb("company").notNull().default({}),
  tax: jsonb("tax").notNull().default({}),
  branches: jsonb("branches").notNull().default({}),
  pos: jsonb("pos").notNull().default({}),
  permissions: jsonb("permissions").notNull().default({}),
  accounting: jsonb("accounting").notNull().default({}),
  integrations: jsonb("integrations").notNull().default({}),
  // Phase: full settings surface for subscribers. Each section is a free
  // jsonb bag; shape is enforced by the API layer + UI, never by SQL.
  notifications: jsonb("notifications").notNull().default({}),
  localization: jsonb("localization").notNull().default({}),
  numbering: jsonb("numbering").notNull().default({}),
  appearance: jsonb("appearance").notNull().default({}),
  backup: jsonb("backup").notNull().default({}),
  templates: jsonb("templates").notNull().default({}),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AppSettings = typeof appSettingsTable.$inferSelect;
