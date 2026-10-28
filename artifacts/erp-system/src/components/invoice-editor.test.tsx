import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvoiceEditor, presetDesign, validateDesign } from "./invoice-editor";

const m = vi.hoisted(() => ({ getState: vi.fn(), save: vi.fn(), publish: vi.fn(), activate: vi.fn(), preview: vi.fn(), upload: vi.fn(), toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock("@workspace/api-client-react", () => ({
  useGetInvoiceEditorState: () => ({ mutateAsync: m.getState }),
  useSaveInvoiceEditorDraft: () => ({ mutateAsync: m.save }),
  usePublishInvoiceEditorDraft: () => ({ mutateAsync: m.publish }),
  useActivateInvoiceEditorRelease: () => ({ mutateAsync: m.activate }),
  usePreviewInvoiceEditorDraft: () => ({ mutateAsync: m.preview }),
  useUploadInvoiceTemplateLogo: () => ({ mutateAsync: m.upload, isPending: false }),
}));
const empty = { drafts: [], releases: [], revision: 3, parentRevision: 1, activeId: null, source: "legacy" };
beforeEach(() => {
  Object.values(m).forEach(f => f.mockReset());
  m.getState.mockResolvedValue(empty);
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:x");
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
});

describe("validateDesign", () => {
  it("accepts presets and rejects bad widths / margins", () => {
    const d = presetDesign("formal");
    expect(validateDesign(d)).toEqual([]);
    expect(validateDesign({ ...d, a4: { ...d.a4, widths: [20, 8, 18, 33, 21] } }).length).toBeGreaterThan(0);
    expect(validateDesign({ ...d, thermal80: { ...d.thermal80, margin: 8 } }).length).toBeGreaterThan(0);
  });
});

describe("InvoiceEditor", () => {
  it("loads scoped state, copies preset, reorders, undo/redo, saves with revision 0", async () => {
    m.save.mockResolvedValue({ id: "x", revision: 1, design: {} });
    render(<InvoiceEditor companyId={5} branchId={null} generation={0} />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId("button-copy-preset-ink"));
    expect(m.getState).toHaveBeenCalledWith({ data: { expectedCompanyId: 5, branchId: null } });
    await u.click(screen.getByTestId("button-down-a4-identity"));
    expect(screen.getByTestId("list-order-a4").textContent!.indexOf("بيانات العميل")).toBeLessThan(screen.getByTestId("list-order-a4").textContent!.indexOf("هوية المنشأة"));
    await u.click(screen.getByTestId("button-editor-undo"));
    await u.click(screen.getByTestId("button-editor-redo"));
    expect(screen.getByTestId("button-editor-publish")).toHaveProperty("disabled", true);
    await u.click(screen.getByTestId("button-editor-save"));
    await waitFor(() => expect(m.save).toHaveBeenCalledTimes(1));
    const body = m.save.mock.calls[0][0].data;
    expect(body.expectedRevision).toBe(0);
    expect(body.design.a4.order[0]).toBe("customer");
  });
  it("retries unknown-outcome save with the identical body and request id", async () => {
    m.save.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ id: "x", revision: 1 });
    render(<InvoiceEditor companyId={5} branchId={2} generation={0} />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId("button-copy-preset-formal"));
    await u.click(screen.getByTestId("button-editor-save"));
    await u.click(await screen.findByTestId("button-editor-retry-pending"));
    await waitFor(() => expect(m.save).toHaveBeenCalledTimes(2));
    expect(m.save.mock.calls[1][0]).toEqual(m.save.mock.calls[0][0]);
  });
  it("verify reloads state but keeps the same pending request for identical retry", async () => {
    m.save.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ id: "x", revision: 1 });
    render(<InvoiceEditor companyId={5} branchId={null} generation={0} />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId("button-copy-preset-simple"));
    await u.click(screen.getByTestId("button-editor-save"));
    const calls = m.getState.mock.calls.length;
    await u.click(await screen.findByTestId("button-editor-verify-pending"));
    await waitFor(() => expect(m.getState.mock.calls.length).toBe(calls + 1));
    expect(screen.getByTestId("banner-editor-pending")).toBeTruthy();
    expect(screen.getByTestId("fieldset-invoice-editor")).toHaveProperty("disabled", true);
    await u.click(screen.getByTestId("button-editor-retry-pending"));
    await waitFor(() => expect(m.save).toHaveBeenCalledTimes(2));
    expect(m.save.mock.calls[1][0]).toEqual(m.save.mock.calls[0][0]);
    await waitFor(() => expect(screen.queryByTestId("banner-editor-pending")).toBeNull());
  });
  it("ignores undo shortcut while a save is in flight", async () => {
    let resolve!: (v: unknown) => void;
    m.save.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    render(<InvoiceEditor companyId={5} branchId={null} generation={0} />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId("button-copy-preset-formal"));
    await u.type(screen.getByTestId("input-editor-name"), "س");
    await u.click(screen.getByTestId("button-editor-save"));
    (document.activeElement as HTMLElement | null)?.blur();
    await u.keyboard("{Control>}z{/Control}");
    expect((screen.getByTestId("input-editor-name") as HTMLInputElement).value.endsWith("س")).toBe(true);
    expect(screen.getByTestId("button-editor-undo")).toHaveProperty("disabled", true);
    resolve({ id: "x", revision: 1 });
  });
  it("conflict keeps local edits", async () => {
    m.save.mockRejectedValueOnce(Object.assign(new Error("rev"), { status: 409 }));
    render(<InvoiceEditor companyId={5} branchId={null} generation={0} />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId("button-copy-preset-modern"));
    await u.clear(screen.getByTestId("input-editor-name")); await u.type(screen.getByTestId("input-editor-name"), "خاص");
    await u.click(screen.getByTestId("button-editor-save"));
    await screen.findByTestId("banner-editor-conflict");
    await u.click(screen.getByTestId("button-conflict-keep"));
    expect((screen.getByTestId("input-editor-name") as HTMLInputElement).value).toBe("خاص");
  });
  it("shows revoked state on 403", async () => {
    m.getState.mockRejectedValue(Object.assign(new Error("no"), { status: 403 }));
    render(<InvoiceEditor companyId={5} branchId={null} generation={0} />);
    expect(await screen.findByTestId("invoice-editor-revoked")).toBeTruthy();
  });
  it("guards a company switch before session mutation when the merchant declines losing a draft", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<InvoiceEditor companyId={5} branchId={null} generation={0} />);
    await userEvent.setup().click(await screen.findByTestId("button-copy-preset-formal"));
    const event = new Event("hasiba:before-company-switch", { cancelable: true });
    expect(window.dispatchEvent(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
  });
});
