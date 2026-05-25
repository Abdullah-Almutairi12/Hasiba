/**
 * Task 150 — single-use signed action tokens embedded in the morning
 * intercompany imbalance digest.
 *
 * For every (recipient user, open imbalance row, action) we mint an
 * opaque 32-byte token, hash it with sha256, and insert one row into
 * `intercompany_imbalance_action_tokens`. The plain token is included
 * in the email URL; the consumer endpoint (`/intercompany/email-action`)
 * looks it up by hash, enforces single-use + expiry, revalidates the
 * recipient's finance access to both sides of the imbalance at click
 * time, then performs `resync` or `ignore`. The audit row stamped on
 * success tags the action with `via=email` so the trail is honest about
 * how the change was originated.
 */

import { createHash, randomBytes } from "crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  intercompanyImbalanceActionTokensTable,
  intercompanyImbalancesTable,
  intercompanyLinksTable,
  userCompaniesTable,
  usersTable,
} from "@workspace/db";

export const EMAIL_ACTIONS = ["resync", "ignore"] as const;
export type EmailAction = (typeof EMAIL_ACTIONS)[number];

/** 7 days — enough that finance can act on the weekend digest. */
export const EMAIL_ACTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const FINANCE_ROLES = ["owner", "manager", "accountant"];

export function hashEmailActionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface MintedEmailAction {
  action: EmailAction;
  token: string;
  url: string;
}

/**
 * Mint a fresh single-use action token and persist its hash. Returns
 * the plain token + the deep-link URL to embed in the digest email.
 * Throws if the DB insert fails — callers must wrap in try/catch so a
 * token mint failure never aborts the digest send for the rest of the
 * recipients.
 */
export async function mintEmailActionToken(input: {
  imbalanceId: number;
  userId: number;
  email: string;
  action: EmailAction;
  baseUrl: string;
  ttlMs?: number;
}): Promise<MintedEmailAction> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashEmailActionToken(token);
  const expiresAt = new Date(Date.now() + (input.ttlMs ?? EMAIL_ACTION_TTL_MS));
  await db.insert(intercompanyImbalanceActionTokensTable).values({
    tokenHash,
    imbalanceId: input.imbalanceId,
    userId: input.userId,
    email: input.email.toLowerCase(),
    action: input.action,
    expiresAt,
  });
  const base = input.baseUrl.replace(/\/$/, "");
  const url =
    `${base}/intercompany/email-action` +
    `?token=${encodeURIComponent(token)}` +
    `&imbalance=${input.imbalanceId}` +
    `&action=${input.action}`;
  return { action: input.action, token, url };
}

export interface ResolvedEmailAction {
  tokenRowId: number;
  imbalanceId: number;
  linkId: number;
  action: EmailAction;
  userId: number;
  email: string;
  sourceCompanyId: number;
  sourceRef: string;
  targetCompanyId: number;
  targetRef: string;
  difference: string;
  basis: string;
  status: string;
  linkStatus: string;
  expiresAt: Date;
}

export type EmailActionError =
  | { code: "INVALID"; message: string }
  | { code: "EXPIRED"; message: string }
  | { code: "CONSUMED"; message: string }
  | { code: "FORBIDDEN"; message: string }
  | { code: "GONE"; message: string };

/**
 * Look up a token by its plaintext form, validate single-use + expiry
 * + that the bound user still has finance access on either side of the
 * imbalance, and return the resolved context. Does NOT consume — see
 * `consumeEmailActionToken` for that. Used by both the preview endpoint
 * (which renders the confirmation modal) and the confirm endpoint
 * (which re-checks before mutating).
 */
