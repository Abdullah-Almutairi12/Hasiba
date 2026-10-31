import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen,fireEvent,cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./settings";
const effective=vi.hoisted(()=>({vatNumber:"300000000000003"}));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1, companyId: 2, role: "owner" } }) }));
vi.mock("@/hooks/use-permissions", () => ({ usePermissions: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/use-current-company", () => ({ useCurrentCompany: () => ({ activeCompany: null, canSwitch: false }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useGetPrintProfile: () => ({ data: { canEdit: true, history: [], profile: {
    companyId: 2, revision: 3, nameAr: "مؤسسة الأفق", nameEn: "", vatNumber: effective.vatNumber, crNumber: "1010", address: "",
    addressFields: {}, phone: "", email: "", bankName: "", bankIban: "", termsAr: "", termsEn: "", logoObjectKey: null, receiptWidths: [80] } } }),
}));
afterEach(() => {cleanup();vi.unstubAllGlobals();effective.vatNumber="300000000000003";});

describe("/settings company tab", () => {
  it("renders the real tenant print profile with the 58/80 receipt width control", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SettingsPage /></QueryClientProvider>);
    expect(screen.getByTestId("settings-company-print-profile")).toBeTruthy();
    const w58 = await screen.findByTestId("checkbox-width-58");
    expect((w58 as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId("button-save-company-settings")).toBeTruthy();
    // Legacy global identity inputs no longer compete with the tenant profile.
    expect(screen.queryByTestId("input-company-vat")).toBeNull();
    expect(screen.getByTestId("input-company-currency")).toBeTruthy();
  });
  it("refreshes effective tax identity at the same print revision without losing unrelated edits",()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({})));
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const ui=()=> <QueryClientProvider client={client}><SettingsPage /></QueryClientProvider>;
    const view=render(ui());
    fireEvent.change(screen.getByTestId("input-company-name-ar"),{target:{value:"مسودة غير محفوظة"}});
    effective.vatNumber="300000000000013";
    view.rerender(ui());
    expect((screen.getByTestId("input-vat") as HTMLInputElement).value).toBe("300000000000013");
    expect((screen.getByTestId("input-company-name-ar") as HTMLInputElement).value).toBe("مسودة غير محفوظة");
  });
});
