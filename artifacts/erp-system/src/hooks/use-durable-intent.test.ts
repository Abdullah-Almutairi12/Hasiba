import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDurableIntent } from "./use-durable-intent";
import { intentStorageKey } from "@/lib/durable-intent";

type R = { id: number };
const isValid = (r: unknown): r is R => !!r && Number.isInteger((r as R).id);
const SK = intentStorageKey("/pos/orders", 11, 21);
const body = { sessionId: 9, items: [{ productId: 5, quantity: 1 }], taxPreviewToken: "pv-1" };
function setup(send: (b: Record<string, unknown>, k: string) => Promise<R>) {
  return renderHook(() => useDurableIntent<Record<string, unknown>, R>({ endpoint: "/pos/orders", closePath: "/pos/tax-preview/close-intent", userId: 11, companyId: 21, send, isValid }));
}
beforeEach(() => sessionStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("useDurableIntent", () => {
  it("saves the exact body before sending, keeps it on unknown, and replays it after reload with the same key", async () => {
    const seen: Array<{ b: unknown; k: string; stored: string | null }> = [];
    const send = vi.fn(async (b: Record<string, unknown>, k: string) => { seen.push({ b, k, stored: sessionStorage.getItem(SK) }); if (seen.length === 1) throw new TypeError("lost"); return { id: 7 }; });
    const first = setup(send);
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    await act(async () => { expect((await first.result.current.submit(body))?.kind).toBe("unknown"); });
    expect(JSON.parse(seen[0].stored!).body).toEqual(body);
    first.unmount();
    const again = setup(send);
    await waitFor(() => expect(again.result.current.attempt?.key).toBe(seen[0].k));
    // A fresh submit can never replace the unknown intent.
    await act(async () => { expect(await again.result.current.submit({ ...body, taxPreviewToken: "pv-NEW" })).toBeNull(); });
    await act(async () => { expect((await again.result.current.recover())?.kind).toBe("created"); });
    expect(seen[1]).toMatchObject({ b: body, k: seen[0].k });
    expect(sessionStorage.getItem(SK)).toBeNull();
  });

  it("a 4xx on recovery or a 403/network on close retains evidence; a newer key is never erased", async () => {
    const send = vi.fn().mockRejectedValueOnce(new TypeError("lost")).mockRejectedValueOnce(Object.assign(new Error("forbidden"), { status: 403 }));
    const h = setup(send);
    await waitFor(() => expect(h.result.current.ready).toBe(true));
    await act(async () => { await h.result.current.submit(body); });
    await act(async () => { await h.result.current.recover(); });
    expect(h.result.current.recoveryRejected).toBe(true);
    expect(sessionStorage.getItem(SK)).not.toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "x" }, { status: 403 })));
    await act(async () => { expect(await h.result.current.close()).toBeNull(); });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    await act(async () => { expect(await h.result.current.close()).toBeNull(); });
    expect(h.result.current.attempt).not.toBeNull();
    // Another tab copy replaced storage with a newer intent: a definite close must not erase it.
    const newer = { ...JSON.parse(sessionStorage.getItem(SK)!), key: "newer-intent-key-1" };
    sessionStorage.setItem(SK, JSON.stringify(newer));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ state: "closed_without_execution" })));
    await act(async () => { expect((await h.result.current.close())?.kind).toBe("closed"); });
    expect(JSON.parse(sessionStorage.getItem(SK)!).key).toBe("newer-intent-key-1");
  });

  it("close posts {requestKey, exact body} and returns a completed original result", async () => {
    const h = setup(vi.fn().mockRejectedValue(new TypeError("lost")));
    await waitFor(() => expect(h.result.current.ready).toBe(true));
    await act(async () => { await h.result.current.submit(body); });
    const key = h.result.current.attempt!.key;
    const fetchMock = vi.fn(async () => Response.json({ state: "completed", result: { id: 41 } }));
    vi.stubGlobal("fetch", fetchMock);
    let out: unknown;
    await act(async () => { out = await h.result.current.close(); });
    expect(out).toEqual({ kind: "completed", result: { id: 41 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/pos\/tax-preview\/close-intent$/);
    expect(JSON.parse(String(init.body))).toEqual({ requestKey: key, body });
    expect(sessionStorage.getItem(SK)).toBeNull();
  });

  it("never persists manager credentials; recovery requires re-entry and resends them last", async () => {
    const sent: unknown[] = [];
    const send = vi.fn(async (b: Record<string, unknown>) => { sent.push(b); if (sent.length === 1) throw new TypeError("lost"); return { id: 3 }; });
    const first = setup(send);
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    const mo = { email: "m@x.sa", password: "s3cret" };
    await act(async () => { await first.result.current.submit(body, { secrets: { managerOverride: mo }, secretHints: { managerEmail: mo.email } }); });
    expect(sessionStorage.getItem(SK)).not.toContain("s3cret");
    first.unmount();
    const again = setup(send);
    await waitFor(() => expect(again.result.current.attempt).not.toBeNull());
    expect(again.result.current.needsSecrets).toBe(true);
    await act(async () => { expect(await again.result.current.recover()).toBeNull(); });
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => { await again.result.current.recover({ managerOverride: mo }); });
    expect(JSON.stringify(sent[1])).toBe(JSON.stringify(sent[0]));
  });
});
