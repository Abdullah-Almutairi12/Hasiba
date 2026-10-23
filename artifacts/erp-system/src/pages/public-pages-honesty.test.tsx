import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ar from "@/i18n/ar.json";
import en from "@/i18n/en.json";
import Login from "./login";
import Welcome from "./welcome";

const loginMock = vi.hoisted(() => vi.fn());
const langMock = vi.hoisted(() => ({ language: "ar" as "ar" | "en" }));

vi.mock("wouter", () => ({ useLocation: () => ["/login", vi.fn()] }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ login: loginMock, isLoggingIn: false, isAuthenticated: false }),
}));
vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => {
    const dict = (langMock.language === "ar" ? ar : en).login as Record<string, string>;
    return {
      language: langMock.language,
      isRTL: langMock.language === "ar",
      toggleLanguage: vi.fn(),
      t: (k: string) => (k.startsWith("login.") ? dict[k.slice(6)] ?? k : k),
    };
  },
}));

const FORBIDDEN = [
  /admin@hasba\.ai/i, /admin123/i, /demo credentials/i, /للتجربة:/,
  /NCA/, /Phase 2/i, /ZATCA[- ]certified/i, /معتمد من/, /معتمدة من/, /متصل بالهيئة/,
  /Protected by 2FA/i, /محمي بـ 2FA/, /reset link/i, /will be sent/i, /رابط الاستعادة/, /سيتم إرسال/,
  /99\.9/, /99\.8/, /99%/, /uptime/i, /جاهزية/, /\+2\.4K/, /5,000/, /24\/7/, /مرخصة/, /14h/,
];

function assertClean(text: string) {
  for (const re of FORBIDDEN) expect(text, `found ${re}`).not.toMatch(re);
}

afterEach(() => { loginMock.mockReset(); });

describe("public pages honesty", () => {
  it.each(["ar", "en"] as const)("login (%s) has no credentials or unsupported claims", (lang) => {
    langMock.language = lang;
    const { container, unmount } = render(<Login />);
    assertClean(container.textContent ?? "");
    for (const id of ["button-sso-google", "button-sso-apple"]) {
      const b = screen.getByTestId(id) as HTMLButtonElement;
      expect(b.disabled).toBe(true);
      expect(b.textContent).toContain((lang === "ar" ? ar : en).login.socialUnavailable);
    }
    const forgot = screen.getByTestId("button-forgot-password") as HTMLButtonElement;
    expect(forgot.disabled).toBe(true);
    expect(forgot.textContent).toContain((lang === "ar" ? ar : en).login.recoveryUnavailable);
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    fireEvent.click(forgot);
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
    unmount();
  });

  it("i18n login strings contain no credentials or certification claims", () => {
    assertClean(JSON.stringify(ar.login) + JSON.stringify(en.login));
  });

  it("welcome has no unsupported claims and labels dashboard as illustrative", () => {
    const { container } = render(<Welcome />);
    assertClean(container.textContent ?? "");
    expect(screen.getByTestId("text-illustrative").textContent).toMatch(/توضيحية/);
  });

  it("login form submits through the auth hook", async () => {
    langMock.language = "en";
    loginMock.mockResolvedValue(undefined);
    render(<Login />);
    fireEvent.change(screen.getByTestId("input-email"), { target: { value: " User@Co.sa " } });
    fireEvent.change(screen.getByTestId("input-password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByTestId("button-login"));
    await waitFor(() => expect(loginMock).toHaveBeenCalledWith({ email: "user@co.sa", password: "pw" }));
  });
});
