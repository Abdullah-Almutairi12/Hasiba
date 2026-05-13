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
} from "@workspace/db";
import { adminGuard, ownerOnly, requireRole } from "../middlewares/require-role";
import { upsertCredential } from "../lib/integrations/credentials";
import { encryptSecret } from "../lib/integrations/crypto";
import { createCheckout, handleWebhook, refundIntent } from "../lib/integrations/payments";
import { createAwb, pollTracking, getPublicTracking } from "../lib/integrations/shipping";
import { sendMessage } from "../lib/integrations/messaging";
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
    const out = await processInvoiceForZatca({
      invoiceId: inv.id,
      invoiceNumber: inv.reference,
      issueDate: new Date(inv.invoiceDate),
      invoiceType: b.invoiceType,
      sellerName: process.env["ZATCA_SELLER_NAME"] ?? "حاسبة AI",
      sellerVat: process.env["ZATCA_VAT_NUMBER"] ?? "300000000000003",
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
