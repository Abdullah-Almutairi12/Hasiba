import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {render,screen,waitFor,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,describe,it,expect,vi} from "vitest";
import SalesPage from "@/pages/sales";

const state=vi.hoisted(()=>({posts:[] as Array<{path:string;body:Record<string,unknown>}>,fail:false}));
vi.mock("@/hooks/use-permissions",()=>({usePermissions:()=>({
  canManageFinance:true,canManageInventory:true,canReadReports:false,isScoped:false,canCustomerInvoice:()=>true,
})}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{id:5,companyId:3}})}));
vi.mock("@/hooks/use-vat-status",()=>({useVatEnabled:()=>true}));
const order={id:41,reference:"SO-REVIEW",customerName:"عميل مصطنع",status:"draft",total:344,
  subtotal:299.13,discount:0,vat:44.87,orderDate:"2026-10-30",currencyCode:"SAR",
  pricingBasis:{priceIncludesVat:true},appliedDiscounts:[{id:1,name:"خصم بند ثابت",amount:1,scope:"line"}],
  lines:[{id:1,description:"صنف مصطنع",quantity:3,unitPrice:115,discountPct:.2899,lineTotal:344}]};
describe("native order agreement review",()=>{
  beforeEach(()=>{
    state.posts=[];state.fail=false;
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      const path=new URL(String(input),"http://localhost").pathname;
      if(init?.method==="POST"){
        state.posts.push({path,body:JSON.parse(String(init.body))});
        return Response.json({...order,status:path.endsWith("transition")?"confirmed":"draft"});
      }
      if(path==="/api/sales/orders/41")return state.fail?Response.json({error:"تعذر قراءة الأمر"},{status:403}):Response.json(order);
      if(path==="/api/sales/orders")return Response.json([order]);
      if(path==="/api/customers")return Response.json([{id:7,name:"عميل مصطنع"}]);
      if(path==="/api/products")return Response.json([{id:9,name:"صنف مصطنع",nameAr:"صنف مصطنع",price:115}]);
      return Response.json([]);
    }));
  });
  async function mount(){
    const u=userEvent.setup();
    render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><SalesPage/></QueryClientProvider>);
    await u.click(screen.getByRole("tab",{name:"أوامر البيع"}));
    return u;
  }
  it("labels draft arithmetic as an estimate, never a confirmed server agreement",async()=>{
    const u=await mount();await u.click(screen.getByRole("button",{name:"أمر بيع جديد"}));
    expect(await screen.findByText(/تقدير الإدخال قبل قواعد الخادم/)).toBeTruthy();
    expect(screen.getByText(/لا يؤكد اتفاق السعر/)).toBeTruthy();
    expect(screen.getByRole("button",{name:"حفظ مسودة للمراجعة"})).toBeTruthy();
  });
  it("sends explicit draft status for 3×115 instead of implicitly confirming unseen rule-adjusted 344",async()=>{
    const u=await mount();await u.click(screen.getByRole("button",{name:"أمر بيع جديد"}));
    const d=within(screen.getByRole("dialog"));
    await u.click(d.getAllByRole("combobox")[0]);await u.click(await screen.findByRole("option",{name:"عميل مصطنع"}));
    await u.click(d.getAllByRole("combobox")[1]);await u.click(await screen.findByRole("option",{name:"صنف مصطنع"}));
    await u.clear(d.getByPlaceholderText("الكمية"));await u.type(d.getByPlaceholderText("الكمية"),"3");
    await u.click(d.getByRole("checkbox",{name:/أسعار الاتفاق شاملة/}));
    await u.click(d.getByRole("button",{name:/حفظ/}));
    await waitFor(()=>expect(state.posts).toHaveLength(1));
    expect(state.posts[0].body.status).toBe("draft");
    expect(state.posts[0].body.priceIncludesVat).toBe(true);
    expect(state.posts[0].body.lines).toMatchObject([{quantity:3,unitPrice:115}]);
  });
  it("requires review of persisted amount and rule sources before invoking original confirmation",async()=>{
    const u=await mount();await u.click(await screen.findByRole("button",{name:"تأكيد"}));
    const d=within(await screen.findByRole("dialog"));
    expect(await d.findByText(/خصم بند ثابت — خصم بند/)).toBeTruthy();
    expect(d.getByTestId("saved-order-total").textContent).toContain((344).toLocaleString("ar-SA"));
    expect(state.posts).toHaveLength(0);
    const confirm=d.getByRole("button",{name:"تأكيد الاتفاق المحفوظ"});
    expect(confirm.hasAttribute("disabled")).toBe(true);
    await u.click(d.getByRole("checkbox",{name:/راجعت مبلغ الخادم/}));
    await u.click(confirm);
    await waitFor(()=>expect(state.posts).toHaveLength(1));
    expect(state.posts[0]).toEqual({path:"/api/sales/orders/41/transition",body:{to:"confirmed"}});
  });
  it("fails closed when current server agreement cannot be read",async()=>{
    state.fail=true;const u=await mount();
    await u.click(await screen.findByRole("button",{name:"تأكيد"}));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(state.posts).toHaveLength(0);
    expect(screen.queryByRole("button",{name:"تأكيد الاتفاق المحفوظ"})).toBeNull();
  });
});
