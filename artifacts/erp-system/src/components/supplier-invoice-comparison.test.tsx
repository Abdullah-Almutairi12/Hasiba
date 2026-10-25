import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SupplierInvoiceComparison } from "./supplier-invoice-comparison";
import { SupplierInvoiceDetails } from "./supplier-invoice-details";
const state = vi.hoisted(() => ({
  mutate: vi.fn(), reset: vi.fn(), data: undefined as any, isError: false,
  invoice: undefined as any, invoiceError: false,
}));
vi.mock("@workspace/api-client-react", () => ({
  usePreviewSupplierInvoiceMatch: () => ({ ...state, isPending: false }),
  useGetInvoice: () => ({ data: state.invoice, isError: state.invoiceError, isLoading: false }),
}));
afterEach(() => {
  cleanup(); vi.clearAllMocks(); state.data = undefined; state.isError = false;
  state.invoice = undefined; state.invoiceError = false;
});
describe("native supplier invoice comparison", () => {
  it("sends actual linked items and invalidates a comparison when facts change", () => {
    const { rerender } = render(<SupplierInvoiceComparison poId={9} items={[{ poLineId: 1, quantity: 100, unitPrice: 7.25 }]} />);
    fireEvent.click(screen.getByRole("button", { name: "معاينة فروق المطابقة" }));
    expect(state.mutate).toHaveBeenCalledWith({ data: { poId: 9, items: [{ poLineId: 1, quantity: 100, unitPrice: 7.25 }] } });
    rerender(<SupplierInvoiceComparison poId={9} items={[{ poLineId: 1, quantity: 80, unitPrice: 7.25 }]} />);
    expect(state.reset).toHaveBeenCalledTimes(2);
  });
  it("does not submit unmatched lines or zero quantities", () => {
    render(<SupplierInvoiceComparison poId={9} items={[{ quantity: 0, unitPrice: 7.25 }]} />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it("shows ordered/received/billed/current and differences without claiming approval", () => {
    state.data = { source: { reference: "PO-1" }, currency: "SAR", requiresReview: true,
      explanation: "هذه مقارنة وليست اعتمادًا", evidenceLimit: "رصيد مصدر حالي",
      lines: [{ id: 1, description: "كرتون", unit: "كرتون", ordered: "100", received: "80", billed: "0",
        current: "100", currentAmount: "725", messages: ["الفرق 20 كرتونًا"] }] };
    render(<SupplierInvoiceComparison poId={9} items={[{ poLineId: 1, quantity: 100, unitPrice: 7.25 }]} />);
    expect(screen.getByText("80")).toBeTruthy();
    expect(screen.getByText("المفوتر سابقًا")).toBeTruthy();
    expect(screen.getByText("الفرق 20 كرتونًا")).toBeTruthy();
    expect(screen.getByText("هذه مقارنة وليست اعتمادًا")).toBeTruthy();
  });
  it("shows permission/error state instead of a successful comparison", () => {
    state.isError = true;
    render(<SupplierInvoiceComparison poId={9} items={[{ poLineId: 1, quantity: 100, unitPrice: 7.25 }]} />);
    expect(screen.getByRole("alert").textContent).toContain("تعذرت معاينة");
  });
  it("does not create links to an untrusted supplier attachment", () => {
    state.invoice = { id: 1, invoiceNumber: "A-1", supplierName: "مورد", amount: 10, status: "pending", fileUrl: "javascript:alert(1)" };
    render(<SupplierInvoiceDetails id={1} onClose={() => {}} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("لا يوجد مرفق خاص متاح")).toBeTruthy();
  });
});
