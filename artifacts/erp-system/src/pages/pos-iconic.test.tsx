import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import PosIconic from "./pos-iconic";
import { usePosCheckout } from "@/hooks/use-pos-checkout";
import ar from "@/i18n/ar.json";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: 11, companyId: 21 } }),
}));
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
  useListProducts: () => ({ data: [{ id: 5, name: "منتج تجريبي", nameAr: "منتج تجريبي", price: 100, stock: 20 }] }),
  useListProductCategories: () => ({ data: [] }),
  useListPosSessions: () => ({ data: [{ id: 9, status: "open" }] }),
}));

const storageKey = "hasba:pos-checkout:11:21";
afterEach(() => vi.restoreAllMocks());
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><PosIconic variant="retail" /></QueryClientProvider>);
}
function saleTransport(fault?: "lost" | "502" | "malformed" | "incomplete" | "reject") {
  const attempts: Array<{ key: string; body: string }> = [];
  const committed = new Map<string, { id: number; orderNumber: string; total: number }>();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).split("?")[0].endsWith("/api/pos/orders") || init?.method !== "POST") {
      return Response.json([]);
    }
    const key = new Headers(init.headers).get("Idempotency-Key");
    expect(key).toBeTruthy();
    const body = String(init.body);
    attempts.push({ key: key!, body });
    if (attempts.length === 1 && fault === "reject") {
      return Response.json({ error: "الوردية مغلقة. افتح وردية جديدة قبل إتمام البيع." }, { status: 409 });
    }
    let row = committed.get(key!);
    if (!row) {
      row = { id: committed.size + 1, orderNumber: `ORD-TEST-${committed.size + 1}`, total: 100 };
      committed.set(key!, row);
    }
    if (attempts.length === 1) {
      if (fault === "lost") throw new TypeError("Connection dropped AFTER test commit");
      if (fault === "502") return new Response("Bad Gateway", { status: 502 });
      if (fault === "malformed") return new Response('{"id":', { status: 201, headers: { "Content-Type": "application/json" } });
      if (fault === "incomplete") return Response.json({ total: 100 }, { status: 201 });
    }
    return Response.json(row, { status: 201 });
  }));
  return { attempts, committed };
}

