import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SupplierImportDialog, SUPPLIER_IMPORT_ENDPOINT, buildSupplierTemplateCsv, hasSupplierImportIntent } from "./supplier-import-dialog";
import { intentStorageKey } from "@/lib/durable-intent";

const mocks = vi.hoisted(() => ({ options: vi.fn(), call: vi.fn(), resp: { v: "77" as string | null }, user: { id: 5, companyId: 3 } }));
vi.mock("@/lib/supplier-import-api", () => {
  class SupplierImportError extends Error { constructor(message: string, public status: number) { super(message); } }
  return {
    SUPPLIER_IMPORT_PATH: "/api/suppliers/imports",
    SUPPLIER_FIELDS: ["name", "vatNumber", "email", "phone", "address", "notes"],
    supplierImportOptions: mocks.options, supplierImport: mocks.call, SupplierImportError,
    currentResponsibility: () => mocks.resp.v,
  };
});
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));

const SK = intentStorageKey(SUPPLIER_IMPORT_ENDPOINT, 5, 3);
const OPTIONS = { fields: ["name", "vatNumber", "email", "phone", "address", "notes"], required: ["name"], limits: { bytes: 262144, rows: 500, columns: 12, cellLength: 128 }, mode: "create-only", atomic: true };
const HEADERS = ["name", "vatNumber", "phone"];
const ROW = { name: "مؤسسة الندى", vatNumber: "300047125600003", email: null, phone: "0551240387", address: null, notes: null };
const WARN = [{ row: 1, name: "مؤسسة الندى", matches: [{ id: 4, name: "مؤسسة الندي", vatNumber: null }] }];
const err = async (status: number) => { const { SupplierImportError } = await import("@/lib/supplier-import-api"); return new SupplierImportError("fail", status); };
const intent = (key: string, token: string) => JSON.stringify({ v: 1, key, endpoint: SUPPLIER_IMPORT_ENDPOINT, body: { action: "commit", token }, responsibility: "77", createdAt: "x" });

function handler(over: Partial<Record<string, (b: any) => unknown>> = {}) {
  mocks.call.mockImplementation(async (body: { action: string }) => {
    if (over[body.action]) {
      const result: any = over[body.action]!(body);
      if (body.action === "preview") return { ...result, previewRows: result.previewRows ?? result.suppliers.map((values: unknown, i: number) => ({ row: i + 2, values, status: "valid", errors: [] })) };
      return result;
    }
    if (body.action === "parse") return { headers: HEADERS, rows: [["مؤسسة الندى", "300047125600003", "0551240387"]] };
    if (body.action === "preview") return { errors: [], warnings: [], suppliers: [ROW], previewRows: [{ row: 2, values: ROW, status: "valid", errors: [] }], total: 1, validRows: 1, canCommit: true, token: "tok-1" };
    throw new Error("unexpected " + body.action);
  });
}
const renderDlg = (qc = new QueryClient()) => render(<QueryClientProvider client={qc}><SupplierImportDialog open onOpenChange={vi.fn()} /></QueryClientProvider>);
async function toPreview() {
  const qc = new QueryClient();
  const inv = vi.spyOn(qc, "invalidateQueries");
  renderDlg(qc);
  fireEvent.change(await screen.findByTestId("input-import-file"), { target: { files: [new File(["x"], "s.csv", { type: "text/csv" })] } });
  await screen.findByTestId("select-map-0");
  fireEvent.click(screen.getByTestId("button-import-preview"));
  await screen.findByTestId("panel-import-preview");
  return { inv };
}
const actions = () => mocks.call.mock.calls.map((c) => c[0].action);

afterEach(cleanup);
beforeEach(() => {
  sessionStorage.clear();
  mocks.user = { id: 5, companyId: 3 };
  mocks.resp.v = "77";
  vi.restoreAllMocks();
  mocks.options.mockReset().mockResolvedValue(OPTIONS);
  mocks.call.mockReset();
  handler();
});

