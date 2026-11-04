import type {Request} from "express";
import {and,desc,eq,sql} from "drizzle-orm";
import {db,financialRequestsTable,productsTable,customersTable} from "@workspace/db";
import {canonical,FinancialRequestError,restore,snapshot} from "./financial-transaction";
import {getCompanyId} from "./scoped-db";
import type {ResumedDraft} from "./pos-resumed-sale";
import {customerDirectoryActor} from "./customer-directory-access";

type Tx=Parameters<Parameters<typeof db.transaction>[0]>[0];
export type BasketFacts={items:{productId:number;quantity:number}[];customerId?:number|null};
export type BasketVersion=BasketFacts&{version:number};
export const staleBasket="عُدّلت هذه السلة في تبويب آخر. اعرض النسخة الأحدث وراجعها قبل الدفع.";
export const basketFacts=(facts:BasketFacts)=>({
  items:facts.items.map(i=>({productId:i.productId,quantity:i.quantity})),
  customerId:facts.customerId??null,
});

// Append-only version evidence uses the existing permanent transaction store.
// Caller must hold the SAME source lock as final checkout before reading/writing.
export async function currentBasket(tx:Tx,req:Request,source:ResumedDraft,initial:BasketFacts):Promise<BasketVersion>{
  const [row]=await tx.select().from(financialRequestsTable).where(and(
    eq(financialRequestsTable.companyId,getCompanyId(req)),
    eq(financialRequestsTable.userId,req.session.userId!),
    eq(financialRequestsTable.operation,`pos:resumed-basket:${source.id}:v1`)))
    .orderBy(desc(sql`(${financialRequestsTable.result}->'value'->>'version')::integer`)).limit(1);
  return row?restore<BasketVersion>(row.result as Parameters<typeof restore>[0]):{...basketFacts(initial),version:0};
}
export function assertCurrentBasket(source:ResumedDraft,current:BasketVersion,facts:BasketFacts){
  if((source.version??0)!==current.version||canonical(basketFacts(current))!==canonical(basketFacts(facts)))
    throw new FinancialRequestError(staleBasket,409);
}
export async function appendBasket(tx:Tx,req:Request,source:ResumedDraft,current:BasketVersion,facts:BasketFacts){
  const value={...basketFacts(facts),version:current.version+1};
  await tx.insert(financialRequestsTable).values({
    companyId:getCompanyId(req),userId:req.session.userId!,operation:`pos:resumed-basket:${source.id}:v1`,
    requestKey:`version:${value.version}`,requestHash:canonical(basketFacts(value)),result:snapshot(value),
  });
  await tx.execute(sql`INSERT INTO audit_logs(company_id,user_id,user_name,action,entity,details)
    SELECT ${getCompanyId(req)},id,name,'pos.park.edited',${`pos_order#${source.id}`},
    ${JSON.stringify({source,version:value.version,...basketFacts(value)})} FROM users WHERE id=${req.session.userId!}`);
  return value;
}
export async function presentBasket(tx:Tx,req:Request,source:ResumedDraft,current:BasketVersion){
  const cart=[];
  for(const item of current.items){
    const [p]=await tx.select({id:productsTable.id,name:productsTable.name,price:productsTable.price})
      .from(productsTable).where(and(eq(productsTable.id,item.productId),eq(productsTable.companyId,getCompanyId(req))));
    if(!p)throw new FinancialRequestError("أحد أصناف السلة غير متاح ضمن المنشأة",403);
    cart.push({product:{...p,price:Number(p.price)},quantity:item.quantity});
  }
  const [customer]=current.customerId?await tx.select({id:customersTable.id,name:customersTable.name})
    .from(customersTable).where(and(eq(customersTable.id,current.customerId),eq(customersTable.companyId,getCompanyId(req)))):[];
  if(current.customerId&&!customer)throw new FinancialRequestError("عميل السلة غير متاح ضمن المنشأة",403);
  let visibleCustomer=customer??null;
  if(visibleCustomer){
    try{await customerDirectoryActor(req,false,tx);}
    catch(e){
      if(!(e instanceof FinancialRequestError)||e.status!==403)throw e;
      visibleCustomer={id:visibleCustomer.id,name:`عميل #${visibleCustomer.id}`};
    }
  }
  return {state:"current" as const,id:source.id,sessionId:source.sessionId,version:current.version,cart,customer:visibleCustomer};
}
