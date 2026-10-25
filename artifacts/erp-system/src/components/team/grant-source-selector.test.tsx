import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrantSourceSelector } from "./grant-source-selector";
afterEach(cleanup);
const tpl = { id: 11, name: "أمين", resource: "inventory" as const, actions: ["inventory.read", "inventory.adjust"], revision: 6 };
const base = { resource: "inventory" as const, branchId: 1, warehouseIds: [2], actions: ["inventory.read"], amountLimit: null, startsAt: null, endsAt: null };

describe("grant source selector", () => {
  it("override returns to inheritance with current revision", () => {
    const onChange = vi.fn();
    render(<GrantSourceSelector index={0} grant={{ ...base, templateId: 11, templateRevision: 4, templateMode: "override" }} templates={[tpl]} available={new Set(["inventory.read"])} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("button-grant-inherit-0"));
    expect(onChange).toHaveBeenCalledWith({ templateId: 11, templateRevision: 6, templateMode: "inherit", actions: ["inventory.read"] });
  });
  it("inherit becomes explicit override, never manual", () => {
    const onChange = vi.fn();
    render(<GrantSourceSelector index={0} grant={{ ...base, templateId: 11, templateRevision: 6, templateMode: "inherit" }} templates={[tpl]} available={new Set()} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("button-grant-override-0"));
    expect(onChange.mock.calls[0][0]).toMatchObject({ templateId: 11, templateMode: "override" });
  });
});
