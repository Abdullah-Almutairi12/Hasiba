import { AsyncLocalStorage } from "node:async_hooks";
import { sql } from "drizzle-orm";
import type { DbOrTx } from "./journal-posting";
import { FinancialRequestError } from "./financial-transaction";

export type PosDeviceAuthority = { deviceId: string; generation: number; companyId: number;
  userId: number; personId: number; pinRevision: number; branchId: number };
export const posDeviceAuthority = new AsyncLocalStorage<PosDeviceAuthority>();

/** Caller already holds the authority fence, including on financial replay. */
export async function assertPosDeviceAuthority(connection: DbOrTx, value = posDeviceAuthority.getStore()) {
  if (!value) return;
  const result = await connection.execute(sql`
    SELECT d.id FROM pos_devices d
    JOIN companies c ON c.id=d.company_id AND c.is_active
    JOIN branches b ON b.id=d.branch_id AND b.company_id=d.company_id AND b.is_active
    JOIN employee_access a ON a.company_id=d.company_id AND a.employee_id=${value.personId}
      AND a.user_id=${value.userId} AND a.status='active' AND 'pos'=ANY(a.login_kinds)
    JOIN employees e ON e.id=a.employee_id AND e.user_id=a.user_id AND e.company_id=a.company_id
      AND e.status IN ('active','on_leave','probation','preboarding')
    JOIN users u ON u.id=a.user_id AND u.is_active
    JOIN user_companies uc ON uc.user_id=u.id AND uc.company_id=d.company_id
    JOIN pos_employee_credentials p ON p.company_id=a.company_id AND p.employee_id=a.employee_id
    WHERE d.id=${value.deviceId} AND d.company_id=${value.companyId} AND d.branch_id=${value.branchId}
      AND d.status='active' AND d.generation=${value.generation} AND p.revision=${value.pinRevision}`);
  if (!result.rows.length) throw new FinancialRequestError("الجهاز أو عضوية الكاشير أو وسيلة دخوله لم تعد صالحة؛ يلزم القفل وإعادة التفعيل المصرح به", 403);
}
