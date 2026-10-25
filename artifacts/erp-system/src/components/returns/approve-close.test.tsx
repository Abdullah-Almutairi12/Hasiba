import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ApproveClose } from "./actions";
const mock=vi.hoisted(()=>({run:vi.fn()}));
vi.mock("@/hooks/use-returns-actions",()=>({useAct:()=>({run:mock.run,pending:false}),useActorScope:()=>null,listScopedIntents:()=>[]}));
vi.mock("./owner-exception",()=>({OwnerProof:()=>null}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("requires a trimmed independent reason and sends the displayed settlement revision, not a responsibility decision",async()=>{
  mock.run.mockResolvedValue({ok:true,res:{status:"approved"}});
  render(<ApproveClose sessionId="7" settlementRevision="revision-synthetic"/>);
  const button=screen.getByRole("button",{name:"اعتماد الإغلاق بالفرق"});
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("تعليل المراجع المستقل"),{target:{value:"   "}});
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("تعليل المراجع المستقل"),{target:{value:"  راجعت الحركات والعد  "}});
  fireEvent.click(button);
  await waitFor(()=>expect(mock.run).toHaveBeenCalledWith("approve_close",{
    sessionId:7,settlementRevision:"revision-synthetic",reviewReason:"راجعت الحركات والعد",
  }));
});
