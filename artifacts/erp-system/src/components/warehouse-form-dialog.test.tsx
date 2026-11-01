import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  WarehouseFormDialog,
  WH_ERR_BRANCH,
  WH_ERR_FORBIDDEN,
  WH_ERR_UNKNOWN,
  describeWarehouseError,
} from "./warehouse-form-dialog";

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  useCreateWarehouse: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
  getListWarehousesQueryKey: () => ["/api/warehouses"],
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

afterEach(cleanup);
beforeEach(() => { mocks.mutateAsync.mockReset(); });

function setup(onOpenChange = vi.fn()) {
  const qc = new QueryClient();
  const inv = vi.spyOn(qc, "invalidateQueries");
  render(
    <QueryClientProvider client={qc}>
      <WarehouseFormDialog open onOpenChange={onOpenChange} branches={[{ id: 7, name: "riyadh", nameAr: "فرع الرياض" }]} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByTestId("select-warehouse-branch"), { target: { value: "7" } });
  fireEvent.change(screen.getByTestId("input-warehouse-name-ar"), { target: { value: " المستودع الرئيسي " } });
  fireEvent.change(screen.getByTestId("input-warehouse-name"), { target: { value: "Main" } });
  return { inv, onOpenChange };
}

describe("WarehouseFormDialog", () => {
  it("sends only branch and names, guards double submit, refreshes lists then closes", async () => {
    let resolve!: (v: unknown) => void;
    mocks.mutateAsync.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const { inv, onOpenChange } = setup();
    const submit = screen.getByTestId("button-warehouse-submit") as HTMLButtonElement;
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.submit(submit.closest("form")!);
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.mutateAsync.mock.calls[0][0]).toEqual({ data: { branchId: 7, name: "Main", nameAr: "المستودع الرئيسي" } });
    await waitFor(() => expect(submit.disabled).toBe(true));
    expect(screen.getByTestId("input-warehouse-name-ar").matches(":disabled")).toBe(true);
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => resolve({ id: 3 }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const keys = inv.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(["/api/warehouses"]));
    expect(keys).toContain(JSON.stringify(["/inventory/warehouse-summary"]));
  });

  it("403 shows permission error, keeps fields, stays open", async () => {
    mocks.mutateAsync.mockRejectedValue({ status: 403, data: { error: "forbidden" } });
    const { onOpenChange } = setup();
    fireEvent.click(screen.getByTestId("button-warehouse-submit"));
    expect((await screen.findByTestId("text-warehouse-error")).textContent).toBe(WH_ERR_FORBIDDEN);
    expect((screen.getByTestId("input-warehouse-name-ar") as HTMLInputElement).value).toBe(" المستودع الرئيسي ");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect((screen.getByTestId("button-warehouse-submit") as HTMLButtonElement).disabled).toBe(false);
  });

  it("network failure is reported as unknown outcome and refreshes the list", async () => {
    mocks.mutateAsync.mockRejectedValue(new TypeError("Failed to fetch"));
    const { inv } = setup();
    fireEvent.click(screen.getByTestId("button-warehouse-submit"));
    expect((await screen.findByTestId("text-warehouse-error")).textContent).toBe(WH_ERR_UNKNOWN);
    expect(WH_ERR_UNKNOWN).not.toContain("لم يُنشأ");
    expect(inv.mock.calls.some((c) => JSON.stringify(c[0]?.queryKey) === JSON.stringify(["/api/warehouses"]))).toBe(true);
    expect((screen.getByTestId("input-warehouse-name") as HTMLInputElement).value).toBe("Main");
  });
});

describe("describeWarehouseError", () => {
  it("maps statuses honestly", () => {
    expect(describeWarehouseError({ status: 404 }).message).toBe(WH_ERR_BRANCH);
    expect(describeWarehouseError({ status: 400, data: { error: "اسم المستودع مطلوب" } }).message).toBe("اسم المستودع مطلوب");
    expect(describeWarehouseError({ status: 422, data: { error: "bad" } }).unknown).toBe(false);
    expect(describeWarehouseError({ status: 500 }).unknown).toBe(true);
  });
});
