import { db, auditLogsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { adminRows, administrativeRights, requireAdministrative, protectLastAdministrator, initializeLegacyAdministration, ADMIN_RESPONSIBILITIES, LEGACY_ADMIN_RESPONSIBILITIES } from "./administration-authority";
import { lockApprovalAuthorityWrite, authorityFingerprint } from "./approval-authority";
import { FinancialRequestError } from "./financial-transaction";
import type { DbOrTx } from "./journal-posting";
import { ensureAdministrativePerson } from "./administration-enrollment";
import { isPrimarySystemOwner, primaryOwnerStatus } from "./primary-system-owner";

export const HandoverInput = z.object({
  id:z.string().uuid(), expectedRevision:z.number().int().nonnegative(),
  toUserId:z.number().int().positive().nullable(),
  personId:z.number().int().positive().nullable(),
  responsibilities:z.array(z.enum(ADMIN_RESPONSIBILITIES)).min(1).max(ADMIN_RESPONSIBILITIES.length),
  departure:z.enum(["retain","stay","suspend","terminate"]),
  ownerTransfer:z.boolean().default(false),
}).strict().refine(b => !!b.toUserId !== !!b.personId,"اختر مستخدمًا أو شخصًا مدعوًا، لا كليهما");
type Handover = { id:string;company_id:number;from_user_id:number;to_user_id:number|null;person_id:number|null;
 responsibilities:string[];departure:string;revision:number;state:string;accepted_revision:number|null;eligibility:string|null;owner_transfer:boolean };
async function locked<T>(companyId:number, work:(tx:DbOrTx)=>Promise<T>) {
  return db.transaction(async tx=>{
    await lockApprovalAuthorityWrite(tx);
    await tx.execute(sql`SELECT id FROM companies WHERE id=${companyId} FOR UPDATE`);
    await initializeLegacyAdministration(tx,companyId);
    return work(tx);
  });
}
async function getHandover(tx:DbOrTx,id:string) {
  const [row]=await adminRows<Handover>(tx,sql`SELECT * FROM administration_handovers WHERE id=${id}`);
  if(!row)throw new FinancialRequestError("التسليم غير متاح",404);
  return row;
}
async function eligible(tx:DbOrTx,h:Handover) {
  const [target]=await adminRows(tx,sql`SELECT u.id,u.name,uc.role,a.status,a.revision,
    e.status AS employee_status,
    (SELECT i.id FROM team_invitations i WHERE i.company_id=uc.company_id AND i.employee_id=a.employee_id
      AND i.used_at IS NOT NULL AND i.revoked_at IS NULL ORDER BY i.id DESC LIMIT 1) AS invitation,
    (SELECT i.revoked_at FROM team_invitations i WHERE i.company_id=uc.company_id AND i.employee_id=a.employee_id
      ORDER BY i.id DESC LIMIT 1) AS cancelled,
    (SELECT ca.revision FROM company_administrators ca WHERE ca.company_id=uc.company_id AND ca.user_id=u.id) AS admin_revision
    FROM user_companies uc JOIN users u ON u.id=uc.user_id AND u.is_active
    LEFT JOIN employee_access a ON a.company_id=uc.company_id AND a.user_id=u.id
    LEFT JOIN employees e ON e.id=a.employee_id AND e.company_id=uc.company_id AND e.user_id=u.id
    WHERE uc.company_id=${h.company_id} AND (${h.person_id}::integer IS NULL AND u.id=${h.to_user_id}
      OR a.employee_id=${h.person_id})`);
  if(!target || target.id===h.from_user_id || (target.status && target.status!=="active") ||
    (target.status&&!['active','on_leave','probation','preboarding'].includes(target.employee_status)) ||
    target.cancelled || (h.person_id && !target.invitation))
    throw new FinancialRequestError("البديل غير مفعل أو سحبت أهليته أو ألغيت دعوته",409);
  return {userId:Number(target.id),fingerprint:authorityFingerprint(target)};
}
async function audit(tx:DbOrTx,h:Handover,actor:number,action:string) {
  const [user]=await adminRows(tx,sql`SELECT name FROM users WHERE id=${actor}`);
  await tx.insert(auditLogsTable).values({companyId:h.company_id,userId:actor,userName:user.name,
    entity:"administration_handover",action,details:JSON.stringify({
      id:h.id,fromUserId:h.from_user_id,toUserId:h.to_user_id,personId:h.person_id,
      responsibilities:h.responsibilities,departure:h.departure,revision:h.revision,ownerTransfer:h.owner_transfer})});
}
async function notices(tx:DbOrTx,h:Handover,message:string) {
  for(const userId of new Set([h.from_user_id,h.to_user_id].filter((id):id is number=>id!=null))) {
    await tx.execute(sql`INSERT INTO administration_notices(company_id,user_id,handover_id,message)
      VALUES(${h.company_id},${userId},${h.id},${message})`);
  }
}
export async function administrationWorkspace(companyId:number,userId:number) {
  const rights=await administrativeRights(companyId,userId);
  const handovers=await adminRows(db,sql`SELECT h.*,coalesce(h.to_user_id,a.user_id) AS to_user_id,
    f.name AS from_name,t.name AS to_name,e.name_ar AS invited_name
    FROM administration_handovers h JOIN users f ON f.id=h.from_user_id
    LEFT JOIN employee_access a ON a.employee_id=h.person_id AND a.company_id=h.company_id
    LEFT JOIN users t ON t.id=coalesce(h.to_user_id,a.user_id)
    LEFT JOIN employees e ON e.id=h.person_id WHERE h.company_id=${companyId}
    AND (h.from_user_id=${userId} OR h.to_user_id=${userId}
      OR h.person_id IN (SELECT employee_id FROM employee_access WHERE company_id=${companyId} AND user_id=${userId}))
    ORDER BY h.created_at DESC LIMIT 100`);
  const members=rights.includes("administrators") ? await adminRows(db,sql`
    SELECT uc.user_id AS id,u.name,uc.role,a.status,ca.responsibilities,ca.active,ca.primary_owner
    FROM user_companies uc JOIN users u ON u.id=uc.user_id AND u.is_active
    LEFT JOIN employee_access a ON a.company_id=uc.company_id AND a.user_id=u.id
    LEFT JOIN company_administrators ca ON ca.company_id=uc.company_id AND ca.user_id=u.id
    WHERE uc.company_id=${companyId} ORDER BY u.id`) : [];
  const pending=rights.includes("administrators") ? await adminRows(db,sql`
    SELECT a.employee_id AS id,e.name_ar AS name FROM employee_access a JOIN employees e ON e.id=a.employee_id
    WHERE a.company_id=${companyId} AND a.status='pending' AND a.user_id IS NULL AND e.email IS NOT NULL`) : [];
  const notifications=await adminRows(db,sql`SELECT id,message,handover_id,created_at FROM administration_notices
    WHERE company_id=${companyId} AND user_id=${userId} ORDER BY id DESC LIMIT 50`);
  return {userId,rights,responsibilities:ADMIN_RESPONSIBILITIES,handovers,members,pending,notifications,
    ...await primaryOwnerStatus(companyId,userId)};
}
export async function saveHandover(companyId:number,userId:number,input:z.infer<typeof HandoverInput>) {
  return locked(companyId,async tx=>{
    await requireAdministrative(companyId,userId,"administrators",tx);
    const rights=await administrativeRights(companyId,userId,tx);
    if(input.ownerTransfer && (!await isPrimarySystemOwner(companyId,userId,tx)||
      !LEGACY_ADMIN_RESPONSIBILITIES.every(r=>input.responsibilities.includes(r))))
      throw new FinancialRequestError("نقل مسؤولية مالك النظام يقتصر على المالك الحالي وبكامل المسؤوليات",403);
    if(!input.ownerTransfer&&input.departure!=="retain"&&await isPrimarySystemOwner(companyId,userId,tx))
      throw new FinancialRequestError("انقل مسؤولية مالك النظام أولًا؛ تسليم مسؤوليات مدير وحده لا يكفي",409);
    if((input.departure!=="retain"&&!input.responsibilities.includes("administrators")) || input.responsibilities.some(r=>!rights.includes(r)))
      throw new FinancialRequestError("يلزم تفويض إدارة المديرين ولا يمكن منح مسؤولية لا تملكها",403);
    if(input.toUserId===userId)throw new FinancialRequestError("اختر شخصًا آخر لاستلام الإدارة",400);
    const [old]=await adminRows<Handover>(tx,sql`SELECT * FROM administration_handovers WHERE id=${input.id}`);
    if(old&&(old.company_id!==companyId||old.from_user_id!==userId))throw new FinancialRequestError("التسليم غير متاح",404);
    if(old&&["completed","cancelled"].includes(old.state))throw new FinancialRequestError("الطلب منتهٍ؛ لا يعدل",409);
    if((old?.revision??0)!==input.expectedRevision) {
      // Lost response to an identical save may safely replay, never rewrite acceptance.
      if(old && old.to_user_id===input.toUserId && old.person_id===input.personId && old.departure===input.departure && old.owner_transfer===input.ownerTransfer &&
        authorityFingerprint(old.responsibilities)===authorityFingerprint(input.responsibilities) &&
        old.revision===input.expectedRevision+1) return old;
      throw new FinancialRequestError("تغير التسليم؛ أعد تحميله للمراجعة",409);
    }
    if(input.personId) {
      const [person]=await adminRows(tx,sql`SELECT a.employee_id FROM employee_access a JOIN employees e ON e.id=a.employee_id
        WHERE a.company_id=${companyId} AND a.employee_id=${input.personId} AND a.status='pending'
        AND a.user_id IS NULL AND e.email IS NOT NULL`);
      if(!person)throw new FinancialRequestError("المدعو غير متاح؛ استخدم حسابه بعد التفعيل",409);
    } else {
      await eligible(tx,{company_id:companyId,from_user_id:userId,to_user_id:input.toUserId,person_id:null} as Handover);
    }
    const [saved]=await adminRows<Handover>(tx,sql`INSERT INTO administration_handovers
      (id,company_id,from_user_id,to_user_id,person_id,responsibilities,departure,owner_transfer)
      VALUES(${input.id},${companyId},${userId},${input.toUserId},${input.personId},
        ${sql.param(input.responsibilities)}::text[],${input.departure},${input.ownerTransfer})
      ON CONFLICT(id) DO UPDATE SET to_user_id=excluded.to_user_id,person_id=excluded.person_id,
        responsibilities=excluded.responsibilities,departure=excluded.departure,owner_transfer=excluded.owner_transfer,revision=administration_handovers.revision+1,
        state='proposed',accepted_revision=NULL,eligibility=NULL,accepted_at=NULL RETURNING *`);
    await audit(tx,saved,userId,"administration.proposed");
    await notices(tx,saved,"طلب تسليم إدارة جديد أو معدل؛ يلزم مراجعة المسؤوليات والقبول");
    return saved;
  });
}
export async function acceptHandover(companyId:number,userId:number,id:string,revision:number) {
  return locked(companyId,async tx=>{
    const h=await getHandover(tx,id);
    if(h.company_id!==companyId)throw new FinancialRequestError("التسليم غير متاح",404);
    await requireAdministrative(companyId,h.from_user_id,"administrators",tx);
    if(h.owner_transfer&&!await isPrimarySystemOwner(companyId,h.from_user_id,tx))
      throw new FinancialRequestError("تغير مالك النظام؛ الطلب لم يعد مخوّلًا",409);
    const target=await eligible(tx,h);
    if(target.userId!==userId)throw new FinancialRequestError("القبول للبديل نفسه بعد دخوله",403);
    if(h.revision!==revision||!["proposed","accepted"].includes(h.state))throw new FinancialRequestError("تغير الطلب أو انتهى؛ راجعه مجددًا",409);
    const actorRights=await administrativeRights(companyId,h.from_user_id,tx);
    if(h.responsibilities.some(r=>!actorRights.includes(r)))throw new FinancialRequestError("تغيرت سلطة المسلّم",409);
    if(h.state==="accepted"&&h.eligibility===target.fingerprint)return h;
    await tx.execute(sql`UPDATE administration_handovers SET to_user_id=${userId},state='accepted',
      accepted_revision=revision,eligibility=${target.fingerprint},accepted_at=now() WHERE id=${id}`);
    const after=await getHandover(tx,id);
    await audit(tx,after,userId,"administration.accepted");
    await notices(tx,after,"قبل البديل الاستلام؛ لم يتغير وصول المدير المغادر بعد");
    return after;
  });
}
export async function completeHandover(userId:number,id:string,revision:number,replayOnly=false) {
  const locator=await getHandover(db,id);
  if(locator.from_user_id!==userId)throw new FinancialRequestError("التسليم غير متاح",404);
  return locked(locator.company_id,async tx=>{
    const h=await getHandover(tx,id);
    if(h.state==="completed"&&h.revision===revision)return {ok:true,id:h.id,departure:h.departure,replayed:true};
    if(replayOnly)throw new FinancialRequestError("جلسة الاسترداد تسترجع نتيجة مكتملة فقط؛ يلزم دخول تشغيلي لتنفيذ تسليم جديد",409);
    await requireAdministrative(h.company_id,userId,"administrators",tx);
    const target=await eligible(tx,h);
    const rights=await administrativeRights(h.company_id,userId,tx);
    if(h.state!=="accepted"||h.revision!==revision||h.accepted_revision!==revision||
      h.eligibility!==target.fingerprint||h.responsibilities.some(r=>!rights.includes(r)))
      throw new FinancialRequestError("لم يقبل البديل النسخة الحالية أو تغيرت أهليته؛ يلزم مراجعة وقبول جديدان",409);
    const current=await administrativeRights(h.company_id,target.userId,tx);
    if(h.owner_transfer) {
      if(!await isPrimarySystemOwner(h.company_id,userId,tx))
        throw new FinancialRequestError("لم يعد المرسل مالك النظام",409);
      await tx.execute(sql`UPDATE company_administrators SET primary_owner=false,revision=revision+1
        WHERE company_id=${h.company_id} AND user_id=${userId} AND primary_owner`);
      await tx.execute(sql`UPDATE user_companies SET role='scoped' WHERE company_id=${h.company_id} AND user_id=${userId}`);
      await ensureAdministrativePerson(tx,h.company_id,userId);
      await tx.execute(sql`UPDATE user_companies SET role='owner' WHERE company_id=${h.company_id} AND user_id=${target.userId}`);
    }
    await tx.execute(sql`INSERT INTO company_administrators(company_id,user_id,responsibilities)
      VALUES(${h.company_id},${target.userId},${sql.param([...new Set([...current,...h.responsibilities])])}::text[])
      ON CONFLICT(company_id,user_id) DO UPDATE SET responsibilities=excluded.responsibilities,active=true,
        revision=company_administrators.revision+1,updated_at=now()`);
    if(h.owner_transfer)await tx.execute(sql`UPDATE company_administrators SET primary_owner=true
      WHERE company_id=${h.company_id} AND user_id=${target.userId}`);
    if(h.departure==="retain") {
      await tx.execute(sql`UPDATE administration_handovers SET state='completed',completed_at=now() WHERE id=${id}`);
      await audit(tx,h,userId,"administration.appointed");
      await notices(tx,h,"اكتمل تعيين مدير مستقل بعد قبوله؛ لم يتغير وصول المدير الحالي أو صلاحيات البيع والمال");
      return {ok:true,id:h.id,departure:h.departure,replayed:false};
    }
    await protectLastAdministrator(tx,h.company_id,userId);
    await tx.execute(sql`INSERT INTO company_administrators(company_id,user_id,active,responsibilities)
      VALUES(${h.company_id},${userId},false,'{}')
      ON CONFLICT(company_id,user_id) DO UPDATE SET active=false,responsibilities='{}',
        revision=company_administrators.revision+1,updated_at=now()`);
    // A legacy owner's finance remains unchanged until THIS explicit departure.
    // Retain only already assigned functional access, never infer a new financial role.
    await tx.execute(sql`UPDATE user_companies SET role='scoped' WHERE company_id=${h.company_id}
      AND user_id=${userId} AND role='owner'`);
    if(h.departure==="stay")await ensureAdministrativePerson(tx,h.company_id,userId);
    if(h.departure!=="stay") {
      await ensureAdministrativePerson(tx,h.company_id,userId);
      await tx.execute(sql`DELETE FROM user_companies WHERE company_id=${h.company_id} AND user_id=${userId}`);
      await tx.execute(sql`UPDATE employee_access SET status='suspended',membership_departure=${h.departure},
        revision=revision+1,updated_at=now()
        WHERE company_id=${h.company_id} AND user_id=${userId}`);
      if(h.departure==="terminate")await tx.execute(sql`UPDATE responsibility_grants SET revoked_at=now()
        WHERE company_id=${h.company_id} AND employee_id IN
        (SELECT employee_id FROM employee_access WHERE company_id=${h.company_id} AND user_id=${userId}) AND revoked_at IS NULL`);
      await tx.execute(sql`UPDATE approver_delegations SET revoked_at=now(),revoked_by=${userId}
        WHERE company_id=${h.company_id} AND (from_user_id=${userId} OR to_user_id=${userId}) AND revoked_at IS NULL`);
      await tx.execute(sql`UPDATE team_invitations SET revoked_at=now() WHERE company_id=${h.company_id}
        AND employee_id IN (SELECT employee_id FROM employee_access WHERE company_id=${h.company_id} AND user_id=${userId})
        AND revoked_at IS NULL`);
    }
    // Session scope is explicit. Other-company sessions/identities are not touched.
    await tx.execute(sql`DELETE FROM "session" WHERE sess->>'userId'=${String(userId)}
      AND sess->>'companyId'=${String(h.company_id)}`);
    await tx.execute(sql`UPDATE administration_handovers SET state='completed',completed_at=now() WHERE id=${id}`);
    await audit(tx,h,userId,"administration.completed");
    await notices(tx,h,h.departure==="stay"?"اكتمل تسليم الإدارة؛ بقيت العضوية بصلاحيات الوظيفة المعتمدة فقط":
      h.departure==="suspend"?"اكتمل تسليم الإدارة وتعليق وصول المغادر لهذه المنشأة":"اكتمل تسليم الإدارة وإنهاء عضوية المغادر بهذه المنشأة");
    return {ok:true,id:h.id,departure:h.departure,replayed:false};
  });
}
export async function setAdministrator(companyId:number,actor:number,target:number,responsibilities:string[],active:boolean) {
  return locked(companyId,async tx=>{
    await requireAdministrative(companyId,actor,"administrators",tx);
    const rights=await administrativeRights(companyId,actor,tx);
    if(responsibilities.some(r=>!rights.includes(r)||!ADMIN_RESPONSIBILITIES.includes(r as any)))
      throw new FinancialRequestError("لا يمكنك منح مسؤوليات لا تملكها",403);
    await eligible(tx,{company_id:companyId,from_user_id:-1,to_user_id:target,person_id:null} as Handover);
    if(await isPrimarySystemOwner(companyId,target,tx)&&(!active||!LEGACY_ADMIN_RESPONSIBILITIES.every(r=>responsibilities.includes(r))))
      await protectLastAdministrator(tx,companyId,target);
    if(!active||!responsibilities.includes("administrators"))await protectLastAdministrator(tx,companyId,target);
    // Limited administrators still use accepted appointments; the explicit
    // primary owner may appoint or edit managers independently of a departure.
    const previous=await administrativeRights(companyId,target,tx);
    if(active&&target!==actor&&responsibilities.some(r=>!previous.includes(r))&&!await isPrimarySystemOwner(companyId,actor,tx))
      throw new FinancialRequestError("زيادة مسؤوليات مدير آخر تتم بطلب تعيين وقبول صريح من البديل",409);
    await tx.execute(sql`INSERT INTO company_administrators(company_id,user_id,responsibilities,active)
      VALUES(${companyId},${target},${sql.param(responsibilities)}::text[],${active})
      ON CONFLICT(company_id,user_id) DO UPDATE SET responsibilities=excluded.responsibilities,active=excluded.active,
        revision=company_administrators.revision+1,updated_at=now()`);
    await tx.insert(auditLogsTable).values({companyId,userId:actor,userName:(await adminRows(tx,sql`SELECT name FROM users WHERE id=${actor}`))[0].name,
      entity:"company_administrator",action:"administration.permissions",details:JSON.stringify({target,responsibilities,active})});
    return {ok:true};
  });
}
export async function handoverReceipt(userId:number,id:string) {
  const h=await getHandover(db,id);
  if(h.from_user_id!==userId&&h.to_user_id!==userId)throw new FinancialRequestError("السند غير متاح",404);
  return {id:h.id,state:h.state,revision:h.revision,departure:h.departure,responsibilities:h.responsibilities,owner_transfer:h.owner_transfer};
}

/** Forced company-local departure is not a transfer and never needs target consent. */
export async function revokeCompanyMember(companyId:number,actor:number,target:number,departure:"suspend"|"terminate") {
  return locked(companyId,async tx=>{
    if(!await isPrimarySystemOwner(companyId,actor,tx))
      throw new FinancialRequestError("إلغاء وصول المديرين والعضويات هنا لمالك النظام فقط",403);
    return revokeMembershipInside(tx,companyId,actor,target,departure);
  });
}
export async function leaveCompanyMembership(companyId:number,userId:number,departure:"suspend"|"terminate") {
  return locked(companyId,tx=>revokeMembershipInside(tx,companyId,userId,userId,departure));
}
async function revokeMembershipInside(tx:DbOrTx,companyId:number,actor:number,target:number,departure:"suspend"|"terminate") {
    await protectLastAdministrator(tx,companyId,target);
    const [membership]=await adminRows(tx,sql`SELECT role FROM user_companies WHERE company_id=${companyId} AND user_id=${target}`);
    if(!membership)throw new FinancialRequestError("العضوية غير متاحة في هذه المنشأة",404);
    await ensureAdministrativePerson(tx,companyId,target);
    await tx.execute(sql`UPDATE company_administrators SET active=false,responsibilities='{}',
      revision=revision+1,updated_at=now() WHERE company_id=${companyId} AND user_id=${target}`);
    await tx.execute(sql`DELETE FROM user_companies WHERE company_id=${companyId} AND user_id=${target}`);
    await tx.execute(sql`UPDATE employee_access SET status='suspended',membership_departure=${departure},revision=revision+1,updated_at=now()
      WHERE company_id=${companyId} AND user_id=${target}`);
    if(departure==="terminate")await tx.execute(sql`UPDATE responsibility_grants SET revoked_at=now() WHERE company_id=${companyId} AND revoked_at IS NULL
      AND employee_id IN(SELECT employee_id FROM employee_access WHERE company_id=${companyId} AND user_id=${target})`);
    await tx.execute(sql`UPDATE approver_delegations SET revoked_at=now(),revoked_by=${actor} WHERE company_id=${companyId}
      AND (from_user_id=${target} OR to_user_id=${target}) AND revoked_at IS NULL`);
    await tx.execute(sql`UPDATE team_invitations SET revoked_at=now() WHERE company_id=${companyId} AND revoked_at IS NULL
      AND employee_id IN(SELECT employee_id FROM employee_access WHERE company_id=${companyId} AND user_id=${target})`);
    await tx.execute(sql`DELETE FROM "session" WHERE sess->>'userId'=${String(target)} AND sess->>'companyId'=${String(companyId)}`);
    await tx.execute(sql`INSERT INTO audit_logs(company_id,user_id,user_name,entity,action,details)
      SELECT ${companyId},id,name,'company_administrator','administration.access_revoked',
      ${JSON.stringify({target,departure})} FROM users WHERE id=${actor}`);
    return {ok:true};
}
