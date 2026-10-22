import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { readFile } from "node:fs/promises";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, companiesTable, usersTable, userCompaniesTable, employeesTable,
  contractsTable, salaryComponentsTable, leaveTypesTable, leaveBalancesTable,
  leaveRequestsTable, employeeLoansTable, employeeDocumentsTable,
  attendancePunchesTable, employeeShiftsTable, shiftsTable, departmentsTable,
  payrollPeriodsTable, payrollRunsTable, payrollLinesTable, payslipsTable,
  projectsTable, projectTasksTable, auditLogsTable, journalEntriesTable, positionsTable, branchesTable, pool,
} from "@workspace/db";
import app, { assertApplicationReady } from "../app";
import { cleanupCompanyDefaults } from "../test/cleanup-company-defaults";
import { seedCompanyFiscalCalendar } from "./fiscal-calendar";

const tag = `hr-project-tenants-${Date.now()}`;
const year = new Date().getUTCFullYear();
const date = `${year}-02-15`;
const companies: number[] = [];
const users: number[] = [];
const employees: number[] = [];
const contracts: number[] = [];
const components: number[] = [];
const leaves: number[] = [];
const loans: number[] = [];
const docs: number[] = [];
const shifts: number[] = [];
const runs: number[] = [];
const slips: number[] = [];
const projects: number[] = [];
const departments: number[] = [];
const positions: number[] = [];
const branches: number[] = [];
const legacyPositions: number[] = [];
const agents: request.Agent[] = [];
let periodId = 0;
let leaveTypeId = 0;

