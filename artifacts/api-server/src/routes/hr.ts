import { Router, type IRouter } from "express";
import {
  db,
  employeesTable,
  employeeDocumentsTable,
  departmentsTable,
  positionsTable,
  contractsTable,
  salaryComponentsTable,
  leaveTypesTable,
  leaveBalancesTable,
  leaveRequestsTable,
  shiftsTable,
  employeeShiftsTable,
  attendancePunchesTable,
  gosiSettingsTable,
  employeeLoansTable,
  payrollPeriodsTable,
  payrollRunsTable,
  payrollLinesTable,
  payrollDeductionsTable,
  payslipsTable,
  branchesTable,
  usersTable,
  approvalRequestsTable,
} from "@workspace/db";
import { and, asc, desc, eq, sql, gte, lte, or, isNotNull, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  adminGuard,
  financeGuard,
  hrGuard,
  hrReadGuard,
  payrollReadGuard,
} from "../middlewares/require-role";
import { handleRouteError } from "../lib/handle-error";
import { parsePagination } from "../lib/pagination";
import { registerArabicFonts } from "../lib/pdf/arabic-font";
import { postJournalEntry } from "../lib/journal-posting";
import { getCompanyId } from "../lib/scoped-db";
import { logger } from "../lib/logger";
import {
  submitForApproval,
  registerOnApprove,
  registerOnReject,
  triggerEvent,
} from "../lib/workflow-engine";
import { sendMessage } from "../lib/integrations/messaging";

const router = Router();

/**
 * Module hook: notify each employee that their payslip is ready
 * once the payroll run has been marked paid. Sends a short Arabic
 * WhatsApp message with the run reference, period and net pay,
 * plus a deep-link to the payslip PDF when PUBLIC_BASE_URL is
 * configured. Fire-and-forget; per-employee failures are logged
 * but never break the calling response.
 */
async function notifyEmployeesPayrollPaid(runId: number): Promise<void> {
  try {
    const [run] = await db
      .select()
      .from(payrollRunsTable)
      .where(eq(payrollRunsTable.id, runId));
    if (!run) return;
    const [period] = await db
      .select()
      .from(payrollPeriodsTable)
      .where(eq(payrollPeriodsTable.id, run.periodId));
    const slips = await db
      .select({
        id: payslipsTable.id,
        employeeId: payslipsTable.employeeId,
        netPay: payrollLinesTable.netPay,
        empName: employeesTable.nameAr,
        phone: employeesTable.phone,
      })
      .from(payslipsTable)
      .leftJoin(payrollLinesTable, eq(payrollLinesTable.id, payslipsTable.lineId))
      .leftJoin(employeesTable, eq(employeesTable.id, payslipsTable.employeeId))
      .where(eq(payslipsTable.runId, runId));
    const baseUrl = (process.env["PUBLIC_BASE_URL"] ?? "").replace(/\/$/, "");
    for (const s of slips) {
      if (!s.phone) continue;
      const lines = [
        `مرحباً ${s.empName ?? ""}،`,
        `تم صرف راتبك لشهر ${period?.name ?? run.reference}.`,
        `صافي المستحق: ${s.netPay} ر.س.`,
      ];
      const pdfUrl = baseUrl
        ? `${baseUrl}/portal/payslips/${s.id}.pdf`
        : undefined;
      if (pdfUrl) lines.push(`كشف الراتب: ${pdfUrl}`);
      try {
        await sendMessage({
          channel: "whatsapp",
          provider: "whatsapp",
          to: s.phone,
          body: lines.join("\n"),
          mediaUrl: pdfUrl,
          mediaFilename: `payslip-${s.id}.pdf`,
          mediaCaption: lines.join("\n"),
          branchId: run.branchId ?? null,
        });
      } catch (err) {
        logger.warn({ err, payslipId: s.id }, "payslip notification failed");
      }
    }
  } catch (err) {
    logger.warn({ err, runId }, "payroll-paid notification dispatch failed");
  }
}

// ---------------------------------------------------------------------------
// Workflow-engine integration: Leave Request.
//   * On create, the leave request is submitted to the engine. Configurable
//     approval rules (doc_type=leave_request) override the legacy /decide
//     endpoint when matched. The amount used for thresholding is the
//     number of leave days, so admins can wire e.g. ">5 days needs CEO".
//   * onApprove: mark request approved, move days from pending → used.
//   * onReject: mark rejected, release pending balance.
// ---------------------------------------------------------------------------
async function applyLeaveDecision(
  recordId: number,
  decision: "approved" | "rejected",
  approverUserId: number | null,
): Promise<void> {
  const [lr] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, recordId));
  if (!lr || lr.status !== "pending") return;
  const year = new Date(lr.startDate).getFullYear();
  const balance = await ensureLeaveBalance(lr.employeeId, lr.leaveTypeId, year);
  const days = num(lr.days);
  if (decision === "approved") {
    await db
      .update(leaveBalancesTable)
      .set({
        pending: String(Math.max(0, num(balance.pending) - days)),
        used: String(num(balance.used) + days),
        updatedAt: new Date(),
      })
      .where(eq(leaveBalancesTable.id, balance.id));
    await db
      .update(leaveRequestsTable)
      .set({ status: "approved", approvedBy: approverUserId, approvedAt: new Date() })
      .where(eq(leaveRequestsTable.id, recordId));
    void triggerEvent("state_changed", "leave_request", { id: recordId, days }, "approved");
  } else {
    await db
      .update(leaveBalancesTable)
      .set({ pending: String(Math.max(0, num(balance.pending) - days)), updatedAt: new Date() })
      .where(eq(leaveBalancesTable.id, balance.id));
    await db
      .update(leaveRequestsTable)
      .set({ status: "rejected", approvedBy: approverUserId, approvedAt: new Date() })
      .where(eq(leaveRequestsTable.id, recordId));
  }
}
registerOnApprove("leave_request", async (recordId) => {
  // Errors propagate so actOnApproval can roll the request back to
  // pending if the leave-balance update or status flip fails.
  await applyLeaveDecision(recordId, "approved", null);
});
registerOnReject("leave_request", async (recordId) => {
  await applyLeaveDecision(recordId, "rejected", null);
});

// ---------------------------------------------------------------------------
// Workflow-engine integration: Expense Claim.
//   * Submitted on POST /hr/expense-claims; engine routes to approver(s)
//     based on doc_type=expense_claim rules and the claim amount.
//   * onApprove flips status to approved (JE posting is intentionally out
//     of scope — Task #7 marks JE as optional for expense claims).
//   * onReject flips status to rejected.
// ---------------------------------------------------------------------------
registerOnApprove("expense_claim", async (recordId) => {
  // Rethrow on failure: actOnApproval rolls the request back to pending
  // and surfaces the error so workflow + document state stay consistent.
  try {
    await db.execute(
      sql`UPDATE expense_claims SET status = 'approved', approved_at = now() WHERE id = ${recordId} AND status IN ('pending','pending_approval')`,
    );
    void triggerEvent("state_changed", "expense_claim", { id: recordId }, "approved");
  } catch (err) {
    logger.error({ err, recordId }, "expense_claim onApprove failed");
    throw err;
  }
});
registerOnReject("expense_claim", async (recordId) => {
  try {
    await db.execute(
      sql`UPDATE expense_claims SET status = 'rejected', approved_at = now() WHERE id = ${recordId} AND status IN ('pending','pending_approval')`,
    );
  } catch (err) {
    logger.error({ err, recordId }, "expense_claim onReject failed");
    throw err;
  }
});

// =========================================================================
// Helpers
// =========================================================================
const IdParam = z.object({ id: z.coerce.number().int().positive() });
const num = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

type SeqRow = { n: string | number };
async function nextRef(prefix: string, year: number): Promise<string> {
  const seq = `hr_${prefix.toLowerCase()}_${year}_seq`;
  await db.execute(sql.raw(`CREATE SEQUENCE IF NOT EXISTS ${seq} MINVALUE 1 START 1`));
  const r = await db.execute(sql.raw(`SELECT nextval('${seq}')::bigint AS n`));
  const rows = (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as SeqRow[];
  const n = Number(rows[0]?.n ?? 1);
  return `${prefix}-${year}-${String(n).padStart(5, "0")}`;
}

function daysBetween(a: string, b: string): number {
  const d1 = new Date(a + "T00:00:00Z").getTime();
  const d2 = new Date(b + "T00:00:00Z").getTime();
  return Math.floor((d2 - d1) / 86_400_000) + 1;
}

// Civil → Hijri (Umm Al-Qura) approximate conversion. Uses the algebraic
// Kuwaiti algorithm which is correct to ±1 day for the Saudi calendar — good
// enough to display alongside payslip dates without needing an external dep.
function toHijri(g: string | Date): { year: number; month: number; day: number; formatted: string } {
  const d = typeof g === "string" ? new Date(g + (g.length === 10 ? "T00:00:00Z" : "")) : g;
  const jd =
    Math.floor((1461 * (d.getUTCFullYear() + 4800 + Math.floor((d.getUTCMonth() - 2) / 12))) / 4) +
    Math.floor((367 * (d.getUTCMonth() - 1 - 12 * Math.floor((d.getUTCMonth() - 2) / 12))) / 12) -
    Math.floor((3 * Math.floor((d.getUTCFullYear() + 4900 + Math.floor((d.getUTCMonth() - 2) / 12)) / 100)) / 4) +
    d.getUTCDate() - 32075;
  const l1 = jd - 1948440 + 10632;
  const n = Math.floor((l1 - 1) / 10631);
  const l2 = l1 - 10631 * n + 354;
  const j =
    Math.floor((10985 - l2) / 5316) * Math.floor((50 * l2) / 17719) +
    Math.floor(l2 / 5670) * Math.floor((43 * l2) / 15238);
  const l3 = l2 - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
    Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
  const month = Math.floor((24 * l3) / 709);
  const day = l3 - Math.floor((709 * month) / 24);
  const year = 30 * n + j - 30;
  const monthsAr = [
    "محرم", "صفر", "ربيع الأول", "ربيع الآخر", "جمادى الأولى", "جمادى الآخرة",
    "رجب", "شعبان", "رمضان", "شوال", "ذو القعدة", "ذو الحجة",
  ];
  return { year, month, day, formatted: `${day} ${monthsAr[month - 1]} ${year}هـ` };
}

// Returns true when the caller is allowed to read every employee's payslip.
function isPayslipPrivileged(role: string | undefined): boolean {
  return role === "owner" || role === "manager" || role === "hr";
}

// =========================================================================
// Departments
// =========================================================================
router.get("/hr/departments", hrReadGuard, async (_req, res) => {
  const rows = await db.select().from(departmentsTable).orderBy(asc(departmentsTable.name));
  res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

const DeptBody = z.object({
  name: z.string().min(2),
  nameAr: z.string().min(2),
  parentId: z.number().int().positive().nullish(),
  branchId: z.number().int().positive().nullish(),
  managerEmployeeId: z.number().int().positive().nullish(),
});

router.post("/hr/departments", hrGuard, async (req, res) => {
  try {
    const body = DeptBody.parse(req.body);
    const [row] = await db
      .insert(departmentsTable)
      .values({
        companyId: getCompanyId(req),
        name: body.name,
        nameAr: body.nameAr,
        parentId: body.parentId ?? null,
        branchId: body.branchId ?? null,
        managerEmployeeId: body.managerEmployeeId ?? null,
      })
      .returning();
    res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "create dept");
    handleRouteError(err, res);
  }
});

router.put("/hr/departments/:id", hrGuard, async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const body = DeptBody.partial().parse(req.body);
    const [row] = await db
      .update(departmentsTable)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.nameAr !== undefined ? { nameAr: body.nameAr } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId ?? null } : {}),
        ...(body.branchId !== undefined ? { branchId: body.branchId ?? null } : {}),
        ...(body.managerEmployeeId !== undefined
          ? { managerEmployeeId: body.managerEmployeeId ?? null }
          : {}),
      })
      .where(and(eq(departmentsTable.id, id), eq(departmentsTable.companyId, getCompanyId(req))))
      .returning();
    if (!row) return res.status(404).json({ error: "الإدارة غير موجودة" });
    return res.json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// =========================================================================
