import { createHash, createPublicKey, verify, randomBytes, randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { teamRows } from "./team-store";
import type { DbOrTx } from "./journal-posting";
import { FinancialRequestError } from "./financial-transaction";

export const deviceHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const deviceBinding = (method: string, path: string, body: unknown) =>
  deviceHash(`${method.toUpperCase()}:${path}:${JSON.stringify(body ?? {})}`);
export type DeviceRow = { id: string; company_id: number; branch_id: number; generation: number;
  public_jwk: { kty: string; crv: string; x: string; y: string }; status: string };
export async function getPosDevice(connection: DbOrTx, id: string, lock = false) {
  const [row] = await teamRows<DeviceRow>(connection, sql`SELECT * FROM pos_devices WHERE id=${id}
    ${lock ? sql`FOR UPDATE` : sql``}`);
  if (!row) throw new FinancialRequestError("تعذر التحقق من الجهاز", 403);
  return row;
}
export async function deviceChallenge(deviceId: string, purpose: string, binding: string) {
  return db.transaction(async tx => {
    const d = await getPosDevice(tx, deviceId);
    if ((purpose === "activate" && d.status !== "registered") || (purpose !== "activate" && d.status !== "active")) {
      throw new FinancialRequestError("الجهاز غير متاح لهذا الغرض", 403);
    }
    const id = randomUUID(), nonce = randomBytes(32).toString("base64url");
    await tx.execute(sql`DELETE FROM pos_device_challenges WHERE expires_at<now()-interval '1 hour'`);
    await tx.execute(sql`INSERT INTO pos_device_challenges(id,device_id,generation,purpose,binding,nonce_hash,expires_at)
      VALUES(${id},${deviceId},${d.generation},${purpose},${binding},${deviceHash(nonce)},now()+interval '60 seconds')`);
    return { id, nonce, payload: `${id}.${nonce}.${purpose}.${binding}`, expiresIn: 60 };
  });
}
/** ECDSA P-256 / SHA-256, IEEE-P1363 signature (WebCrypto's native format). */
export async function consumeDeviceProof(tx: DbOrTx, d: DeviceRow, purpose: string, binding: string,
  proof: { id: string; nonce: string; signature: string }) {
  const [challenge] = await teamRows<{purpose:string;binding:string;nonce_hash:string}>(tx,sql`
    SELECT purpose,binding,nonce_hash FROM pos_device_challenges
    WHERE id=${proof.id} AND device_id=${d.id} AND generation=${d.generation}
      AND used_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`);
  if (!challenge || challenge.purpose !== purpose || challenge.binding !== binding ||
      challenge.nonce_hash !== deviceHash(proof.nonce)) throw new FinancialRequestError("تحدي جهاز غير صالح أو منتهي أو مستخدم", 403);
  let valid = false;
  try {
    const key = createPublicKey({ key: d.public_jwk, format: "jwk" });
    valid = verify("sha256", Buffer.from(`${proof.id}.${proof.nonce}.${purpose}.${binding}`),
      {key,dsaEncoding:"ieee-p1363"}, Buffer.from(proof.signature, "base64url"));
  } catch { /* Refuse malformed key/signature, without logging credentials. */ }
  if (!valid) throw new FinancialRequestError("لم تثبت حيازة مفتاح الجهاز المسجل", 403);
  await tx.execute(sql`UPDATE pos_device_challenges SET used_at=clock_timestamp() WHERE id=${proof.id}`);
}
