import { createHash } from "node:crypto";

// Fingerprint of the formerly public seed password, not an application secret.
// Check the submitted password rather than banning demo email addresses: owners
// who have rotated their password must retain access to the same identity.
const publishedSeedFingerprint = "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9";

export function isPublishedBootstrapPassword(password: string): boolean {
  return createHash("sha256").update(password, "utf8").digest("hex") === publishedSeedFingerprint;
}
