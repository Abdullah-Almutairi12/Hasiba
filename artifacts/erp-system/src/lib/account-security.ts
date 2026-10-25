import type { AccountSecurityProof } from "@workspace/api-client-react";

/** Shared minimum for every new identity password (change, reset, initial). */
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 1024;

/** Counts Unicode code points (not UTF-16 units). Server remains authoritative. */
export const codePointLength = (s: string) => Array.from(s).length;

export const TOTP_RE = /^\d{6}$/;
export const RECOVERY_RE = /^[0-9a-fA-F]{48}$/;

export type FactorMode = "totp" | "recovery";

/** Normalises a recovery code typed with spaces/dashes into 48 hex chars. */
export function normalizeRecovery(v: string): string {
  return v.replace(/[\s-]/g, "").toLowerCase();
}

export function factorValid(mode: FactorMode, value: string): boolean {
  return mode === "totp" ? TOTP_RE.test(value) : RECOVERY_RE.test(normalizeRecovery(value));
}

/** Builds a proof. The factor is only attached when the account has one. */
export function buildProof(currentPassword: string, mfaEnabled: boolean, mode: FactorMode, factor: string): AccountSecurityProof {
  if (!mfaEnabled) return { currentPassword };
  return mode === "totp" ? { currentPassword, token: factor } : { currentPassword, recoveryCode: normalizeRecovery(factor) };
}

export function proofReady(currentPassword: string, mfaEnabled: boolean, mode: FactorMode, factor: string): boolean {
  return currentPassword.length > 0 && (!mfaEnabled || factorValid(mode, factor));
}

export function passwordProblem(pw: string, confirm: string): string | null {
  const n = codePointLength(pw);
  if (n > PASSWORD_MAX_LENGTH) return `كلمة المرور يجب ألا تتجاوز ${PASSWORD_MAX_LENGTH} حرفًا.`;
  if (n < PASSWORD_MIN_LENGTH) return `كلمة المرور الجديدة يجب ألا تقل عن ${PASSWORD_MIN_LENGTH} حرفًا.`;
  if (pw !== confirm) return "تأكيد كلمة المرور غير مطابق.";
  return null;
}
