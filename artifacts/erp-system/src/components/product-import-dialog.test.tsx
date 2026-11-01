import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProductImportDialog, IMPORT_ENDPOINT } from "./product-import-dialog";
import { intentStorageKey } from "@/lib/durable-intent";

const mocks = vi.hoisted(() => ({ options: vi.fn(), call: vi.fn(), user: { id: 5, companyId: 3 } }));
vi.mock("@/lib/product-import-api", () => {
  class ProductImportError extends Error {
    constructor(message: string, public status: number) { super(message); }
  }
  return { importOptions: mocks.options, productImport: mocks.call, ProductImportError };
});
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@workspace/api-client-react", () => ({ getListProductCategoriesQueryKey: () => ["/api/product-categories"] }));

const SK = intentStorageKey(IMPORT_ENDPOINT, 5, 3);
const OPTIONS = {
  fields: ["nameAr", "name", "sku", "categoryId", "price", "costPrice", "unit", "barcode"],
  required: ["nameAr", "name", "sku", "categoryId", "price", "costPrice", "unit"],
  units: ["قطعة"], categories: [{ id: 12, nameAr: "مشروبات", name: "Drinks" }],
  limits: { bytes: 262144, rows: 500, columns: 12, cellLength: 128 }, mode: "create-only", atomic: true,
  defaults: { stock: 0, minStock: 5, trackingMode: "none", costingMethod: "average" },
};
const HEADERS = ["nameAr", "name", "sku", "categoryId", "price", "costPrice", "unit"];
const PREVIEW = { errors: [], products: [{ nameAr: "قهوة", sku: "0017" }], total: 1, validRows: 1, canCommit: true, token: "tok-1" };
const err = async (status: number) => {
  const { ProductImportError } = await import("@/lib/product-import-api");
  return new ProductImportError("fail", status);
};

function handler(over: Partial<Record<string, () => unknown>> = {}) {
  mocks.call.mockImplementation(async (body: { action: string }) => {
    if (over[body.action]) return over[body.action]!();
    if (body.action === "parse") return { headers: HEADERS, rows: [["قهوة", "Coffee", "0017", 12, 10, 6, "قطعة"]] };
    if (body.action === "preview") return PREVIEW;
    throw new Error("unexpected " + body.action);
  });
}

async function toPreview() {
  const qc = new QueryClient();
  const inv = vi.spyOn(qc, "invalidateQueries");
  const utils = render(<QueryClientProvider client={qc}><ProductImportDialog open onOpenChange={vi.fn()} /></QueryClientProvider>);
  const input = await screen.findByTestId("input-import-file");
  fireEvent.change(input, { target: { files: [new File(["x"], "p.csv", { type: "text/csv" })] } });
  await screen.findByTestId("select-map-0");
  fireEvent.click(screen.getByTestId("button-import-preview"));
  await screen.findByTestId("panel-import-preview");
  return { inv, ...utils };
}
const actions = () => mocks.call.mock.calls.map((c) => c[0].action);

afterEach(cleanup);
beforeEach(() => {
  sessionStorage.clear();
  mocks.user = { id: 5, companyId: 3 };
  vi.restoreAllMocks();
  mocks.options.mockReset().mockResolvedValue(OPTIONS);
  mocks.call.mockReset();
  handler();
});

