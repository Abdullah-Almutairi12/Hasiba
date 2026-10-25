import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getCompanyId } from "../lib/scoped-db";
import { teamOwner, teamRows, teamAudit } from "../lib/team-store";
import { lockApprovalAuthority, lockApprovalAuthorityWrite } from "../lib/approval-authority";
import { assertPosDeviceAuthority, posDeviceAuthority, type PosDeviceAuthority } from "../lib/pos-device-authority";
import { consumeDeviceProof, deviceBinding, deviceChallenge, deviceHash, getPosDevice } from "../lib/pos-device-crypto";
import { registerPosDevice, changePosDevice, setPosPin } from "../lib/pos-device-management";
import { currentResponsibilities } from "../lib/responsibility-context";
import { requireSameOrigin } from "../middlewares/require-same-origin";
import { FinancialRequestError } from "../lib/financial-transaction";
import { requireAdministrative } from "../lib/administration-authority";

export const posDevicePublicRouter = Router();
export const posDeviceAdminRouter = Router();
const wrapped=(fn:(req:Request,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:NextFunction)=>{
  fn(req,res).catch(error=>{
    if(error instanceof FinancialRequestError){res.status(error.status).json({error:error.message});return;}
    if(error instanceof z.ZodError){res.status(400).json({error:"مدخلات الجهاز غير صالحة"});return;}
    next(error);
  });
};
const proofSchema=z.object({id:z.string().uuid(),nonce:z.string().min(20).max(100),signature:z.string().min(60).max(200)});
const requestProofSchema=z.object({deviceId:z.string().uuid(),proof:proofSchema});
const limiter=rateLimit({windowMs:60_000,max:120,standardHeaders:true,legacyHeaders:false,
  message:{error:"طلبات كثيرة، انتظر قليلًا"}});
posDevicePublicRouter.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
posDevicePublicRouter.use("/pos-device",limiter,requireSameOrigin);
posDevicePublicRouter.post("/pos-device/challenge",wrapped(async(req,res)=>{
  const b=z.object({deviceId:z.string().uuid(),purpose:z.enum(["activate","unlock","request"]),binding:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(req.body);
  res.json(await deviceChallenge(b.deviceId,b.purpose,b.binding));
}));
posDevicePublicRouter.post("/pos-device/activate",wrapped(async(req,res)=>{
  const b=requestProofSchema.extend({token:z.string().min(30).max(100)}).strict().parse(req.body);
  await db.transaction(async tx=>{
    await lockApprovalAuthorityWrite(tx);
    const d=await getPosDevice(tx,b.deviceId,true);
    await consumeDeviceProof(tx,d,"activate",deviceBinding("POST","/api/pos-device/activate",{token:b.token}),b.proof);
    const changed=await tx.execute(sql`UPDATE pos_devices SET status='active',activation_used_at=clock_timestamp(),
      activation_hash=NULL,updated_at=now() WHERE id=${d.id} AND status='registered'
      AND activation_hash=${deviceHash(b.token)} AND activation_used_at IS NULL AND activation_expires_at>clock_timestamp() RETURNING id`);
    if(!changed.rows.length)throw new FinancialRequestError("تفعيل منتهي أو ملغى أو مستخدم أو لغرض آخر",403);
    // Device activation has no employee actor; never invent an admin identity.
    await tx.execute(sql`INSERT INTO audit_logs(company_id,user_name,entity,action,details)
      VALUES(${d.company_id},'جهاز POS موثق','employee_access','pos.device.activated',${JSON.stringify({deviceId:d.id,generation:d.generation})})`);
  });
  res.json({ok:true,status:"active"});
}));
const dummyPinHash=bcrypt.hash(randomBytes(32).toString("hex"),12);
posDevicePublicRouter.post("/pos-device/unlock",wrapped(async(req,res)=>{
  const b=requestProofSchema.extend({personId:z.number().int().positive(),pin:z.string().regex(/^\d{6,10}$/)}).strict().parse(req.body);
  const result=await db.transaction(async tx=>{
    await lockApprovalAuthority(tx);
    const d=await getPosDevice(tx,b.deviceId,true);
    if(d.status!=="active")throw new FinancialRequestError("الجهاز غير مفعل",403);
    await consumeDeviceProof(tx,d,"unlock",deviceBinding("POST","/api/pos-device/unlock",{personId:b.personId,pin:b.pin}),b.proof);
    const [p]=await teamRows<{pin_hash:string;revision:number;failures:number;blocked:boolean;user_id:number}>(tx,sql`
      SELECT p.*, (p.locked_until>clock_timestamp()) AS blocked,a.user_id
      FROM pos_employee_credentials p JOIN employee_access a ON a.employee_id=p.employee_id AND a.company_id=p.company_id
      WHERE p.employee_id=${b.personId} AND p.company_id=${d.company_id} FOR UPDATE OF p`);
    const valid=await bcrypt.compare(b.pin,p?.pin_hash??await dummyPinHash);
    if(!p || p.blocked || !valid) {
      if(p && !p.blocked)await tx.execute(sql`UPDATE pos_employee_credentials SET
        failures=CASE WHEN locked_until<=now() THEN 1 ELSE failures+1 END,
        locked_until=CASE WHEN failures>=4 AND (locked_until IS NULL OR locked_until>now())
          THEN now()+interval '15 minutes' ELSE NULL END
        WHERE company_id=${d.company_id} AND employee_id=${b.personId}`);
      return {error:true as const};
    }
    const context:PosDeviceAuthority={deviceId:d.id,generation:d.generation,companyId:d.company_id,
      branchId:d.branch_id,stationId:d.station_id,userId:p.user_id,personId:b.personId,pinRevision:p.revision};
    await assertPosDeviceAuthority(tx,context);
    const grants=await posDeviceAuthority.run(context,()=>currentResponsibilities(p.user_id,d.company_id,tx));
    if(!grants.some(g=>g.actions.includes("pos.read")))throw new FinancialRequestError("لا مسؤولية POS فعالة لهذا الفرع",403);
    await tx.execute(sql`UPDATE pos_employee_credentials SET failures=0,locked_until=NULL WHERE company_id=${d.company_id} AND employee_id=${b.personId}`);
    await teamAudit(tx,d.company_id,p.user_id,"pos.employee.unlock",{deviceId:d.id,personId:b.personId});
    return {context};
  });
  if("error" in result){res.status(403).json({error:"تعذر فتح الكاشير بهذه البيانات أو تجاوزت المحاولات؛ لا تغير رمزًا عشوائيًا"});return;}
  await new Promise<void>((resolve,reject)=>req.session.regenerate(error=>error?reject(error):resolve()));
  req.session.purpose="pos_device";req.session.posDevice=result.context;
  req.session.userId=result.context.userId;req.session.companyId=result.context.companyId;req.session.role="scoped";
  req.session.cookie.maxAge=8*60*60_000;
  await new Promise<void>((resolve,reject)=>req.session.save(error=>error?reject(error):resolve()));
  res.json({ok:true,personId:result.context.personId});
}));
// Narrow DTO: no cross-company roster, global identity settings or platform role.
posDevicePublicRouter.get("/auth/me",wrapped(async(req,res)=>{
  if(req.session.purpose!=="pos_device"){res.status(404).json({error:"not POS"});return;}
  const c=req.session.posDevice!;
  const [row]=await teamRows<{name:string;businessType:string|null}>(db,sql`SELECT u.name,c.business_type AS "businessType"
    FROM users u JOIN companies c ON c.id=${c.companyId} WHERE u.id=${c.userId}`);
  res.json({id:c.userId,name:row.name,email:null,role:"scoped",branchId:c.branchId,preferredBranchId:c.branchId,
    avatarUrl:null,companyId:c.companyId,businessType:row.businessType,companies:[],posDevice:true});
}));

posDeviceAdminRouter.get("/pos-devices",wrapped(async(req,res)=>{
  const company=getCompanyId(req);await requireAdministrative(company,req.session.userId!,"settings");
  res.json(await teamRows(db,sql`SELECT d.id,d.name,d.branch_id AS "branchId",d.station_id AS "stationId",
    s.name AS "stationName",d.status,d.generation,d.key_hash AS "keyHash",d.activation_expires_at AS "activationExpiresAt",
    coalesce((SELECT jsonb_agg(h ORDER BY h."createdAt" DESC) FROM (
      SELECT a.action,a.user_name AS actor,a.created_at AS "createdAt" FROM audit_logs a
      WHERE a.company_id=d.company_id AND a.entity='employee_access' AND a.action LIKE 'pos.device.%'
        AND a.details LIKE ${'%"deviceId":"'}||d.id::text||${'"%'}
      ORDER BY a.created_at DESC LIMIT 20
    ) h),'[]'::jsonb) AS history
    FROM pos_devices d JOIN pos_device_stations s ON s.id=d.station_id WHERE d.company_id=${company} ORDER BY d.created_at`));
}));
posDeviceAdminRouter.post("/pos-devices",wrapped(async(req,res)=>{
  res.status(201).json(await registerPosDevice(getCompanyId(req),req.session.userId!,req.body));
}));
for(const mode of ["activation","revoke"] as const) {
  posDeviceAdminRouter.post(`/pos-devices/:id/${mode}`,wrapped(async(req,res)=>{
    res.json(await changePosDevice(getCompanyId(req),req.session.userId!,z.string().uuid().parse(req.params.id),mode));
  }));
}
posDeviceAdminRouter.post("/pos-devices/employees/:id/pin",wrapped(async(req,res)=>{
  const {pin}=z.object({pin:z.string()}).strict().parse(req.body);
  res.json(await setPosPin(getCompanyId(req),req.session.userId!,z.coerce.number().int().positive().parse(req.params.id),pin));
}));
