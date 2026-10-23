import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SellerReportCard } from "./seller-commissions";
import { buildSellerFields, parsePolicy, parseWorkspace } from "@/lib/sellers";

const m = vi.hoisted(() => ({ report: {} as unknown, correct: vi.fn(), change: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useGetSellerReport: () => ({ data: m.report, isLoading: false, isError: false, refetch: vi.fn() }),
  useCorrectInvoiceAttribution: () => ({ mutateAsync: m.correct, isPending: false }),
  useChangeCommissionState: () => ({ mutateAsync: m.change, isPending: false }),
}));
afterEach(() => { vi.unstubAllGlobals(); m.correct.mockReset(); m.change.mockReset(); });

const REPORT = {
  from: "2025-01-01", to: "2025-01-31", basis: "net_pre_tax", uniqueInvoiceCount: 3,
  rows: [
    { sellerId: 7, sellerName: "سارة", currency: "SAR", grossSales: 300, discounts: 10, returns: 0, cancellations: 0, net: 290, invoiceCount: 2 },
    { sellerId: 8, sellerName: "خالد", currency: "SAR", grossSales: 100, discounts: 0, returns: 0, cancellations: 0, net: 100, invoiceCount: 2 },
    { sellerId: 8, sellerName: "خالد", currency: "USD", grossSales: 50, discounts: 0, returns: 0, cancellations: 0, net: 50, invoiceCount: 1 },
    { sellerId: null, sellerName: "", currency: "SAR", grossSales: 20, discounts: 0, returns: 0, cancellations: 0, net: 20, invoiceCount: 1 },
  ],
  commissions: [
    { id: 1, invoice_id: 101, employee_id: 7, seller_name: "سارة", currency_code: "SAR", effective_date: "2025-01-05", amount: 5, net: 100, status: "calculated" },
    { id: 2, invoice_id: 102, employee_id: 7, seller_name: "سارة", currency_code: "SAR", effective_date: "2025-01-06", amount: 7, net: 140, status: "approved" },
    { id: 3, invoice_id: 103, employee_id: 8, seller_name: "خالد", currency_code: "SAR", effective_date: "2025-01-07", amount: 2, net: 40, status: "paid", external_reference: "TRX-991" },
  ],
  sources: [{ invoiceId: 101, invoiceLineId: null, reference: "INV-101", kind: "invoice", date: "2025-01-05", currency: "SAR", net: 100 }],
  warnings: ["فاتورة قديمة بدون بائع محفوظ"],
};
const wsWith = (perms: string[], granularity = "invoice") => parseWorkspace({
  policy: { mode: "optional", granularity }, sellers: [{ id: 7, name: "سارة" }, { id: 8, name: "خالد" }], branches: [], permissions: perms,
});
const mount = (perms: string[], g?: string) => render(<QueryClientProvider client={new QueryClient()}><SellerReportCard ws={wsWith(perms, g)} /></QueryClientProvider>);

