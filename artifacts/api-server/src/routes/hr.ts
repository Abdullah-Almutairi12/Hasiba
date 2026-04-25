import { Router } from "express";
import { db, employeesTable, departmentsTable, attendanceTable, payrollTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireRole } from "../middlewares/require-role";
import { handleRouteError } from "../lib/handle-error";

const router = Router();

// HR data is sensitive (salaries, national IDs). Restrict to manager + accountant.
const hrReadGuard = requireRole("manager", "accountant");
const hrWriteGuard = requireRole("manager");

const serializeEmployee = (e: typeof employeesTable.$inferSelect) => ({
  ...e,
  baseSalary: Number(e.baseSalary),
  housingAllowance: Number(e.housingAllowance),
  transportAllowance: Number(e.transportAllowance),
  hireDate: e.hireDate,
  createdAt: e.createdAt.toISOString(),
});

// ---------- Departments ----------
router.get("/hr/departments", hrReadGuard, async (req, res) => {
  try {
    const rows = await db.select().from(departmentsTable).orderBy(desc(departmentsTable.createdAt));
    res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch (err) {
    req.log.error({ err }, "hr/departments");
    res.status(500).json({ error: "Internal server error" });
  }
});

const CreateDeptBody = z.object({
  name: z.string().min(2),
  code: z.string().optional(),
  managerId: z.number().int().optional(),
});

router.post("/hr/departments", hrWriteGuard, async (req, res) => {
  try {
    const body = CreateDeptBody.parse(req.body);
    const [row] = await db
      .insert(departmentsTable)
      .values({ name: body.name, code: body.code ?? null, managerId: body.managerId ?? null })
      .returning();
    res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "hr/departments POST");
    handleRouteError(err, res);
  }
});

// ---------- Employees ----------
router.get("/hr/employees", hrReadGuard, async (req, res) => {
  try {
    const rows = await db.select().from(employeesTable).orderBy(desc(employeesTable.createdAt));
    res.json(rows.map(serializeEmployee));
  } catch (err) {
    req.log.error({ err }, "hr/employees");
    res.status(500).json({ error: "Internal server error" });
  }
});

const CreateEmployeeBody = z.object({
  fullName: z.string().min(2),
  jobTitle: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  nationalId: z.string().optional(),
  departmentId: z.number().int().optional(),
  branchId: z.number().int().optional(),
  baseSalary: z.number().nonnegative().optional(),
  housingAllowance: z.number().nonnegative().optional(),
  transportAllowance: z.number().nonnegative().optional(),
  hireDate: z.string().optional(),
  status: z.enum(["active", "on_leave", "terminated"]).optional(),
});

router.post("/hr/employees", hrWriteGuard, async (req, res) => {
  try {
    const body = CreateEmployeeBody.parse(req.body);
    const [row] = await db
      .insert(employeesTable)
      .values({
        fullName: body.fullName,
        jobTitle: body.jobTitle,
        email: body.email ?? null,
        phone: body.phone ?? null,
        nationalId: body.nationalId ?? null,
        departmentId: body.departmentId ?? null,
        branchId: body.branchId ?? null,
        baseSalary: String(body.baseSalary ?? 0),
        housingAllowance: String(body.housingAllowance ?? 0),
        transportAllowance: String(body.transportAllowance ?? 0),
        hireDate: body.hireDate ?? null,
        status: body.status ?? "active",
      })
      .returning();
    res.status(201).json(serializeEmployee(row));
  } catch (err) {
    req.log.error({ err }, "hr/employees POST");
    handleRouteError(err, res);
  }
});

// ---------- Attendance ----------
router.get("/hr/attendance", hrReadGuard, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: attendanceTable.id,
        employeeId: attendanceTable.employeeId,
        employeeName: employeesTable.fullName,
        workDate: attendanceTable.workDate,
        checkIn: attendanceTable.checkIn,
        checkOut: attendanceTable.checkOut,
        status: attendanceTable.status,
        hoursWorked: attendanceTable.hoursWorked,
      })
      .from(attendanceTable)
      .leftJoin(employeesTable, eq(employeesTable.id, attendanceTable.employeeId))
      .orderBy(desc(attendanceTable.workDate))
      .limit(200);
    res.json(
      rows.map((r) => ({
        ...r,
        hoursWorked: Number(r.hoursWorked),
        checkIn: r.checkIn?.toISOString() ?? null,
        checkOut: r.checkOut?.toISOString() ?? null,
      }))
    );
  } catch (err) {
    req.log.error({ err }, "hr/attendance");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- Payroll ----------
router.get("/hr/payroll", hrReadGuard, async (req, res) => {
  try {
    const rows = await db
      .select({
        id: payrollTable.id,
        employeeId: payrollTable.employeeId,
        employeeName: employeesTable.fullName,
        period: payrollTable.period,
        baseSalary: payrollTable.baseSalary,
        allowances: payrollTable.allowances,
        deductions: payrollTable.deductions,
        bonus: payrollTable.bonus,
        netPay: payrollTable.netPay,
        status: payrollTable.status,
        paidAt: payrollTable.paidAt,
      })
      .from(payrollTable)
      .leftJoin(employeesTable, eq(employeesTable.id, payrollTable.employeeId))
      .orderBy(desc(payrollTable.period));
    res.json(
      rows.map((r) => ({
        ...r,
        baseSalary: Number(r.baseSalary),
        allowances: Number(r.allowances),
        deductions: Number(r.deductions),
        bonus: Number(r.bonus),
        netPay: Number(r.netPay),
        paidAt: r.paidAt?.toISOString() ?? null,
      }))
    );
  } catch (err) {
    req.log.error({ err }, "hr/payroll");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- HR summary ----------
router.get("/hr/summary", hrReadGuard, async (req, res) => {
  try {
    const [{ totalEmployees }] = await db
      .select({ totalEmployees: sql<number>`count(*)::int` })
      .from(employeesTable);
    const [{ activeEmployees }] = await db
      .select({ activeEmployees: sql<number>`count(*) filter (where ${employeesTable.status} = 'active')::int` })
      .from(employeesTable);
    const [{ totalDepartments }] = await db
      .select({ totalDepartments: sql<number>`count(*)::int` })
      .from(departmentsTable);
    const [{ totalPayroll }] = await db
      .select({ totalPayroll: sql<number>`coalesce(sum(${employeesTable.baseSalary} + ${employeesTable.housingAllowance} + ${employeesTable.transportAllowance}), 0)::numeric` })
      .from(employeesTable)
      .where(eq(employeesTable.status, "active"));
    res.json({
      totalEmployees,
      activeEmployees,
      totalDepartments,
      monthlyPayrollTotal: Number(totalPayroll),
    });
  } catch (err) {
    req.log.error({ err }, "hr/summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
