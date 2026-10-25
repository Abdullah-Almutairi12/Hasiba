import {describe,it,expect} from "vitest";
import {randomBytes} from "node:crypto";
import {accountEncryptionReady,openAccountSecret,sealAccountSecret} from "./account-crypto";
describe("account encryption boundaries",()=>{
  it("binds authenticated envelopes to identity, purpose and version",()=>{
    const secret=randomBytes(20).toString("hex"),sealed=sealAccountSecret(11,"active",secret);
    expect(openAccountSecret(11,"active",sealed)===secret).toBe(true);
    expect(sealed.includes(secret)).toBe(false);
    expect(()=>openAccountSecret(12,"active",sealed)).toThrow();
    expect(()=>openAccountSecret(11,"pending",sealed)).toThrow();
    expect(()=>openAccountSecret(11,"active",sealed.replace("v1.","v2."))).toThrow();
    const parts=sealed.split(".");parts[2]=Buffer.alloc(16).toString("base64url");
    expect(()=>openAccountSecret(11,"active",parts.join("."))).toThrow();
  });
  it("fails closed without a dedicated valid key, never uses the session secret",()=>{
    if(process.env.ACCOUNT_ISOLATED_TEST!=="true")throw new Error("Disposable isolated configuration only");
    const saved=process.env.ACCOUNT_MFA_ENCRYPTION_KEY;
    try {
      delete process.env.ACCOUNT_MFA_ENCRYPTION_KEY;expect(accountEncryptionReady()).toBe(false);
      expect(()=>sealAccountSecret(1,"active","synthetic")).toThrow();
      process.env.ACCOUNT_MFA_ENCRYPTION_KEY="malformed";expect(accountEncryptionReady()).toBe(false);
    }finally{process.env.ACCOUNT_MFA_ENCRYPTION_KEY=saved;}
  });
});
