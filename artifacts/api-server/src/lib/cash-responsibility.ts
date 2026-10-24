import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import type { DbOrTx } from "./journal-posting";
import { FinancialRequestError } from "./financial-transaction";
import { verifyAccountPassword } from "./account-password";
import { managedProfile, requireResponsibility } from "./responsibility-context";
import { returnAuthorize } from "./return-access";

const fail = (message: string, status=403): never => { throw new FinancialRequestError(message,status); };
const hash = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
async function audit(tx:DbOrTx,userId:number,companyId:number,action:string,entity:string,details:unknown) {
  await tx.execute(sql`INSERT INTO audit_logs(company_id,user_id,user_name,action,entity,details)
    SELECT ${companyId},id,name,${action},${entity},${JSON.stringify(details)} FROM users WHERE id=${userId}`);
}
export const ownerPurposes = ["cash_difference_review","cash_difference_responsibility"] as const;
export const responsibilityInput = z.object({
  sessionId:z.number().int().positive(),
  decision:z.enum(["company_bears","employee_responsible"]),
  employeeId:z.number().int().positive().nullable().default(null),
  reason:z.string().trim().min(3).max(500),
  evidence:z.string().trim().min(3).max(500),
  idempotencyKey:z.uuid(),
  ownerProof:z.string().optional(),
}).refine(v=>(v.decision==="employee_responsible")===(v.employeeId!==null),"حدد الموظف فقط عند إسناد المسؤولية");

