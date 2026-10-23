import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CompanySettingsTab } from "./company-settings-tab";

const m = vi.hoisted(() => ({ vatEnabled: false, mutate: vi.fn(), toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useGetPrintProfile: () => ({ data: { canEdit: true, history: [], profile: {
    companyId: 5, revision: 2, vatEnabled: m.vatEnabled, nameAr: "مؤسسة الندى", nameEn: "", vatNumber: "", crNumber: "", address: "",
    addressFields: {}, phone: "", email: "", bankName: "", bankIban: "", termsAr: "", termsEn: "", logoObjectKey: null, receiptWidths: [80] } } }),
  useUpdatePrintProfile: () => ({ mutateAsync: m.mutate, isPending: false }),
  useUploadPrintLogo: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
beforeEach(() => { m.mutate.mockReset().mockResolvedValue({}); m.toast.mockReset(); });
const mount = () => render(<QueryClientProvider client={new QueryClient()}><CompanySettingsTab /></QueryClientProvider>);

describe("CompanySettingsTab VAT/CR validation", () => {
  it("unregistered tenant saves with blank VAT/CR and 58+80 widths", async () => {
    m.vatEnabled = false; mount(); const u = userEvent.setup();
    expect((await screen.findByTestId("vat-help")).textContent).toContain("لا يفعّل التسجيل");
    await u.click(screen.getByTestId("checkbox-width-58"));
    await u.click(screen.getByTestId("button-save-company-settings"));
    await waitFor(() => expect(m.mutate).toHaveBeenCalledTimes(1));
    expect(m.mutate.mock.calls[0][0].data).toMatchObject({ revision: 2, nameAr: "مؤسسة الندى", vatNumber: "", crNumber: "", receiptWidths: [58, 80] });
  });
  it("registered tenant with blank VAT is blocked without mutation", async () => {
    m.vatEnabled = true; mount(); const u = userEvent.setup();
    expect((await screen.findByTestId("vat-help")).textContent).toContain("إلزامي");
    await u.click(screen.getByTestId("button-save-company-settings"));
    expect(m.mutate).not.toHaveBeenCalled();
    expect(m.toast.mock.calls[0][0].title).toContain("الرقم الضريبي");
  });
});
