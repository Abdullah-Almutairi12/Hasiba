import { pgTable, serial, text, integer, numeric, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const departmentsTable = pgTable("departments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code"),
  managerId: integer("manager_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const employeesTable = pgTable("employees", {
  id: serial("id").primaryKey(),
  fullName: text("full_name").notNull(),
  jobTitle: text("job_title").notNull(),
  email: text("email"),
  phone: text("phone"),
  nationalId: text("national_id"),
  departmentId: integer("department_id"),
  branchId: integer("branch_id"),
  managerId: integer("manager_id"),
  // monthly base salary in SAR
  baseSalary: numeric("base_salary", { precision: 10, scale: 2 }).notNull().default("0"),
  housingAllowance: numeric("housing_allowance", { precision: 10, scale: 2 }).notNull().default("0"),
  transportAllowance: numeric("transport_allowance", { precision: 10, scale: 2 }).notNull().default("0"),
  hireDate: date("hire_date"),
  status: text("status").notNull().default("active"), // active | on_leave | terminated
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const attendanceTable = pgTable("attendance", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  workDate: date("work_date").notNull(),
  checkIn: timestamp("check_in"),
  checkOut: timestamp("check_out"),
  // present | absent | late | leave
  status: text("status").notNull().default("present"),
  hoursWorked: numeric("hours_worked", { precision: 5, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const payrollTable = pgTable("payroll", {
  id: serial("id").primaryKey(),
  employeeId: integer("employee_id").notNull(),
  // YYYY-MM
  period: text("period").notNull(),
  baseSalary: numeric("base_salary", { precision: 10, scale: 2 }).notNull().default("0"),
  allowances: numeric("allowances", { precision: 10, scale: 2 }).notNull().default("0"),
  deductions: numeric("deductions", { precision: 10, scale: 2 }).notNull().default("0"),
  bonus: numeric("bonus", { precision: 10, scale: 2 }).notNull().default("0"),
  netPay: numeric("net_pay", { precision: 10, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("pending"), // pending | paid
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDepartmentSchema = createInsertSchema(departmentsTable).omit({ id: true, createdAt: true });
export type InsertDepartment = z.infer<typeof insertDepartmentSchema>;
export type Department = typeof departmentsTable.$inferSelect;

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({ id: true, createdAt: true });
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employeesTable.$inferSelect;

export const insertAttendanceSchema = createInsertSchema(attendanceTable).omit({ id: true, createdAt: true });
export type InsertAttendance = z.infer<typeof insertAttendanceSchema>;
export type Attendance = typeof attendanceTable.$inferSelect;

export const insertPayrollSchema = createInsertSchema(payrollTable).omit({ id: true, createdAt: true });
export type InsertPayroll = z.infer<typeof insertPayrollSchema>;
export type Payroll = typeof payrollTable.$inferSelect;
