import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import POS from "./pos";
import { posPreviewServer } from "@/lib/tax-preview-mock";

const state = vi.hoisted(() => ({
  mode: "required", granularity: "invoice", error: false, empty: false,
  refetch: vi.fn(), gateway: false, cached: false, branchId: 3 as number | undefined, queryEnabled: false,
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 11, companyId: 21 } }) }));
vi.mock("@/hooks/use-vat-status", () => ({ useVatEnabled: () => false }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useListProducts: () => ({ data: [{ id: 5, name: "قلم", price: 100 }, { id: 6, name: "دفتر", price: 50 }] }),
  useListProductCategories: () => ({ data: [] }),
  useListPosSessions: () => ({ data: [{ id: 9, status: "open", branchId: state.branchId, cashierName: "الكاشير المستقل" }], refetch: vi.fn() }),
  useGetZatcaStatus: () => ({ data: undefined }),
  useGetSellerWorkspace: (_: unknown, options: { query: { enabled: boolean } }) => { state.queryEnabled = options.query.enabled; return ({
    data: (!state.cached && state.error) || !options.query.enabled ? undefined : { policy: { mode: state.mode, granularity: state.granularity }, sellers: state.empty ? [] : [{ id: 7, name: "البائعة سارة" }, { id: 8, name: "البائع خالد" }] },
    isError: state.error, refetch: state.refetch,
  }); },
}));
let posts: Array<{ key: string | null; body: Record<string, unknown> }> = [];
let gatewayPosts = 0;
let lose = false;
beforeEach(() => {
  state.mode = "required"; state.granularity = "invoice"; state.error = false; state.empty = false; state.gateway = false;
  state.cached = false; state.branchId = 3; state.queryEnabled = false;
  posts = []; gatewayPosts = 0; lose = false; sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const preview = posPreviewServer(input, init, { prices: { 5: 100, 6: 50 }, token: "classic-sellers" });
    if (preview) return preview;
    const path = String(input).split("?")[0];
    if (path.endsWith("/pos/payment-gateways")) return Response.json(state.gateway ? [{ id: 2, provider: "test", displayName: "اختبار" }] : []);
    if (path.endsWith("/pos/payment/checkout")) { gatewayPosts++; return Response.json({}, { status: 400 }); }
    if (path.endsWith("/pos/orders") && init?.method === "POST") {
      posts.push({ key: new Headers(init.headers).get("Idempotency-Key"), body: JSON.parse(String(init.body)) });
      if (lose && posts.length === 1) throw new TypeError("synthetic lost response");
      return Response.json({ id: 1, orderNumber: "ORIGINAL-1", total: 100, items: [] }, { status: 201 });
    }
    return Response.json([]);
  }));
});
afterEach(() => vi.unstubAllGlobals());
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><POS /></QueryClientProvider>);
}
async function add(u: ReturnType<typeof userEvent.setup>, name = "قلم") {
  await u.click((await screen.findByRole("heading", { name })).closest("button")!);
}
async function review(u: ReturnType<typeof userEvent.setup>) { await u.click(await screen.findByTestId("button-tax-preview-confirm")); }
const pay = () => screen.getByRole("button", { name: /^دفع / });

