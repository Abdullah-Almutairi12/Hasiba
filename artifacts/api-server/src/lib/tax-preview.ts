import {createHash,createHmac,timingSafeEqual} from "node:crypto";
import type {Request} from "express";
import {canonical,FinancialRequestError} from "./financial-transaction";
import {getCompanyId} from "./scoped-db";
import {responsibilityContext} from "./responsibility-context";

const lifetimeMs=5*60*1000;
function signature(payload:string){
  const root=process.env.SESSION_SECRET;
  if(!root)throw new Error("SESSION_SECRET is required for tax preview attestation");
  // Purpose-separated signing key, never a public checksum or MFA encryption key.
  const key=createHmac("sha256",root).update("hasiba/tax-preview/signing/v1").digest();
  return createHmac("sha256",key).update(payload).digest();
}
function fingerprint(req:Request,kind:"pos"|"invoice",facts:unknown){
  return createHash("sha256").update(canonical({
    kind,session:req.sessionID,userId:req.session.userId,
    companyId:getCompanyId(req),grantId:responsibilityContext.getStore()?.grantId??null,facts,
  })).digest("hex");
}
export function issueTaxPreview(req:Request,kind:"pos"|"invoice",facts:unknown,now=Date.now()){
  const expiresAt=now+lifetimeMs;
  const payload=Buffer.from(JSON.stringify({v:1,expiresAt,hash:fingerprint(req,kind,facts)})).toString("base64url");
  return {previewToken:payload+"."+signature(payload).toString("base64url"),expiresAt:new Date(expiresAt).toISOString()};
}
export function verifyTaxPreview(req:Request,kind:"pos"|"invoice",token:unknown,facts:unknown,now=Date.now()){
  const invalid=()=>new FinancialRequestError("انتهت المعاينة أو تغيرت الحقائق؛ راجع الحساب الجديد وأكده قبل بدء محاولة جديدة",409);
  if(typeof token!=="string"||token.length>2048)throw invalid();
  const parts=token.split(".");
  if(parts.length!==2)throw invalid();
  const [payload,mac]=parts as [string,string];
  const actual=Buffer.from(mac,"base64url"),expected=signature(payload);
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw invalid();
  let value:{v?:unknown;expiresAt?:unknown;hash?:unknown};
  try{value=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));}catch{throw invalid();}
  if(value.v!==1||typeof value.expiresAt!=="number"||value.expiresAt<=now||
    value.expiresAt>now+lifetimeMs||value.hash!==fingerprint(req,kind,facts))throw invalid();
}
