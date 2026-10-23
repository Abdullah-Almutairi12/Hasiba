import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { intentKey, listScopedIntents, useDurableAction } from "@/hooks/use-returns-actions";

const auth = vi.hoisted(() => ({ user: { id: 11, companyId: 21 } as { id: number; companyId: number } | null }));
const mutate = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock("@workspace/api-client-react", () => ({
  useReturnAction: () => ({ mutateAsync: mutate, isPending: false }),
  getGetReturnWorkspaceQueryKey: () => ["/api/pos/returns/workspace"],
  getListPosSessionsQueryKey: () => ["/api/pos/sessions"],
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const mount = (kind: "payout" | "request" | "expense" = "payout", id = "7") =>
  renderHook(() => useDurableAction(kind, id), { wrapper });
const K = intentKey("payout", "11:21", "7");
const reject = (status: number | undefined) => Object.assign(new Error("x"), { status, data: {} });

beforeEach(() => { sessionStorage.clear(); auth.user = { id: 11, companyId: 21 }; mutate.mockReset(); });
afterEach(() => vi.restoreAllMocks());

describe("useDurableAction", () => {
  it("fails closed without HTTP when storage write is denied", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("QuotaExceeded"); });
    const { result } = mount();
    let ok = true;
    await act(async () => { ok = await result.current.send(() => ({ amount: 5 })); });
    expect(ok).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
    expect(result.current.error?.message).toMatch(/لم تُرسل/);
  });

  it("keeps same body and key after lost response and remount", async () => {
    mutate.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const first = mount();
    await act(async () => { await first.result.current.send(() => ({ amount: 5 })); });
    const sent = mutate.mock.calls[0][0].data.payload;
    first.unmount();

    const second = mount();
    expect(second.result.current.frozen).toBe(true);
    mutate.mockResolvedValueOnce({});
    const build = vi.fn(() => ({ amount: 999 }));
    await act(async () => { await second.result.current.send(build); });
    expect(build).not.toHaveBeenCalled();
    expect(mutate.mock.calls[1][0].data.payload).toEqual(sent);
    expect(sessionStorage.getItem(K)).toBeNull();
  });

  it("unlocks after a fresh first-send definitive 4xx", async () => {
    mutate.mockRejectedValueOnce(reject(422));
    const { result } = mount();
    await act(async () => { await result.current.send(() => ({ amount: 5 })); });
    expect(result.current.frozen).toBe(false);
    expect(sessionStorage.getItem(K)).toBeNull();
    expect(result.current.error?.status).toBe(422);
  });

  it("stays frozen when an unknown attempt is replayed and gets 403", async () => {
    mutate.mockRejectedValueOnce(reject(502));
    const { result } = mount();
    await act(async () => { await result.current.send(() => ({ amount: 5 })); });
    const key = mutate.mock.calls[0][0].data.payload.idempotencyKey;
    mutate.mockRejectedValueOnce(reject(403));
    await act(async () => { await result.current.send(() => ({ amount: 1 })); });
    expect(result.current.frozen).toBe(true);
    expect(mutate.mock.calls[1][0].data.payload.idempotencyKey).toBe(key);
    expect(sessionStorage.getItem(K)).not.toBeNull();
  });

  it("isolates attempts by user and company", async () => {
    mutate.mockRejectedValueOnce(reject(503));
    const a = mount();
    await act(async () => { await a.result.current.send(() => ({ amount: 5 })); });
    a.unmount();

    auth.user = { id: 12, companyId: 21 };
    expect(mount().result.current.frozen).toBe(false);
    auth.user = { id: 11, companyId: 22 };
    expect(mount().result.current.frozen).toBe(false);
    expect(listScopedIntents("12:21")).toHaveLength(0);
    expect(listScopedIntents("11:21")).toHaveLength(1);
    auth.user = { id: 11, companyId: 21 };
    expect(mount().result.current.frozen).toBe(true);
  });

  it("syncs other mounted forms when a recovery completes", async () => {
    mutate.mockRejectedValueOnce(reject(500));
    const form = mount();
    await act(async () => { await form.result.current.send(() => ({ amount: 5 })); });
    const recovery = mount();
    mutate.mockResolvedValueOnce({});
    await act(async () => { await recovery.result.current.send(() => ({})); });
    expect(form.result.current.frozen).toBe(false);
  });
});
