import React from "react";
import {describe,it,expect,vi,afterEach} from "vitest";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {PdfPreviewSheet} from "./pdf-preview-sheet";
vi.mock("@/lib/workspace-responsibility",()=>({useSelectedResponsibility:()=>({id:73})}));
vi.mock("@workspace/api-client-react",()=>({getWorkspaceResponsibility:()=>"73"}));
const create=vi.fn(()=>"blob:invoice");
vi.stubGlobal("URL",class extends URL{static createObjectURL=create;static revokeObjectURL=vi.fn();});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe("native PDF application actions",()=>{
  it.each([[false,false],[true,false],[false,true],[true,true]])("renders print=%s export=%s independently",async(print,exported)=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,blob:async()=>new Blob(["%PDF-test"])}));
    render(<PdfPreviewSheet open onOpenChange={()=>{}} pdfUrl="/api/invoice/pdf" title="فاتورة" downloadName="invoice.pdf" allowPrint={print} allowDownload={exported}/>);
    await waitFor(()=>expect(screen.getByTestId("pdf-preview-iframe")).toBeTruthy());
    expect(!!screen.queryByTestId("button-pdf-preview-print")).toBe(print);
    expect(!!screen.queryByTestId("button-pdf-preview-download")).toBe(exported);
  });
  it("rechecks a revoked print action instead of printing previously loaded bytes",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce({ok:true,blob:async()=>new Blob(["%PDF-test"])}).mockResolvedValueOnce({ok:false,status:403});
    vi.stubGlobal("fetch",fetcher);
    render(<PdfPreviewSheet open onOpenChange={()=>{}} pdfUrl="/api/invoice/pdf" printUrl="/api/invoice/pdf" title="فاتورة" downloadName="invoice.pdf" allowDownload={false}/>);
    await waitFor(()=>expect(screen.getByTestId("pdf-preview-iframe")).toBeTruthy());
    const iframe=screen.getByTestId("pdf-preview-iframe") as HTMLIFrameElement;
    const print=vi.fn();Object.defineProperty(iframe,"contentWindow",{configurable:true,value:{focus:vi.fn(),print}});
    fireEvent.click(screen.getByTestId("button-pdf-preview-print"));
    await waitFor(()=>expect(screen.getByText(/تحقق من صلاحية الطباعة الحالية/)).toBeTruthy());
    expect(print).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[1][1].headers).toEqual({"X-Workspace-Responsibility":"73"});
  });
  it("rechecks export and does not click a download anchor after denial",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce({ok:true,blob:async()=>new Blob(["%PDF-test"])}).mockResolvedValueOnce({ok:false,status:403});
    vi.stubGlobal("fetch",fetcher);const click=vi.spyOn(HTMLAnchorElement.prototype,"click");
    render(<PdfPreviewSheet open onOpenChange={()=>{}} pdfUrl="/api/invoice/pdf?download=1" downloadUrl="/api/invoice/pdf?download=1" title="فاتورة" downloadName="invoice.pdf" allowPrint={false}/>);
    await waitFor(()=>expect(screen.getByTestId("pdf-preview-iframe")).toBeTruthy());
    fireEvent.click(screen.getByTestId("button-pdf-preview-download"));
    await waitFor(()=>expect(screen.getByText(/تحقق من صلاحية التصدير الحالية/)).toBeTruthy());
    expect(click).not.toHaveBeenCalled();
  });
});
