import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvoiceTemplatesTab } from "./invoice-templates-tab";

const DEF = { version: 1, preset: "formal", accent: "#285886", font: "Tajawal", fontSize: 12, logoMode: "identity", logoObjectKey: null,
  logoPosition: "start", logoWidth: 28, header: "", footer: "", note: "", showContact: true, showBank: true };
const m = vi.hoisted(() => ({
  scope: { branchId: undefined as number | undefined, generation: 0 },
  settings: null as unknown, catalog: null as unknown, catalogError: null as unknown,
  patch: vi.fn(), upload: vi.fn(), toast: vi.fn(),
}));
vi.mock("@/components/invoice-editor", () => ({ InvoiceEditor: () => null }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock("@/components/settings-scope", () => ({ useSettingsScope: () => ({ ...m.scope, baseline: { current: {} }, setBranchId: () => {}, reload: () => {} }) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useGetAppSettings: () => ({ data: m.settings, isLoading: !m.settings, isError: false, refetch: vi.fn() }),
  useGetInvoiceTemplateCatalog: () => ({ data: m.catalog, error: m.catalogError, isLoading: !m.catalog && !m.catalogError, isError: !!m.catalogError, refetch: vi.fn() }),
  usePatchAppSettings: () => ({ mutateAsync: m.patch, isPending: false }),
  useUploadInvoiceTemplateLogo: () => ({ mutateAsync: m.upload, isPending: false }),
}));

const mk = (o: { companyId?: number; revision?: number; design?: unknown; overrides?: Record<string, string[]>; canManage?: boolean } = {}) => ({
  templates: o.design ? { invoiceDesign: o.design } : {},
  scope: { companyId: o.companyId ?? 5, revision: o.revision ?? 7, parentRevision: 3, canManage: o.canManage ?? true, overrides: o.overrides ?? {} },
});
beforeEach(() => {
  m.scope = { branchId: undefined, generation: 0 };
  m.settings = mk(); m.catalogError = null;
  m.catalog = { canManage: true, defaultDesign: DEF, presets: [{ id: "formal", name: "رسمي", description: "" }] };
  m.patch.mockReset().mockResolvedValue({}); m.toast.mockReset();
  (globalThis.URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:x");
  (globalThis.URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
});
const qc = new QueryClient();
const pdfRes = () => new Response(new Blob(["%PDF"]), { status: 200, headers: { "content-type": "application/pdf" } });
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const headerValue = () => (screen.getByTestId("input-design-header") as HTMLInputElement).value;
const ui = () => <QueryClientProvider client={qc}><InvoiceTemplatesTab /></QueryClientProvider>;

describe("InvoiceTemplatesTab", () => {
  it("shows skeleton while loading without dereferencing data", () => {
    m.settings = null; m.catalog = null; render(ui());
    expect(screen.getByTestId("invoice-templates-loading")).toBeTruthy();
  });
  it("locks for non-managers and on catalog 403", () => {
    m.settings = mk({ canManage: false }); const r = render(ui());
    expect(screen.getByTestId("invoice-templates-forbidden")).toBeTruthy(); r.unmount();
    m.settings = mk(); m.catalog = null; m.catalogError = Object.assign(new Error("x"), { status: 403 }); render(ui());
    expect(screen.getByTestId("invoice-templates-forbidden")).toBeTruthy();
  });
  it("loads design, saves whole invoiceDesign with expected revisions", async () => {
    m.settings = mk({ design: { ...DEF, preset: "ink", header: "رأس" } }); render(ui()); const u = userEvent.setup();
    expect((await screen.findByTestId("card-preset-ink")).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("text-invoice-design-revision").textContent).toContain("7");
    await u.click(screen.getByTestId("card-preset-modern"));
    await u.click(screen.getByTestId("button-save-invoice-design"));
    await waitFor(() => expect(m.patch).toHaveBeenCalledTimes(1));
    const arg = m.patch.mock.calls[0][0];
    expect(arg.params).toBeUndefined();
    expect(arg.data).toEqual({ expectedCompanyId: 5, expectedRevision: 7, expectedParentRevision: 3,
      templates: { invoiceDesign: { ...DEF, preset: "modern", header: "رأس" } } });
  });
  it("root restore default saves default design normally, never a reset key", async () => {
    m.settings = mk({ design: { ...DEF, preset: "ink" } }); render(ui()); const u = userEvent.setup();
    expect(screen.queryByTestId("button-design-inherit")).toBeNull();
    await u.click(await screen.findByTestId("button-design-restore-default"));
    await u.click(screen.getByText("تأكيد"));
    await waitFor(() => expect(m.patch).toHaveBeenCalledTimes(1));
    const data = m.patch.mock.calls[0][0].data;
    expect(data.reset).toBeUndefined();
    expect(data.templates.invoiceDesign).toEqual(DEF);
  });
  it("branch override returns to inherited via reset", async () => {
    m.scope.branchId = 9; m.settings = mk({ design: DEF, overrides: { templates: ["invoiceDesign"] } }); render(ui()); const u = userEvent.setup();
    expect(screen.getByTestId("status-invoice-design-source").textContent).toContain("مخصص");
    await u.click(await screen.findByTestId("button-design-inherit"));
    await u.click(screen.getByText("تأكيد"));
    await waitFor(() => expect(m.patch).toHaveBeenCalledTimes(1));
    expect(m.patch.mock.calls[0][0]).toEqual({ params: { branchId: 9 },
      data: { expectedCompanyId: 5, expectedRevision: 7, expectedParentRevision: 3, reset: { templates: ["invoiceDesign"] } } });
  });
  it("preserves draft on 409 even after settings refetch", async () => {
    m.patch.mockRejectedValue(Object.assign(new Error("conflict"), { status: 409 }));
    const r = render(ui()); const u = userEvent.setup();
    const header = await screen.findByTestId("input-design-header");
    await u.type(header, "مسودة");
    await u.click(screen.getByTestId("button-save-invoice-design"));
    await waitFor(() => expect(m.toast.mock.calls.at(-1)?.[0].title).toContain("تعديلاتك باقية"));
    m.settings = mk({ revision: 8 }); r.rerender(ui());
    expect((screen.getByTestId("input-design-header") as HTMLInputElement).value).toBe("مسودة");
  });
  it("drops dirty draft on company or branch switch", async () => {
    const r = render(ui()); const u = userEvent.setup();
    await u.type(await screen.findByTestId("input-design-header"), "سر");
    m.settings = mk({ companyId: 6 }); r.rerender(ui());
    await waitFor(() => expect((screen.getByTestId("input-design-header") as HTMLInputElement).value).toBe(""));
    await u.type(screen.getByTestId("input-design-header"), "فرع");
    m.scope.branchId = 2; r.rerender(ui());
    await waitFor(() => expect((screen.getByTestId("input-design-header") as HTMLInputElement).value).toBe(""));
  });
  it("preview posts draft, shows iframe; failure and revocation show errors", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(pdfRes())
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "تعذر العرض" }), { status: 500 }))
      .mockResolvedValueOnce(new Response("{}", { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    render(ui()); const u = userEvent.setup();
    await u.click(await screen.findByTestId("seg-width-80"));
    await u.click(screen.getByTestId("button-preview-invoice-design"));
    expect(await screen.findByTestId("iframe-invoice-preview")).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/print/templates/preview");
    expect(JSON.parse(init.body)).toEqual({ expectedCompanyId: 5, branchId: null, design: DEF, sample: "short", width: "80" });
    expect(init.credentials).toBe("include");
    await u.click(screen.getByTestId("button-preview-invoice-design"));
    expect((await screen.findByTestId("preview-error")).textContent).toContain("تعذر العرض");
    expect(screen.queryByTestId("iframe-invoice-preview")).toBeNull();
    await act(async () => { await u.click(screen.getByTestId("button-preview-invoice-design")); });
    expect((await screen.findByTestId("preview-error")).textContent).toContain("صلاحية");
    vi.unstubAllGlobals();
  });

  it("rejects non-PDF preview responses and drops preview when draft changes", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(pdfRes());
    vi.stubGlobal("fetch", fetchMock);
    render(ui()); const u = userEvent.setup();
    await u.click(await screen.findByTestId("button-preview-invoice-design"));
    expect((await screen.findByTestId("preview-error")).textContent).toContain("PDF");
    await u.click(screen.getByTestId("button-preview-invoice-design"));
    expect(await screen.findByTestId("iframe-invoice-preview")).toBeTruthy();
    await u.click(screen.getByTestId("seg-sample-long"));
    await waitFor(() => expect(screen.queryByTestId("iframe-invoice-preview")).toBeNull());
    vi.unstubAllGlobals();
  });
  it("delayed preview resolving after company switch never shows the old PDF", async () => {
    const d = deferred<Response>(); vi.stubGlobal("fetch", vi.fn(() => d.promise));
    const r = render(ui()); const u = userEvent.setup();
    await u.click(await screen.findByTestId("button-preview-invoice-design"));
    m.settings = mk({ companyId: 6 }); r.rerender(ui());
    await act(async () => { d.resolve(pdfRes()); await d.promise; });
    await waitFor(() => expect(screen.getByTestId("preview-empty")).toBeTruthy());
    expect(screen.queryByTestId("iframe-invoice-preview")).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
  it("delayed logo upload resolving after branch switch is not attached to the new branch", async () => {
    const d = deferred<{ objectKey: string }>(); m.upload.mockReset().mockReturnValue(d.promise);
    const r = render(ui()); const u = userEvent.setup();
    await u.click(await screen.findByTestId("seg-logo-mode-custom"));
    await u.upload(screen.getByTestId("input-template-logo-file"), new File([new Uint8Array([137, 80])], "l.png", { type: "image/png" }));
    await waitFor(() => expect(m.upload).toHaveBeenCalledTimes(1));
    expect(m.upload.mock.calls[0][0].data).toMatchObject({ expectedCompanyId: 5, branchId: null });
    m.scope.branchId = 4; r.rerender(ui());
    await act(async () => { d.resolve({ objectKey: "company5/old" }); await d.promise; });
    expect(screen.getByTestId("seg-logo-mode-identity").getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("status-custom-logo")).toBeNull();
    m.patch.mockClear(); await u.type(screen.getByTestId("input-design-header"), "x");
    await u.click(screen.getByTestId("button-save-invoice-design"));
    await waitFor(() => expect(m.patch).toHaveBeenCalledTimes(1));
    expect(m.patch.mock.calls[0][0].data.templates.invoiceDesign.logoObjectKey).toBeNull();
    expect(m.toast.mock.calls.some(c => String(c[0].title).includes("رُفع"))).toBe(false);
  });
  it("delayed save resolving after company switch keeps new scope clean and still invalidates cache", async () => {
    const d = deferred<unknown>(); m.patch.mockReset().mockReturnValue(d.promise);
    const inv = vi.spyOn(qc, "invalidateQueries");
    const r = render(ui()); const u = userEvent.setup();
    await u.type(await screen.findByTestId("input-design-header"), "قديم");
    await u.click(screen.getByTestId("button-save-invoice-design"));
    m.settings = mk({ companyId: 6 }); r.rerender(ui());
    await waitFor(() => expect(headerValue()).toBe(""));
    await act(async () => { d.resolve({}); await d.promise; });
    expect(headerValue()).toBe("");
    expect(inv).toHaveBeenCalled();
    expect(m.toast.mock.calls.some(c => String(c[0].title).includes("تم حفظ"))).toBe(false);
    inv.mockRestore();
  });
  it("delayed save failure after switch shows no stale error and confirm dialog closes on switch", async () => {
    const d = deferred<unknown>(); m.patch.mockReset().mockReturnValue(d.promise);
    m.settings = mk({ design: { ...DEF, preset: "ink" } });
    const r = render(ui()); const u = userEvent.setup();
    await u.click(await screen.findByTestId("button-design-restore-default"));
    expect(screen.getByTestId("button-confirm-design")).toBeTruthy();
    m.scope.branchId = 3; r.rerender(ui());
    await waitFor(() => expect(screen.queryByTestId("button-confirm-design")).toBeNull());
    expect(m.patch).not.toHaveBeenCalled();
    m.scope.branchId = undefined; r.rerender(ui());
    await u.click(await screen.findByTestId("button-design-restore-default"));
    await u.click(screen.getByTestId("button-confirm-design"));
    m.settings = mk({ companyId: 6 }); r.rerender(ui());
    await act(async () => { d.reject(Object.assign(new Error("c"), { status: 409 })); await d.promise.catch(() => {}); });
    expect(m.toast.mock.calls.some(c => String(c[0].title).includes("تغيرت"))).toBe(false);
  });
});
