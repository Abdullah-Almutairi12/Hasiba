import { randomUUID, createHash } from "node:crypto";
import { db, auditLogsTable, employeesTable } from "@workspace/db";
import { sql, type SQL } from "drizzle-orm";
import { lockApprovalAuthorityWrite } from "./approval-authority";
import { FinancialRequestError } from "./financial-transaction";
import type { DbOrTx } from "./journal-posting";
import { TEAM_MODULES, type TeamPerson } from "./team-catalog";
import { requireAdministrative, protectLastAdministrator, initializeLegacyAdministration, type AdminResponsibility } from "./administration-authority";

export async function teamRows<T = Record<string, unknown>>(connection: Pick<typeof db, "execute">, statement: SQL): Promise<T[]> {
  return (await connection.execute(statement)).rows as T[];
}
export async function teamOwner(companyId: number, userId: number, connection: DbOrTx = db) {
  return requireAdministrative(companyId,userId,"users",connection);
}
export async function teamWrite<T>(companyId: number, userId: number, work: (tx: DbOrTx) => Promise<T>, capability: AdminResponsibility = "users") {
  return db.transaction(async tx => {
    await lockApprovalAuthorityWrite(tx);
    await tx.execute(sql`SELECT id FROM companies WHERE id=${companyId} FOR UPDATE`);
    await initializeLegacyAdministration(tx,companyId);
    await requireAdministrative(companyId,userId,capability,tx);
    return work(tx);
  });
}
export async function teamAudit(tx: DbOrTx, companyId: number, userId: number, action: string, details: unknown) {
  const [owner] = await teamRows<{name:string}>(tx,sql`SELECT name FROM users WHERE id=${userId}`);
  await tx.insert(auditLogsTable).values({ companyId, userId, userName: owner.name,
    entity: "employee_access", action, details: JSON.stringify(details) });
}
export async function teamPolicy(companyId: number, connection: DbOrTx = db) {
  const [configured] = await teamRows<{ enabled_modules: string[]; seat_limit: number | null; source: string }>(connection,
    sql`SELECT enabled_modules,seat_limit,source FROM team_access_policy WHERE company_id=${companyId}`);
  const [counts] = await teamRows<{ seats: number; reserved: number }>(connection, sql`
    WITH seats AS (
      SELECT count(DISTINCT uc.user_id)::integer AS n FROM user_companies uc JOIN users u ON u.id=uc.user_id AND u.is_active
      LEFT JOIN employee_access a ON a.company_id=uc.company_id AND a.user_id=uc.user_id
        AND NOT EXISTS(SELECT 1 FROM legacy_team_conversions lc WHERE lc.company_id=a.company_id
          AND lc.user_id=a.user_id AND lc.employee_id=a.employee_id AND lc.state='reverted')
      WHERE uc.company_id=${companyId} AND ((a.employee_id IS NULL AND uc.role<>'scoped') OR a.status='active')
    ), pending AS (
      SELECT count(*)::integer AS n FROM employee_access WHERE company_id=${companyId} AND user_id IS NULL
        AND cardinality(login_kinds)>0 AND status IN ('pending','device_setup_required')
    ) SELECT seats.n AS seats,(seats.n+pending.n)::integer AS reserved FROM seats,pending`);
  return {
    enabledModules: configured?.enabled_modules ?? (process.env.NODE_ENV === "production" ? [] : TEAM_MODULES),
    seatLimit: configured?.seat_limit ?? null,
    source: configured?.source ?? (process.env.NODE_ENV === "production" ? "unconfigured" : "development_configuration"),
    activeLoginSeats: counts.seats, reservedAccessSlots: counts.reserved,
  };
}
export type TeamProfile = TeamPerson & { personId: number; userId: number | null; status: string; revision: number };
export async function teamPeople(companyId: number, connection: DbOrTx = db, personId?: number): Promise<TeamProfile[]> {
  return teamRows<TeamProfile>(connection, sql`
    SELECT a.employee_id AS "personId",a.user_id AS "userId",a.status,a.revision,a.creation_key AS "creationKey",
      e.name_ar AS name,e.email,a.login_kinds AS "loginKinds",a.denied_actions AS "deniedActions",
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'resource',g.resource,'branchId',g.branch_id,
        'warehouseIds',g.warehouse_ids,'actions',g.actions,'amountLimit',g.amount_limit::text,
        'startsAt',g.starts_at,'endsAt',g.ends_at) ORDER BY g.id)
        FROM responsibility_grants g WHERE g.employee_id=a.employee_id AND g.company_id=a.company_id AND g.revoked_at IS NULL),'[]'::jsonb) AS grants
    FROM employee_access a JOIN employees e ON e.id=a.employee_id AND e.company_id=a.company_id
    WHERE a.company_id=${companyId}
      AND NOT EXISTS(SELECT 1 FROM legacy_team_conversions lc WHERE lc.company_id=a.company_id
        AND lc.user_id=a.user_id AND lc.employee_id=a.employee_id AND lc.state='reverted')
      ${personId ? sql`AND a.employee_id=${personId}` : sql``} ORDER BY a.employee_id`);
}
export async function previewTeamPerson(companyId: number, person: TeamPerson, connection: DbOrTx = db, replacing?: number, existingLoginSeat = false) {
  const policy = await teamPolicy(companyId, connection);
  for (const grant of person.grants) {
    if (!policy.enabledModules.includes(grant.resource)) throw new FinancialRequestError("الوحدة غير متاحة في استحقاق المنشأة المهيأ", 403);
    const [branch] = await teamRows(connection, sql`SELECT id FROM branches WHERE id=${grant.branchId} AND company_id=${companyId} AND is_active`);
    if (!branch) throw new FinancialRequestError("الفرع غير متاح في الشركة", 403);
    const warehouses = await teamRows(connection, sql`SELECT id FROM warehouses WHERE id=ANY(${sql.param(grant.warehouseIds)}::integer[])
      AND company_id=${companyId} AND branch_id=${grant.branchId}`);
    if (warehouses.length !== new Set(grant.warehouseIds).size) throw new FinancialRequestError("المستودع خارج نطاق الفرع أو الشركة", 403);
  }
  const [old] = replacing ? await teamPeople(companyId, connection, replacing) : [];
  const reserving = person.loginKinds.length > 0;
  const alreadyReserved = old && old.loginKinds.length > 0 && ["active","pending","device_setup_required"].includes(old.status);
  if (reserving && !alreadyReserved && !existingLoginSeat && policy.seatLimit != null && policy.reservedAccessSlots >= policy.seatLimit) {
    throw new FinancialRequestError("بلغت المنشأة حد أماكن الدخول المهيأ؛ يمكن إضافة سجل بلا دخول", 409);
  }
  if (person.email) {
    const duplicates = await teamRows(connection, sql`SELECT id FROM employees WHERE company_id=${companyId}
      AND lower(email)=${person.email} ${replacing ? sql`AND id<>${replacing}` : sql``}`);
    if (duplicates.length) throw new FinancialRequestError("يوجد سجل بهذا البريد في الشركة؛ لا يدمج تلقائيًا", 409);
  }
  return {
    grants: person.grants.map(g => ({ ...g, actions: g.actions.filter(a => !person.deniedActions.includes(`${g.resource}.read`) && !person.deniedActions.includes(a) &&
      (!g.startsAt || new Date(g.startsAt).getTime() <= Date.now()) && (!g.endsAt || new Date(g.endsAt).getTime() > Date.now())) })),
    reservesAccessSlot: reserving,
    warnings: [
      ...(person.loginKinds.includes("pos") && !person.email ? ["POS بلا بريد محفوظ بانتظار تفعيل جهاز موثوق؛ لا يقبل PIN من متصفح مجهول."] : []),
      ...(person.loginKinds.includes("pos") && person.email ? ["مسار البريد يستخدم كلمة مرور حساب كاملة؛ ليس PIN سريعًا أو إثبات جهاز."] : []),
      "إعداد الاستحقاق الحالي تطويري وليس اشتراكًا مدفوعًا أو إثباتًا لتفعيل الفوترة.",
    ],
  };
}
export async function storeGrants(tx: DbOrTx, companyId: number, employeeId: number, userId: number, person: TeamPerson) {
  await tx.execute(sql`UPDATE responsibility_grants SET revoked_at=now() WHERE company_id=${companyId}
    AND employee_id=${employeeId} AND revoked_at IS NULL`);
  for (const g of person.grants) await tx.execute(sql`
    INSERT INTO responsibility_grants(company_id,employee_id,resource,branch_id,warehouse_ids,actions,amount_limit,starts_at,ends_at,created_by)
    VALUES(${companyId},${employeeId},${g.resource},${g.branchId},${sql.param([...new Set(g.warehouseIds)])}::integer[],
      ${sql.param([...new Set(g.actions)])}::text[],${g.amountLimit}::numeric,coalesce(${g.startsAt}::timestamptz,now()),${g.endsAt}::timestamptz,${userId})`);
}
function pendingStatus(p: TeamPerson) {
  return !p.loginKinds.length ? "record" : !p.email ? "device_setup_required" : "pending";
}
export async function createTeamPerson(companyId: number, userId: number, person: TeamPerson) {
  return teamWrite(companyId, userId, async tx => {
    const hash = createHash("sha256").update(JSON.stringify(person)).digest("hex");
    const [prior] = await teamRows<{ employee_id: number; creation_hash: string }>(tx, sql`
      SELECT employee_id,creation_hash FROM employee_access WHERE company_id=${companyId} AND creation_key=${person.creationKey}`);
    if (prior) {
      if (prior.creation_hash !== hash) throw new FinancialRequestError("هوية المحاولة مستخدمة لبيانات مختلفة", 409);
      return (await teamPeople(companyId, tx, prior.employee_id))[0];
    }
    await previewTeamPerson(companyId, person, tx);
    const [employee] = await tx.insert(employeesTable).values({
      companyId, employeeNo: `PERSON-${randomUUID()}`, name: person.name, nameAr: person.name,
      email: person.email, status: "preboarding", recordKind: "person", hireDate: null,
      nationality: "", nationalityType: "unverified",
    }).returning({ id: employeesTable.id });
    await tx.execute(sql`INSERT INTO employee_access(employee_id,company_id,login_kinds,status,denied_actions,creation_key,creation_hash,created_by)
      VALUES(${employee.id},${companyId},${sql.param([...new Set(person.loginKinds)])}::text[],${pendingStatus(person)},
      ${sql.param([...new Set(person.deniedActions)])}::text[],${person.creationKey},${hash},${userId})`);
    await storeGrants(tx, companyId, employee.id, userId, person);
    const after = (await teamPeople(companyId, tx, employee.id))[0];
    await teamAudit(tx, companyId, userId, "team.person.create", { after });
    return after;
  });
}
export async function updateTeamPerson(companyId: number, userId: number, personId: number,
  expectedRevision: number, person: TeamPerson, suspended: boolean) {
  return teamWrite(companyId, userId, async tx => {
    const [reverted] = await teamRows(tx, sql`SELECT id FROM legacy_team_conversions WHERE company_id=${companyId}
      AND employee_id=${personId} AND state='reverted'`);
    if (reverted) throw new FinancialRequestError("أعيد هذا المستخدم إلى المسار القديم؛ لا تعاد منحته من محرر الفريق", 409);
    const [before] = await teamPeople(companyId, tx, personId);
    if (!before) throw new FinancialRequestError("الشخص غير متاح", 404);
    if (before.revision !== expectedRevision || person.creationKey !== before.creationKey) {
      throw new FinancialRequestError("تغير السجل؛ أعد تحميله قبل التعديل", 409);
    }
    if (before.userId && before.email !== person.email) throw new FinancialRequestError("تغيير بريد الهوية من مسار صاحب الحساب، لا إدارة شركة واحدة", 409);
    await previewTeamPerson(companyId, person, tx, personId);
    const status = suspended ? "suspended" : !person.loginKinds.length ? "record" :
      before.userId ? "active" : pendingStatus(person);
    if (before.userId && status !== "active") await protectLastAdministrator(tx,companyId,before.userId);
    await tx.execute(sql`UPDATE employees SET name=${person.name},name_ar=${person.name},email=${person.email}
      WHERE id=${personId} AND company_id=${companyId}`);
    await tx.execute(sql`UPDATE employee_access SET login_kinds=${sql.param(person.loginKinds)}::text[],denied_actions=${sql.param(person.deniedActions)}::text[],
      status=${status},revision=revision+1,updated_at=now() WHERE employee_id=${personId} AND company_id=${companyId}`);
    await storeGrants(tx, companyId, personId, userId, person);
    await tx.execute(sql`UPDATE team_invitations SET revoked_at=now() WHERE company_id=${companyId}
      AND employee_id=${personId} AND used_at IS NULL AND revoked_at IS NULL`);
    const after = (await teamPeople(companyId, tx, personId))[0];
    await teamAudit(tx, companyId, userId, "team.access.update", { before, after });
    return after;
  });
}
