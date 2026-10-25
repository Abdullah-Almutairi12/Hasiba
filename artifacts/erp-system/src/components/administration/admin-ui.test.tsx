// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AdministrationWorkspace } from "@workspace/api-client-react";
const calls=vi.hoisted(()=>({complete:vi.fn(),accept:vi.fn(),update:vi.fn(),revoke:vi.fn(),save:vi.fn(),leave:vi.fn()}));

vi.mock("@workspace/api-client-react", async (orig) => {
  const m = await orig<Record<string, unknown>>();
  const mut = () => ({ mutateAsync: vi.fn(), isPending: false });
  return { ...m, useUpdateAdministrator:()=>({mutateAsync:calls.update,isPending:false}), useSaveAdministrationHandover:()=>({mutateAsync:calls.save,isPending:false}), useRevokeCompanyMemberAccess:()=>({mutateAsync:calls.revoke,isPending:false}), useCreateTeamPerson: mut, useInviteTeamPerson: mut,
    useLeaveCompanyMembership:()=>({mutateAsync:calls.leave,isPending:false}),
    useCompleteAdministrationHandover:()=>({mutateAsync:calls.complete,isPending:false}),
    useAcceptAdministrationHandover:()=>({mutateAsync:calls.accept,isPending:false}) };
});
import { MembersPanel } from "./members-panel";
import { MembershipDeparture } from "./membership-departure";
import { HandoverComposer } from "./handover-composer";
import { IncomingCard, OutgoingCard, RecoveryCard } from "./handover-cards";
import { readAllEvidence, writeEvidence } from "./shared";

const ws = (rights: string[]): AdministrationWorkspace => ({
  userId: 1, rights, responsibilities: rights, handovers: [], notifications: [], pending: [],
  members: [{ id: 1, name: "أنا" }, { id: 2, name: "سارة", responsibilities: ["users"] }],
});
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
afterEach(()=>{cleanup();localStorage.clear();vi.clearAllMocks();});

