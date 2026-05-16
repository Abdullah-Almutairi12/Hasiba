import express, { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { z, ZodError } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  externalCredentialsTable,
  paymentGatewaysTable,
  paymentIntentsTable,
  shippingCarriersTable,
  shipmentsTable,
  outboundMessagesTable,
  whatsappTemplatesTable,
  zatcaCertificatesTable,
  zatcaInvoicesTable,
  integrationCallsTable,
  customerInvoicesTable,
  marketplaceConnectorsTable,
  marketplaceProductMappingsTable,
  marketplaceOrderImportsTable,
  marketplaceSyncLogsTable,
} from "@workspace/db";
import { adminGuard, inventoryGuard, ownerOnly, requireRole } from "../middlewares/require-role";
import { upsertCredential } from "../lib/integrations/credentials";
import { encryptSecret } from "../lib/integrations/crypto";
import { createCheckout, handleWebhook, refundIntent } from "../lib/integrations/payments";
import { createAwb, pollTracking, getPublicTracking } from "../lib/integrations/shipping";
import { sendMessage } from "../lib/integrations/messaging";
import {
  seedDefaultTemplates,
  DEFAULT_TEMPLATES,
} from "../lib/integrations/messaging-templates";
import { buildZatcaQrBase64 } from "../lib/zatca-qr";
import { getCompanyInfo } from "../lib/pdf/purchase-order";
import QRCode from "qrcode";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  createCsr,
  attachCsid,
  attachPcsid,
  retrieveCsid,
  retrievePcsid,
  processInvoiceForZatca,
} from "../lib/integrations/zatca-phase2";

const router = Router();

const PROVIDERS = [
  "zatca",
  "moyasar",
  "tap",
  "hyperpay",
  "stcpay",
  "mada",
  "paytabs",
  "smsa",
  "aramex",
  "saee",
  "naqel",
  "whatsapp",
  "unifonic",
  "mobily",
  "taqnyat",
] as const;

function handle(res: express.Response, err: unknown): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "بيانات غير صالحة", details: err.issues });
    return;
  }
  const msg = err instanceof Error ? err.message : "حدث خطأ غير متوقع";
  res.status(400).json({ error: msg });
}

// =============================================================
// Status overview — one card per family.
// =============================================================
router.get("/integrations/overview", adminGuard, async (_req, res) => {
  try {
    // Total credential count — un-grouped so the overview card
    // reflects every connector across all providers, not just
    // the first provider that happens to come back from the
    // grouped query.
    const [credsTotal] = await db
      .select({ cnt: sql<number>`count(*)`.as("cnt") })
      .from(externalCredentialsTable);

    const credByProvider = await db
      .select({
        provider: externalCredentialsTable.provider,
        environment: externalCredentialsTable.environment,
        isActive: externalCredentialsTable.isActive,
        lastUsedAt: externalCredentialsTable.lastUsedAt,
      })
      .from(externalCredentialsTable);

    const [pgCount] = await db
      .select({ cnt: sql<number>`count(*)`.as("cnt") })
      .from(paymentGatewaysTable);
    const [shCount] = await db
      .select({ cnt: sql<number>`count(*)`.as("cnt") })
      .from(shippingCarriersTable);
    const [zCount] = await db
      .select({ cnt: sql<number>`count(*)`.as("cnt") })
      .from(zatcaInvoicesTable);
    const [omCount] = await db
      .select({ cnt: sql<number>`count(*)`.as("cnt") })
      .from(outboundMessagesTable);

    res.json({
      configuredProviders: credByProvider,
      counts: {
        credentials: Number(credsTotal?.cnt ?? 0),
        paymentGateways: Number(pgCount?.cnt ?? 0),
        shippingCarriers: Number(shCount?.cnt ?? 0),
        zatcaInvoices: Number(zCount?.cnt ?? 0),
        outboundMessages: Number(omCount?.cnt ?? 0),
      },
    });
  } catch (err) {
    handle(res, err);
  }
});

