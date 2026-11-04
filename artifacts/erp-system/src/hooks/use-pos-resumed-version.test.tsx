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
      const sent=JSON.parse(init.body);
      calls.push({body:JSON.stringify(sent.body??sent),key:sent.requestKey??new Headers(init.headers).get("Idempotency-Key")});
      if(calls.length===1)return Response.json({}); // Incomplete response is not an acknowledgement.
      return Response.json({state:"current",id:81,sessionId:9,version:1,...edited});
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
  it("keeps denial/unknown evidence after reload until exact resolution durably closes it",async()=>{
    const calls:{url:string;body:any}[]=[];
    vi.stubGlobal("fetch",vi.fn(async(url,init)=>{
      calls.push({url:String(url),body:JSON.parse(init.body)});
      if(calls.length===1)return Response.json({error:"الوردية مغلقة"},{status:409});
      if(calls.length===2)throw Error("network");
      return Response.json({state:"closed_without_execution",id:81,sessionId:9});
    }));
    let v=mount();await waitFor(()=>expect(v.result.current.local.ready).toBe(true));
    act(()=>{v.result.current.local.save({...original,...edited,serverDirty:true});});
    await act(async()=>{await v.result.current.remote.confirm();});
    const intent=v.result.current.local.value!.syncIntent;
    expect(intent).toBeTruthy();expect(v.result.current.local.value?.continuationResolved).not.toBe(true);
    v.unmount();v=mount();await waitFor(()=>expect(v.result.current.remote.pending).toBe(true));
    await act(async()=>{await v.result.current.remote.confirm();});
    expect(v.result.current.local.value?.syncIntent).toEqual(intent);
    await act(async()=>{await v.result.current.remote.confirm();});
    expect(calls[1].url).toContain("/resolve");
    expect(calls[1].body).toEqual({requestKey:intent!.key,body:intent!.body});
    expect(calls[2]).toEqual(calls[1]);
    expect(v.result.current.local.value).toMatchObject({...edited,continuationResolved:true});
    expect(v.result.current.remote.pending).toBe(false);
  });
  it("a late resolution cannot clear a newer basket",async()=>{
    let reply!:(r:Response)=>void;
    vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(resolve=>{reply=resolve;})));
    const v=mount();await waitFor(()=>expect(v.result.current.local.ready).toBe(true));
    act(()=>{v.result.current.local.save({...original,syncIntent:{key:"original-edit-key",responsibility:null,
      body:{action:"save",sessionId:9,requestId:original.source.requestId,version:0,items:[{productId:5,quantity:3}]}}});});
    let work:Promise<unknown>;
    act(()=>{work=v.result.current.remote.confirm();});
    act(()=>{v.result.current.local.save({...original,source:{...original.source,id:82,requestId:"newer-resume"},cart:edited.cart});});
    await act(async()=>{reply(Response.json({state:"closed_without_execution",id:81,sessionId:9}));await work;});
    expect(v.result.current.local.value?.source.id).toBe(82);
    expect(v.result.current.local.value?.continuationResolved).not.toBe(true);
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
