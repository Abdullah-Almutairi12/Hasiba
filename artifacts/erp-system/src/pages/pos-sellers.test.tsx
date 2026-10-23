import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PosIconic from "./pos-iconic";
import ar from "@/i18n/ar.json";

const ws = vi.hoisted(() => ({ policy: { mode: "hidden", granularity: "invoice" } as Record<string, unknown>, error: false, refetch: vi.fn(), names: { 7: "سارة البائعة", 8: "خالد" } as Record<number, string> }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 11, companyId: 21 } }) }));
vi.mock("@/hooks/use-vat-status", () => ({ useVatEnabled: () => false }));
vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({ language: "ar", t: (k: string) => k.startsWith("pos_iconic.") ? (ar.pos_iconic as Record<string, string>)[k.slice(11)] ?? k : k }),
}));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useListProducts: () => ({ data: [{ id: 5, name: "قلم", price: 100, stock: 20 }, { id: 6, name: "دفتر", price: 50, stock: 20 }] }),
  useListProductCategories: () => ({ data: [] }),
  useListPosSessions: () => ({ data: [{ id: 9, status: "open", branchId: 3 }], refetch: vi.fn() }),
  useGetPrintProfile: () => ({ data: undefined }),
  useGetSellerWorkspace: () => ws.error ? { data: undefined, isError: true, refetch: ws.refetch }
    : { data: { policy: ws.policy, sellers: [{ id: 7, name: ws.names[7] }, { id: 8, name: ws.names[8] }], branches: [] }, isError: false, refetch: ws.refetch },
}));

let posts: Array<Record<string, unknown>> = [];
let fault = false;
let historic = false;
const SAVED: Record<number, string> = { 7: "سارة البائعة", 8: "خالد" };
beforeEach(() => { posts = []; fault = false; historic = false; ws.error = false; ws.names = { 7: "سارة البائعة", 8: "خالد" }; sessionStorage.clear(); });
afterEach(() => vi.unstubAllGlobals());
function stub() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).split("?")[0].endsWith("/api/pos/orders") && init?.method === "POST") {
      posts.push(JSON.parse(String(init.body)));
      if (fault && posts.length === 1) throw new TypeError("lost");
      const b = posts[posts.length - 1] as { sellerEmployeeId?: number | null; lineSellers?: Array<{ lineIndex: number; employeeId: number }> };
      const ids = [b.sellerEmployeeId, ...(b.lineSellers ?? []).map((l) => l.employeeId)].filter((x): x is number => typeof x === "number");
      const sellerAttribution = ids.map((id, i) => ({ invoiceLineId: 600 + i, employeeId: id, sellerName: SAVED[id], revision: 1 }));
      return Response.json({ id: 41, orderNumber: "ORD-41", total: 100, ...(historic ? {} : { sellerAttribution }) }, { status: 201 });
    }
    return Response.json([]);
  }));
}
const mount = () => render(<QueryClientProvider client={new QueryClient()}><PosIconic variant="retail" /></QueryClientProvider>);