describe("seller report", () => {
  it("uses uniqueInvoiceCount, keeps currencies separate and labels unassigned truthfully", () => {
    m.report = REPORT; mount([]);
    expect(screen.getByTestId("report-unique-invoices").textContent).toContain("3");
    expect(screen.getByTestId("report-total-SAR").textContent).toContain("٤١٠٫٠٠");
    expect(screen.getByTestId("report-total-USD").textContent).toContain("٥٠٫٠٠");
    expect(screen.getByText("غير مسند (لا يوجد بائع محفوظ)")).toBeTruthy();
    expect(screen.getByTestId("report-warnings").textContent).toContain("فاتورة قديمة");
    expect(screen.queryByTestId("button-approve-commission-1")).toBeNull();
    expect(screen.queryByTestId("button-correct-101-0")).toBeNull();
  });
  it("shows empty state", () => {
    m.report = { ...REPORT, rows: [], commissions: [], sources: [], warnings: [] }; mount([]);
    expect(screen.getByTestId("report-empty")).toBeTruthy();
    expect(screen.getByTestId("commissions-empty")).toBeTruthy();
  });
  it("separates calculated/approved/paid and gates actions by permission", async () => {
    m.report = REPORT; mount(["commission_approve", "commission_paid"]);
    const totals = screen.getByTestId("commission-totals").textContent ?? "";
    expect(totals).toContain("محسوبة"); expect(totals).toContain("معتمدة"); expect(totals).toContain("موثقة كمدفوعة");
    expect(screen.getByTestId("button-approve-commission-1")).toBeTruthy();
    expect(screen.queryByTestId("button-approve-commission-2")).toBeNull();
    const u = userEvent.setup();
    await u.click(screen.getByTestId("button-paid-commission-2"));
    expect(screen.getByTestId("paid-disclaimer").textContent).toContain("لا يتم تنفيذ أي دفع");
    await u.click(screen.getByTestId("button-confirm-commission"));
    expect(m.change).not.toHaveBeenCalled();
    await u.type(screen.getByTestId("input-commission-reference"), "TRX-55521");
    await u.click(screen.getByTestId("button-confirm-commission"));
    expect(m.change).toHaveBeenCalledWith({ id: 2, data: { action: "record_paid", reference: "TRX-55521" } });
  });
  it("corrects using the ORIGINAL per-line policy (current is invoice-level), shows mixed sellers, preloads lines", async () => {
    m.report = REPORT; m.correct.mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      id: 101, reference: "INV-2025-101", invoiceNumber: "X", hasSellerSnapshot: true, sellerEmployeeId: null, sellerName: "سارة، خالد",
      attributionPolicy: { version: 3, mode: "required", granularity: "line" },
      lines: [{ id: 501, description: "قلم", sellerEmployeeId: 7, sellerName: "سارة", sellerRevision: 1 }, { id: 502, description: "دفتر", sellerEmployeeId: 8, sellerName: "خالد", sellerRevision: 1 }],
    })));
    mount(["seller_edit"], "invoice");
    const u = userEvent.setup();
    await u.click(screen.getByTestId("button-correct-101-0"));
    const form = await screen.findByTestId("correction-form");
    expect(screen.getByRole("heading").textContent).toContain("INV-2025-101");
    expect(within(form).getByTestId("correction-current").textContent).toContain("بائعون متعددون");
    expect(within(form).getByTestId("correction-policy").textContent).toContain("على مستوى البند");
    expect((screen.getByTestId("select-correct-line-501") as HTMLSelectElement).value).toBe("7");
    await u.selectOptions(screen.getByTestId("select-correct-line-502"), "7");
    await u.click(screen.getByTestId("button-submit-correction"));
    expect(m.correct).not.toHaveBeenCalled();
    await u.type(screen.getByTestId("textarea-correct-reason"), "خطأ في اختيار البائع");
    await u.click(screen.getByTestId("button-submit-correction"));
    await waitFor(() => expect(m.correct).toHaveBeenCalledWith({ id: 101, data: {
      reason: "خطأ في اختيار البائع", sellerEmployeeId: null,
      lineSellers: [{ invoiceLineId: 501, employeeId: 7 }, { invoiceLineId: 502, employeeId: 7 }],
    } }));
  });
  it("uses original invoice-level policy even when current policy is per-line", async () => {
    m.report = REPORT;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      id: 101, reference: "INV-101", hasSellerSnapshot: true, sellerEmployeeId: 8, sellerName: "خالد",
      attributionPolicy: { version: 1, mode: "optional", granularity: "invoice" }, lines: [{ id: 501, description: "قلم", sellerEmployeeId: 8 }],
    })));
    mount(["seller_edit"], "line");
    await userEvent.setup().click(screen.getByTestId("button-correct-101-0"));
    await screen.findByTestId("correction-form");
    expect(screen.queryByTestId("select-correct-line-501")).toBeNull();
    expect((screen.getByTestId("select-correct-whole") as HTMLSelectElement).value).toBe("8");
  });
  it("disables correction for old invoices without a saved snapshot", async () => {
    m.report = REPORT;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: 101, reference: "INV-101", hasSellerSnapshot: false, sellerEmployeeId: null, attributionPolicy: null, lines: [{ id: 501 }] })));
    mount(["seller_edit"], "line");
    await userEvent.setup().click(screen.getByTestId("button-correct-101-0"));
    const form = await screen.findByTestId("correction-form");
    expect(within(form).getByTestId("correction-current").textContent).toContain("لا توجد لقطة بائع محفوظة");
    expect(screen.queryByTestId("select-correct-whole")).toBeNull();
    expect(screen.getByTestId("button-submit-correction").matches(":disabled")).toBe(true);
  });
});

describe("seller body rules", () => {
  it("defaults to hidden, commissions off, no assumed rate", () => {
    const p = parsePolicy(undefined);
    expect(p).toMatchObject({ mode: "hidden", commissionEnabled: false, ratePercent: null });
    expect(buildSellerFields(p, { whole: 7, lines: {} }, 1)).toEqual({ ok: true, fields: {} });
  });
  it("required invoice/line validation", () => {
    const req = parsePolicy({ mode: "required", granularity: "line" });
    expect(buildSellerFields(req, { whole: null, lines: { 0: 7 } }, 2).ok).toBe(false);
    expect(buildSellerFields(req, { whole: null, lines: { 0: 7, 1: 8 } }, 2)).toEqual({ ok: true, fields: { sellerEmployeeId: null, lineSellers: [{ lineIndex: 0, employeeId: 7 }, { lineIndex: 1, employeeId: 8 }] } });
    expect(buildSellerFields(parsePolicy({ mode: "optional" }), { whole: null, lines: {} }, 1)).toEqual({ ok: true, fields: { sellerEmployeeId: null } });
  });
});
