import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import {isPublishedBootstrapPassword} from "./bootstrap-password";

const PREFIX = "sha256-bcrypt:";
const prehash = (password: string) => createHash("sha256").update(password, "utf8").digest("base64");
export function newAccountPasswordError(password: string) {
  if(isPublishedBootstrapPassword(password))return "اختر عبارة مرور غير منشورة";
  if ([...password].length < 15 || password.length > 1024) return "اختر عبارة مرور من 15 محرفًا على الأقل وبحد أقصى 1024";
  const common = new Set(["passwordpassword", "123456789012345", "qwertyuiopasdfgh", "abcdefghijklmnop", "administrator123"]);
  if (common.has(password.toLowerCase()) || /^([\s\S])\1+$/u.test(password)) return "عبارة المرور شائعة أو سهلة التخمين";
  return null;
}
export async function hashAccountPassword(password: string) {
  // Versioned prehash avoids bcrypt's silent 72-byte truncation for long
  // Arabic phrases. Existing bcrypt credentials remain verifiable.
  return PREFIX + await bcrypt.hash(prehash(password), 12);
}
export async function verifyAccountPassword(password: string, hash: string) {
  return hash.startsWith(PREFIX) ? bcrypt.compare(prehash(password), hash.slice(PREFIX.length)) : bcrypt.compare(password, hash);
}
