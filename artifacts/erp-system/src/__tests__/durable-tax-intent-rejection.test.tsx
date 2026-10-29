import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDurableIntent } from "@/hooks/use-durable-intent";

const client = vi.hoisted(() => ({ close: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  getWorkspaceResponsibility: () => null,
  closeDirectInvoiceTaxPreviewIntent: client.close,
  closePosTaxPreviewIntent: client.close,
}));

type Body = Record<string, unknown>;
type Result = { id: number };
const original: Body = {
  customerId: 7, lines: [{ productId: 12, quantity: 1 }],
  taxPreviewToken: "original-preview", taxContextToken: "original-context",
};
const failure = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

afterEach(() => { cleanup(); sessionStorage.clear(); });
beforeEach(() => { client.close.mockReset(); });

describe.each([
  { endpoint: "/sales/invoices", closePath: "/sales/invoices/tax-preview/close-intent" },
  { endpoint: "/pos/orders", closePath: "/pos/tax-preview/close-intent" },
])("$endpoint quote-bound durable intent", ({ endpoint, closePath }) => {
  const mount = (send: (body: Body, key: string) => Promise<Result>) => renderHook(() =>
    useDurableIntent<Body, Result>({
      endpoint, closePath, userId: 5, companyId: 3, send,
      isValid: (r): r is Result => !!r && typeof (r as Result).id === "number",
    }));

  it.each([400, 403, 409])("retains quote-bound HTTP%s until a definitive server answer", async (status) => {
    const send = vi.fn<(body: Body, key: string) => Promise<Result>>().mockRejectedValue(failure(status));
    const h = mount(send);
    await waitFor(() => expect(h.result.current.ready).toBe(true));
    await act(async () => { await h.result.current.submit(original); });
    const saved = h.result.current.attempt;
    expect(saved).not.toBeNull();
    expect(saved!.body).toEqual(original);
    const storageBefore = sessionStorage.getItem(sessionStorage.key(0)!);
    await act(async () => { await h.result.current.submit({ ...original, taxPreviewToken: "replacement" }); });
    expect(send).toHaveBeenCalledTimes(1);
    client.close.mockRejectedValue(failure(403));
    await act(async () => { await h.result.current.close(); });
    expect(h.result.current.attempt).toEqual(saved);
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(storageBefore);
    expect(client.close).toHaveBeenCalledWith({ requestKey: saved!.key, body: original });
  });

  it("allows a new identity only after the server seals the original", async () => {
    const send = vi.fn<(body: Body, key: string) => Promise<Result>>()
      .mockRejectedValueOnce(failure(409)).mockResolvedValue({ id: 9 });
    const h = mount(send);
    await waitFor(() => expect(h.result.current.ready).toBe(true));
    await act(async () => { await h.result.current.submit(original); });
    const saved = h.result.current.attempt;
    expect(saved).not.toBeNull();
    client.close.mockResolvedValue({ state: "closed_without_execution" });
    await act(async () => { await h.result.current.close(); });
    expect(h.result.current.attempt).toBeNull();
    const replacement = { ...original, taxPreviewToken: "fresh-preview" };
    await act(async () => { await h.result.current.submit(replacement); });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toEqual(replacement);
    expect(send.mock.calls[1][1]).not.toBe(saved!.key);
  });

  it("replays the exact frozen body and identity after reload and a lost response", async () => {
    const send = vi.fn<(body: Body, key: string) => Promise<Result>>()
      .mockRejectedValueOnce(new TypeError("Synthetic reply lost after commit"))
      .mockResolvedValue({ id: 9 });
    const first = mount(send);
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(async () => { await first.result.current.submit(original); });
    const saved = first.result.current.attempt;
    first.unmount();
    const second = mount(send);
    await waitFor(() => expect(second.result.current.attempt?.key).toBe(saved!.key));
    await act(async () => { await second.result.current.recover(); });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
    expect(second.result.current.attempt).toBeNull();
  });
});
