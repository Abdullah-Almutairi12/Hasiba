import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { z } from "zod";
import { lockApprovalAuthority } from "../lib/approval-authority";
import { assertPosDeviceAuthority, posDeviceAuthority } from "../lib/pos-device-authority";
import { consumeDeviceProof, deviceBinding, getPosDevice } from "../lib/pos-device-crypto";
import { requireSameOrigin } from "./require-same-origin";

const proofInput = z.object({id:z.string().uuid(),nonce:z.string().min(20).max(100),signature:z.string().min(60).max(200)});
export async function posDeviceSessionGate(req: Request,res: Response,next: NextFunction): Promise<void> {
  if(req.session.purpose!=="pos_device") { next(); return; }
  if(["/pos-device/challenge","/pos-device/activate","/pos-device/unlock"].includes(req.path)) { next(); return; }
  // Lock/logout remain available even when the device is revoked, but reveal no data.
  if(req.method==="POST" && (req.path==="/auth/logout" || req.path==="/pos-device/lock")) {
    requireSameOrigin(req,res,()=>req.session.destroy(()=>res.json({ok:true}))); return;
  }
  const allowed = req.method==="GET"
    ? /^\/(?:auth\/me|workspace\/access|branches|warehouses|products(?:\/categories)?|categories|sales\/sellers\/workspace|print\/profile|pos(?:\/.*)?)$/.test(req.path)
    : req.method==="POST" && ["/pos/orders","/pos/sessions"].includes(req.path);
  const context=req.session.posDevice;
  if(!allowed || !context || context.userId!==req.session.userId || context.companyId!==req.session.companyId) {
    res.status(403).json({error:"جلسة جهاز الكاشير لا تجيز دخول المنصة أو تغيير المنشأة أو إدارة الحساب"}); return;
  }
  try {
    const proof=proofInput.parse(JSON.parse(Buffer.from(req.get("X-POS-Proof")??"", "base64url").toString()));
    await db.transaction(async tx=>{
      await lockApprovalAuthority(tx);
      await assertPosDeviceAuthority(tx,context);
      const d=await getPosDevice(tx,context.deviceId);
      await consumeDeviceProof(tx,d,"request",deviceBinding(req.method,req.originalUrl,req.body),proof);
    });
    // AsyncLocalStorage survives route transactions; the authority fence rechecks
    // device generation and PIN revision immediately before an effect/replay.
    posDeviceAuthority.run(context,()=>next());
  } catch {
    res.status(403).json({error:"يلزم جهاز معتمد وإثبات حيازة حديث وعضوية كاشير فعالة"});
  }
}
