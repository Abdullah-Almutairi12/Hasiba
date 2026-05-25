/**
 * Integration tests for the carrier-webhook ingest path
 * (`ingestCarrierWebhook`).
 *
 * These exercise the three security-critical invariants surfaced by
 * the architect review:
 *  - Carrier A's signed payload cannot mutate Carrier B's shipment
 *    even when the AWB is identical (carrier-scoped lookup).
 *  - Production carriers without a configured `webhookSecret` reject
 *    all inbound traffic (insecure-by-default closed).
 *  - The happy path (correct signature, matching carrier) advances
 *    the shipment status and records the event payload.
 *
 * The suite runs against the live DATABASE_URL (the dev/sandbox DB),
 * creates uniquely-named fixtures per run, and cleans them up in
 * `afterAll` so it is safe to re-run repeatedly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, shippingCarriersTable, shipmentsTable } from "@workspace/db";
import { ingestCarrierWebhook } from "./shipping";

const RUN_TAG = `vitest-${Date.now()}`;
const SECRET_A = "secret-aaaaaaaaaaaaaaaaaa";
const SECRET_B = "secret-bbbbbbbbbbbbbbbbbb";

let carrierAId = 0;
let carrierBId = 0;
let carrierProdNoSecretId = 0;
let shipmentAId = 0;

/** Compute the hex HMAC-SHA256 a real carrier would attach. */
function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

beforeAll(async () => {
  const [a] = await db
    .insert(shippingCarriersTable)
    .values({
      provider: `aramex-${RUN_TAG}-a`,
      displayName: `Test Carrier A ${RUN_TAG}`,
      environment: "sandbox",
      settings: { webhookSecret: SECRET_A },
    })
    .returning();
  const [b] = await db
    .insert(shippingCarriersTable)
    .values({
      provider: `smsa-${RUN_TAG}-b`,
      displayName: `Test Carrier B ${RUN_TAG}`,
      environment: "sandbox",
      settings: { webhookSecret: SECRET_B },
    })
    .returning();
  const [p] = await db
    .insert(shippingCarriersTable)
    .values({
      provider: `naqel-${RUN_TAG}-p`,
      displayName: `Test Carrier P (prod, no secret) ${RUN_TAG}`,
      environment: "production",
      settings: null,
    })
    .returning();
  carrierAId = a.id;
  carrierBId = b.id;
  carrierProdNoSecretId = p.id;

  // Single shipment, owned by Carrier A. The unique AWB index in
  // `shipments` means only one row can carry this AWB value — the
  // cross-carrier test asserts that even with the correct AWB,
  // carrier B's webhook cannot resolve it.
  const awb = `AWB-${RUN_TAG}`;
  const [s] = await db
    .insert(shipmentsTable)
    .values({
      carrierId: carrierAId,
      awbNumber: awb,
      status: "created",
      toAddress: { city: "Riyadh" },
    })
    .returning();
  shipmentAId = s.id;
});

afterAll(async () => {
  if (shipmentAId) {
    await db.delete(shipmentsTable).where(eq(shipmentsTable.id, shipmentAId));
  }
  const ids = [carrierAId, carrierBId, carrierProdNoSecretId].filter((n) => n > 0);
  if (ids.length > 0) {
    await db.delete(shippingCarriersTable).where(inArray(shippingCarriersTable.id, ids));
  }
});

describe("ingestCarrierWebhook — security boundary", () => {
  it("rejects production carrier when no webhook secret is configured", async () => {
    const body = JSON.stringify({ awb: "anything", events: [] });
    const out = await ingestCarrierWebhook({
      carrierId: carrierProdNoSecretId,
      rawBody: body,
      signature: undefined,
      parsed: JSON.parse(body),
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("signature_required");
  });

  it("rejects sandbox carrier with secret when signature is missing", async () => {
    const body = JSON.stringify({ awb: `AWB-${RUN_TAG}`, events: [] });
    const out = await ingestCarrierWebhook({
      carrierId: carrierAId,
      rawBody: body,
      signature: undefined,
      parsed: JSON.parse(body),
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("invalid_signature");
  });

  it("rejects sandbox carrier with secret when signature is wrong", async () => {
    const body = JSON.stringify({ awb: `AWB-${RUN_TAG}`, events: [] });
    const out = await ingestCarrierWebhook({
      carrierId: carrierAId,
      rawBody: body,
      signature: sign(body, "wrong-secret"),
      parsed: JSON.parse(body),
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("invalid_signature");
  });

  it("does NOT mutate carrier A's shipment when carrier B signs the same AWB", async () => {
    // Snapshot the current shipment state before the cross-carrier
    // attack, then assert it is unchanged afterwards.
    const [before] = await db
      .select()
      .from(shipmentsTable)
      .where(eq(shipmentsTable.id, shipmentAId));

    const body = JSON.stringify({
      awb: `AWB-${RUN_TAG}`,
      events: [
        { code: "delivered", description: "forged by carrier B", at: new Date().toISOString() },
      ],
    });
    const out = await ingestCarrierWebhook({
      carrierId: carrierBId,
      // Carrier B's own (valid) signature against its own secret —
      // the attack here is the carrier mismatch, not a signature
      // forgery, so we sign correctly for carrier B.
      rawBody: body,
      signature: sign(body, SECRET_B),
      parsed: JSON.parse(body),
    });

    expect(out.ok).toBe(false);
    expect(out.reason).toBe("shipment_not_found");

    const [after] = await db
      .select()
      .from(shipmentsTable)
      .where(eq(shipmentsTable.id, shipmentAId));
    expect(after.status).toBe(before.status);
    expect(after.trackingHistory).toEqual(before.trackingHistory);
  });
});

describe("ingestCarrierWebhook — happy path", () => {
  it("advances status and persists tracking events for correctly-signed carrier-matched payload", async () => {
    const body = JSON.stringify({
      awb: `AWB-${RUN_TAG}`,
      events: [
        { code: "picked_up", description: "Picked up at origin", at: new Date().toISOString() },
        { code: "in_transit", description: "On the way", at: new Date().toISOString() },
      ],
    });
    const out = await ingestCarrierWebhook({
      carrierId: carrierAId,
      rawBody: body,
      signature: sign(body, SECRET_A),
      parsed: JSON.parse(body),
    });

    expect(out.ok).toBe(true);
    expect(out.shipmentId).toBe(shipmentAId);
    expect(out.events).toBe(2);

    const [after] = await db
      .select()
      .from(shipmentsTable)
      .where(eq(shipmentsTable.id, shipmentAId));
    // deriveStatusFromEvents should have moved it off "created".
    expect(after.status).not.toBe("created");
    expect(Array.isArray(after.trackingHistory)).toBe(true);
  });
});
