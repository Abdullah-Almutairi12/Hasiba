import {db} from "@workspace/db";
import {sql,type SQL} from "drizzle-orm";
import {createHash} from "node:crypto";
import {z} from "zod";
import type {Request} from "express";
import type {DbOrTx} from "./journal-posting";
import {withAccountProof} from "./account-security";
import {administrativeRights,requireAdministrative,initializeLegacyAdministration} from "./administration-authority";
import {FinancialRequestError,canonical} from "./financial-transaction";
import {computeTotals,type SalesLineInput} from "./sales-engine";
import {getCompanyId} from "./scoped-db";

export const taxRuleSchema=z.object({
  category:z.enum(["standard","zero","exempt"]),
  reason:z.string().trim().max(250).optional(),
}).strict().superRefine((r,ctx)=>{
  if(r.category!=="standard"&&(!r.reason||r.reason.length<6))
    ctx.addIssue({code:"custom",message:"سبب موثق مطلوب للتوريد الصفري أو المعفى",path:["reason"]});
  if(r.category==="standard"&&r.reason)
    ctx.addIssue({code:"custom",message:"لا يُستخدم سبب إعفاء لبند خاضع للنسبة الأساسية",path:["reason"]});
});
export const taxPolicySchema=z.object({
  adoptTaxAdministration:z.boolean().optional(),
  revision:z.number().int().nonnegative(),
  requestId:z.string().uuid(),
  effectiveFrom:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status:z.enum(["registered","voluntary","not_registered"]),
  vatNumber:z.string().trim().nullable(),
  priceIncludesVat:z.boolean(),
  productRules:z.array(z.object({productId:z.number().int().positive(),rule:taxRuleSchema}).strict()).max(10000),
  serviceRule:taxRuleSchema,
  reason:z.string().trim().min(6).max(500),
  proof:z.object({currentPassword:z.string().min(1).max(200),token:z.string().max(20).optional(),recoveryCode:z.string().max(100).optional()}),
}).strict().superRefine((p,ctx)=>{
  if(p.status==="not_registered"&&(p.vatNumber!==null||p.priceIncludesVat))
    ctx.addIssue({code:"custom",message:"غير المسجل لا يملك رقم ضريبة ساريًا ولا تسعيرًا شاملًا للضريبة",path:["vatNumber"]});
  if(p.status!=="not_registered"&&!/^3\d{13}3$/.test(p.vatNumber??""))
    ctx.addIssue({code:"custom",message:"رقم ضريبي سعودي من15 رقمًا يبدأ وينتهي بـ3؛ الصيغة ليست تحققًا من التسجيل",path:["vatNumber"]});
  const date=new Date(p.effectiveFrom+"T00:00:00Z");
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==p.effectiveFrom)
    ctx.addIssue({code:"custom",message:"تاريخ سريان غير صحيح",path:["effectiveFrom"]});
  if(new Set(p.productRules.map(r=>r.productId)).size!==p.productRules.length)
    ctx.addIssue({code:"custom",message:"تكرر صنف في التصنيف الضريبي",path:["productRules"]});
});
export type TaxRule=z.infer<typeof taxRuleSchema>;
export type TaxPolicyInput=z.infer<typeof taxPolicySchema>;
export function riyadhDate(at=new Date()) {
  return new Date(at.getTime()+3*3600000).toISOString().slice(0,10);
}
function dateValue(v:unknown){return v instanceof Date?riyadhDate(v):String(v).slice(0,10);}
type TaxTx=Pick<typeof db,"execute">;
const rows=async(tx:TaxTx,q:SQL)=>(await tx.execute(q)).rows as Record<string,any>[];
function hash(value:unknown){return createHash("sha256").update(canonical(value)).digest("hex");}
export async function taxContext(companyId:number,at=riyadhDate(),tx:TaxTx=db){
  const [c]=await rows(tx,sql`SELECT * FROM companies WHERE id=${companyId} AND is_active`);
  if(!c)throw new FinancialRequestError("الشركة غير متاحة",404);
  const [v]=await rows(tx,sql`SELECT * FROM company_tax_policy_versions WHERE company_id=${companyId}
    AND effective_from<=${at}::date ORDER BY effective_from DESC,revision DESC LIMIT 1`);
  const [first]=await rows(tx,sql`SELECT created_at FROM company_tax_policy_versions
    WHERE company_id=${companyId} ORDER BY revision LIMIT 1`);
  // A new backdated operation cannot manufacture registration evidence before
  // transition. Existing issued documents use their immutable issuer snapshot.
  const historicalUnknown=!!first&&at<riyadhDate(new Date(first.created_at));
  const status=historicalUnknown?"unresolved":v?.status??c.vat_registration_status??"unresolved";
  const valid=["registered","voluntary","not_registered"].includes(status);
  const result={
    companyId,policyId:v?Number(v.id):null,revision:v?Number(v.revision):0,
    effectiveFrom:v?dateValue(v.effective_from):null,
    status:valid?status:"unresolved",registered:status==="registered"||status==="voluntary",
    vatNumber:valid&&status!=="not_registered"?(v?.vat_number??c.vat_number??null):null,
    priceIncludesVat:v?.price_includes_vat===true,mode:v?"unified":"legacy",
    registrationVerification:"declared_unverified",
  };
  return {...result,token:hash(result),productRules:(v?.product_rules??[]) as TaxPolicyInput["productRules"],
    serviceRule:(v?.service_rule??{category:"standard"}) as TaxRule};
}
export function publicTaxContext(context:Awaited<ReturnType<typeof taxContext>>){
  const {productRules,serviceRule,...safe}=context;return safe;
}
export async function taxPolicyView(req:Request){
  const cid=getCompanyId(req),uid=req.session.userId!;
  const rights=await administrativeRights(cid,uid);
  if(!rights.some(r=>r==="settings"||r==="tax"))throw new FinancialRequestError("عرض الإعداد الضريبي غير ممنوح",403);
  const current=await taxContext(cid);
  const history=await rows(db,sql`SELECT revision,effective_from,status,vat_number,price_includes_vat,
    reason,created_by,created_at FROM company_tax_policy_versions WHERE company_id=${cid} ORDER BY revision DESC`);
  const products=await rows(db,sql`SELECT id,name,price FROM products WHERE company_id=${cid} AND is_active ORDER BY id`);
  return {canManage:rights.includes("tax"),
    canAdopt:!rights.includes("tax")&&history.length===0&&rights.includes("settings")&&rights.includes("administrators"),
    publishingReady:false,current,revision:history[0]?.revision??0,history,products,
    transition:{legacyUnchanged:current.mode==="legacy",historicalDocumentsUnchanged:true,
      missingClassifications:current.registered?products.filter(p=>!current.productRules.some(r=>r.productId===p.id)).length:0},
    integration:{registrationVerified:false,productionAcceptance:false,
      explanation:"إعداد الضريبة ليس تسجيلًا لدى الهيئة أو تهيئة جهاز أو دليل قبول إنتاجي. لا تحقق آلي من السجل في هذا المسار."}};
}
/** A company's first opt-in may explicitly commission the tax responsibility.
 * It requires BOTH existing governance capabilities, a frozen explicit request
 * and fresh account proof. It is not a legacy-role entitlement or a recovery
 * bypass after a published policy or a revoked tax grant. */
