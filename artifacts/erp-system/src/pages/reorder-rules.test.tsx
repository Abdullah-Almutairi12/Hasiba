import {beforeEach,describe,it,expect,vi} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import ReorderRules from "./reorder-rules";
const state=vi.hoisted(()=>({company:1,actions:["inventory.read","inventory.reorder.manage"],get:vi.fn(),post:vi.fn()}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{id:12,companyId:state.company,role:"scoped"}})}));
vi.mock("@/lib/workspace-responsibility",()=>({useSelectedResponsibility:()=>({id:8,resource:"inventory",actions:state.actions})}));
vi.mock("@/hooks/use-api",()=>({apiGet:(...args:unknown[])=>state.get(...args)}));
vi.mock("@workspace/api-client-react",()=>({financialFetch:(...args:unknown[])=>state.post(...args),getWorkspaceResponsibility:()=>"8"}));
const rule={id:1,productId:1,productName:"صنف الاختبار",sku:"TEST",unit:"قطعة",warehouseId:1,warehouseName:"مستودع ألف",branchName:"فرع ألف",
 minQty:20,maxQty:100,eoq:0,isActive:false,alertEnabled:true,revision:2,supported:true,onHand:20,canManage:true,
 cycles:[{id:1,status:"open",quantity:"20.0000",threshold:"20.0000",evaluated_at:"2026-11-05T10:00:00Z"}]};
function mount(){const qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 const ui=<QueryClientProvider client={qc}><ReorderRules/></QueryClientProvider>;return {...render(ui),qc,ui};}
beforeEach(()=>{
 cleanup();sessionStorage.clear();state.company=1;state.actions=["inventory.read","inventory.reorder.manage"];state.get.mockReset();state.post.mockReset();
 state.get.mockImplementation(async(path:string)=>path.includes("reorder-rules")?[rule]:{products:[{id:1,nameAr:"صنف الاختبار",sku:"TEST",unit:"قطعة"}],warehouses:[{id:1,nameAr:"مستودع ألف"}]});
 state.post.mockResolvedValue(new Response(JSON.stringify({id:1}),{status:201}));
});
describe("native warehouse alert rule page",()=>{
 it("labels physical stock, unit, target limitations and cycle history; edit/disable is explicit",async()=>{
  mount();await screen.findByText(/صنف الاختبار \(TEST\)/);
  expect(screen.getByText(/الفرق عنه لا يراعي الوارد والمحجوزات/)).toBeTruthy();
  fireEvent.click(screen.getByText("تعديل / تعطيل"));
  expect(screen.getByLabelText(/تفعيل التنبيه الداخلي/)).toHaveProperty("checked",true);
  fireEvent.click(screen.getByLabelText(/تفعيل التنبيه الداخلي/));
  fireEvent.click(screen.getByText("حفظ القاعدة"));
  await waitFor(()=>expect(state.post).toHaveBeenCalledTimes(1));
  expect(JSON.parse(state.post.mock.calls[0][1].body)).toMatchObject({alertEnabled:false,revision:2,productId:1,warehouseId:1});
 });
 it("read-only responsibility sees state but never a save/edit/new action",async()=>{
  state.actions=["inventory.read"];mount();await screen.findByText(/صنف الاختبار \(TEST\)/);
  expect(screen.queryByText("قاعدة جديدة")).toBeNull();expect(screen.queryByText("تعديل / تعطيل")).toBeNull();
  expect(state.post).not.toHaveBeenCalled();
 });
 it("lost/empty response retains exact intent through reload; double click sends one concurrent request",async()=>{
  let release!:(r:Response)=>void;state.post.mockImplementationOnce(()=>new Promise<Response>(r=>release=r));
  const initial=mount();await screen.findByText("تعديل / تعطيل");fireEvent.click(screen.getByText("تعديل / تعطيل"));
  const saveButton=screen.getByText("حفظ القاعدة");
  fireEvent.click(saveButton);fireEvent.click(saveButton);
  expect(state.post).toHaveBeenCalledTimes(1);
  release(new Response(null,{status:204}));
  await screen.findByText(/لم تُحسم/);
  const original=state.post.mock.calls[0][1];initial.unmount();
  mount();await screen.findByText("التحقق من محاولة الحفظ الأصلية");
  fireEvent.click(screen.getByText("التحقق من محاولة الحفظ الأصلية"));
  await waitFor(()=>expect(state.post).toHaveBeenCalledTimes(2));
  expect(state.post.mock.calls[1][1]).toMatchObject({body:original.body,headers:original.headers});
  await screen.findByText(/حُفظت القاعدة/);
 });
 it("company switch never displays earlier rules or an earlier company's pending intent",async()=>{
  const initial=mount();await screen.findByText(/صنف الاختبار \(TEST\)/);
  state.company=2;state.get.mockImplementation(()=>new Promise(()=>{}));
  initial.rerender(<QueryClientProvider client={initial.qc}><ReorderRules/></QueryClientProvider>);
  expect(screen.queryByText(/صنف الاختبار \(TEST\)/)).toBeNull();
  expect(screen.getByText(/جارٍ تحميل حالة المخزون/)).toBeTruthy();
 });
});