describe("SupplierImportDialog", () => {
  it("template is BOM UTF-8 with quoted text VAT/phone and Arabic sample", () => {
    const csv = buildSupplierTemplateCsv();
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain('"0551240387"');
    expect(csv).toContain("مؤسسة");
  });

  it("maps all columns, shows every reviewed value, unmapped column blocks preview", async () => {
    await toPreview();
    expect(sessionStorage.length).toBe(0);
    expect(screen.getByTestId("row-preview-0").textContent).toContain("0551240387");
    expect(mocks.call.mock.calls[1][0].document.mapping).toEqual({ name: 0, vatNumber: 1, phone: 2 });
    fireEvent.change(screen.getByTestId("select-map-2"), { target: { value: "" } });
    expect(screen.queryByTestId("panel-import-preview")).toBeNull();
    expect(screen.getByTestId("list-mapping-issues").textContent).toContain("احذفه");
  });

  it("similar names require checkbox and a fresh confirmed preview", async () => {
    handler({ preview: (b) => b.confirmSimilarNames
      ? { errors: [], warnings: WARN, suppliers: [ROW], total: 1, validRows: 1, canCommit: true, token: "tok-c" }
      : { errors: [], warnings: WARN, suppliers: [ROW], total: 1, validRows: 1, canCommit: false, token: null } });
    await toPreview();
    expect((screen.getByTestId("button-import-commit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("checkbox-confirm-similar"));
    expect((screen.getByTestId("button-import-commit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("button-repreview-confirm"));
    await screen.findByText(/تأكيد استيراد 1 مورد/);
    await vi.waitFor(() => expect((screen.getByTestId("button-import-commit") as HTMLButtonElement).disabled).toBe(false));
    expect(mocks.call.mock.calls.at(-1)![0].confirmSimilarNames).toBe(true);
    fireEvent.click(screen.getByTestId("checkbox-confirm-similar"));
    expect((screen.getByTestId("checkbox-confirm-similar") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("button-import-commit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("button-import-commit"));
    expect(actions()).not.toContain("commit");
    fireEvent.click(screen.getByTestId("checkbox-confirm-similar"));
    expect((screen.getByTestId("button-import-commit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("button-repreview-confirm"));
    await vi.waitFor(() => expect((screen.getByTestId("button-import-commit") as HTMLButtonElement).disabled).toBe(false));
  });
  it("missing VAT is unavailable evidence, never an unregistered-tax assertion", async () => {
    handler({ preview: () => ({ errors: [], warnings: [{ ...WARN[0], matches: [{ id: 9, name: "مطابق", vatNumber: null }] }],
      suppliers: [ROW], previewRows: [{ row: 2, values: ROW, status: "valid", errors: [] }], total: 1, validRows: 1, canCommit: false, token: null }) });
    await toPreview();
    expect(screen.getByTestId("panel-similar-warnings").textContent).toContain("الرقم الضريبي غير متوفر");
    expect(screen.getByTestId("panel-similar-warnings").textContent).not.toContain("غير مسجل");
  });
  it.each(["mixed", "invalid", "valid"])("shows every source row, original numbering, values and errors: %s", async (kind) => {
    const issue = { row: 2, field: "email", message: "البريد الإلكتروني غير صالح" };
    const good = { ...ROW, name: "المورد الثاني", email: "ok@example.invalid" };
    const firstBad = kind !== "valid", secondBad = kind === "invalid";
    const issues = [...(firstBad ? [issue] : []), ...(secondBad ? [{ ...issue, row: 3 }] : [])];
    handler({ preview: () => ({
      errors: issues, warnings: [], suppliers: kind === "valid" ? [ROW, good] : kind === "mixed" ? [good] : [],
      previewRows: [
        { row: 2, values: { ...ROW, email: firstBad ? "bad-email" : "first@example.invalid" }, status: firstBad ? "error" : "valid", errors: firstBad ? [issue] : [] },
        { row: 3, values: { ...good, email: secondBad ? "bad-again" : good.email }, status: secondBad ? "error" : "valid", errors: secondBad ? [{ ...issue, row: 3 }] : [] },
      ], total: 2, validRows: kind === "valid" ? 2 : kind === "mixed" ? 1 : 0, canCommit: kind === "valid", token: kind === "valid" ? "valid" : null,
    }) });
    await toPreview();
    expect(screen.getByTestId("row-preview-0").textContent).toContain("2");
    expect(screen.getByTestId("row-preview-0").textContent).toContain(firstBad ? "bad-email" : "first@example.invalid");
    expect(screen.getByTestId("row-preview-1").textContent).toContain("3");
    expect(screen.getByTestId("row-preview-1").textContent).toContain(secondBad ? "bad-again" : "ok@example.invalid");
    if (firstBad) expect(screen.getByTestId("row-preview-0").textContent).toContain(issue.message);
    expect((screen.getByTestId("button-import-commit") as HTMLButtonElement).disabled).toBe(kind !== "valid");
  });

  it("persists exact intent + responsibility before send, guards double click, unknown failure keeps it", async () => {
    let reject!: (e: unknown) => void;
    handler({ commit: () => new Promise((_, r) => { reject = r; }) });
    await toPreview();
    const btn = screen.getByTestId("button-import-commit");
    fireEvent.click(btn); fireEvent.click(btn);
    const saved = JSON.parse(sessionStorage.getItem(SK)!);
    expect(saved.body).toEqual({ action: "commit", token: "tok-1" });
    expect(saved.responsibility).toBe("77");
    const commits = mocks.call.mock.calls.filter((c) => c[0].action === "commit");
    expect(commits).toHaveLength(1);
    expect(commits[0][1]).toBe(saved.key);
    expect(commits[0][2]).toBe("77");
    reject(await err(503));
    await screen.findByTestId("panel-pending-import");
    expect(screen.getByTestId("text-import-error").textContent).toContain("لا يثبت");
    expect(JSON.parse(sessionStorage.getItem(SK)!).key).toBe(saved.key);
    expect((screen.getByTestId("input-import-file") as HTMLInputElement).disabled).toBe(true);
  });

  it("storage failure prevents sending", async () => {
    await toPreview();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    fireEvent.click(screen.getByTestId("button-import-commit"));
    await screen.findByTestId("text-import-error");
    expect(actions()).not.toContain("commit");
  });
  it("withdrawing similarity consent cannot erase or change an already sent unknown attempt", async () => {
    handler({
      preview: b => ({ errors: [], warnings: WARN, suppliers: [ROW], total: 1, validRows: 1,
        canCommit: b.confirmSimilarNames, token: b.confirmSimilarNames ? "reviewed-token" : null }),
      commit: () => { throw new Error("response lost"); },
    });
    await toPreview();
    fireEvent.click(screen.getByTestId("checkbox-confirm-similar"));
    fireEvent.click(screen.getByTestId("button-repreview-confirm"));
    await vi.waitFor(() => expect((screen.getByTestId("button-import-commit") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId("button-import-commit"));
    await screen.findByTestId("text-import-error");
    const saved = sessionStorage.getItem(SK);
    expect(saved).toContain("reviewed-token");
    const checkbox = screen.getByTestId("checkbox-confirm-similar") as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    fireEvent.click(checkbox);
    expect(sessionStorage.getItem(SK)).toBe(saved);
    expect(actions().filter(a => a === "commit")).toHaveLength(1);
  });

  it("after reload with options 403: recover 409 keeps intent, pending header kept, safe close clears", async () => {
    sessionStorage.setItem(SK, intent("supplier-import:abc12345", "tok-9"));
    mocks.resp.v = "999";
    mocks.options.mockRejectedValue(await err(403));
    const e409 = await err(409);
    handler({ recover: () => { throw e409; }, close: () => ({ state: "closed", accepted: 0, rejected: 0 }) });
    renderDlg();
    expect(await screen.findByTestId("status-import-denied")).toBeTruthy();
    expect(screen.queryByTestId("input-import-file")).toBeNull();
    fireEvent.click(screen.getByTestId("button-recover-only"));
    await screen.findByTestId("text-import-error");
    expect(sessionStorage.getItem(SK)).not.toBeNull();
    expect(mocks.call).toHaveBeenLastCalledWith({ action: "recover", token: "tok-9" }, "supplier-import:abc12345", "77");
    fireEvent.click(screen.getByTestId("button-safe-close"));
    await screen.findByTestId("status-import-closed");
    expect(sessionStorage.getItem(SK)).toBeNull();
  });

  it("completed shows IDs, invalidates /suppliers; CAS never erases newer intent", async () => {
    handler({ commit: () => {
      sessionStorage.setItem(SK, intent("supplier-import:newer999", "t2"));
      return { state: "completed", accepted: 1, rejected: 0, suppliers: [{ id: 81, name: "مؤسسة الندى", vatNumber: "300047125600003" }] };
    } });
    const { inv } = await toPreview();
    fireEvent.click(screen.getByTestId("button-import-commit"));
    await screen.findByTestId("row-imported-81");
    expect(JSON.parse(sessionStorage.getItem(SK)!).key).toBe("supplier-import:newer999");
    expect(inv).toHaveBeenCalledWith({ queryKey: ["/suppliers"] });
  });

  it("read-only recovery visibility is scoped to user/company", () => {
    expect(hasSupplierImportIntent(5, 3)).toBe(false);
    sessionStorage.setItem(SK, intent("supplier-import:abc12345", "t"));
    expect(hasSupplierImportIntent(5, 3)).toBe(true);
    expect(hasSupplierImportIntent(5, 4)).toBe(false);
    sessionStorage.setItem(SK, "{bad");
    expect(hasSupplierImportIntent(5, 3)).toBe(true);
  });
});