async function policyAuthority(req:Request,input:TaxPolicyInput,tx:DbOrTx=db) {
  const cid=getCompanyId(req),uid=req.session.userId!;
  const rights=await administrativeRights(cid,uid,tx);
  if(rights.includes("tax"))return false;
  const [previous]=await rows(tx,sql`SELECT 1 FROM company_tax_policy_versions WHERE company_id=${cid} LIMIT 1`);
  if(!input.adoptTaxAdministration||input.revision!==0||previous||
    !rights.includes("settings")||!rights.includes("administrators"))
    throw new FinancialRequestError("يلزم إذن ضريبي صريح؛ تهيئة المسؤولية الأولى تتطلب إدارة الإعدادات والمديرين وتأكيد الحساب",403);
  return true;
}
async function requestAuthority(req:Request,tx:DbOrTx=db){
  const rights=await administrativeRights(getCompanyId(req),req.session.userId!,tx);
  if(!rights.includes("tax")&&!(rights.includes("settings")&&rights.includes("administrators")))
    throw new FinancialRequestError("استرجاع محاولة الإعداد الضريبي غير ممنوح",403);
}
export async function publishTaxPolicy(req:Request,input:TaxPolicyInput){
  const cid=getCompanyId(req),uid=req.session.userId!;
  await policyAuthority(req,input);
  const {proof,...facts}=input;const requestHash=hash(facts);
  const replay=async(tx:DbOrTx)=>{
    const [r]=await rows(tx,sql`SELECT revision,request_hash FROM company_tax_policy_versions
      WHERE company_id=${cid} AND created_by=${uid} AND request_id=${input.requestId}::uuid`);
    if(!r)return null;
    if(r.request_hash!==requestHash)throw new FinancialRequestError("استُخدم معرف الإعداد لحقائق مختلفة",409);
    return {revision:Number(r.revision),replayed:true};
  };
  const existing=await replay(db);if(existing)return existing;
  const closed=await closure(req,input.requestId,requestHash);
  if(closed)throw new FinancialRequestError("أُغلقت هذه المحاولة دون تنفيذ، ابدأ طلبًا جديدًا",409);
  return withAccountProof(req,proof,async(tx)=>{
    await policyAuthority(req,input,tx);
    await tx.execute(sql`SELECT id FROM companies WHERE id=${cid} FOR UPDATE`);
    const adopting=await policyAuthority(req,input,tx);
    const again=await replay(tx);if(again)return again;
    if(await closure(req,input.requestId,requestHash,tx))
      throw new FinancialRequestError("أُغلقت هذه المحاولة دون تنفيذ، ابدأ طلبًا جديدًا",409);
    const [last]=await rows(tx,sql`SELECT revision FROM company_tax_policy_versions WHERE company_id=${cid} ORDER BY revision DESC LIMIT 1`);
    if(Number(last?.revision??0)!==input.revision)throw new FinancialRequestError("تغير الإعداد؛ أعد المعاينة قبل التأكيد",409);
    if(input.effectiveFrom<riyadhDate())throw new FinancialRequestError("لا يسري هذا التغيير بأثر رجعي؛ احتفظ بالمستندات القديمة ودليلها",409);
    const products=await rows(tx,sql`SELECT id FROM products WHERE company_id=${cid} AND is_active`);
    const own=new Set(products.map(p=>Number(p.id)));
    if(input.productRules.some(p=>!own.has(p.productId)))throw new FinancialRequestError("تصنيف صنف خارج المنشأة أو غير نشط",403);
    if(input.status!=="not_registered"&&products.some(p=>!input.productRules.some(r=>r.productId===Number(p.id))))
      throw new FinancialRequestError("صنف كل الأصناف النشطة صراحةً قبل تفعيل سياسة مسجلة؛ لا تُفترض نسبة واحدة للجميع",422);
    const [company]=await rows(tx,sql`SELECT vat_registration_status,vat_number,vat_registration_date,vat_deregistration_date FROM companies WHERE id=${cid}`);
    const next=input.revision+1;
    await tx.execute(sql`INSERT INTO company_tax_policy_versions(company_id,revision,request_id,request_hash,effective_from,status,
      vat_number,price_includes_vat,product_rules,service_rule,legacy_state,reason,created_by)
      VALUES(${cid},${next},${input.requestId}::uuid,${requestHash},${input.effectiveFrom}::date,${input.status},
        ${input.vatNumber},${input.priceIncludesVat},${JSON.stringify(input.productRules)}::jsonb,
        ${JSON.stringify(input.serviceRule)}::jsonb,${JSON.stringify(company)}::jsonb,${input.reason},${uid})`);
    if(adopting){
      await initializeLegacyAdministration(tx,cid);
      await tx.execute(sql`UPDATE company_administrators
        SET responsibilities=array_append(responsibilities,'tax')
        WHERE company_id=${cid} AND user_id=${uid} AND active AND NOT('tax'=ANY(responsibilities))`);
      await requireAdministrative(cid,uid,"tax",tx);
      await tx.execute(sql`INSERT INTO audit_logs(company_id,user_id,user_name,action,entity,details)
        SELECT ${cid},id,name,'vat.authority.explicit_adoption','company_tax_policy',
          ${JSON.stringify({requestId:input.requestId,reason:input.reason,identityConfirmed:true,revision:next})}
        FROM users WHERE id=${uid}`);
    }
    await tx.execute(sql`INSERT INTO audit_logs(company_id,user_id,user_name,action,entity,details)
      SELECT ${cid},id,name,'vat.policy.published','company_tax_policy',
        ${JSON.stringify({revision:next,status:input.status,effectiveFrom:input.effectiveFrom,reason:input.reason,
          priceIncludesVat:input.priceIncludesVat,identityConfirmed:true,registrationVerified:false})}
      FROM users WHERE id=${uid}`);
    return {revision:next,replayed:false};
  },true);
}

