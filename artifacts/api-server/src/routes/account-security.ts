import {Router,type Request,type Response} from "express";
import {z} from "zod";
import rateLimit from "express-rate-limit";
import {db,usersTable} from "@workspace/db";
import {eq} from "drizzle-orm";
import {requireAuth} from "../middlewares/require-auth";
import {requireSameOrigin} from "../middlewares/require-same-origin";
import {isRole} from "../middlewares/require-role";
import {resolveLoginCompanyId} from "./auth";
import {accountSecurityStatus,changeAccountPassword,changeAccountPolicy,completeAccountChallenge,confirmAccountTotp,
  disableAccountTotp,renewAccountRecovery,revokeOtherSessions,startAccountTotp,regenerate,saveSession,AccountSecurityError} from "../lib/account-security";
import {requestAccountReset,finishAccountReset} from "../lib/account-reset";
import {adminRows} from "../lib/administration-authority";
import {sql} from "drizzle-orm";
const router=Router();
const proof=z.object({currentPassword:z.string().min(1).max(1024),token:z.string().regex(/^\d{6}$/).optional(),
  recoveryCode:z.string().regex(/^[a-fA-F0-9-]{48,60}$/).optional()}).strict();
type Handler=(req:Request,res:Response)=>Promise<unknown>;
const wrap=(fn:Handler)=>async(req:Request,res:Response)=>{
  res.setHeader("Cache-Control","no-store");
  try{await fn(req,res);}catch(e){
    if(e instanceof z.ZodError)return void res.status(400).json({error:"تحقق من الحقول المطلوبة وصيغتها"});
    if(e instanceof AccountSecurityError)return void res.status(e.status).json({error:e.message});
    req.log.error({event:"account.security.failed"},"Account security operation failed");
    res.status(503).json({error:"تعذر إتمام عملية أمان الحساب"});
  }
};
router.use("/auth/security",requireAuth,requireSameOrigin,rateLimit({windowMs:15*60_000,limit:30,
  skip:req=>req.method==="GET",standardHeaders:true,legacyHeaders:false,message:{error:"محاولات كثيرة؛ انتظر قبل المحاولة"}}));
router.get("/auth/security",wrap(async(req,res)=>res.json(await accountSecurityStatus(req))));
router.post("/auth/security/password",wrap(async(req,res)=>{
  const result=await changeAccountPassword(req,proof.extend({newPassword:z.string().max(1024)}).parse(req.body));
  req.session.destroy(()=>{});res.clearCookie("hasba.sid");res.json(result);
}));
router.post("/auth/security/sessions/revoke",wrap(async(req,res)=>res.json(await revokeOtherSessions(req,proof.parse(req.body)))));
router.post("/auth/security/totp/start",wrap(async(req,res)=>res.json(await startAccountTotp(req,proof.parse(req.body)))));
router.post("/auth/security/totp/confirm",wrap(async(req,res)=>res.json(await confirmAccountTotp(req,
  z.object({currentPassword:z.string().min(1).max(1024),token:z.string().regex(/^\d{6}$/)}).strict().parse(req.body)))));
router.post("/auth/security/totp/disable",wrap(async(req,res)=>res.json(await disableAccountTotp(req,proof.parse(req.body)))));
router.post("/auth/security/recovery/renew",wrap(async(req,res)=>res.json(await renewAccountRecovery(req,proof.parse(req.body)))));
router.post("/auth/security/policy",wrap(async(req,res)=>res.json(await changeAccountPolicy(req,proof.extend({required:z.boolean()}).parse(req.body)))));
router.post("/auth/mfa/verify",requireSameOrigin,rateLimit({windowMs:15*60_000,limit:30,standardHeaders:true,legacyHeaders:false}),wrap(async(req,res)=>{
  const body=proof.omit({currentPassword:true}).refine(x=>!!x.token!==!!x.recoveryCode).parse(req.body);
  const result=await completeAccountChallenge(req,body);
  const [user]=await db.select().from(usersTable).where(eq(usersTable.id,result.userId));
  if(result.intent==="receipt"){
    await regenerate(req);Object.assign(req.session,{userId:user.id,authEpoch:result.epoch,purpose:"administration_receipt"});await saveSession(req);
    return res.json({userId:user.id,receiptOnly:true});
  }
  const companyId=await resolveLoginCompanyId(user.id);
  if(!companyId)throw new AccountSecurityError("لا يوجد وصول إلى منشأة؛ لم تستعد عضوية سابقة",403);
  const [m]=await adminRows(db,sql`SELECT role FROM user_companies WHERE user_id=${user.id} AND company_id=${companyId}`);
  if(!m||!isRole(m.role))throw new AccountSecurityError("لا يوجد وصول إلى منشأة",403);
  await regenerate(req);Object.assign(req.session,{userId:user.id,companyId,role:m.role,authEpoch:result.epoch});await saveSession(req);
  return res.json({id:user.id,name:user.name,email:user.email,companyId,role:m.role});
}));
const resetLimiter=rateLimit({windowMs:60*60_000,limit:12,standardHeaders:true,legacyHeaders:false,
  message:{error:"محاولات كثيرة؛ انتظر قبل المحاولة"}});
router.post("/auth/password/forgot",requireSameOrigin,resetLimiter,wrap(async(req,res)=>{
  const {email}=z.object({email:z.string().email().max(254)}).strict().parse(req.body);
  try{await requestAccountReset(email);}catch{req.log.error({event:"account.reset.prepare_failed"},"Account recovery preparation failed");}
  res.status(202).json({ok:true,message:"إذا كان الحساب مؤهلًا وكانت قناة التسليم مهيأة فسيعالج طلب الاستعادة"});
}));
router.post("/auth/password/reset",requireSameOrigin,resetLimiter,wrap(async(req,res)=>{
  const {token,newPassword}=z.object({token:z.string().regex(/^[A-Za-z0-9_-]{43}$/),newPassword:z.string().max(1024)}).strict().parse(req.body);
  const result=await finishAccountReset(token,newPassword);
  req.session.destroy(()=>{});res.clearCookie("hasba.sid");res.json(result);
}));
export default router;
