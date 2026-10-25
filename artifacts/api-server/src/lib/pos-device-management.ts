import { randomUUID, randomBytes, createPublicKey } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, usersTable, userCompaniesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { teamRows, teamWrite, teamAudit, teamPeople, teamPolicy } from "./team-store";
import { deviceHash } from "./pos-device-crypto";
import { FinancialRequestError } from "./financial-transaction";
import { managedProfile } from "./responsibility-context";

const jwkInput=z.object({kty:z.literal("EC"),crv:z.literal("P-256"),x:z.string().regex(/^[\w-]{43}$/),y:z.string().regex(/^[\w-]{43}$/)}).strict();
export async function registerPosDevice(companyId:number,userId:number,input:unknown) {
  const body=z.object({name:z.string().trim().min(1).max(120),branchId:z.number().int().positive(),
    stationName:z.string().trim().min(1).max(120),publicJwk:jwkInput}).strict().parse(input);
  // Reject invalid curve points before persistence, not just JSON-shaped input.
  createPublicKey({key:body.publicJwk,format:"jwk"});
  return teamWrite(companyId,userId,async tx=>{
    const [branch]=await teamRows(tx,sql`SELECT id FROM branches WHERE id=${body.branchId} AND company_id=${companyId} AND is_active`);
    if(!branch)throw new FinancialRequestError("فرع غير متاح في المنشأة",403);
    const [station]=await teamRows<{id:number}>(tx,sql`
      INSERT INTO pos_device_stations(company_id,branch_id,name) VALUES(${companyId},${body.branchId},${body.stationName})
      ON CONFLICT(company_id,branch_id,name) DO UPDATE SET name=excluded.name RETURNING id`);
    const id=randomUUID(),keyHash=deviceHash(JSON.stringify(body.publicJwk));
    await tx.execute(sql`INSERT INTO pos_devices(id,company_id,branch_id,station_id,name,public_jwk,key_hash,status)
      VALUES(${id},${companyId},${body.branchId},${station.id},${body.name},${JSON.stringify(body.publicJwk)}::jsonb,${keyHash},'registered')`);
    await teamAudit(tx,companyId,userId,"pos.device.register",{deviceId:id,branchId:body.branchId,stationId:station.id,keyHash});
    return {id,keyHash,status:"registered"};
  },"settings");
}
export async function changePosDevice(companyId:number,userId:number,id:string,mode:"activation"|"revoke") {
  return teamWrite(companyId,userId,async tx=>{
    const [row]=await teamRows<{id:string}>(tx,sql`SELECT id FROM pos_devices WHERE id=${id} AND company_id=${companyId} FOR UPDATE`);
    if(!row)throw new FinancialRequestError("الجهاز غير متاح",404);
    const token=mode==="activation"?randomBytes(32).toString("base64url"):null;
    await tx.execute(sql`UPDATE pos_devices SET status=${token?"registered":"revoked"},generation=generation+1,
      activation_hash=${token?deviceHash(token):null},activation_expires_at=${token?new Date(Date.now()+5*60_000):null},
      activation_used_at=NULL,updated_at=now() WHERE id=${id}`);
    await teamAudit(tx,companyId,userId,`pos.device.${mode}`,{deviceId:id});
    return {ok:true,...(token?{activationToken:token,expiresIn:300}:{})};
  },"settings");
}
export async function setPosPin(companyId:number,userId:number,personId:number,pin:string) {
  if(!/^\d{6,10}$/.test(pin)||/^(\d)\1+$/.test(pin))throw new FinancialRequestError("اختر رمزًا من6إلى10أرقام غير متكررة، لا رمزًا مشتركًا افتراضيًا",400);
  const hash=await bcrypt.hash(pin,12);
  return teamWrite(companyId,userId,async tx=>{
    const [person]=await teamPeople(companyId,tx,personId);
    if(!person || !person.loginKinds.includes("pos") || ["suspended","terminated"].includes(person.status))
      throw new FinancialRequestError("الموظف غير متاح لدخول POS",403);
    let identity=person.userId;
    if(!identity) {
      // Activating the already-reserved seat is not creating another device seat.
      const policy=await teamPolicy(companyId,tx);
      if(!policy.enabledModules.includes("pos") || (policy.seatLimit!=null && policy.activeLoginSeats>=policy.seatLimit))
        throw new FinancialRequestError("استحقاق POS أو حد الدخول لا يسمح بالتفعيل",409);
      const [created]=await tx.execute(sql`INSERT INTO users(name,email,password_hash,role,is_active)
        VALUES(${person.name},NULL,NULL,'scoped',true) RETURNING id`).then(r=>r.rows as {id:number}[]);
      identity=created.id;
      await tx.insert(userCompaniesTable).values({userId:identity,companyId,role:"scoped"});
      await tx.execute(sql`UPDATE employees SET user_id=${identity} WHERE id=${personId} AND company_id=${companyId}`);
      await tx.execute(sql`UPDATE employee_access SET user_id=${identity},status='active',revision=revision+1,updated_at=now()
        WHERE employee_id=${personId} AND company_id=${companyId}`);
    }
    // Never convert a primary administrator into a short-code route.
    if(!(await managedProfile(identity,companyId,tx)))throw new FinancialRequestError("الرمز للكاشير المقيد فقط، لا حساب الإدارة",403);
    await tx.execute(sql`INSERT INTO pos_employee_credentials(company_id,employee_id,pin_hash)
      VALUES(${companyId},${personId},${hash}) ON CONFLICT(company_id,employee_id)
      DO UPDATE SET pin_hash=excluded.pin_hash,revision=pos_employee_credentials.revision+1,failures=0,locked_until=NULL`);
    await teamAudit(tx,companyId,userId,"pos.employee.pin.reset",{personId});
    return {ok:true,personId};
  },"users");
}