async function soleOwner(tx:DbOrTx,userId:number,companyId:number) {
  const r=await tx.execute(sql`SELECT u.password_hash FROM users u JOIN user_companies m ON m.user_id=u.id
    JOIN companies c ON c.id=m.company_id WHERE u.id=${userId} AND m.company_id=${companyId}
    AND m.role='owner' AND u.is_active AND c.is_active
    AND (SELECT count(*) FROM user_companies WHERE company_id=${companyId} AND role='owner')=1`);
  if(!r.rows[0]) fail("هذا الاستثناء لمالك الشركة المنفرد فقط، وليس تفويضًا للموظفين");
  return r.rows[0];
}
async function source(tx:DbOrTx,companyId:number,sessionId:number,purpose:string,input?:unknown) {
  const r=await tx.execute(sql`SELECT c.session_id,c.expected,c.counted,c.difference,c.reason,c.created_by,c.status,s.branch_id
    FROM pos_cash_closings c JOIN pos_sessions s ON s.id=c.session_id JOIN branches b ON b.id=s.branch_id
    WHERE c.company_id=${companyId} AND c.session_id=${sessionId} AND b.company_id=${companyId}`);
  if(!r.rows[0] || Number(r.rows[0].difference)===0) fail("يلزم فرق صندوق مسجل في الشركة",409);
  if((purpose==="cash_difference_review"&&r.rows[0].status!=="pending") ||
    (purpose==="cash_difference_responsibility"&&r.rows[0].status!=="approved")) fail("غرض تأكيد الهوية لا يطابق مرحلة الإقفال الحالية",409);
  return { facts:r.rows[0], fingerprint:hash({purpose,source:r.rows[0],input:input??null}) };
}
async function policy(tx:DbOrTx,userId:number,companyId:number,purpose:string,difference:unknown) {
  await soleOwner(tx,userId,companyId);
  const r=await tx.execute(sql`SELECT * FROM pos_owner_exception_policies WHERE company_id=${companyId}
    AND enabled AND operations ? ${purpose} AND amount_limit >= abs(${String(difference)}::numeric)`);
  if(!r.rows[0]) fail("سياسة المالك لا تسمح بهذه العملية أو مبلغها");
  return r.rows[0];
}
export async function configureOwnerPolicy(tx:DbOrTx,userId:number,companyId:number,input:unknown) {
  const b=z.object({enabled:z.boolean(),operations:z.array(z.enum(ownerPurposes)).max(2),
    amountLimit:z.number().nonnegative().max(999999999).refine(v=>Number(v.toFixed(2))===v),
    reason:z.string().trim().min(3).max(500)}).refine(v=>!v.enabled || (v.operations.length>0&&v.amountLimit>0)).parse(input);
  await returnAuthorize(userId,companyId,"configure",undefined,tx);
  if(b.enabled) await soleOwner(tx,userId,companyId);
  await tx.execute(sql`INSERT INTO pos_owner_exception_policies(company_id,enabled,operations,amount_limit,reason,updated_by)
    VALUES(${companyId},${b.enabled},${JSON.stringify([...new Set(b.operations)])}::jsonb,${String(b.amountLimit)},${b.reason},${userId})
    ON CONFLICT(company_id) DO UPDATE SET enabled=EXCLUDED.enabled,operations=EXCLUDED.operations,
      amount_limit=EXCLUDED.amount_limit,reason=EXCLUDED.reason,updated_by=EXCLUDED.updated_by,
      revision=pos_owner_exception_policies.revision+1,updated_at=clock_timestamp()`);
  await audit(tx,userId,companyId,"configure","pos_owner_exception_policy",b);
  return {ok:true};
}
export async function issueOwnerProof(tx:DbOrTx,userId:number,companyId:number,input:unknown) {
  const b=z.object({purpose:z.enum(ownerPurposes),sessionId:z.number().int().positive(),
    password:z.string().min(1).max(1024),decision: z.unknown().optional()}).parse(input);
  const identity=await soleOwner(tx,userId,companyId);
  if(!identity.password_hash || !await verifyAccountPassword(b.password,String(identity.password_hash))) fail("تعذر تأكيد هوية الحساب",401);
  const decision=b.purpose==="cash_difference_responsibility" ? responsibilityInput.parse(b.decision) : undefined;
  if(decision && decision.sessionId!==b.sessionId) fail("غرض التأكيد لا يطابق الوردية");
  const canonical=decision ? {...decision,ownerProof:undefined} : undefined;
  const s=await source(tx,companyId,b.sessionId,b.purpose,canonical);
  const p=await policy(tx,userId,companyId,b.purpose,s.facts.difference);
  const token=randomBytes(32).toString("base64url");
  await tx.execute(sql`INSERT INTO pos_owner_operation_proofs(token_hash,company_id,user_id,purpose,session_id,
    source_fingerprint,policy_revision,expires_at) VALUES(${hash(token)},${companyId},${userId},${b.purpose},
    ${b.sessionId},${s.fingerprint},${Number(p.revision)},clock_timestamp()+interval '5 minutes')`);
  await audit(tx,userId,companyId,"identity_confirmed","pos_owner_exception",
    {purpose:b.purpose,sessionId:b.sessionId,policyRevision:p.revision,independentApproval:false});
  return {proof:token,expiresInSeconds:300,independentApproval:false};
}
export async function consumeOwnerProof(tx:DbOrTx,userId:number,companyId:number,purpose:typeof ownerPurposes[number],
  sessionId:number,token:unknown,input?:unknown) {
  if(typeof token!=="string" || token.length!==43) fail("يلزم تأكيد هوية خاص بهذه العملية وفق سياسة المالك");
  const s=await source(tx,companyId,sessionId,purpose,input);
  const p=await policy(tx,userId,companyId,purpose,s.facts.difference);
  const r=await tx.execute(sql`UPDATE pos_owner_operation_proofs SET consumed_at=clock_timestamp()
    WHERE token_hash=${hash(token)} AND company_id=${companyId} AND user_id=${userId} AND purpose=${purpose}
    AND session_id=${sessionId} AND source_fingerprint=${s.fingerprint} AND policy_revision=${Number(p.revision)}
    AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING token_hash`);
  if(!r.rows.length) fail("تأكيد الهوية منتهٍ أو مستخدم أو لا يطابق العملية والسياسة الحالية");
  await audit(tx,userId,companyId,"exception_used","pos_owner_exception",
    {purpose,sessionId,policyRevision:p.revision,sourceFingerprint:s.fingerprint,independentApproval:false});
}
export async function decideCashResponsibility(tx:DbOrTx,userId:number,companyId:number,input:unknown) {
  const b=responsibilityInput.parse(input);
  const [s]=(await tx.execute(sql`SELECT c.*,s.branch_id FROM pos_cash_closings c
    JOIN pos_sessions s ON s.id=c.session_id JOIN branches br ON br.id=s.branch_id
    WHERE c.session_id=${b.sessionId} AND c.company_id=${companyId} AND br.company_id=${companyId} FOR UPDATE OF c,s`)).rows;
  if(!s || s.status!=="approved" || Number(s.difference)===0) fail("قرار المسؤولية بعد اعتماد فرق فعلي فقط",409);
  await returnAuthorize(userId,companyId,"responsibility",Number(s.branch_id),tx);
  if(await managedProfile(userId,companyId,tx)) {
    const grant=await requireResponsibility("pos.shift.responsibility",tx);
    const bound=await tx.execute(sql`SELECT abs(${String(s.difference)}::numeric)<=coalesce(${grant.amountLimit}::numeric,0) AS allowed`);
    if(grant.branchId!==Number(s.branch_id)||!bound.rows[0]?.allowed) fail("قرار المسؤولية خارج الفرع أو الحد المالي");
  }
  const canonical={...b,ownerProof:undefined};
  const fp=hash({userId,...canonical});
  const old=await tx.execute(sql`SELECT * FROM pos_cash_responsibility_decisions
    WHERE company_id=${companyId} AND (session_id=${b.sessionId} OR idempotency_key=${b.idempotencyKey})`);
  if(old.rows.length) {
    if(old.rows[0].fingerprint!==fp) fail("سجل قرار سابق مختلف؛ لا يعدل القرار بإعادة الطلب",409);
    return old.rows[0];
  }
  let ownerException=false;
  if(Number(s.created_by)===userId) {
    await consumeOwnerProof(tx,userId,companyId,"cash_difference_responsibility",b.sessionId,b.ownerProof,canonical);
    ownerException=true;
  }
  if(b.employeeId!==null) {
    const employee=await tx.execute(sql`SELECT id FROM employees WHERE id=${b.employeeId}
      AND company_id=${companyId} AND branch_id=${Number(s.branch_id)}`);
    if(!employee.rows.length) fail("الموظف خارج شركة وفرع القرار");
  }
  const created=await tx.execute(sql`INSERT INTO pos_cash_responsibility_decisions
    (company_id,session_id,decision,employee_id,reason,evidence,decided_by,idempotency_key,fingerprint,owner_exception,difference_amount,closing_snapshot)
    VALUES(${companyId},${b.sessionId},${b.decision},${b.employeeId},${b.reason},${b.evidence},${userId},
      ${b.idempotencyKey},${fp},${ownerException},${String(s.difference)},
      ${JSON.stringify({expected:s.expected,counted:s.counted,difference:s.difference,createdBy:s.created_by,approvedBy:s.approved_by,branchId:s.branch_id})}::jsonb) RETURNING *`);
  await audit(tx,userId,companyId,"responsibility_decided","pos_cash_difference",
    {sessionId:b.sessionId,decisionId:created.rows[0].id,ownerException,createsEmployeeDebt:false,createsPayrollDeduction:false});
  return created.rows[0];
}
