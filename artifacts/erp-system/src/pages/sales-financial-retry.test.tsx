import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import SalesPage from "./sales";
import { Toaster } from "@/components/ui/toaster";

vi.mock("@/hooks/use-permissions", () => ({
  usePermissions: () => ({ canManageFinance: true, canReadReports: false }),
}));
vi.mock("@/hooks/use-vat-status", () => ({
  useVatEnabled: () => true,
}));
vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    // Keep React/hooks stable, but resolve the real transport dynamically so
    // resetModules below can discard its in-memory intent map like a reload.
    financialFetch: async (...args: Parameters<typeof actual.financialFetch>) => {
      const { financialFetch } = await import("../../../../lib/api-client-react/src/financial-fetch");
      return financialFetch(...args);
    },
  };
});

const uncertainMessage =
  "تعذر تأكيد نتيجة العملية؛ قد تكون حُفظت بالفعل. أعد المحاولة بنفس البيانات لاسترجاع النتيجة دون إنشاء عملية مكررة.";
const invoice = {
  id: 31, reference: "INV-31", customerId: 7, total: 400,
  amountPaid: 0, invoiceDate: "2026-10-01",
};
const invoiceLine = {
  id: 41, productId: 12, description: "بند الفاتورة المرجعية",
  quantity: 2, unitPrice: 42.75, taxRate: 15,
};
const cases = [
  {
    path: "/api/sales/receipts", tab: "سندات القبض", open: "سند قبض",
    title: "سند قبض جديد", save: "حفظ السند", success: "تم تسجيل سند القبض",
    reference: "REC-RETRY-91",
    body: {
      customerId: 7, amount: 85.5, paymentMethod: "bank",
      allocations: [{ invoiceId: 31, amount: 85.5 }],
    },
  },
  {
    path: "/api/sales/credit-notes", tab: "إشعارات دائنة", open: "إشعار جديد",
    title: "إشعار دائن جديد", save: "حفظ وترحيل", success: "تم إنشاء الإشعار الدائن",
    reference: "CN-RETRY-91",
    body: {
      customerId: 7, invoiceId: 31, reason: "سبب المرتجع لا يضيع", restock: false,
      lines: [{
        productId: 12, description: "بند الفاتورة المرجعية", quantity: 2,
        unitPrice: 42.75, taxRate: 15, invoiceLineId: 41,
      }],
    },
  },
];

const recoveryCases = cases.flatMap((scenario) =>
  (["same dialog", "page reload"] as const).map((recovery) => ({ ...scenario, recovery })),
);

