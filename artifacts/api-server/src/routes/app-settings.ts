import { Router } from "express";
import { db, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { adminGuard } from "../middlewares/require-role";
import { checkLegacyAdministrativeBoundary } from "../lib/administration-authority";
import { FinancialRequestError } from "../lib/financial-transaction";

const router = Router();

// Each settings section is stored as its own jsonb column so PATCH can
// merge partial updates without clobbering siblings.
const JsonObject = z.record(z.string(), z.unknown());

// Atomic singleton: INSERT id=1 ON CONFLICT DO NOTHING ensures concurrent
// callers don't race and produce a duplicate-key 500. We then SELECT the
// canonical row.
async function ensureRow() {
  await db
    .insert(appSettingsTable)
    .values({ id: 1 })
    .onConflictDoNothing({ target: appSettingsTable.id });
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.id, 1))
    .limit(1);
  return row!;
}

// Fields admins can see/edit but non-admins must NOT receive (credentials,
// CSIDs, API keys, webhook secrets…). Applied per-section as a redaction
// allowlist-by-exclusion.
const SENSITIVE_FIELDS: Record<string, string[]> = {
  tax: ["zatcaApiUrl", "zatcaCsid", "zatcaPrivateKey", "zatcaSecret"],
  integrations: ["apiKey", "secret", "token", "webhookSecret", "password"],
  notifications: ["smtpPassword", "smtpUser", "smsApiKey", "whatsappToken"],
  backup: ["s3SecretKey", "s3AccessKey", "encryptionKey"],
};

/**
 * Strip credentials and other admin-only fields from a settings section
 * before serving it to non-admin readers. Operates as an exclusion list
 * keyed by section name; nested objects under `integrations` are also
 * scrubbed because each integration carries its own nested credentials.
 *
 * @param section - The section key (e.g. "tax", "integrations").
 * @param payload - The raw jsonb payload for that section.
 * @returns A copy of payload with sensitive keys removed.
 */
function redactSection(
  section: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const sensitive = SENSITIVE_FIELDS[section] ?? [];
  for (const [k, v] of Object.entries(payload)) {
    if (sensitive.includes(k)) continue;
    // Integrations is keyed by integration name → { enabled, apiKey, ... }
    // Recursively scrub nested objects too.
    if (
      section === "integrations" &&
      v &&
      typeof v === "object" &&
      !Array.isArray(v)
    ) {
      const sub: Record<string, unknown> = {};
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
        if (sensitive.includes(sk)) continue;
        sub[sk] = sv;
      }
      out[k] = sub;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function serialize(
  row: typeof appSettingsTable.$inferSelect,
  isAdmin: boolean,
) {
  const sections = {
    company: (row.company ?? {}) as Record<string, unknown>,
    tax: (row.tax ?? {}) as Record<string, unknown>,
    branches: (row.branches ?? {}) as Record<string, unknown>,
    pos: (row.pos ?? {}) as Record<string, unknown>,
    permissions: (row.permissions ?? {}) as Record<string, unknown>,
    accounting: (row.accounting ?? {}) as Record<string, unknown>,
    integrations: (row.integrations ?? {}) as Record<string, unknown>,
    notifications: (row.notifications ?? {}) as Record<string, unknown>,
    localization: (row.localization ?? {}) as Record<string, unknown>,
    numbering: (row.numbering ?? {}) as Record<string, unknown>,
    appearance: (row.appearance ?? {}) as Record<string, unknown>,
    backup: (row.backup ?? {}) as Record<string, unknown>,
    templates: (row.templates ?? {}) as Record<string, unknown>,
  };
  if (!isAdmin) {
    for (const key of Object.keys(SENSITIVE_FIELDS)) {
      sections[key as keyof typeof sections] = redactSection(
        key,
        sections[key as keyof typeof sections],
      );
    }
  }
  return { ...sections, updatedAt: row.updatedAt.toISOString() };
}

// Authenticated users can read non-sensitive metadata (branding,
// currency, timezone, payment-method toggles) — used by POS, headers
// and the read-only Settings view. Sensitive credentials are redacted
// for non-admin roles.
router.get("/settings", async (req, res) => {
  try {
    const row = await ensureRow();
    const isAdmin =
      req.session.role === "owner" || req.session.role === "manager";
    res.json(serialize(row, isAdmin));
  } catch (err) {
    req.log.error({ err }, "Get app settings failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

const PatchBody = z.object({
  company: JsonObject.optional(),
  tax: JsonObject.optional(),
  branches: JsonObject.optional(),
  pos: JsonObject.optional(),
  permissions: JsonObject.optional(),
  accounting: JsonObject.optional(),
  integrations: JsonObject.optional(),
  notifications: JsonObject.optional(),
  localization: JsonObject.optional(),
  numbering: JsonObject.optional(),
  appearance: JsonObject.optional(),
  backup: JsonObject.optional(),
  templates: JsonObject.optional(),
});

// Section-scoped PATCH. Each key sent is merged shallowly into the
// existing jsonb column so partial updates don't clobber unrelated
// fields. Writes are admin-only.
router.patch("/settings", adminGuard, async (req, res) => {
  try {
    await checkLegacyAdministrativeBoundary(req.session.companyId!,req.session.userId!,"settings");
    const body = PatchBody.parse(req.body);
    const row = await ensureRow();
    const next: Partial<typeof appSettingsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.company)
      next.company = { ...(row.company as object), ...body.company };
    if (body.tax) next.tax = { ...(row.tax as object), ...body.tax };
    if (body.branches)
      next.branches = { ...(row.branches as object), ...body.branches };
    if (body.pos) next.pos = { ...(row.pos as object), ...body.pos };
    if (body.permissions)
      next.permissions = { ...(row.permissions as object), ...body.permissions };
    if (body.accounting)
      next.accounting = {
        ...(row.accounting as object),
        ...body.accounting,
      };
    if (body.integrations)
      next.integrations = {
        ...(row.integrations as object),
        ...body.integrations,
      };
    if (body.notifications)
      next.notifications = {
        ...(row.notifications as object),
        ...body.notifications,
      };
    if (body.localization)
      next.localization = {
        ...(row.localization as object),
        ...body.localization,
      };
    if (body.numbering)
      next.numbering = { ...(row.numbering as object), ...body.numbering };
    if (body.appearance)
      next.appearance = { ...(row.appearance as object), ...body.appearance };
    if (body.backup)
      next.backup = { ...(row.backup as object), ...body.backup };
    if (body.templates)
      next.templates = { ...(row.templates as object), ...body.templates };
    const [updated] = await db
      .update(appSettingsTable)
      .set(next)
      .where(eq(appSettingsTable.id, row.id))
      .returning();
    return res.json(serialize(updated!, true));
  } catch (err) {
    if(err instanceof FinancialRequestError)return res.status(err.status).json({error:err.message});
    req.log.error({ err }, "Patch app settings failed");
    return res.status(400).json({ error: "بيانات غير صحيحة" });
  }
});

export default router;
