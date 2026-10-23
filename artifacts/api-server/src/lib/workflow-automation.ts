import { createHash } from "node:crypto";
import { z } from "zod";
import { and, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import {
  db, automationRulesTable, automationRunsTable, purchaseOrdersTable, invoicesTable,
  leaveRequestsTable, userCompaniesTable,
} from "@workspace/db";
import type { DbOrTx } from "./journal-posting";
import { supplyScope } from "./supply-chain-scope";
import { returnActor } from "./return-access";
import { assertWorkflowMember } from "./workflow-access";
import { notify } from "./workflow-notifications";
import { logger } from "./logger";
import { ALL_ROLES } from "../middlewares/require-role";

const sourceNames = ["purchase_order", "invoice", "leave_request"] as const;
const sourceTables = { purchase_order: purchaseOrdersTable, invoice: invoicesTable, leave_request: leaveRequestsTable };
type Source = typeof sourceNames[number];
const fields = ["id", "status", "total", "amount", "days", "daysOverdue", "reference", "dueDate"] as const;
const notice = z.object({
  recipientRole: z.enum(ALL_ROLES).optional(), recipientUserId: z.number().int().positive().optional(),
  title: z.string().min(1).max(200), message: z.string().max(2000), channel: z.literal("inapp").optional(),
}).strict().refine(x => Boolean(x.recipientRole) !== Boolean(x.recipientUserId), "حدد مستلمًا أو دورًا واحدًا");
// The send-notification discriminator is removed before strict notice parsing.
const actionSchema = z.preprocess(value => {
  if (value && typeof value === "object" && (value as Record<string, unknown>).type === "send_notification") {
    const { type: _type, ...rest } = value as Record<string, unknown>;
    const parsed = notice.safeParse(rest);
    if (parsed.success) return { ...parsed.data, type: "send_notification" };
  }
  return value;
}, z.union([
  z.object({ type: z.literal("send_notification"), recipientRole: z.enum(ALL_ROLES).optional(),
    recipientUserId: z.number().int().positive().optional(), title: z.string().min(1).max(200),
    message: z.string().max(2000), channel: z.literal("inapp").optional() }).strict()
    .refine(x => Boolean(x.recipientRole) !== Boolean(x.recipientUserId), "حدد مستلمًا أو دورًا واحدًا"),
  z.object({ type: z.literal("set_field"), field: z.literal("notes"), value: z.string().max(4000) }).strict(),
  z.object({ type: z.literal("create_record"), entity: z.literal("notification_inbox"), payload: notice }).strict(),
]));
export const AutomationDefinition = z.object({
  trigger: z.object({
    type: z.enum(["record_created", "record_updated", "state_changed", "scheduled"]),
    entity: z.enum(sourceNames).nullish(), state: z.string().max(80).nullish(),
    intervalMinutes: z.number().int().min(1).max(43200).nullish(),
  }).strict(),
  conditions: z.array(z.object({ field: z.enum(fields), op: z.enum(["eq", "ne", "gt", "lt", "gte", "lte", "contains"]), value: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]) }).strict()).max(20),
  actions: z.array(actionSchema).min(1).max(10),
}).superRefine((rule, ctx) => {
  if (rule.trigger.type !== "scheduled" && !rule.trigger.entity) ctx.addIssue({ code: "custom", message: "كيان المحفز مطلوب" });
  if (rule.actions.some(x => x.type === "set_field") && rule.trigger.entity !== "purchase_order") {
    ctx.addIssue({ code: "custom", message: "التعديل المسموح فقط ملاحظات أمر شراء مسودة" });
  }
  for (const action of rule.actions) {
    if (action.type === "set_field") continue;
    const n = action.type === "create_record" ? action.payload : action;
    for (const text of [n.title, n.message]) {
      for (const match of text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
        if (!(fields as readonly string[]).includes(match[1])) ctx.addIssue({ code: "custom", message: "حقل قالب التنبيه غير مسموح" });
      }
    }
  }
});
type Definition = z.infer<typeof AutomationDefinition>;
type Row = Record<string, unknown>;
function stable(input: unknown): unknown {
  if (input instanceof Date) return input.toISOString();
  if (Array.isArray(input)) return input.map(stable);
  if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return input;
}
const digest = (input: unknown) => createHash("sha256").update(JSON.stringify(stable(input))).digest("hex");

