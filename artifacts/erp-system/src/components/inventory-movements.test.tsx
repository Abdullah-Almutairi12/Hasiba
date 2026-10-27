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
it("receives one serial locally in the native form and sends no catalog or cost fields",async()=>{
 mock.options.mockResolvedValue({...options,products:[{...options.products[0],tracking:"serial"}],serials:[]});
 mock.fetch.mockResolvedValue({ok:true,json:async()=>({moveId:12,moveIds:[12]})});
 mount();await screen.findByRole("option",{name:"صنف مصطنع · SKU-FAKE"});
 fireEvent.change(screen.getByLabelText("الفعل"),{target:{value:"receipt"}});
 fireEvent.change(screen.getByLabelText("الصنف"),{target:{value:"9"}});
 fireEvent.change(screen.getByLabelText("المستودع"),{target:{value:"7"}});
 expect((screen.getByLabelText("الكمية") as HTMLInputElement).disabled).toBe(true);
 expect((screen.getByRole("button",{name:"تأكيد الحركة"}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText("رقم القطعة الجديدة"),{target:{value:"SN-123"}});
 fireEvent.change(screen.getByLabelText("السبب / مرجع المصدر"),{target:{value:"استلام مصطنع"}});
 fireEvent.click(screen.getByRole("button",{name:"تأكيد الحركة"}));await screen.findByText(/حركة مؤكدة #12/);
 expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toEqual({productId:9,warehouseId:7,kind:"receipt",quantity:1,serialNumber:"SN-123",notes:"استلام مصطنع"});
});
it("offers only available source serials and recovers a missing response unchanged after remount",async()=>{
 mock.options.mockResolvedValue({...options,products:[{...options.products[0],tracking:"serial"}],serials:[
  {id:31,productId:9,serialNumber:"SN-AVAILABLE",state:"in_stock",warehouseId:7},
  {id:32,productId:9,serialNumber:"SN-OTHER",state:"in_stock",warehouseId:8},
  {id:33,productId:9,serialNumber:"SN-TRANSIT",state:"in_transit",warehouseId:null}]});
 mock.fetch.mockRejectedValueOnce(new Error("lost after commit")).mockResolvedValueOnce({ok:true,json:async()=>({moveId:44,moveIds:[44]})});
 const view=mount();await screen.findByRole("option",{name:"صنف مصطنع · SKU-FAKE"});
 fireEvent.change(screen.getByLabelText("الصنف"),{target:{value:"9"}});
 fireEvent.change(screen.getByLabelText("المستودع"),{target:{value:"7"}});
 fireEvent.change(screen.getByLabelText("الفعل"),{target:{value:"issue"}});
 expect(screen.queryByRole("option",{name:/SN-OTHER|SN-TRANSIT/})).toBeNull();
 fireEvent.change(screen.getByLabelText("الرقم التسلسلي"),{target:{value:"31"}});
 fireEvent.change(screen.getByLabelText("السبب / مرجع المصدر"),{target:{value:"صرف مصطنع"}});
 fireEvent.click(screen.getByRole("button",{name:"تأكيد الحركة"}));
 await screen.findByText(/النتيجة غير مؤكدة/);
 const saved=localStorage.getItem("hasiba.inventory.movement:11:22:90");expect(saved).toBeTruthy();
 view.unmount();mount();fireEvent.click(await screen.findByRole("button",{name:"استعادة نتيجة المحاولة المحفوظة"}));
 await screen.findByText(/حركة مؤكدة #44/);
 expect(mock.fetch.mock.calls[1][1].body).toBe(mock.fetch.mock.calls[0][1].body);
 expect(mock.fetch.mock.calls[1][1].headers["Idempotency-Key"]).toBe(JSON.parse(saved!).key);
 expect(localStorage.getItem("hasiba.inventory.movement:11:22:90")).toBeNull();
});
it("creates a lot with its expiry without accepting or sending a cost",async()=>{
 mock.options.mockResolvedValue({...options,products:[{...options.products[0],tracking:"lot",unit:"pcs"}],lots:[]});
 mock.fetch.mockResolvedValue({ok:true,json:async()=>({moveId:12,moveIds:[12]})});
 mount();await fill("receipt");
 fireEvent.change(screen.getByLabelText("رقم الدفعة"),{target:{value:"LOT-AR-١"}});
 fireEvent.change(screen.getByLabelText(/تاريخ الصلاحية/),{target:{value:"2027-01-31"}});
 fireEvent.click(screen.getByRole("button",{name:"تأكيد الحركة"}));
 await screen.findByText(/حركة مؤكدة #12/);
 expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toEqual({productId:9,warehouseId:7,kind:"receipt",quantity:2,
  notes:"دليل مصطنع",lotNumber:"LOT-AR-١",expiryDate:"2027-01-31"});
});
it("shows FEFO allocation and prevents consuming the physical balance of an expired lot",async()=>{
 mock.options.mockResolvedValue({...options,products:[{...options.products[0],tracking:"lot",unit:"pcs"}],lots:[
  {id:61,productId:9,lotNumber:"منتهية",expiryDate:"2020-01-01",balances:[{warehouseId:7,quantity:"8",availableQuantity:"0"}]},
  {id:62,productId:9,lotNumber:"صالحة",expiryDate:"2030-01-01",balances:[{warehouseId:7,quantity:"3",availableQuantity:"3"}]},
 ]});
 mount();await fill("issue");expect(screen.getByText(/التخصيص المتوقع/).textContent).toContain("صالحة: 2");
 fireEvent.change(screen.getByLabelText("الدفعة"),{target:{value:"61"}});
 fireEvent.click(screen.getByRole("button",{name:"تأكيد الحركة"}));
 await screen.findByText(/الدفعة غير متاحة أو منتهية/);expect(mock.fetch).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
 expect((screen.getByRole("button",{name:"تأكيد الحركة"}) as HTMLButtonElement).disabled).toBe(true);
});
it("disables a FEFO transfer with no usable balance before submitting",async()=>{
 mock.options.mockResolvedValue({...options,products:[{...options.products[0],tracking:"lot"}],lots:[
  {id:61,productId:9,lotNumber:"منتهية",expiryDate:"2020-01-01",balances:[{warehouseId:7,quantity:"2",availableQuantity:"0"}]},
 ]});mount();await fill("transfer");
 fireEvent.change(screen.getByLabelText("مستودع الوجهة المصرح به"),{target:{value:"91:8"}});
 expect((screen.getByRole("button",{name:"تأكيد الحركة"}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByText("الرصيد المتاح للدفعات غير المنتهية غير كافٍ")).toBeTruthy();
 expect(mock.fetch).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
});
it("never blocks recovery of a saved confirmed lot intent when usable stock is now zero",async()=>{
 mock.options.mockResolvedValue({...options,products:[{...options.products[0],tracking:"lot"}],lots:[]});
 localStorage.setItem("hasiba.inventory.movement:11:22:90",JSON.stringify({key:"saved-lot-intent",transfer:false,
  body:{productId:9,warehouseId:7,kind:"issue",quantity:2,notes:"دليل محفوظ",lotId:61}}));
 mock.fetch.mockResolvedValue({ok:true,json:async()=>({moveId:12,moveIds:[12]})});mount();
 const button=await screen.findByRole("button",{name:"استعادة نتيجة المحاولة المحفوظة"});
 expect((button as HTMLButtonElement).disabled).toBe(false);fireEvent.click(button);await screen.findByText(/حركة مؤكدة #12/);
 expect(mock.fetch.mock.calls[0][1].headers["Idempotency-Key"]).toBe("saved-lot-intent");expect(localStorage.length).toBe(0);
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
it("keeps HTTP refusal until a scoped durable closure, then prefills correction with a NEW identity",async()=>{
 mock.fetch.mockResolvedValueOnce({ok:false,status:409,json:async()=>({error:"تغير رصيد المخزون"})});
 mount();await fill();fireEvent.click(screen.getByRole("button",{name:"تأكيد الحركة"}));
 await screen.findByText(/رفض الخادم/);const original=mock.fetch.mock.calls[0][1],key=original.headers["Idempotency-Key"];
 expect(screen.queryByLabelText("الكمية")).toBeNull();expect(localStorage.length).toBe(1);
 mock.fetch.mockResolvedValueOnce({ok:true,json:async()=>({state:"closed_without_execution",requestKey:key})});
 fireEvent.click(screen.getByRole("button",{name:"التحقق من المحاولة وتصحيحها أو إنهاؤها"}));
 await screen.findByText(/أُغلقت المحاولة دون تنفيذ/);
 expect((screen.getByLabelText("الكمية") as HTMLInputElement).value).toBe("2");expect(localStorage.length).toBe(0);
 expect(JSON.parse(mock.fetch.mock.calls[1][1].body)).toEqual({transfer:false,body:JSON.parse(original.body)});
 fireEvent.change(screen.getByLabelText("الكمية"),{target:{value:"1"}});
 mock.fetch.mockResolvedValueOnce({ok:true,json:async()=>({moveId:19,moveIds:[19]})});
 fireEvent.click(screen.getByRole("button",{name:"تأكيد الحركة"}));await screen.findByText(/حركة مؤكدة #19/);
 expect(mock.fetch.mock.calls[2][1].headers["Idempotency-Key"]).not.toBe(key);
 expect(JSON.parse(mock.fetch.mock.calls[2][1].body).quantity).toBe(1);
});
it("recovers a completed outcome instead of abandoning it after response loss and reload",async()=>{
 mock.fetch.mockRejectedValueOnce(Error("فقد الرد"));const first=mount();await fill();
 fireEvent.click(screen.getByRole("button",{name:"تأكيد الحركة"}));await screen.findByText(/النتيجة غير مؤكدة/);
 const original=mock.fetch.mock.calls[0][1],key=original.headers["Idempotency-Key"];first.unmount();mount();
 mock.fetch.mockResolvedValueOnce({ok:true,json:async()=>({state:"completed",requestKey:key,moveId:20,moveIds:[20]})});
 fireEvent.click(await screen.findByRole("button",{name:"التحقق من المحاولة وتصحيحها أو إنهاؤها"}));
 await screen.findByText(/حركة مؤكدة #20/);expect(localStorage.length).toBe(0);expect(mock.fetch).toHaveBeenCalledTimes(2);
 expect(mock.fetch.mock.calls[1][0]).toMatch(/movement-attempts\/close$/);
 expect(JSON.parse(mock.fetch.mock.calls[1][1].body).body).toEqual(JSON.parse(original.body));
});
it("retains exact evidence when closure is unauthorized or not a matching trusted terminal response",async()=>{
 const saved={key:"saved-attempt-test",transfer:false,body:{productId:9,warehouseId:7,quantity:2,kind:"issue",notes:"محاولة محفوظة"}};
 const text=JSON.stringify(saved);localStorage.setItem("hasiba.inventory.movement:11:22:90",text);mount();
 for(const response of [
  {ok:false,json:async()=>({error:"سحبت الصلاحية"})},
  {ok:true,json:async()=>({state:"closed_without_execution",requestKey:"wrong-key"})},
  {ok:true,json:async()=>({state:"completed",requestKey:saved.key,moveId:2,moveIds:[]})},
 ]){
  mock.fetch.mockResolvedValueOnce(response);
  fireEvent.click(await screen.findByRole("button",{name:"التحقق من المحاولة وتصحيحها أو إنهاؤها"}));
  await waitFor(()=>expect((screen.getByRole("button",{name:"التحقق من المحاولة وتصحيحها أو إنهاؤها"}) as HTMLButtonElement).disabled).toBe(false));
  expect(localStorage.getItem("hasiba.inventory.movement:11:22:90")).toBe(text);
  expect(screen.queryByLabelText("الكمية")).toBeNull();
 }
});
it("does not erase a newer saved intent from another tab while recovering the old result",async()=>{
 const saved={key:"saved-attempt-test",transfer:false,body:{productId:9,warehouseId:7,quantity:2,kind:"issue",notes:"محاولة محفوظة"}};
 localStorage.setItem("hasiba.inventory.movement:11:22:90",JSON.stringify(saved));mount();
 const other=JSON.stringify({...saved,key:"newer-attempt-test"});
 localStorage.setItem("hasiba.inventory.movement:11:22:90",other);
 mock.fetch.mockResolvedValueOnce({ok:true,json:async()=>({state:"completed",requestKey:saved.key,moveId:2,moveIds:[2]})});
 fireEvent.click(await screen.findByRole("button",{name:"التحقق من المحاولة وتصحيحها أو إنهاؤها"}));
 await screen.findByText(/تغيرت المحاولة المحفوظة في نافذة أخرى/);
 expect(localStorage.getItem("hasiba.inventory.movement:11:22:90")).toBe(other);
});
it("reports a proven execution distinctly when local cleanup fails and blocks new intent creation",async()=>{
 mock.fetch.mockResolvedValueOnce({ok:true,json:async()=>({moveId:21,moveIds:[21]})});mount();await fill();
 vi.spyOn(Storage.prototype,"removeItem").mockImplementation(()=>{throw Error("تعذر الحذف");});
 fireEvent.click(screen.getByRole("button",{name:"تأكيد الحركة"}));
 await screen.findByText(/التنفيذ مؤكد؛ تعذر إنهاء الحفظ المحلي/);
 expect(localStorage.length).toBe(1);expect(screen.queryByLabelText("الكمية")).toBeNull();
});
it("rejects subprecision quantities before persisting or sending any intent",async()=>{
 mount();await fill();fireEvent.change(screen.getByLabelText("الكمية"),{target:{value:"0.00000001"}});
 fireEvent.click(screen.getByRole("button",{name:"تأكيد الحركة"}));
 await screen.findByText(/أربع منازل/);expect(mock.fetch).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
});
it("requires an active variant, displays its unit, and resets the selection on product change",async()=>{
 mock.options.mockResolvedValue({...options,products:[{...options.products[0],unit:"قطعة",requiresVariant:true,
  variants:[{id:33,sku:"BLUE-L",attributes:{color:"أزرق",size:"L"}}]},{id:10,name:"صنف آخر",sku:"OTHER"}]});
 mock.fetch.mockResolvedValue({ok:true,json:async()=>({moveId:14,moveIds:[14]})});mount();await fill();
 expect(screen.getByText("وحدة القياس: قطعة")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"تأكيد الحركة"}));
 await screen.findByText(/اختر متغيرًا متاحًا/);expect(mock.fetch).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText("المتغير"),{target:{value:"33"}});
 fireEvent.change(screen.getByLabelText("الصنف"),{target:{value:"10"}});
 expect(screen.queryByLabelText("المتغير")).toBeNull();
 fireEvent.change(screen.getByLabelText("الصنف"),{target:{value:"9"}});
 expect((screen.getByLabelText("المتغير") as HTMLSelectElement).value).toBe("");
 fireEvent.change(screen.getByLabelText("المتغير"),{target:{value:"33"}});
 fireEvent.click(screen.getByRole("button",{name:"تأكيد الحركة"}));
 await screen.findByText(/حركة مؤكدة #14/);
 expect(JSON.parse(mock.fetch.mock.calls[0][1].body)).toMatchObject({productId:9,variantId:33,kind:"issue"});
 expect(mock.fetch.mock.calls[0][1].body).not.toMatch(/cost/i);
});
