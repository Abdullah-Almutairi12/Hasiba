import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditTemplate } from "./permission-templates-panel";

const m = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  useListPermissionTemplates: () => ({ data: [] }),
  getListPermissionTemplatesQueryKey: () => ["/api/team/templates"],
  getListTeamPeopleQueryKey: () => ["/api/team/people"],
  useCreatePermissionTemplate: () => ({ mutateAsync: vi.fn() }),
  usePreviewPermissionTemplate: () => ({ mutateAsync: m.preview, isPending: false }),
  useApplyPermissionTemplate: () => ({ mutateAsync: m.apply, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
afterEach(cleanup);

const catalog = [
  { key: "inventory.read", label: "عرض", resource: "inventory", available: true },
  { key: "inventory.cost.read", label: "عرض التكلفة", resource: "inventory", available: true },
];
const tpl = { id: 3, name: "أمين", resource: "inventory" as const, actions: ["inventory.read"], revision: 2 };

describe("template edit preview", () => {
  it("previews, resets on edit, applies only with fresh digest and invalidates templates+people", async () => {
    const qc = new QueryClient();
    const inv = vi.spyOn(qc, "invalidateQueries");
    m.preview.mockResolvedValue({ digest: "a".repeat(64), effects: [{ personId: 1, name: "سارة", status: "active", grantId: 8, mode: "inherit", branchId: 1, warehouseIds: [2], amountLimit: null, beforeActions: [], afterActions: [], effectiveBefore: ["inventory.read"], effectiveAfter: ["inventory.read", "inventory.cost.read"], deniedActions: [], blocked: false }] });
    m.apply.mockResolvedValue({ ...tpl, revision: 3 });
    const onDone = vi.fn();
    render(<QueryClientProvider client={qc}><EditTemplate tpl={tpl} catalogActions={catalog} branches={[]} warehouses={[]} onDone={onDone} /></QueryClientProvider>);
    const applyBtn = () => screen.getByTestId("button-apply-template") as HTMLButtonElement;
    fireEvent.click(screen.getByTestId("checkbox-template-action-inventory.cost.read"));
    expect(applyBtn().disabled).toBe(true);
    fireEvent.click(screen.getByTestId("button-preview-template"));
    await screen.findByTestId("row-impact-8");
    expect(applyBtn().disabled).toBe(false);
    fireEvent.change(screen.getByTestId("input-edit-template-name"), { target: { value: "أمين 2" } });
    expect(screen.queryByTestId("row-impact-8")).toBeNull();
    expect(applyBtn().disabled).toBe(true);
    fireEvent.click(screen.getByTestId("button-preview-template"));
    await screen.findByTestId("row-impact-8");
    fireEvent.click(applyBtn());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(m.apply.mock.calls[0][0]).toEqual({ id: 3, data: { expectedRevision: 2, name: "أمين 2", actions: ["inventory.read", "inventory.cost.read"], digest: "a".repeat(64) } });
    const keys = inv.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(["/api/team/templates"]));
    expect(keys).toContain(JSON.stringify(["/api/team/people"]));
  });
  it("409 on apply asks for a fresh review", async () => {
    m.preview.mockResolvedValue({ digest: "d".repeat(64), effects: [] });
    m.apply.mockRejectedValue({ status: 409 });
    render(<QueryClientProvider client={new QueryClient()}><EditTemplate tpl={tpl} catalogActions={catalog} branches={[]} warehouses={[]} onDone={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(screen.getByTestId("checkbox-template-action-inventory.cost.read"));
    fireEvent.click(screen.getByTestId("button-preview-template"));
    await screen.findByTestId("state-impact-empty");
    fireEvent.click(screen.getByTestId("button-apply-template"));
    await screen.findByTestId("banner-template-conflict");
    expect((screen.getByTestId("button-apply-template") as HTMLButtonElement).disabled).toBe(true);
  });
});
