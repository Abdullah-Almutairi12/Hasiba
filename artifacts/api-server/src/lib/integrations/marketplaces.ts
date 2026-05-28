import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  marketplaceConnectorsTable,
  marketplaceProductMappingsTable,
  marketplaceOrderImportsTable,
  marketplaceOutboundJobsTable,
  marketplaceSyncLogsTable,
  productsTable,
  customersTable,
  salesOrdersTable,
  salesOrderLinesTable,
  deliveryOrdersTable,
  deliveryOrderLinesTable,
  customerInvoicesTable,
  customerInvoiceLinesTable,
  customerReceiptsTable,
  customerReceiptAllocationsTable,
  stockQuantsTable,
  type MarketplaceConnector,
  type Product,
} from "@workspace/db";
import { getCredential, MissingCredentialError } from "./credentials";
import { decryptSecret } from "./crypto";
import { recordIntegrationCall } from "./audit";
import { nextRef } from "../sales-engine";
import { postJournalEntry } from "../journal-posting";
import { branchesTable } from "@workspace/db";
import { buildZatcaQrBase64 } from "../zatca-qr";
import { getCompanyInfo } from "../pdf/purchase-order";
import { logger } from "../logger";

// Webhook secrets are stored encrypted at rest. Decrypt-on-use and
// fall back to plaintext for any legacy rows that pre-date encryption.
function readWebhookSecret(connector: MarketplaceConnector): string | null {
  if (!connector.webhookSecret) return null;
  try {
    return decryptSecret(connector.webhookSecret);
  } catch {
    return connector.webhookSecret;
  }
}

export type Platform = "salla" | "zid" | "shopify";

export interface NormalizedOrderLine {
  externalProductId: string;
  externalVariantId?: string | null;
  sku?: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
}

export interface NormalizedOrder {
  externalOrderId: string;
  externalOrderNumber?: string | null;
  customer: {
    externalId?: string | null;
    name: string;
    email?: string | null;
    phone?: string | null;
    addressLine?: string | null;
  };
  lines: NormalizedOrderLine[];
  subtotal: number;
  vat: number;
  total: number;
  currency: string;
  // Whether the upstream provider has captured payment. Only paid
  // orders post a customer receipt + Dr Cash / Cr AR journal entry.
  paid: boolean;
  createdAt?: string | null;
}

export interface PushResult {
  externalProductId: string;
  externalVariantId?: string | null;
  // Shopify only: inventory_item_id needed by the Inventory Levels API.
  externalInventoryItemId?: string | null;
}

/**
 * Connector interface. Every platform adapter implements the same
 * verbs so the registry/route code is fully provider-agnostic.
 */
export interface MarketplaceAdapter {
  platform: Platform;
  pushProduct(
    connector: MarketplaceConnector,
    product: Product,
    onHand: number,
    existing?: { externalProductId: string; externalVariantId: string | null } | null,
  ): Promise<PushResult>;
  pushInventory(
    connector: MarketplaceConnector,
    externalProductId: string,
    onHand: number,
    externalVariantId?: string | null,
    externalInventoryItemId?: string | null,
  ): Promise<void>;
  pullOrders(connector: MarketplaceConnector): Promise<NormalizedOrder[]>;
  pullCustomers(connector: MarketplaceConnector): Promise<
    Array<{ externalId: string; name: string; email?: string | null; phone?: string | null }>
  >;
  parseWebhook(
    connector: MarketplaceConnector,
    headers: Record<string, string | string[] | undefined>,
    rawBody: Buffer,
  ): {
    kind: "order_created" | "order_updated" | "ignored" | "invalid_signature";
    order?: NormalizedOrder;
  };
}

// ---------------- HTTP helper with audit + sync log ----------------
async function call<T>(args: {
  connector: MarketplaceConnector;
  operation: string;
  url: string;
  init: RequestInit;
}): Promise<{ ok: boolean; status: number; body: T | null; latencyMs: number }> {
  const t0 = Date.now();
  let status = 0;
  let body: T | null = null;
  let ok = false;
  let errorMessage: string | null = null;
  try {
    const r = await fetch(args.url, args.init);
    status = r.status;
    ok = r.ok;
    const text = await r.text();
    try {
      body = text ? (JSON.parse(text) as T) : null;
    } catch {
      body = null;
    }
    if (!ok) errorMessage = text.slice(0, 500);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }
  const latencyMs = Date.now() - t0;
  const payloadSize = (args.init.body ? Buffer.byteLength(String(args.init.body)) : 0);
  await db.insert(marketplaceSyncLogsTable).values({
    connectorId: args.connector.id,
    operation: args.operation,
    direction: "outbound",
    success: ok,
    payloadSizeBytes: payloadSize,
    latencyMs,
    statusCode: status,
    errorMessage,
    payloadSummary: { url: args.url, method: args.init.method ?? "GET" },
  });
  await recordIntegrationCall({
    branchId: args.connector.branchId,
    provider: args.connector.platform,
    endpoint: args.url,
    method: String(args.init.method ?? "GET"),
    statusCode: status,
    durationMs: latencyMs,
    success: ok,
    errorMessage,
  });
  return { ok, status, body, latencyMs };
}

export function credentialLabelForConnector(id: number): string {
  return `marketplace:${id}`;
}

