import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Secret, TOTP } from "otpauth";

function rootKey() {
  const key=process.env.ACCOUNT_MFA_ENCRYPTION_KEY;
  if(!key || !/^[0-9a-f]{64}$/i.test(key)) throw new Error("Account encryption is not configured");
  return Buffer.from(key,"hex");
}
export function accountEncryptionReady() {
  try { rootKey(); return true; } catch { return false; }
}
export const accountDigest=(s:string)=>createHash("sha256").update(s).digest("hex");
export function sealAccountSecret(userId:number,purpose:string,plain:string) {
  const nonce=randomBytes(12),c=createCipheriv("aes-256-gcm",rootKey(),nonce);
  c.setAAD(Buffer.from(`hasiba:account:v1:${userId}:${purpose}`));
  const ciphertext=Buffer.concat([c.update(plain,"utf8"),c.final()]);
  return ["v1",nonce.toString("base64url"),c.getAuthTag().toString("base64url"),ciphertext.toString("base64url")].join(".");
}
export function openAccountSecret(userId:number,purpose:string,envelope:string) {
  const [version,iv,tag,ciphertext,...extra]=envelope.split(".");
  if(version!=="v1" || !iv || !tag || !ciphertext || extra.length)throw new Error("Invalid account envelope");
  const d=createDecipheriv("aes-256-gcm",rootKey(),Buffer.from(iv,"base64url"));
  d.setAAD(Buffer.from(`hasiba:account:v1:${userId}:${purpose}`));d.setAuthTag(Buffer.from(tag,"base64url"));
  return Buffer.concat([d.update(Buffer.from(ciphertext,"base64url")),d.final()]).toString("utf8");
}
export const accountTotp=(secret:string,label="account")=>new TOTP({
  issuer:"Hasiba.AI",label,algorithm:"SHA1",digits:6,period:30,secret:Secret.fromBase32(secret),
});
export function newTotp(email:string) {
  const secret=new Secret({size:20}).base32;
  return {secret,otpauthUri:accountTotp(secret,email).toString()};
}
export function totpCounter(secret:string,token:string,now=Date.now()) {
  if(!/^\d{6}$/.test(token))return null;
  const delta=accountTotp(secret).validate({token,window:1,timestamp:now});
  return delta==null ? null : Math.floor(now/30_000)+delta;
}