beforeAll(async () => {
  await assertApplicationReady();
  const hash = await bcrypt.hash("TenantTest123!", 4);
  const [period] = await db.insert(payrollPeriodsTable).values({
    name: tag, year, month: 2, startDate: `${year}-02-01`,
    endDate: `${year}-02-28`, payDate: date,
  }).returning();
  periodId = period.id;
  const [type] = await db.insert(leaveTypesTable).values({
    code: tag, name: tag, nameAr: tag, defaultDaysPerYear: 30,
  }).returning();
  leaveTypeId = type.id;
  for (let n = 0; n < 2; n++) {
    const [company] = await db.insert(companiesTable).values({ name: `${tag}-${n}` }).returning();
    companies.push(company.id);
    await seedCompanyFiscalCalendar(company.id);
    const [user] = await db.insert(usersTable).values({
      name: `${tag}-${n}`, email: `${tag}-${n}@test.local`, passwordHash: hash, role: "owner",
    }).returning();
    users.push(user.id);
    await db.insert(userCompaniesTable).values({
      companyId: company.id, userId: user.id, role: "owner", isDefault: true,
    });
    const [branch] = await db.insert(branchesTable).values({
      companyId: company.id, name: `${tag}-${n}`, nameAr: `${tag}-${n}`, city: "Synthetic city",
    }).returning();
    branches.push(branch.id);
    const [dept] = await db.insert(departmentsTable).values({
      companyId: company.id, name: `${tag}-${n}`, nameAr: `${tag}-${n}`, branchId: branch.id,
    }).returning();
    departments.push(dept.id);
    const [position] = await db.insert(positionsTable).values({
      companyId: company.id, title: `${tag}-${n}`, titleAr: `${tag}-${n}`, departmentId: dept.id,
    }).returning();
    positions.push(position.id);
    const [emp] = await db.insert(employeesTable).values({
      companyId: company.id, employeeNo: `${tag}-${n}`, name: `${tag}-${n}`,
      nameAr: `${tag}-${n}`, hireDate: `${year - 1}-01-01`, userId: user.id,
      departmentId: dept.id, bankIban: `SA000000000000000000000${n}`,
      branchId: branch.id, positionId: position.id,
      nationalId: `synthetic-${n}`, iqamaExpiry: date, passportExpiry: date,
    }).returning();
    employees.push(emp.id);
    const [contract] = await db.insert(contractsTable).values({
      employeeId: emp.id, reference: `${tag}-con-${n}`, contractType: "saudi",
      startDate: `${year - 1}-01-01`, endDate: date, basicSalary: "3000",
    }).returning();
    contracts.push(contract.id);
    const [component] = await db.insert(salaryComponentsTable).values({
      contractId: contract.id, name: "Allowance", nameAr: "بدل", kind: "earning", amount: "100",
    }).returning();
    components.push(component.id);
    const [loan] = await db.insert(employeeLoansTable).values({
      employeeId: emp.id, reference: `${tag}-loan-${n}`,
      principal: "500", monthlyInstallment: "50", outstanding: "500", startDate: date,
    }).returning();
    loans.push(loan.id);
    await db.insert(leaveBalancesTable).values({
      employeeId: emp.id, leaveTypeId, year, entitlement: "30", pending: "1",
    });
    const [leave] = await db.insert(leaveRequestsTable).values({
      companyId: company.id, employeeId: emp.id, leaveTypeId,
      reference: `${tag}-leave-${n}`, startDate: date, endDate: date, days: "1",
    }).returning();
    leaves.push(leave.id);
    const [doc] = await db.insert(employeeDocumentsTable).values({
      companyId: company.id, employeeId: emp.id, docType: "other", title: `${tag}-${n}`,
      fileUrl: `/synthetic-${n}.pdf`,
    }).returning();
    docs.push(doc.id);
    const [shift] = await db.insert(shiftsTable).values({
      companyId: company.id, name: `${tag}-${n}`, nameAr: `${tag}-${n}`,
      startTime: "09:00", endTime: "17:00",
    }).returning();
    shifts.push(shift.id);
    await db.insert(employeeShiftsTable).values({
      companyId: company.id, employeeId: emp.id, shiftId: shift.id, effectiveFrom: `${year}-01-01`,
    });
    await db.insert(attendancePunchesTable).values({
      employeeId: emp.id, punchAt: new Date(`${date}T09:00:00Z`), direction: "in",
    });
    const [run] = await db.insert(payrollRunsTable).values({
      companyId: company.id, periodId, reference: `${tag}-run-${n}`, status: "computed",
      totalGross: "3000", totalNet: "2650", totalDeductions: "350",
      totalGosiEmployee: "300", totalGosiEmployer: "350", employeeCount: 1,
    }).returning();
    runs.push(run.id);
    const [line] = await db.insert(payrollLinesTable).values({
      runId: run.id, employeeId: emp.id, contractId: contract.id,
      basicSalary: "3000", grossPay: "3000", netPay: "2650", totalDeductions: "350",
      gosiEmployee: "300", gosiEmployer: "350", loanDeduction: "50",
    }).returning();
    const [slip] = await db.insert(payslipsTable).values({
      companyId: company.id, employeeId: emp.id, runId: run.id, lineId: line.id,
      reference: `${tag}-slip-${n}`,
    }).returning();
    slips.push(slip.id);
    const [project] = await db.insert(projectsTable).values({
      companyId: company.id, name: `${tag}-${n}`,
    }).returning();
    projects.push(project.id);
    await db.insert(projectTasksTable).values({
      projectId: project.id, title: `${tag}-${n}`, description: `Private task ${n}`,
    });
    const agent = request.agent(app);
    await agent.post("/api/auth/login").send({ email: user.email, password: "TenantTest123!" }).expect(200);
    agents.push(agent);
  }
  for (const departmentId of [null, departments[0]]) {
    const [legacy] = await db.insert(positionsTable).values({
      title: `${tag}-unowned`, titleAr: `${tag}-unowned`, departmentId,
    }).returning();
    legacyPositions.push(legacy.id);
  }
});

