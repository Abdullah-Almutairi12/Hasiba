import type {Request} from "express";
import {db,appSettingsTable,auditLogsTable} from "@workspace/db";
import {and,eq,isNull,sql} from "drizzle-orm";
import {z} from "zod";
import {administrativeRights} from "./administration-authority";
import {lockApprovalAuthority} from "./approval-authority";
import {FinancialRequestError} from "./financial-transaction";
import {currentResponsibilities,managedProfile} from "./responsibility-context";
import type {DbOrTx} from "./journal-posting";
import {validateDesignAssets} from "./invoice-design";

export const settingSections=["company","tax","branches","pos","permissions","accounting","integrations","notifications",
 "localization","numbering","appearance","backup","templates"] as const;
type Section=typeof settingSections[number];
type Row=typeof appSettingsTable.$inferSelect;
const branchSections=new Set<Section>(["company","pos","localization","numbering","appearance","templates"]);
const regional=new Set(["currency","timezone","language"]);
const json=z.record(z.string().max(100),z.unknown());
const patchSchema=z.object({
 ...Object.fromEntries(settingSections.map(s=>[s,json.optional()])),
 expectedRevision:z.number().int().nonnegative(),
 expectedCompanyId:z.number().int().positive(),
 expectedParentRevision:z.number().int().nonnegative().optional(),
 reset:z.record(z.string(),z.array(z.string().max(100))).optional(),
}).strict();
const own=(companyId:number,branchId:number|null)=>and(eq(appSettingsTable.companyId,companyId),
 branchId==null?isNull(appSettingsTable.branchId):eq(appSettingsTable.branchId,branchId));
