import { db, shippingCarriersTable, shipmentsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { getCredential, MissingCredentialError } from "./credentials";
import { recordIntegrationCall } from "./audit";
import { logger } from "../logger";

export type CarrierProvider = "smsa" | "aramex" | "saee" | "naqel";

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

interface CarrierContext {
  secret: Record<string, string>;
  carrier: typeof shippingCarriersTable.$inferSelect;
}

interface CarrierAdapter {
  createAwb(req: CreateAwbRequest, ctx: CarrierContext): Promise<{
    awbNumber: string;
    labelUrl: string | null;
    raw: Record<string, unknown>;
  }>;
  fetchTracking(awb: string, ctx: CarrierContext): Promise<Array<{
    code: string;
    description: string;
    at: string;
  }>>;
}

async function audited<T>(args: {
  ctx: CarrierContext;
  endpoint: string;
  method: string;
  fn: () => Promise<{ res: Response; body: T }>;
}): Promise<{ res: Response; body: T }> {
  const t0 = Date.now();
  try {
    const out = await args.fn();
    await recordIntegrationCall({
      branchId: args.ctx.carrier.branchId,
      provider: args.ctx.carrier.provider,
      endpoint: args.endpoint,
      method: args.method,
      statusCode: out.res.status,
      durationMs: Date.now() - t0,
      success: out.res.ok,
    });
    return out;
  } catch (e) {
    await recordIntegrationCall({
      branchId: args.ctx.carrier.branchId,
      provider: args.ctx.carrier.provider,
      endpoint: args.endpoint,
      method: args.method,
      durationMs: Date.now() - t0,
      success: false,
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/* --------------------------------- SMSA --------------------------------- */
const smsaAdapter: CarrierAdapter = {
  async createAwb(req, ctx) {
    const passKey = ctx.secret.passKey;
    const cust = ctx.secret.customerAccount;
    if (!passKey || !cust) throw new MissingCredentialError("smsa.passKey");
    const { res, body } = await audited<{ awb?: string; label?: string; message?: string }>({
      ctx,
      endpoint: "/api/addshipment",
      method: "POST",
      fn: async () => {
        const r = await fetch(
          "https://track.smsaexpress.com/SMSAExpressWebApi/api/addshipment",
          {
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
          },
        );
        return { res: r, body: (await r.json().catch(() => ({}))) as never };
      },
    });
    if (!res.ok || !body.awb) throw new Error(body.message ?? `SMSA HTTP ${res.status}`);
    return { awbNumber: body.awb, labelUrl: body.label ?? null, raw: body };
  },
  async fetchTracking(awb, ctx) {
    const passKey = ctx.secret.passKey;
    if (!passKey) return [];
    const r = await fetch(
      `https://track.smsaexpress.com/SMSAExpressWebApi/api/tracking?awb=${encodeURIComponent(awb)}&passkey=${encodeURIComponent(passKey)}`,
    );
    if (!r.ok) return [];
    const arr = (await r.json().catch(() => [])) as Array<{
      Code?: string;
      Description?: string;
      Date?: string;
    }>;
    return arr.map((e) => ({
      code: String(e.Code ?? ""),
      description: String(e.Description ?? ""),
      at: String(e.Date ?? new Date().toISOString()),
    }));
  },
};

/* -------------------------------- Aramex -------------------------------- */
const aramexAdapter: CarrierAdapter = {
  async createAwb(req, ctx) {
    const username = ctx.secret.username;
    const password = ctx.secret.password;
    const accountNumber = ctx.secret.accountNumber;
    const accountPin = ctx.secret.accountPin;
    const accountEntity = ctx.secret.accountEntity ?? "RUH";
    const accountCountry = ctx.secret.accountCountry ?? "SA";
    if (!username || !password || !accountNumber || !accountPin) {
      throw new MissingCredentialError("aramex.username");
    }
    const { res, body } = await audited<{
      Shipments?: Array<{ ID?: string; ShipmentLabel?: { LabelURL?: string } }>;
      Notifications?: Array<{ Message?: string }>;
      HasErrors?: boolean;
    }>({
      ctx,
      endpoint: "/Shipping/Service_1_0.svc/json/CreateShipments",
      method: "POST",
      fn: async () => {
        const r = await fetch(
          "https://ws.aramex.net/ShippingAPI.V2/Shipping/Service_1_0.svc/json/CreateShipments",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ClientInfo: {
                UserName: username,
                Password: password,
                Version: "v1",
                AccountNumber: accountNumber,
                AccountPin: accountPin,
                AccountEntity: accountEntity,
                AccountCountryCode: accountCountry,
                Source: 24,
              },
              LabelInfo: { ReportID: 9201, ReportType: "URL" },
              Shipments: [
                {
                  Reference1: req.deliveryOrderRef ?? `ORD-${Date.now()}`,
                  Shipper: {
                    Reference1: "Hasiba",
                    AccountNumber: accountNumber,
                    PartyAddress: {
                      Line1: ctx.secret.shipperLine1 ?? "Hasiba HQ",
                      City: ctx.secret.shipperCity ?? "Riyadh",
                      CountryCode: accountCountry,
                    },
                    Contact: {
                      PersonName: "Hasiba",
                      CompanyName: "Hasiba",
                      PhoneNumber1: ctx.secret.shipperPhone ?? "+966500000000",
                      CellPhone: ctx.secret.shipperPhone ?? "+966500000000",
                      EmailAddress: ctx.secret.shipperEmail ?? "ops@hasiba.ai",
                    },
                  },
                  Consignee: {
                    PartyAddress: {
                      Line1: req.toAddress.line1,
                      City: req.toAddress.city,
                      CountryCode: req.toAddress.country ?? "SA",
                    },
                    Contact: {
                      PersonName: req.toAddress.name,
                      CompanyName: req.toAddress.name,
                      PhoneNumber1: req.toAddress.phone,
                      CellPhone: req.toAddress.phone,
                      EmailAddress: "noreply@example.com",
                    },
                  },
                  ShippingDateTime: `\/Date(${Date.now()})\/`,
                  DueDate: `\/Date(${Date.now() + 7 * 86400 * 1000})\/`,
                  Details: {
                    ActualWeight: { Unit: "KG", Value: req.weightKg },
                    NumberOfPieces: req.pieces ?? 1,
                    ProductGroup: "DOM",
                    ProductType: "OND",
                    PaymentType: "P",
                    DescriptionOfGoods: req.description ?? "Goods",
                    GoodsOriginCountry: "SA",
                    CashOnDeliveryAmount: req.cod
                      ? { CurrencyCode: "SAR", Value: req.cod }
                      : null,
                  },
                },
              ],
              Transaction: { Reference1: req.deliveryOrderRef ?? "" },
            }),
          },
        );
        return { res: r, body: (await r.json().catch(() => ({}))) as never };
      },
    });
    if (!res.ok || body.HasErrors || !body.Shipments?.[0]?.ID) {
      throw new Error(body.Notifications?.[0]?.Message ?? `Aramex HTTP ${res.status}`);
    }
    return {
      awbNumber: body.Shipments[0].ID!,
      labelUrl: body.Shipments[0].ShipmentLabel?.LabelURL ?? null,
      raw: body,
    };
  },
  async fetchTracking(awb, ctx) {
    const username = ctx.secret.username;
    const password = ctx.secret.password;
    if (!username || !password) return [];
    const r = await fetch(
      "https://ws.aramex.net/ShippingAPI.V2/Tracking/Service_1_0.svc/json/TrackShipments",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ClientInfo: { UserName: username, Password: password, Version: "v1.0", Source: 24 },
          Shipments: [awb],
          GetLastTrackingUpdateOnly: false,
        }),
      },
    );
    if (!r.ok) return [];
    const body = (await r.json().catch(() => ({}))) as {
      TrackingResults?: Array<{
        Value?: Array<{ UpdateCode?: string; UpdateDescription?: string; UpdateDateTime?: string }>;
      }>;
    };
    const events = body.TrackingResults?.[0]?.Value ?? [];
    return events.map((e) => ({
      code: String(e.UpdateCode ?? ""),
      description: String(e.UpdateDescription ?? ""),
      at: String(e.UpdateDateTime ?? new Date().toISOString()),
    }));
  },
};

