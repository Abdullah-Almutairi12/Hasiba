import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { financialFetch } from "../../../lib/api-client-react/src/financial-fetch.ts";

// JS here deliberately keeps browser-only DOM types out of the server's
// TypeScript project. The transport is typechecked by its own client project.
let stored;
const request = { method: "POST", body: JSON.stringify({ customerId: 123, notes: "PRIVATE-FINANCIAL-NOTE" }) };
const uncertainMessage = "تعذر تأكيد نتيجة العملية؛ قد تكون حُفظت بالفعل. أعد المحاولة بنفس البيانات لاسترجاع النتيجة دون إنشاء عملية مكررة.";
beforeEach(() => {
  stored = new Map();
  vi.stubGlobal("sessionStorage", {
    getItem: (k) => stored.get(k) ?? null,
    setItem: (k, v) => stored.set(k, v),
    removeItem: (k) => stored.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe.each([
  "/api/sales/invoices",
  "/api/sales/receipts",
  "/api/sales/credit-notes",
])("financial UI retry transport: %s", (url) => {
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
    await expect(financialFetch(url, request)).rejects.toThrow(uncertainMessage);
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
    await expect(financialFetch(url, request)).rejects.toThrow(uncertainMessage);
    await expect(financialFetch(url, request)).rejects.toThrow(uncertainMessage);
    await financialFetch(url, request);
    expect(new Set(keys).size).toBe(1);
    expect(stored.size).toBe(0);
  });
  it.each([500, 502, 503, 504, 599, 408, 429])("explains uncertain HTTP %s and replays the same intent until confirmed", async (status) => {
    const keys = [];
    const bodies = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      keys.push(new Headers(init.headers).get("Idempotency-Key"));
      bodies.push(init.body);
      // Both server JSON errors and non-JSON gateway errors must give safe guidance.
      if (keys.length === 1) return Response.json({ error: "HTTP failure" }, { status });
      if (keys.length === 2) return new Response("<h1>Gateway failure</h1>", { status });
      return Response.json({ id: 123 });
    }));
    await expect(financialFetch(url, request)).rejects.toThrow(uncertainMessage);
    expect(stored.size).toBe(1);
    await expect(financialFetch(url, request)).rejects.toThrow(uncertainMessage);
    expect(stored.size).toBe(1);
    expect(await (await financialFetch(url, request)).json()).toEqual({ id: 123 });
    expect(new Set(keys).size).toBe(1);
    expect(bodies).toEqual([request.body, request.body, request.body]);
    expect(stored.size).toBe(0);
    await financialFetch(url, request);
    expect(keys[3]).not.toBe(keys[0]);
  });
  it.each([400, 401, 403, 404, 409, 422])("preserves final HTTP %s validation responses and releases the key", async (status) => {
    const response = Response.json({ error: "رسالة التحقق الأصلية" }, { status });
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const result = await financialFetch(url, request);
    expect(result).toBe(response);
    expect(await result.json()).toEqual({ error: "رسالة التحقق الأصلية" });
    expect(stored.size).toBe(0);
  });
  it("leaves non-financial failures untouched", async () => {
    const response = new Response("bad gateway", { status: 502 });
    const fetch = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetch);
    expect(await financialFetch("/api/sales/quotations", request)).toBe(response);
    expect(await financialFetch(url)).toBe(response);
    expect(stored.size).toBe(0);
    expect(fetch.mock.calls[0][1]).toBe(request);
  });
  it("does not send a financial request when session storage is unavailable", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("sessionStorage", { getItem() { throw new Error("disabled"); } });
    await expect(financialFetch(url, request)).rejects.toThrow("لم يُرسل الطلب");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports a confirmed save when cleanup fails, then replays before releasing the intent", async () => {
    const attempts = [];
    const committed = new Map();
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const key = new Headers(init.headers).get("Idempotency-Key");
      const replayed = committed.has(key);
      if (!replayed) committed.set(key, { id: committed.size + 1 });
      attempts.push({ key, body: init.body, replayed });
      return Response.json(committed.get(key), { status: 201 });
    }));
    const originalRemove = sessionStorage.removeItem;
    sessionStorage.removeItem = vi.fn(() => { throw new DOMException("cleanup blocked", "SecurityError"); });
    try {
      await expect(financialFetch(url, request)).rejects.toThrow("تم حفظ العملية بالفعل، لكن تعذر تنظيف مفتاحها");
      expect(committed.size).toBe(1);
      expect(stored.size).toBe(1);
      expect([...stored.values()]).toEqual([attempts[0].key]);
      expect(sessionStorage.removeItem).toHaveBeenCalledWith([...stored.keys()][0]);
    } finally {
      sessionStorage.removeItem = originalRemove;
    }
    expect(await (await financialFetch(url, request)).json()).toEqual({ id: 1 });
    expect(attempts[1]).toEqual({ ...attempts[0], replayed: true });
    expect(committed.size).toBe(1);
    expect(stored.size).toBe(0);
    // A later intentionally identical document must not reuse the confirmed ID.
    expect(await (await financialFetch(url, request)).json()).toEqual({ id: 2 });
    expect(attempts[2].key).not.toBe(attempts[0].key);
    expect(stored.size).toBe(0);
  });
  it("does not describe a rejected operation as saved when its cleanup fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "invalid" }, { status: 422 })));
    const originalRemove = sessionStorage.removeItem;
    sessionStorage.removeItem = () => { throw new Error("cleanup blocked"); };
    try {
      await expect(financialFetch(url, request)).rejects.toThrow("رفض الخادم العملية");
      expect(stored.size).toBe(1);
    } finally {
      sessionStorage.removeItem = originalRemove;
    }
    expect((await financialFetch(url, request)).status).toBe(422);
    expect(stored.size).toBe(0);
  });
  it("does not send when writing the safety key is blocked, and recovers after storage is restored", async () => {
    const fetch = vi.fn(async () => Response.json({ id: 1 }));
    vi.stubGlobal("fetch", fetch);
    const setItem = vi.fn(() => { throw new DOMException("Storage blocked", "QuotaExceededError"); });
    vi.stubGlobal("sessionStorage", {
      getItem: (key) => stored.get(key) ?? null,
      setItem,
      removeItem: (key) => stored.delete(key),
    });
    await expect(financialFetch(url, request)).rejects.toThrow(
      "تعذر حفظ مفتاح العملية بأمان. لم يُرسل الطلب؛ فعّل تخزين الجلسة وأعد المحاولة.",
    );
    expect(setItem).toHaveBeenCalledOnce();
    expect(setItem.mock.calls[0][0]).toMatch(/^hasba:financial-request:[a-f0-9]{64}$/);
    expect(fetch).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
    setItem.mockImplementation((key, value) => stored.set(key, value));
    await financialFetch(url, request);
    expect(fetch).toHaveBeenCalledOnce();
    expect(stored.size).toBe(0);
  });
});