// Positions
// =========================================================================
router.get("/hr/positions", hrReadGuard, async (_req, res) => {
  const rows = await db.select().from(positionsTable).orderBy(asc(positionsTable.title));
  res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

const PositionBody = z.object({
  title: z.string().min(2),
  titleAr: z.string().min(2),
  departmentId: z.number().int().positive().nullish(),
  level: z.string().nullish(),
});

router.post("/hr/positions", hrGuard, async (req, res) => {
  try {
    const body = PositionBody.parse(req.body);
    const [row] = await db
      .insert(positionsTable)
      .values({
        title: body.title,
        titleAr: body.titleAr,
        departmentId: body.departmentId ?? null,
        level: body.level ?? null,
      })
      .returning();
    res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "create position");
    handleRouteError(err, res);
  }
});

// =========================================================================
// Employees
// =========================================================================
router.get("/hr/employees", hrReadGuard, async (req, res) => {
  // Tenant scope: every employees query MUST be filtered by companyId
  // — employee PII (national IDs, salaries, contracts) is one of the
  // most sensitive surfaces in the system, and the column is NOT NULL.
  const companyId = getCompanyId(req);
  const rows = await db
    .select({
      id: employeesTable.id,
      employeeNo: employeesTable.employeeNo,
      name: employeesTable.name,
      nameAr: employeesTable.nameAr,
      nationalityType: employeesTable.nationalityType,
      nationality: employeesTable.nationality,
      nationalId: employeesTable.nationalId,
      iqamaExpiry: employeesTable.iqamaExpiry,
      passportExpiry: employeesTable.passportExpiry,
      email: employeesTable.email,
      phone: employeesTable.phone,
      photoUrl: employeesTable.photoUrl,
      branchId: employeesTable.branchId,
      branchName: branchesTable.nameAr,
      departmentId: employeesTable.departmentId,
      departmentName: departmentsTable.nameAr,
      positionId: employeesTable.positionId,
      positionTitle: positionsTable.titleAr,
      managerEmployeeId: employeesTable.managerEmployeeId,
      hireDate: employeesTable.hireDate,
      terminationDate: employeesTable.terminationDate,
      status: employeesTable.status,
      bankIban: employeesTable.bankIban,
      bankName: employeesTable.bankName,
      createdAt: employeesTable.createdAt,
    })
    .from(employeesTable)
    .leftJoin(branchesTable, eq(branchesTable.id, employeesTable.branchId))
    .leftJoin(departmentsTable, eq(departmentsTable.id, employeesTable.departmentId))
    .leftJoin(positionsTable, eq(positionsTable.id, employeesTable.positionId))
    .where(eq(employeesTable.companyId, companyId))
    .orderBy(desc(employeesTable.createdAt))
    .limit(parsePagination(req).limit)
    .offset(parsePagination(req).offset);
  res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.get("/hr/employees/:id", hrReadGuard, async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    // Cross-tenant IDOR defense: scope the lookup to (id, companyId)
    // so probing another tenant's employee id collapses to 404.
    const companyId = getCompanyId(req);
    const [emp] = await db
      .select()
      .from(employeesTable)
      .where(and(eq(employeesTable.id, id), eq(employeesTable.companyId, companyId)))
      .limit(1);
    if (!emp) return res.status(404).json({ error: "الموظف غير موجود" });
    return res.json({ ...emp, createdAt: emp.createdAt.toISOString() });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

const EmployeeBody = z.object({
  employeeNo: z.string().optional(),
  name: z.string().min(2),
  nameAr: z.string().min(2),
  nationalityType: z.enum(["saudi", "iqama", "gcc", "contractor"]).default("saudi"),
  nationality: z.string().default("SA"),
  nationalId: z.string().nullish(),
  iqamaExpiry: z.string().nullish(),
  passportNo: z.string().nullish(),
  passportExpiry: z.string().nullish(),
  dateOfBirth: z.string().nullish(),
  gender: z.enum(["male", "female"]).nullish(),
  maritalStatus: z.string().nullish(),
  email: z.string().email().nullish(),
  phone: z.string().nullish(),
  address: z.string().nullish(),
  emergencyContactName: z.string().nullish(),
  emergencyContactPhone: z.string().nullish(),
  photoUrl: z.string().nullish(),
  branchId: z.number().int().positive().nullish(),
  departmentId: z.number().int().positive().nullish(),
  positionId: z.number().int().positive().nullish(),
  managerEmployeeId: z.number().int().positive().nullish(),
  userId: z.number().int().positive().nullish(),
  bankName: z.string().nullish(),
  bankIban: z.string().nullish(),
  bankAccountNo: z.string().nullish(),
  hireDate: z.string(),
  status: z.enum(["active", "on_leave", "suspended", "terminated"]).default("active"),
});

router.post("/hr/employees", hrGuard, async (req, res) => {
  try {
    const body = EmployeeBody.parse(req.body);
    const employeeNo = body.employeeNo ?? (await nextRef("EMP", new Date().getFullYear()));
    const [row] = await db
      .insert(employeesTable)
      .values({
        companyId: getCompanyId(req),
        employeeNo,
        name: body.name,
        nameAr: body.nameAr,
        nationalityType: body.nationalityType,
        nationality: body.nationality,
        nationalId: body.nationalId ?? null,
        iqamaExpiry: body.iqamaExpiry ?? null,
        passportNo: body.passportNo ?? null,
        passportExpiry: body.passportExpiry ?? null,
        dateOfBirth: body.dateOfBirth ?? null,
        gender: body.gender ?? null,
        maritalStatus: body.maritalStatus ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        address: body.address ?? null,
        emergencyContactName: body.emergencyContactName ?? null,
        emergencyContactPhone: body.emergencyContactPhone ?? null,
        photoUrl: body.photoUrl ?? null,
        branchId: body.branchId ?? null,
        departmentId: body.departmentId ?? null,
        positionId: body.positionId ?? null,
        managerEmployeeId: body.managerEmployeeId ?? null,
        userId: body.userId ?? null,
        bankName: body.bankName ?? null,
        bankIban: body.bankIban ?? null,
        bankAccountNo: body.bankAccountNo ?? null,
        hireDate: body.hireDate,
        status: body.status,
      })
      .returning();
    res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "create employee");
    handleRouteError(err, res);
  }
});

router.patch("/hr/employees/:id", hrGuard, async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const body = EmployeeBody.partial().parse(req.body);
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined) update[k] = v;
    }
    // Cross-tenant mutation defense: scope the UPDATE to (id, companyId)
    // so a forged id from another tenant returns no row → 404.
    const companyId = getCompanyId(req);
    const [row] = await db
      .update(employeesTable)
      .set(update)
      .where(and(eq(employeesTable.id, id), eq(employeesTable.companyId, companyId)))
      .returning();
    if (!row) return res.status(404).json({ error: "الموظف غير موجود" });
    // Automation hook: rules with trigger.type='record_updated' on the
    // 'employee' entity can react to changes (e.g. notify HR when an
    // employee's department or status changes).
    void triggerEvent("record_updated", "employee", {
      id: row.id,
      changedKeys: Object.keys(update),
      branchId: row.branchId,
      status: row.status,
    });
    return res.json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// =========================================================================
// Contracts
// =========================================================================
router.get("/hr/contracts", hrReadGuard, async (req, res) => {
  const empId = req.query.employeeId ? Number(req.query.employeeId) : null;
  const where = empId ? eq(contractsTable.employeeId, empId) : sql`true`;
  const rows = await db
    .select()
    .from(contractsTable)
    .where(where)
    .orderBy(desc(contractsTable.startDate));
  res.json(
    rows.map((r) => ({
      ...r,
      basicSalary: num(r.basicSalary),
      housingAllowance: num(r.housingAllowance),
      transportAllowance: num(r.transportAllowance),
      otherAllowances: num(r.otherAllowances),
      startDateHijri: toHijri(r.startDate).formatted,
      endDateHijri: r.endDate ? toHijri(r.endDate).formatted : null,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

const ContractBody = z.object({
  employeeId: z.number().int().positive(),
  contractType: z.enum(["saudi", "iqama", "gcc", "contractor"]),
  startDate: z.string(),
  endDate: z.string().nullish(),
  probationMonths: z.number().int().min(0).max(12).default(3),
  noticePeriodDays: z.number().int().min(0).default(30),
  basicSalary: z.number().nonnegative(),
  housingAllowance: z.number().nonnegative().default(0),
  transportAllowance: z.number().nonnegative().default(0),
  otherAllowances: z.number().nonnegative().default(0),
  gosiCategory: z.string().default("civil"),
  gosiApplies: z.boolean().default(true),
  workingHoursPerWeek: z.number().int().min(1).max(60).default(48),
  annualLeaveDays: z.number().int().min(0).default(21),
  documentUrl: z.string().nullish(),
  notes: z.string().nullish(),
});

router.post("/hr/contracts", hrGuard, async (req, res) => {
  try {
    const body = ContractBody.parse(req.body);
    const reference = await nextRef("CON", new Date().getFullYear());
    const [row] = await db
      .insert(contractsTable)
      .values({
        reference,
        employeeId: body.employeeId,
        contractType: body.contractType,
        startDate: body.startDate,
        endDate: body.endDate ?? null,
        probationMonths: body.probationMonths,
        noticePeriodDays: body.noticePeriodDays,
        basicSalary: String(body.basicSalary),
        housingAllowance: String(body.housingAllowance),
        transportAllowance: String(body.transportAllowance),
        otherAllowances: String(body.otherAllowances),
        gosiCategory: body.gosiCategory,
        gosiApplies: body.gosiApplies,
        workingHoursPerWeek: body.workingHoursPerWeek,
        annualLeaveDays: body.annualLeaveDays,
        documentUrl: body.documentUrl ?? null,
        notes: body.notes ?? null,
      })
      .returning();
    res.status(201).json({
      ...row,
      basicSalary: num(row.basicSalary),
      housingAllowance: num(row.housingAllowance),
      transportAllowance: num(row.transportAllowance),
      otherAllowances: num(row.otherAllowances),
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "create contract");
    handleRouteError(err, res);
  }
});

// =========================================================================
// Leave types & requests
// =========================================================================
router.get("/hr/leave-types", async (_req, res) => {
  const rows = await db.select().from(leaveTypesTable).orderBy(asc(leaveTypesTable.code));
  res.json(rows);
});

router.get("/hr/leave-balances", hrReadGuard, async (req, res) => {
  const empId = req.query.employeeId ? Number(req.query.employeeId) : null;
  const year = req.query.year ? Number(req.query.year) : new Date().getFullYear();
  const rows = await db
    .select({
      id: leaveBalancesTable.id,
      employeeId: leaveBalancesTable.employeeId,
      leaveTypeId: leaveBalancesTable.leaveTypeId,
      leaveTypeCode: leaveTypesTable.code,
      leaveTypeName: leaveTypesTable.nameAr,
      year: leaveBalancesTable.year,
      entitlement: leaveBalancesTable.entitlement,
      used: leaveBalancesTable.used,
      pending: leaveBalancesTable.pending,
    })
    .from(leaveBalancesTable)
    .innerJoin(leaveTypesTable, eq(leaveTypesTable.id, leaveBalancesTable.leaveTypeId))
    .where(
      empId
        ? and(eq(leaveBalancesTable.employeeId, empId), eq(leaveBalancesTable.year, year))
        : eq(leaveBalancesTable.year, year),
    );
  res.json(
    rows.map((r) => ({
      ...r,
      entitlement: num(r.entitlement),
      used: num(r.used),
      pending: num(r.pending),
      remaining: num(r.entitlement) - num(r.used) - num(r.pending),
    })),
  );
});

async function ensureLeaveBalance(employeeId: number, leaveTypeId: number, year: number) {
  const [existing] = await db
    .select()
    .from(leaveBalancesTable)
    .where(
      and(
        eq(leaveBalancesTable.employeeId, employeeId),
        eq(leaveBalancesTable.leaveTypeId, leaveTypeId),
        eq(leaveBalancesTable.year, year),
      ),
    )
    .limit(1);
  if (existing) return existing;
  const [type] = await db.select().from(leaveTypesTable).where(eq(leaveTypesTable.id, leaveTypeId)).limit(1);
  let entitlement: number = type?.defaultDaysPerYear ?? 0;
  // For annual leave, prefer the employee's active contract entitlement
  // (contracts.annualLeaveDays) so per-employee contractual values are
  // honored rather than the global leave-type default.
  if (type?.code === "annual") {
    const [activeContract] = await db
      .select({ annualLeaveDays: contractsTable.annualLeaveDays })
      .from(contractsTable)
      .where(and(eq(contractsTable.employeeId, employeeId), eq(contractsTable.status, "active")))
      .orderBy(desc(contractsTable.startDate))
      .limit(1);
    if (activeContract?.annualLeaveDays != null) {
      entitlement = activeContract.annualLeaveDays;
    }
  }
  const [created] = await db
    .insert(leaveBalancesTable)
    .values({
      employeeId,
      leaveTypeId,
      year,
      entitlement: String(entitlement),
    })
    .returning();
  return created;
}

router.get("/hr/leave-requests", hrReadGuard, async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const where = status ? eq(leaveRequestsTable.status, status) : sql`true`;
  const rows = await db
    .select({
      id: leaveRequestsTable.id,
      reference: leaveRequestsTable.reference,
      employeeId: leaveRequestsTable.employeeId,
      employeeName: employeesTable.nameAr,
      leaveTypeId: leaveRequestsTable.leaveTypeId,
      leaveTypeName: leaveTypesTable.nameAr,
      leaveTypeCode: leaveTypesTable.code,
      isPaid: leaveTypesTable.isPaid,
      startDate: leaveRequestsTable.startDate,
      endDate: leaveRequestsTable.endDate,
      days: leaveRequestsTable.days,
      reason: leaveRequestsTable.reason,
      status: leaveRequestsTable.status,
      approvedBy: leaveRequestsTable.approvedBy,
      approvedAt: leaveRequestsTable.approvedAt,
      createdAt: leaveRequestsTable.createdAt,
    })
    .from(leaveRequestsTable)
    .innerJoin(employeesTable, eq(employeesTable.id, leaveRequestsTable.employeeId))
    .innerJoin(leaveTypesTable, eq(leaveTypesTable.id, leaveRequestsTable.leaveTypeId))
    .where(where)
    .orderBy(desc(leaveRequestsTable.createdAt));
  res.json(
    rows.map((r) => ({
      ...r,
      days: num(r.days),
      startDateHijri: toHijri(r.startDate).formatted,
      endDateHijri: toHijri(r.endDate).formatted,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

const LeaveReqBody = z.object({
  employeeId: z.number().int().positive(),
  leaveTypeId: z.number().int().positive(),
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().nullish(),
});

router.post("/hr/leave-requests", hrGuard, async (req, res) => {
  try {
    const body = LeaveReqBody.parse(req.body);
    const days = daysBetween(body.startDate, body.endDate);
    if (days <= 0) return res.status(400).json({ error: "نطاق التواريخ غير صالح" });

    // Cross-year leave is not yet supported because the leave-balance ledger
    // is keyed by year — splitting a request across two ledgers needs a
    // dedicated workflow. Reject explicitly so callers don't get a
    // silently-mis-attributed balance.
    const startYear = new Date(body.startDate).getFullYear();
    const endYear = new Date(body.endDate).getFullYear();
    if (startYear !== endYear) {
      return res.status(400).json({
        error: "لا يمكن أن يمتد طلب الإجازة عبر سنتين. يرجى تقديم طلبين منفصلين.",
      });
    }
    const year = startYear;
    const balance = await ensureLeaveBalance(body.employeeId, body.leaveTypeId, year);
    const remaining = num(balance.entitlement) - num(balance.used) - num(balance.pending);
    const [type] = await db.select().from(leaveTypesTable).where(eq(leaveTypesTable.id, body.leaveTypeId)).limit(1);
    if (type?.isPaid && remaining < days) {
      return res.status(400).json({ error: `الرصيد غير كاف. المتبقي ${remaining} يوم` });
    }

    const reference = await nextRef("LV", year);
    const [row] = await db
      .insert(leaveRequestsTable)
      .values({
        companyId: getCompanyId(req),
        reference,
        employeeId: body.employeeId,
        leaveTypeId: body.leaveTypeId,
        startDate: body.startDate,
        endDate: body.endDate,
        days: String(days),
        reason: body.reason ?? null,
      })
      .returning();

    // Reserve against pending balance.
    await db
      .update(leaveBalancesTable)
      .set({ pending: String(num(balance.pending) + days), updatedAt: new Date() })
      .where(eq(leaveBalancesTable.id, balance.id));

    // Workflow-engine submission — synchronous. The amount is the leave
    // duration in days so admins can configure rules like ">5 days requires
    // manager, >15 days requires CEO". When no rule matches the request
    // stays in 'pending' (legacy /decide flow). When a rule matches we lock
    // the row to 'pending_approval' and surface the approvalRequestId to
    // the client.
    let approvalRequestId: number | undefined;
    let pendingApproval = false;
    try {
      const [empBranch] = await db
        .select({ branchId: employeesTable.branchId })
        .from(employeesTable)
        .where(eq(employeesTable.id, body.employeeId));
      const submission = await submitForApproval({
        docType: "leave_request",
        recordId: row.id,
        recordRef: reference,
        amount: days,
        branchId: empBranch?.branchId ?? null,
        submittedByUserId: req.session?.userId ?? null,
        submittedByName: (req.session as { userName?: string } | undefined)?.userName ?? null,
      });
      if (submission.required) {
        await db
          .update(leaveRequestsTable)
          .set({ status: "pending_approval" })
          .where(eq(leaveRequestsTable.id, row.id));
        approvalRequestId = submission.requestId;
        pendingApproval = true;
      }
    } catch (err) {
      req.log.error({ err }, "leave_request submitForApproval failed");
    }

    // Automation hook: rules on 'leave_request' record_created can fan
    // out notifications to HR or trigger calendar webhooks.
    void triggerEvent("record_created", "leave_request", {
      id: row.id,
      employeeId: row.employeeId,
      leaveTypeId: row.leaveTypeId,
      days,
    });
    return res.status(201).json({
      ...row,
      status: pendingApproval ? "pending_approval" : row.status,
      days: num(row.days),
      approvedAt: row.approvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      pendingApproval,
      approvalRequestId,
    });
  } catch (err) {
    req.log.error({ err }, "create leave req");
    return handleRouteError(err, res);
  }
});

const LeaveDecide = z.object({ action: z.enum(["approve", "reject"]), reason: z.string().nullish() });

router.post("/hr/leave-requests/:id/decide", hrGuard, async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const { action, reason } = LeaveDecide.parse(req.body);
    const [lr] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, id)).limit(1);
    if (!lr) return res.status(404).json({ error: "الطلب غير موجود" });
    if (lr.status !== "pending") return res.status(400).json({ error: "لا يمكن تعديل طلب تمت معالجته" });

    // If the workflow engine has an active approval chain on this leave
    // request, the legacy /decide endpoint is locked out — approvals must
    // flow through the engine's /workflow/approval-requests/:id/act so
    // delegations, audit trail, and notifications fire correctly.
    const [openReq] = await db
      .select({ id: approvalRequestsTable.id })
      .from(approvalRequestsTable)
      .where(
        and(
          eq(approvalRequestsTable.docType, "leave_request"),
          eq(approvalRequestsTable.recordId, id),
          inArray(approvalRequestsTable.status, ["pending", "changes_requested"]),
        ),
      )
      .limit(1);
    if (openReq) {
      return res.status(409).json({
        error: "هذا الطلب يخضع لسلسلة اعتماد نشطة. استخدم صندوق الموافقات.",
        approvalRequestId: openReq.id,
      });
    }

    const year = new Date(lr.startDate).getFullYear();
    const balance = await ensureLeaveBalance(lr.employeeId, lr.leaveTypeId, year);
    const days = num(lr.days);

    if (action === "approve") {
      await db
        .update(leaveBalancesTable)
        .set({
          pending: String(Math.max(0, num(balance.pending) - days)),
          used: String(num(balance.used) + days),
          updatedAt: new Date(),
        })
        .where(eq(leaveBalancesTable.id, balance.id));
      const [updated] = await db
        .update(leaveRequestsTable)
        .set({ status: "approved", approvedBy: req.session.userId ?? null, approvedAt: new Date() })
        .where(eq(leaveRequestsTable.id, id))
        .returning();
      return res.json({ ...updated, days: num(updated.days), createdAt: updated.createdAt.toISOString() });
    } else {
      await db
        .update(leaveBalancesTable)
        .set({ pending: String(Math.max(0, num(balance.pending) - days)), updatedAt: new Date() })
        .where(eq(leaveBalancesTable.id, balance.id));
      const [updated] = await db
        .update(leaveRequestsTable)
        .set({
          status: "rejected",
          approvedBy: req.session.userId ?? null,
          approvedAt: new Date(),
          rejectionReason: reason ?? null,
        })
        .where(eq(leaveRequestsTable.id, id))
        .returning();
      return res.json({ ...updated, days: num(updated.days), createdAt: updated.createdAt.toISOString() });
    }
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// =========================================================================
// Expense Claims (employee reimbursements)
// =========================================================================
const ExpenseClaimBody = z.object({
  employeeId: z.number().int().positive(),
  claimDate: z.string(),
  amount: z.number().positive(),
  currency: z.string().default("SAR"),
  category: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  receiptUrl: z.string().url().nullable().optional(),
});

router.get("/hr/expense-claims", hrReadGuard, async (req, res) => {
  try {
    const employeeId = req.query.employeeId ? Number(req.query.employeeId) : null;
    const status = req.query.status ? String(req.query.status) : null;
    const filters: string[] = [];
    if (employeeId) filters.push(`employee_id = ${employeeId}`);
    if (status) filters.push(`status = '${status.replace(/'/g, "''")}'`);
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await db.execute(sql.raw(`
      SELECT id, reference, employee_id AS "employeeId", claim_date AS "claimDate",
             currency, amount, category, description, receipt_url AS "receiptUrl",
             status, approved_at AS "approvedAt", rejection_reason AS "rejectionReason",
             created_at AS "createdAt"
        FROM expense_claims ${where}
        ORDER BY created_at DESC LIMIT 200
    `));
    res.json(result.rows);
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.post("/hr/expense-claims", hrGuard, async (req, res) => {
  try {
    const body = ExpenseClaimBody.parse(req.body);
    const reference = await nextRef("EXP", new Date().getFullYear());
    const userId = req.session?.userId ?? null;
    const result = await db.execute(sql`
      INSERT INTO expense_claims
        (reference, employee_id, claim_date, currency, amount, category,
         description, receipt_url, created_by)
      VALUES (${reference}, ${body.employeeId}, ${body.claimDate}::date,
              ${body.currency}, ${body.amount}, ${body.category ?? null},
              ${body.description ?? null}, ${body.receiptUrl ?? null}, ${userId})
      RETURNING id
    `);
    const newId = Number((result.rows[0] as { id: number }).id);

    // Submit to workflow engine — synchronous. Amount drives threshold
    // rules (e.g. >5,000 → manager, >25,000 → CFO). When a rule matches
    // we lock the row to 'pending_approval' and return the approval
    // request id so the client can deep-link to the inbox.
    let approvalRequestId: number | undefined;
    let status = "pending";
    try {
      const [empBranch] = await db
        .select({ branchId: employeesTable.branchId })
        .from(employeesTable)
        .where(eq(employeesTable.id, body.employeeId));
      const submission = await submitForApproval({
        docType: "expense_claim",
        recordId: newId,
        recordRef: reference,
        amount: body.amount,
        branchId: empBranch?.branchId ?? null,
        submittedByUserId: userId,
        submittedByName: (req.session as { userName?: string } | undefined)?.userName ?? null,
      });
      if (submission.required) {
        await db.execute(
          sql`UPDATE expense_claims SET status = 'pending_approval' WHERE id = ${newId}`,
        );
        approvalRequestId = submission.requestId;
        status = "pending_approval";
      }
    } catch (err) {
      req.log.error({ err }, "expense_claim submitForApproval failed");
    }

    void triggerEvent("record_created", "expense_claim", {
      id: newId,
      employeeId: body.employeeId,
      amount: body.amount,
      category: body.category ?? null,
    });
    res.status(201).json({ id: newId, reference, status, approvalRequestId });
  } catch (err) {
    handleRouteError(err, res);
  }
});

router.get("/hr/expense-claims/:id", hrReadGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await db.execute(sql`
      SELECT id, reference, employee_id AS "employeeId", claim_date AS "claimDate",
             currency, amount, category, description, receipt_url AS "receiptUrl",
             status, approved_at AS "approvedAt", rejection_reason AS "rejectionReason",
             created_at AS "createdAt"
        FROM expense_claims WHERE id = ${id} LIMIT 1
    `);
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    handleRouteError(err, res);
  }
});

// =========================================================================
// Attendance
// =========================================================================
router.get("/hr/attendance", hrReadGuard, async (req, res) => {
  const from = req.query.from ? String(req.query.from) : null;
  const to = req.query.to ? String(req.query.to) : null;
  const empId = req.query.employeeId ? Number(req.query.employeeId) : null;
  const conds: SQL[] = [];
  if (empId) conds.push(eq(attendancePunchesTable.employeeId, empId));
  if (from) conds.push(gte(attendancePunchesTable.punchAt, new Date(from + "T00:00:00Z")));
  if (to) conds.push(lte(attendancePunchesTable.punchAt, new Date(to + "T23:59:59Z")));
  const where = conds.length ? and(...conds) : sql`true`;
  const rows = await db
    .select({
      id: attendancePunchesTable.id,
      employeeId: attendancePunchesTable.employeeId,
      employeeName: employeesTable.nameAr,
      punchAt: attendancePunchesTable.punchAt,
      direction: attendancePunchesTable.direction,
      source: attendancePunchesTable.source,
    })
    .from(attendancePunchesTable)
    .innerJoin(employeesTable, eq(employeesTable.id, attendancePunchesTable.employeeId))
    .where(where)
    .orderBy(desc(attendancePunchesTable.punchAt))
    .limit(500);
  res.json(rows.map((r) => ({ ...r, punchAt: r.punchAt.toISOString() })));
});

const PunchBody = z.object({
  employeeId: z.number().int().positive(),
  direction: z.enum(["in", "out"]),
  punchAt: z.string().optional(),
  source: z.enum(["manual", "biometric", "webhook"]).default("manual"),
  deviceId: z.string().nullish(),
  notes: z.string().nullish(),
});

router.post("/hr/attendance/punch", hrGuard, async (req, res) => {
  try {
    const body = PunchBody.parse(req.body);
    const [row] = await db
      .insert(attendancePunchesTable)
      .values({
        employeeId: body.employeeId,
        punchAt: body.punchAt ? new Date(body.punchAt) : new Date(),
        direction: body.direction,
        source: body.source,
        deviceId: body.deviceId ?? null,
        notes: body.notes ?? null,
        createdBy: req.session.userId ?? null,
      })
      .returning();
    res.status(201).json({ ...row, punchAt: row.punchAt.toISOString(), createdAt: row.createdAt.toISOString() });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// Public router — mounted BEFORE requireAuth in routes/index.ts so device
// terminals can post without a user session. Authenticated by an API key.
export const hrPublicRouter: IRouter = Router();

// Public webhook endpoint for biometric / fingerprint device callbacks.
// Authenticated by a shared API key in the `x-device-api-key` header
// (HR_DEVICE_API_KEY env var). This is the production path used by
// fingerprint/biometric terminals to push punches without a user session.
// The `/hr/attendance/webhook` route below remains for HR users who want
// to push punches manually from an authenticated UI.
hrPublicRouter.post("/hr/attendance/device-webhook", async (req, res) => {
  try {
    const expected = process.env.HR_DEVICE_API_KEY;
    const provided = req.header("x-device-api-key");
    if (!expected) return res.status(503).json({ error: "device webhook not configured" });
    if (!provided || provided !== expected) {
      return res.status(401).json({ error: "invalid device api key" });
    }
    const Body = z.object({
      employeeNo: z.string(),
      direction: z.enum(["in", "out"]),
      punchAt: z.string(),
      deviceId: z.string().nullish(),
    });
    const body = Body.parse(req.body);
    const [emp] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.employeeNo, body.employeeNo))
      .limit(1);
    if (!emp) return res.status(404).json({ error: "employee not found" });
    const [row] = await db
      .insert(attendancePunchesTable)
      .values({
        employeeId: emp.id,
        punchAt: new Date(body.punchAt),
        direction: body.direction,
        source: "device",
        deviceId: body.deviceId ?? null,
      })
      .returning();
    return res.status(201).json({ id: row.id });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

router.post("/hr/attendance/webhook", hrGuard, async (req, res) => {
  try {
    const Body = z.object({
      employeeNo: z.string(),
      direction: z.enum(["in", "out"]),
      punchAt: z.string(),
      deviceId: z.string().nullish(),
    });
    const body = Body.parse(req.body);
    const [emp] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.employeeNo, body.employeeNo))
      .limit(1);
    if (!emp) return res.status(404).json({ error: "الموظف غير موجود" });
    const [row] = await db
      .insert(attendancePunchesTable)
      .values({
        employeeId: emp.id,
        punchAt: new Date(body.punchAt),
        direction: body.direction,
        source: "webhook",
        deviceId: body.deviceId ?? null,
      })
      .returning();
    return res.status(201).json({ id: row.id });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// =========================================================================
// Loans / Advances
// =========================================================================
router.get("/hr/loans", hrReadGuard, async (req, res) => {
  const empId = req.query.employeeId ? Number(req.query.employeeId) : null;
  const where = empId ? eq(employeeLoansTable.employeeId, empId) : sql`true`;
  const rows = await db.select().from(employeeLoansTable).where(where).orderBy(desc(employeeLoansTable.createdAt));
  res.json(
    rows.map((r) => ({
      ...r,
      principal: num(r.principal),
      monthlyInstallment: num(r.monthlyInstallment),
      outstanding: num(r.outstanding),
      approvedAt: r.approvedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

const LoanBody = z.object({
  employeeId: z.number().int().positive(),
  kind: z.enum(["loan", "advance"]).default("loan"),
  principal: z.number().positive(),
  monthlyInstallment: z.number().positive(),
  startDate: z.string(),
  reason: z.string().nullish(),
});

router.post("/hr/loans", hrGuard, async (req, res) => {
  try {
    const body = LoanBody.parse(req.body);
    const reference = await nextRef("LN", new Date().getFullYear());
    const [row] = await db
      .insert(employeeLoansTable)
      .values({
        reference,
        employeeId: body.employeeId,
        kind: body.kind,
        principal: String(body.principal),
        monthlyInstallment: String(body.monthlyInstallment),
        outstanding: String(body.principal),
        startDate: body.startDate,
        reason: body.reason ?? null,
        approvedBy: req.session.userId ?? null,
        approvedAt: new Date(),
      })
      .returning();
    res.status(201).json({
      ...row,
      principal: num(row.principal),
      monthlyInstallment: num(row.monthlyInstallment),
      outstanding: num(row.outstanding),
      approvedAt: row.approvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// =========================================================================
// GOSI settings
// =========================================================================
router.get("/hr/gosi-settings", hrReadGuard, async (_req, res) => {
  const rows = await db.select().from(gosiSettingsTable).orderBy(desc(gosiSettingsTable.effectiveFrom));
  res.json(
    rows.map((r) => ({
      ...r,
      saudiEmployeeRate: num(r.saudiEmployeeRate),
      saudiEmployerRate: num(r.saudiEmployerRate),
      nonSaudiEmployerRate: num(r.nonSaudiEmployerRate),
      salaryCeiling: num(r.salaryCeiling),
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

const GosiBody = z.object({
  effectiveFrom: z.string(),
  saudiEmployeeRate: z.number().min(0).max(100),
  saudiEmployerRate: z.number().min(0).max(100),
  nonSaudiEmployerRate: z.number().min(0).max(100),
  salaryCeiling: z.number().positive(),
  notes: z.string().nullish(),
});

router.post("/hr/gosi-settings", adminGuard, async (req, res) => {
  try {
    const body = GosiBody.parse(req.body);
    // Deactivate previous rows so a single "active" row exists.
    await db.update(gosiSettingsTable).set({ isActive: false });
    const [row] = await db
      .insert(gosiSettingsTable)
      .values({
        effectiveFrom: body.effectiveFrom,
        saudiEmployeeRate: String(body.saudiEmployeeRate),
        saudiEmployerRate: String(body.saudiEmployerRate),
        nonSaudiEmployerRate: String(body.nonSaudiEmployerRate),
        salaryCeiling: String(body.salaryCeiling),
        isActive: true,
        notes: body.notes ?? null,
      })
      .returning();
    res.status(201).json({
      ...row,
      saudiEmployeeRate: num(row.saudiEmployeeRate),
      saudiEmployerRate: num(row.saudiEmployerRate),
      nonSaudiEmployerRate: num(row.nonSaudiEmployerRate),
      salaryCeiling: num(row.salaryCeiling),
      createdAt: row.createdAt.toISOString(),
    });
  } catch (err) {
    handleRouteError(err, res);
  }
});

// =========================================================================
// Payroll periods & runs
// =========================================================================
router.get("/hr/payroll-periods", payrollReadGuard, async (_req, res) => {
  const rows = await db.select().from(payrollPeriodsTable).orderBy(desc(payrollPeriodsTable.year), desc(payrollPeriodsTable.month));
  res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

// Two creation modes:
//   1) Calendar month   — pass year + month; start/end derived automatically.
//   2) Custom period    — pass name + startDate + endDate (e.g. weekly,
//      bi-weekly, mid-month bonus run, contractor cycle).
const PeriodBody = z
  .object({
    name: z.string().optional(),
    year: z.number().int().optional(),
    month: z.number().int().min(1).max(12).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    payDate: z.string().optional(),
  })
  .refine(
    (b) => (b.year && b.month) || (b.name && b.startDate && b.endDate),
    { message: "إما (السنة والشهر) أو (الاسم والتاريخين)" },
  );

router.post("/hr/payroll-periods", hrGuard, async (req, res) => {
  try {
    const body = PeriodBody.parse(req.body);
    const monthsAr = [
      "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
      "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
    ];
    let name: string;
    let year: number;
    let month: number;
    let startDate: string;
    let endDate: string;
    if (body.year && body.month) {
      const start = new Date(Date.UTC(body.year, body.month - 1, 1));
      const end = new Date(Date.UTC(body.year, body.month, 0));
      name = `${monthsAr[body.month - 1]} ${body.year}`;
      year = body.year;
      month = body.month;
      startDate = start.toISOString().slice(0, 10);
      endDate = end.toISOString().slice(0, 10);
    } else {
      startDate = body.startDate!;
      endDate = body.endDate!;
      const startD = new Date(startDate + "T00:00:00Z");
      year = startD.getUTCFullYear();
      month = startD.getUTCMonth() + 1;
      name = body.name!;
    }
    const [row] = await db
      .insert(payrollPeriodsTable)
      .values({
        name,
        year,
        month,
        startDate,
        endDate,
        payDate: body.payDate ?? endDate,
      })
      .returning();
    return res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

router.get("/hr/payroll-runs", payrollReadGuard, async (_req, res) => {
  const rows = await db
    .select({
      id: payrollRunsTable.id,
      reference: payrollRunsTable.reference,
      periodId: payrollRunsTable.periodId,
      periodName: payrollPeriodsTable.name,
      branchId: payrollRunsTable.branchId,
      status: payrollRunsTable.status,
      totalGross: payrollRunsTable.totalGross,
      totalDeductions: payrollRunsTable.totalDeductions,
      totalGosiEmployee: payrollRunsTable.totalGosiEmployee,
      totalGosiEmployer: payrollRunsTable.totalGosiEmployer,
      totalNet: payrollRunsTable.totalNet,
      employeeCount: payrollRunsTable.employeeCount,
      computedAt: payrollRunsTable.computedAt,
      approvedAt: payrollRunsTable.approvedAt,
      postedJournalId: payrollRunsTable.postedJournalId,
      postedAt: payrollRunsTable.postedAt,
      paidAt: payrollRunsTable.paidAt,
      paymentJournalId: payrollRunsTable.paymentJournalId,
      gosiJournalId: payrollRunsTable.gosiJournalId,
      gosiRemittedAt: payrollRunsTable.gosiRemittedAt,
      createdAt: payrollRunsTable.createdAt,
    })
    .from(payrollRunsTable)
    .leftJoin(payrollPeriodsTable, eq(payrollPeriodsTable.id, payrollRunsTable.periodId))
    .orderBy(desc(payrollRunsTable.createdAt));
  res.json(
    rows.map((r) => ({
      ...r,
      totalGross: num(r.totalGross),
      totalDeductions: num(r.totalDeductions),
      totalGosiEmployee: num(r.totalGosiEmployee),
      totalGosiEmployer: num(r.totalGosiEmployer),
      totalNet: num(r.totalNet),
      computedAt: r.computedAt?.toISOString() ?? null,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      postedAt: r.postedAt?.toISOString() ?? null,
      paidAt: r.paidAt?.toISOString() ?? null,
      gosiRemittedAt: r.gosiRemittedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

router.get("/hr/payroll-runs/:id/lines", payrollReadGuard, async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const rows = await db
      .select({
        id: payrollLinesTable.id,
        runId: payrollLinesTable.runId,
        employeeId: payrollLinesTable.employeeId,
        employeeNo: employeesTable.employeeNo,
        employeeName: employeesTable.nameAr,
        nationalityType: employeesTable.nationalityType,
        bankIban: employeesTable.bankIban,
        bankName: employeesTable.bankName,
        contractId: payrollLinesTable.contractId,
        workedDays: payrollLinesTable.workedDays,
        leaveWithoutPayDays: payrollLinesTable.leaveWithoutPayDays,
        overtimeHours: payrollLinesTable.overtimeHours,
        basicSalary: payrollLinesTable.basicSalary,
        housingAllowance: payrollLinesTable.housingAllowance,
        transportAllowance: payrollLinesTable.transportAllowance,
        otherAllowances: payrollLinesTable.otherAllowances,
        overtimeAmount: payrollLinesTable.overtimeAmount,
        grossPay: payrollLinesTable.grossPay,
        gosiBase: payrollLinesTable.gosiBase,
        gosiEmployee: payrollLinesTable.gosiEmployee,
        gosiEmployer: payrollLinesTable.gosiEmployer,
        lwpDeduction: payrollLinesTable.lwpDeduction,
        loanDeduction: payrollLinesTable.loanDeduction,
        otherDeductions: payrollLinesTable.otherDeductions,
        totalDeductions: payrollLinesTable.totalDeductions,
        netPay: payrollLinesTable.netPay,
      })
      .from(payrollLinesTable)
      .innerJoin(employeesTable, eq(employeesTable.id, payrollLinesTable.employeeId))
      .where(eq(payrollLinesTable.runId, id))
      .orderBy(asc(employeesTable.employeeNo));
    return res.json(
      rows.map((r) => ({
        ...r,
        workedDays: num(r.workedDays),
        leaveWithoutPayDays: num(r.leaveWithoutPayDays),
        overtimeHours: num(r.overtimeHours),
        basicSalary: num(r.basicSalary),
        housingAllowance: num(r.housingAllowance),
        transportAllowance: num(r.transportAllowance),
        otherAllowances: num(r.otherAllowances),
        overtimeAmount: num(r.overtimeAmount),
        grossPay: num(r.grossPay),
        gosiBase: num(r.gosiBase),
        gosiEmployee: num(r.gosiEmployee),
        gosiEmployer: num(r.gosiEmployer),
        lwpDeduction: num(r.lwpDeduction),
        loanDeduction: num(r.loanDeduction),
        otherDeductions: num(r.otherDeductions),
        totalDeductions: num(r.totalDeductions),
        netPay: num(r.netPay),
      })),
    );
  } catch (err) {
    return handleRouteError(err, res);
  }
});

const RunCreateBody = z.object({
  periodId: z.number().int().positive(),
  branchId: z.number().int().positive().nullish(),
});

// Compute monthly payroll: gross → GOSI → loans → LWP → net.
// Pro-rates for joiners/leavers within the period.
router.post("/hr/payroll-runs", hrGuard, async (req, res) => {
  try {
    const body = RunCreateBody.parse(req.body);
    const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, body.periodId)).limit(1);
    if (!period) return res.status(404).json({ error: "الفترة غير موجودة" });
    if (period.status === "closed") return res.status(400).json({ error: "الفترة مقفلة" });

    const [gosi] = await db
      .select()
      .from(gosiSettingsTable)
      .where(eq(gosiSettingsTable.isActive, true))
      .orderBy(desc(gosiSettingsTable.effectiveFrom))
      .limit(1);
    if (!gosi) return res.status(400).json({ error: "إعدادات GOSI غير مهيأة" });

    // Include any employee active during the period: that means status =
    // 'active', OR a terminated/leaver employee whose terminationDate is on
    // or after the period start AND whose hireDate is on or before the
    // period end. The compute loop below does the precise per-employee
    // proration; here we just need to NOT pre-exclude leavers who still
    // have earned wages (final pay / EOS run).
    const empConds: SQL[] = [
      or(
        eq(employeesTable.status, "active"),
        and(
          isNotNull(employeesTable.terminationDate),
          gte(employeesTable.terminationDate, period.startDate),
          lte(employeesTable.hireDate, period.endDate),
        )!,
      )!,
    ];
    if (body.branchId) empConds.push(eq(employeesTable.branchId, body.branchId));
    const employees = await db
      .select()
      .from(employeesTable)
      .where(and(...empConds));

    if (employees.length === 0) return res.status(400).json({ error: "لا يوجد موظفون مؤهلون لهذه الفترة" });

    const reference = await nextRef("PR", period.year);
    const [run] = await db
      .insert(payrollRunsTable)
      .values({
        companyId: getCompanyId(req),
        reference,
        periodId: body.periodId,
        branchId: body.branchId ?? null,
        status: "computed",
        computedAt: new Date(),
        createdBy: req.session.userId ?? null,
      })
      .returning();

    const periodStart = period.startDate;
    const periodEnd = period.endDate;
    const totalDaysInPeriod = daysBetween(periodStart, periodEnd);

    const saudiEeRate = num(gosi.saudiEmployeeRate) / 100;
    const saudiErRate = num(gosi.saudiEmployerRate) / 100;
    const nonSaudiErRate = num(gosi.nonSaudiEmployerRate) / 100;
    const ceiling = num(gosi.salaryCeiling);

    // Default fallback shift for employees with no explicit assignment.
    const [defaultShift] = await db
      .select()
      .from(shiftsTable)
      .where(eq(shiftsTable.isActive, true))
      .orderBy(asc(shiftsTable.id))
      .limit(1);

    let totGross = 0, totDed = 0, totEe = 0, totEr = 0, totNet = 0;
    let linesInserted = 0;

    for (const emp of employees) {
      // Skip employees hired after period end.
      if (emp.hireDate > periodEnd) continue;
      // Skip employees terminated before period start.
      if (emp.terminationDate && emp.terminationDate < periodStart) continue;

      // Latest active contract.
      const [contract] = await db
        .select()
        .from(contractsTable)
        .where(and(eq(contractsTable.employeeId, emp.id), eq(contractsTable.status, "active")))
        .orderBy(desc(contractsTable.startDate))
        .limit(1);
      if (!contract) continue;

      const effStart = emp.hireDate > periodStart ? emp.hireDate : periodStart;
      const effEnd = emp.terminationDate && emp.terminationDate < periodEnd ? emp.terminationDate : periodEnd;
      const workedDays = daysBetween(effStart, effEnd);
      const proration = workedDays / totalDaysInPeriod;

      const basic = num(contract.basicSalary) * proration;
      const housing = num(contract.housingAllowance) * proration;
      const transport = num(contract.transportAllowance) * proration;

      // Pull recurring salary components (allowances/deductions configured on
      // the contract — e.g. role allowance, mobile, fuel, fines, advances).
      const components = await db
        .select()
        .from(salaryComponentsTable)
        .where(and(eq(salaryComponentsTable.contractId, contract.id), eq(salaryComponentsTable.isActive, true)));
      let componentEarn = 0;
      let componentDed = 0;
      let componentGosiAdd = 0;
      for (const c of components) {
        const v = num(c.amount) * proration;
        if (c.kind === "earning") {
          componentEarn += v;
          if (c.includeInGosi) componentGosiAdd += v;
        } else {
          componentDed += v;
        }
      }
      const otherAllow = num(contract.otherAllowances) * proration + componentEarn;

      // Approved unpaid leave overlapping the period → LWP days.
      // Compute actual overlap in days (not the full request) so partial
      // overlaps (e.g. Apr 28 → May 3 against an April period) are charged
      // correctly to each pay period.
      const lwpRows = await db
        .select({
          startDate: leaveRequestsTable.startDate,
          endDate: leaveRequestsTable.endDate,
        })
        .from(leaveRequestsTable)
        .innerJoin(leaveTypesTable, eq(leaveTypesTable.id, leaveRequestsTable.leaveTypeId))
        .where(
          and(
            eq(leaveRequestsTable.employeeId, emp.id),
            eq(leaveRequestsTable.status, "approved"),
            eq(leaveTypesTable.isPaid, false),
            // overlap: req.start <= periodEnd AND req.end >= periodStart
            lte(leaveRequestsTable.startDate, periodEnd),
            gte(leaveRequestsTable.endDate, periodStart),
          ),
        );
      const lwpDays = lwpRows.reduce((acc, r) => {
        const ovStart = r.startDate > periodStart ? r.startDate : periodStart;
        const ovEnd = r.endDate < periodEnd ? r.endDate : periodEnd;
        const days = daysBetween(ovStart, ovEnd);
        return acc + Math.max(0, days);
      }, 0);
      const dailyRate = (basic + housing + transport + otherAllow) / Math.max(1, totalDaysInPeriod);
      const lwpDeduction = dailyRate * lwpDays;

      // Attendance-driven overtime. Pull punches in the period and compute
      // overtime minutes against the assigned shift (or the seeded default).
      const [shiftAssign] = await db
        .select({ shiftId: employeeShiftsTable.shiftId })
        .from(employeeShiftsTable)
        .where(
          and(
            eq(employeeShiftsTable.employeeId, emp.id),
            lte(employeeShiftsTable.effectiveFrom, periodEnd),
          ),
        )
        .orderBy(desc(employeeShiftsTable.effectiveFrom))
        .limit(1);
      let assignedShift = null as typeof defaultShift | null;
      if (shiftAssign) {
        const [s] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, shiftAssign.shiftId)).limit(1);
        assignedShift = s ?? defaultShift ?? null;
      } else {
        assignedShift = defaultShift ?? null;
      }
      let overtimeHours = 0;
      if (assignedShift) {
        const punches = await db
          .select()
          .from(attendancePunchesTable)
          .where(
            and(
              eq(attendancePunchesTable.employeeId, emp.id),
              gte(attendancePunchesTable.punchAt, new Date(periodStart + "T00:00:00Z")),
              lte(attendancePunchesTable.punchAt, new Date(periodEnd + "T23:59:59Z")),
            ),
          )
          .orderBy(asc(attendancePunchesTable.punchAt));
        const byDay = new Map<string, { in?: Date; out?: Date }>();
        for (const p of punches) {
          const key = p.punchAt.toISOString().slice(0, 10);
          const slot = byDay.get(key) ?? {};
          if (p.direction === "in" && !slot.in) slot.in = p.punchAt;
          if (p.direction === "out") slot.out = p.punchAt;
          byDay.set(key, slot);
        }
        const [sh, sm] = assignedShift.endTime.split(":").map(Number);
        const shiftEndMin = (sh ?? 17) * 60 + (sm ?? 0);
        let otMin = 0;
        for (const slot of byDay.values()) {
          if (slot.out) {
            const outMin = slot.out.getUTCHours() * 60 + slot.out.getUTCMinutes();
            if (outMin > shiftEndMin) otMin += outMin - shiftEndMin;
          }
        }
        overtimeHours = otMin / 60;
      }
      // Saudi Labor Law: overtime paid at 1.5× hourly basic rate.
      const hoursPerMonth = 30 * 8;
      const hourlyBasic = num(contract.basicSalary) / hoursPerMonth;
      const overtimeAmount = overtimeHours * hourlyBasic * 1.5;

      const grossPay = basic + housing + transport + otherAllow + overtimeAmount;

      // GOSI base: basic + housing capped at the legal ceiling. Only when the
      // contract opts in to GOSI.
      let gosiBase = 0, gosiEe = 0, gosiEr = 0;
      if (contract.gosiApplies) {
        gosiBase = Math.min(basic + housing + componentGosiAdd, ceiling);
        if (emp.nationalityType === "saudi") {
          gosiEe = gosiBase * saudiEeRate;
          gosiEr = gosiBase * saudiErRate;
        } else {
          // Non-Saudi: occupational hazard only (employer-only).
          gosiEr = gosiBase * nonSaudiErRate;
        }
      }

      // Loan installments due this month.
      const loans = await db
        .select()
        .from(employeeLoansTable)
        .where(and(eq(employeeLoansTable.employeeId, emp.id), eq(employeeLoansTable.status, "active")));
      let loanDed = 0;
      for (const loan of loans) {
        const installment = Math.min(num(loan.monthlyInstallment), num(loan.outstanding));
        loanDed += installment;
      }

      const totalDeductions = gosiEe + loanDed + lwpDeduction + componentDed;
      const netPay = grossPay - totalDeductions;

      const [line] = await db
        .insert(payrollLinesTable)
        .values({
          runId: run.id,
          employeeId: emp.id,
          contractId: contract.id,
          workedDays: String(workedDays),
          leaveWithoutPayDays: String(lwpDays),
          overtimeHours: overtimeHours.toFixed(2),
          overtimeAmount: overtimeAmount.toFixed(2),
          basicSalary: basic.toFixed(2),
          housingAllowance: housing.toFixed(2),
          transportAllowance: transport.toFixed(2),
          otherAllowances: otherAllow.toFixed(2),
          grossPay: grossPay.toFixed(2),
          gosiBase: gosiBase.toFixed(2),
          gosiEmployee: gosiEe.toFixed(2),
          gosiEmployer: gosiEr.toFixed(2),
          lwpDeduction: lwpDeduction.toFixed(2),
          loanDeduction: loanDed.toFixed(2),
          otherDeductions: componentDed.toFixed(2),
          totalDeductions: totalDeductions.toFixed(2),
          netPay: netPay.toFixed(2),
        })
        .returning();
      linesInserted += 1;

      // Detail rows for each deduction component (audit trail).
      const detail: Array<{ kind: string; description: string; amount: number; reference?: string }> = [];
      if (gosiEe > 0) detail.push({ kind: "gosi", description: "حصة الموظف من التأمينات", amount: gosiEe });
      if (lwpDeduction > 0) detail.push({ kind: "lwp", description: `إجازة بدون راتب ${lwpDays} يوم`, amount: lwpDeduction });
      for (const loan of loans) {
        const installment = Math.min(num(loan.monthlyInstallment), num(loan.outstanding));
        if (installment > 0) {
          detail.push({ kind: loan.kind === "advance" ? "advance" : "loan", description: `قسط ${loan.reference}`, amount: installment, reference: loan.reference });
        }
      }
      for (const d of detail) {
        await db.insert(payrollDeductionsTable).values({
          lineId: line.id,
          kind: d.kind,
          description: d.description,
          amount: d.amount.toFixed(2),
          reference: d.reference ?? null,
        });
      }

      // Generate payslip stub (PDF generation can hook in later).
      const payslipRef = `PS-${run.reference}-${emp.employeeNo}`;
      await db.insert(payslipsTable).values({
        companyId: getCompanyId(req),
        reference: payslipRef,
        runId: run.id,
        lineId: line.id,
        employeeId: emp.id,
      });

      totGross += grossPay;
      totDed += totalDeductions;
      totEe += gosiEe;
      totEr += gosiEr;
      totNet += netPay;
    }

    const [updated] = await db
      .update(payrollRunsTable)
      .set({
        totalGross: totGross.toFixed(2),
        totalDeductions: totDed.toFixed(2),
        totalGosiEmployee: totEe.toFixed(2),
        totalGosiEmployer: totEr.toFixed(2),
        totalNet: totNet.toFixed(2),
        employeeCount: linesInserted,
      })
      .where(eq(payrollRunsTable.id, run.id))
      .returning();

    return res.status(201).json({
      ...updated,
      totalGross: num(updated.totalGross),
      totalDeductions: num(updated.totalDeductions),
      totalGosiEmployee: num(updated.totalGosiEmployee),
      totalGosiEmployer: num(updated.totalGosiEmployer),
      totalNet: num(updated.totalNet),
      computedAt: updated.computedAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "compute payroll run");
    return handleRouteError(err, res);
  }
});

// Approve & post the payroll run as a balanced journal entry.
//   Salaries Expense           Dr  totalGross + gosiEmployer
//      GOSI Payable            Cr  gosiEmployee + gosiEmployer
//      Employee Advances       Cr  loanDeductions   (clears the receivable)
//      Salaries Payable        Cr  net (paid via WPS later → Bank)
router.post("/hr/payroll-runs/:id/post", financeGuard, async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, id)).limit(1);
    if (!run) return res.status(404).json({ error: "الجولة غير موجودة" });
    if (run.status !== "computed" && run.status !== "approved") {
      return res.status(400).json({ error: "لا يمكن ترحيل هذه الجولة" });
    }
    if (run.postedJournalId) return res.status(400).json({ error: "تم الترحيل مسبقاً" });

    const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, run.periodId)).limit(1);
    if (!period) return res.status(404).json({ error: "الفترة غير موجودة" });

    // Sum loan + LWP deductions per line. LWP reduces what was actually
    // earned, so it must reduce the salaries-expense debit (otherwise the JE
    // would be unbalanced for any run that has unpaid leave).
    const linesAgg = await db
      .select({
        loanSum: sql<string>`coalesce(sum(${payrollLinesTable.loanDeduction}), 0)`,
        lwpSum: sql<string>`coalesce(sum(${payrollLinesTable.lwpDeduction}), 0)`,
        otherSum: sql<string>`coalesce(sum(${payrollLinesTable.otherDeductions}), 0)`,
      })
      .from(payrollLinesTable)
      .where(eq(payrollLinesTable.runId, run.id));
    const loanTotal = num(linesAgg[0]?.loanSum);
    const lwpTotal = num(linesAgg[0]?.lwpSum);
    const otherTotal = num(linesAgg[0]?.otherSum);

    // Salaries expense = gross actually earned + employer GOSI.
    // LWP and component-level "other" deductions both reduce what was
    // actually earned by the employee, so they reduce the expense debit
    // (otherwise the JE would be unbalanced).
    //   debit  = (gross - lwp - other) + gosi_er
    //   credit = gosi_ee + gosi_er + loan + net
    // where net = gross - gosi_ee - lwp - loan - other.
    // → debit − credit = 0.
    const earnedGross = num(run.totalGross) - lwpTotal - otherTotal;
    const grossExp = earnedGross + num(run.totalGosiEmployer);
    const gosiPayable = num(run.totalGosiEmployee) + num(run.totalGosiEmployer);
    const netPayable = num(run.totalNet);

    const lines: Array<{
      systemKey: string;
      debit?: number;
      credit?: number;
      description: string;
    }> = [
      { systemKey: "salaries_expense", debit: grossExp, description: `Payroll ${run.reference}` },
      { systemKey: "gosi_payable", credit: gosiPayable, description: "GOSI contributions" },
    ];
    if (loanTotal > 0) {
      lines.push({ systemKey: "employee_advances", credit: loanTotal, description: "Employee loan recovery" });
    }
    lines.push({ systemKey: "salaries_payable", credit: netPayable, description: "Net salaries payable" });

    const { id: jeId, entryNumber } = await postJournalEntry(
      db,
      {
        entryDate: period.payDate,
        description: `Payroll run ${run.reference} (${period.name})`,
        reference: run.reference,
        source: "system",
        sourceRef: `payroll:${run.id}`,
        createdBy: req.session.userId ?? null,
        status: "posted",
        companyId: getCompanyId(req),
      },
      lines,
    );

    // Decrement loan outstanding amounts.
    const allLines = await db
      .select({ employeeId: payrollLinesTable.employeeId, loanDeduction: payrollLinesTable.loanDeduction })
      .from(payrollLinesTable)
      .where(eq(payrollLinesTable.runId, run.id));
    for (const l of allLines) {
      const ded = num(l.loanDeduction);
      if (ded <= 0) continue;
      const empLoans = await db
        .select()
        .from(employeeLoansTable)
        .where(and(eq(employeeLoansTable.employeeId, l.employeeId), eq(employeeLoansTable.status, "active")));
      let remaining = ded;
      for (const loan of empLoans) {
        if (remaining <= 0) break;
        const take = Math.min(num(loan.monthlyInstallment), num(loan.outstanding), remaining);
        const newOut = Math.max(0, num(loan.outstanding) - take);
        await db
          .update(employeeLoansTable)
          .set({ outstanding: newOut.toFixed(2), status: newOut === 0 ? "settled" : "active" })
          .where(eq(employeeLoansTable.id, loan.id));
        remaining -= take;
      }
    }

    const [updated] = await db
      .update(payrollRunsTable)
      .set({
        status: "posted",
        postedJournalId: jeId,
        postedAt: new Date(),
        approvedBy: req.session.userId ?? null,
        approvedAt: new Date(),
      })
      .where(eq(payrollRunsTable.id, id))
      .returning();

    return res.json({
      ...updated,
      totalGross: num(updated.totalGross),
      totalDeductions: num(updated.totalDeductions),
      totalGosiEmployee: num(updated.totalGosiEmployee),
      totalGosiEmployer: num(updated.totalGosiEmployer),
      totalNet: num(updated.totalNet),
      computedAt: updated.computedAt?.toISOString() ?? null,
      approvedAt: updated.approvedAt?.toISOString() ?? null,
      postedAt: updated.postedAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
      journalEntryNumber: entryNumber,
    });
  } catch (err) {
    req.log.error({ err }, "post payroll");
    return handleRouteError(err, res);
  }
});

// Mark as paid — records the WPS salary disbursement only. GOSI remittance
// is a separate obligation handled by /remit-gosi below.
//   Salaries Payable    Dr  totalNet
//      Bank             Cr  totalNet
router.post("/hr/payroll-runs/:id/mark-paid", financeGuard, async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, id)).limit(1);
    if (!run) return res.status(404).json({ error: "الجولة غير موجودة" });
    if (run.status !== "posted") {
      return res.status(400).json({ error: "يجب ترحيل الجولة قبل تسجيل الدفع" });
    }
    if (run.paymentJournalId) return res.status(400).json({ error: "تم تسجيل الدفع مسبقاً" });

    const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, run.periodId)).limit(1);
    const netPayable = num(run.totalNet);

    const payJeLines: Array<{ systemKey: string; debit?: number; credit?: number; description: string }> = [
      { systemKey: "salaries_payable", debit: netPayable, description: `Pay net salaries ${run.reference}` },
      { systemKey: "bank", credit: netPayable, description: `Payroll WPS payment ${run.reference}` },
    ];

    const { id: payJeId, entryNumber } = await postJournalEntry(
      db,
      {
        entryDate: period?.payDate ?? new Date().toISOString().slice(0, 10),
        description: `Payroll payment ${run.reference}`,
        reference: `PAY-${run.reference}`,
        source: "system",
        sourceRef: `payroll-pay:${run.id}`,
        createdBy: req.session.userId ?? null,
        status: "posted",
        companyId: getCompanyId(req),
      },
      payJeLines,
    );

    const [updated] = await db
      .update(payrollRunsTable)
      .set({ status: "paid", paidAt: new Date(), paymentJournalId: payJeId })
      .where(eq(payrollRunsTable.id, id))
      .returning();
    // Module hook: WhatsApp/SMS payslip notice to each employee in
    // the run. Fire-and-forget so the API response is never blocked
    // by per-employee delivery latency.
    void notifyEmployeesPayrollPaid(updated.id);
    return res.json({ ok: true, journalEntryNumber: entryNumber, runId: updated.id });
  } catch (err) {
    req.log.error({ err }, "mark payroll paid");
    return handleRouteError(err, res);
  }
});

// Remit GOSI — separate from salary disbursement. Records the actual
// payment of GOSI contributions to the GOSI authority:
//   GOSI Payable        Dr  gosiEmployee + gosiEmployer
//      Bank             Cr  same
router.post("/hr/payroll-runs/:id/remit-gosi", financeGuard, async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, id)).limit(1);
    if (!run) return res.status(404).json({ error: "الجولة غير موجودة" });
    if (run.status !== "posted" && run.status !== "paid") {
      return res.status(400).json({ error: "يجب ترحيل الجولة قبل تحويل التأمينات" });
    }
    if (run.gosiJournalId) return res.status(400).json({ error: "تم تحويل التأمينات مسبقاً" });

    const gosiTotal = num(run.totalGosiEmployee) + num(run.totalGosiEmployer);
    if (gosiTotal <= 0) return res.status(400).json({ error: "لا توجد تأمينات للتحويل" });

    const { id: gosiJeId, entryNumber } = await postJournalEntry(
      db,
      {
        entryDate: new Date().toISOString().slice(0, 10),
        description: `GOSI remittance ${run.reference}`,
        reference: `GOSI-${run.reference}`,
        source: "system",
        sourceRef: `payroll-gosi:${run.id}`,
        createdBy: req.session.userId ?? null,
        status: "posted",
        companyId: getCompanyId(req),
      },
      [
        { systemKey: "gosi_payable", debit: gosiTotal, description: "Remit GOSI contributions" },
        { systemKey: "bank", credit: gosiTotal, description: `GOSI remittance ${run.reference}` },
      ],
    );

    await db
      .update(payrollRunsTable)
      .set({ gosiJournalId: gosiJeId, gosiRemittedAt: new Date() })
      .where(eq(payrollRunsTable.id, id));
    return res.json({ ok: true, journalEntryNumber: entryNumber });
  } catch (err) {
    req.log.error({ err }, "remit gosi");
    return handleRouteError(err, res);
  }
});

// =========================================================================
// WPS export (SARIE-compatible CSV)
// =========================================================================
router.get("/hr/payroll-runs/:id/wps", payrollReadGuard, async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, id)).limit(1);
    if (!run) return res.status(404).json({ error: "الجولة غير موجودة" });
    const [period] = await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, run.periodId)).limit(1);

    const rows = await db
      .select({
        employeeNo: employeesTable.employeeNo,
        nameAr: employeesTable.nameAr,
        name: employeesTable.name,
        nationalId: employeesTable.nationalId,
        bankIban: employeesTable.bankIban,
        bankName: employeesTable.bankName,
        basicSalary: payrollLinesTable.basicSalary,
        housingAllowance: payrollLinesTable.housingAllowance,
        otherAllowances: payrollLinesTable.otherAllowances,
        netPay: payrollLinesTable.netPay,
      })
      .from(payrollLinesTable)
      .innerJoin(employeesTable, eq(employeesTable.id, payrollLinesTable.employeeId))
      .where(eq(payrollLinesTable.runId, id));

    // SARIE-WPS / SIF v2 file: HDR (file header), columns header, EMP detail
    // rows, TRL (file trailer with totals). Hijri pay date included for the
    // bank reconciliation team. Producing fields in the exact column order
    // expected by the SIF schema so banks can ingest with their standard
    // mappers.
    const totalGross = num(run.totalGross);
    const totalNetCalc = num(run.totalNet);
    const hijriPay = period?.payDate ? toHijri(period.payDate).formatted : "";
    const hdr = [
      "HDR",
      run.reference,
      period?.payDate ?? "",
      hijriPay,
      "SAR",
      String(rows.length),
      totalGross.toFixed(2),
      totalNetCalc.toFixed(2),
    ].join(",");
    const header = [
      "Record Type",
      "Employee ID",
      "Employee Name",
      "National ID",
      "IBAN",
      "Bank Name",
      "Basic Salary",
      "Housing Allowance",
      "Other Allowances",
      "Net Salary",
      "Pay Date",
      "Pay Date (Hijri)",
      "Currency",
    ];
    const lines: string[] = [hdr, header.join(",")];
    for (const r of rows) {
      lines.push(
        [
          "EMP",
          r.employeeNo,
          (r.name ?? r.nameAr ?? "").replace(/,/g, " "),
          r.nationalId ?? "",
          r.bankIban ?? "",
          (r.bankName ?? "").replace(/,/g, " "),
          num(r.basicSalary).toFixed(2),
          num(r.housingAllowance).toFixed(2),
          num(r.otherAllowances).toFixed(2),
          num(r.netPay).toFixed(2),
          period?.payDate ?? "",
          hijriPay,
          "SAR",
        ].join(","),
      );
    }
    const totalNet = rows.reduce((acc, r) => acc + num(r.netPay), 0);
    lines.push(`TRL,${rows.length},,,,,,,,${totalNet.toFixed(2)},${period?.payDate ?? ""},${hijriPay},SAR`);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="wps-${run.reference}.csv"`);
    return res.send(lines.join("\n"));
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// =========================================================================
// Payslips
// =========================================================================
router.get("/hr/payslips", async (req, res) => {
  const empId = req.query.employeeId ? Number(req.query.employeeId) : null;
  const where = empId ? eq(payslipsTable.employeeId, empId) : sql`true`;
  const rows = await db
    .select({
      id: payslipsTable.id,
      reference: payslipsTable.reference,
      runId: payslipsTable.runId,
      runReference: payrollRunsTable.reference,
      lineId: payslipsTable.lineId,
      employeeId: payslipsTable.employeeId,
      employeeName: employeesTable.nameAr,
      grossPay: payrollLinesTable.grossPay,
      totalDeductions: payrollLinesTable.totalDeductions,
      netPay: payrollLinesTable.netPay,
      periodName: payrollPeriodsTable.name,
      fileUrl: payslipsTable.fileUrl,
      emailedAt: payslipsTable.emailedAt,
      createdAt: payslipsTable.createdAt,
    })
    .from(payslipsTable)
    .innerJoin(employeesTable, eq(employeesTable.id, payslipsTable.employeeId))
    .innerJoin(payrollLinesTable, eq(payrollLinesTable.id, payslipsTable.lineId))
    .innerJoin(payrollRunsTable, eq(payrollRunsTable.id, payslipsTable.runId))
    .innerJoin(payrollPeriodsTable, eq(payrollPeriodsTable.id, payrollRunsTable.periodId))
    .where(where)
    .orderBy(desc(payslipsTable.createdAt));

  // Visibility per requirements: only owner / manager / hr can see all
  // payslips. Every other role (accountant, auditor, sales, cashier, etc.)
  // can only see their own — and only when their user is linked to an
  // employee record.
  const role = req.session.role;
  const userId = req.session.userId;
  let visibleRows = rows;
  if (!isPayslipPrivileged(role)) {
    if (!userId) return res.json([]);
    const [ownEmp] = await db
      .select({ id: employeesTable.id })
      .from(employeesTable)
      .where(eq(employeesTable.userId, userId))
      .limit(1);
    if (!ownEmp) return res.json([]);
    visibleRows = rows.filter((r) => r.employeeId === ownEmp.id);
  }

  return res.json(
    visibleRows.map((r) => ({
      ...r,
      grossPay: num(r.grossPay),
      totalDeductions: num(r.totalDeductions),
      netPay: num(r.netPay),
      emailedAt: r.emailedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// =========================================================================
// End-of-Service (نهاية الخدمة) calculator
//   < 5 years: 0.5 month per year (basic + housing)
//   >= 5 years: full month per year for years > 5
// =========================================================================
router.get("/hr/employees/:id/eos", hrReadGuard, async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const companyId = getCompanyId(req);
    // Cross-tenant IDOR defense: scope the EOS lookup to (id, companyId)
    // so probing another tenant's employee id collapses to 404.
    const [emp] = await db
      .select()
      .from(employeesTable)
      .where(and(eq(employeesTable.id, id), eq(employeesTable.companyId, companyId)))
      .limit(1);
    if (!emp) return res.status(404).json({ error: "الموظف غير موجود" });
    const [contract] = await db
      .select()
      .from(contractsTable)
      .where(eq(contractsTable.employeeId, id))
      .orderBy(desc(contractsTable.startDate))
      .limit(1);
    if (!contract) return res.status(400).json({ error: "لا يوجد عقد" });

    const today = new Date();
    const start = new Date(emp.hireDate);
    const end = emp.terminationDate ? new Date(emp.terminationDate) : today;
    const yearsExact = (end.getTime() - start.getTime()) / (365.25 * 86_400_000);

    const monthlyBase = num(contract.basicSalary) + num(contract.housingAllowance);
    let award = 0;
    if (yearsExact <= 5) {
      award = monthlyBase * 0.5 * yearsExact;
    } else {
      award = monthlyBase * 0.5 * 5 + monthlyBase * (yearsExact - 5);
    }

    return res.json({
      employeeId: id,
      hireDate: emp.hireDate,
      asOfDate: end.toISOString().slice(0, 10),
      yearsOfService: Number(yearsExact.toFixed(2)),
      monthlyBase,
      eosAward: Number(award.toFixed(2)),
      breakdown: {
        firstFiveYearsRate: "0.5 شهر / سنة",
        afterFiveYearsRate: "شهر كامل / سنة",
      },
    });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// =========================================================================
// Expiry alerts (Iqama / passport / contract)
// =========================================================================
router.get("/hr/expiry-alerts", hrReadGuard, async (req, res) => {
  const days = req.query.days ? Number(req.query.days) : 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const iqama = await db
    .select({
      id: employeesTable.id,
      name: employeesTable.nameAr,
      employeeNo: employeesTable.employeeNo,
      expiryDate: employeesTable.iqamaExpiry,
      kind: sql<string>`'iqama'`,
    })
    .from(employeesTable)
    .where(
      and(
        sql`${employeesTable.iqamaExpiry} IS NOT NULL`,
        lte(employeesTable.iqamaExpiry, cutoffStr),
      ),
    );

  const passport = await db
    .select({
      id: employeesTable.id,
      name: employeesTable.nameAr,
      employeeNo: employeesTable.employeeNo,
      expiryDate: employeesTable.passportExpiry,
      kind: sql<string>`'passport'`,
    })
    .from(employeesTable)
    .where(
      and(
        sql`${employeesTable.passportExpiry} IS NOT NULL`,
        lte(employeesTable.passportExpiry, cutoffStr),
      ),
    );

  const contracts = await db
    .select({
      id: contractsTable.id,
      employeeId: contractsTable.employeeId,
      name: employeesTable.nameAr,
      employeeNo: employeesTable.employeeNo,
      reference: contractsTable.reference,
      expiryDate: contractsTable.endDate,
      kind: sql<string>`'contract'`,
    })
    .from(contractsTable)
    .innerJoin(employeesTable, eq(employeesTable.id, contractsTable.employeeId))
    .where(
      and(
        sql`${contractsTable.endDate} IS NOT NULL`,
        lte(contractsTable.endDate, cutoffStr),
        eq(contractsTable.status, "active"),
      ),
    );

  const all = [...iqama, ...passport, ...contracts]
    .map((r) => ({
      ...r,
      isOverdue: r.expiryDate ? r.expiryDate < today : false,
    }))
    .sort((a, b) => (a.expiryDate ?? "").localeCompare(b.expiryDate ?? ""));

  res.json(all);
});

// =========================================================================
// Reports: Saudization (Nitaqat) snapshot
// =========================================================================
router.get("/hr/reports/saudization", hrReadGuard, async (_req, res) => {
  const rows = await db
    .select({
      branchId: employeesTable.branchId,
      branchName: branchesTable.nameAr,
      total: sql<number>`count(*)`,
      saudis: sql<number>`count(*) filter (where ${employeesTable.nationalityType} = 'saudi')`,
    })
    .from(employeesTable)
    .leftJoin(branchesTable, eq(branchesTable.id, employeesTable.branchId))
    .where(eq(employeesTable.status, "active"))
    .groupBy(employeesTable.branchId, branchesTable.nameAr);

  res.json(
    rows.map((r) => {
      const total = Number(r.total) || 0;
      const saudis = Number(r.saudis) || 0;
      const ratio = total > 0 ? saudis / total : 0;
      // Rough Nitaqat color bands. Real bands depend on activity & company size.
      let band: "platinum" | "green" | "yellow" | "red";
      if (ratio >= 0.4) band = "platinum";
      else if (ratio >= 0.25) band = "green";
      else if (ratio >= 0.1) band = "yellow";
      else band = "red";
      return {
        branchId: r.branchId,
        branchName: r.branchName,
        total,
        saudis,
        nonSaudis: total - saudis,
        saudizationRatio: Number((ratio * 100).toFixed(2)),
        nitaqatBand: band,
      };
    }),
  );
});

router.get("/hr/reports/payroll-register", payrollReadGuard, async (req, res) => {
  const periodId = req.query.periodId ? Number(req.query.periodId) : null;
  if (!periodId) return res.status(400).json({ error: "periodId مطلوب" });
  const runs = await db
    .select()
    .from(payrollRunsTable)
    .where(eq(payrollRunsTable.periodId, periodId));
  const runIds = runs.map((r) => r.id);
  if (runIds.length === 0) return res.json({ runs: [], lines: [] });

  const lines = await db
    .select({
      runId: payrollLinesTable.runId,
      employeeNo: employeesTable.employeeNo,
      employeeName: employeesTable.nameAr,
      grossPay: payrollLinesTable.grossPay,
      gosiEmployee: payrollLinesTable.gosiEmployee,
      gosiEmployer: payrollLinesTable.gosiEmployer,
      totalDeductions: payrollLinesTable.totalDeductions,
      netPay: payrollLinesTable.netPay,
    })
    .from(payrollLinesTable)
    .innerJoin(employeesTable, eq(employeesTable.id, payrollLinesTable.employeeId))
    .where(sql`${payrollLinesTable.runId} = ANY(${runIds})`);

  return res.json({
    runs: runs.map((r) => ({ id: r.id, reference: r.reference, status: r.status })),
    lines: lines.map((l) => ({
      ...l,
      grossPay: num(l.grossPay),
      gosiEmployee: num(l.gosiEmployee),
      gosiEmployer: num(l.gosiEmployer),
      totalDeductions: num(l.totalDeductions),
      netPay: num(l.netPay),
    })),
  });
});

// =========================================================================
// Employee documents (contracts, iqama scans, certificates, photos, etc.)
// =========================================================================
router.get("/hr/employees/:id/documents", hrReadGuard, async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const rows = await db
      .select()
      .from(employeeDocumentsTable)
      .where(eq(employeeDocumentsTable.employeeId, id))
      .orderBy(desc(employeeDocumentsTable.uploadedAt));
    return res.json(
      rows.map((r) => ({
        ...r,
        uploadedAt: r.uploadedAt.toISOString(),
      })),
    );
  } catch (err) {
    return handleRouteError(err, res);
  }
});

const DocumentBody = z.object({
  employeeId: z.number().int().positive(),
  docType: z.enum(["contract", "iqama", "passport", "certificate", "photo", "other"]),
  title: z.string().min(1),
  fileUrl: z.string().min(1),
  expiryDate: z.string().nullish(),
});

router.post("/hr/employee-documents", hrGuard, async (req, res) => {
  try {
    const body = DocumentBody.parse(req.body);
    const [row] = await db
      .insert(employeeDocumentsTable)
      .values({
        companyId: getCompanyId(req),
        employeeId: body.employeeId,
        docType: body.docType,
        title: body.title,
        fileUrl: body.fileUrl,
        expiryDate: body.expiryDate ?? null,
      })
      .returning();
    return res.status(201).json({ ...row, uploadedAt: row.uploadedAt.toISOString() });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

router.delete("/hr/employee-documents/:id", hrGuard, async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const [row] = await db
      .delete(employeeDocumentsTable)
      .where(and(eq(employeeDocumentsTable.id, id), eq(employeeDocumentsTable.companyId, getCompanyId(req))))
      .returning();
    if (!row) return res.status(404).json({ error: "المستند غير موجود" });
    return res.json({ ok: true });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// =========================================================================
// Attendance summary engine (late / early / overtime / absent days)
// Aggregates raw punches against each employee's assigned shift; falls back
// to the seeded default shift only when no assignment exists.
// =========================================================================
router.get("/hr/attendance/summary", hrReadGuard, async (req, res) => {
  try {
    const Q = z.object({
      employeeId: z.coerce.number().int().positive().optional(),
      from: z.string(),
      to: z.string(),
    });
    const q = Q.parse(req.query);

    const [defaultShift] = await db
      .select()
      .from(shiftsTable)
      .where(eq(shiftsTable.isActive, true))
      .orderBy(asc(shiftsTable.id))
      .limit(1);

    const empConds: SQL[] = [eq(employeesTable.status, "active")];
    if (q.employeeId) empConds.push(eq(employeesTable.id, q.employeeId));
    const emps = await db.select().from(employeesTable).where(and(...empConds));

    const fromMs = new Date(q.from + "T00:00:00Z").getTime();
    const toMs = new Date(q.to + "T23:59:59Z").getTime();

    const summaries = [] as Array<{
      employeeId: number;
      employeeName: string;
      employeeNo: string;
      shiftName: string;
      workingDays: number;
      presentDays: number;
      absentDays: number;
      lateMinutes: number;
      earlyLeaveMinutes: number;
      overtimeHours: number;
    }>;

    const parseHm = (s: string) => {
      const [h, m] = s.split(":").map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    };

    for (const emp of emps) {
      // Resolve the employee's assigned shift effective during the period.
      const [assign] = await db
        .select({ shiftId: employeeShiftsTable.shiftId })
        .from(employeeShiftsTable)
        .where(
          and(
            eq(employeeShiftsTable.employeeId, emp.id),
            lte(employeeShiftsTable.effectiveFrom, q.to),
          ),
        )
        .orderBy(desc(employeeShiftsTable.effectiveFrom))
        .limit(1);
      let shift = defaultShift ?? null;
      if (assign) {
        const [s] = await db.select().from(shiftsTable).where(eq(shiftsTable.id, assign.shiftId)).limit(1);
        if (s) shift = s;
      }
      const shiftStart = parseHm(shift?.startTime ?? "09:00");
      const shiftEnd = parseHm(shift?.endTime ?? "17:00");
      const workingDayCodes = (shift?.workingDays ?? "0,1,2,3,4")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => !Number.isNaN(n));
      const punches = await db
        .select()
        .from(attendancePunchesTable)
        .where(
          and(
            eq(attendancePunchesTable.employeeId, emp.id),
            gte(attendancePunchesTable.punchAt, new Date(fromMs)),
            lte(attendancePunchesTable.punchAt, new Date(toMs)),
          ),
        )
        .orderBy(asc(attendancePunchesTable.punchAt));

      // Group punches by YYYY-MM-DD
      const byDay = new Map<string, { in?: Date; out?: Date }>();
      for (const p of punches) {
        const key = p.punchAt.toISOString().slice(0, 10);
        const slot = byDay.get(key) ?? {};
        if (p.direction === "in" && !slot.in) slot.in = p.punchAt;
        if (p.direction === "out") slot.out = p.punchAt;
        byDay.set(key, slot);
      }

      let workingDays = 0;
      let lateMin = 0;
      let earlyMin = 0;
      let overtimeMin = 0;
      let presentDays = 0;
      const cursor = new Date(fromMs);
      const endCursor = new Date(toMs);
      while (cursor <= endCursor) {
        const dow = cursor.getUTCDay();
        const isWorkDay = workingDayCodes.includes(dow);
        if (isWorkDay) workingDays++;
        const key = cursor.toISOString().slice(0, 10);
        const slot = byDay.get(key);
        if (slot?.in) {
          presentDays++;
          const inMin = slot.in.getUTCHours() * 60 + slot.in.getUTCMinutes();
          if (inMin > shiftStart) lateMin += inMin - shiftStart;
          if (slot.out) {
            const outMin = slot.out.getUTCHours() * 60 + slot.out.getUTCMinutes();
            if (outMin < shiftEnd) earlyMin += shiftEnd - outMin;
            if (outMin > shiftEnd) overtimeMin += outMin - shiftEnd;
          }
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      summaries.push({
        employeeId: emp.id,
        employeeName: emp.nameAr,
        employeeNo: emp.employeeNo,
        shiftName: shift?.nameAr ?? "—",
        workingDays,
        presentDays,
        absentDays: Math.max(0, workingDays - presentDays),
        lateMinutes: lateMin,
        earlyLeaveMinutes: earlyMin,
        overtimeHours: Number((overtimeMin / 60).toFixed(2)),
      });
    }

    return res.json(summaries);
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// =========================================================================
// Payslip viewer — returns the full payslip data needed to render a printable
// payslip in the browser (employee block, run details, line breakdown, hijri
// pay date). Permission: privileged HR roles or the employee themselves.
// =========================================================================
router.get("/hr/payslips/:id/view", async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const [slip] = await db
      .select()
      .from(payslipsTable)
      .where(eq(payslipsTable.id, id))
      .limit(1);
    if (!slip) return res.status(404).json({ error: "بيان الراتب غير موجود" });

    if (!isPayslipPrivileged(req.session.role)) {
      const userId = req.session.userId;
      if (!userId) return res.status(403).json({ error: "ليس لديك صلاحية" });
      const [ownEmp] = await db
        .select({ id: employeesTable.id })
        .from(employeesTable)
        .where(eq(employeesTable.userId, userId))
        .limit(1);
      if (!ownEmp || ownEmp.id !== slip.employeeId) {
        return res.status(403).json({ error: "ليس لديك صلاحية" });
      }
    }

    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, slip.employeeId)).limit(1);
    const [line] = await db.select().from(payrollLinesTable).where(eq(payrollLinesTable.id, slip.lineId)).limit(1);
    const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, slip.runId)).limit(1);
    const [period] = run
      ? await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, run.periodId)).limit(1)
      : [];

    if (!emp || !line || !run || !period) {
      return res.status(404).json({ error: "البيانات غير مكتملة" });
    }

    return res.json({
      reference: slip.reference,
      issuedAt: slip.createdAt.toISOString(),
      employee: {
        id: emp.id,
        employeeNo: emp.employeeNo,
        name: emp.name,
        nameAr: emp.nameAr,
        nationalId: emp.nationalId,
        nationalityType: emp.nationalityType,
        bankIban: emp.bankIban,
        bankName: emp.bankName,
      },
      period: {
        name: period.name,
        startDate: period.startDate,
        endDate: period.endDate,
        payDate: period.payDate,
        payDateHijri: toHijri(period.payDate).formatted,
      },
      run: { reference: run.reference, status: run.status },
      earnings: {
        basicSalary: num(line.basicSalary),
        housingAllowance: num(line.housingAllowance),
        transportAllowance: num(line.transportAllowance),
        otherAllowances: num(line.otherAllowances),
        overtimeAmount: num(line.overtimeAmount),
        grossPay: num(line.grossPay),
      },
      deductions: {
        gosiEmployee: num(line.gosiEmployee),
        lwpDeduction: num(line.lwpDeduction),
        loanDeduction: num(line.loanDeduction),
        otherDeductions: num(line.otherDeductions),
        totalDeductions: num(line.totalDeductions),
      },
      employer: {
        gosiEmployer: num(line.gosiEmployer),
        gosiBase: num(line.gosiBase),
      },
      attendance: {
        workedDays: num(line.workedDays),
        leaveWithoutPayDays: num(line.leaveWithoutPayDays),
        overtimeHours: num(line.overtimeHours),
      },
      netPay: num(line.netPay),
    });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// Real PDF payslip — generated server-side with pdfkit so reviewers /
// employees get a binary PDF artifact rather than a print-to-PDF HTML
// shim. The Arabic labels are written via right-aligned columns so the
// output is readable even though pdfkit's RTL handling is limited.
router.get("/hr/payslips/:id/pdf", async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const [slip] = await db.select().from(payslipsTable).where(eq(payslipsTable.id, id)).limit(1);
    if (!slip) return res.status(404).send("not found");
    if (!isPayslipPrivileged(req.session.role)) {
      const userId = req.session.userId;
      if (!userId) return res.status(403).send("forbidden");
      const [ownEmp] = await db
        .select({ id: employeesTable.id })
        .from(employeesTable)
        .where(eq(employeesTable.userId, userId))
        .limit(1);
      if (!ownEmp || ownEmp.id !== slip.employeeId) return res.status(403).send("forbidden");
    }
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, slip.employeeId)).limit(1);
    const [line] = await db.select().from(payrollLinesTable).where(eq(payrollLinesTable.id, slip.lineId)).limit(1);
    const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, slip.runId)).limit(1);
    const [period] = run
      ? await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, run.periodId)).limit(1)
      : [];
    if (!emp || !line || !run || !period) return res.status(404).send("incomplete");

    type PDFDoc = {
      fontSize: (n: number) => PDFDoc;
      text: (s: string, opts?: object) => PDFDoc;
      moveDown: (n?: number) => PDFDoc;
      pipe: (dest: unknown) => PDFDoc;
      end: () => void;
      font: (n: string) => PDFDoc;
      fillColor: (c: string) => PDFDoc;
      registerFont: (name: string, src: Buffer) => PDFDoc;
    };
    const PDFDocumentMod = (await import("pdfkit")) as unknown as {
      default: new (opts?: object) => PDFDoc;
    };
    const doc: PDFDoc = new PDFDocumentMod.default({ size: "A4", margin: 40 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="payslip-${slip.reference}.pdf"`);
    doc.pipe(res);

    const { useReg, useBold, T } = registerArabicFonts(doc);

    const fmt = (n: string | number) =>
      num(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const hijri = toHijri(period.payDate).formatted;

    // Branded company header (logo + bilingual name + VAT) so payslips
    // match the rest of the document set (invoices / reports / exports).
    const { drawBrandedHeader, loadBrand } = await import("../lib/pdf/branding-header");
    const company = await loadBrand();
    drawBrandedHeader(doc as unknown as Parameters<typeof drawBrandedHeader>[0], company, {
      title: `Payslip / بيان راتب — ${slip.reference}`,
    });

    useReg();
    doc.fontSize(10).fillColor("#555")
      .text(T(`Run: ${run.reference}   Period: ${period.name}   Pay date: ${period.payDate} (Hijri ${hijri})`))
      .moveDown(0.5).fillColor("#000");
    doc.fontSize(11)
      .text(T(`Employee: ${emp.nameAr ?? emp.name} (${emp.employeeNo})`))
      .text(T(`National ID: ${emp.nationalId ?? "—"}`))
      .text(T(`IBAN: ${emp.bankIban ?? "—"}   Bank: ${emp.bankName ?? "—"}`))
      .text(T(`Worked days: ${num(line.workedDays)}   LWP days: ${num(line.leaveWithoutPayDays)}   OT hours: ${num(line.overtimeHours)}`))
      .moveDown(0.5);

    const writeRow = (label: string, amount: string | number) => {
      doc.fontSize(11).text(`${T(label).padEnd(45, " ")} ${fmt(amount).padStart(15, " ")}`);
    };

    useBold();
    doc.text(T("Earnings / الاستحقاقات"));
    useReg();
    writeRow("Basic salary / الراتب الأساسي", line.basicSalary);
    writeRow("Housing allowance / بدل سكن", line.housingAllowance);
    writeRow("Transport allowance / بدل مواصلات", line.transportAllowance);
    writeRow("Other allowances / بدلات أخرى", line.otherAllowances);
    writeRow("Overtime amount / قيمة الإضافي", line.overtimeAmount);
    useBold();
    writeRow("Gross / إجمالي الاستحقاقات", line.grossPay);
    useReg();
    doc.moveDown(0.5);

    useBold();
    doc.text(T("Deductions / الخصومات"));
    useReg();
    writeRow("GOSI (employee) / تأمينات الموظف", line.gosiEmployee);
    writeRow("LWP / إجازة بدون راتب", line.lwpDeduction);
    writeRow("Loan installment / قسط القرض", line.loanDeduction);
    writeRow("Other / خصومات أخرى", line.otherDeductions);
    useBold();
    writeRow("Total deductions / إجمالي الخصومات", line.totalDeductions);
    useReg();
    doc.moveDown(0.5);

    useBold();
    doc.fontSize(13);
    writeRow("NET PAY / صافي الراتب (SAR)", line.netPay);
    useReg();
    doc.fontSize(9).fillColor("#666")
      .text(T(`Employer GOSI / حصة الشركة من التأمينات: ${fmt(line.gosiEmployer)}`))
      .text(T(`Issued ${slip.createdAt.toISOString().slice(0, 10)} — حاسبة.AI`));

    doc.end();
    return;
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// Printable HTML payslip — kept for print-from-browser use cases and as a
// fallback for users who want full RTL Arabic styling.
router.get("/hr/payslips/:id/print", async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const [slip] = await db.select().from(payslipsTable).where(eq(payslipsTable.id, id)).limit(1);
    if (!slip) return res.status(404).send("not found");
    if (!isPayslipPrivileged(req.session.role)) {
      const userId = req.session.userId;
      if (!userId) return res.status(403).send("forbidden");
      const [ownEmp] = await db
        .select({ id: employeesTable.id })
        .from(employeesTable)
        .where(eq(employeesTable.userId, userId))
        .limit(1);
      if (!ownEmp || ownEmp.id !== slip.employeeId) return res.status(403).send("forbidden");
    }
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, slip.employeeId)).limit(1);
    const [line] = await db.select().from(payrollLinesTable).where(eq(payrollLinesTable.id, slip.lineId)).limit(1);
    const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, slip.runId)).limit(1);
    const [period] = run
      ? await db.select().from(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, run.periodId)).limit(1)
      : [];
    if (!emp || !line || !run || !period) return res.status(404).send("incomplete");

    const fmt = (n: string | number) => num(n).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    // Escape every dynamic field before interpolation. Employee master data
    // is operator-controlled and could otherwise inject HTML/JS into the
    // printable page (stored XSS for HR/finance reviewers).
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return s.replace(/[&<>"']/g, (c) =>
        c === "&" ? "&amp;" :
        c === "<" ? "&lt;" :
        c === ">" ? "&gt;" :
        c === '"' ? "&quot;" : "&#39;",
      );
    };
    const hijri = toHijri(period.payDate).formatted;
    const html = `<!doctype html><html dir="rtl" lang="ar"><head>
<meta charset="utf-8"/><title>بيان راتب ${esc(slip.reference)}</title>
<style>
  body{font-family:'Segoe UI',Tahoma,sans-serif;margin:30px;color:#111}
  h1{font-size:20px;margin:0 0 4px}
  .muted{color:#666;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:16px}
  th,td{border:1px solid #ddd;padding:8px;text-align:right;font-size:13px}
  th{background:#f5f5f5}
  .net{font-weight:bold;background:#eef9ee}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
  .box{border:1px solid #eee;padding:10px;border-radius:6px}
  @media print{button{display:none}}
</style></head><body>
<button onclick="window.print()">طباعة / حفظ PDF</button>
<h1>بيان راتب — ${esc(slip.reference)}</h1>
<div class="muted">جولة: ${esc(run.reference)} • فترة: ${esc(period.name)} • تاريخ الصرف: ${esc(period.payDate)} (هـ ${esc(hijri)})</div>
<div class="grid">
  <div class="box"><b>الموظف:</b> ${esc(emp.nameAr)} (${esc(emp.employeeNo)})<br/>
    <span class="muted">الهوية: ${esc(emp.nationalId ?? "—")} • IBAN: ${esc(emp.bankIban ?? "—")} • ${esc(emp.bankName ?? "")}</span></div>
  <div class="box"><b>أيام العمل:</b> ${esc(line.workedDays)} • <b>إجازة بدون راتب:</b> ${esc(line.leaveWithoutPayDays)} يوم<br/>
    <b>ساعات إضافية:</b> ${esc(line.overtimeHours)}</div>
</div>
<table><thead><tr><th>الاستحقاقات</th><th>المبلغ (ر.س)</th></tr></thead><tbody>
  <tr><td>الراتب الأساسي</td><td>${fmt(line.basicSalary)}</td></tr>
  <tr><td>بدل سكن</td><td>${fmt(line.housingAllowance)}</td></tr>
  <tr><td>بدل مواصلات</td><td>${fmt(line.transportAllowance)}</td></tr>
  <tr><td>بدلات أخرى</td><td>${fmt(line.otherAllowances)}</td></tr>
  <tr><td>قيمة الساعات الإضافية</td><td>${fmt(line.overtimeAmount)}</td></tr>
  <tr><th>إجمالي الاستحقاقات</th><th>${fmt(line.grossPay)}</th></tr>
</tbody></table>
<table><thead><tr><th>الخصومات</th><th>المبلغ (ر.س)</th></tr></thead><tbody>
  <tr><td>التأمينات (حصة الموظف)</td><td>${fmt(line.gosiEmployee)}</td></tr>
  <tr><td>إجازة بدون راتب</td><td>${fmt(line.lwpDeduction)}</td></tr>
  <tr><td>أقساط القروض/السلف</td><td>${fmt(line.loanDeduction)}</td></tr>
  <tr><td>خصومات أخرى</td><td>${fmt(line.otherDeductions)}</td></tr>
  <tr><th>إجمالي الخصومات</th><th>${fmt(line.totalDeductions)}</th></tr>
</tbody></table>
<table class="net"><tbody>
  <tr><th>صافي الراتب</th><th>${fmt(line.netPay)} ر.س</th></tr>
  <tr><td class="muted">حصة صاحب العمل من التأمينات</td><td class="muted">${fmt(line.gosiEmployer)}</td></tr>
</tbody></table>
<p class="muted">تم الإصدار في ${esc(slip.createdAt.toISOString().slice(0, 10))} — حاسبة.AI</p>
</body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(html);
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// =========================================================================
// Org chart — returns the department hierarchy plus the manager for each
// department, suitable for rendering a tree in the UI.
// =========================================================================
router.get("/hr/org-chart", hrReadGuard, async (_req, res) => {
  const depts = await db
    .select({
      id: departmentsTable.id,
      name: departmentsTable.nameAr,
      parentId: departmentsTable.parentId,
      managerEmployeeId: departmentsTable.managerEmployeeId,
      managerName: employeesTable.nameAr,
    })
    .from(departmentsTable)
    .leftJoin(employeesTable, eq(employeesTable.id, departmentsTable.managerEmployeeId))
    .where(eq(departmentsTable.isActive, true))
    .orderBy(asc(departmentsTable.name));

  const headcount = await db
    .select({
      departmentId: employeesTable.departmentId,
      count: sql<number>`count(*)`,
    })
    .from(employeesTable)
    .where(eq(employeesTable.status, "active"))
    .groupBy(employeesTable.departmentId);
  const countMap = new Map(headcount.map((h) => [h.departmentId, Number(h.count)]));

  type Node = (typeof depts)[number] & { headcount: number; children: Node[] };
  const nodes: Map<number, Node> = new Map(
    depts.map((d) => [d.id, { ...d, headcount: countMap.get(d.id) ?? 0, children: [] }]),
  );
  const roots: Node[] = [];
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return res.json(roots);
});

// =========================================================================
// Shifts & schedules CRUD
// =========================================================================
router.get("/hr/shifts", hrReadGuard, async (_req, res) => {
  const rows = await db.select().from(shiftsTable).orderBy(asc(shiftsTable.id));
  res.json(rows);
});

const ShiftBody = z.object({
  name: z.string().min(1),
  nameAr: z.string().min(1),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  breakMinutes: z.number().int().min(0).max(240).default(60),
  workingDays: z.string().default("0,1,2,3,4"),
  isActive: z.boolean().default(true),
});

router.post("/hr/shifts", hrGuard, async (req, res) => {
  try {
    const body = ShiftBody.parse(req.body);
    const [row] = await db.insert(shiftsTable).values({ ...body, companyId: getCompanyId(req) }).returning();
    return res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "create shift");
    return handleRouteError(err, res);
  }
});

router.patch("/hr/shifts/:id", hrGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = ShiftBody.partial().parse(req.body);
    const [row] = await db.update(shiftsTable).set(body).where(and(eq(shiftsTable.id, id), eq(shiftsTable.companyId, getCompanyId(req)))).returning();
    if (!row) return res.status(404).json({ error: "الوردية غير موجودة" });
    return res.json(row);
  } catch (err) {
    req.log.error({ err }, "update shift");
    return handleRouteError(err, res);
  }
});

router.get("/hr/employees/:id/shifts", hrReadGuard, async (req, res) => {
  const empId = Number(req.params.id);
  const rows = await db
    .select({
      id: employeeShiftsTable.id,
      shiftId: employeeShiftsTable.shiftId,
      shiftName: shiftsTable.nameAr,
      effectiveFrom: employeeShiftsTable.effectiveFrom,
      effectiveTo: employeeShiftsTable.effectiveTo,
    })
    .from(employeeShiftsTable)
    .innerJoin(shiftsTable, eq(shiftsTable.id, employeeShiftsTable.shiftId))
    .where(eq(employeeShiftsTable.employeeId, empId))
    .orderBy(desc(employeeShiftsTable.effectiveFrom));
  res.json(rows);
});

const AssignShiftBody = z.object({
  employeeId: z.number().int().positive(),
  shiftId: z.number().int().positive(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullish(),
});

router.post("/hr/employee-shifts", hrGuard, async (req, res) => {
  try {
    const body = AssignShiftBody.parse(req.body);
    const [row] = await db
      .insert(employeeShiftsTable)
      .values({
        companyId: getCompanyId(req),
        employeeId: body.employeeId,
        shiftId: body.shiftId,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo ?? null,
      })
      .returning();
    return res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "assign shift");
    return handleRouteError(err, res);
  }
});

router.delete("/hr/employee-shifts/:id", hrGuard, async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(employeeShiftsTable).where(and(eq(employeeShiftsTable.id, id), eq(employeeShiftsTable.companyId, getCompanyId(req))));
  res.json({ ok: true });
});

// =========================================================================
// Salary components CRUD (per contract)
// =========================================================================
router.get("/hr/contracts/:id/components", hrReadGuard, async (req, res) => {
  const contractId = Number(req.params.id);
  const rows = await db
    .select()
    .from(salaryComponentsTable)
    .where(eq(salaryComponentsTable.contractId, contractId))
    .orderBy(asc(salaryComponentsTable.id));
  res.json(rows.map((r) => ({ ...r, amount: num(r.amount) })));
});

const ComponentBody = z.object({
  contractId: z.number().int().positive(),
  name: z.string().min(1),
  nameAr: z.string().min(1),
  kind: z.enum(["earning", "deduction"]),
  amount: z.number().nonnegative(),
  includeInGosi: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

router.post("/hr/salary-components", hrGuard, async (req, res) => {
  try {
    const body = ComponentBody.parse(req.body);
    const [row] = await db
      .insert(salaryComponentsTable)
      .values({ ...body, amount: String(body.amount) })
      .returning();
    return res.status(201).json({ ...row, amount: num(row.amount) });
  } catch (err) {
    req.log.error({ err }, "create salary component");
    return handleRouteError(err, res);
  }
});

router.patch("/hr/salary-components/:id", hrGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = ComponentBody.partial().parse(req.body);
    const update: Record<string, unknown> = { ...body };
    if (body.amount !== undefined) update.amount = String(body.amount);
    const [row] = await db
      .update(salaryComponentsTable)
      .set(update)
      .where(eq(salaryComponentsTable.id, id))
      .returning();
    if (!row) return res.status(404).json({ error: "العنصر غير موجود" });
    return res.json({ ...row, amount: num(row.amount) });
  } catch (err) {
    req.log.error({ err }, "update salary component");
    return handleRouteError(err, res);
  }
});

router.delete("/hr/salary-components/:id", hrGuard, async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(salaryComponentsTable).where(eq(salaryComponentsTable.id, id));
  res.json({ ok: true });
});

// =========================================================================
// Leave calendar — flat list of approved/pending leaves overlapping a
// date range, suitable for a "who is out" calendar view.
// =========================================================================
router.get("/hr/leaves/calendar", hrReadGuard, async (req, res) => {
  try {
    const Q = z.object({ from: z.string(), to: z.string() }).parse(req.query);
    const rows = await db
      .select({
        id: leaveRequestsTable.id,
        reference: leaveRequestsTable.reference,
        employeeId: leaveRequestsTable.employeeId,
        employeeName: employeesTable.nameAr,
        leaveTypeName: leaveTypesTable.nameAr,
        leaveTypeCode: leaveTypesTable.code,
        isPaid: leaveTypesTable.isPaid,
        startDate: leaveRequestsTable.startDate,
        endDate: leaveRequestsTable.endDate,
        days: leaveRequestsTable.days,
        status: leaveRequestsTable.status,
      })
      .from(leaveRequestsTable)
      .innerJoin(employeesTable, eq(employeesTable.id, leaveRequestsTable.employeeId))
      .innerJoin(leaveTypesTable, eq(leaveTypesTable.id, leaveRequestsTable.leaveTypeId))
      .where(
        and(
          // overlap with [from, to]
          lte(leaveRequestsTable.startDate, Q.to),
          gte(leaveRequestsTable.endDate, Q.from),
          or(
            eq(leaveRequestsTable.status, "approved"),
            eq(leaveRequestsTable.status, "pending"),
          )!,
        ),
      )
      .orderBy(asc(leaveRequestsTable.startDate));
    return res.json(
      rows.map((r) => ({
        ...r,
        days: num(r.days),
        startDateHijri: toHijri(r.startDate).formatted,
        endDateHijri: toHijri(r.endDate).formatted,
      })),
    );
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// =========================================================================
// GOSI report — per-employee employee + employer share for a payroll run,
// plus totals for SARIE/GOSI submission.
// =========================================================================
router.get("/hr/reports/gosi", payrollReadGuard, async (req, res) => {
  try {
    const Q = z.object({ runId: z.coerce.number().int().positive() }).parse(req.query);
    const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, Q.runId)).limit(1);
    if (!run) return res.status(404).json({ error: "الجولة غير موجودة" });
    const [period] = await db
      .select()
      .from(payrollPeriodsTable)
      .where(eq(payrollPeriodsTable.id, run.periodId))
      .limit(1);
    const rows = await db
      .select({
        employeeId: payrollLinesTable.employeeId,
        employeeNo: employeesTable.employeeNo,
        employeeName: employeesTable.nameAr,
        nationalId: employeesTable.nationalId,
        nationalityType: employeesTable.nationalityType,
        gosiBase: payrollLinesTable.gosiBase,
        gosiEmployee: payrollLinesTable.gosiEmployee,
        gosiEmployer: payrollLinesTable.gosiEmployer,
      })
      .from(payrollLinesTable)
      .innerJoin(employeesTable, eq(employeesTable.id, payrollLinesTable.employeeId))
      .where(eq(payrollLinesTable.runId, Q.runId));
    const detail = rows.map((r) => ({
      ...r,
      gosiBase: num(r.gosiBase),
      gosiEmployee: num(r.gosiEmployee),
      gosiEmployer: num(r.gosiEmployer),
      gosiTotal: num(r.gosiEmployee) + num(r.gosiEmployer),
    }));
    const totalEe = detail.reduce((a, r) => a + r.gosiEmployee, 0);
    const totalEr = detail.reduce((a, r) => a + r.gosiEmployer, 0);
    return res.json({
      run: { id: run.id, reference: run.reference, status: run.status },
      period: period
        ? { id: period.id, name: period.name, payDate: period.payDate, payDateHijri: toHijri(period.payDate).formatted }
        : null,
      totals: { gosiEmployee: totalEe, gosiEmployer: totalEr, total: totalEe + totalEr, employees: detail.length },
      detail,
    });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// =========================================================================
// End-of-service (EOS) gratuity calculator — Saudi Labor Law:
//   < 5 years:  0.5 * monthly basic per year
//   >= 5 years: 1.0 * monthly basic per year (for the years above 5; the
//               first 5 years remain at 0.5x)
// Resignation reduces by 1/3, 2/3, or full depending on tenure brackets.
// =========================================================================
router.get("/hr/employees/:id/eos-estimate", hrReadGuard, async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const Q = z.object({
      asOf: z.string().optional(),
      reason: z.enum(["termination", "resignation"]).default("termination"),
    }).parse(req.query);
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, id)).limit(1);
    if (!emp) return res.status(404).json({ error: "الموظف غير موجود" });
    const [contract] = await db
      .select()
      .from(contractsTable)
      .where(and(eq(contractsTable.employeeId, id), eq(contractsTable.status, "active")))
      .orderBy(desc(contractsTable.startDate))
      .limit(1);
    if (!contract) return res.status(400).json({ error: "لا يوجد عقد نشط" });

    const asOf = Q.asOf ? new Date(Q.asOf) : new Date();
    const hire = new Date(emp.hireDate);
    const ms = asOf.getTime() - hire.getTime();
    const years = ms / (365.25 * 24 * 3600 * 1000);
    const monthlyBasic = num(contract.basicSalary);

    let gratuity = 0;
    if (years <= 5) {
      gratuity = years * monthlyBasic * 0.5;
    } else {
      gratuity = 5 * monthlyBasic * 0.5 + (years - 5) * monthlyBasic * 1.0;
    }
    let reductionFactor = 1;
    if (Q.reason === "resignation") {
      if (years < 2) reductionFactor = 0; // less than 2 years on resignation = no EOS
      else if (years < 5) reductionFactor = 1 / 3;
      else if (years < 10) reductionFactor = 2 / 3;
      else reductionFactor = 1;
    }
    const payable = gratuity * reductionFactor;

    return res.json({
      employee: { id: emp.id, employeeNo: emp.employeeNo, nameAr: emp.nameAr, hireDate: emp.hireDate },
      asOf: asOf.toISOString().slice(0, 10),
      reason: Q.reason,
      yearsOfService: Number(years.toFixed(2)),
      monthlyBasic,
      gratuityFull: Number(gratuity.toFixed(2)),
      reductionFactor,
      payable: Number(payable.toFixed(2)),
    });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// =========================================================================
// Payroll register — full per-employee breakdown for a payroll run.
// =========================================================================
router.get("/hr/reports/payroll-register", payrollReadGuard, async (req, res) => {
  try {
    const Q = z.object({ runId: z.coerce.number().int().positive() }).parse(req.query);
    const [run] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, Q.runId)).limit(1);
    if (!run) return res.status(404).json({ error: "الجولة غير موجودة" });
    const [period] = await db
      .select()
      .from(payrollPeriodsTable)
      .where(eq(payrollPeriodsTable.id, run.periodId))
      .limit(1);
    const lines = await db
      .select({
        employeeId: payrollLinesTable.employeeId,
        employeeNo: employeesTable.employeeNo,
        employeeName: employeesTable.nameAr,
        nationalityType: employeesTable.nationalityType,
        workedDays: payrollLinesTable.workedDays,
        lwpDays: payrollLinesTable.leaveWithoutPayDays,
        otHours: payrollLinesTable.overtimeHours,
        basicSalary: payrollLinesTable.basicSalary,
        housing: payrollLinesTable.housingAllowance,
        transport: payrollLinesTable.transportAllowance,
        otherAllowances: payrollLinesTable.otherAllowances,
        overtimeAmount: payrollLinesTable.overtimeAmount,
        grossPay: payrollLinesTable.grossPay,
        gosiEmployee: payrollLinesTable.gosiEmployee,
        gosiEmployer: payrollLinesTable.gosiEmployer,
        lwpDeduction: payrollLinesTable.lwpDeduction,
        loanDeduction: payrollLinesTable.loanDeduction,
        otherDeductions: payrollLinesTable.otherDeductions,
        totalDeductions: payrollLinesTable.totalDeductions,
        netPay: payrollLinesTable.netPay,
      })
      .from(payrollLinesTable)
      .innerJoin(employeesTable, eq(employeesTable.id, payrollLinesTable.employeeId))
      .where(eq(payrollLinesTable.runId, Q.runId))
      .orderBy(asc(employeesTable.employeeNo));
    const detail = lines.map((l) => ({
      ...l,
      workedDays: num(l.workedDays),
      lwpDays: num(l.lwpDays),
      otHours: num(l.otHours),
      basicSalary: num(l.basicSalary),
      housing: num(l.housing),
      transport: num(l.transport),
      otherAllowances: num(l.otherAllowances),
      overtimeAmount: num(l.overtimeAmount),
      grossPay: num(l.grossPay),
      gosiEmployee: num(l.gosiEmployee),
      gosiEmployer: num(l.gosiEmployer),
      lwpDeduction: num(l.lwpDeduction),
      loanDeduction: num(l.loanDeduction),
      otherDeductions: num(l.otherDeductions),
      totalDeductions: num(l.totalDeductions),
      netPay: num(l.netPay),
    }));
    const sumKeys: Array<keyof typeof detail[number]> = [
      "grossPay", "gosiEmployee", "gosiEmployer", "lwpDeduction",
      "loanDeduction", "otherDeductions", "totalDeductions", "netPay",
    ];
    const totals = sumKeys.reduce<Record<string, number>>((acc, k) => {
      acc[k] = detail.reduce((s, r) => s + (r[k] as number), 0);
      return acc;
    }, {});
    return res.json({
      run: { id: run.id, reference: run.reference, status: run.status },
      period: period ? { id: period.id, name: period.name, payDate: period.payDate } : null,
      employees: detail.length,
      totals,
      detail,
    });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// =========================================================================
// Email payslip — sends the printable HTML link / PDF attachment if SMTP
// is configured. Returns 503 when SMTP is not configured rather than
// silently failing.
// =========================================================================
router.post("/hr/payslips/:id/email", hrGuard, async (req, res) => {
  try {
    const { id } = IdParam.parse(req.params);
    const [slip] = await db.select().from(payslipsTable).where(eq(payslipsTable.id, id)).limit(1);
    if (!slip) return res.status(404).json({ error: "بيان الراتب غير موجود" });
    const [emp] = await db.select().from(employeesTable).where(eq(employeesTable.id, slip.employeeId)).limit(1);
    if (!emp?.email) return res.status(400).json({ error: "لا يوجد بريد مسجل للموظف" });

    const host = process.env.SMTP_HOST;
    if (!host) return res.status(503).json({ error: "SMTP غير مهيأ" });

    const nm = await import("nodemailer");
    const transport = nm.default.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" }
        : undefined,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM ?? "noreply@hasaba.ai",
      to: emp.email,
      subject: `بيان راتب ${slip.reference}`,
      text: `مرفق رابط بيان الراتب رقم ${slip.reference}.`,
    });
    return res.json({ ok: true, sentTo: emp.email });
  } catch (err) {
    return handleRouteError(err, res);
  }
});

// Suppress unused-import warning when usersTable isn't referenced in some paths.
void usersTable;

export default router;
