import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { GrantInput } from "./team-catalog";
import { teamRows, teamWrite, teamOwner, teamPolicy, teamAudit } from "./team-store";
import { FinancialRequestError } from "./financial-transaction";
import type { DbOrTx } from "./journal-posting";

export const PermissionTemplateInput=z.object({
  name:z.string().trim().min(2).max(100),resource:z.enum(["inventory","pos","procurement"]),
  actions:z.array(z.string()).min(1).max(20),
}).strict();
export const PermissionTemplateEdit=z.object({
  expectedRevision:z.number().int().positive(),name:z.string().trim().min(2).max(100),
  actions:z.array(z.string()).min(1).max(20),
}).strict();
export const PermissionTemplateApply=PermissionTemplateEdit.extend({digest:z.string().regex(/^[a-f0-9]{64}$/)});
type Edit=z.infer<typeof PermissionTemplateEdit>;
type Template={id:number;name:string;resource:"inventory"|"pos"|"procurement";actions:string[];revision:number};
function checkedActions(resource:string,actions:string[]) {
  // Reuse the grant action validator, including base read, available actions,
  // resource separation and direct-return dependencies. Dummy scope is never persisted.
  const g=GrantInput.parse({resource,actions,branchId:1,warehouseIds:[1],amountLimit:null,startsAt:null,endsAt:null});
  return [...new Set(g.actions)].sort();
}
export async function listPermissionTemplates(companyId:number,userId:number) {
  await teamOwner(companyId,userId);
  return teamRows<Template>(db,sql`SELECT id,name,resource,actions,revision FROM team_permission_templates
    WHERE company_id=${companyId} ORDER BY id`);
}
async function version(tx:DbOrTx,t:Template,userId:number) {
  await tx.execute(sql`INSERT INTO team_permission_template_versions(template_id,revision,name,actions,created_by)
    VALUES(${t.id},${t.revision},${t.name},${sql.param(t.actions)}::text[],${userId})`);
}
export async function createPermissionTemplate(companyId:number,userId:number,input:z.infer<typeof PermissionTemplateInput>) {
  return teamWrite(companyId,userId,async tx=>{
    const actions=checkedActions(input.resource,input.actions),policy=await teamPolicy(companyId,tx);
    if(!policy.enabledModules.includes(input.resource))throw new FinancialRequestError("الوحدة غير متاحة في الاستحقاق",403);
    const [t]=await teamRows<Template>(tx,sql`INSERT INTO team_permission_templates(company_id,name,resource,actions,created_by)
      VALUES(${companyId},${input.name},${input.resource},${sql.param(actions)}::text[],${userId}) RETURNING id,name,resource,actions,revision`);
    await version(tx,t,userId);await teamAudit(tx,companyId,userId,"team.template.created",{template:t});
    return t;
  });
}
async function impact(tx:DbOrTx,companyId:number,id:number,edit:Edit) {
  const [t]=await teamRows<Template>(tx,sql`SELECT id,name,resource,actions,revision FROM team_permission_templates
    WHERE company_id=${companyId} AND id=${id}`);
  if(!t)throw new FinancialRequestError("القالب غير متاح",404);
  if(edit.expectedRevision!==t.revision)throw new FinancialRequestError("تغير إصدار القالب؛ أعد المراجعة",409);
  const actions=checkedActions(t.resource,edit.actions),policy=await teamPolicy(companyId,tx);
  if(!policy.enabledModules.includes(t.resource))throw new FinancialRequestError("الوحدة غير متاحة في الاستحقاق",403);
  const rows=await teamRows<any>(tx,sql`SELECT g.id AS "grantId",g.employee_id AS "personId",e.name_ar AS name,a.status,
    a.revision,a.denied_actions AS "deniedActions",a.membership_departure,a.user_id,
    e.status AS employment,e.user_id AS employee_user_id,u.is_active AS identity_active,uc.role,
    g.template_mode AS mode,g.template_revision,g.branch_id AS "branchId",g.warehouse_ids AS "warehouseIds",
    g.amount_limit::text AS "amountLimit",g.starts_at AS "startsAt",g.ends_at AS "endsAt",g.actions,
    (g.starts_at<=clock_timestamp() AND (g.ends_at IS NULL OR g.ends_at>clock_timestamp())) AS in_period,
    (b.is_active AND NOT EXISTS(SELECT 1 FROM unnest(g.warehouse_ids) x(id)
      LEFT JOIN warehouses w ON w.id=x.id AND w.company_id=g.company_id AND w.branch_id=g.branch_id WHERE w.id IS NULL)) AS scope_valid
    FROM responsibility_grants g JOIN employee_access a ON a.employee_id=g.employee_id AND a.company_id=g.company_id
    JOIN employees e ON e.id=a.employee_id AND e.company_id=a.company_id
    JOIN branches b ON b.id=g.branch_id AND b.company_id=g.company_id
    LEFT JOIN users u ON u.id=a.user_id LEFT JOIN user_companies uc ON uc.user_id=a.user_id AND uc.company_id=a.company_id
    WHERE g.company_id=${companyId} AND g.template_id=${id} AND g.revoked_at IS NULL ORDER BY g.id`);
  const effects=rows.map(r=>{
    const blocked=r.status!=="active"||!r.role||!r.identity_active||r.employee_user_id!==r.user_id||
      !["active","on_leave","probation","preboarding"].includes(r.employment)||!r.in_period||!r.scope_valid;
    const afterActions=r.mode==="inherit"?actions:r.actions;
    const effective=(aa:string[])=>blocked||r.deniedActions.includes(`${t.resource}.read`)?[]:aa.filter(a=>!r.deniedActions.includes(a));
    return {personId:r.personId,name:r.name,status:r.status,grantId:r.grantId,mode:r.mode,
      branchId:r.branchId,warehouseIds:r.warehouseIds,amountLimit:r.amountLimit,startsAt:r.startsAt,endsAt:r.endsAt,
      beforeActions:r.actions,afterActions,effectiveBefore:effective(r.actions),effectiveAfter:effective(afterActions),
      deniedActions:r.deniedActions,blocked};
  });
  const digest=createHash("sha256").update(JSON.stringify({companyId,t,edit:{...edit,actions},policy,rows,effects})).digest("hex");
  return {template:t,actions,rows,effects,digest};
}
export async function previewPermissionTemplate(companyId:number,userId:number,id:number,edit:Edit) {
  return teamWrite(companyId,userId,async tx=>{
    const {effects,digest}=await impact(tx,companyId,id,edit);return {effects,digest};
  });
}
export async function applyPermissionTemplate(companyId:number,userId:number,id:number,input:z.infer<typeof PermissionTemplateApply>) {
  return teamWrite(companyId,userId,async tx=>{
    const {digest,...edit}=input,preview=await impact(tx,companyId,id,edit);
    if(digest!==preview.digest)throw new FinancialRequestError("تغير أثر التعديل أو نطاق أحد الموظفين؛ أعد المعاينة قبل التطبيق",409);
    const t={...preview.template,name:edit.name,actions:preview.actions,revision:preview.template.revision+1};
    await tx.execute(sql`UPDATE team_permission_templates SET name=${t.name},actions=${sql.param(t.actions)}::text[],
      revision=${t.revision},updated_at=now() WHERE id=${id} AND company_id=${companyId}`);
    await version(tx,t,userId);
    const people=new Set<number>();
    for(const r of preview.rows.filter(r=>r.mode==="inherit")){
      // Preserve the old grant as evidence; issue a new live version with exactly
      // the SAME branch/warehouses/amount/time. No Cartesian union or role change.
      await tx.execute(sql`UPDATE responsibility_grants SET revoked_at=now() WHERE id=${r.grantId} AND company_id=${companyId}`);
      await tx.execute(sql`INSERT INTO responsibility_grants(company_id,employee_id,resource,branch_id,warehouse_ids,actions,
        amount_limit,starts_at,ends_at,created_by,template_id,template_revision,template_mode)
        VALUES(${companyId},${r.personId},${t.resource},${r.branchId},${sql.param(r.warehouseIds)}::integer[],
        ${sql.param(t.actions)}::text[],${r.amountLimit}::numeric,${r.startsAt}::timestamptz,${r.endsAt}::timestamptz,${userId},
        ${id},${t.revision},'inherit')`);
      people.add(r.personId);
    }
    for(const personId of people)await tx.execute(sql`UPDATE employee_access SET revision=revision+1,updated_at=now()
      WHERE company_id=${companyId} AND employee_id=${personId}`);
    await teamAudit(tx,companyId,userId,"team.template.applied",{before:preview.template,after:t,digest,effects:preview.effects});
    return t;
  });
}
