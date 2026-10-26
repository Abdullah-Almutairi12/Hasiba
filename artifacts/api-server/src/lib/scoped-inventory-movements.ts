import type { Request } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { financialTransaction, FinancialRequestError } from "./financial-transaction";
import { lockApprovalAuthority } from "./approval-authority";
import { inventoryActor } from "./scoped-inventory-actor";
import { currentResponsibilities, responsibilityContext, type Responsibility } from "./responsibility-context";
import { teamRows } from "./team-store";
import { recordStockMove } from "./stock-engine";

const invalid=()=>new FinancialRequestError("الحركة أو أحد مستودعاتها خارج الصلاحية الحالية",403);
const quantity=z.coerce.number().min(0.0001).max(999999999).refine(v=>Number.isFinite(v)&&Number(v.toFixed(4))===v,"الكمية حتى أربع منازل عشرية");
const common={productId:z.coerce.number().int().positive(),variantId:z.number().int().positive().optional(),quantity,notes:z.string().trim().min(3).max(500)};
const manual=z.object({...common,warehouseId:z.coerce.number().int().positive(),kind:z.enum(["receipt","issue"])}).strict();
const transfer=z.object({...common,fromWarehouseId:z.coerce.number().int().positive(),toWarehouseId:z.coerce.number().int().positive(),
 destinationResponsibilityId:z.number().int().positive().optional()}).strict();
type Movement={productId:number;variantId?:number;quantity:number;notes:string;from:number|null;to:number|null;action:string;destinationGrantId?:number;kind:"transfer"|"receipt"|"issue"};

/** Legacy bodies historically stripped variantId. Never silently turn such a
 * request into a parent-level quantity; explicit responsibility grants own
 * the newly accepted variant movement path. Ordinary legacy writes unchanged. */
export async function rejectLegacyVariantMovement(connection:Pick<typeof db,"execute">,companyId:number,productId:number,variantId:unknown){
 const [parent]=await teamRows<{variant:boolean}>(connection,sql`SELECT
  (is_variant_parent OR EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=products.id)) AS variant
  FROM products WHERE id=${productId} AND company_id=${companyId} FOR UPDATE`);
 if(variantId!==undefined||parent?.variant)
  throw new FinancialRequestError("حركة المتغير تحتاج مسؤولية استلام أو صرف أو تحويل صريحة واختيار المتغير؛ لا حركة عامة على الأب",409);
}

async function authority(connection:Pick<typeof db,"execute">,req:Request,m:Movement,execute:boolean){
 const actor=await inventoryActor(connection,req,execute?m.action:"inventory.read");
 if(!actor.grant)throw invalid();
 const grants=await currentResponsibilities(actor.userId,actor.companyId,connection);
 const destination=m.kind==="transfer"?grants.find(g=>g.id===(m.destinationGrantId??actor.grant!.id)):actor.grant;
 if(!destination||destination.resource!=="inventory"||!destination.actions.includes(execute?m.action:"inventory.read"))throw invalid();
 const ids=[...new Set([m.from,m.to].filter((id):id is number=>id!==null))].sort((a,b)=>a-b);
 const warehouses=await teamRows<{id:number;branchId:number}>(connection,sql`
  SELECT w.id,w.branch_id AS "branchId" FROM warehouses w JOIN branches b ON b.id=w.branch_id
  AND b.company_id=w.company_id AND b.is_active WHERE w.company_id=${actor.companyId}
  AND w.id=ANY(${sql.param(ids)}::integer[]) ORDER BY w.id ${execute?sql`FOR UPDATE OF w FOR SHARE OF b`:sql``}`);
 const covered=(id:number,g:Responsibility)=>warehouses.some(w=>w.id===id&&w.branchId===g.branchId)&&g.warehouseIds.includes(id);
 if(warehouses.length!==ids.length||(m.from!==null&&!covered(m.from,actor.grant))||
  (m.to!==null&&!covered(m.to,destination)))throw invalid();
 const [product]=await teamRows<{tracking:string;variant:boolean;hasVariants:boolean}>(connection,sql`
  SELECT tracking_mode AS tracking,is_variant_parent AS variant,
   EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=products.id) AS "hasVariants" FROM products
  WHERE id=${m.productId} AND company_id=${actor.companyId} AND is_active
  ${execute?sql`FOR UPDATE`:sql``}`);
 if(!product)throw invalid();
 if(execute){
  if(product.tracking!=="none")throw new FinancialRequestError("التشغيلة والتسلسل خارج مسار الحركات غير المتتبعة",409);
  if((product.variant||product.hasVariants)&&!m.variantId)
   throw new FinancialRequestError("اختر متغيرًا محددًا؛ لا يسمح بحركة مجمعة على الصنف الأب",409);
  if(m.variantId){
   const [variant]=await teamRows(connection,sql`SELECT id FROM product_variants
    WHERE id=${m.variantId} AND product_id=${m.productId} AND is_active FOR SHARE`);
   if(!variant)throw new FinancialRequestError("المتغير غير متاح أو لا يتبع الصنف والشركة الحاليين",403);
  }
 }
 // The approved moving-count policy reconciles each observed product at close.
 // Do not impose the former narrow warehouse freeze on delegated actors.
 return {actor,grants:[actor.grant,destination]};
}

