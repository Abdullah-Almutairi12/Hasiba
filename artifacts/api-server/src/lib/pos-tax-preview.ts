import {z} from "zod";
import {sql} from "drizzle-orm";
import type {Request} from "express";
import type {DbOrTx} from "./journal-posting";
import {FinancialRequestError} from "./financial-transaction";
import {getCompanyId} from "./scoped-db";
import {calculatePolicySale,publicTaxContext,riyadhDate,taxContext} from "./vat-policy";
import {returnAuthorize} from "./return-access";
import {managedProfile,selectedResponsibility} from "./responsibility-context";
import {assertPosDeviceShift} from "./pos-device-authority";
import {legacyPosTotals,type SalesLineInput} from "./sales-engine";

export const posTaxPreviewBody=z.object({
  sessionId:z.number().int().positive(),
  items:z.array(z.object({productId:z.number().int().positive(),quantity:z.number().positive()})).min(1).max(500),
  discount:z.number().nonnegative().default(0),
});
export function posTaxFacts(companyId:number,sessionId:number,branchId:number,warehouseId:number,context:unknown,lines:SalesLineInput[],discount:number,at=riyadhDate()){
  return {companyId,sessionId,branchId,warehouseId,context,lines,discount,at};
}
export async function preparePosTaxPreview(tx:DbOrTx,req:Request,body:z.infer<typeof posTaxPreviewBody>){
  const cid=getCompanyId(req);
  const s=(await tx.execute(sql`SELECT s.branch_id,s.status,s.pos_station_id,s.cashier_user_id FROM pos_sessions s
    JOIN branches b ON b.id=s.branch_id AND b.company_id=${cid} WHERE s.id=${body.sessionId}`)).rows[0];
  if(!s)throw new FinancialRequestError("وردية نقطة البيع غير متاحة",404);
  assertPosDeviceShift({branchId:Number(s.branch_id),posStationId:s.pos_station_id as number|null,cashierUserId:s.cashier_user_id as number|null});
  await returnAuthorize(req.session.userId!,cid,"view",Number(s.branch_id),tx);
  if(s.status!=="open")throw new FinancialRequestError("الوردية مغلقة",409);
  const w=(await tx.execute(sql`SELECT id FROM warehouses WHERE branch_id=${s.branch_id} AND company_id=${cid}
    AND NOT is_scrap ORDER BY is_default DESC LIMIT 1`)).rows[0];
  if(!w)throw new FinancialRequestError("مستودع الصرف غير متاح",422);
  if(await managedProfile(req.session.userId!,cid,tx)){
    const grant=await selectedResponsibility(req.session.userId!,cid,tx);
    if(grant?.resource!=="pos"||!grant.actions.includes("pos.read")||grant.branchId!==Number(s.branch_id)||!grant.warehouseIds.includes(Number(w.id)))
      throw new FinancialRequestError("المعاينة خارج نطاق الفرع أو المستودع",403);
  }
  const lines:SalesLineInput[]=[];
  for(const item of body.items){
    const p=(await tx.execute(sql`SELECT id,name_ar,price FROM products WHERE id=${item.productId} AND company_id=${cid}`)).rows[0];
    if(!p)throw new FinancialRequestError("أحد منتجات السلة غير متاح لهذه المنشأة",404);
    lines.push({productId:Number(p.id),description:String(p.name_ar),quantity:item.quantity,unitPrice:Number(p.price)});
  }
  const at=riyadhDate(),context=publicTaxContext(await taxContext(cid,at,tx));
  const policy=await calculatePolicySale(tx,cid,at,lines,body.discount);
  const subtotal=lines.reduce((a,l)=>a+l.unitPrice*l.quantity,0);
  if(body.discount>subtotal)throw new FinancialRequestError("الخصم يتجاوز قيمة السلة",422);
  const totals=policy?.totals??legacyPosTotals(lines,body.discount,context.registered);
  totals.lines=totals.lines.map((l,i)=>({...l,inputUnitPrice:lines[i]!.unitPrice}));
  return {context,totals,facts:posTaxFacts(cid,body.sessionId,Number(s.branch_id),Number(w.id),context,lines,body.discount,at)};
}

export async function posIntentRead(tx:DbOrTx,req:Request,body:Record<string,unknown>,saved:unknown){
  const sessionId=z.number().int().positive().parse(body.sessionId),cid=getCompanyId(req);
  const s=(await tx.execute(sql`SELECT s.branch_id,s.pos_station_id,s.cashier_user_id FROM pos_sessions s
    JOIN branches b ON b.id=s.branch_id AND b.company_id=${cid} WHERE s.id=${sessionId}`)).rows[0];
  if(!s)throw new FinancialRequestError("الوردية خارج نطاق القراءة الحالي",403);
  assertPosDeviceShift({branchId:Number(s.branch_id),posStationId:s.pos_station_id as number|null,cashierUserId:s.cashier_user_id as number|null});
  await returnAuthorize(req.session.userId!,cid,"view",Number(s.branch_id),tx);
  if(saved){
    const id=z.object({order:z.object({id:z.number()})}).parse(saved).order.id;
    const {scopedPosOrderVisible}=await import("./scoped-pos-operations");
    await scopedPosOrderVisible(tx,req.session.userId!,cid,id);
  }else if(await managedProfile(req.session.userId!,cid,tx)){
    const g=await selectedResponsibility(req.session.userId!,cid,tx);
    if(g?.resource!=="pos"||!g.actions.includes("pos.read")||g.branchId!==Number(s.branch_id))
      throw new FinancialRequestError("قراءة المحاولة غير ممنوحة",403);
  }
}
