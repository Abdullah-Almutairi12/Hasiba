import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,describe,it,expect,vi} from "vitest";
import SalesPage from "@/pages/sales";

const state=vi.hoisted(()=>({amount:114.67,report:true,scoped:false,error:false,reads:0,mode:"إصدار الباقي"}));
vi.mock("@/hooks/use-permissions",()=>({usePermissions:()=>({
  canManageFinance:true,canManageInventory:false,canReadReports:state.report,isScoped:state.scoped,canCustomerInvoice:()=>true,
})}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{id:5,companyId:3}})}));
vi.mock("@/hooks/use-vat-status",()=>({useVatEnabled:()=>true}));
// The unit boundary acknowledges the native dialog's callback. Real posting,
// lost responses and reconciliation are covered by PostgreSQL/native evidence.
vi.mock("@/components/sales/order-invoice-dialog",()=>({
  OrderInvoiceDialog:({onSaved}:{onSaved:()=>void})=><button onClick={()=>{state.amount=344;onSaved();}}>{state.mode}</button>,
}));

describe("sales summary freshness",()=>{
  beforeEach(()=>{
    Object.assign(state,{amount:114.67,report:true,scoped:false,error:false,reads:0});
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
      const p=new URL(String(input),"http://localhost").pathname;
      if(p==="/api/sales/reports/summary"){
        state.reads++;
        return state.error?Response.json({error:"ليس لديك صلاحية"},{status:403}):Response.json({
          monthStart:"2026-10-01",quotations:{count:0,value:0,accepted:0},
          salesOrders:{count:1,value:344},invoices:{thisMonth:state.amount,outstanding:state.amount},
        });
      }
      if(p==="/api/sales/orders")return Response.json([{
        id:41,reference:"SO-FRESHNESS",customerName:"مصطنع",status:"confirmed",total:344,orderDate:"2026-10-01",
      }]);
      return Response.json([]);
    }));
  });
  const mount=()=>{
    const qc=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:Infinity}}});
    return {qc,...render(<QueryClientProvider client={qc}><SalesPage/></QueryClientProvider>)};
  };
  it.each(["إصدار الباقي","استعادة نتيجة محفوظة"])("refreshes summary and invoice cache after %s",async(mode)=>{
    state.mode=mode;
    const {qc}=mount();
    qc.setQueryData(["/sales/invoices"],[]);
    await waitFor(()=>expect(state.reads).toBe(1));
    const u=userEvent.setup();await u.click(screen.getByRole("tab",{name:"أوامر البيع"}));
    await u.click(await screen.findByRole("button",{name:"تفويتر"}));
    await u.click(await screen.findByRole("button",{name:mode}));
    await waitFor(()=>expect(screen.getByText("فواتير الشهر").parentElement!.parentElement!.textContent).toContain((344).toLocaleString("ar-SA")));
    expect(qc.getQueryState(["/sales/invoices"])?.isInvalidated).toBe(true);
  });
  it.each([{report:false,scoped:false},{report:true,scoped:true}])("never renders report amounts for restricted visibility %j",async(mode)=>{
    Object.assign(state,mode);mount();
    expect(screen.queryByText("فواتير الشهر")).toBeNull();
    expect(state.reads).toBe(0);
  });
  it("does not present forbidden or failed summary reads as a real zero",async()=>{
    state.error=true;mount();
    await waitFor(()=>expect(state.reads).toBe(1));
    await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("تعذر"));
    expect(screen.queryByText("فواتير الشهر")).toBeNull();
  });
});