/** No cached authority survives a wait for a source/quant/financial-intent lock. */
export async function executeScopedInventoryMovement(req:Request,isTransfer:boolean){
 const preflight=await inventoryActor(db,req,"inventory.read");
 const action=isTransfer?"inventory.transfer.send":req.body?.kind==="issue"?"inventory.move.issue":"inventory.move.receipt";
 let parsed;
 try{parsed=isTransfer?transfer.parse(req.body):manual.parse(req.body);}
 catch{if(!preflight.grant?.actions.includes(action))throw invalid();
  throw new FinancialRequestError("تحقق من الصنف والكمية والسبب؛ لا يسمح بإرسال تكلفة أو تسوية أو حقول إضافية في هذا المسار",400);}
 const m:Movement="kind" in parsed?{...parsed,from:parsed.kind==="issue"?parsed.warehouseId:null,
  to:parsed.kind==="receipt"?parsed.warehouseId:null,action:`inventory.move.${parsed.kind}`}:
  {...parsed,kind:"transfer",from:parsed.fromWarehouseId,to:parsed.toWarehouseId,action:"inventory.transfer.send",
   destinationGrantId:parsed.destinationResponsibilityId};
 if(m.from!==null&&m.from===m.to)throw new FinancialRequestError("اختر مستودعين مختلفين",400);
 if(!req.get("Idempotency-Key"))throw new FinancialRequestError("يلزم معرف ثابت للحركة واستعادة نتيجتها",400);
 const result=await financialTransaction(req,async tx=>{
  await lockApprovalAuthority(tx);
  await authority(tx,req,m,true);
  // All quantities still pass through the shared stock-engine key locks.
  const out=await recordStockMove(tx,{companyId:req.session.companyId!,productId:m.productId,variantId:m.variantId,quantity:m.quantity,
   kind:m.kind,state:m.kind==="transfer"?"in_transit":"done",fromWarehouseId:m.from,toWarehouseId:m.to,
   sourceType:m.kind==="transfer"?"transfer":"manual",sourceRef:`SCOPED-${req.get("Idempotency-Key")}`,
   notes:m.notes,createdBy:req.session.userId!});
  // Engine can wait on quantity/fiscal locks. Recheck expiry and effective grants now.
  const fresh=await authority(tx,req,m,true);
  const [value]=await teamRows<{value:string}>(tx,sql`SELECT coalesce(sum(quantity*unit_cost),0)::text AS value
   FROM stock_moves WHERE id=ANY(${sql.param(out.moveIds)}::integer[])`);
  for(const grant of fresh.grants)if(grant.amountLimit!==null){
   const [over]=await teamRows<{over:boolean}>(tx,sql`SELECT ${value!.value}::numeric>${grant.amountLimit}::numeric AS over`);
   if(over!.over)throw new FinancialRequestError("قيمة الحركة المحسوبة من الخادم تتجاوز حد المسؤولية",403);
  }
  await tx.execute(sql`INSERT INTO audit_logs(user_id,user_name,company_id,action,entity,details)
   VALUES(${fresh.actor.userId},${fresh.actor.name},${fresh.actor.companyId},${m.action},'stock_move',
    ${JSON.stringify({moveIds:out.moveIds,productId:m.productId,variantId:m.variantId??null,quantity:m.quantity,fromWarehouseId:m.from,
     toWarehouseId:m.to,reason:m.notes,responsibilities:fresh.grants})}::text)`);
  return {moveId:out.moveId,moveIds:out.moveIds};
 },async tx=>{await lockApprovalAuthority(tx);await authority(tx,req,m,false);});
 // The retained receipt is cost-free, even after cost-read is withdrawn.
 return result;
}

