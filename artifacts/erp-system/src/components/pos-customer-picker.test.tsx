import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setWorkspaceResponsibility, getWorkspaceResponsibility, WORKSPACE_RESPONSIBILITY_HEADER } from "@workspace/api-client-react";
import { PosCustomerPicker } from "./pos-customer-picker";

afterEach(()=>{vi.unstubAllGlobals();setWorkspaceResponsibility(null)});
function setup(directory:boolean, rejected=false){
  const requests:Array<{url:string;grant:string|null}>=[];
  setWorkspaceResponsibility(41);
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);requests.push({url,grant:new Headers(init?.headers).get(WORKSPACE_RESPONSIBILITY_HEADER)});
    if(url.includes("/workspace/access"))return Response.json({managed:true,grants:[
      {id:41,resource:"pos",actions:["pos.read","pos.sell"]},
      ...(directory?[{id:77,resource:"sales",label:"قراءة عملاء الاختبار",actions:["sales.customers.read"]}]:[])]});
    return rejected?Response.json({error:"دليل العملاء غير ممنوح في المسؤولية الحالية"},{status:403})
      :Response.json([{id:4,name:"أمل — عميلة مصطنعة"}]);
  }));
  const onSelect=vi.fn();
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>
    <PosCustomerPicker open scope="user:company:pos41" scoped disabled={false} selected={null}
      onOpenChange={vi.fn()} onSelect={onSelect}/>
  </QueryClientProvider>);
  return{requests,onSelect};
}
it("does not infer customer directory authority from POS selling",async()=>{
  const{requests}=setup(false);
  await screen.findByText(/صلاحية البيع لا تمنح قراءة الدليل تلقائيًا/);
  expect(requests.filter(r=>r.url.includes("/customers"))).toHaveLength(0);
});
it("reads through an explicitly granted directory responsibility without changing the sale responsibility",async()=>{
  const{requests,onSelect}=setup(true),u=userEvent.setup();
  await u.click(await screen.findByTestId("pos-customer-4"));
  expect(onSelect).toHaveBeenCalledWith({id:4,name:"أمل — عميلة مصطنعة"});
  expect(requests.filter(r=>r.url.includes("/customers"))[0].grant).toBe("77");
  expect(getWorkspaceResponsibility()).toBe("41");
});
it("honors a server rejection after directory access is revoked and offers retry without selecting a customer",async()=>{
  const{requests,onSelect}=setup(true,true),u=userEvent.setup();
  await screen.findByText(/تعذر تحميل العملاء ضمن مسؤوليتك/);
  await u.click(screen.getByRole("button",{name:"إعادة المحاولة"}));
  await waitFor(()=>expect(requests.filter(r=>r.url.includes("/customers"))).toHaveLength(2));
  expect(onSelect).not.toHaveBeenCalled();
  expect(screen.queryByTestId("pos-customer-4")).toBeNull();
});
