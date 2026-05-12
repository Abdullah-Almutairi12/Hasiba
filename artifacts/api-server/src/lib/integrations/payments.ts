import { createHmac, timingSafeEqual } from "node:crypto";
import { db, paymentGatewaysTable, paymentIntentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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

export class NotImplementedError extends Error {
  readonly statusCode = 501;
  constructor(provider: string) {
    super(
      `Provider "${provider}" is registered but no live adapter is wired yet — onboard with the provider and update artifacts/api-server/src/lib/integrations/payments.ts.`,
    );
    this.name = "NotImplementedError";
  }
}

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
  refund(args: { providerRef: string; amount: number }, ctx: AdapterContext): Promise<{
    refundRef: string;
    raw: Record<string, unknown>;
  }>;
  verifyWebhook(rawBody: string, signature: string | undefined, ctx: AdapterContext): boolean;
}

/**
 * Decrypt the (possibly encrypted) webhook secret persisted on the
 * payment_gateways row. Older rows that pre-date encryption are
 * stored as plaintext; the helper falls back transparently.
 */
function getWebhookSecret(gw: typeof paymentGatewaysTable.$inferSelect): string | null {
  if (!gw.webhookSecret) return null;
  try {
    return decryptSecret(gw.webhookSecret);
  } catch {
    // Backward compatibility for any rows written before encryption
    // landed (none should exist in production yet).
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
  async refund(args, ctx) {
    const apiKey = ctx.secret.secretApiKey ?? ctx.secret.apiKey;
    if (!apiKey) throw new MissingCredentialError("moyasar.secretApiKey");
    const t0 = Date.now();
    const r = await fetch(`https://api.moyasar.com/v1/payments/${args.providerRef}/refund`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: Math.round(args.amount * 100) }),
    });
    const body = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
    await recordIntegrationCall({
      branchId: ctx.gateway.branchId,
      provider: "moyasar",
      endpoint: `/payments/${args.providerRef}/refund`,
      method: "POST",
      statusCode: r.status,
      durationMs: Date.now() - t0,
      success: r.ok,
      errorMessage: r.ok ? null : body.message ?? `HTTP ${r.status}`,
    });
    if (!r.ok) throw new Error(body.message ?? `Moyasar refund failed: HTTP ${r.status}`);
    return { refundRef: body.id ?? args.providerRef, raw: body as Record<string, unknown> };
  },
  verifyWebhook(rawBody, signature, ctx) {
    const secret = getWebhookSecret(ctx.gateway);
    if (!secret || !signature) return false;
    const computed = createHmac("sha256", secret).update(rawBody).digest("hex");
    return safeHmacEqual(Buffer.from(computed), Buffer.from(signature));
  },
};

/* ----------------------------- Not-yet-live ----------------------------- */
/**
 * Adapters whose live provider integration has not been certified
 * yet. Returning a fake-success URL would be dangerous (the merchant
 * would think the customer paid). Instead we throw a 501 — the
 * Integrations admin tab clearly says "حالياً معطّل" for these
 * providers and the API surface refuses any checkout.
 *
 * The webhook receiver still works for these providers so that, once
 * the real adapter lands, queued provider notifications can be
 * back-filled without losing data.
 */
function notLiveAdapter(provider: PaymentProvider): PaymentAdapter {
  return {
    checkout() {
      throw new NotImplementedError(provider);
    },
    refund() {
      throw new NotImplementedError(provider);
    },
    verifyWebhook(rawBody, signature, ctx) {
      const secret = getWebhookSecret(ctx.gateway);
      if (!secret || !signature) return false;
      const computed = createHmac("sha256", secret).update(rawBody).digest("hex");
      return safeHmacEqual(Buffer.from(computed), Buffer.from(signature));
    },
  };
}

const ADAPTERS: Record<PaymentProvider, PaymentAdapter> = {
  moyasar: moyasarAdapter,
  tap: notLiveAdapter("tap"),
  hyperpay: notLiveAdapter("hyperpay"),
  stcpay: notLiveAdapter("stcpay"),
  mada: notLiveAdapter("mada"),
  paytabs: notLiveAdapter("paytabs"),
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
  parsed: Record<string, unknown>;
}): Promise<{ ok: boolean; intentId?: number; status?: string; ledgerEntryId?: number | null }> {
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

  let ledgerEntryId: number | null = null;
  if (updated && (newStatus === "captured" || newStatus === "paid" || newStatus === "succeeded")) {
    // Best-effort GL posting; never block the webhook ack on it.
    try {
      const r = await postPaymentReceiptToLedger(updated.id);
      ledgerEntryId = r.entryId;
    } catch {
      ledgerEntryId = null;
    }
  }

  return { ok: true, intentId: updated?.id, status: newStatus, ledgerEntryId };
}
