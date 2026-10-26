import type {Request} from "express";
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";
import {z} from "zod/v4";
import type {DbOrTx} from "./journal-posting";
import {FinancialRequestError} from "./financial-transaction";
import {authorityFingerprint,lockApprovalAuthority} from "./approval-authority";
import {withAccountProof,type AccountProof} from "./account-security";
import {requireAdministrative} from "./administration-authority";
import {teamPolicy,teamRows} from "./team-store";
import {stocktakeReadAuthority} from "./stocktake-count";
import {inventoryActor} from "./scoped-inventory-actor";
import {currentResponsibilities,responsibilityContext} from "./responsibility-context";
import {stocktakeSeparation,stocktakeUnknownParticipantBlock} from "./stocktake-separation";
import {countPoint,type CountPoint} from "./stocktake-cutoff";

const deny=(s:string,status=403):never=>{throw new FinancialRequestError(s,status);};
export const StocktakeProof=z.object({currentPassword:z.string().min(1).max(1024),
  token:z.string().max(20).optional(),recoveryCode:z.string().max(100).optional()}).strict();
export const StocktakeApproval=z.object({reason:z.string().trim().min(3).max(500),proof:StocktakeProof.optional()}).strict();
export async function stocktakePolicy(companyId:number,tx:DbOrTx=db){
  const [r]=await teamRows<{policy:{allowParticipant?:boolean;revision?:number}}>(tx,sql`
    SELECT stocktake_policy AS policy FROM team_access_policy WHERE company_id=${companyId}`);
  return {allowParticipant:r?.policy?.allowParticipant===true,revision:Number(r?.policy?.revision??0)};
}
export async function changeStocktakePolicy(req:Request,input:{allowParticipant:boolean;revision:number;reason:string;proof:AccountProof}){
  const companyId=req.session.companyId!,userId=req.session.userId!;
  await requireAdministrative(companyId,userId,"settings");
  return withAccountProof(req,input.proof,async tx=>{
    await requireAdministrative(companyId,userId,"settings",tx);
    const before=await stocktakePolicy(companyId,tx);
    if(before.revision!==input.revision)deny("تغيرت سياسة الجرد؛ أعد تحميلها",409);
    const after={allowParticipant:input.allowParticipant,revision:before.revision+1};
    const existing=await teamPolicy(companyId,tx);
    await tx.execute(sql`INSERT INTO team_access_policy(company_id,enabled_modules,seat_limit,source,updated_by,stocktake_policy)
      VALUES(${companyId},${sql.param(existing.enabledModules)}::text[],${existing.seatLimit},${existing.source},${userId},${JSON.stringify(after)}::jsonb)
      ON CONFLICT(company_id) DO UPDATE SET stocktake_policy=excluded.stocktake_policy,
        updated_by=excluded.updated_by,updated_at=clock_timestamp()`);
    await audit(tx,companyId,userId,"inventory.stocktake.policy", {before,after,reason:input.reason,identityConfirmed:true});
    return after;
  },true);
}
async function audit(tx:DbOrTx,companyId:number,userId:number,action:string,facts:unknown){
  await tx.execute(sql`INSERT INTO audit_logs(company_id,user_id,user_name,action,entity,details)
    SELECT ${companyId},id,name,${action},'stock_take',${JSON.stringify(facts)} FROM users WHERE id=${userId}`);
}
/** Same responsibility resolver and deny/period/warehouse rules; no role alias
 * grants the exception. Explicit primary-owner grants are inspected only here,
 * not used to broaden or change legacy authority anywhere else. */
export async function stocktakeAction(tx:DbOrTx,req:Request,id:number,action:"approve"|"post"){
  const {actor,take}=await stocktakeReadAuthority(tx,req,id);
  let grant=actor.grant;
  const selected=responsibilityContext.getStore();
  const selectedId=selected?.userId===actor.userId&&selected.companyId===actor.companyId?
    selected.grantId:Number(req.get?.("X-Workspace-Responsibility")??0);
  if(!grant&&selectedId>0){
    grant=(await currentResponsibilities(actor.userId,actor.companyId,tx,true))
      .find(g=>g.id===selectedId&&g.resource==="inventory")??null;
    if(!grant)deny("المسؤولية المختارة لم تعد متاحة");
  }
  if(grant){
    if(!grant.actions.includes("inventory.read")||!grant.actions.includes(`inventory.stocktake.${action}`)||
      grant.branchId!==take.branchId||!grant.warehouseIds.includes(take.warehouseId))
      deny("صلاحية اعتماد/ترحيل الجرد أو نطاقها غير متاحة حاليًا");
  }else await inventoryActor(tx,req,"inventory.write");
  return {...actor,grant,take};
}
/** Caller holds the session parent before all stock keys. Cost comes from the
 * native carrying cost. Use gross absolute adjustments, never a netted cap. */
