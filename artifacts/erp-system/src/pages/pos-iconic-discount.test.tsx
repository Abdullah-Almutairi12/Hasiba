import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PosIconic from "./pos-iconic";
import ar from "@/i18n/ar.json";
import { posPreviewServer } from "@/lib/tax-preview-mock";

const m = vi.hoisted(() => ({ reviewStatus: "pending" as string }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 11, companyId: 21, role: "cashier" } }) }));
vi.mock("@/hooks/use-vat-status", () => ({ useVatEnabled: () => false }));
vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({
    language: "ar",
    t: (key: string) => key.startsWith("pos_iconic.")
      ? ar.pos_iconic[key.slice("pos_iconic.".length) as keyof typeof ar.pos_iconic] ?? key : key,
  }),
}));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useListProducts: () => ({ data: [{ id: 5, name: "سلة", nameAr: "سلة", price: 100, stock: 20 }] }),
  useListProductCategories: () => ({ data: [] }),
  useListPosSessions: () => ({ data: [{ id: 9, status: "open", branchId: 1 }], refetch: vi.fn() }),
  useGetSellerWorkspace: () => ({ data: { policy: { mode: "hidden", granularity: "order" }, sellers: [] }, isError: false, refetch: vi.fn() }),
  useGetApprovalRequest: (id: number) => ({ data: id ? { id, status: m.reviewStatus } : undefined, isFetching: false, refetch: vi.fn() }),
}));
vi.mock("@/lib/sellers", async (original) => ({
  ...await original<typeof import("@/lib/sellers")>(),
  parseWorkspace: () => ({ policy: { mode: "hidden", granularity: "order" }, sellers: [] }),
  buildSellerFields: () => ({ ok: true, fields: {} }),
}));

type Sent = { key: string | null; body: Record<string, unknown> };
let sent: Sent[] = [];
let previews: Array<{ discount?: number }> = [];
const review = async (u: { click: (el: Element) => Promise<void> }) => u.click(await screen.findByTestId("button-tax-preview-confirm"));
let serverPrice = 100;
let replies: Array<() => Response | Promise<Response>> = [];
const storageKey = "hasba:pos-checkout:11:21";
beforeEach(() => {
  serverPrice = 100; sent = []; previews = []; replies = []; m.reviewStatus = "pending"; sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const preview = posPreviewServer(input, init, { prices: { 5: serverPrice }, token: "disc", log: previews });
    if (preview) return preview;
    if (String(input).split("?")[0].endsWith("/api/pos/orders") && init?.method === "POST") {
      sent.push({ key: new Headers(init.headers).get("Idempotency-Key"), body: JSON.parse(String(init.body)) });
      const r = replies.shift();
      if (r) return r();
    }
    return Response.json([]);
  }));
});
afterEach(() => vi.unstubAllGlobals());
const overLimit = (id: number | null) => () => Response.json({ error: "تجاوزت حد الخصم", requiresManagerApproval: true, approvalRequestId: id, attempted: 10, max: 0 }, { status: 403 });

async function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PosIconic variant="retail" /></QueryClientProvider>);
  const u = userEvent.setup();
  await u.click(await screen.findByText("سلة"));
  await u.click(screen.getByTestId("dock-more"));
  return u;
}
const pay = () => screen.getByTestId("button-pay-rail") as HTMLButtonElement;