async function authHeaders(connector: MarketplaceConnector): Promise<Record<string, string>> {
  const cred = await getCredential<{ access_token?: string; api_key?: string }>(
    connector.platform,
    {
      branchId: connector.branchId,
      label: credentialLabelForConnector(connector.id),
      environment: connector.environment === "production" ? "production" : "sandbox",
    },
  );
  if (!cred) throw new MissingCredentialError(connector.platform);
  const token = cred.secret.access_token ?? cred.secret.api_key;
  if (!token) throw new MissingCredentialError(connector.platform);
  if (connector.platform === "shopify") {
    return { "X-Shopify-Access-Token": token, "Content-Type": "application/json" };
  }
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

function baseUrl(connector: MarketplaceConnector): string {
  if (connector.storeUrl) return connector.storeUrl.replace(/\/+$/, "");
  switch (connector.platform) {
    case "salla":
      return "https://api.salla.dev/admin/v2";
    case "zid":
      return "https://api.zid.sa/v1";
    case "shopify":
      return "https://example.myshopify.com/admin/api/2024-04";
    default:
      return "";
  }
}

// Wraps call() to throw on non-2xx / empty body so the worker
// can apply retry+backoff. call() stays non-throwing for pull paths.
async function pushCall<T>(args: {
  connector: MarketplaceConnector;
  operation: string;
  url: string;
  init: RequestInit;
}): Promise<T> {
  const r = await call<T>(args);
  if (!r.ok) {
    throw new Error(
      `${args.connector.platform} ${args.operation} failed (${r.status}) at ${args.url}`,
    );
  }
  if (!r.body) {
    throw new Error(
      `${args.connector.platform} ${args.operation} returned empty body at ${args.url}`,
    );
  }
  return r.body;
}

// ---------------- Salla adapter ----------------
const sallaAdapter: MarketplaceAdapter = {
  platform: "salla",
  async pushProduct(connector, product, onHand, existing) {
    const body = {
      name: product.nameAr || product.name,
      name_en: product.name,
      sku: product.sku,
      price: Number(product.price),
      quantity: onHand,
      description: product.nameAr,
      images: product.imageUrl ? [{ url: product.imageUrl }] : [],
    };
    // Update mapped products in place; only create when no mapping yet.
    if (existing?.externalProductId) {
      const url = `${baseUrl(connector)}/products/${existing.externalProductId}`;
      await pushCall({
        connector,
        operation: "push_product",
        url,
        init: { method: "PUT", headers: await authHeaders(connector), body: JSON.stringify(body) },
      });
      return {
        externalProductId: existing.externalProductId,
        externalVariantId: existing.externalVariantId ?? undefined,
      };
    }
    const url = `${baseUrl(connector)}/products`;
    const r = await pushCall<{ data?: { id?: number | string } }>({
      connector,
      operation: "push_product",
      url,
      init: { method: "POST", headers: await authHeaders(connector), body: JSON.stringify(body) },
    });
    if (!r.data?.id) {
      throw new Error(`salla push_product returned no id for sku=${product.sku}`);
    }
    return { externalProductId: String(r.data.id) };
  },
  async pushInventory(connector, externalProductId, onHand) {
    const url = `${baseUrl(connector)}/products/${externalProductId}/quantity`;
    await pushCall({
      connector,
      operation: "push_inventory",
      url,
      init: { method: "PUT", headers: await authHeaders(connector), body: JSON.stringify({ quantity: onHand }) },
    });
  },
  async pullOrders(connector) {
    // Only pull orders whose payment has been captured upstream.
    const url = `${baseUrl(connector)}/orders?status=under_review,in_progress`;
    const r = await call<{ data?: Array<Record<string, unknown>> }>({
      connector,
      operation: "pull_orders",
      url,
      init: { method: "GET", headers: await authHeaders(connector) },
    });
    if (!r.ok || !r.body?.data) return [];
    return r.body.data.map((o) => normalizeSallaOrder(o));
  },
  async pullCustomers(connector) {
    const url = `${baseUrl(connector)}/customers`;
    const r = await call<{ data?: Array<{ id: number; full_name?: string; email?: string; mobile?: string }> }>({
      connector,
      operation: "pull_customers",
      url,
      init: { method: "GET", headers: await authHeaders(connector) },
    });
    if (!r.ok || !r.body?.data) return [];
    return r.body.data.map((c) => ({
      externalId: String(c.id),
      name: c.full_name ?? "Salla Customer",
      email: c.email ?? null,
      phone: c.mobile ?? null,
    }));
  },
  parseWebhook(connector, headers, rawBody) {
    if (!verifyHmacSha256(readWebhookSecret(connector), rawBody, headers["x-salla-signature"])) {
      return { kind: "invalid_signature" };
    }
    const payload = JSON.parse(rawBody.toString("utf8")) as { event?: string; data?: Record<string, unknown> };
    if (!payload?.event?.startsWith("order")) return { kind: "ignored" };
    const order = payload.data ? normalizeSallaOrder(payload.data) : undefined;
    return { kind: payload.event === "order.updated" ? "order_updated" : "order_created", order };
  },
};

function normalizeSallaOrder(o: Record<string, unknown>): NormalizedOrder {
  const items = (o["items"] as Array<Record<string, unknown>>) ?? [];
  const customer = (o["customer"] ?? {}) as Record<string, unknown>;
  const amounts = (o["amounts"] ?? {}) as Record<string, unknown>;
  return {
    externalOrderId: String(o["id"] ?? ""),
    externalOrderNumber: (o["reference_id"] as string) ?? null,
    customer: {
      externalId: customer["id"] ? String(customer["id"]) : null,
      name: (customer["full_name"] as string) ?? "Salla Customer",
      email: (customer["email"] as string) ?? null,
      phone: (customer["mobile"] as string) ?? null,
    },
    lines: items.map((it) => ({
      externalProductId: String(it["product_id"] ?? it["id"] ?? ""),
      externalVariantId: it["variant_id"] ? String(it["variant_id"]) : null,
      sku: (it["sku"] as string) ?? null,
      name: (it["name"] as string) ?? "Item",
      quantity: Number(it["quantity"] ?? 1),
      unitPrice: Number(
        ((it["price"] as Record<string, unknown>)?.["amount"] as number) ??
          (it["price"] as number) ?? 0,
      ),
      taxRate: 15,
    })),
    subtotal: Number((amounts["sub_total"] as Record<string, unknown>)?.["amount"] ?? 0),
    vat: Number((amounts["tax"] as Record<string, unknown>)?.["amount"] ?? 0),
    total: Number((amounts["total"] as Record<string, unknown>)?.["amount"] ?? 0),
    currency: "SAR",
    paid: (o["payment_method"] as string | undefined) !== undefined
      && ((o["status"] as Record<string, unknown> | undefined)?.["slug"] !== "payment_pending"),
    createdAt: (o["date"] as string) ?? null,
  };
}

// ---------------- Zid adapter ----------------
const zidAdapter: MarketplaceAdapter = {
  platform: "zid",
  async pushProduct(connector, product, onHand, existing) {
    const body = {
      name: product.nameAr || product.name,
      name_en: product.name,
      sku: product.sku,
      price: Number(product.price),
      stock: onHand,
      images: product.imageUrl ? [product.imageUrl] : [],
    };
    if (existing?.externalProductId) {
      const url = `${baseUrl(connector)}/products/${existing.externalProductId}`;
      await pushCall({
        connector,
        operation: "push_product",
        url,
        init: { method: "PATCH", headers: await authHeaders(connector), body: JSON.stringify(body) },
      });
      return {
        externalProductId: existing.externalProductId,
        externalVariantId: existing.externalVariantId ?? undefined,
      };
    }
    const url = `${baseUrl(connector)}/products`;
    const r = await pushCall<{ id?: number | string }>({
      connector,
      operation: "push_product",
      url,
      init: { method: "POST", headers: await authHeaders(connector), body: JSON.stringify(body) },
    });
    if (!r.id) {
      throw new Error(`zid push_product returned no id for sku=${product.sku}`);
    }
    return { externalProductId: String(r.id) };
  },
  async pushInventory(connector, externalProductId, onHand) {
    const url = `${baseUrl(connector)}/products/${externalProductId}`;
    await pushCall({
      connector,
      operation: "push_inventory",
      url,
      init: { method: "PATCH", headers: await authHeaders(connector), body: JSON.stringify({ stock: onHand }) },
    });
  },
  async pullOrders(connector) {
    const url = `${baseUrl(connector)}/orders?status=new`;
    const r = await call<{ orders?: Array<Record<string, unknown>> }>({
      connector,
      operation: "pull_orders",
      url,
      init: { method: "GET", headers: await authHeaders(connector) },
    });
    if (!r.ok || !r.body?.orders) return [];
    return r.body.orders.map((o) => normalizeZidOrder(o));
  },
  async pullCustomers(connector) {
    const url = `${baseUrl(connector)}/customers`;
    const r = await call<{ customers?: Array<{ id: number; name?: string; email?: string; mobile?: string }> }>({
      connector,
      operation: "pull_customers",
      url,
      init: { method: "GET", headers: await authHeaders(connector) },
    });
    if (!r.ok || !r.body?.customers) return [];
    return r.body.customers.map((c) => ({
      externalId: String(c.id),
      name: c.name ?? "Zid Customer",
      email: c.email ?? null,
      phone: c.mobile ?? null,
    }));
  },
  parseWebhook(connector, headers, rawBody) {
    if (!verifyHmacSha256(readWebhookSecret(connector), rawBody, headers["x-zid-signature"])) {
      return { kind: "invalid_signature" };
    }
    const payload = JSON.parse(rawBody.toString("utf8")) as { event?: string; order?: Record<string, unknown> };
    if (!payload?.event?.startsWith("order")) return { kind: "ignored" };
    return {
      kind: payload.event === "order.updated" ? "order_updated" : "order_created",
      order: payload.order ? normalizeZidOrder(payload.order) : undefined,
    };
  },
};

function normalizeZidOrder(o: Record<string, unknown>): NormalizedOrder {
  const items = (o["products"] as Array<Record<string, unknown>>) ?? [];
  const customer = (o["customer"] ?? {}) as Record<string, unknown>;
  return {
    externalOrderId: String(o["id"] ?? ""),
    externalOrderNumber: (o["code"] as string) ?? null,
    customer: {
      externalId: customer["id"] ? String(customer["id"]) : null,
      name: (customer["name"] as string) ?? "Zid Customer",
      email: (customer["email"] as string) ?? null,
      phone: (customer["mobile"] as string) ?? null,
    },
    lines: items.map((it) => ({
      externalProductId: String(it["product_id"] ?? it["id"] ?? ""),
      externalVariantId: it["variant_id"] ? String(it["variant_id"]) : null,
      sku: (it["sku"] as string) ?? null,
      name: (it["name"] as string) ?? "Item",
      quantity: Number(it["quantity"] ?? 1),
      unitPrice: Number(it["price"] ?? 0),
      taxRate: 15,
    })),
    subtotal: Number(o["sub_total"] ?? 0),
    vat: Number(o["tax"] ?? 0),
    total: Number(o["total"] ?? 0),
    currency: "SAR",
    paid: ((o["payment_status"] as string) ?? "").toLowerCase() === "paid"
      || Boolean(o["is_paid"]),
    createdAt: (o["created_at"] as string) ?? null,
  };
}

// ---------------- Shopify adapter ----------------
//
// Shopify's inventory API does NOT accept a variant id directly: it
// requires `inventory_item_id` (a separate identifier on each variant)
// plus a `location_id` that maps to a Shopify warehouse. We persist
// the inventory item id as our `externalVariantId` (it's what every
// later inventory push needs) and cache the primary location id on
// `marketplace_connectors.settings.primaryLocationId`.

async function getShopifyPrimaryLocation(connector: MarketplaceConnector): Promise<string | null> {
  const cached = (connector.settings as Record<string, unknown> | null)?.["primaryLocationId"];
  if (typeof cached === "string" && cached.length > 0) return cached;
  const r = await call<{ locations?: Array<{ id: number; primary?: boolean; active?: boolean }> }>({
    connector,
    operation: "pull_locations",
    url: `${baseUrl(connector)}/locations.json`,
    init: { method: "GET", headers: await authHeaders(connector) },
  });
  const locations = r.body?.locations ?? [];
  const chosen = locations.find((l) => l.primary && l.active !== false) ?? locations[0];
  if (!chosen) return null;
  const id = String(chosen.id);
  const merged = {
    ...((connector.settings as Record<string, unknown> | null) ?? {}),
    primaryLocationId: id,
  };
  await db
    .update(marketplaceConnectorsTable)
    .set({ settings: merged, updatedAt: new Date() })
    .where(eq(marketplaceConnectorsTable.id, connector.id));
  return id;
}

const shopifyAdapter: MarketplaceAdapter = {
  platform: "shopify",
  async pushProduct(connector, product, onHand, existing) {
    if (existing?.externalProductId) {
      // Shopify product update: title/body/images via Products API, then
      // inventory via the existing pushInventory path (caller invokes
      // separately after save). We do not POST a new product when a
      // mapping already exists, otherwise the store accrues duplicates.
      const url = `${baseUrl(connector)}/products/${existing.externalProductId}.json`;
      const body = {
        product: {
          id: Number(existing.externalProductId),
          title: product.name,
          body_html: product.nameAr,
          images: product.imageUrl ? [{ src: product.imageUrl }] : [],
        },
      };
      await pushCall({
        connector,
        operation: "push_product",
        url,
        init: { method: "PUT", headers: await authHeaders(connector), body: JSON.stringify(body) },
      });
      return {
        externalProductId: existing.externalProductId,
        externalVariantId: existing.externalVariantId ?? undefined,
      };
    }
    const url = `${baseUrl(connector)}/products.json`;
    const body = {
      product: {
        title: product.name,
        body_html: product.nameAr,
        variants: [
          {
            sku: product.sku,
            price: String(product.price),
            inventory_quantity: onHand,
            inventory_management: "shopify",
          },
        ],
        images: product.imageUrl ? [{ src: product.imageUrl }] : [],
      },
    };
    const r = await pushCall<{
      product?: { id: number; variants?: Array<{ id: number; inventory_item_id?: number }> };
    }>({
      connector,
      operation: "push_product",
      url,
      init: { method: "POST", headers: await authHeaders(connector), body: JSON.stringify(body) },
    });
    const variant = r.product?.variants?.[0];
    if (!r.product?.id) {
      throw new Error(`shopify push_product returned no product id for sku=${product.sku}`);
    }
    if (!variant?.id || !variant?.inventory_item_id) {
      throw new Error(`shopify push_product returned no variant id / inventory_item_id for sku=${product.sku}`);
    }
    return {
      externalProductId: String(r.product.id),
      // Storefront variant id — used by order webhooks for line matching.
      externalVariantId: String(variant.id),
      // Inventory Levels API key — used by pushInventory below.
      externalInventoryItemId: String(variant.inventory_item_id),
    };
  },
  async pushInventory(connector, _externalProductId, onHand, _externalVariantId, externalInventoryItemId) {
    // Shopify ignores variant id for inventory; it requires inventory_item_id.
    if (!externalInventoryItemId) {
      throw new Error("shopify: missing inventory_item_id — re-run product push to backfill the mapping");
    }
    const locationId = await getShopifyPrimaryLocation(connector);
    if (!locationId) {
      throw new Error("shopify: no active location available for inventory push");
    }
    const url = `${baseUrl(connector)}/inventory_levels/set.json`;
    await pushCall({
      connector,
      operation: "push_inventory",
      url,
      init: {
        method: "POST",
        headers: await authHeaders(connector),
        body: JSON.stringify({
          inventory_item_id: externalInventoryItemId,
          location_id: locationId,
          available: onHand,
        }),
      },
    });
  },
  async pullOrders(connector) {
    const url = `${baseUrl(connector)}/orders.json?status=open&financial_status=paid`;
    const r = await call<{ orders?: Array<Record<string, unknown>> }>({
      connector,
      operation: "pull_orders",
      url,
      init: { method: "GET", headers: await authHeaders(connector) },
    });
    if (!r.ok || !r.body?.orders) return [];
    return r.body.orders.map((o) => normalizeShopifyOrder(o));
  },
  async pullCustomers(connector) {
    const url = `${baseUrl(connector)}/customers.json`;
    const r = await call<{ customers?: Array<{ id: number; first_name?: string; last_name?: string; email?: string; phone?: string }> }>({
      connector,
      operation: "pull_customers",
      url,
      init: { method: "GET", headers: await authHeaders(connector) },
    });
    if (!r.ok || !r.body?.customers) return [];
    return r.body.customers.map((c) => ({
      externalId: String(c.id),
      name: `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "Shopify Customer",
      email: c.email ?? null,
      phone: c.phone ?? null,
    }));
  },
  parseWebhook(connector, headers, rawBody) {
    const sig = headers["x-shopify-hmac-sha256"];
    if (!verifyHmacSha256Base64(readWebhookSecret(connector), rawBody, sig)) {
      return { kind: "invalid_signature" };
    }
    const topic = String(headers["x-shopify-topic"] ?? "");
    if (!topic.startsWith("orders/")) return { kind: "ignored" };
    const payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    return {
      kind: topic === "orders/updated" ? "order_updated" : "order_created",
      order: normalizeShopifyOrder(payload),
    };
  },
};

function normalizeShopifyOrder(o: Record<string, unknown>): NormalizedOrder {
  const items = (o["line_items"] as Array<Record<string, unknown>>) ?? [];
  const customer = (o["customer"] ?? {}) as Record<string, unknown>;
  return {
    externalOrderId: String(o["id"] ?? ""),
    externalOrderNumber: (o["name"] as string) ?? null,
    customer: {
      externalId: customer["id"] ? String(customer["id"]) : null,
      name:
        `${(customer["first_name"] as string) ?? ""} ${(customer["last_name"] as string) ?? ""}`.trim() ||
        "Shopify Customer",
      email: (customer["email"] as string) ?? null,
      phone: (customer["phone"] as string) ?? null,
    },
    lines: items.map((it) => ({
      externalProductId: String(it["product_id"] ?? it["id"] ?? ""),
      externalVariantId: it["variant_id"] ? String(it["variant_id"]) : null,
      sku: (it["sku"] as string) ?? null,
      name: (it["title"] as string) ?? "Item",
      quantity: Number(it["quantity"] ?? 1),
      unitPrice: Number(it["price"] ?? 0),
      taxRate: 15,
    })),
    subtotal: Number(o["subtotal_price"] ?? 0),
    vat: Number(o["total_tax"] ?? 0),
    total: Number(o["total_price"] ?? 0),
    currency: (o["currency"] as string) ?? "SAR",
    paid: ((o["financial_status"] as string) ?? "").toLowerCase() === "paid",
    createdAt: (o["created_at"] as string) ?? null,
  };
}

// ---------------- Signature helpers ----------------
function verifyHmacSha256(
  secret: string | null,
  rawBody: Buffer,
  signature: string | string[] | undefined,
): boolean {
  if (!secret || !signature) return false;
  const sig = Array.isArray(signature) ? signature[0]! : signature;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig.replace(/^sha256=/, ""), "hex"));
  } catch {
    return false;
  }
}

function verifyHmacSha256Base64(
  secret: string | null,
  rawBody: Buffer,
  signature: string | string[] | undefined,
): boolean {
  if (!secret || !signature) return false;
  const sig = Array.isArray(signature) ? signature[0]! : signature;
  const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
  try {
    return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8"));
  } catch {
    return false;
  }
}

// ---------------- Registry ----------------
export const ADAPTERS: Record<Platform, MarketplaceAdapter> = {
  salla: sallaAdapter,
  zid: zidAdapter,
  shopify: shopifyAdapter,
};

export function getAdapter(platform: string): MarketplaceAdapter {
  const a = ADAPTERS[platform as Platform];
  if (!a) throw new Error(`Unknown marketplace platform: ${platform}`);
  return a;
}

// Durable outbound job queue persisted to `marketplace_outbound_jobs`.
// Worker drains with exponential backoff so pushes survive restarts.

const WORKER_TICK_MS = 5_000;
const JOB_LOCK_TIMEOUT_MS = 5 * 60_000;
let workerHandle: NodeJS.Timeout | null = null;

interface OutboundJobPayload {
  productId?: number;
  externalProductId?: string;
  externalVariantId?: string | null;
  externalInventoryItemId?: string | null;
  productIds?: number[];
  orderImportId?: number;
}

async function enqueueOutboundJob(
  connectorId: number,
  jobType: string,
  dedupeKey: string,
  payload: OutboundJobPayload,
): Promise<void> {
  // Coalesce via unique (dedupe_key, status='queued') index.
  await db
    .insert(marketplaceOutboundJobsTable)
    .values({
      connectorId,
      jobType,
      dedupeKey,
      payload: payload as unknown as Record<string, unknown>,
      // Defer 1s so a tight burst of recordStockMove calls all see
      // the same queued row before the worker picks it up.
      nextRunAt: new Date(Date.now() + 1_000),
    })
    .onConflictDoNothing({
      // Matches the partial unique index marketplace_oj_dedupe_queued_idx
      // (dedupe_key WHERE status='queued'). Drizzle requires both the
      // target column and the matching predicate to bind the conflict
      // to the partial index.
      target: marketplaceOutboundJobsTable.dedupeKey,
      where: sql`${marketplaceOutboundJobsTable.status} = 'queued'`,
    });
}

/**
 * Enqueue inventory pushes for a product across every enabled
 * connector. Backed by `marketplace_outbound_jobs` so pushes are
 * durable across restarts.
 */
export function broadcastInventoryChange(productId: number): void {
  void scheduleInventoryPush(productId);
}

/**
 * Enqueue a catalog push (name/price/images) for a product across every
 * enabled connector that already has a mapping. Called from product
 * save/update routes so ERP→store sync happens on save as required.
 * Connectors with no existing mapping are skipped — initial catalog
 * push must go through the explicit "push-catalogue" route.
 */
export function broadcastProductChange(productId: number): void {
  void scheduleProductPush(productId);
}

async function scheduleProductPush(productId: number) {
  const mappings = await db
    .select({
      connectorId: marketplaceProductMappingsTable.connectorId,
      isEnabled: marketplaceConnectorsTable.isEnabled,
    })
    .from(marketplaceProductMappingsTable)
    .innerJoin(
      marketplaceConnectorsTable,
      eq(marketplaceConnectorsTable.id, marketplaceProductMappingsTable.connectorId),
    )
    .where(
      and(
        eq(marketplaceProductMappingsTable.productId, productId),
        eq(marketplaceConnectorsTable.isEnabled, true),
      ),
    );
  for (const m of mappings) {
    await enqueueOutboundJob(
      m.connectorId,
      "push_product",
      `push_product:${m.connectorId}:${productId}`,
      { productId, productIds: [productId] },
    );
  }
}

async function scheduleInventoryPush(productId: number) {
  const mappings = await db
    .select({
      connectorId: marketplaceProductMappingsTable.connectorId,
      productId: marketplaceProductMappingsTable.productId,
      externalProductId: marketplaceProductMappingsTable.externalProductId,
      externalVariantId: marketplaceProductMappingsTable.externalVariantId,
      externalInventoryItemId: marketplaceProductMappingsTable.externalInventoryItemId,
      isEnabled: marketplaceConnectorsTable.isEnabled,
    })
    .from(marketplaceProductMappingsTable)
    .innerJoin(
      marketplaceConnectorsTable,
      eq(marketplaceConnectorsTable.id, marketplaceProductMappingsTable.connectorId),
    )
    .where(
      and(
        eq(marketplaceProductMappingsTable.productId, productId),
        eq(marketplaceConnectorsTable.isEnabled, true),
      ),
    );

  for (const m of mappings) {
    await enqueueOutboundJob(
      m.connectorId,
      "push_inventory",
      `push_inventory:${m.connectorId}:${m.productId}`,
      {
        productId: m.productId,
        externalProductId: m.externalProductId,
        externalVariantId: m.externalVariantId,
        externalInventoryItemId: m.externalInventoryItemId,
      },
    );
  }
}

/**
 * Drain the outbound job queue. Picks up to `batch` jobs that are
 * either queued (and due) or running but past the lock timeout
 * (recovered from a crashed worker), executes them, and updates
 * status with exponential backoff on failure.
 *
 * Idempotent and safe to call from a setInterval — each job is
 * atomically claimed via UPDATE...RETURNING so two concurrent
 * workers cannot pick the same row.
 */
export async function processOutboundJobs(batch = 10): Promise<{ processed: number; failed: number }> {
  const now = new Date();
  // Atomic claim: flip queued (due) OR stuck-running rows to
  // 'running', returning what we got. RETURNING gives us a snapshot
  // of the row we now own.
  const claimed = await db.execute<{
    id: number;
    connector_id: number;
    job_type: string;
    dedupe_key: string;
    payload: OutboundJobPayload;
    attempts: number;
    max_attempts: number;
  }>(sql`
    UPDATE marketplace_outbound_jobs
       SET status = 'running',
           started_at = NOW(),
           attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM marketplace_outbound_jobs
        WHERE (status = 'queued' AND next_run_at <= ${now})
           OR (status = 'running' AND started_at < ${new Date(Date.now() - JOB_LOCK_TIMEOUT_MS)})
        ORDER BY next_run_at ASC
        LIMIT ${batch}
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id, connector_id, job_type, dedupe_key, payload, attempts, max_attempts
  `);

  let processed = 0;
  let failed = 0;
  for (const job of claimed.rows) {
    try {
      await executeOutboundJob(job);
      await db
        .update(marketplaceOutboundJobsTable)
        .set({ status: "done", completedAt: new Date(), lastError: null })
        .where(eq(marketplaceOutboundJobsTable.id, job.id));
      processed++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      const isFinal = job.attempts >= job.max_attempts;
      // Exponential backoff: 2^attempts minutes, capped at 1 hour.
      const backoffMs = Math.min(60 * 60_000, Math.pow(2, job.attempts) * 60_000);
      await db
        .update(marketplaceOutboundJobsTable)
        .set({
          status: isFinal ? "failed" : "queued",
          lastError: msg.slice(0, 1024),
          nextRunAt: new Date(Date.now() + backoffMs),
          completedAt: isFinal ? new Date() : null,
        })
        .where(eq(marketplaceOutboundJobsTable.id, job.id));
      await db.insert(marketplaceSyncLogsTable).values({
        connectorId: job.connector_id,
        operation: job.job_type,
        direction: "outbound",
        success: false,
        errorMessage: msg,
      });
    }
  }
  return { processed, failed };
}

async function executeOutboundJob(job: {
  connector_id: number;
  job_type: string;
  payload: OutboundJobPayload;
}): Promise<void> {
  const [connector] = await db
    .select()
    .from(marketplaceConnectorsTable)
    .where(
      and(
        eq(marketplaceConnectorsTable.id, job.connector_id),
        eq(marketplaceConnectorsTable.isEnabled, true),
      ),
    );
  if (!connector) return; // Connector disabled/deleted; drop the job.

  switch (job.job_type) {
    case "push_inventory": {
      const { productId, externalProductId, externalVariantId, externalInventoryItemId } =
        job.payload;
      if (!productId || !externalProductId) return;
      await pushInventoryNow(
        connector.id,
        productId,
        externalProductId,
        externalVariantId ?? null,
        externalInventoryItemId ?? null,
      );
      return;
    }
    case "push_product": {
      const ids = job.payload.productIds ?? (job.payload.productId ? [job.payload.productId] : undefined);
      await pushCatalogue(connector, ids);
      return;
    }
    case "pull_orders": {
      await syncOrdersForConnector(connector);
      return;
    }
    case "retry_order_import": {
      const { orderImportId } = job.payload;
      if (!orderImportId) return;
      await retryOrderImportInternal(connector, orderImportId);
      return;
    }
    default:
      throw new Error(`Unknown job type: ${job.job_type}`);
  }
}

/**
 * Start the background worker that drains the outbound job queue.
 * Safe to call multiple times — only the first call installs the
 * interval. Tests should not call this.
 */
export function startMarketplaceWorker(): void {
  if (workerHandle) return;
  workerHandle = setInterval(() => {
    void processOutboundJobs().catch((err) => {
      logger.error({ err }, "marketplace outbound worker tick failed");
    });
  }, WORKER_TICK_MS);
  workerHandle.unref();
}

/**
 * Compute the on-hand quantity available for sale on a given marketplace.
 * Always sourced from `stock_quants` for the connector's mapped warehouse
 * (or summed across non-scrap warehouses when none is configured) so the
 * value pushed upstream matches the actual fulfilment location — never
 * the global `products.stock` cache.
 */
async function getOnHandForConnector(
  productId: number,
  warehouseId: number | null,
): Promise<number> {
  if (warehouseId != null) {
    const [row] = await db
      .select({ q: sql<string>`COALESCE(SUM(${stockQuantsTable.quantity}), 0)::text` })
      .from(stockQuantsTable)
      .where(
        and(
          eq(stockQuantsTable.productId, productId),
          eq(stockQuantsTable.warehouseId, warehouseId),
        ),
      );
    return Math.max(0, Number(row?.q ?? 0));
  }
  const result = await db.execute<{ q: string }>(sql`
    SELECT COALESCE(SUM(q.quantity), 0)::text AS q
      FROM stock_quants q
      JOIN warehouses w ON w.id = q.warehouse_id
     WHERE q.product_id = ${productId}
       AND w.is_scrap = false
  `);
  const row = result.rows[0];
  return Math.max(0, Number(row?.q ?? 0));
}

async function pushInventoryNow(
  connectorId: number,
  productId: number,
  externalProductId: string,
  externalVariantId: string | null,
  externalInventoryItemId: string | null,
) {
  const [connector] = await db
    .select()
    .from(marketplaceConnectorsTable)
    .where(
      and(
        eq(marketplaceConnectorsTable.id, connectorId),
        eq(marketplaceConnectorsTable.isEnabled, true),
      ),
    );
  if (!connector) return;
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, productId));
  if (!product) return;
  const adapter = getAdapter(connector.platform);
  const onHand = await getOnHandForConnector(productId, connector.defaultWarehouseId);
  await adapter.pushInventory(
    connector,
    externalProductId,
    onHand,
    externalVariantId,
    externalInventoryItemId,
  );
  await db
    .update(marketplaceProductMappingsTable)
    .set({ lastInventoryPushedAt: new Date() })
    .where(
      and(
        eq(marketplaceProductMappingsTable.connectorId, connectorId),
        eq(marketplaceProductMappingsTable.productId, productId),
      ),
    );
}

// ---------------- Order import → Sales Order ----------------
async function findOrCreateCustomer(
  order: NormalizedOrder,
  companyId: number,
): Promise<{ id: number; name: string }> {
  // Multi-tenant: dedupe must be scoped to the owning company so two
  // tenants with the same customer email/phone do not collide.
  if (order.customer.email) {
    const [existing] = await db
      .select({ id: customersTable.id, name: customersTable.name })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.email, order.customer.email),
          eq(customersTable.companyId, companyId),
        ),
      );
    if (existing) return existing;
  }
  if (order.customer.phone) {
    const [existing] = await db
      .select({ id: customersTable.id, name: customersTable.name })
      .from(customersTable)
      .where(
        and(
          eq(customersTable.phone, order.customer.phone),
          eq(customersTable.companyId, companyId),
        ),
      );
    if (existing) return existing;
  }
  const [created] = await db
    .insert(customersTable)
    .values({
      name: order.customer.name,
      email: order.customer.email ?? null,
      phone: order.customer.phone ?? null,
      shippingAddress: order.customer.addressLine ?? null,
      companyId,
    })
    .returning({ id: customersTable.id, name: customersTable.name });
  return created!;
}

/**
 * Marketplace webhooks run without a session, so we derive the owning
 * tenant from the connector's branch row. Throws if the connector has
 * no branch or the branch has no companyId (a misconfiguration we want
 * to surface loudly rather than silently leak data across tenants).
 */
async function getConnectorCompanyId(branchId: number | null): Promise<number> {
  if (branchId == null) {
    throw new Error("Marketplace connector has no branchId — cannot resolve tenant");
  }
  const [row] = await db
    .select({ companyId: branchesTable.companyId })
    .from(branchesTable)
    .where(eq(branchesTable.id, branchId))
    .limit(1);
  if (!row?.companyId) {
    throw new Error(`Branch ${branchId} has no companyId — marketplace import refused`);
  }
  return row.companyId;
}

async function resolveProductId(
  connectorId: number,
  externalProductId: string,
  externalVariantId: string | null | undefined,
  sku: string | null | undefined,
): Promise<number | null> {
  // Variant-aware lookup first — same external product may map to many
  // ERP products when the store models size/color variants.
  if (externalVariantId) {
    const [byVariant] = await db
      .select({ productId: marketplaceProductMappingsTable.productId })
      .from(marketplaceProductMappingsTable)
      .where(
        and(
          eq(marketplaceProductMappingsTable.connectorId, connectorId),
          eq(marketplaceProductMappingsTable.externalProductId, externalProductId),
          eq(marketplaceProductMappingsTable.externalVariantId, externalVariantId),
        ),
      );
    if (byVariant) return byVariant.productId;
  }
  const [mapped] = await db
    .select({ productId: marketplaceProductMappingsTable.productId })
    .from(marketplaceProductMappingsTable)
    .where(
      and(
        eq(marketplaceProductMappingsTable.connectorId, connectorId),
        eq(marketplaceProductMappingsTable.externalProductId, externalProductId),
      ),
    );
  if (mapped) return mapped.productId;
  if (sku) {
    const [bySku] = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(eq(productsTable.sku, sku));
    if (bySku) return bySku.id;
  }
  return null;
}

/**
 * Persist a normalised marketplace order as a confirmed Sales Order
 * with a draft Delivery Order, a posted Customer Invoice, a journal
 * entry, and — when the upstream order is already paid — a Customer
 * Receipt that fully allocates against the invoice.
 *
 * Idempotency: a unique (connector_id, external_order_id) row in
 * `marketplace_order_imports` guarantees we never double-import an
 * external order. `imported` rows short-circuit; `pending` / `failed`
 * rows are *retried* — the previous code returned early on every
 * existing row, which left failed imports permanently stuck.
 *
 * All writes (import row update + SO + lines + DO + invoice + journal
 * + receipt + allocation + customer aggregates) happen inside a single
 * DB transaction so a mid-flight failure leaves no partial state.
 */
export async function importOrder(
  connector: MarketplaceConnector,
  order: NormalizedOrder,
): Promise<{ orderImportId: number; soId: number | null; status: string }> {
  // Look up — or create — the order-import row. Failed/pending rows
  // are reused so we can retry them in place.
  const [existing] = await db
    .select()
    .from(marketplaceOrderImportsTable)
    .where(
      and(
        eq(marketplaceOrderImportsTable.connectorId, connector.id),
        eq(marketplaceOrderImportsTable.externalOrderId, order.externalOrderId),
      ),
    );

  if (existing && existing.status === "imported") {
    return { orderImportId: existing.id, soId: existing.soId, status: existing.status };
  }

  let importRowId: number;
  if (existing) {
    importRowId = existing.id;
    await db
      .update(marketplaceOrderImportsTable)
      .set({
        status: "pending",
        errorMessage: null,
        rawPayload: order as unknown as Record<string, unknown>,
        total: order.total.toFixed(2),
      })
      .where(eq(marketplaceOrderImportsTable.id, existing.id));
  } else {
    const [imp] = await db
      .insert(marketplaceOrderImportsTable)
      .values({
        connectorId: connector.id,
        externalOrderId: order.externalOrderId,
        externalOrderNumber: order.externalOrderNumber ?? null,
        status: "pending",
        total: order.total.toFixed(2),
        rawPayload: order as unknown as Record<string, unknown>,
      })
      .returning({ id: marketplaceOrderImportsTable.id });
    importRowId = imp!.id;
  }

  try {
    const connectorCompanyId = await getConnectorCompanyId(connector.branchId);
    const customer = await findOrCreateCustomer(order, connectorCompanyId);
    const company = await getCompanyInfo();
    const sellerNameForZatca =
      company.nameAr && company.nameAr !== "—"
        ? company.nameAr
        : process.env["ZATCA_SELLER_NAME"] ?? "حاسبة AI";
    const sellerVatForZatca =
      company.vatNumber && company.vatNumber !== "—"
        ? company.vatNumber
        : process.env["ZATCA_VAT_NUMBER"] ?? "300000000000003";
    const soId = await db.transaction(async (tx) => {
      // ---------------- Sales Order ----------------
      const soRef = await nextRef(tx, `MKT-${connector.platform.toUpperCase()}`);
      const [so] = await tx
        .insert(salesOrdersTable)
        .values({
          companyId: connectorCompanyId,
          reference: soRef,
          customerId: customer.id,
          customerName: customer.name,
          branchId: connector.branchId,
          warehouseId: connector.defaultWarehouseId,
          status: "confirmed",
          orderDate: (order.createdAt ?? new Date().toISOString()).slice(0, 10),
          currencyCode: order.currency || "SAR",
          subtotal: order.subtotal.toFixed(2),
          vat: order.vat.toFixed(2),
          total: order.total.toFixed(2),
          source: "portal",
        })
        .returning();

      const insertedLines: Array<{
        id: number;
        productId: number | null;
        quantity: number;
        unitPrice: number;
        taxRate: number;
        description: string;
      }> = [];
      for (const line of order.lines) {
        const productId = await resolveProductId(
          connector.id,
          line.externalProductId,
          line.externalVariantId ?? null,
          line.sku ?? null,
        );
        const lineTotal = line.quantity * line.unitPrice;
        const [row] = await tx
          .insert(salesOrderLinesTable)
          .values({
            soId: so!.id,
            productId,
            description: line.name,
            quantity: line.quantity.toString(),
            unitPrice: line.unitPrice.toString(),
            taxRate: String(line.taxRate ?? 15),
            lineTotal: lineTotal.toFixed(2),
          })
          .returning({ id: salesOrderLinesTable.id });
        insertedLines.push({
          id: row!.id,
          productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          taxRate: line.taxRate ?? 15,
          description: line.name,
        });
      }

      // ---------------- Draft Delivery Order ----------------
      let doId: number | null = null;
      if (connector.defaultWarehouseId) {
        const doRef = await nextRef(tx, `MKT-DO-${connector.platform.toUpperCase()}`);
        const [doc] = await tx
          .insert(deliveryOrdersTable)
          .values({
            companyId: connectorCompanyId,
            reference: doRef,
            soId: so!.id,
            warehouseId: connector.defaultWarehouseId,
            status: "draft",
            deliveryDate: (order.createdAt ?? new Date().toISOString()).slice(0, 10),
            notes: `Marketplace ${connector.platform} #${order.externalOrderNumber ?? order.externalOrderId}`,
          })
          .returning();
        doId = doc!.id;
        for (const l of insertedLines) {
          await tx.insert(deliveryOrderLinesTable).values({
            doId: doc!.id,
            soLineId: l.id,
            productId: l.productId,
            description: l.description,
            quantity: l.quantity.toString(),
          });
        }
      }

      // ---------------- Customer Invoice ----------------
      // Marketplaces normally hand us already-paid orders, so the
      // invoice is posted and immediately marked 'paid' with a
      // matching receipt + allocation below. The DO transition
      // posts COGS / moves stock independently when the warehouse
      // team dispatches.
      const invRef = await nextRef(tx, "SINV");
      const invoiceDate = (order.createdAt ?? new Date().toISOString()).slice(0, 10);
      const zatcaQr = buildZatcaQrBase64({
        timestamp: new Date(invoiceDate),
        totalWithVat: order.total,
        vatAmount: order.vat,
        sellerName: sellerNameForZatca,
        vatNumber: sellerVatForZatca,
      });
      const [inv] = await tx
        .insert(customerInvoicesTable)
        .values({
          companyId: connectorCompanyId,
          reference: invRef,
          soId: so!.id,
          customerId: customer.id,
          customerName: customer.name,
          branchId: connector.branchId,
          status: order.paid ? "paid" : "open",
          invoiceDate,
          dueDate: invoiceDate,
          currencyCode: order.currency || "SAR",
          subtotal: order.subtotal.toFixed(2),
          discount: "0",
          vat: order.vat.toFixed(2),
          total: order.total.toFixed(2),
          amountPaid: order.paid ? order.total.toFixed(2) : "0",
          zatcaQr,
          source: "manual",
          sourceRef: `${connector.platform}:${order.externalOrderId}`,
          isLocked: true,
          lockedAt: new Date(),
        })
        .returning();

      for (const l of insertedLines) {
        await tx.insert(customerInvoiceLinesTable).values({
          invoiceId: inv!.id,
          soLineId: l.id,
          productId: l.productId,
          description: l.description,
          quantity: l.quantity.toString(),
          unitPrice: l.unitPrice.toString(),
          taxRate: l.taxRate.toString(),
          lineTotal: (l.quantity * l.unitPrice).toFixed(2),
        });
      }

      // ---------------- Journal: Dr AR / Cr Sales / Cr VAT ----------------
      const jLines: Array<{
        systemKey: string;
        debit?: number;
        credit?: number;
        description?: string;
      }> = [{ systemKey: "ar", debit: order.total, description: `فاتورة سوق ${invRef}` }];
      if (order.subtotal > 0) {
        jLines.push({
          systemKey: "sales_revenue",
          credit: order.subtotal,
          description: "إيرادات مبيعات (متجر إلكتروني)",
        });
      }
      if (order.vat > 0) {
        jLines.push({
          systemKey: "vat_output",
          credit: order.vat,
          description: "ضريبة القيمة المضافة 15%",
        });
      }
      await postJournalEntry(
        tx,
        {
          entryDate: invoiceDate,
          description: `فاتورة سوق — ${invRef}`,
          reference: invRef,
          source: "manual",
          sourceRef: invRef,
          createdBy: null,
          status: "posted",
          companyId: connectorCompanyId,
        },
        jLines,
      );

      // Customer receipt + Dr Cash / Cr AR only when upstream
      // captured payment. Unpaid orders leave AR open.
      let receiptId: number | null = null;
      if (order.paid) {
        const rctRef = await nextRef(tx, "RCT");
        const [receipt] = await tx
          .insert(customerReceiptsTable)
          .values({
            reference: rctRef,
            customerId: customer.id,
            customerName: customer.name,
            receiptDate: invoiceDate,
            amount: order.total.toFixed(2),
            currencyCode: order.currency || "SAR",
            paymentMethod: "card",
            bankRef: `${connector.platform}:${order.externalOrderId}`,
          })
          .returning();
        receiptId = receipt!.id;
        await tx.insert(customerReceiptAllocationsTable).values({
          receiptId: receipt!.id,
          invoiceId: inv!.id,
          amount: order.total.toFixed(2),
        });
        await postJournalEntry(
          tx,
          {
            entryDate: invoiceDate,
            description: `سند قبض — ${rctRef}`,
            reference: rctRef,
            source: "manual",
            sourceRef: rctRef,
            createdBy: null,
            status: "posted",
            companyId: connectorCompanyId,
          },
          [
            { systemKey: "cash", debit: order.total, description: `قبض سوق ${connector.platform}` },
            { systemKey: "ar", credit: order.total, description: `إقفال فاتورة ${invRef}` },
          ],
        );
      }

      // ---------------- Customer aggregates ----------------
      await tx
        .update(customersTable)
        .set({
          totalOrders: sql`${customersTable.totalOrders} + 1`,
          totalSpent: sql`${customersTable.totalSpent}::numeric + ${order.total}`,
        })
        .where(eq(customersTable.id, customer.id));

      // ---------------- Mark import row as imported ----------------
      await tx
        .update(marketplaceOrderImportsTable)
        .set({
          status: "imported",
          soId: so!.id,
          customerId: customer.id,
          importedAt: new Date(),
          errorMessage: null,
          rawPayload: {
            order,
            deliveryOrderId: doId,
            invoiceId: inv!.id,
            receiptId,
          } as unknown as Record<string, unknown>,
        })
        .where(eq(marketplaceOrderImportsTable.id, importRowId));

      return so!.id;
    });

    await db.insert(marketplaceSyncLogsTable).values({
      connectorId: connector.id,
      operation: "pull_orders",
      direction: "inbound",
      success: true,
      externalRef: order.externalOrderId,
      payloadSummary: { lines: order.lines.length, total: order.total },
    });

    return { orderImportId: importRowId, soId, status: "imported" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Transaction rolled back — flip the row to 'failed' so the
    // operator can retry it from the admin UI / retry queue.
    await db
      .update(marketplaceOrderImportsTable)
      .set({ status: "failed", errorMessage: msg })
      .where(eq(marketplaceOrderImportsTable.id, importRowId));
    await db.insert(marketplaceSyncLogsTable).values({
      connectorId: connector.id,
      operation: "pull_orders",
      direction: "inbound",
      success: false,
      externalRef: order.externalOrderId,
      errorMessage: msg,
    });
    return { orderImportId: importRowId, soId: null, status: "failed" };
  }
}

