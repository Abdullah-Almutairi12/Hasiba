import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { FinancialRequestError } from "../lib/financial-transaction";
import { requireAuth } from "../middlewares/require-auth";
import { requireSameOrigin } from "../middlewares/require-same-origin";
import { getCompanyId } from "../lib/scoped-db";
import { ADMIN_RESPONSIBILITIES } from "../lib/administration-authority";
import { adminRows } from "../lib/administration-authority";
import { appointFirstPrimaryOwner } from "../lib/primary-system-owner";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import rateLimit from "express-rate-limit";
import { verifyAccountPassword } from "../lib/account-password";
import { isPublishedBootstrapPassword } from "../lib/bootstrap-password";
import { HandoverInput, administrationWorkspace, saveHandover, acceptHandover, completeHandover,
  setAdministrator, handoverReceipt, revokeCompanyMember, leaveCompanyMembership } from "../lib/administration-handover";
const wrap=(fn:(req:Request,res:Response)=>Promise<unknown>)=>async(req:Request,res:Response,next:NextFunction)=>{
  try{await fn(req,res);}catch(e){
    if(e instanceof FinancialRequestError){res.status(e.status).json({error:e.message});return;}
    if(e instanceof z.ZodError){res.status(400).json({error:e.issues.map(i=>i.message).join("؛ ")});return;}
    next(e);
  }
};
const id=(req:Request)=>z.string().uuid().parse(req.params.id);
const revision=z.object({expectedRevision:z.number().int().positive()}).strict();
// Receipts and committed replays remain available to the authenticated original
// sender after company-local departure, not dependent on a still-valid membership.
export const administrationReceiptRouter=Router();
const recoveryLimiter=rateLimit({windowMs:15*60*1000,max:10,standardHeaders:true,legacyHeaders:false});
administrationReceiptRouter.post("/auth/administration/recover",recoveryLimiter,requireSameOrigin,wrap(async(req,res)=>{
  const {email,password}=z.object({email:z.string().email(),password:z.string().min(1).max(512)}).strict().parse(req.body);
  const [user]=await adminRows(db,sql`SELECT id,password_hash FROM users WHERE lower(email)=${email.toLowerCase()} AND is_active`);
  if(!user||isPublishedBootstrapPassword(password)||!await verifyAccountPassword(password,user.password_hash))
    throw new FinancialRequestError("تعذر التحقق من بيانات الدخول",401);
  await new Promise<void>((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()));
  // Identity only: no company, membership, functional grant or financial authority.
  req.session.userId=user.id;
  req.session.purpose="administration_receipt";
  await new Promise<void>((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()));
  res.json({userId:user.id});
}));
async function liveIdentity(userId:number) {
  const [user]=await adminRows(db,sql`SELECT id FROM users WHERE id=${userId} AND is_active`);
  if(!user)throw new FinancialRequestError("تعذر التحقق من الهوية",401);
}
administrationReceiptRouter.get("/auth/administration/handovers/:id/receipt",requireAuth,wrap(async(req,res)=>{
  await liveIdentity(req.session.userId!);
  res.json(await handoverReceipt(req.session.userId!,id(req)));
}));
administrationReceiptRouter.post("/auth/administration/handovers/:id/complete",requireAuth,requireSameOrigin,wrap(async(req,res)=>{
  await liveIdentity(req.session.userId!);
  res.json(await completeHandover(req.session.userId!,id(req),revision.parse(req.body).expectedRevision,
    req.session.purpose==="administration_receipt"));
}));
export const administrationRouter=Router();
administrationRouter.post("/administration/membership/leave",wrap(async(req,res)=>{
  const {departure}=z.object({acknowledge:z.literal(true),departure:z.enum(["suspend","terminate"])}).strict().parse(req.body);
  res.json(await leaveCompanyMembership(getCompanyId(req),req.session.userId!,departure));
}));
administrationRouter.post("/administration/owner/appoint",wrap(async(req,res)=>{
  z.object({acknowledge:z.literal(true)}).strict().parse(req.body);
  res.json(await appointFirstPrimaryOwner(getCompanyId(req),req.session.userId!));
}));
administrationRouter.post("/administration/members/:id/access",wrap(async(req,res)=>{
  const {departure}=z.object({departure:z.enum(["suspend","terminate"])}).strict().parse(req.body);
  res.json(await revokeCompanyMember(getCompanyId(req),req.session.userId!,
    z.coerce.number().int().positive().parse(req.params.id),departure));
}));
administrationRouter.get("/administration",wrap(async(req,res)=>{
  res.json(await administrationWorkspace(getCompanyId(req),req.session.userId!));
}));
administrationRouter.put("/administration/handovers",wrap(async(req,res)=>{
  res.json(await saveHandover(getCompanyId(req),req.session.userId!,HandoverInput.parse(req.body)));
}));
administrationRouter.post("/administration/handovers/:id/accept",wrap(async(req,res)=>{
  res.json(await acceptHandover(getCompanyId(req),req.session.userId!,id(req),revision.parse(req.body).expectedRevision));
}));
administrationRouter.patch("/administration/members/:id",wrap(async(req,res)=>{
  const body=z.object({responsibilities:z.array(z.enum(ADMIN_RESPONSIBILITIES)).max(5),active:z.boolean()}).strict().parse(req.body);
  res.json(await setAdministrator(getCompanyId(req),req.session.userId!,z.coerce.number().int().positive().parse(req.params.id),
    body.responsibilities,body.active));
}));
