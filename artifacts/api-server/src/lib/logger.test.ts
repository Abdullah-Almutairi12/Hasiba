import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import pino from "pino";
import { safeLoggerOptions } from "./logger";

describe("safe structured diagnostics", () => {
  it("redacts credentials, bodies, financial fields and DB error payloads", () => {
    let captured = "";
    const destination = new Writable({
      write(chunk, _encoding, done) { captured += chunk.toString(); done(); },
    });
    const log = pino({ ...safeLoggerOptions, transport: undefined, level: "info" }, destination);
    const err = Object.assign(new Error("SENSITIVE_DB_PAYLOAD"), {
      code: "23503", detail: "SENSITIVE_DB_DETAIL", query: "SENSITIVE_SQL",
    });
    log.error({
      event: "request.failed", requestId: "synthetic-request",
      password: "SENSITIVE_PASSWORD", token: "SENSITIVE_TOKEN",
      body: { amount: "SENSITIVE_BODY" }, total: "SENSITIVE_TOTAL",
      recipient: "SENSITIVE_EMAIL", reason: "SENSITIVE_REASON", err,
    }, "Request failed");
    expect(captured).not.toContain("SENSITIVE_");
    const result = JSON.parse(captured);
    expect(result.event).toBe("request.failed");
    expect(result.requestId).toBe("synthetic-request");
    expect(result.err.code).toBe("23503");
    expect(result.err.stack).toContain("logger.test.ts");
  });
});
