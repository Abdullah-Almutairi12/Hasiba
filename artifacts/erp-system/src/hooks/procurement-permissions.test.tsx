import {describe,it,expect,vi,beforeEach} from "vitest";
import {renderHook} from "@testing-library/react";
import {usePermissions} from "./use-permissions";
const state=vi.hoisted(()=>({role:"scoped",selected:null as any}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{role:state.role}})}));
vi.mock("@/lib/workspace-responsibility",()=>({useSelectedResponsibility:()=>state.selected}));
vi.mock("@workspace/api-client-react",()=>({
  useListPermissionMatrix:()=>({data:undefined}),getListPermissionMatrixQueryKey:()=>["permissions"],
}));
describe("native procurement action visibility",()=>{
  beforeEach(()=>{state.role="scoped";state.selected=null;});
  it("requires one selected purchasing responsibility and explicit read; an inventory/ POS role never implies purchasing",()=>{
    for(const resource of ["inventory","pos"]){
      state.selected={resource,actions:["procurement.read","procurement.orders.read","procurement.orders.approve"]};
      const {result,unmount}=renderHook(usePermissions);
      expect(result.current.canProcurement("orders.approve")).toBe(false);unmount();
    }
  });
  it("shows only explicit native actions without financial or stock rights",()=>{
    state.selected={resource:"procurement",actions:["procurement.read","procurement.suppliers.read","procurement.orders.read","procurement.orders.print"]};
    const {result}=renderHook(usePermissions);
    expect(result.current.canSee("suppliers")).toBe(true);
    expect(result.current.canSee("procurement")).toBe(true);
    expect(result.current.canProcurement("orders.print")).toBe(true);
    for(const action of ["orders.create","orders.export","orders.send","orders.approve","suppliers.edit"])
      expect(result.current.canProcurement(action)).toBe(false);
    expect(result.current.canManageFinance).toBe(false);expect(result.current.canManageInventory).toBe(false);
  });
  it("reacts to live revocation without promoting the account",()=>{
    state.selected={resource:"procurement",actions:["procurement.read","procurement.orders.read","procurement.orders.cancel"]};
    const {result,rerender}=renderHook(usePermissions);
    expect(result.current.canProcurement("orders.cancel")).toBe(true);
    state.selected={resource:"procurement",actions:[]};rerender();
    expect(result.current.canProcurement("orders.cancel")).toBe(false);
    expect(result.current.canSee("procurement")).toBe(false);
  });
});