describe("POS inline tender and durable checkout recovery", () => {
  it("selects a tender inside the cart, without a fullscreen selector, and records a sale", async () => {
    const transport = saleTransport();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId("product-icon-5"));
    expect(screen.getByTestId("button-pay-cash").isConnected).toBe(true);
    expect(screen.queryByTestId("overlay-payment")).toBeNull();
    await user.click(screen.getByTestId("button-pay-cash"));
    await user.click(screen.getByTestId("button-pay-rail"));
    expect((await screen.findByText("ORD-TEST-1")).isConnected).toBe(true);
    expect(JSON.parse(transport.attempts[0].body)).toMatchObject({
      sessionId: 9, paymentMethod: "cash", items: [{ productId: 5, quantity: 1 }],
    });
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(screen.getByText(ar.pos_iconic.cart_empty).isConnected).toBe(true);
  });

  it.each(["lost", "502", "malformed", "incomplete"] as const)(
    "freezes and restores the same cart and key across a reload after %s",
    async (fault) => {
      const transport = saleTransport(fault);
      const user = userEvent.setup();
      const view = mount();
      await user.click(await screen.findByTestId("product-icon-5"));
      await user.click(screen.getByTestId("button-pay-cash"));
      await user.click(screen.getByTestId("button-pay-rail"));
      expect((await screen.findByRole("alert")).textContent).toContain("تعذر تأكيد نتيجة البيع");
      expect(screen.getByTestId("button-pay-card").matches(":disabled")).toBe(true);
      await user.click(screen.getByTestId("product-icon-5")); // must not change frozen cart
      view.unmount();
      mount();
      await waitFor(() => expect(screen.getByTestId("button-pay-rail").textContent).toContain("استرجاع نتيجة البيع"));
      await user.click(screen.getByTestId("button-pay-rail"));
      expect((await screen.findByText("ORD-TEST-1")).isConnected).toBe(true);
      expect(transport.attempts).toHaveLength(2);
      expect(transport.attempts[1]).toEqual(transport.attempts[0]);
      expect(transport.committed.size).toBe(1);
      // Intentional identical NEXT sale gets a fresh key after confirmation.
      await user.click(screen.getByTestId("product-icon-5"));
      await user.click(screen.getByTestId("button-pay-rail"));
      await waitFor(() => expect(transport.committed.size).toBe(2));
      expect(transport.attempts[2].key).not.toBe(transport.attempts[0].key);
    },
  );

  it("shows a confirmed rejection, keeps the cart and allows corrections", async () => {
    const transport = saleTransport("reject");
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId("product-icon-5"));
    await user.click(screen.getByTestId("button-pay-rail"));
    expect((await screen.findByRole("alert")).textContent).toContain("الوردية مغلقة");
    expect(screen.getByTestId("button-pay-cash").matches(":disabled")).toBe(false);
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(screen.queryByText(ar.pos_iconic.cart_empty)).toBeNull();
    await user.click(screen.getByTestId("button-pay-rail"));
    expect((await screen.findByText("ORD-TEST-1")).isConnected).toBe(true);
    expect(transport.committed.size).toBe(1);
  });

  it("keeps confirmed success recoverable if storage cleanup fails", async () => {
    const transport = saleTransport();
    const user = userEvent.setup();
    const original = Storage.prototype.removeItem;
    const cleanup = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
      if (key === storageKey) throw new DOMException("Synthetic cleanup fault", "SecurityError");
      return original.call(this, key);
    });
    mount();
    await user.click(await screen.findByTestId("product-icon-5"));
    await user.click(screen.getByTestId("button-pay-rail"));
    expect((await screen.findByRole("alert")).textContent).toContain("تم تسجيل البيع بالفعل");
    expect(screen.getByTestId("button-pay-cash").matches(":disabled")).toBe(true);
    cleanup.mockRestore();
    await user.click(screen.getByTestId("button-pay-rail"));
    expect((await screen.findByText("ORD-TEST-1")).isConnected).toBe(true);
    expect(transport.committed.size).toBe(1);
    expect(transport.attempts[1]).toEqual(transport.attempts[0]);
  });

  it("does not send a sale when the pending snapshot cannot be persisted", async () => {
    const transport = saleTransport();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId("product-icon-5"));
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Synthetic storage fault", "QuotaExceededError");
    });
    await user.click(screen.getByTestId("button-pay-rail"));
    expect((await screen.findByRole("alert")).textContent).toContain("لم يُرسل طلب جديد");
    expect(transport.attempts).toHaveLength(0);
    write.mockRestore();
  });

  it("separates saved attempts by user/company and refuses to erase corrupt state", async () => {
    const transport = saleTransport("lost");
    const cart = [{ product: { id: 5, name: "منتج", price: 100 }, quantity: 1 }];
    const body = { sessionId: 9, items: [{ productId: 5, quantity: 1 }], paymentMethod: "cash" as const };
    const hook = renderHook(({ scope }) => usePosCheckout(scope), { initialProps: { scope: "11:21" } });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await act(() => hook.result.current.pay(body, cart));
    hook.rerender({ scope: "11:22" });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.attempt).toBeNull();
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
    sessionStorage.setItem("hasba:pos-checkout:11:23", "invalid saved intent");
    hook.rerender({ scope: "11:23" });
    await waitFor(() => expect(hook.result.current.error).toContain("تعذر قراءة"));
    expect(hook.result.current.ready).toBe(false);
    await act(() => hook.result.current.pay(body, cart));
    expect(transport.attempts).toHaveLength(1);
    expect(sessionStorage.getItem("hasba:pos-checkout:11:23")).toBe("invalid saved intent");
  });
});
