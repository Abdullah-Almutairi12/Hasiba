import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import TeamActivatePage from "./team-activate";

const m = vi.hoisted(() => ({ inspect: vi.fn(), accept: vi.fn(), user: null as null | { email: string } }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: m.user, isLoading: false }) }));
vi.mock("@workspace/api-client-react", () => ({
  useInspectTeamActivation: () => ({ mutateAsync: m.inspect, isPending: false }),
  useAcceptTeamActivation: () => ({ mutateAsync: m.accept, isPending: false }),
}));

describe("TeamActivatePage", () => {
  it("existing-account mode requires login as the same identity and reopening the link", async () => {
    window.history.replaceState(null, "", "/team-activate#token=tok456");
    m.inspect.mockResolvedValue({ name: "ريم", companyName: "مؤسسة النخيل", email: "reem@nakheel.sa" });
    m.accept.mockReset();
    m.user = null;
    const { unmount } = render(<TeamActivatePage />);
    const u = userEvent.setup();
    await u.click(await screen.findByTestId("tab-existing-account"));
    expect(screen.getByTestId("note-existing-login-required").textContent).toContain("افتح رابط الدعوة الأصلي");
    expect(screen.getByTestId("link-existing-login")).toBeTruthy();
    expect((screen.getByTestId("button-accept-activation") as HTMLButtonElement).disabled).toBe(true);
    unmount();
    m.user = { email: "other@x.sa" };
    window.history.replaceState(null, "", "/team-activate#token=tok456");
    render(<TeamActivatePage />);
    await u.click(await screen.findByTestId("tab-existing-account"));
    expect(screen.getByTestId("note-existing-login-required").textContent).toContain("other@x.sa");
    expect(m.accept).not.toHaveBeenCalled();
    m.user = null;
  });

  it("captures fragment token, strips it, blocks weak password, accepts strong one", async () => {
    window.history.replaceState(null, "", "/team-activate#token=tok123");
    m.inspect.mockResolvedValue({ name: "ريم", companyName: "مؤسسة النخيل", email: "reem@nakheel.sa" });
    m.accept.mockResolvedValue({ ok: true, email: "reem@nakheel.sa" });
    render(<TeamActivatePage />);
    expect(await screen.findByTestId("text-activation-company")).toBeTruthy();
    expect(screen.getByTestId("text-activation-company").textContent).toContain("مؤسسة النخيل");
    expect(window.location.hash).toBe("");
    expect(m.inspect).toHaveBeenCalledWith({ data: { token: "tok123" } });
    const u = userEvent.setup();
    await u.type(screen.getByTestId("input-activation-password"), "short");
    await u.click(screen.getByTestId("button-accept-activation"));
    expect(m.accept).not.toHaveBeenCalled();
    const strong = "Palm-Grove-Under-Blue-Sky-77";
    await u.clear(screen.getByTestId("input-activation-password"));
    await u.type(screen.getByTestId("input-activation-password"), strong);
    await u.type(screen.getByTestId("input-activation-password-confirm"), strong);
    await u.click(screen.getByTestId("button-accept-activation"));
    await waitFor(() => expect(m.accept).toHaveBeenCalledWith({ data: { token: "tok123", password: strong } }));
    expect(await screen.findByTestId("state-activation-done")).toBeTruthy();
  });
});
