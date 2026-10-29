import { randomUUID } from "node:crypto";
import { employeesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "./journal-posting";
import { adminRows, LEGACY_ADMIN_RESPONSIBILITIES } from "./administration-authority";

/** Reuse the employee/person + scoped access model; no inferred job or financial grants. */
export async function ensureAdministrativePerson(tx:DbOrTx,companyId:number,userId:number) {
  const [old]=await adminRows(tx,sql`SELECT employee_id FROM employee_access WHERE company_id=${companyId} AND user_id=${userId}`);
  if(old)return;
  const [user]=await adminRows(tx,sql`SELECT name,email FROM users WHERE id=${userId}`);
  const [existing]=await adminRows<{id:number}>(tx,sql`SELECT id FROM employees WHERE company_id=${companyId} AND user_id=${userId} LIMIT 1`);
  const employee=existing??(await tx.insert(employeesTable).values({companyId,userId,employeeNo:`ADMIN-${randomUUID()}`,
    name:user.name,nameAr:user.name,email:user.email,status:"preboarding",recordKind:"person",hireDate:null,
    nationality:"",nationalityType:"unverified"}).returning({id:employeesTable.id}))[0];
  await tx.execute(sql`INSERT INTO employee_access(employee_id,company_id,user_id,login_kinds,status,creation_key,creation_hash,created_by)
    VALUES(${employee.id},${companyId},${userId},ARRAY['platform'],'active',${randomUUID()},'administrative-enrollment',${userId})`);
}
export async function enrollCompanyAdministrator(tx:DbOrTx,companyId:number,userId:number) {
  await ensureAdministrativePerson(tx,companyId,userId);
  await tx.execute(sql`INSERT INTO company_administrators(company_id,user_id,responsibilities,may_appoint_primary_owner)
    VALUES(${companyId},${userId},${sql.param([...LEGACY_ADMIN_RESPONSIBILITIES])}::text[],true)`);
}