// =============================================================
// Credentials — write-only (decrypted secret never returned).
// =============================================================
const UpsertCredBody = z.object({
  provider: z.enum(PROVIDERS),
  branchId: z.coerce.number().int().nullable().optional(),
  label: z.string().max(120).nullable().optional(),
  environment: z.enum(["sandbox", "production"]).default("sandbox"),
  secret: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

router.post("/integrations/credentials", adminGuard, async (req, res) => {
  try {
    const body = UpsertCredBody.parse(req.body);
    const out = await upsertCredential({
      provider: body.provider,
      branchId: body.branchId ?? null,
      label: body.label ?? null,
      environment: body.environment,
      secret: body.secret,
    });
    res.status(201).json({ id: out.id, ok: true });
  } catch (err) {
    handle(res, err);
  }
});

router.get("/integrations/credentials", adminGuard, async (_req, res) => {
  try {
    const rows = await db
      .select({
        id: externalCredentialsTable.id,
        provider: externalCredentialsTable.provider,
        label: externalCredentialsTable.label,
        environment: externalCredentialsTable.environment,
        isActive: externalCredentialsTable.isActive,
        branchId: externalCredentialsTable.branchId,
        lastUsedAt: externalCredentialsTable.lastUsedAt,
        createdAt: externalCredentialsTable.createdAt,
      })
      .from(externalCredentialsTable)
      .orderBy(externalCredentialsTable.provider);
    res.json(rows);
  } catch (err) {
    handle(res, err);
  }
});

router.delete("/integrations/credentials/:id", adminGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db.delete(externalCredentialsTable).where(eq(externalCredentialsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    handle(res, err);
  }
});

// =============================================================
// Payment gateways
// =============================================================
const CreateGatewayBody = z.object({
  provider: z.enum(["moyasar", "tap", "hyperpay", "stcpay", "mada", "paytabs"]),
  displayName: z.string().min(2),
  branchId: z.coerce.number().int().nullable().optional(),
  environment: z.enum(["sandbox", "production"]).default("sandbox"),
  bankAccountKey: z.string().default("bank"),
  clearingAccountKey: z.string().default("clearing"),
  webhookSecret: z.string().nullable().optional(),
  isEnabled: z.boolean().default(true),
});

router.get("/integrations/payment-gateways", adminGuard, async (_req, res) => {
  const rows = await db
    .select({
      id: paymentGatewaysTable.id,
      branchId: paymentGatewaysTable.branchId,
      provider: paymentGatewaysTable.provider,
      displayName: paymentGatewaysTable.displayName,
      isEnabled: paymentGatewaysTable.isEnabled,
      environment: paymentGatewaysTable.environment,
      bankAccountKey: paymentGatewaysTable.bankAccountKey,
      clearingAccountKey: paymentGatewaysTable.clearingAccountKey,
      hasWebhookSecret: sql<boolean>`("webhook_secret" is not null)`.as("hasWebhookSecret"),
      createdAt: paymentGatewaysTable.createdAt,
      updatedAt: paymentGatewaysTable.updatedAt,
    })
    .from(paymentGatewaysTable)
    .orderBy(paymentGatewaysTable.provider);
  res.json(rows);
});

router.post("/integrations/payment-gateways", adminGuard, async (req, res) => {
  try {
    const b = CreateGatewayBody.parse(req.body);
    const [row] = await db
      .insert(paymentGatewaysTable)
      .values({
        provider: b.provider,
        displayName: b.displayName,
        branchId: b.branchId ?? null,
        environment: b.environment,
        bankAccountKey: b.bankAccountKey,
        clearingAccountKey: b.clearingAccountKey,
        // Stored as AES-GCM ciphertext of the HMAC secret. The
        // value is decrypted on demand inside payments.ts when
        // verifying provider webhooks; it is never returned.
        webhookSecret: b.webhookSecret ? encryptSecret(b.webhookSecret) : null,
        isEnabled: b.isEnabled,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    handle(res, err);
  }
});

const CheckoutBody = z.object({
  gatewayId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive(),
  currency: z.string().default("SAR"),
  description: z.string().min(2),
  customerEmail: z.string().email().optional(),
  customerName: z.string().optional(),
  invoiceId: z.coerce.number().int().positive().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  callbackUrl: z.string().url(),
  metadata: z.record(z.string(), z.string()).optional(),
});

router.post("/integrations/payments/checkout", adminGuard, async (req, res) => {
  try {
    const b = CheckoutBody.parse(req.body);
    const out = await createCheckout(b);
    res.status(201).json(out);
  } catch (err) {
    handle(res, err);
  }
});

// Customer-portal "Pay now" link — given an issued AR invoice,
// create a checkout session against the company's default
// gateway (or an explicit gatewayId) and return the hosted URL.
router.post(
  "/sales/invoices/:id/pay-link",
  requireRole("owner", "manager", "accountant", "sales"),
  async (req, res) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const body = z
        .object({
          gatewayId: z.coerce.number().int().positive().optional(),
          callbackUrl: z.string().url(),
        })
        .parse(req.body);
      const [inv] = await db
        .select()
        .from(customerInvoicesTable)
        .where(eq(customerInvoicesTable.id, id));
      if (!inv) {
        res.status(404).json({ error: "invoice_not_found" });
        return;
      }
      let gatewayId = body.gatewayId;
      if (!gatewayId) {
        const [gw] = await db
          .select({ id: paymentGatewaysTable.id })
          .from(paymentGatewaysTable)
          .where(eq(paymentGatewaysTable.isEnabled, true))
          .orderBy(paymentGatewaysTable.id)
          .limit(1);
        if (!gw) {
          res.status(409).json({ error: "no_active_payment_gateway" });
          return;
        }
        gatewayId = gw.id;
      }
      const out = await createCheckout({
        gatewayId,
        amount: Number(inv.total),
        currency: "SAR",
        description: `Invoice ${inv.reference}`,
        invoiceId: inv.id,
        customerId: inv.customerId ?? undefined,
        callbackUrl: body.callbackUrl,
        metadata: { reference: inv.reference },
      });
      res.status(201).json(out);
    } catch (err) {
      handle(res, err);
    }
  },
);

const RefundBody = z.object({
  intentId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive().optional(),
});

router.post(
  "/integrations/payments/refund",
  requireRole("owner", "manager", "accountant"),
  async (req, res) => {
    try {
      const b = RefundBody.parse(req.body);
      const out = await refundIntent(b);
      res.json(out);
    } catch (err) {
      handle(res, err);
    }
  },
);

router.get("/integrations/payments/intents", adminGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(paymentIntentsTable)
    .orderBy(desc(paymentIntentsTable.createdAt))
    .limit(100);
  res.json(rows);
});

// Webhook endpoint: must be raw-body to verify HMAC. Mounted public
// in routes/index.ts so it bypasses session auth.
export const integrationsPublicRouter = Router();

// Public shipment tracking lookup — backs the customer-facing
// /track/:awb page that customers open from a WhatsApp/SMS link.
// Lightly rate-limited per-IP so we don't proxy unlimited carrier
// calls from a public endpoint.
const trackingLookupLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `track:${ipKeyGenerator(req.ip ?? "")}`,
  message: { error: "تم تجاوز حد البحث، حاول لاحقاً", code: "RATE_LIMITED" },
});

