import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { documentIssuer } from "./document-identity";

/** Explicit allowlist: never return general audit details, commission rates,
 * inventory costs, credentials or provider payloads to invoice readers. */
export function safeSellerEvidence(value: unknown) {
  if(!Array.isArray(value))return [];
  return value.map(v=>{
    const r=v&&typeof v==="object"?v as Record<string,unknown>:{};
    return {lineId:r.invoice_line_id??null,employeeId:r.employee_id??null,name:r.seller_name??null,revision:r.revision??null};
  });
}
export async function saleDocumentHistory(companyId:number,invoiceId:number) {
  const issuer=await documentIssuer(companyId,"invoice",invoiceId);
  const output=(await db.execute(sql`SELECT id,action,user_id AS "actorId",user_name AS "actorName",created_at AS "at",
    document_facts AS facts FROM audit_logs WHERE company_id=${companyId} AND document_id=${invoiceId}
    AND entity='customer_invoice' ORDER BY created_at,id`)).rows;
  const corrections=(await db.execute(sql`SELECT a.id,a.user_id,a.reason,a.before_value,a.after_value,a.created_at,u.name
    FROM invoice_seller_audit a LEFT JOIN users u ON u.id=a.user_id
    WHERE a.company_id=${companyId} AND a.invoice_id=${invoiceId} ORDER BY a.created_at,a.id`)).rows;
  const returns=(await db.execute(sql`SELECT n.id,n.reference,n.created_at,n.reason,c.created_by,c.approval_id,u.name
    FROM credit_notes n LEFT JOIN return_controls c ON c.note_id=n.id AND c.company_id=n.company_id
    LEFT JOIN users u ON u.id=c.created_by WHERE n.company_id=${companyId} AND n.invoice_id=${invoiceId}
    ORDER BY n.created_at,n.id`)).rows;
  const payouts=(await db.execute(sql`SELECT p.id,p.created_by,p.created_at,p.status,p.confirmed_by,p.confirmed_at,u.name
    FROM return_payouts p LEFT JOIN users u ON u.id=p.created_by
    WHERE p.company_id=${companyId} AND p.invoice_id=${invoiceId} ORDER BY p.created_at,p.id`)).rows;
  const invoice=(await db.execute(sql`SELECT created_by,created_at,reversed_by_id,reverses_id,reversed_reason
    FROM customer_invoices WHERE company_id=${companyId} AND id=${invoiceId}`)).rows[0];
  const approvals=(await db.execute(sql`SELECT a.id,a.approver_user_id,a.approver_name,a.action,a.comment,a.acted_at,a.request_id
    FROM approval_actions a JOIN return_controls c ON c.approval_id=a.request_id
    JOIN credit_notes n ON n.id=c.note_id AND n.company_id=c.company_id
    WHERE n.invoice_id=${invoiceId} AND c.company_id=${companyId} ORDER BY a.acted_at,a.id`)).rows;
  return {identity:issuer.saleIdentity??null, historicalIdentityAvailable:!!issuer.saleIdentity,
    events:[
      ...(invoice?[{id:"issued",action:"issued",actorId:invoice.created_by,
        actorName:issuer.saleIdentity?.creator.name??null,at:invoice.created_at,reason:null,approvalId:null,before:null,after:null,
        facts:{reversesId:invoice.reverses_id,reversedById:invoice.reversed_by_id,reversedReason:invoice.reversed_reason}}]:[]),
      ...output.map(r=>({id:r.id,action:r.action,actorId:r.actorId,actorName:r.actorName,at:r.at,
        facts:r.facts,reason:null,approvalId:null,before:null,after:null})),
      ...corrections.map(r=>({id:`correction-${r.id}`,action:"seller_corrected",actorId:r.user_id,actorName:r.name,
        at:r.created_at,reason:r.reason,approvalId:null,before:safeSellerEvidence(r.before_value),after:safeSellerEvidence(r.after_value),facts:null})),
      ...returns.map(r=>({id:`return-${r.id}`,action:"partial_or_full_return",actorId:r.created_by??null,actorName:r.name??null,
        at:r.created_at,reason:r.reason,approvalId:r.approval_id??null,before:null,after:null,facts:{reference:r.reference}})),
      ...payouts.map(r=>({id:`payout-${r.id}`,action:"refund_recorded",actorId:r.created_by,actorName:r.name,
        at:r.created_at,reason:null,approvalId:null,before:null,after:null,facts:{status:r.status,confirmedBy:r.confirmed_by,confirmedAt:r.confirmed_at}})),
      ...approvals.map(r=>({id:`approval-${r.id}`,action:`approval_${r.action}`,actorId:r.approver_user_id,actorName:r.approver_name,
        at:r.acted_at,reason:r.comment,approvalId:r.request_id,before:null,after:null,facts:null})),
    ].sort((a,b)=>new Date(String(a.at)).getTime()-new Date(String(b.at)).getTime())};
}
