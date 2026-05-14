import {
  db,
  pool,
  anomalyRulesTable,
  anomalySignalsTable,
  anomalyEventsTable,
  usersTable,
} from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { logger } from "./logger";
import { notify } from "./workflow-engine";

export type AnomalyEventType =
  | "pos.refund"
  | "pos.void"
  | "pos.discount"
  | "pos.no_customer"
  | "invoice.created"
  | "stock.adjust";

export interface AnomalyEventInput {
  type: AnomalyEventType;
  actorId?: number | null;
  actorName?: string | null;
  refTable?: string | null;
  refId?: number | null;
  payload?: Record<string, unknown>;
  /** Caller-provided timestamp; defaults to "now". */
  at?: Date;
}

/**
 * Boot-time idempotent setup for the anomaly subsystem. Creates the
 * tables and seeds the 6 default rules.
 */
export async function initAnomaly(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS anomaly_rules (
      id SERIAL PRIMARY KEY,
      rule_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      event_type TEXT NOT NULL,
      window_minutes INTEGER NOT NULL DEFAULT 60,
      threshold INTEGER NOT NULL DEFAULT 3,
      severity TEXT NOT NULL DEFAULT 'medium',
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      config JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS anomaly_signals (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      actor_id INTEGER,
      actor_name TEXT,
      ref_table TEXT,
      ref_id INTEGER,
      payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS anomaly_signals_type_time_idx
      ON anomaly_signals(event_type, created_at);
    CREATE INDEX IF NOT EXISTS anomaly_signals_actor_idx
      ON anomaly_signals(actor_id, event_type, created_at);

    CREATE TABLE IF NOT EXISTS anomaly_events (
      id SERIAL PRIMARY KEY,
      rule_key TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      actor_id INTEGER,
      actor_name TEXT,
      ref_table TEXT,
      ref_id INTEGER,
      payload JSONB,
      severity TEXT NOT NULL DEFAULT 'medium',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by_user_id INTEGER,
      acknowledged_by_name TEXT
    );
    CREATE INDEX IF NOT EXISTS anomaly_events_status_idx
      ON anomaly_events(status, created_at);
  `);

  const seeds = [
    {
      ruleKey: "frequent_returns",
      name: "مرتجعات متكررة",
      description: "كاشير يُسجّل عدداً مرتفعاً من عمليات الإرجاع خلال فترة قصيرة",
      eventType: "pos.refund" as const,
      windowMinutes: 60,
      threshold: 3,
      severity: "high",
    },
    {
      ruleKey: "consecutive_discounts",
      name: "خصومات متتابعة لنفس العميل",
      description: "خصومات متعددة على فواتير نفس العميل خلال فترة قصيرة",
      eventType: "pos.discount" as const,
      windowMinutes: 120,
      threshold: 3,
      severity: "medium",
    },
    {
      ruleKey: "frequent_voids",
      name: "عمليات Void متكررة",
      description: "إلغاء عدد كبير من الطلبات خلال فترة قصيرة",
      eventType: "pos.void" as const,
      windowMinutes: 30,
      threshold: 3,
      severity: "high",
    },
    {
      ruleKey: "after_hours_invoice",
      name: "فواتير خارج الدوام",
      description: "إنشاء فواتير في ساعات الدوام غير المعتادة (23:00 – 06:00)",
      eventType: "invoice.created" as const,
      windowMinutes: 1,
      threshold: 1,
      severity: "medium",
    },
    {
      ruleKey: "unusual_stock_adjust",
      name: "تعديل مخزون غير اعتيادي",
      description: "تعديلات يدوية متعددة على المخزون خلال فترة قصيرة",
      eventType: "stock.adjust" as const,
      windowMinutes: 60,
      threshold: 2,
      severity: "high",
    },
    {
      ruleKey: "invoices_without_customer",
      name: "فواتير بدون عميل",
      description: "عدد كبير من الفواتير بدون عميل محدد خلال فترة قصيرة",
      eventType: "pos.no_customer" as const,
      windowMinutes: 60,
      threshold: 5,
      severity: "low",
    },
  ];

  for (const s of seeds) {
    try {
      await db
        .insert(anomalyRulesTable)
        .values({
          ruleKey: s.ruleKey,
          name: s.name,
          description: s.description,
          eventType: s.eventType,
          windowMinutes: s.windowMinutes,
          threshold: s.threshold,
          severity: s.severity,
        })
        .onConflictDoNothing({ target: anomalyRulesTable.ruleKey });
    } catch (err) {
      logger.warn({ err, seed: s.ruleKey }, "seed anomaly_rule failed");
    }
  }

  logger.info("Anomaly detection subsystem initialized");
}

const AFTER_HOURS_START = 23; // 23:00
const AFTER_HOURS_END = 6; // 06:00

/**
 * Evaluate a single sensitive event against the active rule set. Called
 * from POS / invoice / stock routes after a sensitive action. Best
 * effort — failures are logged and swallowed so they never break the
 * caller's transaction.
 */
export async function evaluateAnomalies(input: AnomalyEventInput): Promise<void> {
  try {
    const at = input.at ?? new Date();

    // 1) Record the raw signal so windowed counts have something to count.
    await db.insert(anomalySignalsTable).values({
      eventType: input.type,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      refTable: input.refTable ?? null,
      refId: input.refId ?? null,
      payload: (input.payload as object | undefined) ?? null,
    });

    // 2) Load the enabled rules matching this event type.
    const rules = await db
      .select()
      .from(anomalyRulesTable)
      .where(
        and(
          eq(anomalyRulesTable.isEnabled, true),
          eq(anomalyRulesTable.eventType, input.type),
        ),
      );
    if (rules.length === 0) return;

    for (const rule of rules) {
      // Special-case: after-hours invoice fires immediately when the
      // event timestamp falls inside the night-shift window.
      if (rule.ruleKey === "after_hours_invoice") {
        const h = at.getHours();
        const offHours = h >= AFTER_HOURS_START || h < AFTER_HOURS_END;
        if (!offHours) continue;
        await fireEvent(rule, input, at, {
          ...input.payload,
          hour: h,
          reason: "outside_business_hours",
        });
        continue;
      }

      // Default sliding-window count of same event_type within the rule's
      // window. Most rules also key on the same actor so we count what
      // *that user* did; "invoices_without_customer" intentionally
      // counts across the whole company.
      const windowStart = new Date(at.getTime() - rule.windowMinutes * 60_000);
      const conds = [
        eq(anomalySignalsTable.eventType, input.type),
        gte(anomalySignalsTable.createdAt, windowStart),
      ];
      if (rule.ruleKey !== "invoices_without_customer" && input.actorId != null) {
        conds.push(eq(anomalySignalsTable.actorId, input.actorId));
      }
      // "consecutive_discounts" focuses on a single customer.
      if (
        rule.ruleKey === "consecutive_discounts" &&
        typeof input.payload?.customerId === "number"
      ) {
        conds.push(
          sql`${anomalySignalsTable.payload}->>'customerId' = ${String(
            input.payload.customerId,
          )}`,
        );
      }
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(anomalySignalsTable)
        .where(and(...conds));
      const count = Number(row?.count ?? 0);
      if (count < rule.threshold) continue;

      // Suppress duplicate alerts: if an open event already exists for
      // the same rule + actor within the window, don't refire.
      const dupConds = [
        eq(anomalyEventsTable.ruleKey, rule.ruleKey),
        eq(anomalyEventsTable.status, "open"),
        gte(anomalyEventsTable.createdAt, windowStart),
      ];
      if (input.actorId != null) {
        dupConds.push(eq(anomalyEventsTable.actorId, input.actorId));
      }
      const [dup] = await db
        .select({ id: anomalyEventsTable.id })
        .from(anomalyEventsTable)
        .where(and(...dupConds))
        .limit(1);
      if (dup) continue;

      await fireEvent(rule, input, at, {
        ...input.payload,
        windowMinutes: rule.windowMinutes,
        threshold: rule.threshold,
        count,
      });
    }
  } catch (err) {
    logger.warn({ err, type: input.type }, "evaluateAnomalies failed");
  }
}

async function fireEvent(
  rule: typeof anomalyRulesTable.$inferSelect,
  input: AnomalyEventInput,
  _at: Date,
  payload: Record<string, unknown>,
): Promise<void> {
  const [created] = await db
    .insert(anomalyEventsTable)
    .values({
      ruleKey: rule.ruleKey,
      ruleName: rule.name,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      refTable: input.refTable ?? null,
      refId: input.refId ?? null,
      payload,
      severity: rule.severity,
    })
    .returning({ id: anomalyEventsTable.id });
  if (!created) return;

  // Notify all active managers/owners. WhatsApp is requested; the
  // notify helper falls back to email automatically when the user has
  // no phone configured or messaging credentials are missing.
  try {
    const recipients = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          sql`${usersTable.role} in ('owner', 'manager')`,
          eq(usersTable.isActive, true),
        ),
      );
    const title = `تنبيه شاذ: ${rule.name}`;
    const actor = input.actorName ?? "غير محدد";
    const message = `تم اكتشاف نشاط مريب — ${rule.name}. المنفّذ: ${actor}.`;
    for (const r of recipients) {
      await notify(r.id, {
        type: "system",
        title,
        message,
        link: `/anomalies?event=${created.id}`,
        payload: { eventId: created.id, ruleKey: rule.ruleKey, severity: rule.severity },
        channel: "whatsapp",
      });
    }
  } catch (err) {
    logger.warn({ err, ruleKey: rule.ruleKey }, "anomaly notification dispatch failed");
  }
}