describe("POS seller attribution", () => {
  it("hidden policy shows no seller controls and sends no seller fields", async () => {
    stub(); const u = userEvent.setup(); mount();
    await u.click(await screen.findByTestId("product-icon-5"));
    expect(screen.queryByTestId("select-pos-seller")).toBeNull();
    await u.click(screen.getByTestId("button-pay-rail"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).not.toHaveProperty("sellerEmployeeId");
  });

  it("optional policy allows unassigned sale", async () => {
    ws.policy = { mode: "optional", granularity: "invoice" };
    stub(); const u = userEvent.setup(); mount();
    await u.click(await screen.findByTestId("product-icon-5"));
    await u.click(screen.getByTestId("button-pay-rail"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].sellerEmployeeId).toBeNull();
  });

  it("required policy blocks missing seller, then sends the chosen seller independent of cashier", async () => {
    ws.policy = { mode: "required", granularity: "invoice" };
    stub(); const u = userEvent.setup(); mount();
    await u.click(await screen.findByTestId("product-icon-5"));
    await u.click(screen.getByTestId("button-pay-rail"));
    expect((await screen.findByTestId("pos-seller-error")).textContent).toContain("إلزامي");
    expect(posts).toHaveLength(0);
    await u.selectOptions(screen.getByTestId("select-pos-seller"), "7");
    await u.click(screen.getByTestId("button-pay-rail"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].sellerEmployeeId).toBe(7);
    expect((await screen.findByTestId("last-receipt-seller")).textContent).toContain("سارة البائعة");
  });

  it("line policy sends whole default plus per-line overrides by cart index", async () => {
    ws.policy = { mode: "required", granularity: "line" };
    stub(); const u = userEvent.setup(); mount();
    await u.click(await screen.findByTestId("product-icon-5"));
    await u.click(screen.getByTestId("product-icon-6"));
    await u.selectOptions(screen.getByTestId("select-pos-seller"), "7");
    await u.selectOptions(screen.getByTestId("select-pos-line-seller-6"), "8");
    await u.click(screen.getByTestId("button-pay-rail"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ sellerEmployeeId: 7, lineSellers: [{ lineIndex: 1, employeeId: 8 }] });
  });

  it("uncertain checkout freezes seller and replays the exact saved selection after reload", async () => {
    ws.policy = { mode: "required", granularity: "line" };
    stub(); fault = true; const u = userEvent.setup(); const view = mount();
    await u.click(await screen.findByTestId("product-icon-5"));
    await u.selectOptions(screen.getByTestId("select-pos-seller"), "7");
    await u.selectOptions(screen.getByTestId("select-pos-line-seller-5"), "8");
    await u.click(screen.getByTestId("button-pay-rail"));
    await screen.findByRole("alert");
    expect(screen.getByTestId("select-pos-seller").matches(":disabled")).toBe(true);
    view.unmount();
    ws.names = { 7: "سارة (اسم جديد)", 8: "خالد" }; // renamed today; receipt must keep saved label
    const again = mount();
    await waitFor(() => expect((screen.getByTestId("select-pos-seller") as HTMLSelectElement).value).toBe("7"));
    expect((screen.getByTestId("select-pos-line-seller-5") as HTMLSelectElement).value).toBe("8");
    expect(screen.getByTestId("select-pos-line-seller-5").matches(":disabled")).toBe(true);
    again.unmount();
    ws.error = true; // current policy fetch failing must not block recovery
    mount();
    await screen.findByTestId("pos-seller-frozen");
    await u.click(screen.getByTestId("button-pay-rail"));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toEqual(posts[0]);
    const label = (await screen.findByTestId("last-receipt-seller")).textContent ?? "";
    expect(label).toContain("سارة البائعة");
    expect(label).not.toContain("اسم جديد");
  });

  it("historic response without saved attribution labels seller unknown, never the cashier", async () => {
    ws.policy = { mode: "required", granularity: "invoice" };
    stub(); historic = true; const u = userEvent.setup(); mount();
    await u.click(await screen.findByTestId("product-icon-5"));
    await u.selectOptions(screen.getByTestId("select-pos-seller"), "7");
    await u.click(screen.getByTestId("button-pay-rail"));
    expect((await screen.findByTestId("last-receipt-seller")).textContent).toContain("غير معروف");
  });

  it("new sale waits for the seller policy and shows a retriable error when it fails", async () => {
    ws.error = true;
    stub(); const u = userEvent.setup(); mount();
    await u.click(await screen.findByTestId("product-icon-5"));
    expect(screen.getByTestId("pos-seller-status").textContent).toContain("تعذر تحميل سياسة البائعين");
    await u.click(screen.getByTestId("button-pay-rail"));
    expect(posts).toHaveLength(0);
    await u.click(screen.getByTestId("button-retry-seller-policy"));
    expect(ws.refetch).toHaveBeenCalled();
  });
});
