import { StrictMode } from "react";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ME_KEY, useAuth } from "./use-auth";
import { passwordProblem } from "@/lib/account-security";

vi.mock("@/lib/query-client", () => ({ setActiveCompanyKey: vi.fn() }));
vi.mock("@/lib/workspace-responsibility", () => ({ syncWorkspaceIdentity: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({ useRequestAccountPasswordReset: () => ({}), useResetAccountPassword: () => ({ isPending: false }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function reply(body: unknown) { return { ok: true, json: async () => body } as Response; }

describe("login with pending second factor", () => {
  it("never populates auth/me or keeps operational cache or password variables", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["/api/invoices"], [{ id: 1 }]);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => reply(String(url).endsWith("/auth/login") ? { mfaRequired: true } : null)));
    const { result } = renderHook(() => useAuth(), { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    let r: unknown;
    await act(async () => { r = await result.current.login({ email: "a@b.sa", password: "secret-password-x" }); });
    expect(r).toEqual({ mfaRequired: true });
    expect(qc.getQueryData(ME_KEY) ?? null).toBeNull();
    expect(qc.getQueryData(["/api/invoices"])).toBeUndefined();
    expect(result.current.isAuthenticated).toBe(false);
    const leaked = qc.getMutationCache().getAll().some((m) => JSON.stringify(m.state.variables ?? null).includes("secret-password-x"));
    expect(leaked).toBe(false);
  });
});

describe("password length counts code points", () => {
  it("treats astral characters as one", () => {
    expect(passwordProblem("\u{1F600}".repeat(14), "\u{1F600}".repeat(14))).not.toBeNull();
    expect(passwordProblem("\u{1F600}".repeat(15), "\u{1F600}".repeat(15))).toBeNull();
    expect(passwordProblem("a".repeat(1025), "a".repeat(1025))).not.toBeNull();
  });
});

describe("reset token fragment under StrictMode", () => {
  it("keeps the token after the fragment is removed", async () => {
    const { default: Page } = await import("@/pages/account-password");
    window.history.replaceState(null, "", "/account/password#token=" + "A".repeat(43));
    render(<StrictMode><QueryClientProvider client={new QueryClient()}><Page /></QueryClientProvider></StrictMode>);
    expect(window.location.hash).toBe("");
    expect(screen.getByTestId("input-reset-password")).toBeTruthy();
  });
});
