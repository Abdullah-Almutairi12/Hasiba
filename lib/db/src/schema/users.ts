import { pgTable, serial, text, boolean, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  phone: text("phone"),
  role: text("role").notNull(),
  branchId: integer("branch_id"),
  preferredBranchId: integer("preferred_branch_id"),
  isActive: boolean("is_active").notNull().default(true),
  has2fa: boolean("has_2fa").notNull().default(false),
  avatarUrl: text("avatar_url"),
  lastLoginAt: timestamp("last_login_at"),
  lastCleanupReportTestEmail: text("last_cleanup_report_test_email"),
  // Task #198: per-admin remembered UI preferences for the admin panel
  // (selected tab, cleanup runs date filter, etc.). Stored as an opaque
  // JSON bag so we can extend it without further migrations. Keys are
  // validated by the route's Zod schema, not at the DB layer.
  adminPrefs: jsonb("admin_prefs").$type<AdminPrefs>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type AdminPrefs = {
  lastAdminTab?: string | null;
  cleanupRunsFrom?: string | null;
  cleanupRunsTo?: string | null;
};

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, lastLoginAt: true, passwordHash: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