afterAll(async () => {
  if (employees.length) {
    await db.execute(sql`DELETE FROM expense_claims WHERE employee_id IN (${sql.join(employees.map(id => sql`${id}`), sql`, `)})`);
    await db.delete(payslipsTable).where(inArray(payslipsTable.employeeId, employees));
  }
  if (companies.length) {
    await db.delete(payrollRunsTable).where(inArray(payrollRunsTable.companyId, companies));
    await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.companyId, companies));
  }
  if (employees.length) {
    await db.delete(contractsTable).where(inArray(contractsTable.employeeId, employees));
    await db.delete(attendancePunchesTable).where(inArray(attendancePunchesTable.employeeId, employees));
    await db.delete(employeeShiftsTable).where(inArray(employeeShiftsTable.employeeId, employees));
    await db.delete(employeesTable).where(inArray(employeesTable.id, employees));
  }
  if (companies.length) {
    await db.delete(positionsTable).where(inArray(positionsTable.companyId, companies));
    if (legacyPositions.length) await db.delete(positionsTable).where(inArray(positionsTable.id, legacyPositions));
    await db.delete(departmentsTable).where(inArray(departmentsTable.companyId, companies));
    await cleanupCompanyDefaults(companies);
  }
  if (projects.length) await db.delete(projectTasksTable).where(inArray(projectTasksTable.projectId, projects));
  if (companies.length) await db.delete(projectsTable).where(inArray(projectsTable.companyId, companies));
  if (periodId) await db.delete(payrollPeriodsTable).where(eq(payrollPeriodsTable.id, periodId));
  if (leaveTypeId) await db.delete(leaveTypesTable).where(eq(leaveTypesTable.id, leaveTypeId));
  if (users.length) {
    await db.delete(auditLogsTable).where(inArray(auditLogsTable.userId, users));
    await db.delete(usersTable).where(inArray(usersTable.id, users));
  }
  if (companies.length) await db.delete(branchesTable).where(inArray(branchesTable.companyId, companies));
  if (companies.length) await db.delete(companiesTable).where(inArray(companiesTable.id, companies));
});

describe("HR list and report tenant isolation", () => {
  it("filters sensitive lists in both directions, including optional foreign employee filters", async () => {
    const lists = [
      ["contracts", contracts], ["loans", loans], ["leave-requests", leaves],
      ["payroll-runs", runs], ["payslips", slips],
    ] as const;
    for (let n = 0; n < 2; n++) {
      for (const [path, ids] of lists) {
        const response = await agents[n].get(`/api/hr/${path}`).expect(200);
        const result = response.body.map((r: { id: number }) => r.id);
        expect(result).toContain(ids[n]);
        expect(result).not.toContain(ids[1 - n]);
      }
      for (const path of ["contracts", "loans", "payslips", "leave-balances", "attendance"]) {
        const foreign = await agents[n].get(`/api/hr/${path}?employeeId=${employees[1 - n]}`).expect(200);
        expect(foreign.body).toEqual([]);
      }
      for (const path of ["leave-balances", "attendance"]) {
        const response = await agents[n].get(`/api/hr/${path}`).expect(200);
        expect(response.body.some((r: { employeeId: number }) => r.employeeId === employees[n])).toBe(true);
        expect(response.body.every((r: { employeeId: number }) => r.employeeId !== employees[1 - n])).toBe(true);
      }
    }
  });

  it("scopes expiry, attendance summaries, leave calendars, headcounts, and period reports", async () => {
    const paths = [
      "/hr/expiry-alerts?days=365", "/hr/org-chart",
      `/hr/attendance/summary?from=${date}&to=${date}`,
      `/hr/leaves/calendar?from=${date}&to=${date}`,
      `/hr/reports/payroll-register?periodId=${periodId}`,
    ];
    for (const path of paths) {
      const response = await agents[0].get(`/api${path}`).expect(200);
      expect(JSON.stringify(response.body)).toContain(`${tag}-0`);
      expect(JSON.stringify(response.body)).not.toContain(`${tag}-1`);
    }
    const saudization = await agents[0].get("/api/hr/reports/saudization").expect(200);
    expect(saudization.body.reduce((sum: number, row: { total: number }) => sum + row.total, 0)).toBe(1);
  });

  it("rejects foreign IDs on every payroll and payslip read/export path", async () => {
    for (const n of [0, 1]) {
      const foreign = 1 - n;
      const paths = [
        `/hr/payroll-runs/${runs[foreign]}/lines`, `/hr/payroll-runs/${runs[foreign]}/wps`,
        `/hr/reports/gosi?runId=${runs[foreign]}`, `/hr/reports/payroll-register?runId=${runs[foreign]}`,
        ...["view", "pdf", "print"].map(format => `/hr/payslips/${slips[foreign]}/${format}`),
        ...["documents", "shifts", "eos", "eos-estimate"].map(part => `/hr/employees/${employees[foreign]}/${part}`),
        `/hr/contracts/${contracts[foreign]}/components`,
      ];
      for (const path of paths) await agents[n].get(`/api${path}`).expect(404);
      for (const path of [
        `/hr/payroll-runs/${runs[n]}/lines`, `/hr/payroll-runs/${runs[n]}/wps`,
        `/hr/reports/gosi?runId=${runs[n]}`, `/hr/reports/payroll-register?runId=${runs[n]}`,
        `/hr/payslips/${slips[n]}/view`, `/hr/employees/${employees[n]}/documents`,
        `/hr/contracts/${contracts[n]}/components`,
      ]) await agents[n].get(`/api${path}`).expect(200);
    }
  });

  it("quarantines legacy records whose stamped company disagrees with their employee", async () => {
    const [foreignLine] = await db.select().from(payrollLinesTable).where(eq(payrollLinesTable.runId, runs[1]));
    const [badSlip] = await db.insert(payslipsTable).values({
      companyId: companies[0], employeeId: employees[1], runId: runs[1], lineId: foreignLine.id,
      reference: `${tag}-mismatched-slip`,
    }).returning();
    const [badLeave] = await db.insert(leaveRequestsTable).values({
      companyId: companies[0], employeeId: employees[1], leaveTypeId,
      reference: `${tag}-mismatched-leave`, startDate: date, endDate: date, days: "1",
    }).returning();
    for (const agent of agents) {
      await agent.get(`/api/hr/payslips/${badSlip.id}/view`).expect(404);
      await agent.post(`/api/hr/leave-requests/${badLeave.id}/decide`).send({ action: "approve" }).expect(404);
      const slipsResponse = await agent.get("/api/hr/payslips").expect(200);
      expect(slipsResponse.body.map((r: { id: number }) => r.id)).not.toContain(badSlip.id);
      const leaveResponse = await agent.get("/api/hr/leave-requests").expect(200);
      expect(leaveResponse.body.map((r: { id: number }) => r.id)).not.toContain(badLeave.id);
    }
    await db.delete(payslipsTable).where(eq(payslipsTable.id, badSlip.id));
    await db.delete(leaveRequestsTable).where(eq(leaveRequestsTable.id, badLeave.id));
  });
});

