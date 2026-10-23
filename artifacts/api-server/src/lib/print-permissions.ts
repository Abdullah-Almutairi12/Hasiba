import type { RequestHandler, Request } from "express";
import { pool } from "@workspace/db";
import { returnActor, returnAuthorize } from "./return-access";
import { getCompanyId } from "./scoped-db";
/** Company aggregates cannot safely allocate branchless ledger rows. Fail closed. */
export const aggregatePrintGuard:RequestHandler=async(req,res,next)=>{
  try {
    const current=getCompanyId(req);
    const selected=typeof req.query.companyIds==="string"?req.query.companyIds.split(",").map(Number).filter(n=>Number.isSafeInteger(n)&&n>0):[];
    for(const companyId of new Set([current,...selected])){
      const a=await returnActor(req.session.userId!,companyId);
      if((a.custom||companyId!==current) && (!a.capabilities.includes("reports")||!a.capabilities.includes("export"))) return res.status(403).json({error:"ليست لديك صلاحية تصدير التقرير",diagnosticRef:String(req.id)});
      if(a.branches!==null) return res.status(403).json({error:"هذا التقرير يشمل جميع فروع الشركة؛ نطاقك المحدد لا يسمح بتنزيله",diagnosticRef:String(req.id)});
    }
    return next();
  }catch {return res.status(403).json({error:"تعذر التحقق من نطاق التصدير",diagnosticRef:String(req.id)});}
};
export async function checkDocumentPrint(req:Request, kind:"invoice"|"supplier"|"po"|"pos",id:number){
  const {FinancialRequestError}=await import("./financial-transaction");
  if(!Number.isSafeInteger(id)||id<1)throw new FinancialRequestError("معرف مستند غير صالح",400);
  const companyId=getCompanyId(req);
  const a=await returnActor(req.session.userId!,companyId);
  if(a.custom) await returnAuthorize(a.userId,companyId,"view");
  const queries={
    invoice:`SELECT coalesce(i.branch_id,b.id) AS branch_id FROM customer_invoices i
      LEFT JOIN sales_orders so ON so.id=i.so_id AND so.company_id=i.company_id AND so.source='pos'
      LEFT JOIN pos_orders o ON so.notes='POS '||o.order_number AND o.company_id=i.company_id
      LEFT JOIN pos_sessions s ON s.id=o.session_id
      LEFT JOIN branches b ON b.id=s.branch_id AND b.company_id=i.company_id
      WHERE i.id=$1 AND i.company_id=$2`,
    supplier:"SELECT NULL::integer AS branch_id FROM invoices WHERE id=$1 AND company_id=$2",
    po:"SELECT NULL::integer AS branch_id FROM purchase_orders WHERE id=$1 AND company_id=$2",
    pos:"SELECT s.branch_id FROM pos_orders o JOIN pos_sessions s ON s.id=o.session_id JOIN branches b ON b.id=s.branch_id AND b.company_id=o.company_id WHERE o.id=$1 AND o.company_id=$2",
  };
  const {rows}=await pool.query(queries[kind],[id,companyId]);
  if(!rows.length)throw new FinancialRequestError("المستند غير موجود",404);
  if(a.branches!==null && (rows[0].branch_id==null||!a.branches.includes(rows[0].branch_id))) {
    throw new FinancialRequestError("المستند خارج نطاق الفروع المسموح",403);
  }
}
