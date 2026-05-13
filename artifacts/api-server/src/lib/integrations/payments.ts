import { createHmac, timingSafeEqual } from "node:crypto";
import { db, paymentGatewaysTable, paymentIntentsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { getCredential, MissingCredentialError } from "./credentials";
import { recordIntegrationCall } from "./audit";
import { decryptSecret } from "./crypto";
import { postPaymentReceiptToLedger } from "./ledger";

export type PaymentProvider =
  | "moyasar"
  | "tap"
  | "hyperpay"
  | "stcpay"
  | "mada"
  | "paytabs";

export interface CheckoutRequest {
  gatewayId: number;
  amount: number;
  currency?: string;
  description: string;
  customerEmail?: string;
  customerName?: string;
  invoiceId?: number;
  customerId?: number;
  callbackUrl: string;
  metadata?: Record<string, string>;
}

export interface CheckoutResult {
  intentId: number;
  providerRef: string | null;
  checkoutUrl: string | null;
  status: "pending" | "authorized" | "captured" | "failed";
}

interface AdapterContext {
  gateway: typeof paymentGatewaysTable.$inferSelect;
  secret: Record<string, string>;
}

interface AdapterCheckoutResult {
  providerRef: string | null;
  checkoutUrl: string | null;
  status: CheckoutResult["status"];
  raw: Record<string, unknown>;
}

interface PaymentAdapter {
  checkout(req: CheckoutRequest, ctx: AdapterContext): Promise<AdapterCheckoutResult>;
  refund(args: { providerRef: string; amount: number }, ctx: AdapterContext): Promise<{
    refundRef: string;
    raw: Record<string, unknown>;
  }>;
  verifyWebhook(rawBody: string, signature: string | undefined, ctx: AdapterContext): boolean;
}

function getWebhookSecret(gw: typeof paymentGatewaysTable.$inferSelect): string | null {
  if (!gw.webhookSecret) return null;
  try {
    return decryptSecret(gw.webhookSecret);
  } catch {
    return gw.webhookSecret;
  }
}

function safeHmacEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Normalise the signature value carried in a provider's webhook
 * header before comparing it against the locally-computed HMAC.
 *
 * Real-world quirks this handles:
 *   - Some providers prefix the value (`sha256=...`, `hmac-sha256=...`).
 *   - Whitespace is sometimes added by intermediaries.
 *   - Hex digests may arrive upper- or lower-case.
 *
 * Comparing raw UTF-8 bytes of two strings that *should* be the
 * same hex/base64 digest is fragile — a single case mismatch or a
 * stray prefix will silently flip the verifier to false. We always
 * decode both sides to raw bytes of the expected encoding before
 * the timing-safe compare.
 */
function normaliseSignatureHeader(raw: string): string {
  const trimmed = raw.trim();
  const eq = trimmed.indexOf("=");
  if (eq > 0 && eq < 16 && /^[a-zA-Z0-9_-]+$/.test(trimmed.slice(0, eq))) {
    return trimmed.slice(eq + 1);
  }
  return trimmed;
}

function hmacEqualEncoded(
  computedBytes: Buffer,
  providedHeader: string,
  encoding: "hex" | "base64",
): boolean {
  const provided = normaliseSignatureHeader(providedHeader);
  let providedBytes: Buffer;
  try {
    providedBytes =
      encoding === "hex"
        ? Buffer.from(provided.toLowerCase(), "hex")
        : Buffer.from(provided, "base64");
  } catch {
    return false;
  }
  if (providedBytes.length !== computedBytes.length) return false;
  return safeHmacEqual(computedBytes, providedBytes);
}

function hmacWebhook(rawBody: string, signature: string | undefined, ctx: AdapterContext): boolean {
  const secret = getWebhookSecret(ctx.gateway);
  if (!secret || !signature) return false;
  const computed = createHmac("sha256", secret).update(rawBody).digest();
  return hmacEqualEncoded(computed, signature, "hex");
}

/**
 * Provider-specific webhook verifier. Each gateway publishes a
 * different signature scheme — the header name, the payload that
 * gets signed, and the encoding of the signature all vary.
 *
 * - Moyasar: SHA-256 HMAC of raw body, hex, header `x-moyasar-signature`.
 * - Tap: SHA-256 HMAC of raw body, hex, header `tap-signature` (or `hashstring`).
 * - HyperPay/mada: a shared-secret token compared against header
 *   `x-webhook-secret` (OPPWA does not sign payloads — they
 *   recommend allow-listing IPs + a static shared token).
 * - PayTabs: SHA-256 HMAC, hex, header `signature` (PayTabs canonical).
 * - STC Pay: SHA-256 HMAC of raw body, base64, header `x-stc-signature`.
 */
function providerWebhookVerifier(
  provider: string,
): (rawBody: string, headers: Record<string, string | undefined>, ctx: AdapterContext) => boolean {
  switch (provider) {
    case "moyasar":
      return (raw, h, ctx) => hmacWebhook(raw, h["x-moyasar-signature"], ctx);
    case "tap":
      return (raw, h, ctx) =>
        hmacWebhook(raw, h["tap-signature"] ?? h["hashstring"], ctx);
    case "hyperpay":
    case "mada": {
      return (_raw, h, ctx) => {
        const secret = getWebhookSecret(ctx.gateway);
        const token = h["x-webhook-secret"]?.trim();
        if (!secret || !token) return false;
        const a = Buffer.from(secret, "utf8");
        const b = Buffer.from(token, "utf8");
        if (a.length !== b.length) return false;
        return safeHmacEqual(a, b);
      };
    }
    case "paytabs":
      return (raw, h, ctx) => hmacWebhook(raw, h["signature"], ctx);
    case "stcpay":
      return (raw, h, ctx) => {
        const secret = getWebhookSecret(ctx.gateway);
        const sig = h["x-stc-signature"];
        if (!secret || !sig) return false;
        const computed = createHmac("sha256", secret).update(raw).digest();
        return hmacEqualEncoded(computed, sig, "base64");
      };
    default:
      return (raw, h, ctx) =>
        hmacWebhook(raw, h["x-signature"] ?? h["signature"], ctx);
  }
}

/**
 * Map a provider's raw status string to one of three settlement
 * verdicts we care about for ledger posting:
 *   "settled"   → the funds are captured and may be posted to the GL
 *   "authorized"→ a hold-only event; do NOT post to the GL
 *   "ignore"    → all other transitions (pending, processing, etc.)
 *
 * Defaulting to "ignore" for unknown / missing statuses prevents
 * the previously-reported false-positive ledger postings when a
 * webhook payload omits a status field.
 */
function classifyWebhookStatus(provider: string, raw: string | undefined):
  | "settled"
  | "authorized"
  | "failed"
  | "ignore" {
  if (!raw) return "ignore";
  const s = raw.toLowerCase();
  // Authorize-only events are gateway-specific. We never treat
  // them as settled — capture must arrive as a separate event.
  if (s === "authorized" || s === "auth_ok" || s === "authorised") return "authorized";
  if (s === "failed" || s === "declined" || s === "void") return "failed";
  switch (provider) {
    case "moyasar":
      return s === "paid" ? "settled" : "ignore";
    case "tap":
      return s === "captured" ? "settled" : "ignore";
    case "hyperpay":
    case "mada":
      // OPPWA result codes "000.000.000" / "000.100.110" → success
      return s.startsWith("000.000") || s.startsWith("000.100.1") ? "settled" : "ignore";
    case "paytabs":
      return s === "a" || s === "approved" || s === "completed" ? "settled" : "ignore";
    case "stcpay":
      return s === "paid" || s === "completed" ? "settled" : "ignore";
    default:
      return s === "captured" || s === "paid" || s === "succeeded" || s === "completed"
        ? "settled"
        : "ignore";
  }
}

async function audited<T>(args: {
  ctx: AdapterContext;
  endpoint: string;
  method: string;
  fn: () => Promise<{ res: Response; body: T }>;
}): Promise<{ res: Response; body: T }> {
  const t0 = Date.now();
  try {
    const out = await args.fn();
    await recordIntegrationCall({
      branchId: args.ctx.gateway.branchId,
      provider: args.ctx.gateway.provider,
      endpoint: args.endpoint,
      method: args.method,
      statusCode: out.res.status,
      durationMs: Date.now() - t0,
      success: out.res.ok,
      errorMessage: out.res.ok
        ? null
        : ((out.body as Record<string, unknown>)?.["message"] as string | undefined) ??
          `HTTP ${out.res.status}`,
    });
    return out;
  } catch (e) {
    await recordIntegrationCall({
      branchId: args.ctx.gateway.branchId,
      provider: args.ctx.gateway.provider,
      endpoint: args.endpoint,
      method: args.method,
      durationMs: Date.now() - t0,
      success: false,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/* ------------------------------- Moyasar -------------------------------- */
const moyasarAdapter: PaymentAdapter = {
  async checkout(req, ctx) {
    const apiKey = ctx.secret.secretApiKey ?? ctx.secret.apiKey;
    if (!apiKey) throw new MissingCredentialError("moyasar.secretApiKey");
    const { res, body } = await audited<{ id?: string; url?: string; status?: string; message?: string }>({
      ctx,
      endpoint: "/v1/invoices",
      method: "POST",
      fn: async () => {
        const r = await fetch("https://api.moyasar.com/v1/invoices", {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: Math.round(req.amount * 100),
            currency: req.currency ?? "SAR",
            description: req.description,
            callback_url: req.callbackUrl,
            metadata: req.metadata ?? {},
          }),
        });
        return { res: r, body: (await r.json().catch(() => ({}))) as never };
      },
    });
    if (!res.ok) throw new Error(body.message ?? `Moyasar checkout failed: HTTP ${res.status}`);
    return { providerRef: body.id ?? null, checkoutUrl: body.url ?? null, status: "pending", raw: body };
  },
  async refund(args, ctx) {
    const apiKey = ctx.secret.secretApiKey ?? ctx.secret.apiKey;
    if (!apiKey) throw new MissingCredentialError("moyasar.secretApiKey");
    const { res, body } = await audited<{ id?: string; message?: string }>({
      ctx,
      endpoint: `/v1/payments/${args.providerRef}/refund`,
      method: "POST",
      fn: async () => {
        const r = await fetch(`https://api.moyasar.com/v1/payments/${args.providerRef}/refund`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ amount: Math.round(args.amount * 100) }),
        });
        return { res: r, body: (await r.json().catch(() => ({}))) as never };
      },
    });
    if (!res.ok) throw new Error(body.message ?? `Moyasar refund failed: HTTP ${res.status}`);
    return { refundRef: body.id ?? args.providerRef, raw: body };
  },
  verifyWebhook: hmacWebhook,
};

