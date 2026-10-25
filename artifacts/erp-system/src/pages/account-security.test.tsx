import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildProof, proofReady, passwordProblem } from "@/lib/account-security";
import { RecoveryCodesOnce } from "./account-security";

vi.mock("@workspace/api-client-react", () => ({}));
vi.mock("@/hooks/use-auth", () => ({ ME_KEY: ["auth", "me"], useAuth: () => ({ user: null }) }));
afterEach(cleanup);

describe("account security proof rules", () => {
  it("requires the active factor only when enrolled", () => {
    expect(proofReady("pw", false, "totp", "")).toBe(true);
    expect(proofReady("pw", true, "totp", "12345")).toBe(false);
    expect(proofReady("pw", true, "totp", "123456")).toBe(true);
    expect(proofReady("", true, "totp", "123456")).toBe(false);
    expect(buildProof("pw", false, "totp", "123456")).toEqual({ currentPassword: "pw" });
    expect(buildProof("pw", true, "recovery", "AB".repeat(24))).toEqual({ currentPassword: "pw", recoveryCode: "ab".repeat(24) });
  });
  it("enforces the shared 15-character minimum", () => {
    expect(passwordProblem("a".repeat(14), "a".repeat(14))).not.toBeNull();
    expect(passwordProblem("a".repeat(15), "a".repeat(15))).toBeNull();
  });
});

describe("recovery codes are shown once", () => {
  it("dismiss stays disabled until acknowledged", () => {
    const onDismiss = vi.fn();
    render(<QueryClientProvider client={new QueryClient()}><RecoveryCodesOnce codes={["a".repeat(48)]} onDismiss={onDismiss} /></QueryClientProvider>);
    const btn = screen.getByTestId("button-dismiss-recovery-codes") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("checkbox-recovery-saved"));
    fireEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
