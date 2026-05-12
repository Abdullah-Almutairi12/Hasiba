import { db, shippingCarriersTable, shipmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getCredential, MissingCredentialError } from "./credentials";
import { recordIntegrationCall } from "./audit";

export type CarrierProvider = "smsa" | "aramex" | "saee" | "naqel";

export class CarrierNotImplementedError extends Error {
  readonly statusCode = 501;
  constructor(provider: string) {
    super(
      `Carrier "${provider}" has no live adapter yet — open the integrations dashboard and contact ops to onboard.`,
    );
    this.name = "CarrierNotImplementedError";
  }
}

export interface CreateAwbRequest {
  carrierId: number;
  deliveryOrderRef?: string;
  customerId?: number;
  toAddress: {
    name: string;
    phone: string;
    line1: string;
    city: string;
    region?: string;
    country?: string;
    postalCode?: string;
  };
  fromAddress?: Record<string, unknown>;
  weightKg: number;
  pieces?: number;
  cod?: number;
  description?: string;
}

export interface CreateAwbResult {
  shipmentId: number;
  awbNumber: string;
  labelUrl: string | null;
}

interface CarrierAdapter {
  createAwb(req: CreateAwbRequest, ctx: { secret: Record<string, string>; carrier: typeof shippingCarriersTable.$inferSelect }): Promise<{
    awbNumber: string;
    labelUrl: string | null;
    raw: Record<string, unknown>;
  }>;
  fetchTracking(awb: string, ctx: { secret: Record<string, string> }): Promise<Array<{
    code: string;
    description: string;
    at: string;
  }>>;
}

/** SMSA Express — live adapter against the public passKey API. */
const smsaAdapter: CarrierAdapter = {
  async createAwb(req, ctx) {
    const passKey = ctx.secret.passKey;
    const cust = ctx.secret.customerAccount;
    if (!passKey || !cust) throw new MissingCredentialError("smsa.passKey");
    const t0 = Date.now();
    const r = await fetch("https://track.smsaexpress.com/SMSAExpressWebApi/api/addshipment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passkey: passKey,
        customerAccount: cust,
        consigneeName: req.toAddress.name,
        consigneeMobile: req.toAddress.phone,
        consigneeAddress: req.toAddress.line1,
        consigneeCity: req.toAddress.city,
        weight: req.weightKg,
        pieces: req.pieces ?? 1,
        cod: req.cod ?? 0,
      }),
    });
    const body = (await r.json().catch(() => ({}))) as {
      awb?: string;
      label?: string;
      message?: string;
    };
    await recordIntegrationCall({
      branchId: ctx.carrier.branchId,
      provider: "smsa",
      endpoint: "/addshipment",
      method: "POST",
      statusCode: r.status,
      durationMs: Date.now() - t0,
      success: r.ok,
      errorMessage: r.ok ? null : body.message ?? `HTTP ${r.status}`,
    });
    if (!r.ok || !body.awb) {
      throw new Error(body.message ?? `SMSA returned HTTP ${r.status}`);
    }
    return { awbNumber: body.awb, labelUrl: body.label ?? null, raw: body };
  },
  async fetchTracking(awb, ctx) {
    const passKey = ctx.secret.passKey;
    if (!passKey) return [];
    const r = await fetch(
      `https://track.smsaexpress.com/SMSAExpressWebApi/api/tracking?awb=${encodeURIComponent(awb)}&passkey=${encodeURIComponent(passKey)}`,
    );
    if (!r.ok) return [];
    const body = (await r.json().catch(() => [])) as Array<{
      Code?: string;
      Description?: string;
      Date?: string;
    }>;
    return body.map((e) => ({
      code: String(e.Code ?? ""),
      description: String(e.Description ?? ""),
      at: String(e.Date ?? new Date().toISOString()),
    }));
  },
};

/**
 * Carriers we have not certified with yet. We deliberately throw a
 * 501 instead of fabricating an AWB — printing a fake label would be
 * a much worse failure mode than blocking the operation.
 */
function notLiveCarrier(provider: CarrierProvider): CarrierAdapter {
  return {
    async createAwb() {
      throw new CarrierNotImplementedError(provider);
    },
    async fetchTracking() {
      return [];
    },
  };
}

const CARRIERS: Record<CarrierProvider, CarrierAdapter> = {
  smsa: smsaAdapter,
  aramex: notLiveCarrier("aramex"),
  saee: notLiveCarrier("saee"),
  naqel: notLiveCarrier("naqel"),
};

export async function createAwb(req: CreateAwbRequest): Promise<CreateAwbResult> {
  const [carrier] = await db
    .select()
    .from(shippingCarriersTable)
    .where(eq(shippingCarriersTable.id, req.carrierId));
  if (!carrier) throw new Error(`Shipping carrier #${req.carrierId} not found`);
  if (!carrier.isEnabled) throw new Error(`Carrier "${carrier.provider}" is disabled`);

  const cred = await getCredential<Record<string, string>>(carrier.provider, {
    branchId: carrier.branchId,
  });
  if (!cred) throw new MissingCredentialError(carrier.provider);

  const adapter = CARRIERS[carrier.provider as CarrierProvider];
  if (!adapter) throw new Error(`Unsupported carrier: ${carrier.provider}`);

  const out = await adapter.createAwb(req, { secret: cred.secret, carrier });

  const [shipment] = await db
    .insert(shipmentsTable)
    .values({
      carrierId: carrier.id,
      deliveryOrderRef: req.deliveryOrderRef ?? null,
      customerId: req.customerId ?? null,
      awbNumber: out.awbNumber,
      labelUrl: out.labelUrl,
      status: "created",
      weightKg: String(req.weightKg),
      pieces: req.pieces ?? 1,
      cod: req.cod !== undefined ? String(req.cod) : null,
      fromAddress: req.fromAddress ?? null,
      toAddress: req.toAddress as unknown as Record<string, unknown>,
      // raw response intentionally not stored — carriers often
      // include customer PII; the integration_calls table keeps a
      // redacted summary instead.
      metadata: { stored: "redacted" },
    })
    .returning({ id: shipmentsTable.id });

  return {
    shipmentId: shipment!.id,
    awbNumber: out.awbNumber,
    labelUrl: out.labelUrl,
  };
}

export async function pollTracking(shipmentId: number): Promise<number> {
  const [shipment] = await db
    .select()
    .from(shipmentsTable)
    .where(eq(shipmentsTable.id, shipmentId));
  if (!shipment || !shipment.awbNumber) return 0;
  const [carrier] = await db
    .select()
    .from(shippingCarriersTable)
    .where(eq(shippingCarriersTable.id, shipment.carrierId));
  if (!carrier) return 0;
  const cred = await getCredential<Record<string, string>>(carrier.provider, {
    branchId: carrier.branchId,
  });
  if (!cred) return 0;
  const adapter = CARRIERS[carrier.provider as CarrierProvider];
  const events = await adapter.fetchTracking(shipment.awbNumber, { secret: cred.secret });
  await db
    .update(shipmentsTable)
    .set({ trackingHistory: events, updatedAt: new Date() })
    .where(eq(shipmentsTable.id, shipmentId));
  return events.length;
}