export async function stocktakeFacts(tx:DbOrTx,req:Request,id:number){
  const {actor,take}=await stocktakeReadAuthority(tx,req,id);
  const [locked]=await teamRows<{status:string;review:Review|null}>(tx,sql`
    SELECT status,variance_review AS review FROM stock_takes WHERE id=${id} FOR UPDATE`);
  if(locked.status!=="in_progress")deny("الجرد مغلق",409);
  const lines=await teamRows<{id:number;product_id:number;variant_id:number|null;lot_id:number|null;counted_qty:string|null;count_checkpoint:CountPoint|null}>(tx,
    sql`SELECT * FROM stock_take_lines WHERE stock_take_id=${id} ORDER BY product_id,id`);
  for(const l of lines){
    if(l.counted_qty===null)continue;
    if(l.variant_id!==null||l.lot_id!==null)deny("المتتبعات والمتغيرات خارج هذه الشريحة",409);
    const current=await countPoint(tx,actor.companyId,take.warehouseId,l.product_id);
    if(!l.count_checkpoint||l.count_checkpoint.generation!==current.generation)
      deny("نقطة عد قديمة أو تجاوزها جرد أحدث؛ أعد عد الصنف",409);
  }
  const separation=await stocktakeSeparation(tx,id,actor.userId);
  if(separation.unknownCount)deny(stocktakeUnknownParticipantBlock);
  const policy=await stocktakePolicy(actor.companyId,tx);
  const [r]=await teamRows<{facts:string;amount:string}>(tx,sql`SELECT
    jsonb_agg(jsonb_build_object('id',l.id,'product',l.product_id,'count',l.counted_qty,
      'revision',l.count_revision,'checkpoint',l.count_checkpoint,'cost',
      coalesce(q.avg_cost,p.cost_price)) ORDER BY l.product_id,l.id)::text AS facts,
    coalesce(sum(abs(l.counted_qty-(l.count_checkpoint->>'quantity')::numeric)*
      coalesce(q.avg_cost,p.cost_price)),0)::text AS amount
    FROM stock_take_lines l JOIN products p ON p.id=l.product_id AND p.company_id=${actor.companyId}
    LEFT JOIN stock_quants q ON q.product_id=l.product_id AND q.warehouse_id=${take.warehouseId}
      AND q.variant_id IS NULL AND q.lot_id IS NULL WHERE l.stock_take_id=${id}`);
  return {actor,take,review:locked.review,separation,policy,hasCount:lines.some(l=>l.counted_qty!==null),amount:r.amount,
    fingerprint:authorityFingerprint({id,company:actor.companyId,warehouse:take.warehouseId,branch:take.branchId,
      lines:r.facts,participants:separation.participantIds,policy})};
}
export async function stocktakeLimit(tx:DbOrTx,actor:Awaited<ReturnType<typeof stocktakeAction>>,amount:string){
  if(actor.grant?.amountLimit!==null&&actor.grant?.amountLimit!==undefined){
    const [r]=await teamRows<{over:boolean}>(tx,sql`SELECT ${amount}::numeric>${actor.grant.amountLimit}::numeric AS over`);
    if(r.over)deny("قيمة الفروق المطلقة المحسوبة من الخادم تتجاوز حد المسؤولية");
  }
}
export async function stocktakeVarianceValue(tx:DbOrTx,id:number,companyId:number,warehouseId:number){
  const [r]=await teamRows<{amount:string;currency:string}>(tx,sql`SELECT
    trim_scale(coalesce(sum(abs(l.counted_qty-(l.count_checkpoint->>'quantity')::numeric)*
      coalesce(q.avg_cost,p.cost_price)),0))::text AS amount,
    (SELECT base_currency FROM companies WHERE id=${companyId}) AS currency
    FROM stock_take_lines l JOIN products p ON p.id=l.product_id AND p.company_id=${companyId}
    LEFT JOIN stock_quants q ON q.product_id=l.product_id AND q.warehouse_id=${warehouseId}
      AND q.variant_id IS NULL AND q.lot_id IS NULL WHERE l.stock_take_id=${id}`);
  return r;
}
type Review={userId:number;grantId:number|null;fingerprint:string;amount:string;reason:string;
  exception:boolean;identityConfirmed:boolean;policyRevision:number;approvedAt:string};
