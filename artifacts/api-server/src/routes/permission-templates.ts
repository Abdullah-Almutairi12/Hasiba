import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { getCompanyId } from "../lib/scoped-db";
import { FinancialRequestError } from "../lib/financial-transaction";
import { PermissionTemplateInput, PermissionTemplateEdit, PermissionTemplateApply,
  listPermissionTemplates,createPermissionTemplate,previewPermissionTemplate,applyPermissionTemplate } from "../lib/permission-templates";
const router=Router();
const wrap=(fn:(r:Request,s:Response)=>Promise<unknown>)=>async(req:Request,res:Response,next:NextFunction)=>{
  try{await fn(req,res);}catch(e){
    if(e instanceof FinancialRequestError)return void res.status(e.status).json({error:e.message});
    if(e instanceof z.ZodError)return void res.status(400).json({error:e.issues.map(i=>i.message).join("؛ ")});
    next(e);
  }
};
const id=(req:Request)=>z.coerce.number().int().positive().parse(req.params.id);
router.get("/team/templates",wrap(async(req,res)=>res.json(await listPermissionTemplates(getCompanyId(req),req.session.userId!))));
router.post("/team/templates",wrap(async(req,res)=>res.status(201).json(await createPermissionTemplate(getCompanyId(req),req.session.userId!,PermissionTemplateInput.parse(req.body)))));
router.post("/team/templates/:id/preview",wrap(async(req,res)=>res.json(await previewPermissionTemplate(getCompanyId(req),req.session.userId!,id(req),PermissionTemplateEdit.parse(req.body)))));
router.put("/team/templates/:id",wrap(async(req,res)=>res.json(await applyPermissionTemplate(getCompanyId(req),req.session.userId!,id(req),PermissionTemplateApply.parse(req.body)))));
export default router;
