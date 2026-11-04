import {act,renderHook,waitFor} from "@testing-library/react";
import {describe,it,expect,vi} from "vitest";
import {usePosResumedBasket,type ResumedBasket} from "./use-pos-resumed-basket";
import {usePosResumedVersion} from "./use-pos-resumed-version";
const original:ResumedBasket={source:{id:81,sessionId:9,requestId:"original-resume-81",version:0},
  cart:[{product:{id:5,name:"صنف",price:100},quantity:2}],customer:{id:7,name:"أ"}};
const edited={cart:[{...original.cart[0],quantity:3}],customer:{id:8,name:"ب"}};
const mount=()=>renderHook(()=>{const local=usePosResumedBasket("version-tests");return {local,remote:usePosResumedVersion(local)};});
describe("separate local durability and confirmed server revisions",()=>{
  it("keeps a lost save's original body/key through reload and confirms only a matching acknowledgement",async()=>{
    const calls:{body:string;key:string|null}[]=[];
    vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{
      calls.push({body:init.body,key:new Headers(init.headers).get("Idempotency-Key")});
      if(calls.length===1)return Response.json({}); // Incomplete response is not an acknowledgement.
      return Response.json({state:"current",id:81,sessionId:9,version:1});
    }));
    let v=mount();await waitFor(()=>expect(v.result.current.local.ready).toBe(true));
    act(()=>{v.result.current.local.save(original);});
    act(()=>{v.result.current.local.update(edited.cart,edited.customer);});
    expect(v.result.current.remote.dirty).toBe(true);
    await act(async()=>{await v.result.current.remote.confirm();});
    expect(v.result.current.remote.pending).toBe(true);
    expect(v.result.current.local.value?.source.version).toBe(0);
    v.unmount();v=mount();await waitFor(()=>expect(v.result.current.remote.pending).toBe(true));
    await act(async()=>{await v.result.current.remote.confirm();});
    expect(calls).toHaveLength(2);expect(calls[1]).toEqual(calls[0]);
    expect(v.result.current.local.value).toMatchObject({...edited,source:{...original.source,version:1}});
    expect(v.result.current.remote.pending).toBe(false);expect(v.result.current.remote.dirty).toBe(false);
  });
  it("a known stale-write receipt does not replace the basket; explicit review loads the newer confirmed contents",async()=>{
    const calls:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{
      const body=JSON.parse(init.body);calls.push(body.action);
      return Response.json(body.action==="save"?{state:"conflict",id:81,sessionId:9,version:1}:
        {state:"current",id:81,sessionId:9,version:1,...edited});
    }));
    const v=mount();await waitFor(()=>expect(v.result.current.local.ready).toBe(true));
    act(()=>{v.result.current.local.save({...original,serverDirty:true});});
    await act(async()=>{await v.result.current.remote.confirm();});
    expect(v.result.current.local.value?.cart[0].quantity).toBe(2);
    expect(v.result.current.local.value?.customer?.id).toBe(7);
    expect(v.result.current.remote.pending).toBe(false);
    expect(v.result.current.remote.message).toContain("تبويب آخر");
    await act(async()=>{await v.result.current.remote.refresh();});
    expect(v.result.current.local.value).toMatchObject({...edited,source:{...original.source,version:1}});
    expect(calls).toEqual(["save","read"]); // Never a sale or automatic payment.
  });
});
