import { db, whatsappTemplatesTable } from "@workspace/db";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { sendMessage, type SendMessageRequest } from "./messaging";
import { logger } from "../logger";

/**
 * Catalogue of pre-approved WhatsApp templates that the app
 * fires automatically. Each entry is the source-of-truth body
 * the operator submits to Meta for approval. The `name`
 * matches the `template_name` Meta returns once the template
 * is approved, so the runtime can resolve event → template by
 * key and fall back to plain text when the template is not
 * approved yet (or no WhatsApp credential is configured).
 */
export interface DefaultTemplate {
  name: string;
  languageCode: string;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  bodyTemplate: string;
  variableHints: Array<{ name: string; example: string }>;
}

export const DEFAULT_TEMPLATES: DefaultTemplate[] = [
  {
    name: "invoice_issued",
    languageCode: "ar",
    category: "UTILITY",
    bodyTemplate:
      "مرحباً {{customer_name}},\nتم إصدار فاتورة جديدة برقم {{invoice_no}} بقيمة {{total}} ر.س.\nللدفع: {{pay_link}}",
    variableHints: [
      { name: "customer_name", example: "محمد العبدالله" },
      { name: "invoice_no", example: "INV-2026-0001" },
      { name: "total", example: "1,250.00" },
      { name: "pay_link", example: "https://app.example/pay/123" },
    ],
  },
  {
    name: "shipment_dispatched",
    languageCode: "ar",
    category: "UTILITY",
    bodyTemplate:
      "مرحباً {{customer_name}},\nتم شحن طلبك رقم {{order_ref}} عبر {{carrier}}.\nرقم البوليصة: {{awb}}\nتتبع الشحنة: {{tracking_url}}",
    variableHints: [
      { name: "customer_name", example: "محمد العبدالله" },
      { name: "order_ref", example: "DO-2026-0042" },
      { name: "carrier", example: "SMSA Express" },
      { name: "awb", example: "9100023445" },
      { name: "tracking_url", example: "https://app.example/track/9100023445" },
    ],
  },
  {
    name: "low_stock_alert",
    languageCode: "ar",
    category: "UTILITY",
    bodyTemplate:
      "تنبيه مخزون منخفض:\nالمنتج {{product_name}} ({{sku}}) وصلت كميته إلى {{stock}} وحدة وهي عند الحد الأدنى {{min_stock}}.",
    variableHints: [
      { name: "product_name", example: "زيت زيتون 1 لتر" },
      { name: "sku", example: "OIL-001" },
      { name: "stock", example: "3" },
      { name: "min_stock", example: "5" },
    ],
  },
];

/**
 * Insert any missing default templates (idempotent). Existing
 * rows are left untouched so user edits to body/status are not
 * clobbered. Returns the number of newly-seeded rows.
 */
export async function seedDefaultTemplates(
  branchId: number | null = null,
): Promise<number> {
  let inserted = 0;
  for (const t of DEFAULT_TEMPLATES) {
    const branchCond =
      branchId === null
        ? isNull(whatsappTemplatesTable.branchId)
        : eq(whatsappTemplatesTable.branchId, branchId);
    const [existing] = await db
      .select({ id: whatsappTemplatesTable.id })
      .from(whatsappTemplatesTable)
      .where(
        and(
          branchCond,
          eq(whatsappTemplatesTable.name, t.name),
          eq(whatsappTemplatesTable.languageCode, t.languageCode),
        ),
      )
      .limit(1);
    if (existing) continue;
    await db.insert(whatsappTemplatesTable).values({
      branchId,
      name: t.name,
      languageCode: t.languageCode,
      category: t.category,
      bodyTemplate: t.bodyTemplate,
      variableHints: t.variableHints,
      status: "pending",
    });
    inserted++;
  }
  return inserted;
}

/**
 * Resolve a template by event-key (== template name) for the
 * given branch. Falls back to the global (branchId IS NULL)
 * template when no branch-scoped row exists.
 */
