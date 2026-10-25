import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Page from "./account-password";

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(), reset: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  useRequestAccountPasswordReset: () => ({}),
  useResetAccountPassword: () => ({ mutateAsync: mocks.mutateAsync, reset: mocks.reset, isPending: false }),
}));
vi.mock("@/hooks/use-auth", () => ({ ME_KEY: ["auth", "me"] }));
afterEach(cleanup);
beforeEach(() => { mocks.mutateAsync.mockReset(); window.history.replaceState(null, "", "/account/password#token=" + "A".repeat(43)); });

function setup() {
  const qc = new QueryClient();
  qc.setQueryData(["auth", "me"], { id: 9, companies: [] });
  qc.setQueryData(["/api/invoices"], [{ id: 1 }]);
  render(<QueryClientProvider client={qc}><Page /></QueryClientProvider>);
  const pw = "correct horse battery staple";
  fireEvent.change(screen.getByTestId("input-reset-password"), { target: { value: pw } });
  fireEvent.change(screen.getByTestId("input-reset-password-confirm"), { target: { value: pw } });
  fireEvent.click(screen.getByTestId("button-reset-password"));
  return qc;
}

describe("password reset cache safety", () => {
  it("clears stale identity and private cache after success", async () => {
    mocks.mutateAsync.mockResolvedValue({ ok: true });
    const qc = setup();
    await screen.findByTestId("state-reset-done");
    expect(qc.getQueryData(["auth", "me"]) ?? null).toBeNull();
    expect(qc.getQueryData(["/api/invoices"])).toBeUndefined();
  });
  it("failure does not claim reset and keeps the form", async () => {
    mocks.mutateAsync.mockRejectedValue(new Error("x"));
    const qc = setup();
    await screen.findByTestId("error-reset");
    await waitFor(() => expect(screen.queryByTestId("state-reset-done")).toBeNull());
    expect(screen.getByTestId("input-reset-password")).toBeTruthy();
    expect(qc.getQueryData(["auth", "me"])).toEqual({ id: 9, companies: [] });
  });
});
