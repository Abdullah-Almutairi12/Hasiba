/**
 * Regression test: public webhook routes are mounted BEFORE
 * `requireAuth` + `requireSameOrigin`, so they must continue to
 * accept POSTs from external services (no session, no Origin header
 * in our allowlist). If the mount order ever regresses, these
 * webhooks would start returning 401/403 and silently break revenue
 * paths (payments) and shipping status sync.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";

describe("public webhook routes bypass auth + CSRF (mount-order regression guard)", () => {
  it("POST /api/integrations/shipping/webhook/:carrierId is reachable with no session and a foreign Origin", async () => {
    const res = await request(app)
      .post("/api/integrations/shipping/webhook/999999")
      .set("Origin", "https://carrier.external.example.com")
      .set("Content-Type", "application/json")
      .send({ tracking_number: "X" });

    // The route runs and returns a domain-level error (404
    // carrier_not_found, 401 signature_required, or 400) — anything
    // EXCEPT 401 from requireAuth OR 403 from requireSameOrigin
    // proves the bypass is intact.
    expect(res.status).not.toBe(403);
    // 401 here would be the auth layer; the route itself only emits
    // 401 with body { error: "signature_required" | "invalid_signature" }.
    if (res.status === 401) {
      expect(["signature_required", "invalid_signature"]).toContain(
        (res.body as { error?: string }).error,
      );
    }
  });
});