function requestId(id:string){
  if(!z.string().uuid().safeParse(id).success)throw new FinancialRequestError("معرف طلب غير صحيح",400);
  return id;
}
async function closure(req:Request,id:string,expectedHash:string,tx:TaxTx=db){
  const cid=getCompanyId(req),uid=req.session.userId!;
  const [r]=await rows(tx,sql`SELECT request_hash FROM company_tax_policy_request_closures
    WHERE company_id=${cid} AND user_id=${uid} AND request_id=${requestId(id)}::uuid`);
  if(r&&r.request_hash!==expectedHash)throw new FinancialRequestError("معرّف مُغلق لحقائق أخرى",409);
  return !!r;
}
export async function getTaxPolicyRequestStatus(req:Request,id:string){
  const cid=getCompanyId(req),uid=req.session.userId!;
  await requestAuthority(req);
  const [saved]=await rows(db,sql`SELECT revision FROM company_tax_policy_versions
    WHERE company_id=${cid} AND created_by=${uid} AND request_id=${requestId(id)}::uuid`);
  if(saved)return {status:"saved" as const,revision:Number(saved.revision)};
  const [closed]=await rows(db,sql`SELECT closed_at FROM company_tax_policy_request_closures
    WHERE company_id=${cid} AND user_id=${uid} AND request_id=${id}::uuid`);
  if(closed)return {status:"closed" as const,revision:null};
  return {status:"pending" as const,revision:null};
}
export async function closeTaxPolicyRequest(req:Request,id:string,facts:unknown,
  proof:{currentPassword:string,token?:string,recoveryCode?:string}){
  if(!facts||typeof facts!=="object"||Array.isArray(facts)||JSON.stringify(facts).length>1_000_000)
    throw new FinancialRequestError("حقائق المحاولة مفقودة",400);
  if((facts as Record<string,unknown>).requestId!==requestId(id))
    throw new FinancialRequestError("معرف المحاولة لا يطابق جسمها",409);
  const cid=getCompanyId(req),uid=req.session.userId!;
  await requestAuthority(req);
  const expectedHash=hash(facts);
  const [saved]=await rows(db,sql`SELECT revision,request_hash FROM company_tax_policy_versions
    WHERE company_id=${cid} AND created_by=${uid} AND request_id=${id}::uuid`);
  if(saved){
    if(saved.request_hash!==expectedHash)throw new FinancialRequestError("جسم الطلب لا يطابق المحاولة المحفوظة",409);
    return {status:"saved" as const,revision:Number(saved.revision)};
  }
  if(await closure(req,id,expectedHash))return {status:"closed" as const,revision:null};
  return withAccountProof(req,proof,async(tx)=>{
    await requestAuthority(req,tx);
    await tx.execute(sql`SELECT id FROM companies WHERE id=${cid} FOR UPDATE`);
    await requestAuthority(req,tx);
    const [again]=await rows(tx,sql`SELECT revision,request_hash FROM company_tax_policy_versions
      WHERE company_id=${cid} AND created_by=${uid} AND request_id=${id}::uuid`);
    if(again){
      if(again.request_hash!==expectedHash)throw new FinancialRequestError("جسم الطلب لا يطابق المحاولة المحفوظة",409);
      return {status:"saved" as const,revision:Number(again.revision)};
    }
    if(await closure(req,id,expectedHash,tx))return {status:"closed" as const,revision:null};
    const reason="إغلاق آمن لمحاولة مجهولة النتيجة";
    await tx.execute(sql`INSERT INTO company_tax_policy_request_closures(company_id,user_id,request_id,request_hash,reason)
      VALUES(${cid},${uid},${id}::uuid,${expectedHash},${reason})`);
    await tx.execute(sql`INSERT INTO audit_logs(company_id,user_id,user_name,action,entity,details)
      SELECT ${cid},id,name,'vat.policy.intent_closed','company_tax_policy_request',
        ${JSON.stringify({requestId:id,reason,identityConfirmed:true})} FROM users WHERE id=${uid}`);
    return {status:"closed" as const,revision:null};
  },true);
}
export async function calculatePolicySale(tx:DbOrTx,companyId:number,at:string,lines:SalesLineInput[],discount:number,
  agreedBasis?:{priceIncludesVat:boolean}){
  const context=await taxContext(companyId,at,tx);
  if(context.status==="unresolved")throw new FinancialRequestError("حالة الضريبة غير محسومة؛ أكمل إعداد المنشأة قبل الإصدار",422);
  if(context.mode==="legacy")return null;
  const classified=lines.map(line=>{
    const rule=line.productId?context.productRules.find(p=>p.productId===line.productId)?.rule:context.serviceRule;
    if(context.registered&&!rule)throw new FinancialRequestError("الصنف يحتاج تصنيفًا ضريبيًا صريحًا قبل البيع",422);
    const category:NonNullable<SalesLineInput["taxCategory"]>=context.registered?rule!.category:"not_registered";
    return {...line,taxRate:category==="standard"?15:0,taxCategory:category,taxReason:rule?.reason??null};
  });
  const totals=computeTotals(classified,discount,{priceIncludesVat:agreedBasis?.priceIncludesVat??context.priceIncludesVat});
  return {context:publicTaxContext(context),totals,
    snapshot:{context:publicTaxContext(context),...(agreedBasis?{agreedBasis}:{}),lines:totals.lines.map((line,i)=>({...line,
      taxCategory:classified[i]!.taxCategory,taxReason:classified[i]!.taxReason})),totals:{subtotal:totals.subtotal,discount:totals.discount,vat:totals.vat,total:totals.total}}};
}
