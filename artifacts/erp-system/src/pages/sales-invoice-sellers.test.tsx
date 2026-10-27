import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import SalesPage from "./sales";
import { Toaster } from "@/components/ui/toaster";

vi.mock("@/hooks/use-permissions", () => ({ usePermissions: () => ({ canManageFinance: true, canReadReports: false,isScoped:false,canCustomerInvoice:()=>true }) }));
vi.mock("@/hooks/use-vat-status", () => ({ useVatEnabled: () => false }));
afterEach(() => vi.unstubAllGlobals());

function stub(workspace: () => Response) {
  const posts: Array<Record<string, unknown>> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/api/sales/invoices" && init?.method === "POST") { posts.push(JSON.parse(String(init.body))); return Response.json({ id: 91, reference: "INV-91" }); }
    if (path === "/api/sales/sellers/workspace") return workspace();
    if (path === "/api/sales/invoices/email-failure-count") return Response.json({ exhaustedCount: 0, maxAttempts: 3 });
    if (path === "/api/customers") return Response.json([{ id: 7, name: "عميل الاختبار" }]);
    if (path === "/api/products") return Response.json([{ id: 12, nameAr: "قلم", price: 20 }, { id: 13, nameAr: "دفتر", price: 10 }]);
    return Response.json([]);
  }));
  return posts;
}
async function openDialog() {
  const user = userEvent.setup();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SalesPage /><Toaster /></QueryClientProvider>);
  await user.click(screen.getByRole("tab", { name: "فواتير العملاء" }));
  await user.click(await screen.findByRole("button", { name: "فاتورة جديدة" }));
  const dialog = screen.getByRole("dialog", { name: "فاتورة عميل جديدة" });
  return { user, dialog, form: within(dialog) };
}

describe("manual sales invoice seller attribution", () => {
  it("required per-line policy validates and maps overrides to submitted (filtered) line order", async () => {
    const posts = stub(() => Response.json({ policy: { mode: "required", granularity: "line" }, sellers: [{ id: 7, name: "سارة" }, { id: 8, name: "خالد" }], branches: [] }));
    const { user, form } = await openDialog();
    await form.findByTestId("invoice-seller-fields");
    await user.click(form.getAllByRole("combobox")[0]);
    await user.click(await screen.findByRole("option", { name: "عميل الاختبار" }));
    await user.click(form.getByRole("button", { name: /سطر/ }));
    await user.click(form.getByRole("button", { name: /سطر/ }));
    const productTriggers = () => form.getAllByRole("combobox").filter((el) => el.tagName !== "SELECT");
    await user.click(productTriggers()[1]);
    await user.click(await screen.findByRole("option", { name: "قلم" }));
    await user.click(productTriggers()[3]);
    await user.click(await screen.findByRole("option", { name: "دفتر" }));
    // Row 1 stays empty and is dropped on submit.
    await user.click(form.getByRole("button", { name: "حفظ" }));
    expect(await screen.findByText(/اختيار البائع إلزامي/)).toBeTruthy();
    expect(posts).toHaveLength(0);
    await user.selectOptions(form.getByTestId("select-invoice-seller"), "7");
    await user.selectOptions(form.getByTestId("select-invoice-line-seller-2"), "8");
    await user.click(form.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ customerId: 7, sellerEmployeeId: 7, lineSellers: [{ lineIndex: 1, employeeId: 8 }] });
    expect((posts[0].lines as unknown[]).length).toBe(2);
  });

  it("hidden policy sends no seller fields", async () => {
    const posts = stub(() => Response.json({ policy: { mode: "hidden" }, sellers: [], branches: [] }));
    const { user, form } = await openDialog();
    await waitFor(() => expect(form.queryByTestId("invoice-seller-loading")).toBeNull());
    await user.click(form.getAllByRole("combobox")[0]);
    await user.click(await screen.findByRole("option", { name: "عميل الاختبار" }));
    await user.click(form.getAllByRole("combobox")[1]);
    await user.click(await screen.findByRole("option", { name: "قلم" }));
    await user.click(form.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).not.toHaveProperty("sellerEmployeeId");
    expect(posts[0]).not.toHaveProperty("lineSellers");
  });

  it("policy load failure blocks save with an explicit retriable error", async () => {
    const posts = stub(() => new Response("boom", { status: 500 }));
    const { user, form } = await openDialog();
    expect((await form.findByTestId("invoice-seller-unavailable")).textContent).toContain("لا يمكن حفظ الفاتورة");
    await user.click(form.getAllByRole("combobox")[0]);
    await user.click(await screen.findByRole("option", { name: "عميل الاختبار" }));
    await user.click(form.getAllByRole("combobox")[1]);
    await user.click(await screen.findByRole("option", { name: "قلم" }));
    await user.click(form.getByRole("button", { name: "حفظ" }));
    expect(await screen.findByText(/تعذر تحميل سياسة البائعين. أعد المحاولة/)).toBeTruthy();
    expect(posts).toHaveLength(0);
    expect(form.getByTestId("button-retry-invoice-seller")).toBeTruthy();
  });
});
