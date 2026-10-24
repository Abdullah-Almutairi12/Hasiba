import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PosIconic from "./pos-iconic";
import { __resetWorkspaceResponsibility, selectResponsibility, getSelectedResponsibility } from "@/lib/workspace-responsibility";
import ar from "@/i18n/ar.json";

const access = vi.hoisted(() => ({
  data: undefined as undefined | { managed: boolean; status: string; grants: unknown[]; deniedActions: string[]; vatRegistered?: boolean },
  isError: false,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 31, companyId: 21, role: "scoped", name: "سلمان" } }) }));
vi.mock("@/hooks/use-vat-status", () => ({ useVatEnabled: () => true }));
vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({
    language: "ar",
    t: (key: string) => key.startsWith("pos_iconic.")
      ? ar.pos_iconic[key.slice("pos_iconic.".length) as keyof typeof ar.pos_iconic] ?? key : key,
  }),
}));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useGetWorkspaceAccess: () => ({ data: access.data, isLoading: false, isError: access.isError, refetch: vi.fn() }),
  useListProducts: () => ({ data: [{ id: 5, name: "تمر", nameAr: "تمر", price: 20, stock: 9 }] }),
  useListProductCategories: () => ({ data: [] }),
  useListPosSessions: () => ({ data: [{ id: 8, status: "open", branchId: 99 }, { id: 9, status: "open", branchId: 3 }], refetch: vi.fn() }),
}));

const grant = (actions: string[]) => ({ id: 77, resource: "pos", branchId: 3, warehouseIds: [], actions, amountLimit: null, startsAt: null, endsAt: null });
let urls: string[] = [];
beforeEach(() => {
  urls = [];
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => { urls.push(String(input)); return Response.json([]); }));
});
afterEach(() => { vi.unstubAllGlobals(); __resetWorkspaceResponsibility(); });

function mount(actions: string[], vat: boolean | undefined, select = true) {
  access.data = { managed: true, status: "active", grants: [grant(actions)], deniedActions: [], ...(vat === undefined ? {} : { vatRegistered: vat }) };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (select) act(() => selectResponsibility(client, { id: 77, resource: "pos", branchId: 3, actions: [], vatRegistered: null }));
  render(<QueryClientProvider client={client}><PosIconic variant="retail" /></QueryClientProvider>);
}
const pay = () => screen.getByTestId("button-pay-rail") as HTMLButtonElement;

describe("PosIconic for scoped members", () => {
  it("sell without pos.read is not a seller: pay disabled", async () => {
    mount(["pos.sell"], true);
    await userEvent.click(await screen.findByText("تمر"));
    expect(pay().disabled).toBe(true);
    expect(screen.getByTestId("text-pay-blocked").textContent).toContain("للعرض فقط");
  });

  it("view + shift open without sell: may open a shift, cannot pay", async () => {
    access.data = undefined;
    mount(["pos.read", "pos.shift.open"], true);
    expect(await screen.findByTestId("text-scoped-pos-ready")).toBeTruthy();
    await userEvent.click(screen.getByText("تمر"));
    expect(pay().disabled).toBe(true);
  });

  it("seller: cash-only, live actions retained, VAT 15% when registered, no blocked endpoints", async () => {
    mount(["pos.read", "pos.sell"], true);
    expect(await screen.findByTestId("text-scoped-pos-ready")).toBeTruthy();
    expect(getSelectedResponsibility()?.actions).toEqual(["pos.read", "pos.sell"]);
    expect(screen.queryByTestId("button-pay-card")).toBeNull();
    expect(screen.queryByTestId("button-pos-returns")).toBeNull();
    expect(screen.getByTestId("dock-parking-unavailable")).toBeTruthy();
    // Scoped profiles stay basic cash-only: no discount/override/review UI.
    expect((screen.getByTestId("dock-more") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("panel-discount")).toBeNull();
    expect(screen.queryByTestId("input-discount-pct")).toBeNull();
    await userEvent.click(screen.getByText("تمر"));
    expect(pay().disabled).toBe(false);
    expect(pay().textContent).toContain("23.00");
    await new Promise((r) => setTimeout(r, 20));
    expect(urls.some((u) => /parked|payment|gateway|vat|zatca|inventory\/lookup/.test(u))).toBe(false);
  });

  it("unregistered company: tax is exactly 0, never a guessed 15%", async () => {
    mount(["pos.read", "pos.sell"], false);
    await userEvent.click(await screen.findByText("تمر"));
    expect(pay().textContent).toContain("20.00");
    expect(pay().textContent).not.toContain("23.00");
  });

  it("unknown VAT blocks checkout and hides the total", async () => {
    mount(["pos.read", "pos.sell"], undefined);
    await userEvent.click(await screen.findByText("تمر"));
    expect(screen.getByTestId("text-scoped-vat-unknown")).toBeTruthy();
    expect(pay().disabled).toBe(true);
    expect(pay().textContent).not.toContain("20.00");
  });

  it("read-only responsibility: pay disabled with a reason, shift open withheld", async () => {
    mount(["pos.read"], true);
    await userEvent.click(await screen.findByText("تمر"));
    expect(pay().disabled).toBe(true);
    expect(screen.getByTestId("text-pay-blocked").textContent).toContain("للعرض فقط");
    expect((screen.getByTestId("dock-pay") as HTMLButtonElement).disabled).toBe(true);
  });

  it("unknown attempt from another responsibility is never re-sent under this one", async () => {
    const saved = { key: "attempt-jeddah-0001", responsibility: "55",
      body: { sessionId: 4, paymentMethod: "cash", items: [{ productId: 5, quantity: 1 }] },
      cart: [{ product: { id: 5, name: "تمر", price: 20 }, quantity: 1 }] };
    sessionStorage.setItem("hasba:pos-checkout:31:21", JSON.stringify(saved));
    mount(["pos.read", "pos.sell"], true);
    expect((await screen.findByTestId("text-pay-blocked")).textContent).toContain("مسؤولية أخرى");
    expect(pay().disabled).toBe(true);
    expect(urls.some((u) => u.split("?")[0].endsWith("/api/pos/orders"))).toBe(false);
    expect(sessionStorage.getItem("hasba:pos-checkout:31:21")).toBe(JSON.stringify(saved));
  });
  it("record + discount actions: manual tenders incl. deferred and discount panel, no review UI", async () => {
    mount(["pos.read", "pos.sell", "pos.payment.record", "pos.discount"], true);
    expect(await screen.findByTestId("text-scoped-pos-ready")).toBeTruthy();
    expect(screen.getByTestId("button-pay-card")).toBeTruthy();
    expect(screen.getByTestId("button-pay-deferred")).toBeTruthy();
    expect((screen.getByTestId("dock-more") as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(screen.getByTestId("dock-more"));
    expect(screen.getByTestId("text-discount-hint").textContent).toContain("مستخدم بصلاحيات محددة");
    expect(screen.queryByTestId("panel-review")).toBeNull();
  });
  it("unrelated open shift in the branch never clears an unknown opening intent", async () => {
    const saved = JSON.stringify({ key: "open-intent-key-1", body: { branchId: 3, cashierName: "سلمان", openingCash: 40 }, responsibility: "77" });
    sessionStorage.setItem("hasba:pos-session-open:31:21", saved);
    mount(["pos.read", "pos.sell", "pos.shift.open"], true);
    expect(await screen.findByTestId("panel-scoped-open-recovery")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(sessionStorage.getItem("hasba:pos-session-open:31:21")).toBe(saved);
    expect(screen.queryByTestId("text-scoped-pos-ready")).toBeNull();
    sessionStorage.clear();
  });
});