describe("HR mutation tenant isolation", () => {
  it("validates department, position and employee relationships before create or update", async () => {
    const employeeBody = { name: "New employee", nameAr: "موظف جديد", hireDate: date };
    for (const n of [0, 1]) {
      const other = 1 - n;
      for (const body of [
        { parentId: departments[other] }, { branchId: branches[other] }, { managerEmployeeId: employees[other] },
      ]) {
        await agents[n].post("/api/hr/departments").send({ name: "Forged", nameAr: "مزور", ...body }).expect(404);
        await agents[n].put(`/api/hr/departments/${departments[n]}`).send(body).expect(404);
      }
      await agents[n].post("/api/hr/positions").send({
        title: "Forged", titleAr: "مزور", departmentId: departments[other],
      }).expect(404);
      for (const body of [
        { departmentId: departments[other] }, { branchId: branches[other] },
        { managerEmployeeId: employees[other] }, { positionId: positions[other] }, { userId: users[other] },
        ...legacyPositions.map(positionId => ({ positionId })),
      ]) {
        await agents[n].post("/api/hr/employees").send({ ...employeeBody, ...body }).expect(404);
        await agents[n].patch(`/api/hr/employees/${employees[n]}`).send(body).expect(404);
      }
      await agents[n].post("/api/hr/payroll-runs").send({ periodId, branchId: branches[other] }).expect(404);
      const [employee] = await db.select().from(employeesTable).where(eq(employeesTable.id, employees[n]));
      expect(employee.departmentId).toBe(departments[n]);
      expect(employee.positionId).toBe(positions[n]);
      expect(employee.branchId).toBe(branches[n]);
      expect(employee.userId).toBe(users[n]);
      const listed = await agents[n].get("/api/hr/departments").expect(200);
      expect(listed.body.map((d: { id: number }) => d.id)).toEqual([departments[n]]);
    }
    expect(await db.select().from(employeesTable).where(inArray(employeesTable.companyId, companies))).toHaveLength(2);
  });

  it("owns new positions even without departments and quarantines all unowned legacy positions", async () => {
    for (const n of [0, 1]) {
      for (const departmentId of [null, departments[n]]) {
        const created = await agents[n].post("/api/hr/positions").send({
          title: "Owned position", titleAr: "منصب مملوك", departmentId, companyId: companies[1 - n],
        }).expect(201);
        expect(created.body.companyId).toBe(companies[n]);
        const own = await agents[n].get("/api/hr/positions").expect(200);
        const foreign = await agents[1 - n].get("/api/hr/positions").expect(200);
        expect(own.body.map((p: { id: number }) => p.id)).toContain(created.body.id);
        expect(foreign.body.map((p: { id: number }) => p.id)).not.toContain(created.body.id);
        expect(own.body.every((p: { companyId: number }) => p.companyId === companies[n])).toBe(true);
      }
      const own = await agents[n].get("/api/hr/positions").expect(200);
      expect(own.body.map((p: { id: number }) => p.id)).toContain(positions[n]);
      for (const id of legacyPositions) expect(own.body.map((p: { id: number }) => p.id)).not.toContain(id);
    }
  });

  it("permits same-company HR relationships and rejects legacy foreign join disclosures", async () => {
    const createdDept = await agents[0].post("/api/hr/departments").send({
      name: "Owned department", nameAr: "إدارة مملوكة", parentId: departments[0],
      branchId: branches[0], managerEmployeeId: employees[0],
    }).expect(201);
    await agents[0].put(`/api/hr/departments/${createdDept.body.id}`).send({ name: "Renamed" }).expect(200);
    await agents[0].patch(`/api/hr/employees/${employees[0]}`).send({
      departmentId: departments[0], positionId: positions[0], branchId: branches[0],
      managerEmployeeId: employees[0], userId: users[0],
    }).expect(200);
    const created = await agents[0].post("/api/hr/employees").send({
      name: "Owned employee", nameAr: "موظف مملوك", hireDate: date,
      departmentId: departments[0], positionId: positions[0], branchId: branches[0],
      managerEmployeeId: employees[0],
    }).expect(201);
    employees.push(created.body.id);
    // Old malformed relationships must not return foreign names on joins.
    await db.update(employeesTable).set({
      departmentId: departments[1], positionId: positions[1], branchId: branches[1],
    }).where(eq(employeesTable.id, created.body.id));
    const listed = await agents[0].get("/api/hr/employees").expect(200);
    const legacy = listed.body.find((e: { id: number }) => e.id === created.body.id);
    expect(legacy.departmentName).toBeNull();
    expect(legacy.positionTitle).toBeNull();
    expect(legacy.branchName).toBeNull();
  });

  it("rejects foreign employee parents before any write, including balance creation", async () => {
    const writes = [
      ["contracts", { contractType: "saudi", startDate: date, basicSalary: 1000 }],
      ["loans", { kind: "loan", principal: 100, monthlyInstallment: 10, startDate: date }],
      ["leave-requests", { leaveTypeId, startDate: `${year + 1}-01-01`, endDate: `${year + 1}-01-01` }],
      ["employee-documents", { docType: "other", title: "forged", fileUrl: "/synthetic.pdf" }],
      ["attendance/punch", { direction: "in" }],
      ["employee-shifts", { shiftId: shifts[0], effectiveFrom: date }],
      ["expense-claims", { claimDate: date, amount: 100, currency: "SAR" }],
    ] as const;
    for (const [path, body] of writes) {
      await agents[0].post(`/api/hr/${path}`).send({ ...body, employeeId: employees[1], companyId: companies[0] }).expect(404);
    }
    await agents[0].post("/api/hr/attendance/webhook").send({
      employeeNo: `${tag}-1`, direction: "in", punchAt: `${date}T10:00:00Z`,
    }).expect(404);
    await agents[0].post("/api/hr/employee-shifts").send({
      employeeId: employees[0], shiftId: shifts[1], effectiveFrom: date,
    }).expect(404);
    const balances = await db.select().from(leaveBalancesTable).where(and(
      eq(leaveBalancesTable.employeeId, employees[1]), eq(leaveBalancesTable.year, year + 1),
    ));
    expect(balances).toEqual([]);
    expect(await db.select().from(contractsTable).where(eq(contractsTable.employeeId, employees[1]))).toHaveLength(1);
    expect(await db.select().from(employeeLoansTable).where(eq(employeeLoansTable.employeeId, employees[1]))).toHaveLength(1);
    expect(await db.select().from(employeeDocumentsTable).where(eq(employeeDocumentsTable.employeeId, employees[1]))).toHaveLength(1);
    expect(await db.select().from(attendancePunchesTable).where(eq(attendancePunchesTable.employeeId, employees[1]))).toHaveLength(1);
  });

  it("protects salary component targets and replacement contract IDs", async () => {
    const body = { name: "Allowance", nameAr: "بدل", kind: "earning", amount: 55 };
    await agents[0].post("/api/hr/salary-components").send({ ...body, contractId: contracts[1] }).expect(404);
    await agents[0].patch(`/api/hr/salary-components/${components[1]}`).send({ amount: 999 }).expect(404);
    await agents[0].patch(`/api/hr/salary-components/${components[0]}`).send({ contractId: contracts[1] }).expect(404);
    await agents[0].delete(`/api/hr/salary-components/${components[1]}`).expect(404);
    const [foreign] = await db.select().from(salaryComponentsTable).where(eq(salaryComponentsTable.id, components[1]));
    expect(foreign.amount).toBe("100.00");
    const own = await agents[0].post("/api/hr/salary-components").send({ ...body, contractId: contracts[0] }).expect(201);
    await agents[0].patch(`/api/hr/salary-components/${own.body.id}`).send({ amount: 60 }).expect(200);
    await agents[0].delete(`/api/hr/salary-components/${own.body.id}`).expect(200);
  });

  it("rejects foreign payroll actions and leave decisions without changing state", async () => {
    const [before] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, runs[1]));
    for (const action of ["post", "mark-paid", "remit-gosi"]) {
      await agents[0].post(`/api/hr/payroll-runs/${runs[1]}/${action}`).send({}).expect(404);
    }
    for (const action of ["approve", "reject"]) {
      await agents[0].post(`/api/hr/leave-requests/${leaves[1]}/decide`).send({ action }).expect(404);
    }
    await agents[0].post(`/api/hr/payslips/${slips[1]}/email`).expect(404);
    const [after] = await db.select().from(payrollRunsTable).where(eq(payrollRunsTable.id, runs[1]));
    expect(after).toEqual(before);
    const [leave] = await db.select().from(leaveRequestsTable).where(eq(leaveRequestsTable.id, leaves[1]));
    expect(leave.status).toBe("pending");
    const [balance] = await db.select().from(leaveBalancesTable).where(eq(leaveBalancesTable.employeeId, employees[1]));
    expect(balance.pending).toBe("1.00");
    expect(balance.used).toBe("0.00");
    expect(await db.select().from(journalEntriesTable).where(inArray(journalEntriesTable.companyId, companies))).toEqual([]);
    await agents[0].post(`/api/hr/leave-requests/${leaves[0]}/decide`).send({ action: "approve" }).expect(200);
  });

  it("creates an owned payroll using only the active company's employees", async () => {
    const created = await agents[0].post("/api/hr/payroll-runs").send({ periodId, companyId: companies[1] }).expect(201);
    expect(created.body.companyId).toBe(companies[0]);
    const lines = await db.select().from(payrollLinesTable).where(eq(payrollLinesTable.runId, created.body.id));
    expect(lines.map(l => l.employeeId)).toEqual([employees[0]]);
  });

  it("still permits owned contracts, loans, documents, leave requests, and attendance writes", async () => {
    const writes = [
      ["contracts", { contractType: "saudi", startDate: date, basicSalary: 1000 }],
      ["loans", { kind: "loan", principal: 100, monthlyInstallment: 10, startDate: date }],
      ["leave-requests", { leaveTypeId, startDate: date, endDate: date }],
      ["employee-documents", { docType: "other", title: "owned", fileUrl: "/synthetic.pdf" }],
      ["attendance/punch", { direction: "in" }],
    ] as const;
    for (const [path, body] of writes) {
      const created = await agents[0].post(`/api/hr/${path}`)
        .send({ ...body, employeeId: employees[0], companyId: companies[1] }).expect(201);
      expect(created.body.employeeId).toBe(employees[0]);
      if (created.body.companyId !== undefined) expect(created.body.companyId).toBe(companies[0]);
    }
  });

  it("preserves payroll financial actions on an owned run", async () => {
    await agents[0].post(`/api/hr/payroll-runs/${runs[0]}/post`).expect(200);
    await agents[0].post(`/api/hr/payroll-runs/${runs[0]}/mark-paid`).expect(200);
    await agents[0].post(`/api/hr/payroll-runs/${runs[0]}/remit-gosi`).expect(200);
    const journals = await db.select().from(journalEntriesTable).where(inArray(journalEntriesTable.companyId, companies));
    expect(journals).toHaveLength(3);
    expect(journals.every(j => j.companyId === companies[0])).toBe(true);
  });

  it("applies tenant boundaries to HR, finance, auditor and employee-self roles", async () => {
    try {
      for (const role of ["hr", "accountant", "auditor", "sales"]) {
        await db.update(userCompaniesTable).set({ role }).where(and(
          eq(userCompaniesTable.userId, users[0]), eq(userCompaniesTable.companyId, companies[0]),
        ));
        const ownSlips = await agents[0].get("/api/hr/payslips").expect(200);
        expect(ownSlips.body.length).toBeGreaterThan(0);
        expect(ownSlips.body.every((s: { employeeId: number }) => s.employeeId === employees[0])).toBe(true);
        await agents[0].get(`/api/hr/payslips/${slips[1]}/view`).expect(404);
        if (role !== "sales") {
          await agents[0].get(`/api/hr/payroll-runs/${runs[1]}/lines`).expect(404);
          const list = await agents[0].get("/api/hr/contracts").expect(200);
          expect(list.body.every((c: { employeeId: number }) => c.employeeId === employees[0])).toBe(true);
        }
        if (role === "hr") {
          await agents[0].post(`/api/hr/leave-requests/${leaves[1]}/decide`).send({ action: "approve" }).expect(404);
        }
        if (role === "accountant") {
          await agents[0].post(`/api/hr/payroll-runs/${runs[1]}/post`).expect(404);
        }
        await agents[0].post(`/api/projects/${projects[0]}/tasks`).send({ title: "Forbidden" }).expect(403);
      }
    } finally {
      await db.update(userCompaniesTable).set({ role: "owner" }).where(and(
        eq(userCompaniesTable.userId, users[0]), eq(userCompaniesTable.companyId, companies[0]),
      ));
    }
  });
});

