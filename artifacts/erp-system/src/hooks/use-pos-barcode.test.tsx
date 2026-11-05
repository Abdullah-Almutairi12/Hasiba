import {act,renderHook} from "@testing-library/react";
import {afterEach,describe,it,expect,vi} from "vitest";
import {usePosBarcode} from "./use-pos-barcode";
import {lookupPosBarcode,type Product} from "@workspace/api-client-react";
vi.mock("@workspace/api-client-react",()=>({lookupPosBarcode:vi.fn()}));
const lookup=vi.mocked(lookupPosBarcode);
const p={id:91,nameAr:"أرز",sku:"P91",price:12} as Product;
const deferred=()=>{let resolve!:(p:Product)=>void;const promise=new Promise<Product>(r=>resolve=r);return {promise,resolve};};
describe("POS barcode exact per-scan lifecycle",()=>{
  afterEach(()=>vi.useRealTimers());
  it("retains a rejected scan and retries that unit exactly once",async()=>{
    lookup.mockReset().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(p);
    const add=vi.fn(),h=renderHook(()=>usePosBarcode({context:"same",sessionId:9,blocked:false,add,error:vi.fn()}));
    await act(async()=>{await h.result.current("001");});
    expect(h.result.current.entries[0].status).toBe("failed");
    expect(h.result.current.hasUnresolved()).toBe(true);
    const id=h.result.current.entries[0].id;
    await act(async()=>{await h.result.current.retry(id);await h.result.current.retry(id);});
    expect(lookup).toHaveBeenCalledTimes(2);expect(add).toHaveBeenCalledOnce();
  });
  it("explicit cancellation prevents a late reply from adding a unit",async()=>{
    const d=deferred(),add=vi.fn();lookup.mockReset().mockReturnValueOnce(d.promise);
    const h=renderHook(()=>usePosBarcode({context:"same",sessionId:9,blocked:false,add,error:vi.fn()}));
    let done!:Promise<void>;act(()=>{done=h.result.current("001");});
    act(()=>h.result.current.cancel(h.result.current.entries[0].id));
    expect(h.result.current.hasUnresolved()).toBe(false);
    await act(async()=>{d.resolve(p);await done;});expect(add).not.toHaveBeenCalled();
  });
  it("times out with a visible retry/cancel outcome and ignores the timed-out reply",async()=>{
    vi.useFakeTimers();const d=deferred(),add=vi.fn();
    lookup.mockReset().mockReturnValueOnce(d.promise).mockResolvedValueOnce(p);
    const h=renderHook(()=>usePosBarcode({context:"same",sessionId:9,blocked:false,add,error:vi.fn()}));
    let done!:Promise<void>;act(()=>{done=h.result.current("001");});
    await act(async()=>{await vi.advanceTimersByTimeAsync(30_000);await done;});
    expect(h.result.current.entries[0].message).toContain("تأخر");
    await act(async()=>{await h.result.current.retry(h.result.current.entries[0].id);d.resolve(p);});
    expect(add).toHaveBeenCalledOnce();expect(h.result.current.hasUnresolved()).toBe(false);
  });
  it("does not apply a waiting successful result after the shift actually closes",async()=>{
    const d=deferred(),add=vi.fn(),error=vi.fn();lookup.mockReset().mockReturnValueOnce(d.promise);
    const h=renderHook(({context,blocked,sessionId})=>usePosBarcode({context,sessionId,blocked,add,error}),
      {initialProps:{context:"s9",sessionId:9 as number|undefined,blocked:false}});
    let done!:Promise<void>;act(()=>{done=h.result.current("001");});
    h.rerender({context:"s9",sessionId:9,blocked:true});
    await act(async()=>{d.resolve(p);await done;});
    h.rerender({context:"closed",sessionId:undefined,blocked:true});
    expect(add).not.toHaveBeenCalled();expect(error).toHaveBeenCalled();
    expect(h.result.current.entries).toHaveLength(0);
  });
  it("keeps a successful scan through temporary shift verification",async()=>{
    const d=deferred(),add=vi.fn();
    lookup.mockReset().mockReturnValueOnce(d.promise);
    const h=renderHook(({blocked})=>usePosBarcode({context:"same",sessionId:9,blocked,add,error:vi.fn()}),{initialProps:{blocked:false}});
    let done!:Promise<void>;act(()=>{done=h.result.current("0001");});
    h.rerender({blocked:true});
    await act(async()=>{d.resolve(p);await done;});
    expect(add).not.toHaveBeenCalled();
    h.rerender({blocked:false});
    expect(add).toHaveBeenCalledOnce();
  });
  it("synchronously fences payment until every accepted scan is resolved",async()=>{
    const d=deferred();lookup.mockReset().mockReturnValueOnce(d.promise);
    const h=renderHook(()=>usePosBarcode({context:"same",sessionId:9,blocked:false,add:vi.fn(),error:vi.fn()}));
    let done!:Promise<void>;act(()=>{done=h.result.current("0001");});
    expect((h.result.current as any).hasUnresolved?.()).toBe(true);
    await act(async()=>{d.resolve(p);await done;});
    expect((h.result.current as any).hasUnresolved?.()).toBe(false);
  });
  it("preserves leading zeroes and every intended scan despite reversed responses",async()=>{
    const first=deferred(),second=deferred(),add=vi.fn(),error=vi.fn();
    lookup.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const h=renderHook(()=>usePosBarcode({context:"u1:c1:s9:b1",sessionId:9,blocked:false,add,error}));
    let a!:Promise<void>,b!:Promise<void>;
    act(()=>{a=h.result.current("0000123");b=h.result.current("0000123");});
    expect(lookup.mock.calls.map(c=>c[0])).toEqual([{code:"0000123",sessionId:9},{code:"0000123",sessionId:9}]);
    await act(async()=>{second.resolve(p);await b;first.resolve(p);await a;});
    expect(add.mock.calls).toEqual([[p],[p]]);expect(error).not.toHaveBeenCalled();
  });
  for(const context of ["u1:c1:s9:customerB","u1:c1:s42:b1","u2:c2:s9:b1","u1:c1:s9:new-basket"])
    it(`never transfers a delayed result into ${context}`,async()=>{
      const pending=deferred(),add=vi.fn();
      lookup.mockReset().mockReturnValueOnce(pending.promise);
      const h=renderHook(({context})=>usePosBarcode({context,sessionId:9,blocked:false,add,error:vi.fn()}),
        {initialProps:{context:"u1:c1:s9:b1"}});
      let promise!:Promise<void>;act(()=>{promise=h.result.current("0000123");});
      h.rerender({context});await act(async()=>{pending.resolve(p);await promise;});
      expect(add).not.toHaveBeenCalled();
    });
  it("neither searches nor edits a frozen payment/save basket",async()=>{
    lookup.mockReset();const add=vi.fn(),error=vi.fn();
    const h=renderHook(()=>usePosBarcode({context:"frozen",sessionId:9,blocked:true,add,error}));
    await act(async()=>{await h.result.current("0000123");});
    expect(lookup).not.toHaveBeenCalled();expect(add).not.toHaveBeenCalled();expect(error).toHaveBeenCalledOnce();
  });
  it("reports a genuine server rejection without a basket addition",async()=>{
    lookup.mockReset().mockRejectedValue(new Error("الباركود ملتبس"));const add=vi.fn(),error=vi.fn();
    const h=renderHook(()=>usePosBarcode({context:"same",sessionId:9,blocked:false,add,error}));
    await act(async()=>{await h.result.current("0000123");});
    expect(add).not.toHaveBeenCalled();expect(error).toHaveBeenCalledWith("الباركود ملتبس");
  });
});
