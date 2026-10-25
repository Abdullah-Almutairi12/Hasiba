import {beforeAll,describe,it,expect} from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import {randomUUID} from "node:crypto";
import {db,pool,usersTable,companiesTable,userCompaniesTable} from "@workspace/db";
import app,{assertApplicationReady} from "../app";
import {accountTotp,totpCounter} from "../lib/account-crypto";
import {hashAccountPassword,verifyAccountPassword} from "../lib/account-password";
import {readAccountTestOutbox} from "../lib/account-reset";
const password="Synthetic account security phrase 2026!";
let ip=1;
const agent=()=>request.agent(app).set("X-Forwarded-For",`198.51.100.${ip++}`);
const status=(r:request.Response,n=200)=>{expect(r.status).toBe(n);return r.body;};
const q=async(s:string,p:unknown[]=[])=>(await pool.query(s,p)).rows;
async function fixture(){
  const tag=randomUUID(),[c]=await db.insert(companiesTable).values({name:`account-${tag}`}).returning();
  const [u]=await db.insert(usersTable).values({name:"هوية مصطنعة",email:`account-${tag}@example.invalid`,
    passwordHash:await bcrypt.hash(password,4),role:"owner",isActive:true}).returning();
  await db.insert(userCompaniesTable).values({userId:u.id,companyId:c.id,role:"owner",isDefault:true});
  const a=agent();status(await a.post("/api/auth/login").send({email:u.email,password}));
  return {a,u,c};
}
async function enroll(f:Awaited<ReturnType<typeof fixture>>){
  const start=status(await f.a.post("/api/auth/security/totp/start").send({currentPassword:password}));
  expect(status(await f.a.get("/api/auth/security")).mfaEnabled).toBe(false);
  const token=accountTotp(start.secret).generate();
  const confirmed=status(await f.a.post("/api/auth/security/totp/confirm").send({currentPassword:password,token}));
  expect(confirmed.recoveryCodes.length).toBe(10);
  return {secret:start.secret as string,codes:confirmed.recoveryCodes as string[],token};
}
async function pending(email:string){
  const a=agent();expect(status(await a.post("/api/auth/login").send({email,password})).mfaRequired).toBe(true);
  status(await a.get("/api/auth/me"),401);return a;
}
beforeAll(assertApplicationReady);
describe("global account credentials, proven factor, single-use recovery and tenant-independent identity",()=>{
  it("shares the long-Unicode policy across signup and creation, retains legacy bcrypt, rejects administrative credential edits",async()=>{
    status(await agent().post("/api/auth/signup").send({name:"مصطنع",email:`weak-${randomUUID()}@example.invalid`,password:"short-pass"}),400);
    const long="عبارة مرور عربية طويلة جدًا ".repeat(5);
    const hash=await hashAccountPassword(long+"أ");
    expect(await verifyAccountPassword(long+"أ",hash)).toBe(true);
    expect(await verifyAccountPassword(long+"ب",hash)).toBe(false);
    expect(await verifyAccountPassword(password,await bcrypt.hash(password,4))).toBe(true);
    const f=await fixture();
    status(await f.a.patch(`/api/users/${f.u.id}`).send({password}),403);
    status(await f.a.patch(`/api/users/${f.u.id}`).send({has2fa:true}),403);
    status(await f.a.post("/api/users").send({name:"مصطنع",email:`bad-${randomUUID()}@example.invalid`,password:"short-pass",role:"cashier"}),400);
    await q("UPDATE users SET has_2fa=true WHERE id=$1",[f.u.id]);
    expect(status(await f.a.get("/api/auth/security")).mfaEnabled).toBe(false);
    const listed=status(await f.a.get("/api/users"));
    expect(listed.find((u:any)=>u.id===f.u.id).has2fa).toBe(false);
  });
  it("changes the password atomically, rejects stale sessions and racing old-password login without altering memberships",async()=>{
    const f=await fixture(),second=agent();
    status(await second.post("/api/auth/login").send({email:f.u.email,password}));
    status(await f.a.post("/api/auth/security/password").send({currentPassword:"wrong",newPassword:"عبارة مرور بديلة للاختبار فقط 2026"}),401);
    const before=await q("SELECT company_id,role FROM user_companies WHERE user_id=$1",[f.u.id]);
    const racing=agent(),next="عبارة مرور بديلة طويلة وآمنة للاختبار فقط";
    const [change,login]=await Promise.all([
      f.a.post("/api/auth/security/password").send({currentPassword:password,newPassword:next}),
      racing.post("/api/auth/login").send({email:f.u.email,password}),
    ]);
    status(change);expect([200,401]).toContain(login.status);
    status(await second.get("/api/auth/me"),401);status(await racing.get("/api/auth/me"),401);
    status(await agent().post("/api/auth/login").send({email:f.u.email,password}),401);
    status(await agent().post("/api/auth/login").send({email:f.u.email,password:next}));
    expect(await q("SELECT company_id,role FROM user_companies WHERE user_id=$1",[f.u.id])).toEqual(before);
  });
  it("activates only after proof, encrypts the seed, blocks limited-session bypass and concurrent OTP replay",async()=>{
    const f=await fixture(),e=await enroll(f);
    const s=status(await f.a.get("/api/auth/security"));expect(s.mfaEnabled).toBe(true);
    const [stored]=await q("SELECT totp_secret,pending_secret FROM account_security WHERE user_id=$1",[f.u.id]);
    expect(stored.totp_secret.includes(e.secret)).toBe(false);expect(stored.pending_secret===null).toBe(true);
    const a=await pending(f.u.email!),b=await pending(f.u.email!);
    status(await a.post("/api/auth/switch-company").send({companyId:f.c.id}),401);
    status(await a.post("/api/auth/team-activation/accept").send({token:"x",password}),401);
    status(await a.post("/api/auth/mfa/verify").send({token:e.token}),401);
    const next=accountTotp(e.secret).generate({timestamp:Date.now()+30_000});
    const attempts=await Promise.all([a.post("/api/auth/mfa/verify").send({token:next}),b.post("/api/auth/mfa/verify").send({token:next})]);
    expect(attempts.map(r=>r.status).sort()).toEqual([200,401]);
    const successful=attempts[0].status===200?a:b;status(await successful.get("/api/auth/me"));
    status(await successful.post("/api/auth/security/password").send({currentPassword:password,newPassword:"Another synthetic password phrase 2026!"}),401);
  });
  it("consumes recovery once under concurrency, renews all codes, and keeps receipt recovery limited",async()=>{
    const f=await fixture(),e=await enroll(f),a=await pending(f.u.email!),b=await pending(f.u.email!);
    const r=await Promise.all([a.post("/api/auth/mfa/verify").send({recoveryCode:e.codes[0]}),b.post("/api/auth/mfa/verify").send({recoveryCode:e.codes[0]})]);
    expect(r.map(x=>x.status).sort()).toEqual([200,401]);
    const full=r[0].status===200?a:b;
    const renewed=status(await full.post("/api/auth/security/recovery/renew").send({currentPassword:password,recoveryCode:e.codes[1]}));
    const old=await pending(f.u.email!);status(await old.post("/api/auth/mfa/verify").send({recoveryCode:e.codes[2]}),401);
    status(await old.post("/api/auth/mfa/verify").send({recoveryCode:renewed.recoveryCodes[0]}));
    const receipt=agent();expect(status(await receipt.post("/api/auth/administration/recover").send({email:f.u.email,password})).mfaRequired).toBe(true);
    status(await receipt.get("/api/auth/security"),401);
    expect(status(await receipt.post("/api/auth/mfa/verify").send({recoveryCode:renewed.recoveryCodes[1]})).receiptOnly).toBe(true);
    status(await receipt.get("/api/auth/me"),403);status(await receipt.get("/api/auth/security"),403);
  });
  it("uses an isolated outbox, neutral public responses and single-use reset without disabling the second factor",async()=>{
    const f=await fixture(),e=await enroll(f),oldChallenge=await pending(f.u.email!);
    const known=status(await agent().post("/api/auth/password/forgot").send({email:f.u.email}),202);
    const missing=status(await agent().post("/api/auth/password/forgot").send({email:`missing-${randomUUID()}@example.invalid`}),202);
    expect(known).toEqual(missing);expect(Object.keys(known).sort()).toEqual(["message","ok"]);
    const [oldToken]=readAccountTestOutbox(f.u.email!);
    status(await agent().post("/api/auth/password/forgot").send({email:f.u.email}),202);
    const [token]=readAccountTestOutbox(f.u.email!);expect(token!==oldToken).toBe(true);
    status(await agent().post("/api/auth/password/reset").send({token:oldToken,newPassword:"First synthetic reset phrase 2026!"}),401);
    const candidates=["First synthetic reset phrase 2026!","Second synthetic reset phrase 2026!"];
    const responses=await Promise.all(candidates.map(newPassword=>agent().post("/api/auth/password/reset").send({token,newPassword})));
    expect(responses.map(x=>x.status).sort()).toEqual([200,401]);
    status(await oldChallenge.post("/api/auth/mfa/verify").send({recoveryCode:e.codes[0]}),401);
    const a=agent();expect(status(await a.post("/api/auth/login").send({email:f.u.email,password:candidates[responses[0].status===200?0:1]})).mfaRequired).toBe(true);
    status(await a.get("/api/auth/me"),401);status(await a.post("/api/auth/mfa/verify").send({recoveryCode:e.codes[0]}));
    expect(status(await a.get("/api/auth/security")).mfaEnabled).toBe(true);
    const saved=process.env.NODE_ENV;try{process.env.NODE_ENV="production";expect(()=>readAccountTestOutbox(f.u.email!)).toThrow();}finally{process.env.NODE_ENV=saved;}
  });
  it("enforces expiry and both challenge and account-wide guessing limits",async()=>{
    const f=await fixture(),e=await enroll(f);
    const expired=await pending(f.u.email!);
    await q("UPDATE account_login_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",[f.u.id]);
    status(await expired.post("/api/auth/mfa/verify").send({recoveryCode:e.codes[0]}),401);
    const a=await pending(f.u.email!);
    let bad="000000";while(totpCounter(e.secret,bad)!=null)bad=String(Number(bad)+1).padStart(6,"0");
    for(let i=0;i<5;i++)status(await a.post("/api/auth/mfa/verify").send({token:bad}),401);
    status(await a.post("/api/auth/mfa/verify").send({recoveryCode:e.codes[0]}),401);
    const b=await pending(f.u.email!);status(await b.post("/api/auth/mfa/verify").send({token:bad}),401);
    const c=await pending(f.u.email!);status(await c.post("/api/auth/mfa/verify").send({recoveryCode:e.codes[0]}),401);
    expect((await q("SELECT locked_until>clock_timestamp() AS blocked FROM account_security WHERE user_id=$1",[f.u.id]))[0].blocked).toBe(true);
  });
  it("rejects expired enrollment and replaces a proven factor without retaining old recovery codes",async()=>{
    const f=await fixture();
    const temp=status(await f.a.post("/api/auth/security/totp/start").send({currentPassword:password}));
    await q("UPDATE account_security SET pending_expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",[f.u.id]);
    status(await f.a.post("/api/auth/security/totp/confirm").send({currentPassword:password,token:accountTotp(temp.secret).generate()}),401);
    const e=await enroll(f);
    status(await f.a.post("/api/auth/security/totp/start").send({currentPassword:password}),401);
    const replacement=status(await f.a.post("/api/auth/security/totp/start").send({currentPassword:password,recoveryCode:e.codes[0]}));
    expect(replacement.secret!==e.secret).toBe(true);
    const confirmed=status(await f.a.post("/api/auth/security/totp/confirm").send({currentPassword:password,token:accountTotp(replacement.secret).generate()}));
    const a=await pending(f.u.email!);
    status(await a.post("/api/auth/mfa/verify").send({recoveryCode:e.codes[1]}),401);
    status(await a.post("/api/auth/mfa/verify").send({recoveryCode:confirmed.recoveryCodes[0]}));
    status(await a.post("/api/auth/security/totp/disable").send({currentPassword:password,recoveryCode:confirmed.recoveryCodes[1]}));
    expect(status(await a.get("/api/auth/security")).mfaEnabled).toBe(false);
  });
  it("rechecks memberships after MFA and changes a multi-company identity password without restoring removed authority",async()=>{
    const f=await fixture(),e=await enroll(f);
    const [c2]=await db.insert(companiesTable).values({name:"شركة بديلة مصطنعة"}).returning();
    await db.insert(userCompaniesTable).values({userId:f.u.id,companyId:c2.id,role:"auditor",isDefault:false});
    const a=await pending(f.u.email!);
    await q("DELETE FROM user_companies WHERE user_id=$1 AND company_id=$2",[f.u.id,f.c.id]);
    expect(status(await a.post("/api/auth/mfa/verify").send({recoveryCode:e.codes[0]})).companyId).toBe(c2.id);
    const next="Multi-company independent identity phrase 2026!";
    status(await a.post("/api/auth/security/password").send({currentPassword:password,recoveryCode:e.codes[1],newPassword:next}));
    status(await f.a.get("/api/auth/me"),401);
    const again=agent();expect(status(await again.post("/api/auth/login").send({email:f.u.email,password:next})).mfaRequired).toBe(true);
    status(await again.post("/api/auth/mfa/verify").send({recoveryCode:e.codes[2]}));
    const memberships=await q("SELECT company_id,role FROM user_companies WHERE user_id=$1",[f.u.id]);
    expect(memberships).toEqual([{company_id:c2.id,role:"auditor"}]);
  });
  it("requires fresh proof for sessions and policy, forbids removing a required factor, and preserves other memberships",async()=>{
    const f=await fixture(),other=agent();status(await other.post("/api/auth/login").send({email:f.u.email,password}));
    const e=await enroll(f);status(await other.get("/api/auth/me"),401);
    const b=await pending(f.u.email!);status(await b.post("/api/auth/mfa/verify").send({recoveryCode:e.codes[0]}));
    status(await f.a.post("/api/auth/security/sessions/revoke").send({currentPassword:password}),401);
    status(await f.a.post("/api/auth/security/sessions/revoke").send({currentPassword:password,recoveryCode:e.codes[1]}));
    status(await b.get("/api/auth/me"),401);status(await f.a.get("/api/auth/me"));
    // Companies have the same authority writer trigger as users. A policy
    // change must not upgrade a shared fence while login waits on this user.
    const policyLogin=agent();
    const [policyReply,loginReply]=await Promise.all([
      f.a.post("/api/auth/security/policy").send({currentPassword:password,recoveryCode:e.codes[2],required:true}),
      policyLogin.post("/api/auth/login").send({email:f.u.email,password}),
    ]);
    status(policyReply);expect(status(loginReply).mfaRequired).toBe(true);
    status(await f.a.post("/api/auth/security/totp/disable").send({currentPassword:password,recoveryCode:e.codes[3]}),409);
    const [c2]=await db.insert(companiesTable).values({name:"عضوية أخرى مصطنعة"}).returning();
    await db.insert(userCompaniesTable).values({userId:f.u.id,companyId:c2.id,role:"auditor",isDefault:false});
    const memberships=await q("SELECT company_id,role FROM user_companies WHERE user_id=$1 ORDER BY company_id",[f.u.id]);
    const next=await pending(f.u.email!);status(await next.post("/api/auth/mfa/verify").send({recoveryCode:e.codes[4]}));
    expect(await q("SELECT company_id,role FROM user_companies WHERE user_id=$1 ORDER BY company_id",[f.u.id])).toEqual(memberships);
    const unenrolled=await fixture();await q("UPDATE user_companies SET company_id=$1 WHERE user_id=$2",[f.c.id,unenrolled.u.id]);
    const limited=agent();status(await limited.post("/api/auth/login").send({email:unenrolled.u.email,password}));
    expect(status(await limited.get("/api/auth/me")).mfaEnrollmentRequired).toBe(true);
    status(await limited.get("/api/invoices"),403);status(await limited.get("/api/auth/security"));
  });
});