integrationsPublicRouter.get(
  "/integrations/track/:awb",
  trackingLookupLimiter,
  async (req, res) => {
    try {
      const awb = String(req.params.awb ?? "").trim();
      if (!awb || awb.length > 64) {
        res.status(400).json({ error: "رقم بوليصة غير صالح" });
        return;
      }
      const out = await getPublicTracking(awb);
      if (!out) {
        res.status(404).json({ error: "لم يتم العثور على هذه الشحنة" });
        return;
      }
      res.json(out);
    } catch (err) {
      handle(res, err);
    }
  },
);

// Public ZATCA QR PNG for a customer invoice. Served unauthenticated
// because it must be fetchable by Meta's WhatsApp media servers when
// the invoice notification template attaches it as a header image.
// The QR itself only encodes data Saudi tax law already requires us
// to print on the invoice (seller, VAT no., total, VAT amount,
// timestamp), so disclosure is not a concern. Cached aggressively
// since the values are immutable for an issued invoice.
const qrLookupLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `qr:${ipKeyGenerator(req.ip ?? "")}`,
});

/**
 * HMAC-sign an invoice id for inclusion in the public QR URL.
 * The signature is keyed off SESSION_SECRET (already required for
 * cookies) so the URL can't be guessed by enumerating ids — only
 * the server can mint a valid `s=` token. An expiry timestamp is
 * baked in so messaging links auto-rot after a window long enough
 * for Meta media servers to fetch it.
 */
function signQrToken(invoiceId: number, expSec: number): string {
  const seed = process.env["SESSION_SECRET"];
  if (!seed) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error(
        "SESSION_SECRET is required in production to sign QR URLs",
      );
    }
    return createHmac("sha256", "dev-only-fallback")
      .update(`qr:${invoiceId}:${expSec}`)
      .digest("base64url");
  }
  return createHmac("sha256", seed)
    .update(`qr:${invoiceId}:${expSec}`)
    .digest("base64url");
}

export function buildSignedInvoiceQrPath(
  invoiceId: number,
  ttlSeconds = 60 * 60 * 24 * 30,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = signQrToken(invoiceId, exp);
  return `/api/integrations/qr/invoice/${invoiceId}.png?e=${exp}&s=${sig}`;
}

integrationsPublicRouter.get(
  "/integrations/qr/invoice/:id.png",
  qrLookupLimiter,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).send("invalid id");
        return;
      }
      const exp = Number(req.query["e"] ?? 0);
      const sig = String(req.query["s"] ?? "");
      if (!Number.isFinite(exp) || exp <= 0 || !sig) {
        res.status(403).send("missing signature");
        return;
      }
      if (Math.floor(Date.now() / 1000) > exp) {
        res.status(403).send("expired");
        return;
      }
      const expected = signQrToken(id, exp);
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        res.status(403).send("bad signature");
        return;
      }
      const [inv] = await db
        .select({
          id: customerInvoicesTable.id,
          total: customerInvoicesTable.total,
          vat: customerInvoicesTable.vat,
          createdAt: customerInvoicesTable.createdAt,
        })
        .from(customerInvoicesTable)
        .where(eq(customerInvoicesTable.id, id))
        .limit(1);
      if (!inv) {
        res.status(404).send("not found");
        return;
      }
      const company = await getCompanyInfo();
      const tlvBase64 = buildZatcaQrBase64({
        timestamp: inv.createdAt,
        totalWithVat: Number(inv.total),
        vatAmount: Number(inv.vat),
        sellerName:
          company.nameAr && company.nameAr !== "—"
            ? company.nameAr
            : process.env["ZATCA_SELLER_NAME"] ?? "حاسبة AI",
        vatNumber:
          company.vatNumber && company.vatNumber !== "—"
            ? company.vatNumber
            : process.env["ZATCA_VAT_NUMBER"] ?? "300000000000003",
      });
      const png = await QRCode.toBuffer(tlvBase64, {
        type: "png",
        errorCorrectionLevel: "M",
        margin: 1,
        width: 512,
      });
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.send(png);
    } catch (err) {
      handle(res, err);
    }
  },
);