describe("Project task parent authorization", () => {
  it("returns 404 for foreign/missing projects and never inserts foreign tasks", async () => {
    for (const n of [0, 1]) {
      for (const id of [projects[1 - n], 2147483647]) {
        await agents[n].get(`/api/projects/${id}/tasks`).expect(404);
        await agents[n].post(`/api/projects/${id}/tasks`).send({ title: "forged" }).expect(404);
      }
      const own = await agents[n].get(`/api/projects/${projects[n]}/tasks`).expect(200);
      expect(own.body.map((r: { title: string }) => r.title)).toEqual([`${tag}-${n}`]);
    }
    const added = await agents[0].post(`/api/projects/${projects[0]}/tasks`)
      .send({ title: "Authorized task", projectId: projects[1] }).expect(201);
    expect(added.body.projectId).toBe(projects[0]);
    expect(await db.select().from(projectTasksTable).where(eq(projectTasksTable.projectId, projects[1]))).toHaveLength(1);
  });
});

it("adds position ownership idempotently without guessing legacy owners", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("CREATE TEMP TABLE companies (id integer PRIMARY KEY) ON COMMIT DROP");
    await client.query(`CREATE TEMP TABLE positions (
      id serial PRIMARY KEY, title text NOT NULL, department_id integer
    ) ON COMMIT DROP`);
    await client.query("INSERT INTO positions(title, department_id) VALUES ('branchless', NULL), ('department-linked', $1)", [departments[0]]);
    const migration = await readFile(new URL("../../../../lib/db/drizzle/0018_hr_positions_tenant_ownership.sql", import.meta.url), "utf8");
    await client.query(migration);
    await client.query(migration);
    const { rows } = await client.query("SELECT company_id FROM positions");
    expect(rows).toEqual([{ company_id: null }, { company_id: null }]);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
