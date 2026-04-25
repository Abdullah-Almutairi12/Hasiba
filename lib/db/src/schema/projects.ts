import { pgTable, serial, text, integer, numeric, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const projectsTable = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code"),
  customerId: integer("customer_id"),
  managerId: integer("manager_id"),
  // planning | active | on_hold | completed | cancelled
  status: text("status").notNull().default("planning"),
  priority: text("priority").notNull().default("medium"), // low | medium | high | urgent
  budget: numeric("budget", { precision: 12, scale: 2 }).notNull().default("0"),
  spent: numeric("spent", { precision: 12, scale: 2 }).notNull().default("0"),
  progress: integer("progress").notNull().default(0), // 0–100
  startDate: date("start_date"),
  dueDate: date("due_date"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const projectTasksTable = pgTable("project_tasks", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  assigneeId: integer("assignee_id"),
  // todo | in_progress | review | done
  status: text("status").notNull().default("todo"),
  priority: text("priority").notNull().default("medium"),
  dueDate: date("due_date"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProjectSchema = createInsertSchema(projectsTable).omit({ id: true, createdAt: true });
export type InsertProject = z.infer<typeof insertProjectSchema>;
export type Project = typeof projectsTable.$inferSelect;

export const insertProjectTaskSchema = createInsertSchema(projectTasksTable).omit({ id: true, createdAt: true });
export type InsertProjectTask = z.infer<typeof insertProjectTaskSchema>;
export type ProjectTask = typeof projectTasksTable.$inferSelect;
