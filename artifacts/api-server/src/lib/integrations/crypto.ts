import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Symmetric encryption helper for connector secrets at rest.
 *
 * Algorithm: AES-256-GCM (authenticated). Output is base64 of
 * `iv (12) || ciphertext || authTag (16)` so the stored value is a
 * single self-contained string.
 *
 * The Key-Encryption-Key (KEK) is derived from SESSION_SECRET via
 * SHA-256. SESSION_SECRET is already required for cookie signing,
 * so adding integrations does not introduce a new mandatory secret.
 *
 * Operators rotating SESSION_SECRET MUST decrypt + re-encrypt all
 * external_credentials.secret_ciphertext before booting with the
 * new value (a maintenance script can do this in bulk).
 */
function getKek(): Buffer {
  const seed = process.env["SESSION_SECRET"];
  if (!seed) {
    throw new Error(
      "SESSION_SECRET is required to encrypt connector credentials",
    );
  }
  return createHash("sha256").update(seed).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKek(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < 12 + 16) {
    throw new Error("ciphertext too short to contain iv + tag");
  }
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", getKek(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Encrypt a JSON-serialisable object as one ciphertext blob. Convenient for
 * adapters that need multiple fields (apiKey + secret + merchantId).
 */
export function encryptJson(obj: Record<string, unknown>): string {
  return encryptSecret(JSON.stringify(obj));
}

export function decryptJson<T = Record<string, unknown>>(payload: string): T {
  return JSON.parse(decryptSecret(payload)) as T;
}