describe("ProductImportDialog", () => {
  it("explains denial on options 403", async () => {
    mocks.options.mockRejectedValue(await err(403));
    render(<QueryClientProvider client={new QueryClient()}><ProductImportDialog open onOpenChange={vi.fn()} /></QueryClientProvider>);
    expect(await screen.findByTestId("status-import-denied")).toBeTruthy();
  });

  it("preview writes nothing; changing mapping invalidates preview and blocks unmapped columns", async () => {
    await toPreview();
    expect(sessionStorage.length).toBe(0);
    expect(actions()).toEqual(["parse", "preview"]);
    fireEvent.change(screen.getByTestId("select-map-6"), { target: { value: "" } });
    expect(screen.queryByTestId("panel-import-preview")).toBeNull();
    expect(screen.getByTestId("list-mapping-issues").textContent).toContain("احذفه من الملف");
    expect((screen.getByTestId("button-import-preview") as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves exact intent before send, guards double click, retains intent on failure", async () => {
    let reject!: (e: unknown) => void;
    handler({ commit: () => new Promise((_, r) => { reject = r; }) });
    await toPreview();
    const btn = screen.getByTestId("button-import-commit");
    fireEvent.click(btn);
    fireEvent.click(btn);
    const saved = JSON.parse(sessionStorage.getItem(SK)!);
    expect(saved.body).toEqual({ action: "commit", token: "tok-1" });
    const commits = mocks.call.mock.calls.filter((c) => c[0].action === "commit");
    expect(commits).toHaveLength(1);
    expect(commits[0][1]).toBe(saved.key);
    reject(await err(500));
    await screen.findByTestId("panel-pending-import");
    expect(JSON.parse(sessionStorage.getItem(SK)!).key).toBe(saved.key);
    expect((screen.getByTestId("select-map-0") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByTestId("input-import-file") as HTMLInputElement).disabled).toBe(true);
  });

  it("recover 409 keeps intent; safe close then clears it and unblocks", async () => {
    sessionStorage.setItem(SK, JSON.stringify({ v: 1, key: "product-import:abc12345", endpoint: IMPORT_ENDPOINT, body: { action: "commit", token: "tok-9" }, responsibility: null, createdAt: "x" }));
    const e409 = await err(409);
    handler({ recover: () => { throw e409; }, close: () => ({ state: "closed", accepted: 0, rejected: 0 }) });
    render(<QueryClientProvider client={new QueryClient()}><ProductImportDialog open onOpenChange={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(await screen.findByTestId("button-recover-only"));
    await screen.findByTestId("text-import-error");
    expect(sessionStorage.getItem(SK)).not.toBeNull();
    expect(mocks.call).toHaveBeenLastCalledWith({ action: "recover", token: "tok-9" }, "product-import:abc12345");
    fireEvent.click(screen.getByTestId("button-safe-close"));
    await screen.findByTestId("status-import-closed");
    expect(mocks.call).toHaveBeenLastCalledWith({ action: "close", token: "tok-9" }, "product-import:abc12345");
    expect(sessionStorage.getItem(SK)).toBeNull();
    expect((screen.getByTestId("input-import-file") as HTMLInputElement).disabled).toBe(false);
  });

  it("completed outcome shows IDs and invalidates lists; CAS never erases a newer intent", async () => {
    handler({
      commit: () => {
        sessionStorage.setItem(SK, JSON.stringify({ v: 1, key: "product-import:newer999", endpoint: IMPORT_ENDPOINT, body: { action: "commit", token: "t2" }, responsibility: null, createdAt: "x" }));
        return { state: "completed", accepted: 1, rejected: 0, products: [{ id: 77, sku: "0017", barcode: null, nameAr: "قهوة" }] };
      },
    });
    const { inv } = await toPreview();
    fireEvent.click(screen.getByTestId("button-import-commit"));
    await screen.findByTestId("row-imported-77");
    expect(JSON.parse(sessionStorage.getItem(SK)!).key).toBe("product-import:newer999");
    expect(inv).toHaveBeenCalledWith({ queryKey: ["/api/products"] });
  });

  it("storage failure prevents sending commit", async () => {
    await toPreview();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    fireEvent.click(screen.getByTestId("button-import-commit"));
    await screen.findByTestId("text-import-error");
    expect(actions()).not.toContain("commit");
  });

  it("after reload with pending intent and options 403, create stays denied but recover completes", async () => {
    sessionStorage.setItem(SK, JSON.stringify({ v: 1, key: "product-import:rel12345", endpoint: IMPORT_ENDPOINT, body: { action: "commit", token: "tok-r" }, responsibility: null, createdAt: "x" }));
    mocks.options.mockRejectedValue(await err(403));
    handler({ recover: () => ({ state: "completed", accepted: 2, rejected: 0, products: [{ id: 91, sku: "0091", barcode: null, nameAr: "شاي" }] }) });
    render(<QueryClientProvider client={new QueryClient()}><ProductImportDialog open onOpenChange={vi.fn()} /></QueryClientProvider>);
    expect(await screen.findByTestId("status-import-denied")).toBeTruthy();
    expect(screen.queryByTestId("input-import-file")).toBeNull();
    fireEvent.click(screen.getByTestId("button-recover-only"));
    await screen.findByTestId("row-imported-91");
    expect(mocks.call).toHaveBeenLastCalledWith({ action: "recover", token: "tok-r" }, "product-import:rel12345");
    expect(sessionStorage.getItem(SK)).toBeNull();
  });

  it("scope switch during delayed commit ignores old response, keeps its intent, and recovers on switch back", async () => {
    let resolve!: (v: unknown) => void;
    handler({ commit: () => new Promise((r) => { resolve = r; }) });
    const { rerender } = await toPreview();
    fireEvent.click(screen.getByTestId("button-import-commit"));
    const key = JSON.parse(sessionStorage.getItem(SK)!).key;
    const tree = () => <QueryClientProvider client={new QueryClient()}><ProductImportDialog open onOpenChange={vi.fn()} /></QueryClientProvider>;
    mocks.user = { id: 5, companyId: 4 };
    rerender(tree());
    await waitFor(() => expect(screen.queryByTestId("panel-pending-import")).toBeNull());
    expect(screen.queryByTestId("select-map-0")).toBeNull();
    resolve({ state: "completed", accepted: 1, rejected: 0, products: [{ id: 77, sku: "0017", barcode: null, nameAr: "قهوة" }] });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("row-imported-77")).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(SK)!).key).toBe(key);
    handler({ recover: () => ({ state: "completed", accepted: 1, rejected: 0, products: [{ id: 77, sku: "0017", barcode: null, nameAr: "قهوة" }] }) });
    mocks.user = { id: 5, companyId: 3 };
    rerender(tree());
    fireEvent.click(await screen.findByTestId("button-recover-only"));
    await screen.findByTestId("row-imported-77");
    expect(mocks.call).toHaveBeenLastCalledWith({ action: "recover", token: "tok-1" }, key);
    expect(sessionStorage.getItem(SK)).toBeNull();
  });

  it("refuses to overwrite a newer or unreadable saved intent before commit", async () => {
    await toPreview();
    sessionStorage.setItem(SK, "{broken");
    fireEvent.click(screen.getByTestId("button-import-commit"));
    await screen.findByTestId("status-intent-unreadable");
    expect(sessionStorage.getItem(SK)).toBe("{broken");
    expect(actions()).not.toContain("commit");
  });

  it("recover returning closed after a lost close response clears the tombstoned intent", async () => {
    sessionStorage.setItem(SK, JSON.stringify({ v: 1, key: "product-import:lost1234", endpoint: IMPORT_ENDPOINT, body: { action: "commit", token: "tok-l" }, responsibility: null, createdAt: "x" }));
    handler({ close: () => { throw new TypeError("network"); }, recover: () => ({ state: "closed", accepted: 0, rejected: 0 }) });
    render(<QueryClientProvider client={new QueryClient()}><ProductImportDialog open onOpenChange={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(await screen.findByTestId("button-safe-close"));
    await screen.findByTestId("text-import-error");
    expect(sessionStorage.getItem(SK)).not.toBeNull();
    fireEvent.click(screen.getByTestId("button-recover-only"));
    await screen.findByTestId("status-import-closed");
    expect(mocks.call).toHaveBeenLastCalledWith({ action: "recover", token: "tok-l" }, "product-import:lost1234");
    expect(sessionStorage.getItem(SK)).toBeNull();
  });

  it.each([[{}], [{ state: "pending" }], [null]])("close returning invalid result %j retains the exact saved intent", async (reply) => {
    const raw = JSON.stringify({ v: 1, key: "product-import:inv12345", endpoint: IMPORT_ENDPOINT, body: { action: "commit", token: "tok-i" }, responsibility: null, createdAt: "x" });
    sessionStorage.setItem(SK, raw);
    handler({ close: () => reply });
    render(<QueryClientProvider client={new QueryClient()}><ProductImportDialog open onOpenChange={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(await screen.findByTestId("button-safe-close"));
    await waitFor(() => expect(mocks.call).toHaveBeenLastCalledWith({ action: "close", token: "tok-i" }, "product-import:inv12345"));
    await screen.findByTestId("text-import-error");
    expect(sessionStorage.getItem(SK)).toBe(raw);
    expect(screen.queryByTestId("status-import-closed")).toBeNull();
    expect(screen.getByTestId("panel-pending-import")).toBeTruthy();
  });
});