/**
 * Retry a specific previously-failed (or stuck pending) order import.
 * Pulls the original payload from `marketplace_order_imports.raw_payload`
 * and re-runs the transactional `importOrder` against it.
 */
export async function retryOrderImport(
  importRowId: number,
): Promise<{ ok: boolean; status?: string; message?: string }> {
  const [row] = await db
    .select()
    .from(marketplaceOrderImportsTable)
    .where(eq(marketplaceOrderImportsTable.id, importRowId));
  if (!row) return { ok: false, message: "not_found" };
  if (row.status === "imported") return { ok: true, status: "imported" };
  const [connector] = await db
    .select()
    .from(marketplaceConnectorsTable)
    .where(eq(marketplaceConnectorsTable.id, row.connectorId));
  if (!connector) return { ok: false, message: "connector_not_found" };
  return retryOrderImportInternal(connector, importRowId);
}

async function retryOrderImportInternal(
  connector: MarketplaceConnector,
  importRowId: number,
): Promise<{ ok: boolean; status?: string; message?: string }> {
  const [row] = await db
    .select()
    .from(marketplaceOrderImportsTable)
    .where(eq(marketplaceOrderImportsTable.id, importRowId));
  if (!row || !row.rawPayload) return { ok: false, message: "missing_payload" };
  const raw = row.rawPayload as Record<string, unknown>;
  // We store either the bare NormalizedOrder or { order, ... } depending
  // on the lifecycle stage — accept both.
  const order = (raw["order"] as NormalizedOrder | undefined) ?? (raw as unknown as NormalizedOrder);
  const result = await importOrder(connector, order);
  return { ok: result.status === "imported", status: result.status };
}

