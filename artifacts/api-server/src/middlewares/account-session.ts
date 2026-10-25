import type {Request,Response,NextFunction} from "express";
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";
import {accountEpoch,accountRows} from "../lib/account-security";

export async function accountSessionGate(req:Request,res:Response,next:NextFunction) {
  try {
    if(req.session.purpose==="pos_device")return next();
    if(req.session.mfaChallenge) {
      if(req.method==="POST"&&["/auth/mfa/verify","/auth/logout","/auth/login","/auth/administration/recover"].includes(req.path))return next();
      return void res.status(401).json({error:"يلزم استيفاء العامل الثاني قبل استخدام الحساب",mfaRequired:true});
    }
    if(!req.session.userId||["/auth/login","/auth/logout","/auth/password/forgot","/auth/password/reset"].includes(req.path))return next();
    const a=await accountEpoch(req.session.userId);
    if(!a?.is_active||Number(a.epoch)!==(req.session.authEpoch??0)){
      req.session.destroy(()=>{});res.clearCookie("hasba.sid");
      return void res.status(401).json({error:"انتهت صلاحية الجلسة؛ سجل الدخول مجددًا"});
    }
    if(req.session.purpose!=="administration_receipt"&&req.session.companyId&&!a.enabled) {
      const [c]=await accountRows(db,sql`SELECT account_mfa_required FROM companies WHERE id=${req.session.companyId}`);
      if(c?.account_mfa_required&&!req.path.startsWith("/auth/security")&&!["/auth/me","/auth/logout","/auth/switch-company"].includes(req.path))
        return void res.status(403).json({error:"سياسة المنشأة تتطلب تفعيل تطبيق المصادقة أولًا",mfaEnrollmentRequired:true});
    }
    next();
  }catch{res.status(503).json({error:"تعذر التحقق من أمان الجلسة؛ لم يمنح وصول تشغيلي"});}
}