describe("legacy cashier discount and over-limit review", () => {
  it("validates 0..100, shows 100 less 10% = 90, and a limit of 0 opens a server review (never auto-authorized)", async () => {
    const u = await setup();
    expect(screen.getByTestId("dock-more").getAttribute("aria-expanded")).toBe("true");
    await u.type(screen.getByTestId("input-discount-pct"), "150");
    expect(screen.getByTestId("text-discount-hint").textContent).toContain("بين 0 و100");
    await u.click(pay());
    expect(sent).toHaveLength(0);
    await u.clear(screen.getByTestId("input-discount-pct"));
    await u.type(screen.getByTestId("input-discount-pct"), "10");
    expect(screen.getByTestId("text-discount-net").textContent).toContain("90.00");
    await waitFor(() => expect(pay().textContent).toContain("90.00"));
    // The server was quoted with the same discount the sale will carry.
    expect(previews.at(-1)?.discount).toBe(10);
    replies.push(overLimit(41));
    await review(u);
    await u.click(pay());
    expect(await screen.findByTestId("text-review-id")).toBeTruthy();
    expect(sent[0].body.discount).toBe(10);
    expect(sent[0].body.approvalRequestId).toBeUndefined();
    expect(screen.getByTestId("text-review-id").textContent).toContain("#41");
    expect(screen.getByTestId("text-review-id").textContent).toContain("بانتظار الاعتماد");
    expect(screen.queryByTestId("button-review-resume")).toBeNull();
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });

  it("resumes an approved review; a known 403 after approver revocation keeps the basket and allows a fresh review", async () => {
    const u = await setup();
    await u.type(screen.getByTestId("input-discount-pct"), "10");
    replies.push(overLimit(41));
    await review(u);
    await u.click(pay());
    await screen.findByTestId("text-review-id");
    m.reviewStatus = "approved";
    await u.click(screen.getByTestId("button-review-refresh"));
    replies.push(() => Response.json({ error: "صلاحية المعتمِد لم تعد سارية" }, { status: 403 }));
    await u.click(await screen.findByTestId("button-review-resume"));
    expect(await screen.findByTestId("text-review-stale")).toBeTruthy();
    expect(sent[1].body.approvalRequestId).toBe(41);
    expect(sent[1].body.discount).toBe(10);
    expect(sent[1].key).not.toBe(sent[0].key);
    expect(screen.getByTestId("rail-pos-cart").textContent).toContain("سلة");
    expect(screen.getByTestId("text-discount-net").textContent).toContain("90.00");
    replies.push(overLimit(42));
    await u.click(screen.getByTestId("button-review-fresh"));
    await waitFor(() => expect(screen.getByTestId("text-review-id").textContent).toContain("#42"));
    expect(sent[2].body.approvalRequestId).toBeUndefined();
    expect(sent[2].body.discount).toBe(10);
    expect(screen.getByTestId("text-review-previous").textContent).toContain("#41");
  });

  it("a changed server price relabels the cart row and the % discount is computed on the server price basis", async () => {
    serverPrice = 120; // catalog repriced; cached product.price is still 100
    const u = await setup();
    await waitFor(() => expect(screen.getByTestId("cart-row-unit-5").textContent).toBe("120.00"));
    await u.type(screen.getByTestId("input-discount-pct"), "10");
    // 10% of the server basis (12.00), never 10% of the stale 100 labelled as 10%.
    await waitFor(() => expect(previews.at(-1)?.discount).toBe(12));
    await waitFor(() => expect(pay().textContent).toContain("108.00"));
    expect(screen.getByTestId("text-discount-net").textContent).toContain("108.00");
    expect(screen.getByTestId("tax-preview-discount").textContent).toContain("12.00");
    replies.push(() => { throw new TypeError("network down"); });
    await review(u);
    await u.click(pay());
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].body.discount).toBe(12);
    // Editing qty/discount is locked while the attempt is unresolved.
    expect((screen.getByTestId("input-discount-pct") as HTMLInputElement).disabled).toBe(true);
  });

  it("an unknown result is never overwritten: discount locks and recovery re-sends the identical key and body", async () => {
    const u = await setup();
    await u.type(screen.getByTestId("input-discount-pct"), "10");
    replies.push(() => { throw new TypeError("network down"); });
    await review(u);
    await u.click(pay());
    await waitFor(() => expect(sessionStorage.getItem(storageKey)).not.toBeNull());
    const saved = sessionStorage.getItem(storageKey);
    expect((screen.getByTestId("input-discount-pct") as HTMLInputElement).disabled).toBe(true);
    replies.push(overLimit(43));
    await u.click(pay());
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].key).toBe(sent[0].key);
    expect(sent[1].body).toEqual(sent[0].body);
    expect(sent[1].body.taxPreviewToken).toBe("pv-disc");
    // A 403 on recovery proves nothing: evidence kept, no review swapped in.
    expect(sessionStorage.getItem(storageKey)).toBe(saved);
    expect(screen.queryByTestId("text-review-id")).toBeNull();
  });
});
