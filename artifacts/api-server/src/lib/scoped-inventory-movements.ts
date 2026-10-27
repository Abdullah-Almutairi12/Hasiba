import type { Request } from "express";
import { db,financialRequestsTable } from "@workspace/db";
import { sql,and,eq } from "drizzle-orm";
import {createHash} from "node:crypto";
import { z } from "zod/v4";
import { financialTransaction, FinancialRequestError,canonical,closedFinancialIntent,isClosedFinancialIntent } from "./financial-transaction";
import { lockApprovalAuthority } from "./approval-authority";
import { inventoryActor } from "./scoped-inventory-actor";
import { currentResponsibilities, responsibilityContext, type Responsibility } from "./responsibility-context";
import { teamRows } from "./team-store";
import { recordStockMove,getOrCreateLot } from "./stock-engine";
import { lockInventoryQuantKeys } from "./inventory-resource-locks";
import {lockLotMovementKeys} from "./lot-movement-locks";
import {lockSerialMovements} from "./serial-movement-integrity";
import type {DbOrTx} from "./journal-posting";

const invalid=()=>new FinancialRequestError("الحركة أو أحد مستودعاتها خارج الصلاحية الحالية",403);
const quantity=z.coerce.number().min(0.0001).max(999999999).refine(v=>Number.isFinite(v)&&Number(v.toFixed(4))===v,"الكمية حتى أربع منازل عشرية");
const expiry=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s);
const common={productId:z.coerce.number().int().positive(),variantId:z.number().int().positive().optional(),
 serialId:z.number().int().positive().optional(),serialNumber:z.string().trim().min(1).max(120).optional(),
 lotId:z.number().int().positive().optional(),lotNumber:z.string().trim().min(1).max(120).optional(),
 expiryDate:expiry.nullable().optional(),quantity,notes:z.string().trim().min(3).max(500)};
const manual=z.object({...common,warehouseId:z.coerce.number().int().positive(),kind:z.enum(["receipt","issue"])}).strict();
const transfer=z.object({...common,fromWarehouseId:z.coerce.number().int().positive(),toWarehouseId:z.coerce.number().int().positive(),
 destinationResponsibilityId:z.number().int().positive().optional()}).strict();
type Movement={productId:number;variantId?:number;serialId?:number;serialNumber?:string;lotId?:number;lotNumber?:string;expiryDate?:string|null;lotCandidates?:number[];expectedTracking?:string;
 quantity:number;notes:string;from:number|null;to:number|null;action:string;destinationGrantId?:number;kind:"transfer"|"receipt"|"issue"};

/** Exact existing financial lock and fingerprint, never a status-code inference.
 * Sealing absence also fences an original POST still delayed before that lock. */
