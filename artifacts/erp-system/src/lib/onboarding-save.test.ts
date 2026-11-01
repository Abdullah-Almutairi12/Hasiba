import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ONBOARDING_NETWORK_ERROR,
  ONBOARDING_SAVE_ERROR,
  saveOnboardingBusinessType,
} from "./onboarding-save";

describe("saveOnboardingBusinessType", () => {
  it("PATCHes only businessType with credentials and reports success", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    const r = await saveOnboardingBusinessType("/", "fb", f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/companies/me");
    expect(init.method).toBe("PATCH");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toEqual({ businessType: "fb" });
  });

  it("returns an Arabic error on non-OK response", async () => {
    const f = vi.fn(async () => Response.json({ error: "forbidden" }, { status: 403 }));
    const r = await saveOnboardingBusinessType("/", "retail", f as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, message: ONBOARDING_SAVE_ERROR });
  });

  it("surfaces an Arabic server message when provided", async () => {
    const f = vi.fn(async () => Response.json({ error: "نوع النشاط غير صالح" }, { status: 400 }));
    const r = await saveOnboardingBusinessType("/", "x", f as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, message: "نوع النشاط غير صالح" });
  });

  it("returns a network error when fetch rejects", async () => {
    const f = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    const r = await saveOnboardingBusinessType("/", "retail", f as unknown as typeof fetch);
    expect(r).toEqual({ ok: false, message: ONBOARDING_NETWORK_ERROR });
    expect(ONBOARDING_NETWORK_ERROR).toContain("قد يكون");
    expect(ONBOARDING_NETWORK_ERROR).not.toContain("لم يُحفظ");
  });
});

describe("onboarding wizard truthful content", () => {
  const src = readFileSync(resolve(__dirname, "../pages/onboarding-wizard.tsx"), "utf8");
  it("no longer offers unsupported currency/branch/invoice controls or launch claims", () => {
    expect(src).not.toMatch(/CURRENCIES|setBranches|setCurrency|setInvoiceType/);
    expect(src).not.toContain("جاهز للإطلاق");
    expect(src).not.toContain("سنُنشئ");
    expect(src).not.toContain("Promise.allSettled");
  });
  it("uses the awaited save helper and links to real settings screens", () => {
    expect(src).toContain("saveOnboardingBusinessType");
    for (const p of ["/branches", "/team-setup", "/settings", "/products"]) expect(src).toContain(`"${p}"`);
  });
  it("does not advertise a ready general catalog/customer/supplier file importer", () => {
    const welcome = readFileSync(resolve(__dirname, "../pages/welcome.tsx"), "utf8");
    expect(welcome).not.toContain("ندعم استيراد المنتجات والعملاء والموردين عبر Excel/CSV");
    expect(welcome).toContain("الاستيراد العام عبر Excel/CSV/JSON لم يكتمل");
  });
});
