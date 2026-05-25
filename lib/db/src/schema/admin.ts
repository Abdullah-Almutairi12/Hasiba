import { pgTable, serial, text, timestamp, boolean, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const supportTicketsTable = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("medium"),
  category: text("category").notNull().default("general"),
  reply: text("reply"),
  assignedToUserId: integer("assigned_to_user_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export const insertSupportTicketSchema = createInsertSchema(supportTicketsTable).omit({
  id: true,
  createdAt: true,
  resolvedAt: true,
  reply: true,
  assignedToUserId: true,
});
export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTicketsTable.$inferSelect;

export const announcementsTable = pgTable("announcements", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("info"),
  isActive: boolean("is_active").notNull().default(true),
  publishedAt: timestamp("published_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  createdByUserId: integer("created_by_user_id"),
});

export type Announcement = typeof announcementsTable.$inferSelect;

export const featureFlagsTable = pgTable("feature_flags", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  isEnabled: boolean("is_enabled").notNull().default(false),
  category: text("category").notNull().default("general"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type FeatureFlag = typeof featureFlagsTable.$inferSelect;

// Per-(role, navKey) UI override matrix. Default visibility is defined
// statically in `artifacts/erp-system/src/hooks/use-permissions.ts`; rows
// here let the system manager flip a specific role × module cell ON or OFF.
// Server-side guards remain authoritative for write actions — this matrix
// only governs which nav entries and read pages each role can see.
export const permissionOverridesTable = pgTable(
  "permission_overrides",
  {
    id: serial("id").primaryKey(),
    role: text("role").notNull(),
    permissionKey: text("permission_key").notNull(),
    enabled: boolean("enabled").notNull(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("permission_overrides_role_key_unique").on(t.role, t.permissionKey),
  ],
);

export type PermissionOverride = typeof permissionOverridesTable.$inferSelect;

// Singleton (id = 1) row holding the company-wide letterhead, contact,
// bank and PO-terms fields rendered on the PDF header/footer. Managers
// edit this from the admin "بيانات الشركة" tab; PDF generators read it
// with a fallback to the legacy COMPANY_* environment variables.
export const companySettingsTable = pgTable("company_settings", {
  id: serial("id").primaryKey(),
  nameEn: text("name_en"),
  nameAr: text("name_ar"),
  vatNumber: text("vat_number"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  logoObjectKey: text("logo_object_key"),
  bankName: text("bank_name"),
  bankIban: text("bank_iban"),
  termsEn: text("terms_en"),
  termsAr: text("terms_ar"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type CompanySettings = typeof companySettingsTable.$inferSelect;

// Task #162 — append-only audit log of the nightly alerts retention
// sweep (task #158). Each row records when the cron ran, how many
// rows it deleted and the retention window that was in effect at the
// time. The Admin Panel renders the latest row so managers have
// visibility that the self-maintenance is actually running.
export const alertsCleanupRunsTable = pgTable("alerts_cleanup_runs", {
  id: serial("id").primaryKey(),
  ranAt: timestamp("ran_at").notNull().defaultNow(),
  rowsDeleted: integer("rows_deleted").notNull().default(0),
  retentionDays: integer("retention_days").notNull(),
});

export type AlertsCleanupRun = typeof alertsCleanupRunsTable.$inferSelect;
