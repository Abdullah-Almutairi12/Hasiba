import { pool } from "@workspace/db";

// Extend legacy test fixtures with the newly mandatory review contract.
// Tests for malformed input send raw HTTP explicitly rather than using this helper.
export async function closingReviewPayload(payload: unknown) {
  const input = payload as Record<string, unknown>;
  const row = (await pool.query("SELECT settlement_revision FROM pos_cash_closings WHERE session_id=$1", [input.sessionId])).rows[0];
  return { reviewReason: "راجعت العد والحركات وأعتمد الفرق المصطنع", settlementRevision: row?.settlement_revision ?? "unavailable", ...input };
}
