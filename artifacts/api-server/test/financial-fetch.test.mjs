import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { financialFetch } from "../../../lib/api-client-react/src/financial-fetch.ts";

// JS here deliberately keeps browser-only DOM types out of the server's
// TypeScript project. The transport is typechecked by its own client project.
let stored;
const request = { method: "POST", body: JSON.stringify({ customerId: 123, notes: "PRIVATE-FINANCIAL-NOTE" }) };
const url = "/api/sales/invoices";
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (k) => stored.get(k) ?? null,
    setItem: (k, v) => stored.set(k, v),
    removeItem: (k) => stored.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("financial UI retry transport", () => {
  it("shares concurrent intent but permits confirmed separate submissions", async () => {
    const keys = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      keys.push(new Headers(init.headers).get("Idempotency-Key"));
      return Response.json({ id: 1 });
    }));
    await Promise.all([financialFetch(url, request), financialFetch(url, request)]);
    expect(keys[0]).toBe(keys[1]);
    await financialFetch(url, request);
    expect(keys[2]).not.toBe(keys[0]);
  });
  it("reuses the key after uncertain network failure without storing the body", async () => {
    const keys = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      keys.push(new Headers(init.headers).get("Idempotency-Key"));
      if (keys.length === 1) throw new TypeError("connection lost after possible commit");
      return Response.json({ id: 1 });
    }));
    await expect(financialFetch(url, request)).rejects.toThrow("دون إنشاء عملية مكررة");
    expect(JSON.stringify([...stored])).not.toContain("PRIVATE-FINANCIAL-NOTE");
    await financialFetch(url, request);
    expect(keys[0]).toBe(keys[1]); expect(stored.size).toBe(0);
  });
  it("retains the key after proxy 5xx and malformed successful responses", async () => {
    const keys = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      keys.push(new Headers(init.headers).get("Idempotency-Key"));
      if (keys.length === 1) return new Response("bad gateway", { status: 502 });
      if (keys.length === 2) return new Response("{", { status: 200 });
      return Response.json({ id: 1 });
    }));
    expect((await financialFetch(url, request)).status).toBe(502);
    await expect(financialFetch(url, request)).rejects.toThrow("تعذر تأكيد");
    await financialFetch(url, request);
    expect(new Set(keys).size).toBe(1);
  });
  it("does not send a financial request when session storage is unavailable", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("sessionStorage", { getItem() { throw new Error("disabled"); } });
    await expect(financialFetch(url, request)).rejects.toThrow("لم يُرسل الطلب");
    expect(fetch).not.toHaveBeenCalled();
  });
});
