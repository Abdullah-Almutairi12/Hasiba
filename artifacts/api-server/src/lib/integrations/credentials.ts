import { db, externalCredentialsTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { decryptJson, encryptJson } from "./crypto";

export type CredentialPayload = Record<string, unknown>;

export interface ResolvedCredential<T extends CredentialPayload = CredentialPayload> {
  id: number;
  provider: string;
  environment: "sandbox" | "production";
  branchId: number | null;
  label: string | null;
  secret: T;
}

/**
 * Look up the active credential for a given (branch, provider, label?)
 * combination. Falls back to a global (branch_id IS NULL) credential
 * if no branch-scoped row exists, which is convenient for the
 * single-tenant deployments shipping today.
 */
export async function getCredential<T extends CredentialPayload = CredentialPayload>(
  provider: string,
  options: { branchId?: number | null; label?: string | null } = {},
): Promise<ResolvedCredential<T> | null> {
  const branchId = options.branchId ?? null;
  const label = options.label ?? null;

  const rows = await db
    .select()
    .from(externalCredentialsTable)
    .where(
      and(
        eq(externalCredentialsTable.provider, provider),
        eq(externalCredentialsTable.isActive, true),
        branchId === null
          ? isNull(externalCredentialsTable.branchId)
          : eq(externalCredentialsTable.branchId, branchId),
        label === null
          ? isNull(externalCredentialsTable.label)
          : eq(externalCredentialsTable.label, label),
      ),
    )
    .limit(1);

  let row = rows[0];

  // Fallback to branch-agnostic credential when none is branch-scoped.
  if (!row && branchId !== null) {
    const fallback = await db
      .select()
      .from(externalCredentialsTable)
      .where(
        and(
          eq(externalCredentialsTable.provider, provider),
          eq(externalCredentialsTable.isActive, true),
          isNull(externalCredentialsTable.branchId),
        ),
      )
      .limit(1);
    row = fallback[0];
  }

  if (!row) return null;

  let secret: T;
  try {
    secret = decryptJson<T>(row.secretCiphertext);
  } catch {
    // Corrupt or rotated secret — treat as missing so adapter raises
    // a clear "credentials not configured" error to the caller.
    return null;
  }

  return {
    id: row.id,
    provider: row.provider,
    environment: row.environment === "production" ? "production" : "sandbox",
    branchId: row.branchId,
    label: row.label,
    secret,
  };
}

export async function upsertCredential(args: {
  provider: string;
  branchId?: number | null;
  label?: string | null;
  environment: "sandbox" | "production";
  secret: CredentialPayload;
}): Promise<{ id: number }> {
  const branchId = args.branchId ?? null;
  const label = args.label ?? null;
  const ciphertext = encryptJson(args.secret);

  const existing = await db
    .select({ id: externalCredentialsTable.id })
    .from(externalCredentialsTable)
    .where(
      and(
        eq(externalCredentialsTable.provider, args.provider),
        branchId === null
          ? isNull(externalCredentialsTable.branchId)
          : eq(externalCredentialsTable.branchId, branchId),
        label === null
          ? isNull(externalCredentialsTable.label)
          : eq(externalCredentialsTable.label, label),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(externalCredentialsTable)
      .set({
        secretCiphertext: ciphertext,
        environment: args.environment,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(externalCredentialsTable.id, existing[0].id));
    return { id: existing[0].id };
  }

  const [created] = await db
    .insert(externalCredentialsTable)
    .values({
      provider: args.provider,
      branchId,
      label,
      environment: args.environment,
      secretCiphertext: ciphertext,
    })
    .returning({ id: externalCredentialsTable.id });
  return { id: created!.id };
}

export class MissingCredentialError extends Error {
  constructor(provider: string) {
    super(`لم يتم إعداد بيانات اعتماد المزود "${provider}". يرجى إكمال الإعداد من شاشة التكاملات.`);
    this.name = "MissingCredentialError";
  }
}