async function resolveTemplate(
  name: string,
  branchId: number | null,
  languageCode = "ar",
): Promise<{
  bodyTemplate: string;
  status: string;
  languageCode: string;
} | null> {
  const rows = await db
    .select({
      bodyTemplate: whatsappTemplatesTable.bodyTemplate,
      status: whatsappTemplatesTable.status,
      languageCode: whatsappTemplatesTable.languageCode,
      branchId: whatsappTemplatesTable.branchId,
    })
    .from(whatsappTemplatesTable)
    .where(
      and(
        eq(whatsappTemplatesTable.name, name),
        eq(whatsappTemplatesTable.languageCode, languageCode),
        branchId === null
          ? isNull(whatsappTemplatesTable.branchId)
          : or(
              eq(whatsappTemplatesTable.branchId, branchId),
              isNull(whatsappTemplatesTable.branchId),
            )!,
      ),
    )
    // Branch-specific row first, global fallback (NULL branch) last.
    // Postgres puts NULLs last by default with ASC, but we sort by
    // an explicit "is this the global row?" flag for clarity and
    // database-portability.
    .orderBy(sql`(${whatsappTemplatesTable.branchId} IS NULL) ASC`);
  return rows[0] ?? null;
}

export interface SendByTemplateOptions {
  templateName: string;
  to: string;
  variables: Record<string, string>;
  branchId?: number | null;
  languageCode?: string;
  channel?: "whatsapp" | "sms";
  provider?: SendMessageRequest["provider"];
  mediaUrl?: string;
  mediaFilename?: string;
  mediaType?: "image" | "document";
}

/**
 * Send an outbound message using a pre-approved template. When the
 * template is missing or not yet approved, falls back to free-form
 * text (which will only be delivered inside Meta's 24-hour
 * customer-care window — Meta itself rejects the rest, which is
 * captured in `outbound_messages.error_message`). All errors are
 * swallowed and logged so a failed notification never breaks the
 * caller.
 */
export async function sendByTemplate(
  opts: SendByTemplateOptions,
): Promise<void> {
  const branchId = opts.branchId ?? null;
  const languageCode = opts.languageCode ?? "ar";
  const channel = opts.channel ?? "whatsapp";
  const provider = opts.provider ?? "whatsapp";
  try {
    const tpl = await resolveTemplate(opts.templateName, branchId, languageCode);
    const body =
      tpl?.bodyTemplate ??
      Object.entries(opts.variables)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
    // Only send the templateName parameter to Meta when (a) we
    // matched a row and (b) it is approved. Otherwise fall back
    // to plain text so we don't trigger a Meta 132000 (template
    // not found) error — but we still record the *attempted*
    // template name on the outbound row so support can trace
    // which event triggered the message.
    const useTemplate = tpl?.status === "approved" && provider === "whatsapp";
    // Render `{{var}}` placeholders in the template body before
    // handing the result off as a media caption — `sendWhatsApp`
    // treats `mediaCaption` as already-rendered text, so unresolved
    // placeholders would otherwise leak into fallback messages.
    const renderedBody = body.replace(
      /\{\{(\w+)\}\}/g,
      (_, k: string) => opts.variables[k] ?? `{{${k}}}`,
    );
    await sendMessage({
      channel,
      provider,
      to: opts.to,
      body: renderedBody,
      templateName: opts.templateName,
      useTemplate,
      variables: opts.variables,
      branchId,
      mediaUrl: opts.mediaUrl,
      mediaFilename: opts.mediaFilename,
      mediaType: opts.mediaType,
      mediaCaption: opts.mediaUrl ? renderedBody : undefined,
    });
  } catch (err) {
    logger.warn(
      { err, templateName: opts.templateName, to: opts.to },
      "templated message dispatch failed",
    );
  }
}

/**
 * Has any low-stock alert for this product been recorded in the
 * recent past? Used to debounce the WhatsApp notification so a
 * single product doesn't spam managers every time another unit
 * is sold below the threshold.
 */
export async function hasRecentLowStockAlert(
  productId: number,
  withinHours = 24,
): Promise<boolean> {
  // Match `#<id>` followed by a non-digit (or end-of-string) so
  // product 12 doesn't accidentally suppress alerts for product 123.
  // The `#` token is mandatory in the message body produced by
  // `scheduleLowStockNotification`.
  const pattern = `%#${productId} %`;
  const result = await db.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM alerts
       WHERE type = 'low_stock'
         AND message LIKE ${pattern}
         AND created_at > now() - (${withinHours} || ' hours')::interval
    ) AS exists
  `);
  // node-postgres (used by drizzle here) returns a QueryResult
  // with a `rows` array; coerce defensively in case the driver
  // ever swaps to an iterable result shape.
  const rows: Array<{ exists: boolean }> =
    (result as { rows?: Array<{ exists: boolean }> }).rows ??
    (Array.isArray(result) ? (result as Array<{ exists: boolean }>) : []);
  return Boolean(rows[0]?.exists);
}