function branchParam(req:Request){
 if(req.query.branchId==null)return null;
 const n=Number(req.query.branchId);
 if(!Number.isSafeInteger(n)||n<=0)throw new FinancialRequestError("الفرع غير صحيح",400);
 return n;
}
async function access(req:Request,tx:DbOrTx,branchId:number|null,write:boolean){
 const companyId=req.session.companyId!,userId=req.session.userId!;
 if(!(await tx.execute(sql`SELECT 1 FROM user_companies uc JOIN users u ON u.id=uc.user_id AND u.is_active
  JOIN companies c ON c.id=uc.company_id AND c.is_active WHERE uc.company_id=${companyId} AND uc.user_id=${userId}`)).rows.length)
  throw new FinancialRequestError("العضوية الحالية غير متاحة",403);
 const profile=await managedProfile(userId,companyId);
 if(profile&&profile.status!=="active")throw new FinancialRequestError("الوصول غير مفعل",403);
 const rights=await administrativeRights(companyId,userId,tx);
 const manager=(await tx.execute(sql`SELECT 1 FROM user_companies uc JOIN users u ON u.id=uc.user_id AND u.is_active
  JOIN companies c ON c.id=uc.company_id AND c.is_active
  WHERE uc.company_id=${companyId} AND uc.user_id=${userId} AND uc.role='manager'
  AND NOT EXISTS(SELECT 1 FROM company_administrators WHERE company_id=uc.company_id)
  AND NOT EXISTS(SELECT 1 FROM employee_access WHERE company_id=uc.company_id AND user_id=uc.user_id)`)).rows.length>0;
 const canManage=rights.includes("settings")||manager;
 if(write&&!canManage)throw new FinancialRequestError("إدارة الإعدادات غير ممنوحة في هذه المنشأة",403);
 if(branchId!=null){
  if(!(await tx.execute(sql`SELECT 1 FROM branches WHERE id=${branchId} AND company_id=${companyId}`)).rows.length)
   throw new FinancialRequestError("الفرع غير متاح في المنشأة الحالية",404);
  if(!canManage){
   const grant=(await currentResponsibilities(userId,companyId)).find(g=>g.id===Number(req.get("X-Workspace-Responsibility")));
   if(!grant||grant.branchId!==branchId)throw new FinancialRequestError("الفرع خارج المسؤولية المختارة",403);
  }
 }
 return {companyId,userId,canManage};
}
export {access as authorizeSettingsScope};
async function ensureCompany(tx:DbOrTx,companyId:number){
 await tx.insert(appSettingsTable).values({companyId}).onConflictDoNothing();
 return (await tx.select().from(appSettingsTable).where(own(companyId,null)))[0]!;
}
async function versions(tx:DbOrTx,companyId:number,branchId:number|null,allowed:boolean){
 if(!allowed)return [];
 return (await tx.execute(sql`SELECT revision,parent_revision AS "parentRevision",created_by AS "createdBy",
  created_at AS "createdAt",changed_sections AS sections FROM app_settings_versions
  WHERE company_id=${companyId} AND branch_id IS NOT DISTINCT FROM ${branchId}
  ORDER BY revision DESC LIMIT 50`)).rows;
}
async function availableBranches(tx:DbOrTx,companyId:number,allowed:boolean){
 if(!allowed)return [];
 return (await tx.execute(sql`SELECT id,name,name_ar AS "nameAr" FROM branches WHERE company_id=${companyId} ORDER BY id`)).rows;
}
function scrub(value:unknown):unknown{
 if(Array.isArray(value))return value.map(scrub);
 if(!value||typeof value!=="object")return value;
 return Object.fromEntries(Object.entries(value).filter(([k])=>!/(secret|password|token|private.?key|api.?key|csid|credential|smtp.?user|zatca.?api.?url)/i.test(k))
  .map(([k,v])=>[k,scrub(v)]));
}
function serialize(root:Row,branch:Row|undefined,canManage:boolean){
 const sections=Object.fromEntries(settingSections.map(s=>[s,{...(root[s] as object),...(branch?.[s] as object??{})}]));
 if(!canManage){
  for(const s of settingSections)if(!["company","localization","appearance"].includes(s))sections[s]={};
  sections.company=Object.fromEntries(Object.entries(sections.company).filter(([k])=>regional.has(k)));
  for(const s of settingSections)sections[s]=scrub(sections[s]) as object;
  const publicKeys:Record<string,string[]>={
   localization:["dateFormat","timeFormat","calendar","weekStart","firstDayOfWeek","timezone","language","currency","locale","rtl"],
   appearance:["theme","primaryColor","accentColor","logoSize","tableDensity","fontSize","fontFamily","borderRadius","darkMode","sidebarCollapsed","compactTables"]};
  for(const [s,keys] of Object.entries(publicKeys))sections[s]=Object.fromEntries(Object.entries(sections[s]).filter(([k])=>keys.includes(k)));
 }
 return {...sections,updatedAt:(branch?.updatedAt??root.updatedAt).toISOString(),
  scope:{companyId:root.companyId,branchId:branch?.branchId??null,revision:branch?.revision??root.revision,
   parentRevision:root.revision,canManage,
   overrides:Object.fromEntries(settingSections.map(s=>[s,canManage?Object.keys((branch?.[s]??{}) as object):[]])),
   historyPolicy:"unassigned_legacy_not_adopted",history:[] as Record<string,unknown>[],availableBranches:[] as Record<string,unknown>[]}};
}
export async function readScopedSettings(req:Request){
 const branchId=branchParam(req);
 return db.transaction(async tx=>{
  await lockApprovalAuthority(tx);
  const actor=await access(req,tx,branchId,false);
  // Company lock serializes root/branch versions; auth is re-read AFTER waiting.
  await tx.execute(sql`SELECT id FROM companies WHERE id=${actor.companyId} FOR UPDATE`);
  const fresh=await access(req,tx,branchId,false);
  const root=await ensureCompany(tx,actor.companyId);
  const branch=branchId==null?undefined:(await tx.select().from(appSettingsTable).where(own(actor.companyId,branchId)))[0];
  const result=serialize(root,branch,fresh.canManage);
  result.scope.branchId=branchId;
  if(branchId!=null&&!branch)result.scope.revision=0;
  result.scope.history=await versions(tx,actor.companyId,branchId,fresh.canManage);
  result.scope.availableBranches=await availableBranches(tx,actor.companyId,fresh.canManage);
  return result;
 });
}
export async function patchScopedSettings(req:Request){
 const branchId=branchParam(req);
 return db.transaction(async tx=>{
  await lockApprovalAuthority(tx);
  const actor=await access(req,tx,branchId,true);
  const body=patchSchema.parse(req.body) as {expectedRevision:number;expectedCompanyId:number;expectedParentRevision?:number;reset?:Record<string,string[]>}&Partial<Record<Section,Record<string,unknown>>>;
  if(body.expectedCompanyId!==actor.companyId)throw new FinancialRequestError("تغيرت المنشأة النشطة؛ أعد فتح إعدادات المنشأة المطلوبة قبل الحفظ",409);
  await tx.execute(sql`SELECT id FROM companies WHERE id=${actor.companyId} FOR UPDATE`);
  await access(req,tx,branchId,true);
  if (body.templates && Object.hasOwn(body.templates,"invoiceDesign"))
   body.templates.invoiceDesign=await validateDesignAssets(tx,actor.companyId,body.templates.invoiceDesign);
  const root=await ensureCompany(tx,actor.companyId);
  let current=root;
  if(branchId!=null){
   await tx.insert(appSettingsTable).values({companyId:actor.companyId,branchId}).onConflictDoNothing();
   current=(await tx.select().from(appSettingsTable).where(own(actor.companyId,branchId)))[0]!;
  }
  if(body.expectedRevision!==current.revision||branchId!=null&&body.expectedParentRevision!==root.revision)
   throw new FinancialRequestError("تغيرت نسخة إعدادات المنشأة أو الفرع؛ احتفظ بتعديلاتك ثم أعد تحميل النسخة قبل الحفظ",409);
  const next:Partial<typeof appSettingsTable.$inferInsert>={updatedAt:new Date(),revision:current.revision+1};
  const changed:Record<string,number>={};
  for(const key of Object.keys(body.reset??{}))if(!settingSections.includes(key as Section))
   throw new FinancialRequestError("قسم العودة للموروث غير صحيح",400);
  for(const s of settingSections){
   const reset=body.reset?.[s]??[];
   if(body[s]==null&&!reset.length)continue;
   if(branchId!=null&&!branchSections.has(s))throw new FinancialRequestError("هذا القسم يديره إعداد المنشأة ولا يقبل تجاوز الفرع",400);
   if(branchId==null&&reset.length)throw new FinancialRequestError("العودة للموروث متاحة للفرع فقط",400);
   if(branchId!=null&&s==="company"&&[...Object.keys(body[s]??{}),...reset].some(k=>!regional.has(k)))
    throw new FinancialRequestError("هوية المنشأة القانونية ليست تخصيصًا إقليميًا للفرع",400);
   if(reset.some(k=>Object.hasOwn(body[s]??{},k)))throw new FinancialRequestError("لا يمكن حفظ الحقل وإعادته للموروث في الطلب نفسه",400);
   const values={...(current[s] as Record<string,unknown>),...body[s]};
   for(const k of reset)delete values[k];
   next[s]=values;changed[s]=Object.keys(body[s]??{}).length+reset.length;
  }
  if(!Object.keys(changed).length)throw new FinancialRequestError("لا توجد تغييرات إعدادات للحفظ",400);
  const [saved]=await tx.update(appSettingsTable).set(next).where(eq(appSettingsTable.id,current.id)).returning();
  // No secret values or free-text credentials are copied into audit evidence.
  await tx.execute(sql`INSERT INTO app_settings_versions(company_id,branch_id,revision,parent_revision,changed_sections,created_by)
   VALUES(${actor.companyId},${branchId},${saved!.revision},${root.revision},${JSON.stringify(changed)}::jsonb,${actor.userId})`);
  const [identity]=(await tx.execute(sql`SELECT name FROM users WHERE id=${actor.userId}`)).rows;
  await tx.insert(auditLogsTable).values({companyId:actor.companyId,userId:actor.userId,userName:String(identity?.name??"مستخدم"),
   action:"settings.scope.updated",entity:`app_settings#${saved!.id}`,details:JSON.stringify({
    branchId,revision:saved!.revision,parentRevision:root.revision,sections:changed,reset:!!body.reset})});
  const result=serialize(branchId==null?saved!:root,branchId==null?undefined:saved,true);
  result.scope.history=await versions(tx,actor.companyId,branchId,true);
  result.scope.availableBranches=await availableBranches(tx,actor.companyId,true);
  return result;
 });
}
