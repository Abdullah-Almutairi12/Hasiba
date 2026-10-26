import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {InventoryMovements} from "./inventory-movements";
const mock=vi.hoisted(()=>({options:vi.fn(),fetch:vi.fn()}));
vi.mock("@workspace/api-client-react",()=>({getWorkspaceInventoryMovementOptions:mock.options}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:{id:11,companyId:22}})}));
const options={actions:["inventory.move.receipt","inventory.move.issue","inventory.transfer.send"],
 sources:[{id:7,branchId:3,name:"مصدر مصطنع",responsibilityId:90}],
 destinations:[{id:8,branchId:4,name:"وجهة مصطنعة",responsibilityId:91}],
 products:[{id:9,name:"صنف مصطنع",sku:"SKU-FAKE"}]};
beforeEach(()=>{localStorage.clear();mock.options.mockReset().mockResolvedValue(options);mock.fetch.mockReset();vi.stubGlobal("fetch",mock.fetch);});
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
const mount=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><InventoryMovements grantId={90}/></QueryClientProvider>);
async function fill(kind="issue"){
 await screen.findByRole("option",{name:"صنف مصطنع · SKU-FAKE"});
 fireEvent.change(screen.getByLabelText("الفعل"),{target:{value:kind}});
 fireEvent.change(screen.getByLabelText("الصنف"),{target:{value:"9"}});
 fireEvent.change(screen.getByLabelText(kind==="transfer"?"مستودع المصدر":"المستودع"),{target:{value:"7"}});
 fireEvent.change(screen.getByLabelText("الكمية"),{target:{value:"2"}});
 fireEvent.change(screen.getByLabelText("السبب / مرجع المصدر"),{target:{value:"دليل مصطنع"}});
}
it("does not offer a movement to a read-only grant",async()=>{
 mock.options.mockResolvedValue({...options,actions:[],destinations:[]});mount();
 await screen.findByText("لا تملك إذن حركة هنا.");expect(screen.queryByRole("button")).toBeNull();expect(mock.fetch).not.toHaveBeenCalled();
});
it("sends no cost and uses the explicit destination grant for a cross-branch transfer",async()=>{
 mock.fetch.mockResolvedValue({ok:true,json:async()=>({moveId:12,moveIds:[12]})});mount();await fill("transfer");
 fireEvent.change(screen.getByLabelText("مستودع الوجهة المصرح به"),{target:{value:"91:8"}});
 fireEvent.click(screen.getByRole("button",{name:"تأكيد الحركة"}));
 await screen.findByText(/حركة مؤكدة #12/);
 const [url,init]=mock.fetch.mock.calls[0];expect(url).toMatch(/inventory\/transfers$/);
 expect(JSON.parse(init.body)).toEqual({productId:9,quantity:2,notes:"دليل مصطنع",fromWarehouseId:7,toWarehouseId:8,destinationResponsibilityId:91});
 expect(init.headers["X-Workspace-Responsibility"]).toBe("90");expect(init.headers["Idempotency-Key"]).toBeTruthy();
 expect(localStorage.length).toBe(0);
});
it("keeps an uncertain intent across reload and recovers exactly the same key and body",async()=>{
 mock.fetch.mockRejectedValueOnce(new Error("انقطع الرد"));const first=mount();await fill();
 fireEvent.click(screen.getByRole("button",{name:"تأكيد الحركة"}));
 await screen.findByRole("button",{name:"استعادة نتيجة المحاولة المحفوظة"});
 await waitFor(()=>expect(screen.getByRole("status").textContent).toContain("انقطع الرد"));
 const original=mock.fetch.mock.calls[0][1];first.unmount();
 mock.fetch.mockResolvedValue({ok:true,json:async()=>({moveId:13,moveIds:[13]})});mount();
 fireEvent.click(await screen.findByRole("button",{name:"استعادة نتيجة المحاولة المحفوظة"}));
 await screen.findByText(/حركة مؤكدة #13/);
 expect(mock.fetch.mock.calls[1][1].body).toBe(original.body);
 expect(mock.fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe(original.headers["Idempotency-Key"]);
 expect(localStorage.length).toBe(0);
});
it("does not send if it cannot persist the intent before the request",async()=>{
 mount();await fill();vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("التخزين غير متاح");});
 fireEvent.click(screen.getByRole("button",{name:"تأكيد الحركة"}));
 await screen.findByText(/التخزين غير متاح/);expect(mock.fetch).not.toHaveBeenCalled();
});
it("rejects subprecision quantities before persisting or sending any intent",async()=>{
 mount();await fill();fireEvent.change(screen.getByLabelText("الكمية"),{target:{value:"0.00000001"}});
 fireEvent.click(screen.getByRole("button",{name:"تأكيد الحركة"}));
 await screen.findByText(/أربع منازل/);expect(mock.fetch).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
});