integrationsPublicRouter.post(
  "/integrations/payments/webhook/:gatewayId",
  // Raw-body parser is registered globally in app.ts BEFORE express.json
  // so req.body arrives as a Buffer of pristine bytes for HMAC.
  async (req, res) => {
    try {
      const gatewayId = Number(req.params.gatewayId);
      const rawBody = (req.body as Buffer).toString("utf8");
      // Forward the full lower-cased header bag so each provider's
      // verifier can pluck whichever signature header it expects.
      const headers: Record<string, string | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k.toLowerCase()] = Array.isArray(v) ? v[0] : (v as string | undefined);
      }
      const signature =
        headers["x-signature"] ?? headers["x-moyasar-signature"];
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(rawBody) as Record<string, unknown>; } catch { /* keep empty */ }
      const out = await handleWebhook({ gatewayId, rawBody, signature, headers, parsed });
      if (!out.ok) {
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
      res.json(out);
    } catch (err) {
      handle(res, err);
    }
  },
);

// =============================================================
// Shipping carriers
// =============================================================
const CreateCarrierBody = z.object({
  provider: z.enum(["smsa", "aramex", "saee", "naqel"]),
  displayName: z.string().min(2),
  branchId: z.coerce.number().int().nullable().optional(),
  environment: z.enum(["sandbox", "production"]).default("sandbox"),
  accountNumber: z.string().nullable().optional(),
  isEnabled: z.boolean().default(true),
});

router.get(
  "/integrations/shipping-carriers",
  // Operational roles need to see the list to pick a carrier when
  // creating an AWB from POS / Sales. We project to a minimal,
  // non-sensitive subset (no accountNumber, no settings jsonb) so
  // configuration data stays admin-only.
  requireRole("owner", "manager", "sales", "cashier", "inventory"),
  async (req, res) => {
    const role = req.session?.role;
    const isAdmin = role === "owner" || role === "manager";
    if (isAdmin) {
      res.json(
        await db
          .select()
          .from(shippingCarriersTable)
          .orderBy(shippingCarriersTable.provider),
      );
      return;
    }
    res.json(
      await db
        .select({
          id: shippingCarriersTable.id,
          provider: shippingCarriersTable.provider,
          displayName: shippingCarriersTable.displayName,
          isEnabled: shippingCarriersTable.isEnabled,
          environment: shippingCarriersTable.environment,
        })
        .from(shippingCarriersTable)
        .where(eq(shippingCarriersTable.isEnabled, true))
        .orderBy(shippingCarriersTable.provider),
    );
  },
);

router.post("/integrations/shipping-carriers", adminGuard, async (req, res) => {
  try {
    const b = CreateCarrierBody.parse(req.body);
    const [row] = await db
      .insert(shippingCarriersTable)
      .values({
        provider: b.provider,
        displayName: b.displayName,
        branchId: b.branchId ?? null,
        environment: b.environment,
        accountNumber: b.accountNumber ?? null,
        isEnabled: b.isEnabled,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    handle(res, err);
  }
});

const CreateAwbBody = z.object({
  carrierId: z.coerce.number().int().positive(),
  deliveryOrderRef: z.string().optional(),
  customerId: z.coerce.number().int().positive().optional(),
  toAddress: z.object({
    name: z.string().min(2),
    phone: z.string().min(5),
    line1: z.string().min(3),
    city: z.string().min(2),
    region: z.string().optional(),
    country: z.string().optional(),
    postalCode: z.string().optional(),
  }),
  fromAddress: z.record(z.string(), z.unknown()).optional(),
  weightKg: z.coerce.number().positive(),
  pieces: z.coerce.number().int().positive().optional(),
  cod: z.coerce.number().nonnegative().optional(),
  description: z.string().optional(),
});

router.post(
  "/integrations/shipments",
  // Shipment / AWB creation is a daily operational action — cashiers
  // book outgoing parcels from the POS receipt panel and sales reps
  // dispatch them from the deliveries tab. Inventory dispatchers also
  // need it. Keep carrier *configuration* admin-only above; only the
  // act of creating an AWB is broader.
  requireRole("owner", "manager", "sales", "cashier", "inventory"),
  async (req, res) => {
  try {
    const b = CreateAwbBody.parse(req.body);
    const out = await createAwb(b);
    res.status(201).json(out);
  } catch (err) {
    handle(res, err);
  }
});

router.get(
  "/integrations/shipments/:id/tracking",
  adminGuard,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const events = await pollTracking(id);
      const [shipment] = await db
        .select()
        .from(shipmentsTable)
        .where(eq(shipmentsTable.id, id));
      if (!shipment) {
        res.status(404).json({ error: "الشحنة غير موجودة" });
        return;
      }
      res.json({
        shipmentId: id,
        awbNumber: shipment.awbNumber,
        status: shipment.status,
        eventsRefreshed: events,
        history: shipment.trackingHistory,
      });
    } catch (err) {
      handle(res, err);
    }
  },
);

router.get("/integrations/shipments", adminGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(shipmentsTable)
    .orderBy(desc(shipmentsTable.createdAt))
    .limit(100);
  res.json(rows);
});

// =============================================================
// Messaging — WhatsApp + SMS
// =============================================================
const SendMessageBody = z.object({
  channel: z.enum(["whatsapp", "sms"]),
  provider: z.enum(["whatsapp", "unifonic", "mobily", "taqnyat"]),
  to: z.string().min(5),
  body: z.string().min(1),
  templateName: z.string().optional(),
  variables: z.record(z.string(), z.string()).optional(),
  branchId: z.coerce.number().int().nullable().optional(),
  // WhatsApp-only attachment fields. When mediaUrl is present
  // the adapter sends a `document` message (used for invoice /
  // payslip PDFs); SMS providers ignore these.
  mediaUrl: z.string().url().optional(),
  mediaFilename: z.string().min(1).max(255).optional(),
  mediaCaption: z.string().min(1).max(1024).optional(),
});

