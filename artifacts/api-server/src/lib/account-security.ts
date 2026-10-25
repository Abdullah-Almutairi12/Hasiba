import type {Request} from "express";
import {randomBytes,randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {db} from "@workspace/db";
import type {DbOrTx} from "./journal-posting";
import {adminRows,administrativeRights} from "./administration-authority";
import {hashAccountPassword,newAccountPasswordError,verifyAccountPassword} from "./account-password";
import {lockApprovalAuthority,lockApprovalAuthorityWrite} from "./approval-authority";
import {accountDigest,accountEncryptionReady,newTotp,openAccountSecret,sealAccountSecret,totpCounter} from "./account-crypto";

export class AccountSecurityError extends Error {
  constructor(message:string,public status=400){super(message);}
}
export const accountRows=adminRows;
export async function lockAccount(tx:DbOrTx,id:number,writesUser=false):Promise<Record<string,any>> {
  // Existing database triggers on users take the WRITER authority fence.
  // A password writer must take that side BEFORE user locks, never upgrade
  // a shared fence while another login is waiting for the same user row.
  await (writesUser?lockApprovalAuthorityWrite(tx):lockApprovalAuthority(tx));
  const [u]=await accountRows(tx,sql`SELECT * FROM users WHERE id=${id} FOR UPDATE`);
  if(!u?.is_active)throw new AccountSecurityError("تعذر التحقق من الحساب",401);
  await tx.execute(sql`INSERT INTO account_security(user_id) VALUES(${id}) ON CONFLICT DO NOTHING`);
  const [s]=await accountRows(tx,sql`SELECT * FROM account_security WHERE user_id=${id} FOR UPDATE`);
  return {...u,...s,id:u.id};
}
export async function accountEpoch(userId:number) {
  const [r]=await accountRows(db,sql`SELECT coalesce(s.credential_epoch,0) AS epoch,u.is_active,
    s.totp_secret IS NOT NULL AS enabled FROM users u LEFT JOIN account_security s ON s.user_id=u.id WHERE u.id=${userId}`);
  return r;
}
export const regenerate=(req:Request)=>new Promise<void>((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
export const saveSession=(req:Request)=>new Promise<void>((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));
export async function beginAccountChallenge(req:Request,userId:number,hash:string,companyId:number|null,intent:"login"|"receipt") {
  const result=await db.transaction(async tx=>{
    const a=await lockAccount(tx,userId);
    if(a.password_hash!==hash)throw new AccountSecurityError("أعد التحقق من كلمة المرور",401);
    if(!a.totp_secret)return {needed:false,epoch:a.credential_epoch};
    const id=randomUUID();
    await tx.execute(sql`INSERT INTO account_login_challenges(id,user_id,credential_epoch,company_id,intent,expires_at)
      VALUES(${id},${userId},${a.credential_epoch},${companyId},${intent},clock_timestamp()+interval '5 minutes')`);
    return {needed:true,id,epoch:a.credential_epoch};
  });
  if(result.needed){await regenerate(req);req.session.mfaChallenge=result.id;await saveSession(req);}
  return result;
}
async function audit(tx:DbOrTx,id:number,event:string,companyId:number|null) {
  // Never log credentials, OTPs, reset tokens, secret envelopes or recovery codes.
  await tx.execute(sql`INSERT INTO account_security_events(user_id,company_id,event)
    VALUES(${id},${companyId},${event})`);
  if(event==="account.company_policy.changed"&&companyId!=null)
    await tx.execute(sql`INSERT INTO audit_logs(company_id,user_id,user_name,action,entity,details,ip_address)
      SELECT ${companyId},id,name,${event},'account_security','{}','server' FROM users WHERE id=${id}`);
}
async function factor(tx:DbOrTx,a:Record<string,any>,token?:string,recoveryCode?:string) {
  if(!a.totp_secret)return true;
  if(recoveryCode) {
    const removed=await accountRows(tx,sql`DELETE FROM account_recovery_codes
      WHERE user_id=${a.id} AND code_hash=${accountDigest(`${a.id}:${recoveryCode.replace(/-/g,"").toLowerCase()}`)} RETURNING user_id`);
    return removed.length===1;
  }
  const counter=totpCounter(openAccountSecret(a.id,"active",a.totp_secret),token??"");
  if(counter==null || counter<=Number(a.last_totp_counter))return false;
  await tx.execute(sql`UPDATE account_security SET last_totp_counter=${counter} WHERE user_id=${a.id}`);
  return true;
}
async function failure(tx:DbOrTx,a:Record<string,any>) {
  await tx.execute(sql`UPDATE account_security SET failed_attempts=failed_attempts+1,
    locked_until=CASE WHEN failed_attempts+1>=6 THEN clock_timestamp()+interval '15 minutes' ELSE locked_until END
    WHERE user_id=${a.id}`);
}
async function resetFailures(tx:DbOrTx,id:number) {
  await tx.execute(sql`UPDATE account_security SET failed_attempts=0,locked_until=NULL WHERE user_id=${id}`);
}
export async function completeAccountChallenge(req:Request,input:{token?:string,recoveryCode?:string}) {
  const id=req.session.mfaChallenge;
  if(!id)throw new AccountSecurityError("لا يوجد تحقق إضافي صالح",401);
  const [challenge]=await accountRows(db,sql`SELECT user_id FROM account_login_challenges WHERE id=${id}`);
  if(!challenge)throw new AccountSecurityError("انتهى طلب التحقق",401);
  const result=await db.transaction(async tx=>{
    const a=await lockAccount(tx,challenge.user_id);
    const [c]=await accountRows(tx,sql`SELECT *,expires_at>clock_timestamp() AS valid FROM account_login_challenges WHERE id=${id} FOR UPDATE`);
    if(!c?.valid||c.consumed_at||c.attempts>=5||c.credential_epoch!==a.credential_epoch||
      (a.locked_until&&new Date(a.locked_until).getTime()>Date.now()))return null;
    await tx.execute(sql`UPDATE account_login_challenges SET attempts=attempts+1 WHERE id=${id}`);
    if(!a.totp_secret||!await factor(tx,a,input.token,input.recoveryCode)){await failure(tx,a);return null;}
    await tx.execute(sql`UPDATE account_login_challenges SET consumed_at=clock_timestamp() WHERE id=${id}`);
    await resetFailures(tx,a.id);await audit(tx,a.id,"account.mfa.login",c.company_id);
    return {userId:a.id,epoch:a.credential_epoch,companyId:c.company_id,intent:c.intent};
  });
  if(!result)throw new AccountSecurityError("تعذر التحقق أو انتهت المحاولة؛ استخدم رمزًا جديدًا",401);
  return result;
}
export type AccountProof={currentPassword:string,token?:string,recoveryCode?:string};
export async function withAccountProof<T>(req:Request,proof:AccountProof,work:(tx:DbOrTx,a:Record<string,any>)=>Promise<T>,writesUser=false) {
  const result=await db.transaction(async tx=>{
    const a=await lockAccount(tx,req.session.userId!,writesUser);
    if((req.session.authEpoch??0)!==a.credential_epoch||
      (a.locked_until&&new Date(a.locked_until).getTime()>Date.now()))return {ok:false as const};
    if(!await verifyAccountPassword(proof.currentPassword,a.password_hash??"")||!await factor(tx,a,proof.token,proof.recoveryCode)){
      await failure(tx,a);return {ok:false as const};
    }
    await resetFailures(tx,a.id);
    return {ok:true as const,value:await work(tx,a)};
  });
  if(!result.ok)throw new AccountSecurityError("تعذر التحقق؛ تحقق من كلمة المرور والعامل أو انتظر انتهاء الحظر",401);
  return result.value;
}
async function rotateEpoch(tx:DbOrTx,a:Record<string,any>) {
  await tx.execute(sql`UPDATE account_security SET credential_epoch=credential_epoch+1,pending_secret=NULL,
    pending_session=NULL,pending_epoch=NULL,pending_expires_at=NULL,updated_at=clock_timestamp() WHERE user_id=${a.id}`);
  await tx.execute(sql`UPDATE account_login_challenges SET consumed_at=coalesce(consumed_at,clock_timestamp()) WHERE user_id=${a.id}`);
  await tx.execute(sql`UPDATE account_password_resets SET consumed_at=coalesce(consumed_at,clock_timestamp()) WHERE user_id=${a.id}`);
  // Durable epochs reject any already-loaded request which later re-saves an old cookie.
  await tx.execute(sql`DELETE FROM session WHERE (sess->>'userId')::int=${a.id} AND coalesce(sess->>'purpose','')<>'pos_device'`);
  return a.credential_epoch+1;
}
export async function retainCurrentSession(req:Request,epoch:number) {
  const {userId,role,companyId,purpose}=req.session;
  await regenerate(req);
  Object.assign(req.session,{userId,role,companyId,purpose,authEpoch:epoch});
  await saveSession(req);
}
export async function changeAccountPassword(req:Request,input:AccountProof&{newPassword:string}) {
  const error=newAccountPasswordError(input.newPassword);if(error)throw new AccountSecurityError(error);
  const hash=await hashAccountPassword(input.newPassword);
  return withAccountProof(req,input,async(tx,a)=>{
    if(await verifyAccountPassword(input.newPassword,a.password_hash))throw new AccountSecurityError("اختر عبارة مختلفة عن الحالية");
    await tx.execute(sql`UPDATE users SET password_hash=${hash} WHERE id=${a.id}`);
    await rotateEpoch(tx,a);await audit(tx,a.id,"account.password.changed",req.session.companyId??null);
    return {ok:true,reauthenticate:true};
  },true);
}
export async function revokeOtherSessions(req:Request,input:AccountProof) {
  const epoch=await withAccountProof(req,input,async(tx,a)=>{
    const epoch=await rotateEpoch(tx,a);await audit(tx,a.id,"account.sessions.revoked",req.session.companyId??null);return epoch;
  });
  await retainCurrentSession(req,epoch);return {ok:true};
}
export async function startAccountTotp(req:Request,input:AccountProof) {
  if(!accountEncryptionReady())throw new AccountSecurityError("تشفير المصادقة غير مهيأ؛ تواصل مع مسؤول تشغيل المنصة",503);
  return withAccountProof(req,input,async(tx,a)=>{
    const data=newTotp(a.email??String(a.id));
    await tx.execute(sql`UPDATE account_security SET pending_secret=${sealAccountSecret(a.id,"pending",data.secret)},
      pending_session=${accountDigest(req.sessionID)},pending_epoch=credential_epoch,
      pending_expires_at=clock_timestamp()+interval '10 minutes' WHERE user_id=${a.id}`);
    await audit(tx,a.id,"account.totp.enrollment_started",req.session.companyId??null);
    return {...data,expiresInSeconds:600};
  });
}
async function issueRecoveryCodes(tx:DbOrTx,userId:number) {
  const codes=Array.from({length:10},()=>randomBytes(24).toString("hex"));
  await tx.execute(sql`DELETE FROM account_recovery_codes WHERE user_id=${userId}`);
  for(const code of codes)await tx.execute(sql`INSERT INTO account_recovery_codes(user_id,code_hash)
    VALUES(${userId},${accountDigest(`${userId}:${code}`)})`);
  return codes;
}
export async function confirmAccountTotp(req:Request,input:{currentPassword:string,token:string}) {
  // Confirmation proves the NEW seed. Requiring the existing factor again here
  // would reject the new token; existing-factor proof was consumed at start.
  const result=await db.transaction(async tx=>{
    const a=await lockAccount(tx,req.session.userId!);
    if((req.session.authEpoch??0)!==a.credential_epoch||!a.pending_secret||a.pending_session!==accountDigest(req.sessionID)||
      a.pending_epoch!==a.credential_epoch||new Date(a.pending_expires_at).getTime()<=Date.now()||
      (a.locked_until&&new Date(a.locked_until).getTime()>Date.now()))return null;
    const secret=openAccountSecret(a.id,"pending",a.pending_secret),counter=totpCounter(secret,input.token);
    if(!await verifyAccountPassword(input.currentPassword,a.password_hash)||counter==null){await failure(tx,a);return null;}
    await tx.execute(sql`UPDATE account_security SET totp_secret=${sealAccountSecret(a.id,"active",secret)},last_totp_counter=${counter} WHERE user_id=${a.id}`);
    const codes=await issueRecoveryCodes(tx,a.id),epoch=await rotateEpoch(tx,a);
    await resetFailures(tx,a.id);await audit(tx,a.id,"account.totp.enabled",req.session.companyId??null);
    return {epoch,codes};
  });
  if(!result)throw new AccountSecurityError("تعذر تأكيد الوسيلة أو انتهى التسجيل المؤقت",401);
  await retainCurrentSession(req,result.epoch);
  return {ok:true,recoveryCodes:result.codes};
}
export async function disableAccountTotp(req:Request,input:AccountProof) {
  const epoch=await withAccountProof(req,input,async(tx,a)=>{
    const required=await accountRows(tx,sql`SELECT c.id FROM companies c JOIN user_companies uc ON uc.company_id=c.id
      WHERE uc.user_id=${a.id} AND c.is_active AND c.account_mfa_required FOR SHARE OF c`);
    if(required.length)throw new AccountSecurityError("سياسة منشأة مرتبطة تتطلب عاملًا؛ لا يمكن تعطيل آخر وسيلة",409);
    await tx.execute(sql`UPDATE account_security SET totp_secret=NULL,last_totp_counter=-1 WHERE user_id=${a.id}`);
    await tx.execute(sql`DELETE FROM account_recovery_codes WHERE user_id=${a.id}`);
    const epoch=await rotateEpoch(tx,a);await audit(tx,a.id,"account.totp.disabled",req.session.companyId??null);return epoch;
  });
  await retainCurrentSession(req,epoch);return {ok:true};
}
export async function renewAccountRecovery(req:Request,input:AccountProof) {
  return withAccountProof(req,input,async(tx,a)=>{
    if(!a.totp_secret)throw new AccountSecurityError("فعّل تطبيق المصادقة أولًا",409);
    const recoveryCodes=await issueRecoveryCodes(tx,a.id);
    await audit(tx,a.id,"account.recovery.renewed",req.session.companyId??null);
    return {ok:true,recoveryCodes};
  });
}
export async function accountSecurityStatus(req:Request) {
  const userId=req.session.userId!;
  const [state]=await accountRows(db,sql`SELECT totp_secret IS NOT NULL AS enabled FROM account_security WHERE user_id=${userId}`);
  const [company]=await accountRows(db,sql`SELECT account_mfa_required FROM companies WHERE id=${req.session.companyId??-1}`);
  const sessions=await accountRows(db,sql`SELECT sid,expire FROM session WHERE (sess->>'userId')::int=${userId}
    AND coalesce(sess->>'purpose','') NOT IN ('pos_device','administration_receipt') AND expire>clock_timestamp()
    AND coalesce((sess->>'authEpoch')::int,0)=coalesce((SELECT credential_epoch FROM account_security WHERE user_id=${userId}),0) ORDER BY expire`);
  const [codes]=await accountRows(db,sql`SELECT count(*)::int AS count FROM account_recovery_codes WHERE user_id=${userId}`);
  return {mfaEnabled:!!state?.enabled,companyRequiresMfa:!!company?.account_mfa_required,
    encryptionConfigured:accountEncryptionReady(),recoveryCodesRemaining:codes.count,
    canManagePolicy:req.session.companyId!=null&&(await administrativeRights(req.session.companyId,userId)).includes("settings"),
    sessions:sessions.map(s=>({reference:accountDigest(s.sid),current:s.sid===req.sessionID,expiresAt:new Date(s.expire).toISOString()}))};
}
export async function changeAccountPolicy(req:Request,input:AccountProof&{required:boolean}) {
  return withAccountProof(req,input,async(tx,a)=>{
    const companyId=req.session.companyId;
    if(!companyId||!(await administrativeRights(companyId,a.id,tx)).includes("settings"))throw new AccountSecurityError("غير مخول بسياسة هذه المنشأة",403);
    if(input.required&&!a.totp_secret)throw new AccountSecurityError("فعّل عامل حسابك قبل اشتراطه على المنشأة",409);
    await tx.execute(sql`UPDATE companies SET account_mfa_required=${input.required} WHERE id=${companyId}`);
    await audit(tx,a.id,"account.company_policy.changed",companyId);return {ok:true};
  });
}
