import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { FinancialRequestError } from "../lib/financial-transaction";
import { requireAuth } from "../middlewares/require-auth";
import { requireSameOrigin } from "../middlewares/require-same-origin";
import { getCompanyId } from "../lib/scoped-db";
import { ADMIN_RESPONSIBILITIES } from "../lib/administration-authority";
import { HandoverInput, administrationWorkspace, saveHandover, acceptHandover, completeHandover,
  setAdministrator, handoverReceipt } from "../lib/administration-handover";
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
administrationReceiptRouter.get("/auth/administration/handovers/:id/receipt",requireAuth,wrap(async(req,res)=>{
  res.json(await handoverReceipt(req.session.userId!,id(req)));
}));
administrationReceiptRouter.post("/auth/administration/handovers/:id/complete",requireAuth,requireSameOrigin,wrap(async(req,res)=>{
  res.json(await completeHandover(req.session.userId!,id(req),revision.parse(req.body).expectedRevision));
}));
export const administrationRouter=Router();
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
