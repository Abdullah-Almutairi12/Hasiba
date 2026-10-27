import {describe,it,expect,vi,beforeEach} from "vitest";
import {renderHook} from "@testing-library/react";
import {usePermissions} from "./use-permissions";
const state=vi.hoisted(()=>({role:"scoped",selected:null as any}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{role:state.role}})}));
vi.mock("@/lib/workspace-responsibility",()=>({useSelectedResponsibility:()=>state.selected}));
vi.mock("@workspace/api-client-react",()=>({useListPermissionMatrix:()=>({data:undefined}),getListPermissionMatrixQueryKey:()=>["permissions"]}));
describe("customer-invoice independent UI permissions",()=>{
  beforeEach(()=>{state.role="scoped";state.selected=null;});
  it.each([[],["sales.read"],["sales.read","sales.invoices.print"],["sales.read","sales.invoices.export"],
    ["sales.read","sales.invoices.print","sales.invoices.export"]])("requires explicit read and each separate action: %j",(...actions)=>{
    state.selected={resource:"sales",actions};
    const {result}=renderHook(()=>usePermissions());
    expect(result.current.canSee("sales")).toBe(actions.includes("sales.read"));
    expect(result.current.canCustomerInvoice("print")).toBe(actions.includes("sales.read")&&actions.includes("sales.invoices.print"));
    expect(result.current.canCustomerInvoice("export")).toBe(actions.includes("sales.read")&&actions.includes("sales.invoices.export"));
  });
  it("does not infer sales access from POS, inventory, a stale selection or an action without read",()=>{
    const {result,rerender}=renderHook(()=>usePermissions());
    for(const resource of ["pos","inventory","procurement","sales"]){
      state.selected={resource,actions:["pos.read","inventory.read","procurement.read","sales.invoices.print"]};rerender();
      expect(result.current.canCustomerInvoice("print")).toBe(false);
      expect(result.current.canCustomerInvoice("read")).toBe(false);
    }
  });
  it("keeps established legacy customer-invoice roles compatible, without making scoped a role alias",()=>{
    for(const role of ["owner","manager","accountant","sales","cashier","auditor"]){
      state.role=role;const {result,unmount}=renderHook(()=>usePermissions());
      expect(result.current.canCustomerInvoice("export")).toBe(true);unmount();
    }
  });
});