/* --------------------------------- Saee --------------------------------- */
const saeeAdapter: CarrierAdapter = {
  async createAwb(req, ctx) {
    const apiKey = ctx.secret.apiKey;
    if (!apiKey) throw new MissingCredentialError("saee.apiKey");
    const { res, body } = await audited<{ AWB?: string; LabelURL?: string; Message?: string }>({
      ctx,
      endpoint: "/api/v3/Shipments",
      method: "POST",
      fn: async () => {
        const r = await fetch("https://api.saee.sa/api/v3/Shipments", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            ConsigneeName: req.toAddress.name,
            ConsigneeMobile: req.toAddress.phone,
            ConsigneeAddress: req.toAddress.line1,
            ConsigneeCity: req.toAddress.city,
            Weight: req.weightKg,
            Pieces: req.pieces ?? 1,
            COD: req.cod ?? 0,
            ProductDescription: req.description ?? "Goods",
            Reference: req.deliveryOrderRef ?? "",
          }),
        });
        return { res: r, body: (await r.json().catch(() => ({}))) as never };
      },
    });
    if (!res.ok || !body.AWB) throw new Error(body.Message ?? `Saee HTTP ${res.status}`);
    return { awbNumber: body.AWB, labelUrl: body.LabelURL ?? null, raw: body };
  },
  async fetchTracking(awb, ctx) {
    const apiKey = ctx.secret.apiKey;
    if (!apiKey) return [];
    const r = await fetch(`https://api.saee.sa/api/v3/Tracking/${encodeURIComponent(awb)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!r.ok) return [];
    const body = (await r.json().catch(() => ({}))) as {
      Events?: Array<{ Code?: string; Description?: string; Date?: string }>;
    };
    return (body.Events ?? []).map((e) => ({
      code: String(e.Code ?? ""),
      description: String(e.Description ?? ""),
      at: String(e.Date ?? new Date().toISOString()),
    }));
  },
};

/* --------------------------------- Naqel -------------------------------- */
const naqelAdapter: CarrierAdapter = {
  async createAwb(req, ctx) {
    const clientId = ctx.secret.clientId;
    const password = ctx.secret.password;
    const accountNumber = ctx.secret.accountNumber;
    if (!clientId || !password || !accountNumber) {
      throw new MissingCredentialError("naqel.clientId");
    }
    const { res, body } = await audited<{
      WaybillNo?: string;
      WaybillURL?: string;
      Message?: string;
      Status?: string;
    }>({
      ctx,
      endpoint: "/CreateWayBill",
      method: "POST",
      fn: async () => {
        const r = await fetch("https://www.naqelapi.com/CreateWayBill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ClientID: clientId,
            Password: password,
            AccountNumber: accountNumber,
            ConsigneeName: req.toAddress.name,
            ConsigneeAddress: req.toAddress.line1,
            ConsigneeCity: req.toAddress.city,
            ConsigneeMobile: req.toAddress.phone,
            Pieces: req.pieces ?? 1,
            Weight: req.weightKg,
            CODAmount: req.cod ?? 0,
            GoodsDescription: req.description ?? "Goods",
            Reference: req.deliveryOrderRef ?? "",
            Service: "Domestic",
          }),
        });
        return { res: r, body: (await r.json().catch(() => ({}))) as never };
      },
    });
    if (!res.ok || !body.WaybillNo) throw new Error(body.Message ?? `Naqel HTTP ${res.status}`);
    return { awbNumber: body.WaybillNo, labelUrl: body.WaybillURL ?? null, raw: body };
  },
  async fetchTracking(awb, ctx) {
    const clientId = ctx.secret.clientId;
    const password = ctx.secret.password;
    if (!clientId || !password) return [];
    const r = await fetch("https://www.naqelapi.com/Tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ClientID: clientId, Password: password, WaybillNo: awb }),
    });
    if (!r.ok) return [];
    const body = (await r.json().catch(() => ({}))) as {
      Events?: Array<{ Status?: string; Description?: string; Date?: string }>;
    };
    return (body.Events ?? []).map((e) => ({
      code: String(e.Status ?? ""),
      description: String(e.Description ?? ""),
      at: String(e.Date ?? new Date().toISOString()),
    }));
  },
};

const CARRIERS: Record<CarrierProvider, CarrierAdapter> = {
  smsa: smsaAdapter,
  aramex: aramexAdapter,
  saee: saeeAdapter,
  naqel: naqelAdapter,
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
    environment: carrier.environment === "production" ? "production" : "sandbox",
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
      metadata: { stored: "redacted" },
    })
    .returning({ id: shipmentsTable.id });

  return {
    shipmentId: shipment!.id,
    awbNumber: out.awbNumber,
    labelUrl: out.labelUrl,
  };
}

/**
 * Derive a high-level shipment status from the latest tracking events.
 * Each carrier publishes its own event vocabulary, so we match against
 * common substrings (Arabic + English) found in the event description
 * or status code rather than maintaining a per-carrier lookup table.
 */
export function deriveStatusFromEvents(
  events: Array<{ code: string; description: string; at: string }>,
  current: string,
): string {
  if (!events.length) return current;
  // Walk newest → oldest so the most recent terminal event wins.
  const sorted = [...events].sort((a, b) => {
    const ta = Date.parse(a.at);
    const tb = Date.parse(b.at);
    return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
  });
  const norm = (s: string) => s.toLowerCase();
  for (const e of sorted) {
    const txt = `${norm(e.code)} ${norm(e.description)}`;
    if (
      /delivered|تم التسليم|تم تسليم|signed/i.test(txt) ||
      e.code === "DLV"
    ) {
      return "delivered";
    }
    if (
      /return|مرتجع|رفض|refused|undeliverable/i.test(txt) ||
      e.code === "RTS" || e.code === "RTN"
    ) {
      return "returned";
    }
    if (
      /cancel|ملغ|void/i.test(txt) ||
      e.code === "CXL"
    ) {
      return "cancelled";
    }
    if (
      /transit|out for delivery|picked|shipped|في الطريق|قيد التوصيل|تم الاستلام|warehouse|hub/i.test(txt) ||
      e.code === "OFD" || e.code === "INT" || e.code === "PUP"
    ) {
      return current === "created" ? "in_transit" : current;
    }
  }
  return current;
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
    environment: carrier.environment === "production" ? "production" : "sandbox",
  });
  if (!cred) return 0;
  const adapter = CARRIERS[carrier.provider as CarrierProvider];
  const startedAt = Date.now();
  let events: Awaited<ReturnType<typeof adapter.fetchTracking>> = [];
  try {
    events = await adapter.fetchTracking(shipment.awbNumber, {
      secret: cred.secret,
      carrier,
    });
    await recordIntegrationCall({
      provider: carrier.provider,
      endpoint: "tracking",
      method: "GET",
      success: true,
      requestSummary: { awb: shipment.awbNumber },
      responseSummary: { events: events.length },
      statusCode: 200,
      durationMs: Date.now() - startedAt,
      branchId: carrier.branchId,
    });
  } catch (err: unknown) {
    await recordIntegrationCall({
      provider: carrier.provider,
      endpoint: "tracking",
      method: "GET",
      success: false,
      requestSummary: { awb: shipment.awbNumber },
      errorMessage: err instanceof Error ? err.message : String(err),
      statusCode: 502,
      durationMs: Date.now() - startedAt,
      branchId: carrier.branchId,
    });
    throw err;
  }
  const newStatus = deriveStatusFromEvents(events, shipment.status);
  // Atomic transition guard: only one concurrent poll wins the
  // created -> in_transit flip. We scope the WHERE clause to the
  // expected previous status when promoting out of "created" so
  // two parallel poll cycles can't both fire the dispatch
  // notification for the same shipment. For all other transitions
  // the update is unconditional (we only need this guard for the
  // notification edge).
  const isFirstDispatch = shipment.status === "created" && newStatus === "in_transit";
  const updated = isFirstDispatch
    ? await db
        .update(shipmentsTable)
        .set({
          trackingHistory: events,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(shipmentsTable.id, shipmentId),
            eq(shipmentsTable.status, "created"),
          ),
        )
        .returning({ id: shipmentsTable.id })
    : await db
        .update(shipmentsTable)
        .set({
          trackingHistory: events,
          status: newStatus,
          updatedAt: new Date(),
        })
        .where(eq(shipmentsTable.id, shipmentId))
        .returning({ id: shipmentsTable.id });
  // Fire a templated WhatsApp notification the moment a shipment
  // first transitions out of "created" into "in_transit". Done as
  // a side-effect here (rather than from the route) so any code
  // path that polls tracking — manual GET, background sweep,
  // public lookup — gets the same one-off dispatch event. The
  // conditional UPDATE above ensures only one caller wins.
  if (isFirstDispatch && updated.length > 0) {
    void notifyShipmentEvent(shipmentId, "dispatched").catch((err) => {
      logger.warn({ err, shipmentId }, "shipment dispatch notify failed");
    });
  }
  // Fire delivered notification on the transition into "delivered"
  // (not just after polling). Conditional UPDATE above is for the
  // dispatch edge only; for delivery we additionally gate by
  // comparing previous vs new status.
  if (shipment.status !== "delivered" && newStatus === "delivered") {
    void notifyShipmentEvent(shipmentId, "delivered").catch((err) => {
      logger.warn({ err, shipmentId }, "shipment delivered notify failed");
    });
  }
  return events.length;
}

/** Templated WhatsApp notification for a shipment lifecycle event.
 *  Exported so webhook ingestion can fire the same payload that
 *  scheduled polling does. */
export async function notifyShipmentEvent(
  shipmentId: number,
  kind: "dispatched" | "delivered",
): Promise<void> {
  const { sendByTemplate } = await import("./messaging-templates");
  const [s] = await db
    .select()
    .from(shipmentsTable)
    .where(eq(shipmentsTable.id, shipmentId));
  if (!s || !s.awbNumber) return;
  const [c] = await db
    .select()
    .from(shippingCarriersTable)
    .where(eq(shippingCarriersTable.id, s.carrierId));
  const to = (s.toAddress ?? {}) as { phone?: string; name?: string };
  if (!to.phone) return;
  const baseUrl = (process.env["PUBLIC_BASE_URL"] ?? "").replace(/\/$/, "");
  const trackingUrl = baseUrl
    ? `${baseUrl}/track/${s.awbNumber}`
    : s.awbNumber;
  await sendByTemplate({
    templateName: kind === "delivered" ? "shipment_delivered" : "shipment_dispatched",
    to: to.phone,
    variables: {
      customer_name: to.name ?? "عميلنا الكريم",
      order_ref: s.deliveryOrderRef ?? `SHIP-${s.id}`,
      carrier: c?.displayName ?? c?.provider ?? "شركة الشحن",
      awb: s.awbNumber,
      tracking_url: trackingUrl,
    },
    branchId: c?.branchId ?? null,
  });
}

/**
 * Ingest an inbound carrier webhook. Verifies HMAC-SHA256 of the
 * raw body using the carrier's `webhook_secret`, then applies any
 * status events to the matching shipment (by AWB) and fires the
 * delivered/dispatched WhatsApp templates on transitions.
 *
 * The exact JSON shape varies per carrier, so we accept a loosely
 * typed payload and look for the AWB + an array of events with
 * `code`, `description`, `at`. Returns the resolved shipment id and
 * number of events stored (0 when payload is invalid).
 */
export async function ingestCarrierWebhook(opts: {
  carrierId: number;
  rawBody: string;
  signature: string | undefined;
  parsed: Record<string, unknown>;
}): Promise<{ ok: boolean; shipmentId?: number; events?: number; reason?: string }> {
  const [carrier] = await db
    .select()
    .from(shippingCarriersTable)
    .where(eq(shippingCarriersTable.id, opts.carrierId));
  if (!carrier) return { ok: false, reason: "carrier_not_found" };
  const secretSettings = (carrier.settings ?? {}) as { webhookSecret?: string };
  const secret = secretSettings.webhookSecret;
  // Signature is REQUIRED for production carriers. Sandbox carriers
  // without a configured secret may accept unsigned payloads so QA
  // can exercise the flow with raw curl, but production must verify.
  if (!secret && carrier.environment === "production") {
    return { ok: false, reason: "signature_required" };
  }
  if (secret) {
    if (!opts.signature) return { ok: false, reason: "invalid_signature" };
    const { createHmac, timingSafeEqual } = await import("node:crypto");
    const expected = createHmac("sha256", secret).update(opts.rawBody).digest("hex");
    const provided = opts.signature.replace(/^sha256=/, "");
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(provided, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: "invalid_signature" };
    }
  }
  const awb = String(opts.parsed["awb"] ?? opts.parsed["awbNumber"] ?? opts.parsed["tracking_number"] ?? "");
  if (!awb) return { ok: false, reason: "missing_awb" };
  const rawEvents = opts.parsed["events"];
  const events: Array<{ code: string; description: string; at: string }> = Array.isArray(rawEvents)
    ? (rawEvents as Array<Record<string, unknown>>).map((e) => ({
        code: String(e["code"] ?? e["status"] ?? ""),
        description: String(e["description"] ?? e["message"] ?? ""),
        at: String(e["at"] ?? e["timestamp"] ?? new Date().toISOString()),
      }))
    : [];
  // Bind shipment resolution to the authenticated carrier so a
  // signed payload from carrier A cannot mutate carrier B's shipment
  // that happens to share the same AWB number.
  const [shipment] = await db
    .select()
    .from(shipmentsTable)
    .where(and(eq(shipmentsTable.awbNumber, awb), eq(shipmentsTable.carrierId, opts.carrierId)));
  if (!shipment) return { ok: false, reason: "shipment_not_found" };
  const newStatus = deriveStatusFromEvents(events, shipment.status);
  await db
    .update(shipmentsTable)
    .set({ trackingHistory: events, status: newStatus, updatedAt: new Date() })
    .where(eq(shipmentsTable.id, shipment.id));
  if (shipment.status === "created" && newStatus === "in_transit") {
    void notifyShipmentEvent(shipment.id, "dispatched").catch((err) => {
      logger.warn({ err, shipmentId: shipment.id }, "webhook dispatch notify failed");
    });
  }
  if (shipment.status !== "delivered" && newStatus === "delivered") {
    void notifyShipmentEvent(shipment.id, "delivered").catch((err) => {
      logger.warn({ err, shipmentId: shipment.id }, "webhook delivered notify failed");
    });
  }
  await recordIntegrationCall({
    provider: carrier.provider,
    endpoint: "webhook",
    method: "POST",
    success: true,
    requestSummary: { awb, events: events.length },
    responseSummary: { status: newStatus },
    statusCode: 200,
    durationMs: 0,
    branchId: carrier.branchId,
  });
  return { ok: true, shipmentId: shipment.id, events: events.length };
}

/**
 * Background worker — every `intervalMs`, find open shipments
 * (status not in delivered/returned/cancelled) whose tracking has
 * not been refreshed in the last 10 minutes, and poll each carrier.
 *
 * Uses .unref() so it never holds the process open during shutdown.
 * Runs sequentially with try/catch around each shipment so a single
 * carrier outage doesn't take down the whole sweep.
 */
export function startTrackingWorker(intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  const sweep = async () => {
    try {
      const stale = await db
        .select({ id: shipmentsTable.id })
        .from(shipmentsTable)
        .where(
          sql`${shipmentsTable.status} not in ('delivered','returned','cancelled')
              and ${shipmentsTable.awbNumber} is not null
              and (${shipmentsTable.updatedAt} < now() - interval '10 minutes')`,
        )
        .limit(50);
      if (stale.length === 0) return;
      logger.debug({ count: stale.length }, "shipping tracking sweep");
      for (const row of stale) {
        try {
          await pollTracking(row.id);
        } catch (err) {
          logger.warn({ err, shipmentId: row.id }, "tracking poll failed");
        }
      }
    } catch (err) {
      logger.error({ err }, "tracking sweep failed");
    }
  };
  // First sweep delayed by intervalMs so server boot isn't blocked.
  const handle = setInterval(() => void sweep(), intervalMs);
  handle.unref();
  return handle;
}

/**
 * Public-facing tracking lookup by AWB. Polls the carrier on demand
 * (best-effort) and returns the persisted timeline. Designed to back
 * the customer-facing /track/:awb page linked from WhatsApp/SMS.
 */
export async function getPublicTracking(awb: string): Promise<{
  awbNumber: string;
  status: string;
  carrier: string;
  carrierDisplayName: string;
  history: Array<{ code: string; description: string; at: string }>;
  updatedAt: string;
} | null> {
  const [shipment] = await db
    .select()
    .from(shipmentsTable)
    .where(eq(shipmentsTable.awbNumber, awb));
  if (!shipment) return null;
  const [carrier] = await db
    .select()
    .from(shippingCarriersTable)
    .where(eq(shippingCarriersTable.id, shipment.carrierId));
  // Best-effort live refresh — swallow errors so the page still renders.
  if (carrier && !["delivered", "returned", "cancelled"].includes(shipment.status)) {
    try {
      await pollTracking(shipment.id);
    } catch (err) {
      logger.warn({ err, awb }, "public tracking refresh failed");
    }
  }
  const [refreshed] = await db
    .select()
    .from(shipmentsTable)
    .where(eq(shipmentsTable.id, shipment.id));
  const history = (refreshed?.trackingHistory ?? []) as Array<{
    code: string;
    description: string;
    at: string;
  }>;
  return {
    awbNumber: refreshed?.awbNumber ?? awb,
    status: refreshed?.status ?? shipment.status,
    carrier: carrier?.provider ?? "unknown",
    carrierDisplayName: carrier?.displayName ?? carrier?.provider ?? "—",
    history,
    updatedAt: (refreshed?.updatedAt ?? new Date()).toISOString(),
  };
}