export async function inventoryMovementOptions(req:Request){
 const actor=await inventoryActor(db,req,"inventory.read");
 if(!actor.grant)throw invalid();
 const grants=await currentResponsibilities(actor.userId,actor.companyId);
 const warehouses=await teamRows<{id:number;branchId:number;name:string}>(db,sql`
  SELECT w.id,w.branch_id AS "branchId",coalesce(w.name_ar,w.name) AS name FROM warehouses w
  JOIN branches b ON b.id=w.branch_id AND b.company_id=w.company_id AND b.is_active
  WHERE w.company_id=${actor.companyId} ORDER BY w.id`);
 const project=(g:Responsibility)=>warehouses.filter(w=>w.branchId===g.branchId&&g.warehouseIds.includes(w.id))
  .map(w=>({...w,responsibilityId:g.id}));
 const products=await teamRows(db,sql`SELECT p.id,coalesce(p.name_ar,p.name) AS name,p.sku,p.unit,
  (p.is_variant_parent OR EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id)) AS "requiresVariant",
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'sku',v.sku,'attributes',v.attributes) ORDER BY v.id)
   FROM product_variants v WHERE v.product_id=p.id AND v.is_active),'[]'::jsonb) AS variants
  FROM products p WHERE p.company_id=${actor.companyId} AND p.is_active AND p.tracking_mode='none' ORDER BY p.id LIMIT 1000`);
 const recent=await teamRows(db,sql`SELECT m.id,m.kind,m.state,m.quantity::text,
   coalesce(p.name_ar,p.name) AS "productName",m.variant_id AS "variantId",v.sku AS "variantSku",p.unit,
   coalesce(f.name_ar,f.name) AS "sourceWarehouse",coalesce(t.name_ar,t.name) AS "destinationWarehouse"
   FROM stock_moves m JOIN products p ON p.id=m.product_id AND p.company_id=${actor.companyId}
   LEFT JOIN product_variants v ON v.id=m.variant_id AND v.product_id=p.id
   LEFT JOIN warehouses f ON f.id=m.from_warehouse_id AND f.company_id=p.company_id
   LEFT JOIN warehouses t ON t.id=m.to_warehouse_id AND t.company_id=p.company_id
   WHERE m.source_ref LIKE 'SCOPED-%' AND
   ((f.branch_id=${actor.grant.branchId} AND f.id=ANY(${sql.param(actor.grant.warehouseIds)}::integer[])) OR
    (t.branch_id=${actor.grant.branchId} AND t.id=ANY(${sql.param(actor.grant.warehouseIds)}::integer[])))
   ORDER BY m.id DESC LIMIT 40`);
 return {actions:actor.grant.actions.filter(a=>["inventory.move.receipt","inventory.move.issue","inventory.transfer.send"].includes(a)),
  sources:project(actor.grant),destinations:grants.filter(g=>g.resource==="inventory"&&g.actions.includes("inventory.transfer.send")).flatMap(project),products,recent};
}
