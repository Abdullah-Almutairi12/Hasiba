import { createHash } from "node:crypto";
import { z } from "zod";
import { canonical } from "./financial-transaction";

/** Server-computed commitment, never a digest supplied by a client.
 * POS has no persisted order before checkout. All business inputs are bound;
 * normal product/price/permission validation still runs on the retry.
 * Only the subsequent approval reference and manager credentials are excluded.
 */
export function posApprovalIntent(body: unknown, serverQuote: unknown): string {
  const parsed = z.record(z.string(), z.unknown()).parse(body);
  const quote = z.record(z.string(), z.unknown()).parse(serverQuote);
  const business = Object.fromEntries(Object.entries(parsed).filter(([key]) =>
    key !== "approvalRequestId" && key !== "managerOverride"));
  return createHash("sha256").update(canonical({ business, quote })).digest("hex");
}

export function posApprovalNotes(body: unknown, reason: string, serverQuote: unknown): string {
  return JSON.stringify({ kind: "pos-intent-v1", intent: posApprovalIntent(body, serverQuote), reason });
}

export function matchesPosApprovalNotes(body: unknown, notes: string | null, serverQuote: unknown): boolean {
  if (!notes) return false;
  const parsed = z.object({ kind: z.literal("pos-intent-v1"), intent: z.string().length(64), reason: z.string() })
    .safeParse((() => { try { return JSON.parse(notes); } catch { return null; } })());
  return parsed.success && parsed.data.intent === posApprovalIntent(body, serverQuote);
}