// Per-role outbound messaging rate limit. Marketing/sales staff get
// a tighter cap to prevent accidental blasts; managers and owners
// get more headroom for operational broadcasts.
const messagingLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    req.session?.userId ? `msg:user:${req.session.userId}` : `msg:ip:${ipKeyGenerator(req.ip ?? "")}`,
  max: (req) => {
    const role = req.session?.role;
    if (role === "owner" || role === "manager") return 1000;
    if (role === "accountant") return 200;
    if (role === "marketing" || role === "sales") return 100;
    return 30;
  },
  message: {
    error: "تجاوزت الحد المسموح به للرسائل في هذه الساعة",
    code: "RATE_LIMITED",
  },
});

router.post(
  "/integrations/messages",
  requireRole("owner", "manager", "marketing", "sales", "accountant"),
  messagingLimiter,
  async (req, res) => {
  try {
    const b = SendMessageBody.parse(req.body);
    const out = await sendMessage(b);
    res.status(201).json(out);
  } catch (err) {
    handle(res, err);
  }
});

router.get("/integrations/messages", adminGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(outboundMessagesTable)
    .orderBy(desc(outboundMessagesTable.createdAt))
    .limit(100);
  res.json(rows);
});

const CreateTemplateBody = z.object({
  branchId: z.coerce.number().int().nullable().optional(),
  name: z.string().min(2),
  languageCode: z.string().default("ar"),
  category: z.enum(["UTILITY", "MARKETING", "AUTHENTICATION"]).default("UTILITY"),
  bodyTemplate: z.string().min(2),
  variableHints: z
    .array(z.object({ name: z.string(), example: z.string() }))
    .optional(),
  status: z.enum(["pending", "approved", "rejected", "paused"]).default("pending"),
});

router.get("/integrations/whatsapp-templates", adminGuard, async (_req, res) => {
  res.json(await db.select().from(whatsappTemplatesTable).orderBy(whatsappTemplatesTable.name));
});