/* --------------------------------- Tap ---------------------------------- */
const tapAdapter: PaymentAdapter = {
  async checkout(req, ctx) {
    const secretKey = ctx.secret.secretKey;
    if (!secretKey) throw new MissingCredentialError("tap.secretKey");
    const { res, body } = await audited<{
      id?: string;
      transaction?: { url?: string };
      status?: string;
      message?: string;
    }>({
      ctx,
      endpoint: "/v2/charges",
      method: "POST",
      fn: async () => {
        const r = await fetch("https://api.tap.company/v2/charges", {
          method: "POST",
          headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: req.amount,
            currency: req.currency ?? "SAR",
            customer: { email: req.customerEmail, first_name: req.customerName },
            source: { id: "src_all" },
            redirect: { url: req.callbackUrl },
            description: req.description,
            metadata: req.metadata ?? {},
          }),
        });
        return { res: r, body: (await r.json().catch(() => ({}))) as never };
      },
    });
    if (!res.ok) throw new Error(body.message ?? `Tap checkout failed: HTTP ${res.status}`);
    return {
      providerRef: body.id ?? null,
      checkoutUrl: body.transaction?.url ?? null,
      status: "pending",
      raw: body,
    };
  },
  async refund(args, ctx) {
    const secretKey = ctx.secret.secretKey;
    if (!secretKey) throw new MissingCredentialError("tap.secretKey");
    const { res, body } = await audited<{ id?: string; message?: string }>({
      ctx,
      endpoint: "/v2/refunds",
      method: "POST",
      fn: async () => {
        const r = await fetch("https://api.tap.company/v2/refunds", {
          method: "POST",
          headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            charge_id: args.providerRef,
            amount: args.amount,
            currency: "SAR",
            reason: "requested_by_customer",
          }),
        });
        return { res: r, body: (await r.json().catch(() => ({}))) as never };
      },
    });
    if (!res.ok) throw new Error(body.message ?? `Tap refund failed: HTTP ${res.status}`);
    return { refundRef: body.id ?? args.providerRef, raw: body };
  },
  verifyWebhook: hmacWebhook,
};

