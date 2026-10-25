import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import {apiGet,apiPost,apiPatch} from "./use-api";
const state=vi.hoisted(()=>({selected:"71" as string|null,post:vi.fn()}));
vi.mock("@workspace/api-client-react",()=>({
  getWorkspaceResponsibility:()=>state.selected,WORKSPACE_RESPONSIBILITY_HEADER:"X-Workspace-Responsibility",
  financialFetch:state.post,
}));
describe("native API helpers retain workspace selector",()=>{
  const network=vi.fn();
  beforeEach(()=>{
    state.selected="71";network.mockReset();state.post.mockReset();
    network.mockImplementation(async()=>new Response("{}",{status:200}));
    state.post.mockImplementation(async()=>new Response("{}",{status:200}));
    vi.stubGlobal("fetch",network);
  });
  afterEach(()=>vi.unstubAllGlobals());
  it("forwards the selected responsibility on native supplier reads/create/edit and PO actions",async()=>{
    await apiGet("/suppliers");await apiPatch("/suppliers/1",{name:"تعديل مصطنع"});
    await apiPost("/suppliers",{name:"مورد مصطنع"});
    await apiPost("/procurement/purchase-orders/1/confirm",{});
    for(const call of [...network.mock.calls,...state.post.mock.calls])
      expect(new Headers(call[1].headers).get("X-Workspace-Responsibility")).toBe("71");
    expect(new Headers(state.post.mock.calls[0][1].headers).get("Content-Type")).toBe("application/json");
  });
  it("does not invent a selector for legacy sessions or override an explicitly supplied selector",async()=>{
    state.selected=null;await apiGet("/suppliers");
    expect(new Headers(network.mock.calls[0][1].headers).has("X-Workspace-Responsibility")).toBe(false);
    state.selected="71";await apiGet("/suppliers",{"X-Workspace-Responsibility":"72"});
    expect(new Headers(network.mock.calls[1][1].headers).get("X-Workspace-Responsibility")).toBe("72");
  });
});
