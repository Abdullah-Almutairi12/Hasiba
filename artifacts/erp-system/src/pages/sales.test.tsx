import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SalesPage from "./sales";
import { Toaster } from "@/components/ui/toaster";

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({ canManageFinance: true, canReadReports: false,isScoped:false,canCustomerInvoice:()=>true }),
}));
vi.mock("@/hooks/use-vat-status", () => ({
  useVatEnabled: () => true,
}));

const uncertainMessage =
  "تعذر تأكيد نتيجة العملية؛ قد تكون حُفظت بالفعل. أعد المحاولة بنفس البيانات لاسترجاع النتيجة دون إنشاء عملية مكررة.";

describe("customer invoice form retry", () => {
  it.each(["502", "network TypeError", "HTTP 200 with malformed JSON"] as const)("shows complete %s guidance, retains the open form, and succeeds with the same body and key", async (failure) => {
    // Exercise the real page, dialog, toast, apiPost and financialFetch.
    // Only transport and unrelated permissions/VAT context are replaced.
    const attempts: Array<{ body: string; key: string | null }> = [];
    let invoiceReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/sales/invoices" && init?.method === "POST") {
        attempts.push({
          body: String(init.body),
          key: new Headers(init.headers).get("Idempotency-Key"),
        });
        if (attempts.length === 1) {
          // Throw inside the async fetch stub to reject the request without
          // returning any HTTP response, as a browser connection failure does.
          if (failure === "network TypeError") throw new TypeError("Failed to fetch");
          if (failure === "HTTP 200 with malformed JSON") {
            // Use a real Response so the real transport must parse the broken
            // success body before apiPost can confirm the save to the page.
            return new Response('{"id":91,"reference":', {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response("<h1>Bad Gateway</h1>", { status: 502 });
        }
        return Response.json({ id: 91, reference: "INV-RETRY-91" });
      }
      if (path === "/api/sales/invoices") {
        invoiceReads++;
        return Response.json([]);
      }
      if (path === "/api/sales/invoices/email-failure-count") {
        return Response.json({ exhaustedCount: 0, maxAttempts: 3 });
      }
      if (path === "/api/sales/quotations") return Response.json([]);
      if (path === "/api/sales/sellers/workspace") return Response.json({ policy: { mode: "hidden", granularity: "invoice" }, sellers: [], branches: [] });
      if (path === "/api/customers") return Response.json([{ id: 7, name: "عميل الاختبار" }]);
      if (path === "/api/products") {
        return Response.json([{ id: 12, nameAr: "منتج الاختبار", price: 20 }]);
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${path}`);
    }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const user = userEvent.setup();
    const view = render(
      <QueryClientProvider client={client}>
        <SalesPage />
        <Toaster />
      </QueryClientProvider>,
    );

    try {
      await user.click(screen.getByRole("tab", { name: "فواتير العملاء" }));
      await waitFor(() => expect(invoiceReads).toBe(1));
      await user.click(screen.getByRole("button", { name: "فاتورة جديدة" }));
      const dialog = screen.getByRole("dialog", { name: "فاتورة عميل جديدة" });
      const form = within(dialog);
      await user.click(form.getAllByRole("combobox")[0]);
      await user.click(await screen.findByRole("option", { name: "عميل الاختبار" }));
      await user.click(form.getAllByRole("combobox")[1]);
      await user.click(await screen.findByRole("option", { name: "منتج الاختبار" }));
      await user.clear(form.getByPlaceholderText("الكمية"));
      await user.type(form.getByPlaceholderText("الكمية"), "3");
      await user.clear(form.getByPlaceholderText("السعر"));
      await user.type(form.getByPlaceholderText("السعر"), "42.75");
      await user.clear(form.getByPlaceholderText("خصم %"));
      await user.type(form.getByPlaceholderText("خصم %"), "5");
      await user.type(form.getByRole("textbox"), "ملاحظات الفاتورة لا تضيع");
      const readsBeforeSave = invoiceReads;
      const save = form.getByRole("button", { name: "حفظ" });

      await user.click(save);

      // Assert the entire user-visible message, not a raw transport error or
      // only the title. A failed save must not close/reset/refetch the form.
      expect(await screen.findByText(uncertainMessage, { exact: true })).toBeTruthy();
      expect(screen.getByRole("dialog", { name: "فاتورة عميل جديدة" })).toBe(dialog);
      expect(form.getAllByRole("combobox").map((el) => el.textContent))
        .toEqual(["عميل الاختبار", "منتج الاختبار"]);
      expect((form.getByPlaceholderText("الكمية") as HTMLInputElement).value).toBe("3");
      expect((form.getByPlaceholderText("السعر") as HTMLInputElement).value).toBe("42.75");
      expect((form.getByPlaceholderText("خصم %") as HTMLInputElement).value).toBe("5");
      expect((form.getByRole("textbox") as HTMLTextAreaElement).value).toBe("ملاحظات الفاتورة لا تضيع");
      expect(attempts).toHaveLength(1);
      expect(attempts[0].key).toMatch(/^[0-9a-f-]{36}$/i);
      expect(invoiceReads).toBe(readsBeforeSave);
      expect(screen.getByText("خطأ", { exact: true })).toBeTruthy();
      expect(screen.queryByText("تم إنشاء الفاتورة")).toBeNull();
      expect(sessionStorage.length).toBe(1);

      // Retry inside this very same dialog, without refilling or remounting.
      await user.click(save);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(invoiceReads).toBe(readsBeforeSave + 1));
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toEqual(attempts[0]);
      expect(JSON.parse(attempts[1].body)).toEqual({
        customerId: 7,
        notes: "ملاحظات الفاتورة لا تضيع",
        lines: [{
          productId: 12, description: "منتج الاختبار", quantity: 3,
          unitPrice: 42.75, discountPct: 5, taxRate: 15,
        }],
      });
      expect(await screen.findByText("تم إنشاء الفاتورة", { exact: true })).toBeTruthy();
      expect(sessionStorage.length).toBe(0);
    } finally {
      view.unmount();
      client.clear();
    }
  });
});