async function eligibleReviewer(tx:DbOrTx,req:Request,id:number,facts:Awaited<ReturnType<typeof stocktakeFacts>>,proofConfirmed:boolean){
  const actor=await stocktakeAction(tx,req,id,"approve");
  await stocktakeLimit(tx,actor,facts.amount);
  const state=await stocktakeSeparation(tx,id,actor.userId);
  if(state.unknownCount)deny(stocktakeUnknownParticipantBlock);
  if(state.participated){
    if(!facts.policy.allowParticipant)deny(state.blockReason!);
    if(!actor.grant?.actions.includes("inventory.stocktake.approve_self")||actor.grant.amountLimit===null)
      deny("الاستثناء يحتاج إذنًا مستقلًا وحدًا ماليًا صريحًا، لا اسم مدير أو مالك");
    if(!proofConfirmed)deny("أكد الهوية الحالية لاعتماد جلسة شاركت في عدها");
  }
  return {actor,exception:state.participated};
}
export async function approveStocktake(req:Request,id:number,input:z.infer<typeof StocktakeApproval>){
  const work=async(tx:DbOrTx)=>{
    await lockApprovalAuthority(tx);
    const facts=await stocktakeFacts(tx,req,id);
    if(!facts.hasCount)deny("سجّل عدًا موثقًا قبل اعتماد الفروق",409);
    const {actor,exception}=await eligibleReviewer(tx,req,id,facts,!!input.proof);
    // All count/stock locks have been acquired before this fresh eligibility check.
    const review:Review={userId:actor.userId,grantId:actor.grant?.id??null,fingerprint:facts.fingerprint,amount:facts.amount,
      reason:input.reason,exception,identityConfirmed:!!input.proof,policyRevision:facts.policy.revision,approvedAt:new Date().toISOString()};
    if(facts.review?.fingerprint===review.fingerprint&&facts.review.userId===review.userId&&
      facts.review.grantId===review.grantId&&facts.review.reason===review.reason)return {approved:true};
    await tx.execute(sql`UPDATE stock_takes SET variance_review=${JSON.stringify(review)}::jsonb WHERE id=${id}`);
    await audit(tx,actor.companyId,actor.userId,"inventory.stocktake.approved",
      {takeId:id,review,countParticipantIds:facts.separation.participantIds,financialEffect:false});
    return {approved:true};
  };
  return input.proof?withAccountProof(req,input.proof,work,true):db.transaction(work);
}
/** Runs under the native close locks, and again after native stock/GL posting.
 * A committed receipt is returned before this; replay is not a second approval. */
export async function authorizeStocktakePosting(tx:DbOrTx,req:Request,id:number){
  const facts=await stocktakeFacts(tx,req,id);
  const poster=await stocktakeAction(tx,req,id,"post");
  await stocktakeLimit(tx,poster,facts.amount);
  const review=facts.review;
  if(!review){
    if(facts.separation.participated&&!facts.policy.allowParticipant)deny(facts.separation.blockReason!);
    if(poster.grant||facts.separation.participated)deny("يلزم اعتماد فروق موثق وحديث قبل الترحيل",409);
    // Preserve the accepted legacy independent atomic approval+close path.
    return {...facts.separation,independent:true,review:null,facts};
  }
  if(review.fingerprint!==facts.fingerprint)deny("تغيرت حقائق الجرد أو التكلفة أو السياسة؛ أعد اعتماد الفروق",409);
  const reviewerReq={...req,session:{...req.session,userId:review.userId}} as Request;
  const check=()=>eligibleReviewer(tx,reviewerReq,id,facts,review.identityConfirmed);
  const result=await responsibilityContext.run({userId:review.userId,companyId:poster.companyId,grantId:review.grantId??0},check);
  if((result.actor.grant?.id??null)!==review.grantId)deny("لم يعد المعتمد مؤهلًا ضمن مسؤوليته الأصلية");
  return {...facts.separation,independent:!result.exception,review,facts};
}
export async function recheckStocktakePosting(tx:DbOrTx,req:Request,id:number,result:Awaited<ReturnType<typeof authorizeStocktakePosting>>){
  const poster=await stocktakeAction(tx,req,id,"post");
  await stocktakeLimit(tx,poster,result.facts.amount);
  if(result.review){
    const review=result.review,reviewerReq={...req,session:{...req.session,userId:review.userId}} as Request;
    const r=await responsibilityContext.run({userId:review.userId,companyId:poster.companyId,grantId:review.grantId??0},
      ()=>eligibleReviewer(tx,reviewerReq,id,result.facts,review.identityConfirmed));
    if((r.actor.grant?.id??null)!==review.grantId)deny("لم يعد المعتمد مؤهلًا");
  }
}
