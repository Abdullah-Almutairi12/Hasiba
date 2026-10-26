import {describe,it,expect,vi,beforeEach,afterEach} from "vitest";
import {render,screen,fireEvent,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {ProcurementReceivingPolicy} from "./procurement-receiving-policy";
import {apiGet} from "@/hooks/use-api";
vi.mock("@/hooks/use-api",()=>({apiGet:vi.fn()}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{companyId:17}})}));
beforeEach(()=>{vi.resetAllMocks();vi.mocked(apiGet).mockResolvedValue({allowCreator:false,revision:0});});
afterEach(()=>vi.unstubAllGlobals());
function mount(kind:"procurement"|"stocktake"="procurement"){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const view=render(<QueryClientProvider client={client}><ProcurementReceivingPolicy kind={kind}/></QueryClientProvider>);
  return {client,...view};
}
describe("company purchase receiving policy",()=>{
  it("does not expose administrative controls when settings authority is denied",async()=>{
    vi.mocked(apiGet).mockRejectedValue(new Error("مسؤولية الإعدادات غير ممنوحة"));
    mount();await screen.findByRole("alert");
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("requires confirmation, displays the saved state and clears proof without caching credentials",async()=>{
    const request=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>{
      vi.mocked(apiGet).mockResolvedValue({allowCreator:true,revision:1});
      return new Response(JSON.stringify({allowCreator:true,revision:1}),{status:200});
    });vi.stubGlobal("fetch",request);
    const {client}=mount();
    const checkbox=await screen.findByRole("checkbox");
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    fireEvent.click(checkbox);
    const button=screen.getByRole("button",{name:"تأكيد الهوية وحفظ سياسة الاستلام"});
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("كلمة مرور حسابك لتأكيد الهوية"),{target:{value:"isolated account proof"}});
    fireEvent.click(button);
    await screen.findByText("حُفظت سياسة المنشأة مع تأكيد الهوية وتدقيق التغيير.");
    expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toMatchObject({allowCreator:true,revision:0});
    expect((screen.getByLabelText("كلمة مرور حسابك لتأكيد الهوية") as HTMLInputElement).value).toBe("");
    await waitFor(()=>expect(client.getQueryData(["procurement-receiving-policy",17])).toEqual({allowCreator:true,revision:1}));
  });
  it("does not claim activation after rejected identity proof",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({error:"تعذر تأكيد الهوية"}),{status:401})));
    const {client}=mount();fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("كلمة مرور حسابك لتأكيد الهوية"),{target:{value:"rejected isolated proof"}});
    fireEvent.click(screen.getByRole("button",{name:"تأكيد الهوية وحفظ سياسة الاستلام"}));
    await screen.findByText("تعذر تأكيد الهوية");
    expect(client.getQueryData(["procurement-receiving-policy",17])).toEqual({allowCreator:false,revision:0});
    expect((screen.getByLabelText("كلمة مرور حسابك لتأكيد الهوية") as HTMLInputElement).value).toBe("");
  });
  it("keeps stocktake exception off until reason, identity proof and successful policy response, without changing the purchase policy cache",async()=>{
    vi.mocked(apiGet).mockResolvedValue({allowParticipant:false,revision:0});
    const request=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>{
      vi.mocked(apiGet).mockResolvedValue({allowParticipant:true,revision:1});
      return new Response(JSON.stringify({allowParticipant:true,revision:1}),{status:200});
    });vi.stubGlobal("fetch",request);
    const {client}=mount("stocktake");
    fireEvent.click(await screen.findByRole("checkbox"));
    const button=screen.getByRole("button",{name:"تأكيد الهوية وحفظ سياسة الجرد"});
    fireEvent.change(screen.getByLabelText("كلمة مرور حسابك لتأكيد الهوية"),{target:{value:"isolated proof"}});
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("سبب تغيير سياسة الجرد"),{target:{value:"تشغيل منشأة مصطنعة"}});
    fireEvent.click(button);
    await screen.findByText("حُفظت سياسة المنشأة مع تأكيد الهوية وتدقيق التغيير.");
    expect(String(request.mock.calls[0][0])).toContain("/team/stocktake-policy");
    expect(JSON.parse(request.mock.calls[0][1]!.body as string)).toMatchObject({
      allowParticipant:true,revision:0,reason:"تشغيل منشأة مصطنعة"});
    await waitFor(()=>expect(client.getQueryData(["stocktake-separation-policy",17])).toEqual({allowParticipant:true,revision:1}));
    expect(client.getQueryData(["procurement-receiving-policy",17])).toBeUndefined();
    expect((screen.getByLabelText("كلمة مرور حسابك لتأكيد الهوية") as HTMLInputElement).value).toBe("");
  });
  it("does not claim a stocktake exception is active after a failed identity confirmation",async()=>{
    vi.mocked(apiGet).mockResolvedValue({allowParticipant:false,revision:0});
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({error:"تعذر تأكيد الهوية"}),{status:401})));
    const {client}=mount("stocktake");fireEvent.click(await screen.findByRole("checkbox"));
    fireEvent.change(screen.getByLabelText("كلمة مرور حسابك لتأكيد الهوية"),{target:{value:"isolated rejected proof"}});
    fireEvent.change(screen.getByLabelText("سبب تغيير سياسة الجرد"),{target:{value:"تغيير مصطنع"}});
    fireEvent.click(screen.getByRole("button",{name:"تأكيد الهوية وحفظ سياسة الجرد"}));
    await screen.findByText("تعذر تأكيد الهوية");
    expect(client.getQueryData(["stocktake-separation-policy",17])).toEqual({allowParticipant:false,revision:0});
  });
});
