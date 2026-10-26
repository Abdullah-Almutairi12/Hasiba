import {Router} from "express";
import {z} from "zod";
import {FinancialRequestError} from "../lib/financial-transaction";
import {readScopedSettings,patchScopedSettings} from "../lib/scoped-app-settings";
const router=Router();
for(const method of ["get","patch"] as const){
 router[method]("/settings",async(req,res)=>{
  try{return res.json(await(method==="get"?readScopedSettings(req):patchScopedSettings(req)));}
  catch(error){
   if(error instanceof FinancialRequestError)return res.status(error.status).json({error:error.message});
   if(error instanceof z.ZodError)return res.status(400).json({error:"بيانات الإعداد أو رقم النسخة غير صحيحة؛ أعد تحميل الإعدادات أولًا"});
   // A driver error may contain bound JSON credentials. Never log it.
   req.log.error({failure:"settings_transaction"},"Scoped app settings failed");
   return res.status(500).json({error:"تعذر إكمال إعدادات المنشأة"});
  }
 });
}
export default router;