describe.each(recoveryCases)("$path form recovery: $recovery", ({ recovery, ...scenario }) => {
  it.each(["lost response", "502", "malformed JSON success"] as const)(
    "keeps the form and intent after %s, then shows one replayed document",
    async (fault) => {
      const attempts: Array<{ body: string; key: string | null }> = [];
      // A stateful transport double, not a real server/database. Commit before
      // fault injection, replay by key, and serve the same rows on list refresh.
      // Real transaction/idempotency guarantees belong to the isolated API tests.
      const committed = new Map<string, { body: string; row: Record<string, unknown> }>();
      let listReads = 0;
      let replays = 0;
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://localhost");
        const path = url.pathname;
        if (path === scenario.path && init?.method === "POST") {
          const key = new Headers(init.headers).get("Idempotency-Key");
          const body = String(init.body);
          attempts.push({ body, key });
          if (!key) throw new Error("Missing financial intent key");
          const previous = committed.get(key);
          if (previous) {
            expect(body).toBe(previous.body);
            replays++;
            return Response.json(previous.row, { headers: { "Idempotency-Replayed": "true" } });
          }
          const row = {
            ...JSON.parse(body), id: 91, reference: scenario.reference,
            customerName: "عميل الاختبار", receiptDate: "2026-10-01",
            noteDate: "2026-10-01", total: 98.325, status: "issued",
          };
          committed.set(key, { body, row });
          // Only the first response is faulty. A mistakenly renewed retry key
          // would create a second row and fail the count/list assertions.
          if (attempts.length === 1) {
            if (fault === "lost response") throw new TypeError("connection lost after commit");
            if (fault === "malformed JSON success") {
              // The write above succeeded; only its HTTP 201 confirmation is
              // truncated. Exercise the real financialFetch JSON parsing.
              return new Response('{"id":91', {
                status: 201, headers: { "Content-Type": "application/json" },
              });
            }
            return new Response("<h1>Bad Gateway</h1>", { status: 502 });
          }
          return Response.json(row);
        }
        if (path === scenario.path) {
          listReads++;
          return Response.json([...committed.values()].map(({ row }) => row));
        }
        if (path === "/api/customers") return Response.json([{ id: 7, name: "عميل الاختبار" }]);
        if (path === "/api/products") return Response.json([{ id: 12, nameAr: "منتج الاختبار" }]);
        if (path === "/api/sales/quotations") return Response.json([]);
        if (path === "/api/sales/invoices/31") return Response.json({ ...invoice, lines: [invoiceLine] });
        if (path === "/api/sales/invoices") {
          return Response.json(url.searchParams.get("status") === "partially_paid" ? [] : [invoice]);
        }
        throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url}`);
      }));
      const newClient = () => new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      });
      let client = newClient();
      const user = userEvent.setup();
      const mount = () => render(
        <QueryClientProvider client={client}>
          <SalesPage />
          <Toaster />
        </QueryClientProvider>,
      );
      let view = mount();
      const openForm = async () => {
        await user.click(screen.getByRole("button", { name: scenario.open }));
        return screen.getByRole("dialog", { name: scenario.title });
      };
      const fillForm = async (dialog: HTMLElement) => {
        const form = within(dialog);
        await user.click(form.getAllByRole("combobox")[0]);
        await user.click(await screen.findByRole("option", { name: "عميل الاختبار" }));
        if (scenario.path.endsWith("/receipts")) {
          await form.findByText("INV-31");
          await user.clear(form.getAllByRole("spinbutton")[0]);
          await user.type(form.getAllByRole("spinbutton")[0], "85.5");
          await user.type(form.getAllByRole("spinbutton")[1], "85.5");
          await user.click(form.getAllByRole("combobox")[1]);
          await user.click(screen.getByRole("option", { name: "تحويل بنكي" }));
        } else {
          await user.click(form.getAllByRole("combobox")[1]);
          await user.click(await screen.findByRole("option", { name: "INV-31" }));
          await user.type(form.getByPlaceholderText("مردود/خصم/خطأ سعر"), "سبب المرتجع لا يضيع");
          await user.click(form.getByRole("checkbox"));
          await user.click(await form.findByRole("button", { name: invoiceLine.description.slice(0, 20) }));
          // Remove the blank initial line; retain the referenced invoice line.
          await user.click(form.getAllByRole("button", { name: "×" })[0]);
        }
      };
      try {
        await user.click(screen.getByRole("tab", { name: scenario.tab }));
        await waitFor(() => expect(listReads).toBe(1));
        let dialog = await openForm();
        let form = within(dialog);
        await fillForm(dialog);
        const values = () => ({
          inputs: Array.from(dialog.querySelectorAll("input, textarea")).map((el) => {
            const input = el as HTMLInputElement;
            return { value: input.value, checked: input.checked };
          }),
          selections: form.getAllByRole("combobox").map((el) => el.textContent),
        });
        const before = values();
        let readsBeforeSave = listReads;
        let save = form.getByRole("button", { name: scenario.save });
        await user.click(save);

        expect(await screen.findByText(uncertainMessage, { exact: true })).toBeTruthy();
        expect(screen.getByRole("dialog", { name: scenario.title })).toBe(dialog);
        expect(values()).toEqual(before);
        const guidance = form.getByRole("note").textContent;
        expect(guidance).toContain("راجع القائمة أولاً");
        expect(guidance).toContain("أدخل البيانات الأصلية كاملة دون تغيير");
        expect(guidance).toContain("فلا تحفظ عملية جديدة");
        expect(screen.getByText("خطأ", { exact: true })).toBeTruthy();
        expect(screen.queryByText(scenario.success, { exact: true })).toBeNull();
        expect(listReads).toBe(readsBeforeSave);
        expect(attempts).toHaveLength(1);
        expect(JSON.parse(attempts[0].body)).toEqual(scenario.body);
        expect(attempts[0].key).toMatch(/^[0-9a-f-]{36}$/i);
        expect(committed.size).toBe(1);
        expect(sessionStorage.length).toBe(1);
        const storageKey = sessionStorage.key(0)!;
        expect(storageKey).toMatch(/^hasba:financial-request:/);
        expect(sessionStorage.getItem(storageKey)).toBe(attempts[0].key);
        // Financial payloads are deliberately not persisted in browser storage.
        expect(storageKey).toMatch(/^hasba:financial-request:[0-9a-f]{64}$/);
        expect(localStorage.length).toBe(0);

        if (recovery === "page reload") {
          const oldDialog = dialog;
          const oldTransport = await import("../../../../lib/api-client-react/src/financial-fetch");
          view.unmount();
          client.clear();
          vi.resetModules();
          const freshTransport = await import("../../../../lib/api-client-react/src/financial-fetch");
          expect(freshTransport.financialFetch).not.toBe(oldTransport.financialFetch);
          client = newClient();
          view = mount();
          expect(screen.queryByRole("dialog")).toBeNull();
          await user.click(screen.getByRole("tab", { name: scenario.tab }));
          await waitFor(() => expect(listReads).toBe(readsBeforeSave + 1));
          // Reload itself never re-submits. Fresh GETs show the committed row.
          expect(attempts).toHaveLength(1);
          expect(await screen.findAllByText(scenario.reference, { exact: true })).toHaveLength(1);
          expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
          expect(sessionStorage.getItem(storageKey)).toBe(attempts[0].key);

          dialog = await openForm();
          form = within(dialog);
          expect(dialog).not.toBe(oldDialog);
          expect(values()).not.toEqual(before);
          expect(form.getAllByRole("combobox")[0].textContent).not.toContain("عميل الاختبار");
          if (scenario.path.endsWith("/receipts")) {
            expect(form.getAllByRole("spinbutton")).toHaveLength(1);
            expect((form.getByRole("spinbutton") as HTMLInputElement).value).toBe("0");
            expect(form.getAllByRole("combobox")[1].textContent).toBe("نقدي");
          } else {
            expect((form.getByPlaceholderText("مردود/خصم/خطأ سعر") as HTMLInputElement).value).toBe("");
            expect((form.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
            expect(form.queryByDisplayValue(invoiceLine.description)).toBeNull();
          }
          const guidance = form.getByRole("note").textContent;
          expect(guidance).toContain("راجع القائمة أولاً");
          expect(guidance).toContain("لا تُستعاد بيانات النموذج تلقائياً");
          expect(guidance).toContain("مفتاح المحاولة يبقى في علامة التبويب نفسها");
          expect(guidance).toContain("أدخل البيانات الأصلية كاملة دون تغيير");
          expect(guidance).toContain("فلا تحفظ عملية جديدة");
          await fillForm(dialog);
          expect(values()).toEqual(before);
          save = form.getByRole("button", { name: scenario.save });
          readsBeforeSave = listReads;
          expect(attempts).toHaveLength(1);
        }

        // In the reload case this is a fresh form/cache/transport, with the
        // original tab's sessionStorage retained.
        await user.click(save);
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        await waitFor(() => expect(listReads).toBe(readsBeforeSave + 1));
        expect(attempts).toHaveLength(2);
        expect(attempts[1]).toEqual(attempts[0]);
        expect(replays).toBe(1);
        expect(committed.size).toBe(1);
        expect(await screen.findByText(scenario.success, { exact: true })).toBeTruthy();
        expect(await screen.findAllByText(scenario.reference, { exact: true })).toHaveLength(1);
        // Header plus exactly one visible document row.
        expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
        expect(sessionStorage.length).toBe(0);
      } finally {
        view.unmount();
        client.clear();
      }
    },
  );
});