router.post("/integrations/whatsapp-templates", adminGuard, async (req, res) => {
  try {
    const b = CreateTemplateBody.parse(req.body);
    const [row] = await db
      .insert(whatsappTemplatesTable)
      .values({
        branchId: b.branchId ?? null,
        name: b.name,
        languageCode: b.languageCode,
        category: b.category,
        bodyTemplate: b.bodyTemplate,
        variableHints: b.variableHints ?? null,
        status: b.status,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    handle(res, err);
  }
});

const UpdateTemplateBody = z.object({
  bodyTemplate: z.string().min(2).optional(),
  status: z.enum(["pending", "approved", "rejected", "paused"]).optional(),
  category: z.enum(["UTILITY", "MARKETING", "AUTHENTICATION"]).optional(),
  languageCode: z.string().optional(),
  variableHints: z
    .array(z.object({ name: z.string(), example: z.string() }))
    .optional(),
});

router.patch("/integrations/whatsapp-templates/:id", adminGuard, async (req, res) => {
  try {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const b = UpdateTemplateBody.parse(req.body);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (b.bodyTemplate !== undefined) patch.bodyTemplate = b.bodyTemplate;
    if (b.status !== undefined) patch.status = b.status;
    if (b.category !== undefined) patch.category = b.category;
    if (b.languageCode !== undefined) patch.languageCode = b.languageCode;
    if (b.variableHints !== undefined) patch.variableHints = b.variableHints;
    const [row] = await db
      .update(whatsappTemplatesTable)
      .set(patch)
      .where(eq(whatsappTemplatesTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "القالب غير موجود" });
      return;
    }
    res.json(row);
  } catch (err) {
    handle(res, err);
  }
});

router.delete("/integrations/whatsapp-templates/:id", adminGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await db
      .delete(whatsappTemplatesTable)
      .where(eq(whatsappTemplatesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    handle(res, err);
  }
});

/**
 * Seed/sync the built-in event templates (`invoice_issued`,
 * `shipment_dispatched`, `low_stock_alert`). Idempotent — only
 * inserts rows that don't already exist for the given branch
 * scope. Returns the catalogue plus how many were newly inserted.
 */
router.post("/integrations/whatsapp-templates/sync", adminGuard, async (req, res) => {
  try {
    const branchId = z.coerce
      .number()
      .int()
      .nullable()
      .optional()
      .parse(req.body?.branchId ?? null);
    const inserted = await seedDefaultTemplates(branchId ?? null);
    res.json({ ok: true, inserted, defaults: DEFAULT_TEMPLATES });
  } catch (err) {
    handle(res, err);
  }
});

// =============================================================
// ZATCA Phase 2
// =============================================================
const CreateCsrBody = z.object({
  branchId: z.coerce.number().int().nullable().optional(),
  commonName: z.string().min(2),
  vatNumber: z.string().regex(/^\d{15}$/, "VAT number must be 15 digits"),
  organizationName: z.string().min(2),
  environment: z.enum(["sandbox", "production"]).default("sandbox"),
});

router.post("/integrations/zatca/csr", ownerOnly, async (req, res) => {
  try {
    const b = CreateCsrBody.parse(req.body);
    const out = await createCsr({
      branchId: b.branchId ?? null,
      commonName: b.commonName,
      vatNumber: b.vatNumber,
      organizationName: b.organizationName,
      environment: b.environment,
    });
    res.status(201).json(out);
  } catch (err) {
    handle(res, err);
  }
});

const AttachCsidBody = z.object({
  certificateId: z.coerce.number().int().positive(),
  csid: z.string().min(2),
  certificatePem: z.string().min(20),
});

router.post("/integrations/zatca/csid", ownerOnly, async (req, res) => {
  try {
    const b = AttachCsidBody.parse(req.body);
    await attachCsid(b);
    res.json({ ok: true });
  } catch (err) {
    handle(res, err);
  }
});

router.post("/integrations/zatca/pcsid", ownerOnly, async (req, res) => {
  try {
    const b = z
      .object({ certificateId: z.coerce.number().int().positive(), pcsid: z.string().min(2) })
      .parse(req.body);
    await attachPcsid(b);
    res.json({ ok: true });
  } catch (err) {
    handle(res, err);
  }
});

// Real CSID retrieval — POSTs the stored CSR to the ZATCA
// Compliance API using the OTP issued in the Fatoora portal.
router.post("/integrations/zatca/csid/retrieve", ownerOnly, async (req, res) => {
  try {
    const b = z
      .object({
        certificateId: z.coerce.number().int().positive(),
        otp: z.string().min(4),
      })
      .parse(req.body);
    const out = await retrieveCsid(b);
    res.status(201).json(out);
  } catch (err) {
    handle(res, err);
  }
});

// Real PCSID retrieval — exchanges the compliance CSID for a
// production CSID after the seller has passed compliance checks.
router.post("/integrations/zatca/pcsid/retrieve", ownerOnly, async (req, res) => {
  try {
    const b = z
      .object({ certificateId: z.coerce.number().int().positive() })
      .parse(req.body);
    const out = await retrievePcsid(b);
    res.status(201).json(out);
  } catch (err) {
    handle(res, err);
  }
});

router.get("/integrations/zatca/certificates", adminGuard, async (_req, res) => {
  const rows = await db
    .select({
      id: zatcaCertificatesTable.id,
      branchId: zatcaCertificatesTable.branchId,
      environment: zatcaCertificatesTable.environment,
      status: zatcaCertificatesTable.status,
      csid: zatcaCertificatesTable.csid,
      pcsid: zatcaCertificatesTable.pcsid,
      expiresAt: zatcaCertificatesTable.expiresAt,
      createdAt: zatcaCertificatesTable.createdAt,
    })
    .from(zatcaCertificatesTable)
    .orderBy(desc(zatcaCertificatesTable.id));
  res.json(rows);
});

router.get("/integrations/zatca/invoices", adminGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(zatcaInvoicesTable)
    .orderBy(desc(zatcaInvoicesTable.id))
    .limit(100);
  res.json(rows);
});

const SubmitInvoiceBody = z.object({
  invoiceId: z.coerce.number().int().positive(),
  invoiceType: z.enum(["standard", "simplified"]).default("simplified"),
  buyerName: z.string().nullable().optional(),
  buyerVat: z.string().nullable().optional(),
  branchId: z.coerce.number().int().nullable().optional(),
});

// Submitting invoices to ZATCA is a legally-binding act under KSA tax
// law. Restrict to owner + accountant (the same set that posts to GL).
router.post("/integrations/zatca/submit", requireRole("owner", "accountant"), async (req, res) => {
  try {
    const b = SubmitInvoiceBody.parse(req.body);
    // ZATCA must clear/report CUSTOMER tax invoices (sales side),
    // not the AP/supplier invoices captured via the OCR scanner.
    const [inv] = await db
      .select()
      .from(customerInvoicesTable)
      .where(eq(customerInvoicesTable.id, b.invoiceId));
    if (!inv) {
      res.status(404).json({ error: "الفاتورة غير موجودة" });
      return;
    }
    const subtotal = Number(inv.subtotal);
    const vatAmount = Number(inv.vat);
    const total = Number(inv.total);
    const company = await getCompanyInfo();
    const out = await processInvoiceForZatca({
      invoiceId: inv.id,
      invoiceNumber: inv.reference,
      issueDate: new Date(inv.invoiceDate),
      invoiceType: b.invoiceType,
      sellerName:
        company.nameAr && company.nameAr !== "—"
          ? company.nameAr
          : process.env["ZATCA_SELLER_NAME"] ?? "حاسبة AI",
      sellerVat:
        company.vatNumber && company.vatNumber !== "—"
          ? company.vatNumber
          : process.env["ZATCA_VAT_NUMBER"] ?? "300000000000003",
      buyerName: b.buyerName ?? inv.customerName,
      buyerVat: b.buyerVat ?? null,
      totalExclVat: Number(subtotal.toFixed(2)),
      vatAmount: Number(vatAmount.toFixed(2)),
      totalInclVat: total,
      branchId: b.branchId ?? inv.branchId ?? null,
    });
    res.status(201).json(out);
  } catch (err) {
    handle(res, err);
  }
});

