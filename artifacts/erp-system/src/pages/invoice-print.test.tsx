import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import InvoicePrint from "./invoice-print";

afterEach(() => vi.unstubAllGlobals());
function mount(path: string) {
  const { hook } = memoryLocation({ path });
  return render(<Router hook={hook}><InvoicePrint /></Router>);
}

describe("supplier invoice print route", () => {
  it("previews only the saved supplier invoice PDF and never renders current identity", async () => {
    URL.createObjectURL = vi.fn(() => "blob:invoice");
    URL.revokeObjectURL = vi.fn();
    const f = vi.fn(async () => new Response("%PDF-1.4 test", { headers: { "content-type": "application/pdf" } }));
    vi.stubGlobal("fetch", f);
    mount("/invoices/42/print");
    expect((await screen.findByTestId("invoice-pdf-frame")).getAttribute("src")).toBe("blob:invoice");
    const urls = f.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\/api\/invoices\/42\/pdf$/);
    expect(urls[0]).not.toContain("/sales/");
    expect(urls.some((u) => /company|settings|zatca-qr|print\/profile/.test(u))).toBe(false);
    expect(screen.queryByText("حاسبة AI")).toBeNull();
  });

  it("shows server error with retry instead of a fallback identity", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "غير مصرح", diagnosticRef: "R-1" }, { status: 403 })));
    mount("/invoices/7/print");
    expect((await screen.findByTestId("invoice-pdf-error")).textContent).toContain("غير مصرح");
    expect(screen.queryByTestId("invoice-pdf-frame")).toBeNull();
  });
});
