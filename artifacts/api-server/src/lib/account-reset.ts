import {randomBytes,randomUUID} from "node:crypto";
import {sql} from "drizzle-orm";
import {db} from "@workspace/db";
import {accountDigest,accountEncryptionReady,sealAccountSecret} from "./account-crypto";
import {accountRows,AccountSecurityError,lockAccount} from "./account-security";
import {hashAccountPassword,newAccountPasswordError} from "./account-password";

// No HTTP access. Only disposable isolated tests can read this test channel.
const testOutbox=new Map<string,string[]>();
export function readAccountTestOutbox(email:string) {
  if(process.env.NODE_ENV!=="test"||process.env.ACCOUNT_ISOLATED_TEST!=="true")
    throw new Error("Isolated account test channel only");
  return testOutbox.get(email)??[];
}
export async function requestAccountReset(email:string) {
  if(!accountEncryptionReady())return;
  const [u]=await accountRows(db,sql`SELECT id FROM users WHERE lower(email)=${email.toLowerCase()} AND is_active`);
  if(!u)return;
  const token=randomBytes(32).toString("base64url");
  await db.transaction(async tx=>{
    const a=await lockAccount(tx,u.id);
    await tx.execute(sql`UPDATE account_password_resets SET consumed_at=coalesce(consumed_at,clock_timestamp()) WHERE user_id=${a.id}`);
    await tx.execute(sql`UPDATE account_recovery_outbox SET status='cancelled',encrypted_payload='',error_code='superseded'
      WHERE user_id=${a.id} AND status IN ('prepared','failed')`);
    await tx.execute(sql`INSERT INTO account_password_resets(token_hash,user_id,credential_epoch,expires_at)
      VALUES(${accountDigest(token)},${a.id},${a.credential_epoch},clock_timestamp()+interval '15 minutes')`);
    await tx.execute(sql`INSERT INTO account_recovery_outbox(id,user_id,token_hash,encrypted_payload)
      VALUES(${randomUUID()},${a.id},${accountDigest(token)},${sealAccountSecret(a.id,"password-reset",JSON.stringify({token,email:a.email}))})`);
  });
  if(process.env.NODE_ENV==="test"&&process.env.ACCOUNT_ISOLATED_TEST==="true")testOutbox.set(email.toLowerCase(),[token]);
  // Delivery is a separate opt-in worker; never reveals account existence to HTTP.
}
export async function finishAccountReset(token:string,newPassword:string) {
  const policy=newAccountPasswordError(newPassword);if(policy)throw new AccountSecurityError(policy);
  const hash=await hashAccountPassword(newPassword);
  const [r]=await accountRows(db,sql`SELECT user_id FROM account_password_resets WHERE token_hash=${accountDigest(token)}`);
  if(!r)throw new AccountSecurityError("الرابط غير صالح أو انتهى",401);
  return db.transaction(async tx=>{
    const a=await lockAccount(tx,r.user_id,true);
    const [reset]=await accountRows(tx,sql`SELECT *,expires_at>clock_timestamp() AS valid FROM account_password_resets
      WHERE token_hash=${accountDigest(token)} FOR UPDATE`);
    if(!reset?.valid||reset.consumed_at||reset.credential_epoch!==a.credential_epoch)throw new AccountSecurityError("الرابط غير صالح أو انتهى",401);
    await tx.execute(sql`UPDATE users SET password_hash=${hash} WHERE id=${a.id}`);
    await tx.execute(sql`UPDATE account_security SET credential_epoch=credential_epoch+1,pending_secret=NULL,
      pending_session=NULL,pending_expires_at=NULL,pending_epoch=NULL WHERE user_id=${a.id}`);
    await tx.execute(sql`UPDATE account_password_resets SET consumed_at=coalesce(consumed_at,clock_timestamp()) WHERE user_id=${a.id}`);
    await tx.execute(sql`UPDATE account_login_challenges SET consumed_at=coalesce(consumed_at,clock_timestamp()) WHERE user_id=${a.id}`);
    await tx.execute(sql`DELETE FROM session WHERE (sess->>'userId')::int=${a.id} AND coalesce(sess->>'purpose','')<>'pos_device'`);
    await tx.execute(sql`INSERT INTO account_security_events(user_id,event)
      VALUES(${a.id},'account.password.reset')`);
    // The enrolled TOTP secret and last accepted counter remain unchanged.
    return {ok:true,reauthenticate:true};
  });
}