/* ----------------------------- HyperPay/Mada ----------------------------- */
/**
 * HyperPay (also the standard route for mada in production). Both
 * adapters share the same OPPWA-style API.
 */
function hyperPayAdapterFactory(provider: "hyperpay" | "mada"): PaymentAdapter {
  return {
    async checkout(req, ctx) {
      const accessToken = ctx.secret.accessToken;
      const entityId = ctx.secret.entityId;
      if (!accessToken || !entityId) throw new MissingCredentialError(`${provider}.accessToken`);
      const baseUrl =
        ctx.gateway.environment === "production"
          ? "https://oppwa.com"
          : "https://eu-test.oppwa.com";
      const params = new URLSearchParams({
        entityId,
        amount: req.amount.toFixed(2),
        currency: req.currency ?? "SAR",
        paymentType: "DB",
        ...(provider === "mada" ? { paymentBrand: "MADA" } : {}),
      });
      const { res, body } = await audited<{
        id?: string;
        ndc?: string;
        result?: { code?: string; description?: string };
      }>({
        ctx,
        endpoint: "/v1/checkouts",
        method: "POST",
        fn: async () => {
          const r = await fetch(`${baseUrl}/v1/checkouts`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
          });
          return { res: r, body: (await r.json().catch(() => ({}))) as never };
        },
      });
      if (!res.ok || !body.id) {
        throw new Error(body.result?.description ?? `${provider} checkout failed: HTTP ${res.status}`);
      }
      return {
        providerRef: body.id,
        checkoutUrl: `${req.callbackUrl}?checkoutId=${encodeURIComponent(body.id)}`,
        status: "pending",
        raw: body,
      };
    },
    async refund(args, ctx) {
      const accessToken = ctx.secret.accessToken;
      const entityId = ctx.secret.entityId;
      if (!accessToken || !entityId) throw new MissingCredentialError(`${provider}.accessToken`);
      const baseUrl =
        ctx.gateway.environment === "production"
          ? "https://oppwa.com"
          : "https://eu-test.oppwa.com";
      const params = new URLSearchParams({
        entityId,
        amount: args.amount.toFixed(2),
        currency: "SAR",
        paymentType: "RF",
      });
      const { res, body } = await audited<{ id?: string; result?: { description?: string } }>({
        ctx,
        endpoint: `/v1/payments/${args.providerRef}`,
        method: "POST",
        fn: async () => {
          const r = await fetch(`${baseUrl}/v1/payments/${args.providerRef}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: params.toString(),
          });
          return { res: r, body: (await r.json().catch(() => ({}))) as never };
        },
      });
      if (!res.ok) throw new Error(body.result?.description ?? `${provider} refund failed`);
      return { refundRef: body.id ?? args.providerRef, raw: body };
    },
    verifyWebhook: hmacWebhook,
  };
}

/* ------------------------------- STC Pay -------------------------------- */
const stcPayAdapter: PaymentAdapter = {
  async checkout(req, ctx) {
    const apiKey = ctx.secret.apiKey;
    const merchantId = ctx.secret.merchantId;
    if (!apiKey || !merchantId) throw new MissingCredentialError("stcpay.apiKey");
    const baseUrl =
      ctx.gateway.environment === "production"
        ? "https://b2b.stcpay.com.sa/B2B.DirectPayment.WebApi"
        : "https://b2btest.stcpay.com.sa/B2B.DirectPayment.WebApi";
    const { res, body } = await audited<{
      Result?: { ResultStatus?: string };
      PaymentId?: string;
      RedirectUrl?: string;
    }>({
      ctx,
      endpoint: "/api/MerchantPaymentInitiation/CreateMobilePayment",
      method: "POST",
      fn: async () => {
        const r = await fetch(
          `${baseUrl}/api/MerchantPaymentInitiation/CreateMobilePayment`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              MerchantId: merchantId,
              MerchantNoteForCustomer: req.description,
              Amount: req.amount,
              MobileCountryCode: "966",
              MobileNo: ctx.secret.customerMobile ?? "500000000",
              ExpiryDuration: "00:30:00",
              Branch: { BranchId: ctx.gateway.branchId ?? 1, BranchName: "Main" },
              SuccessfulRedirectURL: req.callbackUrl,
              FailRedirectURL: req.callbackUrl,
            }),
          },
        );
        return { res: r, body: (await r.json().catch(() => ({}))) as never };
      },
    });
    if (!res.ok || body.Result?.ResultStatus !== "Successful") {
      throw new Error(`STC Pay checkout failed: HTTP ${res.status}`);
    }
    return {
      providerRef: body.PaymentId ?? null,
      checkoutUrl: body.RedirectUrl ?? null,
      status: "pending",
      raw: body,
    };
  },
  async refund(args, ctx) {
    const apiKey = ctx.secret.apiKey;
    if (!apiKey) throw new MissingCredentialError("stcpay.apiKey");
    const baseUrl =
      ctx.gateway.environment === "production"
        ? "https://b2b.stcpay.com.sa/B2B.DirectPayment.WebApi"
        : "https://b2btest.stcpay.com.sa/B2B.DirectPayment.WebApi";
    const { res, body } = await audited<{ Result?: { ResultStatus?: string }; RefundId?: string }>({
      ctx,
      endpoint: "/api/MerchantPaymentInitiation/DirectRefundPayment",
      method: "POST",
      fn: async () => {
        const r = await fetch(
          `${baseUrl}/api/MerchantPaymentInitiation/DirectRefundPayment`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              RefundAmount: args.amount,
              StcPayPmtReference: args.providerRef,
              MerchantId: ctx.secret.merchantId,
            }),
          },
        );
        return { res: r, body: (await r.json().catch(() => ({}))) as never };
      },
    });
    if (!res.ok) throw new Error(`STC Pay refund failed: HTTP ${res.status}`);
    return { refundRef: body.RefundId ?? args.providerRef, raw: body };
  },
  verifyWebhook: hmacWebhook,
};

/* ------------------------------- PayTabs -------------------------------- */
const payTabsAdapter: PaymentAdapter = {
  async checkout(req, ctx) {
    const serverKey = ctx.secret.serverKey;
    const profileId = ctx.secret.profileId;
    if (!serverKey || !profileId) throw new MissingCredentialError("paytabs.serverKey");
    const { res, body } = await audited<{
      tran_ref?: string;
      redirect_url?: string;
      message?: string;
    }>({
      ctx,
      endpoint: "/payment/request",
      method: "POST",
      fn: async () => {
        const r = await fetch("https://secure.paytabs.sa/payment/request", {
          method: "POST",
          headers: { Authorization: serverKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            profile_id: profileId,
            tran_type: "sale",
            tran_class: "ecom",
            cart_id: `inv-${req.invoiceId ?? Date.now()}`,
            cart_currency: req.currency ?? "SAR",
            cart_amount: req.amount,
            cart_description: req.description,
            callback: req.callbackUrl,
            return: req.callbackUrl,
            customer_details: {
              name: req.customerName ?? "Customer",
              email: req.customerEmail ?? "noreply@example.com",
            },
          }),
        });
        return { res: r, body: (await r.json().catch(() => ({}))) as never };
      },
    });
    if (!res.ok || !body.tran_ref) {
      throw new Error(body.message ?? `PayTabs checkout failed: HTTP ${res.status}`);
    }
    return {
      providerRef: body.tran_ref,
      checkoutUrl: body.redirect_url ?? null,
      status: "pending",
      raw: body,
    };
  },
  async refund(args, ctx) {
    const serverKey = ctx.secret.serverKey;
    const profileId = ctx.secret.profileId;
    if (!serverKey || !profileId) throw new MissingCredentialError("paytabs.serverKey");
    const { res, body } = await audited<{ tran_ref?: string; message?: string }>({
      ctx,
      endpoint: "/payment/request",
      method: "POST",
      fn: async () => {
        const r = await fetch("https://secure.paytabs.sa/payment/request", {
          method: "POST",
          headers: { Authorization: serverKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            profile_id: profileId,
            tran_type: "refund",
            tran_class: "ecom",
            cart_id: args.providerRef,
            cart_currency: "SAR",
            cart_amount: args.amount,
            cart_description: "refund",
            tran_ref: args.providerRef,
          }),
        });
        return { res: r, body: (await r.json().catch(() => ({}))) as never };
      },
    });
    if (!res.ok) throw new Error(body.message ?? `PayTabs refund failed: HTTP ${res.status}`);
    return { refundRef: body.tran_ref ?? args.providerRef, raw: body };
  },
  verifyWebhook: hmacWebhook,
};

const ADAPTERS: Record<PaymentProvider, PaymentAdapter> = {
  moyasar: moyasarAdapter,
  tap: tapAdapter,
  hyperpay: hyperPayAdapterFactory("hyperpay"),
  stcpay: stcPayAdapter,
  mada: hyperPayAdapterFactory("mada"),
  paytabs: payTabsAdapter,
};

export async function createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
  const [gateway] = await db
    .select()
    .from(paymentGatewaysTable)
    .where(eq(paymentGatewaysTable.id, req.gatewayId));
  if (!gateway) throw new Error(`Payment gateway #${req.gatewayId} not found`);
  if (!gateway.isEnabled) throw new Error(`Gateway "${gateway.provider}" is disabled`);

  const cred = await getCredential<Record<string, string>>(gateway.provider, {
    branchId: gateway.branchId,
    environment: gateway.environment === "production" ? "production" : "sandbox",
  });
  if (!cred) throw new MissingCredentialError(gateway.provider);

  const adapter = ADAPTERS[gateway.provider as PaymentProvider];
  if (!adapter) throw new Error(`Unsupported provider: ${gateway.provider}`);

  const result = await adapter.checkout(req, { gateway, secret: cred.secret });

  const [intent] = await db
    .insert(paymentIntentsTable)
    .values({
      gatewayId: gateway.id,
      invoiceId: req.invoiceId ?? null,
      customerId: req.customerId ?? null,
      providerRef: result.providerRef,
      amount: String(req.amount),
      currency: req.currency ?? "SAR",
      status: result.status,
      checkoutUrl: result.checkoutUrl,
      metadata: req.metadata ?? null,
    })
    .returning({ id: paymentIntentsTable.id });

  return {
    intentId: intent!.id,
    providerRef: result.providerRef,
    checkoutUrl: result.checkoutUrl,
    status: result.status,
  };
}

export async function refundIntent(args: {
  intentId: number;
  amount?: number;
}): Promise<{ refundRef: string; status: string }> {
  const [intent] = await db
    .select()
    .from(paymentIntentsTable)
    .where(eq(paymentIntentsTable.id, args.intentId));
  if (!intent) throw new Error(`Payment intent #${args.intentId} not found`);
  if (!intent.providerRef) throw new Error(`Intent #${intent.id} has no provider reference yet`);

  const [gateway] = await db
    .select()
    .from(paymentGatewaysTable)
    .where(eq(paymentGatewaysTable.id, intent.gatewayId));
  if (!gateway) throw new Error("Gateway missing for intent");

  const cred = await getCredential<Record<string, string>>(gateway.provider, {
    branchId: gateway.branchId,
    environment: gateway.environment === "production" ? "production" : "sandbox",
  });
  if (!cred) throw new MissingCredentialError(gateway.provider);

  const adapter = ADAPTERS[gateway.provider as PaymentProvider];
  if (!adapter) throw new Error(`Unsupported provider: ${gateway.provider}`);

  const out = await adapter.refund(
    { providerRef: intent.providerRef, amount: args.amount ?? Number(intent.amount) },
    { gateway, secret: cred.secret },
  );

  await db
    .update(paymentIntentsTable)
    .set({ status: "refunded", updatedAt: new Date() })
    .where(eq(paymentIntentsTable.id, intent.id));

  return { refundRef: out.refundRef, status: "refunded" };
}

export async function handleWebhook(args: {
  gatewayId: number;
  rawBody: string;
  signature?: string;
  headers?: Record<string, string | undefined>;
  parsed: Record<string, unknown>;
}): Promise<{ ok: boolean; intentId?: number; status?: string; ledgerEntryId?: number | null }> {
  const t0 = Date.now();
  const [gateway] = await db
    .select()
    .from(paymentGatewaysTable)
    .where(eq(paymentGatewaysTable.id, args.gatewayId));
  if (!gateway) {
    await recordIntegrationCall({
      provider: "unknown",
      endpoint: `/integrations/payments/webhook/${args.gatewayId}`,
      method: "POST",
      success: false,
      direction: "inbound",
      errorMessage: "gateway_not_found",
    });
    return { ok: false };
  }

  const cred = await getCredential<Record<string, string>>(gateway.provider, {
    branchId: gateway.branchId,
    environment: gateway.environment === "production" ? "production" : "sandbox",
  });
  const adapter = ADAPTERS[gateway.provider as PaymentProvider];
  if (!adapter || !cred) {
    await recordIntegrationCall({
      branchId: gateway.branchId,
      provider: gateway.provider,
      endpoint: `/integrations/payments/webhook/${args.gatewayId}`,
      method: "POST",
      success: false,
      direction: "inbound",
      errorMessage: "credential_or_adapter_missing",
    });
    return { ok: false };
  }

  // Use the per-provider verifier (header name + signature
  // encoding vary across the 6 supported gateways). The legacy
  // `x-signature` header is still honoured by the verifier's
  // default branch for back-compat with the previous adapter.
  const headers = args.headers ?? {
    "x-signature": args.signature,
  };
  const verifier = providerWebhookVerifier(gateway.provider);
  const isValid = verifier(args.rawBody, headers, {
    gateway,
    secret: cred.secret,
  });

  // Audit every inbound webhook attempt — including ones that fail
  // signature verification — so ops can spot probing or a rotated
  // secret.
  await recordIntegrationCall({
    branchId: gateway.branchId,
    provider: gateway.provider,
    endpoint: `/integrations/payments/webhook/${args.gatewayId}`,
    method: "POST",
    statusCode: isValid ? 200 : 401,
    durationMs: Date.now() - t0,
    success: isValid,
    direction: "inbound",
    requestSummary: { byteLen: args.rawBody.length, hasSignature: Boolean(args.signature) },
    errorMessage: isValid ? null : "invalid_signature",
  });

  if (!isValid) return { ok: false };

  const providerRef = (args.parsed.id ?? args.parsed.payment_id ?? args.parsed.tran_ref ?? args.parsed.providerRef) as
    | string
    | undefined;
  const rawStatus = args.parsed.status as string | undefined;
  if (!providerRef) return { ok: true };

  // Classify the webhook before mutating anything. We never
  // default to "captured" — a missing/unknown status maps to
  // "ignore" so that ambiguous events neither flip our intent nor
  // post to the GL. Authorize-only events update the intent
  // status to "authorized" but explicitly skip ledger posting
  // (capture must arrive as a separate event).
  const verdict = classifyWebhookStatus(gateway.provider, rawStatus);
  if (verdict === "ignore") return { ok: true };
  const newStatus =
    verdict === "settled" ? "captured" : verdict === "authorized" ? "authorized" : "failed";

  // Scope the update by BOTH providerRef AND gatewayId — provider
  // refs are not globally unique across gateways, and a webhook
  // delivered to the wrong gateway must never mutate a sibling
  // gateway's intent (financial-integrity guard).
  const [updated] = await db
    .update(paymentIntentsTable)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(
      and(
        eq(paymentIntentsTable.providerRef, providerRef),
        eq(paymentIntentsTable.gatewayId, gateway.id),
      ),
    )
    .returning({ id: paymentIntentsTable.id });

  let ledgerEntryId: number | null = null;
  if (updated && verdict === "settled") {
    // POS-sourced intents post their own (Dr Bank / Cr AR) entry
    // when the cashier finalises the sale via /pos/orders. Skipping
    // here avoids double-counting the bank receipt.
    const [intentRow] = await db
      .select({ metadata: paymentIntentsTable.metadata })
      .from(paymentIntentsTable)
      .where(eq(paymentIntentsTable.id, updated.id));
    const metaSource = (intentRow?.metadata as Record<string, unknown> | null)?.["source"];
    if (metaSource !== "pos") {
      try {
        const r = await postPaymentReceiptToLedger(updated.id);
        ledgerEntryId = r.entryId;
      } catch {
        ledgerEntryId = null;
      }
    }
  }

  return { ok: true, intentId: updated?.id, status: newStatus, ledgerEntryId };
}