describe("original classic POS seller assignment", () => {
  it.each(["hidden", "optional", "required"])("respects %s invoice policy without a cashier default", async (mode) => {
    state.mode = mode; mount(); const u = userEvent.setup(); await add(u); await review(u);
    if (mode === "hidden") expect(screen.queryByTestId("classic-seller-whole")).toBeNull();
    else {
      expect((screen.getByTestId("classic-seller-whole") as HTMLSelectElement).value).toBe("");
      if (mode === "required") {
        expect(pay().matches(":disabled")).toBe(true);
        expect(posts).toHaveLength(0);
        await u.selectOptions(screen.getByTestId("classic-seller-whole"), "7");
      }
    }
    await u.click(pay()); await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body.sellerEmployeeId).toBe(mode === "hidden" ? undefined : mode === "required" ? 7 : null);
  });
  it.each(["optional", "required"])("maps %s line overrides by product, not obsolete row indices", async (mode) => {
    state.mode = mode; state.granularity = "line"; mount(); const u = userEvent.setup();
    await add(u); await add(u, "دفتر");
    await u.selectOptions(screen.getByTestId("classic-seller-whole"), "7");
    await u.selectOptions(screen.getByTestId("classic-line-seller-6"), "8");
    // Delete the first product; the remaining override must shift to index zero.
    const first = screen.getByTestId("classic-line-seller-5").parentElement!;
    await u.click(within(first).getAllByRole("button")[0]);
    await waitFor(() => expect(screen.queryByTestId("classic-line-seller-5")).toBeNull());
    await u.click(within(screen.getByTestId("classic-line-seller-6").parentElement!).getAllByRole("button")[1]);
    await review(u); await u.click(pay()); await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body).toMatchObject({ items: [{ productId: 6, quantity: 2 }], sellerEmployeeId: 7, lineSellers: [{ lineIndex: 0, employeeId: 8 }] });
  });
  it("supports hidden line policy without sending stale assignment fields", async () => {
    state.mode = "hidden"; state.granularity = "line"; mount(); const u = userEvent.setup(); await add(u); await review(u);
    expect(screen.queryByTestId("classic-line-seller-5")).toBeNull();
    await u.click(pay()); await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].body.sellerEmployeeId).toBeUndefined(); expect(posts[0].body.lineSellers).toBeUndefined();
  });
  it("requires each line when no invoice default is chosen, and clears a removed line assignment", async () => {
    state.granularity = "line"; mount(); const u = userEvent.setup(); await add(u); await add(u, "دفتر");
    await u.selectOptions(screen.getByTestId("classic-line-seller-5"), "7");
    await review(u); expect(pay().matches(":disabled")).toBe(true);
    await u.selectOptions(screen.getByTestId("classic-line-seller-6"), "8");
    expect(pay().matches(":disabled")).toBe(false);
    const first = screen.getByTestId("classic-line-seller-5").parentElement!;
    await u.click(within(first).getAllByRole("button")[0]);
    await add(u);
    expect((screen.getByTestId("classic-line-seller-5") as HTMLSelectElement).value).toBe("");
    await review(u); expect(pay().matches(":disabled")).toBe(true);
  });
  it.each(["error", "empty", "malformed"])("blocks collection with %s eligibility/policy and provides Arabic status", async (kind) => {
    state.error = kind === "error"; state.empty = kind === "empty"; state.gateway = true;
    if (kind === "malformed") state.mode = "invalid";
    mount(); const u = userEvent.setup(); await add(u); await review(u);
    expect(pay().matches(":disabled")).toBe(true);
    expect(screen.getByText(kind === "empty" ? /لا يوجد بائع مؤهل/ : /تعذر تحميل سياسة/)).toBeTruthy();
    expect(posts).toHaveLength(0); expect(gatewayPosts).toBe(0);
    if (kind === "error") { await u.click(screen.getByTestId("classic-seller-retry")); expect(state.refetch).toHaveBeenCalled(); }
  });
  it("does not treat a failed refresh with cached policy as permission to collect", async () => {
    state.mode = "optional"; state.error = true; state.cached = true; mount();
    const u = userEvent.setup(); await add(u); await review(u);
    expect(pay().matches(":disabled")).toBe(true);
    expect(screen.getByTestId("classic-seller-retry")).toBeTruthy(); expect(posts).toHaveLength(0);
  });
  it("loads company policy for a legacy open shift without a branch", async () => {
    state.mode = "hidden"; state.branchId = undefined; mount();
    const u = userEvent.setup(); await add(u); await review(u);
    expect(state.queryEnabled).toBe(true);
    await u.click(pay()); await waitFor(() => expect(posts).toHaveLength(1));
  });
  it("retains the exact invoice/line sellers, key and tokens after response loss and remount despite policy failure", async () => {
    state.granularity = "line"; lose = true;
    const v = mount(); const u = userEvent.setup(); await add(u);
    await u.selectOptions(screen.getByTestId("classic-seller-whole"), "7");
    await u.selectOptions(screen.getByTestId("classic-line-seller-5"), "8");
    await review(u); await u.click(pay());
    await screen.findByTestId("classic-seller-frozen"); expect(posts).toHaveLength(1);
    v.unmount(); state.error = true; state.gateway = true; mount();
    await screen.findByTestId("classic-seller-frozen");
    await u.click(await screen.findByRole("button", { name: "استرجاع النتيجة" }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toEqual(posts[0]);
    expect(posts[1].body).toMatchObject({ sellerEmployeeId: 7, lineSellers: [{ lineIndex: 0, employeeId: 8 }] });
    expect(gatewayPosts).toBe(0);
  });
});
