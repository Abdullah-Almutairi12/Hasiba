import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LegacyShiftStart } from "./legacy-shift-start";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  branches: { data: [{ id: 7, name: "opaque-branch-key", nameAr: "فرع الاختبار" }], isLoading: false, isError: false, refetch: vi.fn() },
}));
vi.mock("@workspace/api-client-react", () => ({
  useListBranches: () => mocks.branches,
  useCreatePosSession: () => ({ mutate: mocks.mutate, isPending: false }),
}));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: 1, name: "المالك" } }) }));
afterEach(cleanup);
beforeEach(() => { mocks.mutate.mockReset(); mocks.branches.isError = false; });

describe("legacy shift start requires actual authorized branch and opening cash", () => {
  it("never sends a hardcoded branch or balance; refreshes the parent only after server success", () => {
    const onOpened = vi.fn();
    render(<LegacyShiftStart onOpened={onOpened} onBack={vi.fn()} />);
    const submit = screen.getByTestId("button-legacy-open-shift") as HTMLButtonElement;
    expect(screen.getByRole("option", { name: "فرع الاختبار" })).toBeTruthy();
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("الفرع"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("رصيد النقد الافتتاحي"), { target: { value: "20" } });
    fireEvent.click(submit);
    expect(mocks.mutate.mock.calls[0][0]).toEqual({ data: { branchId: 7, cashierName: "المالك", openingCash: 20 } });
    expect(onOpened).not.toHaveBeenCalled();
    act(() => mocks.mutate.mock.calls[0][1].onSuccess({ id: 12 }));
    expect(onOpened).toHaveBeenCalledTimes(1);
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("تحديث الوردية المؤكدة"));
    expect(onOpened).toHaveBeenCalledTimes(2);
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
  });
  it("rejects negative or sub-cent cash, and does not open when branch loading failed", () => {
    render(<LegacyShiftStart onOpened={vi.fn()} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("الفرع"), { target: { value: "7" } });
    for (const value of ["-1", "20.001"]) {
      fireEvent.change(screen.getByLabelText("رصيد النقد الافتتاحي"), { target: { value } });
      expect((screen.getByTestId("button-legacy-open-shift") as HTMLButtonElement).disabled).toBe(true);
    }
    expect(mocks.mutate).not.toHaveBeenCalled();
    cleanup();
    mocks.branches.isError = true;
    render(<LegacyShiftStart onOpened={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText(/تعذر تحميل الفروع/)).toBeTruthy();
    expect((screen.getByTestId("button-legacy-open-shift") as HTMLButtonElement).disabled).toBe(true);
  });
  it("shows a server denial without claiming an open shift or losing the chosen inputs", () => {
    const onOpened = vi.fn();
    render(<LegacyShiftStart onOpened={onOpened} onBack={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("الفرع"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("رصيد النقد الافتتاحي"), { target: { value: "20" } });
    fireEvent.click(screen.getByTestId("button-legacy-open-shift"));
    act(() => mocks.mutate.mock.calls[0][1].onError(new Error("الفرع خارج النطاق")));
    expect(screen.getByText(/الفرع خارج النطاق/)).toBeTruthy();
    expect((screen.getByLabelText("الفرع") as HTMLSelectElement).value).toBe("7");
    expect((screen.getByLabelText("رصيد النقد الافتتاحي") as HTMLInputElement).value).toBe("20");
    expect(onOpened).not.toHaveBeenCalled();
  });
});
