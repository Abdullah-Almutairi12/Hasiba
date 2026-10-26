import { sql } from "drizzle-orm";
import { FinancialRequestError } from "./financial-transaction";
import type { InventoryConnection } from "./scoped-inventory-actor";
import { teamRows } from "./team-store";

export const stocktakeParticipantBlock =
  "لا يمكنك اعتماد فروق هذه الجلسة لأنك سجّلت أو عدّلت العد فيها، حتى بعد الحذف أو إعادة الإسناد. تبقى بانتظار معتمد مخوّل مستقل دون ترحيل الفروق.";
export const stocktakeUnknownParticipantBlock =
  "يوجد عد تاريخي بلا دليل كامل على هوية مسجليه؛ تبقى الجلسة بانتظار توثيق مستقل للمشاركة المفقودة، ولا يكفي حذف العد أو إعادته. لم تُرحّل الفروق.";

/** Call only after verifying source access. Under execution, the caller must
 * hold the native stocktake parent lock shared by ALL count writers. Creation,
 * viewing and preparing a checkpoint are not count participation. */
export async function stocktakeSeparation(
  connection: InventoryConnection, takeId: number, userId: number,
) {
  const [{ participantIds, unknownCount }] = await teamRows<{
    participantIds: number[]; unknownCount: boolean;
  }>(connection, sql`
    SELECT ARRAY(SELECT DISTINCT user_id FROM stocktake_count_participants
      WHERE take_id=${takeId} ORDER BY user_id) AS "participantIds",
      (coalesce((SELECT count_participation_incomplete FROM stock_takes WHERE id=${takeId}),false)
      OR EXISTS(SELECT 1 FROM stock_take_lines l WHERE l.stock_take_id=${takeId}
        AND l.counted_qty IS NOT NULL AND NOT EXISTS(
          SELECT 1 FROM stocktake_count_participants p
          WHERE p.take_id=l.stock_take_id AND p.line_id=l.id))) AS "unknownCount"`);
  const participated = participantIds.includes(userId);
  return {
    participantIds, participated, unknownCount,
    blockReason: participated ? stocktakeParticipantBlock :
      unknownCount ? stocktakeUnknownParticipantBlock : null,
  };
}

export async function assertIndependentStocktakeReviewer(
  connection: InventoryConnection, takeId: number, userId: number,
) {
  const state = await stocktakeSeparation(connection, takeId, userId);
  if (state.blockReason) throw new FinancialRequestError(state.blockReason, 403);
  return state;
}
