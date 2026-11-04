import {act,renderHook} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {resumeStorageKey,usePosResume} from "./use-pos-resume";
const scope="11:21:legacy",storage=resumeStorageKey(scope);
afterEach(()=>vi.restoreAllMocks());
function response(init:RequestInit|undefined,extra:Record<string,unknown>={}){
  return Response.json({id:81,sessionId:9,state:"resumed",
    requestId:new Headers(init?.headers).get("Idempotency-Key"),customerId:27,
    items:[{productId:5,quantity:3,priceSnapshot:100,nameSnapshot:"صنف"}],...extra});
}
describe("durable resume/cancel identity",()=>{
  it("persists before sending and reuses exact key/body after remount",async()=>{
    const fetcher=vi.fn(async(_url,init)=>{
      expect(sessionStorage.getItem(storage)).not.toBeNull();
      if(fetcher.mock.calls.length===1)throw new TypeError("lost");
      return response(init);
    });vi.stubGlobal("fetch",fetcher);
    let h=renderHook(()=>usePosResume(scope));
    await act(async()=>{expect(await h.result.current.submit(81,9)).toBeNull();});
    const original=sessionStorage.getItem(storage);h.unmount();
    h=renderHook(()=>usePosResume(scope));
    let result:any;
    await act(async()=>{result=await h.result.current.submit();});
    expect(result.result.items[0].quantity).toBe(3);
    expect(fetcher.mock.calls[0]).toEqual(fetcher.mock.calls[1]);
    expect(sessionStorage.getItem(storage)).toBe(original);
    act(()=>{expect(h.result.current.acknowledge(result.intent)).toBe(true);});
    expect(sessionStorage.getItem(storage)).toBeNull();
  });
  it.each(["empty","denied","wrong-key","missing-items","wrong-session"]as const)("retains identity for %s rather than inferring absence",async fault=>{
    vi.stubGlobal("fetch",vi.fn(async(_u,init)=>{
      if(fault==="empty")return new Response(null,{status:204});
      if(fault==="denied")return Response.json({error:"forbidden"},{status:403});
      return response(init,fault==="wrong-key"?{requestId:"a-different-key"}:fault==="missing-items"?{items:[]}: {sessionId:10});
    }));
    const h=renderHook(()=>usePosResume(scope));
    await act(async()=>{expect(await h.result.current.submit(81,9)).toBeNull();});
    expect(h.result.current.intent?.meta?.id).toBe(81);expect(sessionStorage.getItem(storage)).not.toBeNull();
  });
  it("does not issue a cancellation through an existing resume identity",async()=>{
    const f=vi.fn(async()=>{throw new TypeError("lost");});vi.stubGlobal("fetch",f);
    const h=renderHook(()=>usePosResume(scope));
    await act(async()=>{await h.result.current.submit(81,9);await h.result.current.submit(81,9,"cancel");});
    expect(f).toHaveBeenCalledTimes(1);
    expect(h.result.current.error).toContain("منفصلتان");
    expect(h.result.current.intent?.endpoint).toBe("pos/orders/81/resume");
  });
  it("uses a distinct cancellation endpoint and does not turn it into a basket",async()=>{
    const f=vi.fn(async(_u,init)=>response(init,{state:"cancelled",items:undefined}));vi.stubGlobal("fetch",f);
    const h=renderHook(()=>usePosResume(scope));let out:any;
    await act(async()=>{out=await h.result.current.submit(81,9,"cancel");});
    expect(f.mock.calls[0][0]).toContain("/81/cancel");
    expect(out.result.state).toBe("cancelled");
  });
  it("accepts explicit keyed non-delivery, not an arbitrary 404",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(_u,init)=>Response.json({id:81,sessionId:9,
      requestId:new Headers(init?.headers).get("Idempotency-Key"),state:"unavailable"},{status:404})));
    const h=renderHook(()=>usePosResume(scope));let out:any;
    await act(async()=>{out=await h.result.current.submit(81,9);});
    expect(out.result.state).toBe("unavailable");expect(h.result.current.intent).not.toBeNull();
  });
  it("keeps a newer intent and never acknowledges the old one over it",async()=>{
    vi.stubGlobal("fetch",vi.fn(async(_u,init)=>response(init)));
    const h=renderHook(()=>usePosResume(scope));let out:any;
    await act(async()=>{out=await h.result.current.submit(81,9);});
    const newer={...out.intent,key:crypto.randomUUID()};
    sessionStorage.setItem(storage,JSON.stringify(newer));
    act(()=>{expect(h.result.current.acknowledge(out.intent)).toBe(false);});
    expect(JSON.parse(sessionStorage.getItem(storage)!).key).toBe(newer.key);
  });
  it("does not send without durable storage or after a scope change",async()=>{
    const f=vi.fn(async(_u,init)=>response(init));vi.stubGlobal("fetch",f);
    const h=renderHook(({s})=>usePosResume(s),{initialProps:{s:scope}});
    const spy=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("storage");});
    await act(async()=>{expect(await h.result.current.submit(81,9)).toBeNull();});
    expect(f).not.toHaveBeenCalled();spy.mockRestore();
    h.rerender({s:"12:22:legacy"});expect(h.result.current.intent).toBeNull();
  });
});