function graph(source: Source, companyId: number): SQL {
  if (source === "purchase_order") return supplyScope("purchaseOrder", purchaseOrdersTable.id, companyId);
  if (source === "invoice") return and(supplyScope("invoice", invoicesTable.id, companyId),
    sql`(${invoicesTable.poId} IS NULL OR ${invoicesTable.poId} IN (SELECT id FROM purchase_orders WHERE ${supplyScope("purchaseOrder", purchaseOrdersTable.id, companyId)}))`)!;
  return sql`${leaveRequestsTable.companyId} = ${companyId} AND EXISTS (
    SELECT 1 FROM employees e WHERE e.id=${leaveRequestsTable.employeeId} AND e.company_id=${companyId})`;
}
async function rows(companyId: number, source: Source, connection: DbOrTx, id?: number): Promise<Row[]> {
  const table = sourceTables[source];
  return connection.select().from(table).where(and(graph(source, companyId), id == null ? undefined : eq(table.id, id))).for("share") as unknown as Promise<Row[]>;
}
export async function canReadAutomationSource(companyId: number, userId: number, payload: Row | null, connection: DbOrTx = db): Promise<boolean> {
  const actor = await returnActor(userId, companyId, connection);
  if (payload?.entity === "clock") return !Array.isArray(payload.branchIds) || actor.branches == null || payload.branchIds.some(x => actor.branches!.includes(Number(x)));
  const source = payload?.entity as Source;
  if (!sourceNames.includes(source) || !Number.isSafeInteger(payload?.recordId)) return false;
  const [row] = await rows(companyId, source, connection, Number(payload!.recordId));
  if (!row) return false;
  const roles = source === "leave_request" ? ["owner", "manager", "hr", "accountant", "auditor"]
    : source === "purchase_order" ? ["owner", "manager", "inventory", "accountant", "auditor"] : ["owner", "manager", "accountant", "auditor"];
  if (!roles.includes(actor.role)) return false;
  if (actor.custom && !actor.capabilities.includes(source === "leave_request" ? "hr_view" : "view")) return false;
  let branchId = row.branchId as number | null;
  if (source === "purchase_order" && row.warehouseId != null) {
    const result = await connection.execute(sql`SELECT branch_id FROM warehouses WHERE id=${Number(row.warehouseId)} AND company_id=${companyId}`);
    branchId = result.rows[0]?.branch_id as number | null;
  }
  if (source === "invoice" && row.poId != null) {
    const result = await connection.execute(sql`SELECT w.branch_id FROM purchase_orders p JOIN warehouses w ON w.id=p.warehouse_id
      WHERE p.id=${Number(row.poId)} AND p.company_id=${companyId} AND w.company_id=${companyId}`);
    branchId = result.rows[0]?.branch_id as number | null;
  }
  if (source === "leave_request") {
    const result = await connection.execute(sql`SELECT branch_id FROM employees WHERE id=${Number(row.employeeId)} AND company_id=${companyId}`);
    branchId = result.rows[0]?.branch_id as number | null;
  }
  if (Array.isArray(payload?.branchIds) && (branchId == null || !payload.branchIds.includes(branchId))) return false;
  return actor.branches == null || (branchId != null && actor.branches.includes(branchId));
}
export async function assertAutomationAdministrator(companyId: number, userId: number, connection: DbOrTx = db) {
  const actor = await returnActor(userId, companyId, connection);
  if (!["owner", "manager"].includes(actor.role) || (actor.custom && !actor.capabilities.includes("configure"))) {
    throw Object.assign(new Error("إدارة الأتمتة غير مسموحة"), { status: 403 });
  }
  return actor;
}
export function automationVisibility(actor: { branches: number[] | null }) {
  return actor.branches == null ? sql`true`
    : sql`${automationRulesTable.branchIds} IS NOT NULL AND ${automationRulesTable.branchIds} <@ ${JSON.stringify(actor.branches)}::jsonb`;
}
const interpolate = (text: string, row: Row) => text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, field) => String(row[field] ?? ""));
function matches(row: Row, conditions: Definition["conditions"]) {
  return conditions.every(c => {
    const x = row[c.field], y = c.value;
    switch (c.op) {
      case "eq": return String(x) === String(y);
      case "ne": return String(x) !== String(y);
      case "contains": return String(x ?? "").includes(String(y));
      case "gt": return Number(x) > Number(y);
      case "gte": return Number(x) >= Number(y);
      case "lt": return Number(x) < Number(y);
      case "lte": return Number(x) <= Number(y);
    }
  });
}
export async function updateDraftPurchaseOrderNotes(connection: DbOrTx, companyId: number, userId: number, id: number, notes: string) {
  await assertAutomationAdministrator(companyId, userId, connection);
  const [row] = await connection.select().from(purchaseOrdersTable).where(and(
    eq(purchaseOrdersTable.id, id), graph("purchase_order", companyId),
  )).for("update");
  if (!row || row.status !== "draft" || !await canReadAutomationSource(companyId, userId, { entity: "purchase_order", recordId: id }, connection)) {
    throw new Error("لا يسمح إلا بتحديث ملاحظات مسودة ضمن نطاقك");
  }
  await connection.update(purchaseOrdersTable).set({ notes }).where(and(eq(purchaseOrdersTable.id, id), eq(purchaseOrdersTable.companyId, companyId)));
}
async function run(companyId: number, ruleId: number, event?: { type: string; entity: string; id: number; state?: string; key: string }) {
  try {
    await db.transaction(async tx => {
      const [rule] = await tx.select().from(automationRulesTable).where(and(
        eq(automationRulesTable.id, ruleId), eq(automationRulesTable.companyId, companyId), eq(automationRulesTable.isActive, true),
      )).for("update");
      if (!rule || rule.createdByUserId == null) return;
      await assertAutomationAdministrator(companyId, rule.createdByUserId, tx);
      const definition = AutomationDefinition.parse(rule);
      const trigger = definition.trigger;
      const interval = (trigger.intervalMinutes ?? 60) * 60000, now = Date.now();
      if (event) {
        if (trigger.type !== event.type || trigger.entity !== event.entity || (trigger.type === "state_changed" && trigger.state && trigger.state !== event.state)) return;
      } else {
        if (trigger.type !== "scheduled" || (rule.lastRunAt && now - rule.lastRunAt.getTime() < interval)) return;
      }
      // A retry remains the same event even if the rule was edited meanwhile.
      const key = event?.key ?? "slot:" + Math.floor(now / interval);
      const receipt = await tx.execute(sql`INSERT INTO automation_effect_receipts(company_id,rule_id,execution_key)
        VALUES (${companyId},${ruleId},${key}) ON CONFLICT DO NOTHING RETURNING rule_id`);
      if (!receipt.rows.length) return;
      const candidates = trigger.entity ? await rows(companyId, trigger.entity, tx, event?.id) : [{ id: 0 }];
      let matched = 0, executed = 0;
      const matchedIds: number[] = [];
      for (const raw of candidates) {
        const source = { entity: trigger.entity ?? "clock", recordId: Number(raw.id), branchIds: rule.branchIds };
        if (!await canReadAutomationSource(companyId, rule.createdByUserId, source, tx)) continue;
        const row = { ...raw };
        if (raw.dueDate) row.daysOverdue = Math.floor((now - new Date(raw.dueDate as string).getTime()) / 86400000);
        if (event?.state && row.status != null && row.status !== event.state) continue;
        if (!matches(row, definition.conditions)) continue;
        matched++;
        matchedIds.push(Number(raw.id));
        for (const action of definition.actions) {
          if (action.type === "set_field") {
            await updateDraftPurchaseOrderNotes(tx, companyId, rule.createdByUserId, Number(raw.id), action.value);
          } else {
            const notice = action.type === "create_record" ? action.payload : action;
            const members = await tx.select({ id: userCompaniesTable.userId }).from(userCompaniesTable).where(and(
              eq(userCompaniesTable.companyId, companyId),
              notice.recipientUserId ? eq(userCompaniesTable.userId, notice.recipientUserId) : eq(userCompaniesTable.role, notice.recipientRole!),
            ));
            if (notice.recipientUserId && members.length !== 1) throw new Error("المستلم خارج الشركة");
            for (const member of members) {
              await assertWorkflowMember(companyId, member.id, tx);
              await notify(member.id, { companyId, type: "automation", title: interpolate(notice.title, row),
                message: interpolate(notice.message, row), payload: source, channel: "inapp" }, tx);
            }
          }
          executed++;
        }
      }
      await tx.update(automationRulesTable).set({ lastRunAt: new Date(now) }).where(and(eq(automationRulesTable.id, ruleId), eq(automationRulesTable.companyId, companyId)));
      await tx.insert(automationRunsTable).values({ companyId, ruleId, status: "success", matchedRecords: matched, actionsExecuted: executed,
        details: { actorId: rule.createdByUserId, source: trigger.entity ?? "clock", recordIds: matchedIds,
          actionTypes: definition.actions.map(x => x.type), definition, definitionHash: digest(definition), executionKey: key } });
    });
  } catch (err) {
    // Failed effects and their receipt roll back together. A retry is safe.
    await db.insert(automationRunsTable).values({ companyId, ruleId, status: "failed", error: "تعذر التنفيذ: تحقق من الصلاحيات ومخطط الإجراء والسجل المستهدف" }).catch(() => {});
    logger.warn({ err, companyId, ruleId }, "company automation failed");
  }
}
/** Event callers supply trusted company context; record content is only an
 * idempotency identity. Conditions/templates reload owned facts from storage. */
export async function triggerEvent(companyId: number, type: "record_created" | "record_updated" | "state_changed", entity: string, record: Row, state?: string): Promise<void> {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) throw new Error("company required");
  if (!Number.isSafeInteger(record.id)) return;
  const rules = await db.select({ id: automationRulesTable.id }).from(automationRulesTable).where(and(
    eq(automationRulesTable.companyId, companyId), eq(automationRulesTable.isActive, true),
  ));
  for (const rule of rules) await run(companyId, rule.id, { type, entity, id: Number(record.id), state, key: digest([type, entity, state, record]) });
}
export async function runScheduledAutomations(): Promise<void> {
  const rules = await db.select({ id: automationRulesTable.id, companyId: automationRulesTable.companyId }).from(automationRulesTable)
    .where(and(isNotNull(automationRulesTable.companyId), eq(automationRulesTable.isActive, true)));
  for (const rule of rules) await run(rule.companyId!, rule.id);
}
