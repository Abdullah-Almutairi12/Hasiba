import {render,screen,cleanup} from "@testing-library/react";
import {afterEach,describe,it,expect,vi} from "vitest";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {CompanyTaxPolicyPanel} from "./company-tax-policy";
const state=vi.hoisted(()=>({currentRevision:1,mode:"unified"}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{id:1,companyId:2}})}));
vi.mock("@workspace/api-client-react",()=>({
  getGetCompanyTaxPolicyQueryKey:()=>["policy"],
  getGetCompanyTaxPolicyRequestStatusQueryKey:()=>["request"],
  usePublishCompanyTaxPolicy:()=>({isPending:false}),
  useCloseCompanyTaxPolicyRequest:()=>({isPending:false}),
  useGetCompanyTaxPolicyRequestStatus:()=>({}),
  useGetCompanyTaxPolicy:()=>({data:{
    canManage:false,publishingReady:false,revision:2,
    current:{companyId:2,revision:state.currentRevision,mode:state.mode,status:"registered",
      vatNumber:"300000000000003",effectiveFrom:"2026-10-31",priceIncludesVat:true,
      productRules:[],serviceRule:{category:"standard"}},
    products:[],history:[{revision:2,effective_from:"2099-01-01",status:"not_registered"}],
    transition:{legacyUnchanged:true,historicalDocumentsUnchanged:true,missingClassifications:0},
    integration:{explanation:"لا قبول إنتاجي",productionAcceptance:false},
  }}),
}));
afterEach(()=>{cleanup();sessionStorage.clear();state.currentRevision=1;state.mode="unified";});
describe("effective legal tax identity",()=>{
  it("does not label a future revision as the currently effective print identity",()=>{
    render(<QueryClientProvider client={new QueryClient()}><CompanyTaxPolicyPanel readOnly /></QueryClientProvider>);
    expect(screen.getByTestId("text-tax-revision").textContent).toBe("1 — 2026-10-31");
    expect(screen.getByTestId("text-tax-identity-source").textContent).toContain("أحدث نسخة محفوظة: 2");
    expect(screen.getByTestId("text-tax-identity-source").textContent).toContain("موروثة لجميع فروعها");
  });
  it("names the preserved legacy baseline before a future first policy takes effect",()=>{
    state.currentRevision=0;state.mode="legacy";
    render(<QueryClientProvider client={new QueryClient()}><CompanyTaxPolicyPanel readOnly /></QueryClientProvider>);
    expect(screen.getByTestId("text-tax-identity-source").textContent).toContain("الإعداد السابق قبل سريان السياسة");
    expect(screen.getByTestId("text-tax-revision").textContent).toMatch(/^0/);
  });
});