/**
 * Pull-orders for a connector (manual sync trigger). Each new order
 * runs through `importOrder` to create the SO; duplicates are skipped.
 */
export async function syncOrdersForConnector(connector: MarketplaceConnector) {
  const adapter = getAdapter(connector.platform);
  const orders = await adapter.pullOrders(connector);
  const results: Array<{ orderImportId: number; soId: number | null; status: string }> = [];
  for (const o of orders) {
    results.push(await importOrder(connector, o));
  }
  await db
    .update(marketplaceConnectorsTable)
    .set({ lastSyncAt: new Date(), updatedAt: new Date() })
    .where(eq(marketplaceConnectorsTable.id, connector.id));
  return { count: results.length, imported: results.filter((r) => r.status === "imported").length, failed: results.filter((r) => r.status === "failed").length };
}

/**
 * Push the catalogue (or a subset) to a connector. Each product is
 * upserted via the adapter; the returned external id is persisted
 * to `marketplace_product_mappings` for future inventory pushes.
 */
export async function pushCatalogue(
  connector: MarketplaceConnector,
  productIds?: number[],
): Promise<{ pushed: number; failed: number }> {
  const adapter = getAdapter(connector.platform);
  const products = await db
    .select()
    .from(productsTable)
    .where(
      productIds && productIds.length > 0
        ? and(eq(productsTable.isActive, true), inArray(productsTable.id, productIds))
        : eq(productsTable.isActive, true),
    );
  let pushed = 0;
  let failed = 0;
  for (const p of products) {
    try {
      const onHand = await getOnHandForConnector(p.id, connector.defaultWarehouseId);
      // Look up the prior "primary" mapping by ERP product id BEFORE
      // calling the adapter so existing rows are updated in place
      // instead of POSTing a brand new remote product on every save.
      // We pick the oldest mapping for this (connector, productId);
      // additional variant rows live alongside it.
      const [prior] = await db
        .select()
        .from(marketplaceProductMappingsTable)
        .where(
          and(
            eq(marketplaceProductMappingsTable.connectorId, connector.id),
            eq(marketplaceProductMappingsTable.productId, p.id),
          ),
        )
        .orderBy(marketplaceProductMappingsTable.id)
        .limit(1);
      const res = await adapter.pushProduct(
        connector,
        p,
        onHand,
        prior
          ? { externalProductId: prior.externalProductId, externalVariantId: prior.externalVariantId }
          : null,
      );
      if (prior) {
        await db
          .update(marketplaceProductMappingsTable)
          .set({
            externalProductId: res.externalProductId,
            externalVariantId: res.externalVariantId ?? prior.externalVariantId,
            externalInventoryItemId:
              res.externalInventoryItemId ?? prior.externalInventoryItemId,
            lastPushedAt: new Date(),
          })
          .where(eq(marketplaceProductMappingsTable.id, prior.id));
      } else {
        await db.insert(marketplaceProductMappingsTable).values({
          connectorId: connector.id,
          productId: p.id,
          externalProductId: res.externalProductId,
          externalVariantId: res.externalVariantId ?? null,
          externalInventoryItemId: res.externalInventoryItemId ?? null,
          lastPushedAt: new Date(),
        });
      }
      pushed++;
    } catch (err) {
      failed++;
      await db.insert(marketplaceSyncLogsTable).values({
        connectorId: connector.id,
        operation: "push_product",
        direction: "outbound",
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }
  await db
    .update(marketplaceConnectorsTable)
    .set({ lastSyncAt: new Date(), updatedAt: new Date() })
    .where(eq(marketplaceConnectorsTable.id, connector.id));
  return { pushed, failed };
}

export async function retrySyncLog(logId: number): Promise<{ ok: boolean; message?: string }> {
  const [log] = await db.select().from(marketplaceSyncLogsTable).where(eq(marketplaceSyncLogsTable.id, logId));
  if (!log) return { ok: false, message: "not_found" };
  const [connector] = await db
    .select()
    .from(marketplaceConnectorsTable)
    .where(eq(marketplaceConnectorsTable.id, log.connectorId));
  if (!connector) return { ok: false, message: "connector_not_found" };
  try {
    if (log.operation === "pull_orders") {
      await syncOrdersForConnector(connector);
    } else if (log.operation === "push_product") {
      await pushCatalogue(connector);
    } else if (log.operation === "push_inventory") {
      // Re-run inventory push for every mapping on this connector.
      const mappings = await db
        .select()
        .from(marketplaceProductMappingsTable)
        .where(eq(marketplaceProductMappingsTable.connectorId, connector.id));
      for (const m of mappings) {
        await pushInventoryNow(
          m.connectorId,
          m.productId,
          m.externalProductId,
          m.externalVariantId,
          m.externalInventoryItemId,
        );
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// Re-export bare-minimum SQL helper so future test code can stub.
export { sql };