export async function resolveEmailActionToken(
  token: string,
): Promise<{ ok: true; ctx: ResolvedEmailAction } | { ok: false; error: EmailActionError }> {
  if (!token || token.length < 10) {
    return { ok: false, error: { code: "INVALID", message: "رابط غير صالح" } };
  }
  const tokenHash = hashEmailActionToken(token);
  const [row] = await db
    .select({
      tokenRowId: intercompanyImbalanceActionTokensTable.id,
      action: intercompanyImbalanceActionTokensTable.action,
      userId: intercompanyImbalanceActionTokensTable.userId,
      email: intercompanyImbalanceActionTokensTable.email,
      expiresAt: intercompanyImbalanceActionTokensTable.expiresAt,
      consumedAt: intercompanyImbalanceActionTokensTable.consumedAt,
      imbalanceId: intercompanyImbalancesTable.id,
      linkId: intercompanyImbalancesTable.linkId,
      sourceCompanyId: intercompanyImbalancesTable.sourceCompanyId,
      sourceRef: intercompanyImbalancesTable.sourceRef,
      targetCompanyId: intercompanyImbalancesTable.targetCompanyId,
      targetRef: intercompanyImbalancesTable.targetRef,
      difference: intercompanyImbalancesTable.difference,
      basis: intercompanyImbalancesTable.basis,
      status: intercompanyImbalancesTable.status,
      linkStatus: intercompanyLinksTable.status,
    })
    .from(intercompanyImbalanceActionTokensTable)
    .innerJoin(
      intercompanyImbalancesTable,
      eq(
        intercompanyImbalancesTable.id,
        intercompanyImbalanceActionTokensTable.imbalanceId,
      ),
    )
    .innerJoin(
      intercompanyLinksTable,
      eq(intercompanyLinksTable.id, intercompanyImbalancesTable.linkId),
    )
    .where(eq(intercompanyImbalanceActionTokensTable.tokenHash, tokenHash))
    .limit(1);

  if (!row) {
    return { ok: false, error: { code: "INVALID", message: "رابط غير صالح" } };
  }
  if (row.consumedAt) {
    return {
      ok: false,
      error: { code: "CONSUMED", message: "تم استخدام هذا الرابط مسبقاً" },
    };
  }
  if (row.expiresAt.getTime() < Date.now()) {
    return {
      ok: false,
      error: { code: "EXPIRED", message: "انتهت صلاحية الرابط" },
    };
  }

  if (!(EMAIL_ACTIONS as readonly string[]).includes(row.action)) {
    return { ok: false, error: { code: "INVALID", message: "إجراء غير معروف" } };
  }

  // Recheck finance access at click time — memberships can be revoked
  // between digest send and click, and a stale token must not let a
  // demoted user mutate the queue.
  const access = await db
    .select({ companyId: userCompaniesTable.companyId })
    .from(userCompaniesTable)
    .innerJoin(usersTable, eq(usersTable.id, userCompaniesTable.userId))
    .where(
      and(
        eq(userCompaniesTable.userId, row.userId),
        eq(usersTable.isActive, true),
        inArray(userCompaniesTable.role, FINANCE_ROLES),
        inArray(userCompaniesTable.companyId, [
          row.sourceCompanyId,
          row.targetCompanyId,
        ]),
      ),
    );
  if (access.length === 0) {
    return {
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: "لم تعد تملك صلاحية تنفيذ هذا الإجراء",
      },
    };
  }

  return {
    ok: true,
    ctx: {
      tokenRowId: row.tokenRowId,
      imbalanceId: row.imbalanceId,
      linkId: row.linkId,
      action: row.action as EmailAction,
      userId: row.userId,
      email: row.email,
      sourceCompanyId: row.sourceCompanyId,
      sourceRef: row.sourceRef,
      targetCompanyId: row.targetCompanyId,
      targetRef: row.targetRef,
      difference: row.difference,
      basis: row.basis,
      status: row.status,
      linkStatus: row.linkStatus,
      expiresAt: row.expiresAt,
    },
  };
}

/**
 * Atomically flip the token row to consumed. Returns false if it was
 * already consumed in a concurrent click — the route handler treats
 * that as a CONSUMED error.
 */
export async function consumeEmailActionToken(
  tokenRowId: number,
  ip: string | null,
): Promise<boolean> {
  const out = await db
    .update(intercompanyImbalanceActionTokensTable)
    .set({ consumedAt: new Date(), consumedIp: ip })
    .where(
      and(
        eq(intercompanyImbalanceActionTokensTable.id, tokenRowId),
        isNull(intercompanyImbalanceActionTokensTable.consumedAt),
      ),
    )
    .returning({ id: intercompanyImbalanceActionTokensTable.id });
  return out.length > 0;
}
