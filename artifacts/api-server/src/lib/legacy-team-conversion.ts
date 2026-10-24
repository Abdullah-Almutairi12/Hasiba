import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { TeamPersonInput, type TeamPerson } from "./team-catalog";
import { teamOwner, teamRows, teamWrite, teamPeople, teamAudit, previewTeamPerson, storeGrants } from "./team-store";
import { FinancialRequestError } from "./financial-transaction";
import type { DbOrTx } from "./journal-posting";

export const LegacyConversionInput = z.object({ userId: z.number().int().positive(), person: TeamPersonInput }).strict();
type Input = z.infer<typeof LegacyConversionInput>;
type Candidate = {
  userId: number; personId: number | null; name: string; email: string | null;
  role: string; branchId: number | null; conversionState: string; active: boolean;
  personStatus: string | null; hasCustomAccess: boolean; otherAccess: boolean;
};
const fail = (message: string, status = 409): never => { throw new FinancialRequestError(message, status); };
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
async function candidates(companyId: number, tx: DbOrTx) {
  return teamRows<Candidate>(tx, sql`SELECT u.id AS "userId",e.id AS "personId",
    coalesce(e.name_ar,e.name,u.name) AS name,coalesce(e.email,u.email) AS email,
    uc.role,u.branch_id AS "branchId",u.is_active AS active,e.status AS "personStatus",
    coalesce(lc.state,CASE WHEN a.employee_id IS NOT NULL THEN 'managed' ELSE 'legacy' END) AS "conversionState",
    EXISTS(SELECT 1 FROM return_access r WHERE r.company_id=uc.company_id AND r.user_id=u.id
      AND (r.capabilities IS NOT NULL OR r.branches IS NOT NULL)) AS "hasCustomAccess",
    (a.employee_id IS NOT NULL AND lc.id IS NULL) AS "otherAccess"
    FROM user_companies uc JOIN users u ON u.id=uc.user_id
    LEFT JOIN employees e ON e.company_id=uc.company_id AND e.user_id=u.id
    LEFT JOIN employee_access a ON a.company_id=uc.company_id AND a.user_id=u.id
    LEFT JOIN legacy_team_conversions lc ON lc.company_id=uc.company_id AND lc.user_id=u.id
    WHERE uc.company_id=${companyId} ORDER BY u.id,e.id`);
}
function reason(row: Candidate, duplicate: boolean) {
  if (!["cashier", "inventory"].includes(row.role)) return "هذا الدور يحتاج خريطة موارد مفحوصة؛ المالك لا يحول بهذا المسار";
  if (!row.active || !["active", "on_leave", "probation"].includes(row.personStatus ?? "")) return "يلزم مستخدم نشط وسجل موظف قائم مؤهل في الشركة";
  if (!row.personId || duplicate) return "لا يوجد ربط شخص واحد موثق؛ يلزم حسمه دون دمج أو إنشاء تلقائي";
  if (row.hasCustomAccess) return "له سياسة قديمة مخصصة؛ لا يمكن إسقاطها أو استنتاج بديلها تلقائيًا";
  if (row.conversionState !== "legacy" || row.otherAccess) return "هذا الربط محول أو مدار سابقًا؛ سجله محفوظ ولا يعاد تلقائيًا";
  return "";
}
export async function legacyTeamUsers(companyId: number, ownerId: number, tx: DbOrTx = db) {
  await teamOwner(companyId, ownerId, tx);
  const rows = await candidates(companyId, tx);
  return rows.map(r => ({ ...r, eligible: !reason(r, rows.filter(x => x.userId === r.userId).length !== 1),
    reason: reason(r, rows.filter(x => x.userId === r.userId).length !== 1) }));
}
async function impact(companyId: number, ownerId: number, input: Input, tx: DbOrTx) {
  await teamOwner(companyId, ownerId, tx);
  const rows = (await candidates(companyId, tx)).filter(r => r.userId === input.userId);
  const row = rows[0];
  if (!row) fail("المستخدم ليس عضوًا متاحًا في الشركة", 404);
  const blocked = reason(row, rows.length !== 1);
  if (blocked) fail(blocked);
  const person = input.person;
  if (person.name !== row.name || (person.email ?? "").toLowerCase() !== (row.email ?? "").toLowerCase()) {
    fail("التحويل لا يغير هوية الشخص أو بريده؛ أعد تحميل الربط القائم");
  }
  const resource = row.role === "cashier" ? "pos" : "inventory";
  const loginKind = resource === "pos" ? "pos" : "platform";
  if (person.loginKinds.length !== 1 || person.loginKinds[0] !== loginKind || !person.grants.length ||
    person.grants.some(g => g.resource !== resource || row.branchId != null && g.branchId !== row.branchId)) {
    fail("المنح المقترح خارج نوع الدور القديم أو فرعه المثبت؛ لا يسمح بتوسيع الوصول", 403);
  }
  // Never infer a cashier's branch from company-wide membership.
  if (row.role === "cashier" && row.branchId == null) fail("فرع الكاشير القديم غير مثبت؛ يلزم حسمه أولًا");
  // Validate scopes/module entitlement using existing machinery, without
  // reserving a second seat or treating this existing person's email as a duplicate.
  const effective = await previewTeamPerson(companyId, person, tx, row.personId!, true);
  const preview = {
    digest: digest({ companyId, row, person }),
    originalRole: row.role,
    person,
    allowedActions: [...new Set(effective.grants.flatMap(g => g.actions))],
    warnings: [
      "تحويل صريح لا ينفذ حتى تأكيد المعاينة؛ العضوية الأصلية وكلمة المرور والبيانات التاريخية لا تتغير.",
      "المسارات غير المغطاة والخصم والمرتجع والإغلاق والبحث والتصدير محجوبة بعد التحويل؛ ليس نقلًا كاملًا للدور القديم.",
      "تبقى المعالجة القديمة للأعضاء غير المحولين مؤقتًا حتى وجود خريطة موارد واختبارات تغطي دورهم.",
      "الرجوع إجراء مستقل يعيد المسار القديم الأوسع بعد معاينة حديثة وسبب؛ لا يحذف سجل المنح.",
    ],
  };
  return { row, preview };
}
export async function previewLegacyTeamConversion(companyId: number, ownerId: number, input: Input) {
  // Serialize the short preview with authority writers as well; no role/grant
  // writes or external effects. Apply recomputes under the same fence.
  return teamWrite(companyId, ownerId, async tx => (await impact(companyId, ownerId, input, tx)).preview);
}
export async function applyLegacyTeamConversion(companyId: number, ownerId: number, input: Input, expectedDigest: string) {
  return teamWrite(companyId, ownerId, async tx => {
    const [prior] = await teamRows<{ employee_id: number; applied_digest: string; state: string; creation_hash: string }>(tx, sql`
      SELECT lc.employee_id,lc.applied_digest,lc.state,a.creation_hash FROM legacy_team_conversions lc
      JOIN employee_access a ON a.employee_id=lc.employee_id AND a.company_id=lc.company_id
      WHERE lc.company_id=${companyId} AND lc.user_id=${input.userId}`);
    if (prior) {
      if (prior.state !== "active" || prior.applied_digest !== expectedDigest) fail("التحويل موجود بحالة أو معاينة مختلفة");
      const [person] = await teamPeople(companyId, tx, prior.employee_id);
      if (person.creationKey !== input.person.creationKey || prior.creation_hash !== digest(input.person)) fail("هوية المحاولة لا تطابق التحويل");
      return person;
    }
    const { row, preview } = await impact(companyId, ownerId, input, tx);
    if (preview.digest !== expectedDigest) fail("تغيرت العضوية أو خيارات التحويل؛ أعد المعاينة قبل التطبيق");
    await tx.execute(sql`INSERT INTO employee_access(employee_id,company_id,user_id,login_kinds,status,denied_actions,
      creation_key,creation_hash,created_by) VALUES(${row.personId},${companyId},${input.userId},
      ${sql.param(input.person.loginKinds)}::text[],'active',${sql.param(input.person.deniedActions)}::text[],
      ${input.person.creationKey},${digest(input.person)},${ownerId})`);
    await storeGrants(tx, companyId, row.personId!, ownerId, input.person);
    await tx.execute(sql`INSERT INTO legacy_team_conversions(company_id,user_id,employee_id,original_role,original_branch_id,
      applied_digest,created_by) VALUES(${companyId},${input.userId},${row.personId},${row.role},${row.branchId},${expectedDigest},${ownerId})`);
    await teamAudit(tx, companyId, ownerId, "team.legacy.convert", { userId: input.userId, personId: row.personId,
      originalRole: row.role, preview, unchangedIdentity: true });
    return (await teamPeople(companyId, tx, row.personId!))[0];
  });
}
async function rollbackImpact(companyId: number, ownerId: number, userId: number, tx: DbOrTx) {
  await teamOwner(companyId, ownerId, tx);
  const [row] = await teamRows<{ id: number; employee_id: number; original_role: string; original_branch_id: number | null;
    role: string; branch_id: number | null; state: string; revision: number; active: boolean; status: string; denied_actions: string[] }>(tx,
    sql`SELECT lc.id,lc.employee_id,lc.original_role,lc.original_branch_id,lc.state,uc.role,u.branch_id,
      (u.is_active AND e.user_id=lc.user_id AND e.status IN ('active','on_leave','probation')) AS active,
      a.revision,a.status,a.denied_actions FROM legacy_team_conversions lc
      JOIN user_companies uc ON uc.company_id=lc.company_id AND uc.user_id=lc.user_id
      JOIN users u ON u.id=lc.user_id JOIN employee_access a ON a.employee_id=lc.employee_id AND a.user_id=lc.user_id
      AND a.company_id=lc.company_id JOIN employees e ON e.id=lc.employee_id AND e.company_id=lc.company_id
      WHERE lc.company_id=${companyId} AND lc.user_id=${userId}`);
  if (!row || row.state !== "active") fail("لا يوجد تحويل نشط قابل للرجوع");
  // Do not re-enable an identity that another actor suspended, restricted or
  // moved. Such changes require explicit reconciliation, not snapshot restore.
  if (!row.active || row.status !== "active" || row.role !== row.original_role || row.branch_id !== row.original_branch_id) {
    fail("تغيرت أهلية الهوية أو عضويتها؛ يلزم حسم مستقل بدل استعادة صلاحيات قديمة");
  }
  const [custom] = await teamRows(tx, sql`SELECT user_id FROM return_access WHERE company_id=${companyId} AND user_id=${userId}
    AND (capabilities IS NOT NULL OR branches IS NOT NULL)`);
  if (custom) fail("أضيفت سياسة قديمة مخصصة؛ لا يرجع التحويل قبل مراجعتها");
  const profile = (await teamPeople(companyId, tx, row.employee_id))[0];
  return { row, preview: { digest: digest({ row, profile }), originalRole: row.original_role, allowedActions: [],
    warnings: ["سيعاد مسار الدور القديم، وهو أوسع من المنح المقيدة؛ راجع أثره قبل التأكيد.",
      "ستلغى المنح والدعوات المقيدة دون حذفها؛ لا تعديل لكلمة المرور أو العضويات الأخرى أو المستندات."] } };
}
export async function previewLegacyTeamRollback(companyId: number, ownerId: number, userId: number) {
  return teamWrite(companyId, ownerId, async tx => (await rollbackImpact(companyId, ownerId, userId, tx)).preview);
}
export async function rollbackLegacyTeamConversion(companyId: number, ownerId: number, userId: number, expectedDigest: string, reason: string) {
  return teamWrite(companyId, ownerId, async tx => {
    const { row, preview } = await rollbackImpact(companyId, ownerId, userId, tx);
    if (preview.digest !== expectedDigest) fail("تغيرت الصلاحيات؛ أعد معاينة الرجوع");
    await tx.execute(sql`UPDATE responsibility_grants SET revoked_at=now() WHERE company_id=${companyId}
      AND employee_id=${row.employee_id} AND revoked_at IS NULL`);
    await tx.execute(sql`UPDATE team_invitations SET revoked_at=now() WHERE company_id=${companyId}
      AND employee_id=${row.employee_id} AND revoked_at IS NULL AND used_at IS NULL`);
    await tx.execute(sql`UPDATE employee_access SET status='suspended',revision=revision+1,updated_at=now()
      WHERE employee_id=${row.employee_id} AND company_id=${companyId}`);
    await tx.execute(sql`UPDATE legacy_team_conversions SET state='reverted',reverted_at=now(),reverted_by=${ownerId},reason=${reason}
      WHERE id=${row.id}`);
    await teamAudit(tx, companyId, ownerId, "team.legacy.rollback", { userId, personId: row.employee_id, reason,
      originalRole: row.original_role, reviewDigest: expectedDigest });
    return { restored: true };
  });
}