// =============================================================
// E-commerce marketplaces (Salla / Zid / Shopify)
// =============================================================
const MarketplacePlatform = z.enum(["salla", "zid", "shopify"]);

const CreateConnectorBody = z.object({
  platform: MarketplacePlatform,
  displayName: z.string().min(2).max(80),
  branchId: z.coerce.number().int().nullable().optional(),
  storeUrl: z.string().url().nullable().optional(),
  environment: z.enum(["sandbox", "production"]).default("production"),
  defaultWarehouseId: z.coerce.number().int().nullable().optional(),
  webhookSecret: z.string().min(8).max(200).nullable().optional(),
  accessToken: z.string().min(4).max(500).nullable().optional(),
  apiKey: z.string().min(4).max(500).nullable().optional(),
});

const UpdateConnectorBody = z.object({
  displayName: z.string().min(2).max(80).optional(),
  storeUrl: z.string().url().nullable().optional(),
  environment: z.enum(["sandbox", "production"]).optional(),
  defaultWarehouseId: z.coerce.number().int().nullable().optional(),
  webhookSecret: z.string().min(8).max(200).nullable().optional(),
  isEnabled: z.boolean().optional(),
  accessToken: z.string().min(4).max(500).nullable().optional(),
  apiKey: z.string().min(4).max(500).nullable().optional(),
});

router.get("/integrations/marketplaces", inventoryGuard, async (_req, res) => {
  const rows = await db
    .select()
    .from(marketplaceConnectorsTable)
    .orderBy(marketplaceConnectorsTable.platform, marketplaceConnectorsTable.displayName);
  res.json(rows);
});

router.post("/integrations/marketplaces", adminGuard, async (req, res) => {
  try {
    const b = CreateConnectorBody.parse(req.body);
    const [row] = await db
      .insert(marketplaceConnectorsTable)
      .values({
        platform: b.platform,
        displayName: b.displayName,
        branchId: b.branchId ?? null,
        storeUrl: b.storeUrl ?? null,
        environment: b.environment,
        defaultWarehouseId: b.defaultWarehouseId ?? null,
        // Webhook signing secret is credential material — encrypt at rest.
        webhookSecret: b.webhookSecret ? encryptSecret(b.webhookSecret) : null,
      })
      .returning();
    if (b.accessToken || b.apiKey) {
      const { credentialLabelForConnector } = await import("../lib/integrations/marketplaces");
      await upsertCredential({
        provider: b.platform,
        branchId: b.branchId ?? null,
        label: credentialLabelForConnector(row!.id),
        environment: b.environment,
        secret: { access_token: b.accessToken ?? null, api_key: b.apiKey ?? null },
      });
    }
    res.status(201).json(row);
  } catch (err) {
    handle(res, err);
  }
});

router.patch("/integrations/marketplaces/:id", adminGuard, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const b = UpdateConnectorBody.parse(req.body);
    const [existing] = await db
      .select()
      .from(marketplaceConnectorsTable)
      .where(eq(marketplaceConnectorsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const patch: Partial<typeof marketplaceConnectorsTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (b.displayName !== undefined) patch.displayName = b.displayName;
    if (b.storeUrl !== undefined) patch.storeUrl = b.storeUrl;
    if (b.environment !== undefined) patch.environment = b.environment;
    if (b.defaultWarehouseId !== undefined) patch.defaultWarehouseId = b.defaultWarehouseId;
    if (b.webhookSecret !== undefined) {
      patch.webhookSecret = b.webhookSecret ? encryptSecret(b.webhookSecret) : null;
    }
    if (b.isEnabled !== undefined) patch.isEnabled = b.isEnabled;
    const [row] = await db
      .update(marketplaceConnectorsTable)
      .set(patch)
      .where(eq(marketplaceConnectorsTable.id, id))
      .returning();
    if (b.accessToken || b.apiKey) {
      const { credentialLabelForConnector } = await import("../lib/integrations/marketplaces");
      await upsertCredential({
        provider: existing.platform,
        branchId: existing.branchId,
        label: credentialLabelForConnector(id),
        environment: row!.environment === "production" ? "production" : "sandbox",
        secret: { access_token: b.accessToken ?? null, api_key: b.apiKey ?? null },
      });
    }
    res.json(row);
  } catch (err) {
    handle(res, err);
  }
});

router.delete("/integrations/marketplaces/:id", adminGuard, async (req, res) => {
  const id = Number(req.params.id);
  await db.delete(marketplaceConnectorsTable).where(eq(marketplaceConnectorsTable.id, id));
  res.json({ ok: true });
});

router.post(
  "/integrations/marketplaces/:id/push-catalogue",
  inventoryGuard,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [c] = await db
        .select()
        .from(marketplaceConnectorsTable)
        .where(eq(marketplaceConnectorsTable.id, id));
      if (!c) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const productIds = z
        .object({ productIds: z.array(z.coerce.number().int()).optional() })
        .parse(req.body ?? {});
      const { pushCatalogue } = await import("../lib/integrations/marketplaces");
      const out = await pushCatalogue(c, productIds.productIds);
      res.json(out);
    } catch (err) {
      handle(res, err);
    }
  },
);

