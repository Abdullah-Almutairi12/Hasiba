import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {afterEach,describe,it,expect,vi} from "vitest";
import {SettingsScopeBar,SettingsScopeProvider} from "./settings-scope";
const mocks=vi.hoisted(()=>({patch:vi.fn(async()=>({})),company:2,allowed:true}));
vi.mock("@/hooks/use-current-company",()=>({useCurrentCompany:()=>({activeCompany:{id:mocks.company}})}));
vi.mock("@/hooks/use-toast",()=>({useToast:()=>({toast:vi.fn()})}));
vi.mock("@workspace/api-client-react",()=>({
 getGetAppSettingsQueryKey:()=>["/api/settings"],
 useGetAppSettings:(params?:{branchId:number})=>({data:{scope:{companyId:mocks.company,branchId:params?.branchId??null,
  revision:params?4:8,parentRevision:8,canManage:mocks.allowed,overrides:params?{pos:["receiptCopies"]}:{},
  availableBranches:[{id:11,name:"الفرع الأول"}],history:[{revision:4,parentRevision:8,createdBy:5,createdAt:"2026-10-26"}]}}}),
 usePatchAppSettings:()=>({mutateAsync:mocks.patch,isPending:false}),
}));
function mount(){
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 return render(<QueryClientProvider client={client}><SettingsScopeProvider><SettingsScopeBar/></SettingsScopeProvider></QueryClientProvider>);
}
afterEach(()=>{cleanup();vi.restoreAllMocks();mocks.patch.mockClear();mocks.allowed=true;mocks.company=2;});
describe("Original settings company/branch scope",()=>{
 it("shows parent provenance and resets only the explicit branch keys with both version stamps",async()=>{
  mount();
  fireEvent.change(screen.getByLabelText("نطاق إعدادات الفرع"),{target:{value:"11"}});
  fireEvent.click(screen.getByRole("button",{name:"تأكيد"}));
  expect(await screen.findByText(/receiptCopies/)).toBeTruthy();
  fireEvent.click(screen.getByText("إعادة pos للموروث"));
  fireEvent.click(screen.getByRole("button",{name:"تأكيد"}));
  await waitFor(()=>expect(mocks.patch).toHaveBeenCalledWith({params:{branchId:11},
   data:{expectedCompanyId:2,expectedRevision:4,expectedParentRevision:8,reset:{pos:["receiptCopies"]}}}));
 });
 it("clears the selected branch on company changes rather than applying the old branch to the new company",async()=>{
  const view=mount();
  fireEvent.change(screen.getByLabelText("نطاق إعدادات الفرع"),{target:{value:"11"}});
  fireEvent.click(screen.getByRole("button",{name:"تأكيد"}));
  mocks.company=3;
  view.rerender(<QueryClientProvider client={new QueryClient()}><SettingsScopeProvider><SettingsScopeBar/></SettingsScopeProvider></QueryClientProvider>);
  await waitFor(()=>expect((screen.getByLabelText("نطاق إعدادات الفرع") as HTMLSelectElement).value).toBe(""));
 });
 it("does not offer branch editing or provenance details without live settings authority",()=>{
  mocks.allowed=false;mount();
  expect((screen.getByLabelText("نطاق إعدادات الفرع") as HTMLSelectElement).disabled).toBe(true);
  expect(screen.queryByText(/سجل آخر50/)).toBeNull();
  expect(mocks.patch).not.toHaveBeenCalled();
 });
});
