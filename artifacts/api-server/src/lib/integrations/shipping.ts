import { db, shippingCarriersTable, shipmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getCredential, MissingCredentialError } from "./credentials";
import { recordIntegrationCall } from "./audit";

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
  const events = await adapter.fetchTracking(shipment.awbNumber, {
    secret: cred.secret,
    carrier,
  });
  await db
    .update(shipmentsTable)
    .set({ trackingHistory: events, updatedAt: new Date() })
    .where(eq(shipmentsTable.id, shipmentId));
  return events.length;
}
