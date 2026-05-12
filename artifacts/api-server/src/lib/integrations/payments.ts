import { createHmac, timingSafeEqual } from "node:crypto";
import { db, paymentGatewaysTable, paymentIntentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getCredential, MissingCredentialError } from "./credentials";
import { recordIntegrationCall } from "./audit";

export type PaymentProvider =
  | "moyasar"
  | "tap"
  | "hyperpay"
  | "stcpay"
  | "mada"
  | "paytabs";

export interface CheckoutRequest {
  gatewayId: number;
  amount: number; // major units (SAR)
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

interface PaymentAdapter {
  checkout(req: CheckoutRequest, ctx: AdapterContext): Promise<{
    providerRef: string | null;
    checkoutUrl: string | null;
    status: CheckoutResult["status"];
    raw: Record<string, unknown>;
  }>;
  verifyWebhook(rawBody: string, signature: string | undefined, ctx: AdapterContext): boolean;
}

/* ------------------------------- Moyasar -------------------------------- */
const moyasarAdapter: PaymentAdapter = {
  async checkout(req, ctx) {
    const apiKey = ctx.secret.secretApiKey ?? ctx.secret.apiKey;
    if (!apiKey) throw new MissingCredentialError("moyasar.secretApiKey");
    const t0 = Date.now();
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
    const body = (await r.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      status?: string;
      message?: string;
    };
    await recordIntegrationCall({
      branchId: ctx.gateway.branchId,
      provider: "moyasar",
      endpoint: "/invoices",
      method: "POST",
      statusCode: r.status,
      durationMs: Date.now() - t0,
      success: r.ok,
      responseSummary: { id: body.id, status: body.status },
      errorMessage: r.ok ? null : body.message ?? `HTTP ${r.status}`,
    });
    if (!r.ok) {
      throw new Error(body.message ?? `Moyasar checkout failed: HTTP ${r.status}`);
    }
    return {
      providerRef: body.id ?? null,
      checkoutUrl: body.url ?? null,
      status: "pending",
      raw: body as Record<string, unknown>,
    };
  },
  verifyWebhook(rawBody, signature, ctx) {
    const secret = ctx.gateway.webhookSecret;
    if (!secret || !signature) return false;
    const computed = createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(computed);
    const b = Buffer.from(signature);
    return a.length === b.length && timingSafeEqual(a, b);
  },
};

/* ----------------------------- Generic stub ----------------------------- */
function stubAdapter(provider: PaymentProvider): PaymentAdapter {
  return {
    async checkout(req, ctx) {
      // Adapters that require live API credentials we don't have yet
      // (Tap, HyperPay, STC Pay direct, Mada acquirer, PayTabs):
      // record the intent locally and return a placeholder URL so the
      // frontend can still flow end-to-end while integration is being
      // certified with each acquirer.
      await recordIntegrationCall({
        branchId: ctx.gateway.branchId,
        provider,
        endpoint: "/checkout",
        method: "POST",
        success: true,
        statusCode: 200,
        responseSummary: { stub: true, amount: req.amount },
      });
      return {
        providerRef: `stub-${provider}-${Date.now()}`,
        checkoutUrl: `${req.callbackUrl}?stub=${provider}`,
        status: "pending",
        raw: { stub: true },
      };
    },
    verifyWebhook(rawBody, signature, ctx) {
      const secret = ctx.gateway.webhookSecret;
      if (!secret || !signature) return false;
      const computed = createHmac("sha256", secret).update(rawBody).digest("hex");
      const a = Buffer.from(computed);
      const b = Buffer.from(signature);
      if (a.length !== b.length) return false;
      try {
        return timingSafeEqual(a, b);
      } catch {
        return false;
      }
    },
  };
}

const ADAPTERS: Record<PaymentProvider, PaymentAdapter> = {
  moyasar: moyasarAdapter,
  tap: stubAdapter("tap"),
  hyperpay: stubAdapter("hyperpay"),
  stcpay: stubAdapter("stcpay"),
  mada: stubAdapter("mada"),
  paytabs: stubAdapter("paytabs"),
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

export async function handleWebhook(args: {
  gatewayId: number;
  rawBody: string;
  signature?: string;
  parsed: Record<string, unknown>;
}): Promise<{ ok: boolean; intentId?: number; status?: string }> {
  const [gateway] = await db
    .select()
    .from(paymentGatewaysTable)
    .where(eq(paymentGatewaysTable.id, args.gatewayId));
  if (!gateway) return { ok: false };

  const cred = await getCredential<Record<string, string>>(gateway.provider, {
    branchId: gateway.branchId,
  });
  const adapter = ADAPTERS[gateway.provider as PaymentProvider];
  if (!adapter || !cred) return { ok: false };

  const isValid = adapter.verifyWebhook(args.rawBody, args.signature, {
    gateway,
    secret: cred.secret,
  });
  if (!isValid) return { ok: false };

  const providerRef = (args.parsed.id ?? args.parsed.payment_id ?? args.parsed.providerRef) as
    | string
    | undefined;
  const newStatus = String(args.parsed.status ?? "captured");
  if (!providerRef) return { ok: true };

  const [updated] = await db
    .update(paymentIntentsTable)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(paymentIntentsTable.providerRef, providerRef))
    .returning({ id: paymentIntentsTable.id });

  return { ok: true, intentId: updated?.id, status: newStatus };
}
