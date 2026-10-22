import type { Request } from "express";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import {
  db, employeesTable, contractsTable, payrollRunsTable, payrollLinesTable, payslipsTable,
  departmentsTable, positionsTable, userCompaniesTable,
} from "@workspace/db";
import { getCompanyId } from "./scoped-db";
import { assertCompanyBranch, CompanyAccessError } from "./company-access";

// Child tables without company_id inherit ownership from their employee.
export function companyEmployeeIds(req: Request) {
  return db.select({ id: employeesTable.id }).from(employeesTable)
    .where(eq(employeesTable.companyId, getCompanyId(req)));
}

export function companyDepartmentIds(req: Request) {
  return db.select({ id: departmentsTable.id }).from(departmentsTable)
    .where(eq(departmentsTable.companyId, getCompanyId(req)));
}

export function positionScope(req: Request) {
  return and(
    eq(positionsTable.companyId, getCompanyId(req)),
    or(isNull(positionsTable.departmentId), inArray(positionsTable.departmentId, companyDepartmentIds(req))),
  );
}

type HrReferences = {
  parentId?: number | null;
  departmentId?: number | null;
  branchId?: number | null;
  managerEmployeeId?: number | null;
  positionId?: number | null;
  userId?: number | null;
};

/** Validate every caller-supplied HR relationship before any write. */
export async function validateHrReferences(req: Request, values: HrReferences) {
  if (values.branchId != null) await assertCompanyBranch(values.branchId, getCompanyId(req));
  for (const id of [values.parentId, values.departmentId]) {
    if (id == null) continue;
    const [dept] = await db.select({ id: departmentsTable.id }).from(departmentsTable).where(and(
      eq(departmentsTable.id, id), eq(departmentsTable.companyId, getCompanyId(req)),
    )).limit(1);
    if (!dept) throw new CompanyAccessError();
  }
  if (values.managerEmployeeId != null) await requireCompanyEmployee(req, values.managerEmployeeId);
  if (values.positionId != null) {
    const [position] = await db.select({ id: positionsTable.id }).from(positionsTable).where(and(
      eq(positionsTable.id, values.positionId), positionScope(req),
    )).limit(1);
    if (!position) throw new CompanyAccessError();
  }
  if (values.userId != null) {
    const [member] = await db.select({ id: userCompaniesTable.id }).from(userCompaniesTable).where(and(
      eq(userCompaniesTable.userId, values.userId), eq(userCompaniesTable.companyId, getCompanyId(req)),
    )).limit(1);
    if (!member) throw new CompanyAccessError();
  }
}

export function companyContractIds(req: Request) {
  return db.select({ id: contractsTable.id }).from(contractsTable)
    .where(inArray(contractsTable.employeeId, companyEmployeeIds(req)));
}

export function payrollScope(req: Request) {
  return eq(payrollRunsTable.companyId, getCompanyId(req));
}

export function payslipScope(req: Request) {
  return and(
    eq(payslipsTable.companyId, getCompanyId(req)),
    inArray(payslipsTable.employeeId, companyEmployeeIds(req)),
    inArray(payslipsTable.runId, db.select({ id: payrollRunsTable.id })
      .from(payrollRunsTable).where(payrollScope(req))),
    inArray(payslipsTable.lineId, db.select({ id: payrollLinesTable.id })
      .from(payrollLinesTable).where(and(
        eq(payrollLinesTable.runId, payslipsTable.runId),
        eq(payrollLinesTable.employeeId, payslipsTable.employeeId),
      ))),
  );
}

export async function requireCompanyEmployee(req: Request, employeeId: number) {
  const [employee] = await db.select().from(employeesTable).where(and(
    eq(employeesTable.id, employeeId), eq(employeesTable.companyId, getCompanyId(req)),
  )).limit(1);
  if (!employee) throw Object.assign(new Error("الموظف غير موجود"), { status: 404 });
  return employee;
}

export async function requireCompanyContract(req: Request, contractId: number) {
  const [contract] = await db.select().from(contractsTable).where(and(
    eq(contractsTable.id, contractId),
    inArray(contractsTable.employeeId, companyEmployeeIds(req)),
  )).limit(1);
  if (!contract) throw Object.assign(new Error("العقد غير موجود"), { status: 404 });
  return contract;
}

export async function requireCompanyPayroll(req: Request, runId: number) {
  const [run] = await db.select().from(payrollRunsTable).where(and(
    eq(payrollRunsTable.id, runId), payrollScope(req),
  )).limit(1);
  if (!run) throw Object.assign(new Error("مسير الرواتب غير موجود"), { status: 404 });
  return run;
}