export async function closeScopedInventoryAttempt(req:Request){
 const input=z.object({transfer:z.boolean(),body:z.record(z.string(),z.unknown())}).strict().parse(req.body);
 const parsed=input.transfer?transfer.parse(input.body):manual.parse(input.body);
 const m:Movement="kind" in parsed?{...parsed,from:parsed.kind==="issue"?parsed.warehouseId:null,
  to:parsed.kind==="receipt"?parsed.warehouseId:null,action:`inventory.move.${parsed.kind}`}:
  {...parsed,kind:"transfer",from:parsed.fromWarehouseId,to:parsed.toWarehouseId,action:"inventory.transfer.send",
   destinationGrantId:parsed.destinationResponsibilityId};
 const actor=await inventoryActor(db,req,"inventory.read");
 if(!actor.grant)throw invalid();
 const key=req.get("Idempotency-Key");
 if(!key||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/.test(key))
  throw new FinancialRequestError("يلزم معرف المحاولة الأصلية",400);
 const operation=`POST:${req.baseUrl}:/inventory/${input.transfer?"transfers":"moves"}`;
 const requestHash=createHash("sha256").update(canonical({params:{},body:input.body,query:{}})).digest("hex");
 return db.transaction(async tx=>{
  const lock=JSON.stringify([actor.companyId,actor.userId,operation,key]);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock},0))`);
  await lockApprovalAuthority(tx);
  // Permission may have changed while waiting for the original transaction.
  const fresh=await authority(tx,req,m,false);
  const [previous]=await tx.select().from(financialRequestsTable).where(and(
   eq(financialRequestsTable.companyId,actor.companyId),eq(financialRequestsTable.userId,actor.userId),
   eq(financialRequestsTable.operation,operation),eq(financialRequestsTable.requestKey,key)));
  if(previous){
   if(previous.requestHash!==requestHash)throw new FinancialRequestError("لا يطابق الجسم المحاولة الأصلية؛ لا تغير بيانات المعرف المحفوظ",409);
   const result=(previous.result as {value:unknown}).value;
   if(!isClosedFinancialIntent(result)){
    const out=z.object({moveId:z.number().int().positive(),moveIds:z.array(z.number().int().positive()).min(1)}).parse(result);
    if(!out.moveIds.includes(out.moveId))throw new Error("نتيجة الحركة المحفوظة غير مكتملة");
    return {state:"completed" as const,requestKey:key,...out};
   }
   return {state:"closed_without_execution" as const,requestKey:key};
  }
  await tx.insert(financialRequestsTable).values({companyId:actor.companyId,userId:actor.userId,operation,
   requestKey:key,requestHash,result:{value:closedFinancialIntent,dates:[]}});
  await tx.execute(sql`INSERT INTO audit_logs(user_id,user_name,company_id,action,entity,details)
   VALUES(${actor.userId},${fresh.actor.name},${actor.companyId},'inventory.movement.attempt.closed','financial_request',
   ${JSON.stringify({requestKey:key,operation,requestHash,productId:m.productId,fromWarehouseId:m.from,
    toWarehouseId:m.to,reason:m.notes,outcome:"closed_without_execution"})})`);
  return {state:"closed_without_execution" as const,requestKey:key};
 },{isolationLevel:"read committed"});
}

/** Legacy bodies historically stripped variantId. Never silently turn such a
 * request into a parent-level quantity; explicit responsibility grants own
 * the newly accepted variant movement path. Ordinary legacy writes unchanged. */
export async function rejectLegacyVariantMovement(connection:Pick<typeof db,"execute">,companyId:number,productId:number,variantId:unknown,warehouseIds:number[]){
 const query=sql`SELECT tracking_mode AS tracking,
  (is_variant_parent OR EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=products.id)) AS variant
  FROM products WHERE id=${productId} AND company_id=${companyId}`;
 const [initial]=await teamRows<{variant:boolean;tracking:string}>(connection,query);
 const reject=()=>{throw new FinancialRequestError("حركة المتغير تحتاج مسؤولية استلام أو صرف أو تحويل صريحة واختيار المتغير؛ لا حركة عامة على الأب",409);};
 if(variantId!==undefined||initial?.variant)reject();
 // Do not add stock/parent locks to the accepted tracked legacy paths.
 if(initial?.tracking!=="none")return;
 // Take the native ordinary quant advisory keys BEFORE the product row.
 // A count close already holds these keys before updating the product total.
 // The opposite order would introduce a deadlock into accepted ordinary moves.
 await lockInventoryQuantKeys(connection,warehouseIds.map(warehouseId=>({productId,warehouseId})));
 const [parent]=await teamRows<{variant:boolean}>(connection,sql`${query} FOR NO KEY UPDATE`);
 if(parent?.variant)reject();
}

async function authority(connection:DbOrTx,req:Request,m:Movement,execute:boolean){
 const actor=await inventoryActor(connection,req,execute?m.action:"inventory.read");
 if(!actor.grant)throw invalid();
 const grants=await currentResponsibilities(actor.userId,actor.companyId,connection);
 const destination=m.kind==="transfer"?grants.find(g=>g.id===(m.destinationGrantId??actor.grant!.id)):actor.grant;
 if(!destination||destination.resource!=="inventory"||!destination.actions.includes(execute?m.action:"inventory.read"))throw invalid();
 const ids=[...new Set([m.from,m.to].filter((id):id is number=>id!==null))].sort((a,b)=>a-b);
 const warehouses=await teamRows<{id:number;branchId:number}>(connection,sql`
  SELECT w.id,w.branch_id AS "branchId" FROM warehouses w JOIN branches b ON b.id=w.branch_id
  AND b.company_id=w.company_id AND b.is_active WHERE w.company_id=${actor.companyId}
  AND w.id=ANY(${sql.param(ids)}::integer[]) ORDER BY w.id ${execute?sql`FOR SHARE OF w,b`:sql``}`);
 const covered=(id:number,g:Responsibility)=>warehouses.some(w=>w.id===id&&w.branchId===g.branchId)&&g.warehouseIds.includes(id);
 if(warehouses.length!==ids.length||(m.from!==null&&!covered(m.from,actor.grant))||
  (m.to!==null&&!covered(m.to,destination)))throw invalid();
 // Warehouse SHARE protects ownership/state while allowing the engine's FK
 // KEY SHARE. UPDATE here can deadlock a stocktake holding the quant key.
 if(execute){
  const [mode]=await teamRows<{tracking:string;variant:boolean}>(connection,sql`
   SELECT tracking_mode AS tracking,(is_variant_parent OR EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=products.id)) AS variant
   FROM products WHERE id=${m.productId} AND company_id=${actor.companyId} AND is_active`);
  if(!mode)throw invalid();
  m.expectedTracking??=mode.tracking;
   if(mode.tracking==="serial")await lockSerialMovements(connection,m.productId);
  if(mode.tracking==="lot"&&!mode.variant&&!m.variantId){
   if(m.kind!=="receipt"&&(m.lotNumber!==undefined||m.expiryDate!==undefined))
    throw new FinancialRequestError("اختر دفعة موجودة أو التخصيص FEFO؛ لا إنشاء أو تغيير تاريخ دفعة عند الصرف والتحويل",400);
   if(m.kind==="receipt"&&!m.lotId){
    if(!m.lotNumber||m.expiryDate===undefined)throw new FinancialRequestError("أدخل رقم الدفعة وصلاحيتها أو اختر دفعة موجودة",400);
    m.lotId=await getOrCreateLot(connection,m.productId,m.lotNumber,m.expiryDate);
   }
   if(m.lotId){
    const [lot]=await teamRows<{number:string;expiry:string|null}>(connection,sql`
     SELECT lot_number AS number,expiry_date::text AS expiry FROM stock_lots WHERE id=${m.lotId} AND product_id=${m.productId}`);
    if(!lot)throw invalid();
    if((m.lotNumber!==undefined&&m.lotNumber!==lot.number)||(m.expiryDate!==undefined&&m.expiryDate!==lot.expiry))
     throw new FinancialRequestError("رقم الدفعة أو صلاحيتها يتعارض مع سجلها؛ لا تعديل تاريخي ضمن الحركة",409);
   }
   m.lotCandidates=await lockLotMovementKeys(connection,m.productId,m.from,m.to,m.lotId,m.lotCandidates);
  }else{
   if(m.lotId!==undefined||m.lotNumber!==undefined||m.expiryDate!==undefined)
    throw new FinancialRequestError("حقول الدفعة تخص صنف دفعات غير مرتبط بمتغير",409);
   await lockInventoryQuantKeys(connection,ids.map(warehouseId=>({productId:m.productId,warehouseId,variantId:m.variantId})));
  }
 }
 const [product]=await teamRows<{tracking:string;variant:boolean;hasVariants:boolean}>(connection,sql`
  SELECT tracking_mode AS tracking,is_variant_parent AS variant,
   EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=products.id) AS "hasVariants" FROM products
  WHERE id=${m.productId} AND company_id=${actor.companyId} AND is_active
  ${execute?sql`FOR NO KEY UPDATE`:sql``}`);
 if(!product)throw invalid();
 if(execute){
  if(product.tracking!==m.expectedTracking)throw new FinancialRequestError("تغيرت طريقة التتبع أثناء انتظار التنفيذ؛ أعد مراجعة الصنف",409);
   if(product.tracking!=="none"&&!((product.tracking==="lot"||product.tracking==="serial")&&!product.variant&&!product.hasVariants&&!m.variantId))
   throw new FinancialRequestError("التسلسل والجمع بين المتغيرات والدفعات خارج هذا المسار",409);
  if((product.variant||product.hasVariants)&&!m.variantId)
   throw new FinancialRequestError("اختر متغيرًا محددًا؛ لا يسمح بحركة مجمعة على الصنف الأب",409);
  if(m.variantId){
   const [variant]=await teamRows(connection,sql`SELECT id FROM product_variants
    WHERE id=${m.variantId} AND product_id=${m.productId} AND is_active FOR SHARE`);
   if(!variant)throw new FinancialRequestError("المتغير غير متاح أو لا يتبع الصنف والشركة الحاليين",403);
  }
   if(product.tracking==="serial"){
    if(m.quantity!==1||m.lotId!==undefined||m.lotNumber!==undefined||m.expiryDate!==undefined)
     throw new FinancialRequestError("اختر قطعة تسلسلية واحدة دون دفعات أو متغيرات",400);
    if(!m.serialId&&m.kind==="receipt"&&m.serialNumber){
     const [s]=await teamRows<{id:number}>(connection,sql`
      INSERT INTO stock_serials(product_id,serial_number) VALUES(${m.productId},${m.serialNumber})
      ON CONFLICT(product_id,serial_number) DO UPDATE SET serial_number=stock_serials.serial_number RETURNING id`);
     m.serialId=s.id;
    }
    if(!m.serialId)throw new FinancialRequestError("اختر الرقم التسلسلي أو أدخله عند الاستلام",400);
    const [s]=await teamRows<{number:string}>(connection,sql`SELECT serial_number AS number FROM stock_serials
     WHERE id=${m.serialId} AND product_id=${m.productId} FOR SHARE`);
    if(!s||(m.serialNumber!==undefined&&m.serialNumber!==s.number))
     throw new FinancialRequestError("الرقم التسلسلي لا يتبع الصنف أو يختلف عن هويته المحفوظة",403);
   }else if(m.serialId!==undefined||m.serialNumber!==undefined)
    throw new FinancialRequestError("حقول التسلسل تخص صنفًا تسلسليًا غير مرتبط بمتغير أو دفعة",409);
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
   const out=await recordStockMove(tx,{companyId:req.session.companyId!,productId:m.productId,variantId:m.variantId,lotId:m.lotId,serialId:m.serialId,
   lotCandidates:m.lotCandidates,quantity:m.quantity,
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
     ${JSON.stringify({moveIds:out.moveIds,productId:m.productId,serialId:m.serialId??null,variantId:m.variantId??null,lotId:m.lotId??null,quantity:m.quantity,fromWarehouseId:m.from,
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
 const products=await teamRows(db,sql`SELECT p.id,coalesce(p.name_ar,p.name) AS name,p.sku,p.unit,p.tracking_mode AS tracking,
  (p.is_variant_parent OR EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id)) AS "requiresVariant",
  coalesce((SELECT jsonb_agg(jsonb_build_object('id',v.id,'sku',v.sku,'attributes',v.attributes) ORDER BY v.id)
   FROM product_variants v WHERE v.product_id=p.id AND v.is_active),'[]'::jsonb) AS variants
  FROM products p WHERE p.company_id=${actor.companyId} AND p.is_active AND (p.tracking_mode='none' OR
   p.tracking_mode IN('lot','serial') AND NOT p.is_variant_parent AND NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id))
   ORDER BY p.id LIMIT 1000`);
 const lots=await teamRows(db,sql`SELECT l.id,l.product_id AS "productId",l.lot_number AS "lotNumber",l.expiry_date::text AS "expiryDate",
  coalesce(jsonb_agg(jsonb_build_object('warehouseId',q.warehouse_id,'quantity',q.quantity::text,
   'availableQuantity',CASE WHEN l.expiry_date<${new Date().toISOString().slice(0,10)}::date THEN '0' ELSE q.quantity::text END))
   FILTER(WHERE q.id IS NOT NULL),'[]'::jsonb) AS balances
  FROM stock_lots l JOIN products p ON p.id=l.product_id AND p.company_id=${actor.companyId}
  LEFT JOIN stock_quants q ON q.lot_id=l.id AND q.product_id=p.id AND q.variant_id IS NULL
   AND q.warehouse_id=ANY(${sql.param(actor.grant.warehouseIds)}::integer[])
  WHERE p.tracking_mode='lot' AND NOT p.is_variant_parent AND NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id)
  GROUP BY l.id ORDER BY l.expiry_date NULLS LAST,l.id`);
 const serials=await teamRows(db,sql`SELECT s.id,s.product_id AS "productId",s.serial_number AS "serialNumber",
  s.state,s.current_warehouse_id AS "warehouseId" FROM stock_serials s JOIN products p ON p.id=s.product_id
  WHERE p.company_id=${actor.companyId} AND p.tracking_mode='serial' AND NOT p.is_variant_parent
  AND NOT EXISTS(SELECT 1 FROM product_variants v WHERE v.product_id=p.id)
  AND (s.current_warehouse_id=ANY(${sql.param(actor.grant.warehouseIds)}::integer[])
   OR s.current_warehouse_id IS NULL AND NOT EXISTS(SELECT 1 FROM stock_moves m WHERE m.serial_id=s.id))
  ORDER BY s.id`);
 const recent=await teamRows(db,sql`SELECT m.id,m.kind,m.state,m.quantity::text,
   coalesce(p.name_ar,p.name) AS "productName",m.variant_id AS "variantId",v.sku AS "variantSku",p.unit,
   m.serial_id AS "serialId",s.serial_number AS "serialNumber",
   m.lot_id AS "lotId",l.lot_number AS "lotNumber",l.expiry_date::text AS "expiryDate",
   coalesce(f.name_ar,f.name) AS "sourceWarehouse",coalesce(t.name_ar,t.name) AS "destinationWarehouse"
   FROM stock_moves m JOIN products p ON p.id=m.product_id AND p.company_id=${actor.companyId}
   LEFT JOIN product_variants v ON v.id=m.variant_id AND v.product_id=p.id
   LEFT JOIN stock_lots l ON l.id=m.lot_id AND l.product_id=p.id
   LEFT JOIN stock_serials s ON s.id=m.serial_id AND s.product_id=p.id
   LEFT JOIN warehouses f ON f.id=m.from_warehouse_id AND f.company_id=p.company_id
   LEFT JOIN warehouses t ON t.id=m.to_warehouse_id AND t.company_id=p.company_id
   WHERE m.source_ref LIKE 'SCOPED-%' AND
   ((f.branch_id=${actor.grant.branchId} AND f.id=ANY(${sql.param(actor.grant.warehouseIds)}::integer[])) OR
    (t.branch_id=${actor.grant.branchId} AND t.id=ANY(${sql.param(actor.grant.warehouseIds)}::integer[])))
   ORDER BY m.id DESC LIMIT 40`);
 return {actions:actor.grant.actions.filter(a=>["inventory.move.receipt","inventory.move.issue","inventory.transfer.send"].includes(a)),
  sources:project(actor.grant),destinations:grants.filter(g=>g.resource==="inventory"&&g.actions.includes("inventory.transfer.send")).flatMap(project),products,lots,serials,recent};
}
