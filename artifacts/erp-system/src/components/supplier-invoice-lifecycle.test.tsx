import {afterEach,describe,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {SupplierInvoiceDraftDialog} from "./supplier-invoice-draft";
import {SupplierInvoiceActions} from "./supplier-invoice-actions";
import type {Invoice,SupplierInvoiceEvidence} from "@workspace/api-client-react";

const state=vi.hoisted(()=>({
  grant:null as null|{resource:string;actions:string[]},create:vi.fn(),update:vi.fn(),process:vi.fn(),
  options:{suppliers:[{id:1,name:"مورد اختبار"}],branches:[{id:2,name:"فرع اختبار"}],
    accounts:[{id:3,name:"مصروف اختبار"}],orders:[] as any[]},
}));
vi.mock("@workspace/api-client-react",()=>({
  createSupplierInvoiceDraft:state.create,updateSupplierInvoiceDraft:state.update,processSupplierInvoice:state.process,
  useGetSupplierInvoiceDraftOptions:()=>({data:state.options,isLoading:false,isError:false}),
}));
vi.mock("@/lib/workspace-responsibility",()=>({useSelectedResponsibility:()=>state.grant}));
const invoice:Invoice={id:8,invoiceNumber:"مورد-8",supplierName:"مورد اختبار",supplierId:1,branchId:2,
  amount:100,status:"draft",lifecycleVersion:1,invoiceKind:"expense",invoiceDate:"2026-10-26",
  createdAt:"2026-10-26T00:00:00Z"};
const evidence:SupplierInvoiceEvidence={version:1,poId:null,historicalLimit:null,lines:[
  {id:9,position:0,description:"مصروف فعلي",quantity:"2.000000",unitPrice:"50.000000",
    sourceTotal:"100.000000",netAmount:"100.000000",unit:"piece",productId:null,poLineId:null,taxRate:0},
]};
function show(node:React.ReactNode){
  return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}>{node}</QueryClientProvider>);
}
function fill(){
  fireEvent.change(screen.getByLabelText("رقم فاتورة المورد"),{target:{value:"اختبار-10"}});
  fireEvent.change(screen.getByLabelText("المورد"),{target:{value:"1"}});
  fireEvent.change(screen.getByLabelText("فرع الفاتورة"),{target:{value:"2"}});
  fireEvent.change(screen.getByLabelText("حساب المصروف / فرق السعر"),{target:{value:"3"}});
  fireEvent.change(screen.getByLabelText("وصف البند 1"),{target:{value:"مصروف فعلي"}});
  fireEvent.change(screen.getByLabelText("الكمية 1"),{target:{value:"2"}});
  fireEvent.change(screen.getByLabelText("سعر الوحدة 1"),{target:{value:"50"}});
}
afterEach(()=>{cleanup();vi.clearAllMocks();state.grant=null;state.options.orders=[];});
describe("native controlled supplier invoice interfaces",()=>{
  it("does not show financial actions to a read-only responsibility or an unprivileged legacy reader",()=>{
    state.grant={resource:"procurement",actions:["procurement.invoices.read"]};
    const view=show(<SupplierInvoiceActions invoice={invoice} evidence={evidence}/>);
    expect(screen.queryByRole("button")).toBeNull();
    state.grant=null;view.rerender(<QueryClientProvider client={new QueryClient()}>
      <SupplierInvoiceActions invoice={invoice} evidence={evidence}/></QueryClientProvider>);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("uses separate review and submit actions and never advertises a payment operation",()=>{
    state.grant={resource:"procurement",actions:["procurement.invoices.review","procurement.invoices.submit"]};
    show(<SupplierInvoiceActions invoice={invoice} evidence={evidence}/>);
    expect((screen.getByRole("button",{name:"تقديم للاعتماد"}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button",{name:"مراجعة الفاتورة"})).toBeTruthy();
    expect(screen.queryByRole("button",{name:/دفع|صرف|ترحيل/})).toBeNull();
  });
  it("recovers a post whose response was lost with the exact same operation identity",async()=>{
    state.grant={resource:"procurement",actions:["procurement.invoices.post"]};
    state.process.mockRejectedValueOnce(new TypeError("انقطع الرد")).mockResolvedValueOnce({id:8,status:"done"});
    show(<SupplierInvoiceActions invoice={{...invoice,status:"approved"}} evidence={evidence}/>);
    fireEvent.click(screen.getByRole("button",{name:"ترحيل الفاتورة"}));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button",{name:"ترحيل الفاتورة"}));
    await screen.findByRole("status");
    expect(state.process).toHaveBeenCalledTimes(2);
    expect(state.process.mock.calls[1]).toEqual(state.process.mock.calls[0]);
    expect(state.process.mock.calls[0][1]).toEqual({action:"post"});
  });
  it("creates an original invoice draft without a scanner and freezes ambiguous saves until recovery",async()=>{
    const saved=vi.fn();
    state.create.mockRejectedValueOnce(new TypeError("فقد الرد")).mockResolvedValueOnce({id:45,status:"draft"});
    show(<SupplierInvoiceDraftDialog allowed onSaved={saved}/>);
    fireEvent.click(screen.getByRole("button",{name:"إنشاء مسودة فاتورة مورد"}));fill();
    fireEvent.click(screen.getByRole("button",{name:"حفظ المسودة"}));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("رقم فاتورة المورد").closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"استرجاع نتيجة محاولة الحفظ"}));
    await waitFor(()=>expect(saved).toHaveBeenCalledWith(45));
    expect(state.create.mock.calls[1]).toEqual(state.create.mock.calls[0]);
    expect(state.create.mock.calls[0][0].items[0]).toMatchObject({description:"مصروف فعلي",quantity:2,unitPrice:50});
    expect(state.create.mock.calls[0][0]).not.toHaveProperty("amount");
  });
  it("keeps source prices absent instead of representing a hidden price as zero",async()=>{
    state.options.orders=[{id:7,reference:"PO-7",supplierId:1,branchId:2,referenceOnly:true,
      lines:[{id:9,description:"خدمة جزئية",unit:"piece",productId:null}]}];
    show(<SupplierInvoiceDraftDialog allowed/>);
    fireEvent.click(screen.getByRole("button",{name:"إنشاء مسودة فاتورة مورد"}));
    fireEvent.change(screen.getByLabelText("مرجع أمر الشراء"),{target:{value:"7"}});
    expect((screen.getByLabelText("سعر الوحدة 1") as HTMLInputElement).value).toBe("");
    expect(screen.getByText(/أسعار وكميات أمر الشراء الكاملة محجوبة/)).toBeTruthy();
    expect(state.create).not.toHaveBeenCalled();
  });
});