describe("administration UI", () => {
  it("distinguishes a retained active scoped user from revoked administration",()=>{
    const value=ws(["administrators"]);
    value.members[1]={...value.members[1],role:"scoped",status:"active",active:false,responsibilities:[]};
    wrap(<MembersPanel ws={value} canManage onChanged={()=>{}}/>);
    expect(screen.getByText("دخول نشط · مستخدم مقيّد")).toBeTruthy();
    expect(screen.queryByText("غير نشط")).toBeNull();
  });
  it("member edit offers only reducing existing rights", () => {
    wrap(<MembersPanel ws={ws(["administrators", "users", "settings"])} canManage onChanged={() => {}} />);
    fireEvent.click(screen.getByTestId("button-edit-admin-2"));
    expect(screen.getByTestId("checkbox-member-right-users")).toBeTruthy();
    expect(screen.queryByTestId("checkbox-member-right-settings")).toBeNull();
  });
  it("without administrators the replacement mode is disabled and unowned responsibilities are not offered", () => {
    wrap(<HandoverComposer ws={ws(["users", "contact"])} existing={null} onClose={() => {}} onSaved={() => {}} />);
    expect((screen.getByTestId("radio-mode-replace") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("radio-mode-add").getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("checkbox-handover-right-settings")).toBeNull();
  });
  it("persists before sending, never claims early completion, and blocks a fresh finalize after remount",async()=>{
    calls.complete.mockImplementation(()=>new Promise(()=>{}));
    const h={id:"pending-admin",revision:1,state:"accepted",departure:"stay",responsibilities:["administrators"]};
    const first=wrap(<OutgoingCard h={h} userId={1} companyId={5} onChanged={()=>{}} onEdit={()=>{}} />);
    fireEvent.click(screen.getByTestId("button-finalize-pending-admin"));
    fireEvent.click(screen.getByTestId("checkbox-finalize-ack"));
    fireEvent.click(screen.getByTestId("button-confirm-finalize"));
    await waitFor(()=>expect(calls.complete).toHaveBeenCalledTimes(1));
    expect(readAllEvidence(1)[0].revision).toBe(1);
    expect(screen.queryByTestId("state-completed-pending-admin")).toBeNull();
    first.unmount();
    wrap(<OutgoingCard h={h} userId={1} companyId={5} onChanged={()=>{}} onEdit={()=>{}} />);
    expect(screen.queryByTestId("button-edit-handover-pending-admin")).toBeNull();
    fireEvent.click(screen.getByTestId("button-finalize-pending-admin"));
    fireEvent.click(screen.getByTestId("checkbox-finalize-ack"));
    fireEvent.click(screen.getByTestId("button-confirm-finalize"));
    await waitFor(()=>expect(screen.getByTestId("error-unknown-pending-admin")).toBeTruthy());
    expect(calls.complete).toHaveBeenCalledTimes(1);
  });
  it("keeps uncertain evidence after a later forbidden replay",async()=>{
    const ev={id:"unknown-admin",revision:3,departure:"terminate",at:new Date().toISOString(),companyId:5};
    writeEvidence(1,ev);
    calls.complete.mockRejectedValue(Object.assign(new Error("revoked"),{status:403}));
    wrap(<RecoveryCard ev={ev} userId={1} onDone={()=>{}} />);
    fireEvent.click(screen.getByTestId("button-replay-unknown-admin"));
    await waitFor(()=>expect(screen.getByTestId("text-recovery-message")).toBeTruthy());
    expect(readAllEvidence(1)).toEqual([ev]);
  });
  it("requires personal explicit acknowledgement and sends the displayed acceptance revision",async()=>{
    calls.accept.mockResolvedValue({});
    wrap(<IncomingCard h={{id:"incoming-admin",revision:4,state:"proposed",departure:"stay",responsibilities:["administrators"]}} onChanged={()=>{}} />);
    fireEvent.click(screen.getByTestId("button-review-accept-incoming-admin"));
    expect((screen.getByTestId("button-confirm-accept") as HTMLButtonElement).disabled).toBe(true);
    expect(calls.accept).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("checkbox-accept-ack"));
    fireEvent.click(screen.getByTestId("button-confirm-accept"));
    await waitFor(()=>expect(calls.accept).toHaveBeenCalledWith({id:"incoming-admin",data:{expectedRevision:4}}));
  });
  it("primary owner can add responsibilities directly and is protected from revocation",async()=>{
    const v={...ws(["administrators","users","settings","subscription","contact"]),isPrimaryOwner:true,primaryOwnerId:1};
    v.members[0]={...v.members[0],primary_owner:true};
    wrap(<MembersPanel ws={v} canManage onChanged={()=>{}}/>);
    expect(screen.queryByTestId("button-suspend-member-1")).toBeNull();
    fireEvent.click(screen.getByTestId("button-edit-admin-2"));
    fireEvent.click(screen.getByTestId("checkbox-member-right-settings"));
    fireEvent.click(screen.getByTestId("button-save-admin"));
    await waitFor(()=>expect(calls.update).toHaveBeenCalledWith({id:2,data:{responsibilities:["users","settings"],active:true}}));
  });
  it("member suspension requires consequence acknowledgement",async()=>{
    const v={...ws(["administrators"]),isPrimaryOwner:true,primaryOwnerId:1};
    wrap(<MembersPanel ws={v} canManage onChanged={()=>{}}/>);
    fireEvent.click(screen.getByTestId("button-terminate-member-2"));
    expect((screen.getByTestId("button-confirm-revoke") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("checkbox-revoke-ack"));
    fireEvent.click(screen.getByTestId("button-confirm-revoke"));
    await waitFor(()=>expect(calls.revoke).toHaveBeenCalledWith({id:2,data:{departure:"terminate"}}));
  });
  it("owner transfer sends all five responsibilities with ownerTransfer",async()=>{
    const v={...ws(["administrators","users","settings","subscription","contact"]),isPrimaryOwner:true};
    wrap(<HandoverComposer ws={v} existing={null} ownerTransfer onClose={()=>{}} onSaved={()=>{}}/>);
    expect(screen.getByTestId("notice-owner-transfer")).toBeTruthy();
    expect(screen.queryByTestId("radio-mode-add")).toBeNull();
    fireEvent.click(screen.getByTestId("radio-candidate-user-2"));
    fireEvent.click(screen.getByTestId("checkbox-departure-ack"));
    fireEvent.click(screen.getByTestId("button-save-handover"));
    await waitFor(()=>expect(calls.save).toHaveBeenCalled());
    const data=calls.save.mock.calls[0][0].data;
    expect(data.ownerTransfer).toBe(true);
    expect([...data.responsibilities].sort()).toEqual(["administrators","contact","settings","subscription","users"]);
    expect(data.departure).toBe("stay");
  });
  it("ordinary self-departure is explicit, scoped by the server and acknowledges each choice",async()=>{
    calls.leave.mockResolvedValue({ok:true});
    wrap(<MembershipDeparture primary={false}/>);
    expect((screen.getByTestId("button-self-departure") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("checkbox-self-departure-ack"));
    fireEvent.change(screen.getByTestId("select-self-departure"),{target:{value:"suspend"}});
    expect((screen.getByTestId("button-self-departure") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("checkbox-self-departure-ack"));
    fireEvent.click(screen.getByTestId("button-self-departure"));
    await waitFor(()=>expect(calls.leave).toHaveBeenCalledWith({data:{acknowledge:true,departure:"suspend"}}));
  });
  it("primary owner cannot use ordinary self-departure even while other administrators exist",()=>{
    wrap(<MembershipDeparture primary/>);
    expect(screen.getByTestId("state-primary-cannot-leave")).toBeTruthy();
    expect(screen.queryByTestId("button-self-departure")).toBeNull();
  });
});
