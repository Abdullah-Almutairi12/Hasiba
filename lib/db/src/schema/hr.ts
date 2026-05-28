import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { branchesTable } from "./branches";
import { usersTable } from "./users";
import { companiesTable } from "./companies";

// =========================================================================
// Departments / Positions
// =========================================================================
export const departmentsTable = pgTable("departments", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  parentId: integer("parent_id"),
  managerEmployeeId: integer("manager_employee_id"),
  branchId: integer("branch_id").references(() => branchesTable.id),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const positionsTable = pgTable("positions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  titleAr: text("title_ar").notNull(),
  departmentId: integer("department_id").references(() => departmentsTable.id),
  level: text("level"), // junior / mid / senior / lead / manager / director
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// =========================================================================
// Employees
// =========================================================================
export const employeesTable = pgTable(
  "employees",
  {
    id: serial("id").primaryKey(),
    employeeNo: text("employee_no").notNull().unique(),
    name: text("name").notNull(),
    nameAr: text("name_ar").notNull(),
    // saudi | iqama | gcc | contractor
    nationalityType: text("nationality_type").notNull().default("saudi"),
    nationality: text("nationality").notNull().default("SA"),
    nationalId: text("national_id"), // National ID or Iqama number
    iqamaExpiry: date("iqama_expiry"),
    passportNo: text("passport_no"),
    passportExpiry: date("passport_expiry"),
    dateOfBirth: date("date_of_birth"),
    gender: text("gender"), // male | female
    maritalStatus: text("marital_status"),
    email: text("email"),
    phone: text("phone"),
    address: text("address"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    photoUrl: text("photo_url"),
    branchId: integer("branch_id").references(() => branchesTable.id),
    departmentId: integer("department_id").references(() => departmentsTable.id),
    positionId: integer("position_id").references(() => positionsTable.id),
    managerEmployeeId: integer("manager_employee_id"),
    userId: integer("user_id").references(() => usersTable.id), // optional system login
    bankName: text("bank_name"),
    bankIban: text("bank_iban"),
    bankAccountNo: text("bank_account_no"),
    hireDate: date("hire_date").notNull(),
    terminationDate: date("termination_date"),
    // active | on_leave | suspended | terminated
    status: text("status").notNull().default("active"),
    notes: text("notes"),
    /** Tenant scope (Phase 2): NOT NULL with restrict to prevent silent orphans. */
    companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    branchIdx: index("employees_branch_idx").on(t.branchId),
    deptIdx: index("employees_dept_idx").on(t.departmentId),
    statusIdx: index("employees_status_idx").on(t.status),
  }),
);

export const employeeDocumentsTable = pgTable("employee_documents", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employeesTable.id, { onDelete: "cascade" }),
  // contract | iqama | passport | certificate | other
  docType: text("doc_type").notNull(),
  title: text("title").notNull(),
  fileUrl: text("file_url").notNull(),
  expiryDate: date("expiry_date"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

// =========================================================================
// Contracts
// =========================================================================
export const contractsTable = pgTable("contracts", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employeesTable.id, { onDelete: "cascade" }),
  // saudi | iqama | gcc | contractor
  contractType: text("contract_type").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"), // null = open-ended
  probationMonths: integer("probation_months").notNull().default(3),
  noticePeriodDays: integer("notice_period_days").notNull().default(30),
  basicSalary: numeric("basic_salary", { precision: 18, scale: 2 }).notNull(),
  housingAllowance: numeric("housing_allowance", { precision: 18, scale: 2 }).notNull().default("0"),
  transportAllowance: numeric("transport_allowance", { precision: 18, scale: 2 }).notNull().default("0"),
  otherAllowances: numeric("other_allowances", { precision: 18, scale: 2 }).notNull().default("0"),
  // Saudi GOSI categories: civil (مدني), military (عسكري) — keep simple `civil` default
  gosiCategory: text("gosi_category").notNull().default("civil"),
  gosiApplies: boolean("gosi_applies").notNull().default(true),
  workingHoursPerWeek: integer("working_hours_per_week").notNull().default(48),
  annualLeaveDays: integer("annual_leave_days").notNull().default(21),
  // active | terminated | expired
  status: text("status").notNull().default("active"),
  documentUrl: text("document_url"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Reusable salary components per contract (fixed allowances/deductions on top of base)
export const salaryComponentsTable = pgTable("salary_components", {
  id: serial("id").primaryKey(),
  contractId: integer("contract_id")
    .notNull()
    .references(() => contractsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  // earning | deduction
  kind: text("kind").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  // Whether this component counts toward the GOSI contribution base.
  includeInGosi: boolean("include_in_gosi").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
});

// =========================================================================
// Leaves
// =========================================================================
export const leaveTypesTable = pgTable("leave_types", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // annual | sick | unpaid | maternity | hajj | bereavement
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  defaultDaysPerYear: integer("default_days_per_year").notNull().default(0),
  isPaid: boolean("is_paid").notNull().default(true),
  // accrued | granted (granted = full annual entitlement at year start)
  accrualMode: text("accrual_mode").notNull().default("granted"),
  isActive: boolean("is_active").notNull().default(true),
});

export const leaveBalancesTable = pgTable(
  "leave_balances",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    leaveTypeId: integer("leave_type_id")
      .notNull()
      .references(() => leaveTypesTable.id),
    year: integer("year").notNull(),
    entitlement: numeric("entitlement", { precision: 8, scale: 2 }).notNull().default("0"),
    used: numeric("used", { precision: 8, scale: 2 }).notNull().default("0"),
    pending: numeric("pending", { precision: 8, scale: 2 }).notNull().default("0"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex("leave_balances_unique").on(t.employeeId, t.leaveTypeId, t.year),
  }),
);

export const leaveRequestsTable = pgTable("leave_requests", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  reference: text("reference").notNull().unique(),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employeesTable.id, { onDelete: "cascade" }),
  leaveTypeId: integer("leave_type_id")
    .notNull()
    .references(() => leaveTypesTable.id),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  days: numeric("days", { precision: 8, scale: 2 }).notNull(),
  reason: text("reason"),
  // pending | approved | rejected | cancelled
  status: text("status").notNull().default("pending"),
  approvedBy: integer("approved_by").references(() => usersTable.id),
  approvedAt: timestamp("approved_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// =========================================================================
// Attendance
// =========================================================================
export const shiftsTable = pgTable("shifts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  nameAr: text("name_ar").notNull(),
  startTime: text("start_time").notNull(), // "09:00"
  endTime: text("end_time").notNull(), // "17:00"
  breakMinutes: integer("break_minutes").notNull().default(60),
  workingDays: text("working_days").notNull().default("0,1,2,3,4"), // 0=Sun
  isActive: boolean("is_active").notNull().default(true),
});

export const employeeShiftsTable = pgTable("employee_shifts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employeesTable.id, { onDelete: "cascade" }),
  shiftId: integer("shift_id").notNull().references(() => shiftsTable.id),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
});

export const attendancePunchesTable = pgTable(
  "attendance_punches",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    punchAt: timestamp("punch_at").notNull(),
    // in | out
    direction: text("direction").notNull(),
    // manual | biometric | webhook
    source: text("source").notNull().default("manual"),
    deviceId: text("device_id"),
    notes: text("notes"),
    createdBy: integer("created_by").references(() => usersTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    empDateIdx: index("att_punches_emp_idx").on(t.employeeId, t.punchAt),
  }),
);

// =========================================================================
// GOSI configuration (rates kept configurable so legal changes can be applied
// without a code release).
// =========================================================================
export const gosiSettingsTable = pgTable("gosi_settings", {
  id: serial("id").primaryKey(),
  effectiveFrom: date("effective_from").notNull(),
  // Saudi employees
  saudiEmployeeRate: numeric("saudi_employee_rate", { precision: 5, scale: 2 }).notNull().default("9.75"),
  saudiEmployerRate: numeric("saudi_employer_rate", { precision: 5, scale: 2 }).notNull().default("11.75"),
  // Non-Saudi: occupational hazard only, employer-only
  nonSaudiEmployerRate: numeric("non_saudi_employer_rate", { precision: 5, scale: 2 }).notNull().default("2.00"),
  salaryCeiling: numeric("salary_ceiling", { precision: 18, scale: 2 }).notNull().default("45000"),
  isActive: boolean("is_active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// =========================================================================
// Loans / Advances
// =========================================================================
export const employeeLoansTable = pgTable("employee_loans", {
  id: serial("id").primaryKey(),
  reference: text("reference").notNull().unique(),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employeesTable.id, { onDelete: "cascade" }),
  // loan | advance
  kind: text("kind").notNull().default("loan"),
  principal: numeric("principal", { precision: 18, scale: 2 }).notNull(),
  monthlyInstallment: numeric("monthly_installment", { precision: 18, scale: 2 }).notNull(),
  outstanding: numeric("outstanding", { precision: 18, scale: 2 }).notNull(),
  startDate: date("start_date").notNull(),
  // active | settled | cancelled
  status: text("status").notNull().default("active"),
  reason: text("reason"),
  approvedBy: integer("approved_by").references(() => usersTable.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// =========================================================================
// Payroll runs
// =========================================================================
export const payrollPeriodsTable = pgTable(
  "payroll_periods",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    year: integer("year").notNull(),
    month: integer("month").notNull(), // 1..12
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    payDate: date("pay_date").notNull(),
    // open | closed
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    nameUniq: uniqueIndex("payroll_periods_name_unique").on(t.name),
  }),
);

export const payrollRunsTable = pgTable("payroll_runs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  reference: text("reference").notNull().unique(),
  periodId: integer("period_id")
    .notNull()
    .references(() => payrollPeriodsTable.id),
  branchId: integer("branch_id").references(() => branchesTable.id),
  // draft | computed | approved | posted | paid
  status: text("status").notNull().default("draft"),
  totalGross: numeric("total_gross", { precision: 18, scale: 2 }).notNull().default("0"),
  totalDeductions: numeric("total_deductions", { precision: 18, scale: 2 }).notNull().default("0"),
  totalGosiEmployee: numeric("total_gosi_employee", { precision: 18, scale: 2 }).notNull().default("0"),
  totalGosiEmployer: numeric("total_gosi_employer", { precision: 18, scale: 2 }).notNull().default("0"),
  totalNet: numeric("total_net", { precision: 18, scale: 2 }).notNull().default("0"),
  employeeCount: integer("employee_count").notNull().default(0),
  computedAt: timestamp("computed_at"),
  approvedBy: integer("approved_by").references(() => usersTable.id),
  approvedAt: timestamp("approved_at"),
  postedJournalId: integer("posted_journal_id"),
  postedAt: timestamp("posted_at"),
  paidAt: timestamp("paid_at"),
  paymentJournalId: integer("payment_journal_id"),
  gosiJournalId: integer("gosi_journal_id"),
  gosiRemittedAt: timestamp("gosi_remitted_at"),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const payrollLinesTable = pgTable(
  "payroll_lines",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => payrollRunsTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id),
    contractId: integer("contract_id").references(() => contractsTable.id),
    workedDays: numeric("worked_days", { precision: 8, scale: 2 }).notNull().default("30"),
    leaveWithoutPayDays: numeric("lwp_days", { precision: 8, scale: 2 }).notNull().default("0"),
    overtimeHours: numeric("overtime_hours", { precision: 8, scale: 2 }).notNull().default("0"),
    basicSalary: numeric("basic_salary", { precision: 18, scale: 2 }).notNull().default("0"),
    housingAllowance: numeric("housing_allowance", { precision: 18, scale: 2 }).notNull().default("0"),
    transportAllowance: numeric("transport_allowance", { precision: 18, scale: 2 }).notNull().default("0"),
    otherAllowances: numeric("other_allowances", { precision: 18, scale: 2 }).notNull().default("0"),
    overtimeAmount: numeric("overtime_amount", { precision: 18, scale: 2 }).notNull().default("0"),
    grossPay: numeric("gross_pay", { precision: 18, scale: 2 }).notNull().default("0"),
    gosiBase: numeric("gosi_base", { precision: 18, scale: 2 }).notNull().default("0"),
    gosiEmployee: numeric("gosi_employee", { precision: 18, scale: 2 }).notNull().default("0"),
    gosiEmployer: numeric("gosi_employer", { precision: 18, scale: 2 }).notNull().default("0"),
    lwpDeduction: numeric("lwp_deduction", { precision: 18, scale: 2 }).notNull().default("0"),
    loanDeduction: numeric("loan_deduction", { precision: 18, scale: 2 }).notNull().default("0"),
    otherDeductions: numeric("other_deductions", { precision: 18, scale: 2 }).notNull().default("0"),
    totalDeductions: numeric("total_deductions", { precision: 18, scale: 2 }).notNull().default("0"),
    netPay: numeric("net_pay", { precision: 18, scale: 2 }).notNull().default("0"),
    notes: text("notes"),
  },
  (t) => ({
    runEmpIdx: uniqueIndex("payroll_lines_run_emp_unique").on(t.runId, t.employeeId),
  }),
);

export const payrollDeductionsTable = pgTable("payroll_deductions", {
  id: serial("id").primaryKey(),
  lineId: integer("line_id")
    .notNull()
    .references(() => payrollLinesTable.id, { onDelete: "cascade" }),
  // gosi | loan | lwp | advance | other
  kind: text("kind").notNull(),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  reference: text("reference"),
});

export const payslipsTable = pgTable("payslips", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "restrict" }),
  reference: text("reference").notNull().unique(),
  runId: integer("run_id")
    .notNull()
    .references(() => payrollRunsTable.id, { onDelete: "cascade" }),
  lineId: integer("line_id")
    .notNull()
    .references(() => payrollLinesTable.id, { onDelete: "cascade" }),
  employeeId: integer("employee_id")
    .notNull()
    .references(() => employeesTable.id),
  fileUrl: text("file_url"),
  emailedAt: timestamp("emailed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// =========================================================================
// Insert schemas
// =========================================================================
export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({ id: true, createdAt: true });
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employeesTable.$inferSelect;

export const insertContractSchema = createInsertSchema(contractsTable).omit({ id: true, createdAt: true });
export type InsertContract = z.infer<typeof insertContractSchema>;
export type Contract = typeof contractsTable.$inferSelect;

export const insertLeaveRequestSchema = createInsertSchema(leaveRequestsTable).omit({ id: true, createdAt: true });
export type InsertLeaveRequest = z.infer<typeof insertLeaveRequestSchema>;
export type LeaveRequest = typeof leaveRequestsTable.$inferSelect;

export const insertPayrollRunSchema = createInsertSchema(payrollRunsTable).omit({ id: true, createdAt: true });
export type InsertPayrollRun = z.infer<typeof insertPayrollRunSchema>;
export type PayrollRun = typeof payrollRunsTable.$inferSelect;

export type Department = typeof departmentsTable.$inferSelect;
export type Position = typeof positionsTable.$inferSelect;
export type LeaveType = typeof leaveTypesTable.$inferSelect;
export type LeaveBalance = typeof leaveBalancesTable.$inferSelect;
export type AttendancePunch = typeof attendancePunchesTable.$inferSelect;
export type Shift = typeof shiftsTable.$inferSelect;
export type GosiSetting = typeof gosiSettingsTable.$inferSelect;
export type EmployeeLoan = typeof employeeLoansTable.$inferSelect;
export type PayrollPeriod = typeof payrollPeriodsTable.$inferSelect;
export type PayrollLine = typeof payrollLinesTable.$inferSelect;
export type Payslip = typeof payslipsTable.$inferSelect;
