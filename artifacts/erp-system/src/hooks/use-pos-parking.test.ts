import {act,renderHook} from "@testing-library/react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {parkingStorageKey,usePosParking,type ParkingIntent} from "./use-pos-parking";
import {saveIntent} from "@/lib/durable-intent";
const scope="11:21:legacy",storage=parkingStorageKey(scope);
const snapshot=()=>({
  body:{sessionId:9,customerId:17,label:"A",items:[{productId:5,quantity:1,priceSnapshot:100,nameSnapshot:"Product"}],
    subtotal:100,tax:0,discount:0,total:100},
  meta:{cart:[{product:{id:5,name:"Product",price:100},quantity:1}],customer:{id:17,name:"A"}},
});
const saved=()=>JSON.parse(sessionStorage.getItem(storage)!) as ParkingIntent;
const confirmed=(key:string)=>Response.json({id:71,requestId:key,orderNumber:"PARK-71",sessionId:9,customerId:17});
beforeEach(()=>sessionStorage.clear());
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();sessionStorage.clear();});
describe("durable parking storage and response binding",()=>{
  it("fences synchronous duplicate submissions and freezes the body before sending",async()=>{
    let resolve!:(value:Response)=>void;
    const fetcher=vi.fn(()=>new Promise<Response>(r=>{resolve=r}));vi.stubGlobal("fetch",fetcher);
    const h=renderHook(()=>usePosParking(scope)),input=snapshot();
    let pending!:ReturnType<typeof h.result.current.submit>;
    await act(async()=>{pending=h.result.current.submit(input);await h.result.current.submit(input);});
    expect(fetcher).toHaveBeenCalledTimes(1);
    const key=saved().key;
    input.body.customerId=99;input.meta.cart[0].quantity=9;
    expect(saved().body.customerId).toBe(17);expect(saved().meta?.cart[0].quantity).toBe(1);
    await act(async()=>{resolve(confirmed(key));await pending;});
    expect(sessionStorage.getItem(storage)).toBeNull();
  });
  it.each(["lost","empty","missing-id","wrong-key","wrong-session","wrong-customer"] as const)(
    "keeps %s evidence through reload and replays the exact key and body",async fault=>{
      const fetcher=vi.fn(async()=>{
        if(fetcher.mock.calls.length>1)return confirmed(saved().key);
        if(fault==="lost")throw new TypeError("response lost after commit");
        if(fault==="empty")return new Response(null,{status:204});
        const data={id:71,requestId:saved().key,sessionId:9,customerId:17,orderNumber:"PARK-71"};
        if(fault==="missing-id")return Response.json({...data,id:null});
        if(fault==="wrong-key")return Response.json({...data,requestId:crypto.randomUUID()});
        if(fault==="wrong-session")return Response.json({...data,sessionId:42});
        return Response.json({...data,customerId:99});
      });
      vi.stubGlobal("fetch",fetcher);
      const first=renderHook(()=>usePosParking(scope));
      await act(async()=>{expect(await first.result.current.submit(snapshot())).toBeNull();});
      const original=saved();expect(original.meta?.customer?.id).toBe(17);
      expect(first.result.current.error).toMatch(/[\u0600-\u06ff]/);
      first.unmount();
      const second=renderHook(()=>usePosParking(scope));
      expect(second.result.current.intent?.key).toBe(original.key);
      await act(async()=>{expect((await second.result.current.submit())?.result.id).toBe(71);});
      const calls=fetcher.mock.calls as unknown as [string,RequestInit][];
      expect(calls[1][1].body).toBe(calls[0][1].body);
      expect(new Headers(calls[1][1].headers).get("Idempotency-Key")).toBe(original.key);
      expect(sessionStorage.getItem(storage)).toBeNull();
    });
  it("does not let a late response erase a newer stored intent",async()=>{
    let resolve!:(v:Response)=>void;
    vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(r=>{resolve=r})));
    const h=renderHook(()=>usePosParking(scope));let pending!:ReturnType<typeof h.result.current.submit>;
    await act(async()=>{pending=h.result.current.submit(snapshot());});
    const original=saved(),newer={...original,key:crypto.randomUUID()};
    saveIntent(storage,newer);
    await act(async()=>{resolve(confirmed(original.key));expect(await pending).toBeNull();});
    expect(saved().key).toBe(newer.key);
  });
  it("does not let an unmounted caller clear the intent now owned by the reloaded screen",async()=>{
    let resolve!:(v:Response)=>void;
    vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(r=>{resolve=r})));
    const old=renderHook(()=>usePosParking(scope));let pending!:ReturnType<typeof old.result.current.submit>;
    await act(async()=>{pending=old.result.current.submit(snapshot());});
    const key=saved().key;old.unmount();
    const reloaded=renderHook(()=>usePosParking(scope));
    await act(async()=>{resolve(confirmed(key));expect(await pending).toBeNull();});
    expect(saved().key).toBe(key);expect(reloaded.result.current.intent?.key).toBe(key);
  });
  it("sends nothing and creates no false pending intent when storage fails",async()=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw Error("denied")});
    const h=renderHook(()=>usePosParking(scope));
    await act(async()=>{expect(await h.result.current.submit(snapshot())).toBeNull();});
    expect(fetcher).not.toHaveBeenCalled();expect(h.result.current.intent).toBeNull();
    expect(h.result.current.error).toContain("لم يُرسل");
  });
});
