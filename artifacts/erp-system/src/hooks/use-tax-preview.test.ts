import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTaxPreview } from "./use-tax-preview";
import { mk } from "@/lib/tax-preview.fixture";
import type { TaxPreview } from "@/lib/tax-preview";

type B = { items: number };
function deferred() { let resolve!: (v: TaxPreview) => void; const p = new Promise<TaxPreview>((r) => (resolve = r)); return { p, resolve }; }
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00Z")); });
afterEach(() => vi.useRealTimers());

describe("useTaxPreview", () => {
  it("requires a fresh explicit review after a resolved attempt even when all facts are unchanged", async () => {
    const fetcher=vi.fn().mockResolvedValue(mk());
    const {result,rerender}=renderHook(({frozen})=>useTaxPreview<B>({
      body:{items:1},fetcher,frozen,debounceMs:10,
    }),{initialProps:{frozen:false}});
    await flush(10);
    act(()=>result.current.confirm());
    expect(result.current.confirmed).toBe(true);
    rerender({frozen:true});
    await flush(10);
    expect(fetcher).toHaveBeenCalledTimes(1);
    rerender({frozen:false});
    expect(result.current.confirmed).toBe(false);
    expect(result.current.tokens()).toEqual({});
    await flush(10);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.confirmed).toBe(false);
    expect(result.current.previousReviewed).not.toBeNull();
    act(()=>result.current.confirm());
    expect(result.current.confirmed).toBe(true);
  });

  it("does not revive an old confirmation when the cart changes away and back",async()=>{
    const fetcher=vi.fn().mockImplementation((b:B)=>Promise.resolve(mk({total:115*b.items})));
    const {result,rerender}=renderHook(({body})=>useTaxPreview<B>({body,fetcher,debounceMs:10}),{initialProps:{body:{items:1}}});
    await flush(10);
    act(()=>result.current.confirm());
    rerender({body:{items:2}});
    await flush(10);
    rerender({body:{items:1}});
    await flush(10);
    expect(result.current.confirmed).toBe(false);
    expect(result.current.tokens()).toEqual({});
    expect(result.current.previousReviewed).not.toBeNull();
    act(()=>result.current.confirm());
    expect(result.current.confirmed).toBe(true);
  });

  it("ignores an out-of-order stale response and requires explicit review", async () => {
    const d1 = deferred(), d2 = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(d1.p).mockReturnValueOnce(d2.p);
    const { result, rerender } = renderHook(({ body }) => useTaxPreview<B>({ body, fetcher, debounceMs: 10 }), { initialProps: { body: { items: 1 } as B | null } });
    await flush(10);
    rerender({ body: { items: 2 } });
    await flush(10);
    await act(async () => { d2.resolve(mk({ token: "new", total: 230 })); });
    await act(async () => { d1.resolve(mk({ token: "old" })); });
    expect(result.current.preview?.previewToken).toBe("pv-new");
    expect(result.current.freshBlock).toMatch(/راجع/);
    expect(result.current.tokens()).toEqual({});
    act(() => result.current.confirm());
    expect(result.current.freshBlock).toBeNull();
    expect(result.current.tokens()).toEqual({ taxPreviewToken: "pv-new" });
  });

  it("cart change invalidates the reviewed quote and shows old/new differences", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(mk()).mockResolvedValueOnce(mk({ mode: "unified", vat: 30, total: 230 }));
    const { result, rerender } = renderHook(({ body }) => useTaxPreview<B>({ body, fetcher, debounceMs: 10 }), { initialProps: { body: { items: 1 } as B } });
    await flush(10); act(() => result.current.confirm());
    rerender({ body: { items: 2 } });
    expect(result.current.preview).toBeNull();
    expect(result.current.tokens()).toEqual({});
    await flush(10);
    expect(result.current.confirmed).toBe(false);
    expect(result.current.diffs.map((d) => d.label)).toEqual(expect.arrayContaining(["نمط الضريبة", "الإجمالي"]));
    act(() => result.current.confirm());
    expect(result.current.tokens()).toEqual({ taxPreviewToken: "pv-ctx", taxContextToken: "ctx" });
  });

  it("refreshes before expiry; keeps review only if facts are unchanged, else requires re-review", async () => {
    const exp = "2030-01-01T00:05:00Z";
    const fetcher = vi.fn().mockResolvedValueOnce(mk({ token: "a", exp })).mockResolvedValueOnce(mk({ token: "b", exp: "2030-01-01T00:10:00Z" }))
      .mockResolvedValueOnce(mk({ token: "c", vat: 0, total: 100, exp: "2030-01-01T00:15:00Z" }));
    const { result } = renderHook(() => useTaxPreview<B>({ body: { items: 1 }, fetcher, debounceMs: 10, refreshLeadMs: 1000 }));
    await flush(10); act(() => result.current.confirm());
    await flush(5 * 60_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.confirmed).toBe(true);
    expect(result.current.tokens()).toEqual({ taxPreviewToken: "pv-b" });
    await flush(5 * 60_000);
    expect(result.current.confirmed).toBe(false);
    expect(result.current.diffs.length).toBeGreaterThan(0);
  });

  it("blocks once expired without a refresh and unblocks nothing on error", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(mk({ exp: "2030-01-01T00:00:01Z" })).mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useTaxPreview<B>({ body: { items: 1 }, fetcher, debounceMs: 10, refreshLeadMs: 0 }));
    await flush(10); act(() => result.current.confirm());
    await flush(1000);
    expect(result.current.freshBlock).not.toBeNull();
    expect(result.current.tokens()).toEqual({});
  });

  it("frozen (unknown attempt) never fetches or changes state", async () => {
    const fetcher = vi.fn().mockResolvedValue(mk());
    const { result, rerender } = renderHook(({ body, frozen }) => useTaxPreview<B>({ body, fetcher, frozen, debounceMs: 10 }), { initialProps: { body: { items: 1 } as B, frozen: false } });
    await flush(10);
    const before = result.current.preview;
    rerender({ body: { items: 1 }, frozen: true });
    await flush(10 * 60_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.preview).toBe(before);
  });
});