router.post(
  "/integrations/marketplaces/:id/sync-orders",
  inventoryGuard,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [c] = await db
        .select()
        .from(marketplaceConnectorsTable)
        .where(eq(marketplaceConnectorsTable.id, id));
      if (!c) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const { syncOrdersForConnector } = await import("../lib/integrations/marketplaces");
      const out = await syncOrdersForConnector(c);
      res.json(out);
    } catch (err) {
      handle(res, err);
    }
  },
);

router.get("/integrations/marketplaces/:id/logs", inventoryGuard, async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db
    .select()
    .from(marketplaceSyncLogsTable)
    .where(eq(marketplaceSyncLogsTable.connectorId, id))
    .orderBy(desc(marketplaceSyncLogsTable.createdAt))
    .limit(100);
  res.json(rows);
});

router.get("/integrations/marketplaces/:id/mappings", inventoryGuard, async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db
    .select()
    .from(marketplaceProductMappingsTable)
    .where(eq(marketplaceProductMappingsTable.connectorId, id))
    .orderBy(desc(marketplaceProductMappingsTable.lastPushedAt));
  res.json(rows);
});

router.get("/integrations/marketplaces/:id/orders", inventoryGuard, async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db
    .select()
    .from(marketplaceOrderImportsTable)
    .where(eq(marketplaceOrderImportsTable.connectorId, id))
    .orderBy(desc(marketplaceOrderImportsTable.createdAt))
    .limit(100);
  res.json(rows);
});

router.post(
  "/integrations/marketplaces/:id/push-inventory",
  inventoryGuard,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const [c] = await db
        .select()
        .from(marketplaceConnectorsTable)
        .where(eq(marketplaceConnectorsTable.id, id));
      if (!c) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const mappings = await db
        .select()
        .from(marketplaceProductMappingsTable)
        .where(eq(marketplaceProductMappingsTable.connectorId, id));
      const { broadcastInventoryChange } = await import("../lib/integrations/marketplaces");
      for (const m of mappings) broadcastInventoryChange(m.productId);
      res.json({ scheduled: mappings.length });
    } catch (err) {
      handle(res, err);
    }
  },
);

router.post(
  "/integrations/marketplaces/logs/:id/retry",
  inventoryGuard,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { retrySyncLog } = await import("../lib/integrations/marketplaces");
      const out = await retrySyncLog(id);
      if (!out.ok) {
        res.status(400).json(out);
        return;
      }
      res.json(out);
    } catch (err) {
      handle(res, err);
    }
  },
);

// Public webhook endpoint for marketplace events. Mounted with a raw
// body parser in app.ts so HMAC verification sees pristine bytes.
integrationsPublicRouter.post(
  "/integrations/marketplaces/webhook/:connectorId",
  async (req, res) => {
    try {
      const connectorId = Number(req.params.connectorId);
      const [connector] = await db
        .select()
        .from(marketplaceConnectorsTable)
        .where(eq(marketplaceConnectorsTable.id, connectorId));
      if (!connector || !connector.isEnabled) {
        res.status(404).json({ error: "not_found" });
        return;
      }
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
      const headers: Record<string, string | string[] | undefined> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k.toLowerCase()] = v;
      }
      const { getAdapter, importOrder } = await import("../lib/integrations/marketplaces");
      const adapter = getAdapter(connector.platform);
      const parsed = adapter.parseWebhook(connector, headers, rawBody);
      if (parsed.kind === "invalid_signature") {
        await db.insert(marketplaceSyncLogsTable).values({
          connectorId: connector.id,
          operation: "webhook",
          direction: "inbound",
          success: false,
          errorMessage: "invalid_signature",
        });
        res.status(401).json({ error: "invalid_signature" });
        return;
      }
      if (parsed.kind === "ignored") {
        // Valid signature but unsubscribed/unhandled topic. Return 2xx
        // so providers do not retry; log as inbound success for audit.
        await db.insert(marketplaceSyncLogsTable).values({
          connectorId: connector.id,
          operation: "webhook",
          direction: "inbound",
          success: true,
          errorMessage: "ignored_topic",
        });
        res.json({ ok: true, kind: "ignored" });
        return;
      }
      let importResult: { orderImportId: number; soId: number | null; status: string } | null = null;
      if (parsed.order) {
        importResult = await importOrder(connector, parsed.order);
      }
      await db.insert(marketplaceSyncLogsTable).values({
        connectorId: connector.id,
        operation: "webhook",
        direction: "inbound",
        success: true,
        externalRef: parsed.order?.externalOrderId ?? null,
        payloadSummary: { kind: parsed.kind, result: importResult },
      });
      res.json({ ok: true, kind: parsed.kind, import: importResult });
    } catch (err) {
      handle(res, err);
    }
  },
);

// =============================================================
// Audit log of every external call
// =============================================================
router.get("/integrations/calls", adminGuard, async (req, res) => {
  const provider = req.query.provider ? String(req.query.provider) : null;
  const rows = await db
    .select()
    .from(integrationCallsTable)
    .where(provider ? eq(integrationCallsTable.provider, provider) : sql`true`)
    .orderBy(desc(integrationCallsTable.createdAt))
    .limit(200);
  res.json(rows);
});

export default router;
