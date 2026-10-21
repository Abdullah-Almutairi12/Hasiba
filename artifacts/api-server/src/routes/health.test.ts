import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";

describe("read-only operational diagnostics", () => {
  it("reports process liveness with a generated request ID", async () => {
    const response = await request(app).get("/api/healthz").expect(200);
    expect(response.body.status).toBe("ok");
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("checks database readiness without exposing database details", async () => {
    const response = await request(app).get("/api/readyz").expect(200);
    expect(response.body).toEqual({ status: "ready" });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("does not echo malformed bodies or internal exception messages", async () => {
    const response = await request(app).post("/api/auth/login")
      .set("Content-Type", "application/json").send('{"password":"PRIVATE_TEST_VALUE",').expect(400);
    expect(JSON.stringify(response.body)).not.toContain("PRIVATE_TEST_VALUE");
    expect(response.body.requestId).toBe(response.headers["x-request-id"]);
  });
});
