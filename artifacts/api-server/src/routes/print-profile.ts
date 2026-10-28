import { Router, type Request } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { createHash } from "node:crypto";
import { captureIssuer, type IdentityTx } from "../lib/document-identity";
import { FinancialRequestError } from "../lib/financial-transaction";
import { handleRouteError } from "../lib/handle-error";
import { uploadBufferToPrivateObject } from "./storage";
import { returnActor } from "../lib/return-access";
import { normalizePrintLogo } from "../lib/print-logo-validation";
const router = Router();
const text = z.string().trim().max(2000);
export const PrintProfilePatch = z.object({
  revision: z.number().int().min(0),
  nameAr: z.string().trim().min(2).max(120), nameEn: z.string().trim().max(120),
  vatNumber: z.string().trim().max(50), crNumber: z.string().trim().max(50),
  address: z.record(z.string(), z.string().max(500)),
  phone: z.string().trim().max(100), email: z.union([z.literal(""), z.email()]),
  bankName: z.string().trim().max(150), bankIban: z.string().trim().max(60),
  termsAr: text, termsEn: text,
  logoObjectKey: z.string().max(300).nullable(),
  receiptWidths: z.array(z.union([z.literal(80), z.literal(58)])).min(1).max(2),
}).strict();
async function authorize(req: Request, edit = false) {
  const actor = await returnActor(req.session.userId!, req.session.companyId!);
  if (edit && !["owner", "manager"].includes(actor.role)) throw new FinancialRequestError("تعديل هوية المطبوعات للمالك أو المدير", 403);
  return actor;
}
async function state(tx: IdentityTx, companyId: number) {
  const issuer = await captureIssuer(tx, companyId);
  const { rows } = await tx.execute(sql`SELECT address FROM companies WHERE id=${companyId}`);
  return { ...issuer, addressFields: rows[0]?.address ?? {} };
}
router.get("/print/profile", async (req, res) => {
  try {
    const actor = await authorize(req);
    const profile = await state(db, actor.companyId);
    const canEdit = ["owner", "manager"].includes(actor.role);
    const auditRows = canEdit ? (await db.execute(sql`SELECT a.*,u.name AS actor_name
      FROM company_print_profile_audit a JOIN users u ON u.id=a.user_id
      WHERE a.company_id=${actor.companyId} ORDER BY a.id DESC LIMIT 30`)).rows : [];
    const history=auditRows.map(a=>{
      const before=a.before_value as Record<string,unknown>,after=a.after_value as Record<string,unknown>;
      return {id:a.id,createdAt:a.created_at,actorName:a.actor_name,userId:a.user_id,revision:after.revision,before,after,
        changedFields:Object.keys(after).filter(k=>!["capturedAt","revision"].includes(k)&&JSON.stringify(before[k])!==JSON.stringify(after[k]))};
    });
    res.json({ profile, canEdit, history });
  } catch (error) { handleRouteError(error, res); }
});
router.patch("/print/profile", async (req, res) => {
  try {
    const actor = await authorize(req, true), b = PrintProfilePatch.parse(req.body);
    const profile = await db.transaction(async tx => {
      await tx.execute(sql`SELECT id FROM companies WHERE id=${actor.companyId} FOR UPDATE`);
      const before = await state(tx, actor.companyId);
      if (before.revision !== b.revision) throw new FinancialRequestError("تغير الملف في جلسة أخرى؛ أعد تحميله", 409);
      if (before.vatEnabled && !b.vatNumber) throw new FinancialRequestError("الرقم الضريبي مطلوب للشركة المسجلة في الضريبة", 400);
      if (b.logoObjectKey) {
        const logo = await tx.execute(sql`SELECT 1 FROM company_print_logos WHERE object_key=${b.logoObjectKey} AND company_id=${actor.companyId}`);
        if (!logo.rows.length) throw new FinancialRequestError("الشعار ليس مملوكًا للشركة", 400);
      }
      await tx.execute(sql`UPDATE companies SET name=${b.nameAr},name_en=${b.nameEn || null},
        vat_number=${b.vatNumber || null},cr_number=${b.crNumber || null},address=${JSON.stringify(b.address)}::jsonb,updated_at=now()
        WHERE id=${actor.companyId}`);
      const { revision: _, nameAr: _a, nameEn: _e, vatNumber: _v, crNumber: _c, address: _d, ...extras } = b;
      await tx.execute(sql`INSERT INTO company_print_profiles(company_id,revision,profile,updated_by)
        VALUES(${actor.companyId},${b.revision+1},${JSON.stringify(extras)}::jsonb,${actor.userId})
        ON CONFLICT(company_id) DO UPDATE SET revision=excluded.revision,profile=excluded.profile,updated_by=excluded.updated_by,updated_at=now()`);
      const after = await state(tx, actor.companyId);
      await tx.execute(sql`INSERT INTO company_print_profile_audit(company_id,user_id,before_value,after_value)
        VALUES(${actor.companyId},${actor.userId},${JSON.stringify(before)}::jsonb,${JSON.stringify(after)}::jsonb)`);
      return after;
    });
    res.json(profile);
  } catch (error) { handleRouteError(error, res); }
});
router.post("/print/profile/logo", async (req, res) => {
  try {
    const actor = await authorize(req, true);
    const { contentBase64 } = z.object({ contentBase64: z.string().min(4).max(2800000) }).parse(req.body);
    const buffer = await normalizePrintLogo(contentBase64);
    const contentType = "image/png";
    const { objectKey } = await uploadBufferToPrivateObject({ buffer, contentType, ext: "png", folder: `company-print/${actor.companyId}` });
    await db.execute(sql`INSERT INTO company_print_logos(object_key,company_id,digest,content_type)
      VALUES(${objectKey},${actor.companyId},${createHash("sha256").update(buffer).digest("hex")},${contentType})`);
    res.status(201).json({ objectKey });
  } catch (error) { handleRouteError(error, res); }
});
export default router;
