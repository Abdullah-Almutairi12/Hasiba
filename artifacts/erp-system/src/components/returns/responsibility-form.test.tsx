import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ResponsibilityForm } from "./responsibility-form";

const mock = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/hooks/use-returns-actions", () => ({ useAct: () => ({ run: mock.run, pending: false }) }));
vi.mock("./owner-exception", () => ({
  OwnerProof: ({onProof}:{onProof:(v:string)=>void}) => <button onClick={()=>onProof("synthetic-proof")}>تأكيد تجريبي</button>,
}));
afterEach(cleanup);

it("reconciles a server-saved responsibility arriving during submit without a second write or stale edit DOM", async () => {
  let finish!: (value: unknown) => void;
  mock.run.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const props = { session: { id:1, branch_id:3 }, employees:[], selfOwner:true };
  const view = render(<ResponsibilityForm {...props}/>);
  expect((screen.getByRole("radio",{name:"تتحملها المنشأة"}) as HTMLInputElement).checked).toBe(true);
  fireEvent.change(screen.getByLabelText("سبب القرار"), {target:{value:"سبب مصطنع"}});
  fireEvent.change(screen.getByLabelText("مرجع الأدلة"), {target:{value:"EVIDENCE-SYNTHETIC"}});
  fireEvent.click(screen.getByText("تأكيد تجريبي"));
  fireEvent.click(screen.getByText("حفظ قرار المسؤولية"));
  expect(mock.run).toHaveBeenCalledTimes(1);
  view.rerender(<ResponsibilityForm {...props} session={{...props.session, responsibility_decision:{
    id:8,decision:"company_bears",reason:"سبب مصطنع",evidence:"EVIDENCE-SYNTHETIC",decided_by:1,
    decided_at:"2026-10-25T00:00:00Z",owner_exception:true,
  }}}/>);
  await act(async () => { finish({ok:true,res:{id:8}}); });
  expect(screen.queryByRole("radio")).toBeNull();
  expect(screen.getByTestId("responsibility-1").textContent).toContain("EVIDENCE-SYNTHETIC");
  expect(screen.getByTestId("responsibility-1").textContent).toContain("لا ينشئ مديونية موظف أو خصم راتب");
  expect(mock.run).toHaveBeenCalledTimes(1);
});
