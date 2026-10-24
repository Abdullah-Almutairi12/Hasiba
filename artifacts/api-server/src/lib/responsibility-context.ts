import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { teamRows } from "./team-store";
import { FinancialRequestError } from "./financial-transaction";

export const responsibilityContext = new AsyncLocalStorage<{ userId: number; companyId: number; grantId: number }>();
export type Responsibility = {
  id: number; resource: "inventory" | "pos"; branchId: number; warehouseIds: number[];
  actions: string[]; amountLimit: string | null; startsAt: string; endsAt: string | null;
};
export async function managedProfile(userId: number, companyId: number, connection: Pick<typeof db, "execute"> = db) {
  const [row] = await teamRows<{ managed: boolean; status: string; revision: number; employee_id: number | null; deniedActions: string[] }>(connection, sql`
    SELECT (a.employee_id IS NOT NULL OR uc.role='scoped') AS managed,
      CASE WHEN uc.user_id IS NOT NULL AND u.is_active AND c.is_active
        AND a.user_id IS NOT NULL AND e.user_id=a.user_id AND e.status IN ('active','on_leave','probation','preboarding')
        THEN a.status ELSE 'unavailable' END AS status,
      a.revision,a.employee_id,coalesce(a.denied_actions,'{}') AS "deniedActions"
    FROM users u JOIN companies c ON c.id=${companyId}
    LEFT JOIN user_companies uc ON uc.user_id=u.id AND uc.company_id=c.id
    LEFT JOIN employee_access a ON a.user_id=u.id AND a.company_id=c.id
    LEFT JOIN employees e ON e.id=a.employee_id AND e.company_id=a.company_id
    WHERE u.id=${userId}`);
  return row?.managed ? row : null;
}
export async function currentResponsibilities(userId: number, companyId: number, connection: Pick<typeof db, "execute"> = db): Promise<Responsibility[]> {
  const profile = await managedProfile(userId, companyId, connection);
  if (!profile || profile.status !== "active") return [];
  const rows = await teamRows<Responsibility>(connection, sql`
    SELECT g.id,g.resource,g.branch_id AS "branchId",g.warehouse_ids AS "warehouseIds",
      g.actions,g.amount_limit::text AS "amountLimit",g.starts_at AS "startsAt",g.ends_at AS "endsAt"
    FROM responsibility_grants g
    JOIN branches b ON b.id=g.branch_id AND b.company_id=g.company_id AND b.is_active
    LEFT JOIN team_access_policy p ON p.company_id=g.company_id
    WHERE g.company_id=${companyId} AND g.employee_id=${profile.employee_id}
      AND g.revoked_at IS NULL AND g.starts_at<=clock_timestamp() AND (g.ends_at IS NULL OR g.ends_at>clock_timestamp())
      AND ((${process.env.NODE_ENV !== "production"} AND p.company_id IS NULL) OR g.resource=ANY(p.enabled_modules))
      AND NOT EXISTS(SELECT 1 FROM unnest(g.warehouse_ids) w(id) LEFT JOIN warehouses wh ON wh.id=w.id
        AND wh.company_id=g.company_id AND wh.branch_id=g.branch_id WHERE wh.id IS NULL)`);
  return rows.map(g => ({ ...g, actions: !g.actions.includes(`${g.resource}.read`) || profile.deniedActions.includes(`${g.resource}.read`) ? [] :
    g.actions.filter(a => !profile.deniedActions.includes(a)) }));
}
export async function selectedResponsibility(userId: number, companyId: number, connection: Pick<typeof db, "execute"> = db) {
  const context = responsibilityContext.getStore();
  if (!context || context.userId !== userId || context.companyId !== companyId) return null;
  return (await currentResponsibilities(userId, companyId, connection)).find(g => g.id === context.grantId) ?? null;
}
export async function requireResponsibility(action: string, connection: Pick<typeof db, "execute"> = db) {
  const context = responsibilityContext.getStore();
  const grant = context && await selectedResponsibility(context.userId, context.companyId, connection);
  if (!grant || !grant.actions.includes(action)) throw new FinancialRequestError("المسؤولية أو نطاقها لم يعد يجيز هذا الإجراء", 403);
  return grant;
}
export async function recordPosResponsibility(connection: Pick<typeof db, "execute">, userId: number, companyId: number, orderId: number) {
  if (!await managedProfile(userId, companyId, connection)) return;
  const grant = await requireResponsibility("pos.sell", connection);
  await connection.execute(sql`INSERT INTO audit_logs(user_id,user_name,company_id,action,entity,details)
    SELECT u.id,u.name,a.company_id,'pos.responsibility.used','pos_order',
      jsonb_build_object('orderId',${orderId}::integer,'profileRevision',a.revision,'deniedActions',a.denied_actions,
        'responsibility',to_jsonb(g))::text
    FROM users u JOIN employee_access a ON a.user_id=u.id AND a.company_id=${companyId}
    JOIN responsibility_grants g ON g.employee_id=a.employee_id AND g.company_id=a.company_id AND g.id=${grant.id}
    WHERE u.id=${userId}`);
}
