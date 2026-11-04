import {act,renderHook,waitFor} from "@testing-library/react";
import {describe,it,expect,vi} from "vitest";
import {usePosResumedBasket,type ResumedBasket} from "./use-pos-resumed-basket";

const initial:ResumedBasket={source:{id:81,sessionId:9,requestId:"resume-stable-81"},
  cart:[{product:{id:5,name:"صنف",price:100} as ResumedBasket["cart"][number]["product"],quantity:2}],
  customer:{id:7,name:"أ"}};
describe("durable edits of a source-bound working basket",()=>{
  it("writes rapid edits synchronously, keeps source identity, and restores an empty cash basket",async()=>{
    const view=renderHook(()=>usePosResumedBasket("edits"));
    await waitFor(()=>expect(view.result.current.ready).toBe(true));
    act(()=>{expect(view.result.current.save(initial)).toBe(true);});
    act(()=>{
      expect(view.result.current.update([{...initial.cart[0],quantity:3}],{id:8,name:"ب"})).toBe(true);
      expect(view.result.current.update([],null)).toBe(true);
    });
    const stored=JSON.parse(sessionStorage.getItem("hasba:pos-resumed-basket:edits")!);
    expect(stored).toEqual({source:initial.source,cart:[],customer:null,serverDirty:true});
    view.unmount();
    const reloaded=renderHook(()=>usePosResumedBasket("edits"));
    await waitFor(()=>expect(reloaded.result.current.ready).toBe(true));
    expect(reloaded.result.current.value).toEqual(stored);
  });
  it("detects a write which silently retained the old snapshot, then retries the latest contents",async()=>{
    const view=renderHook(()=>usePosResumedBasket("write-check"));
    await waitFor(()=>expect(view.result.current.ready).toBe(true));
    act(()=>{view.result.current.save(initial);});
    const fault=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{});
    act(()=>{expect(view.result.current.update([{...initial.cart[0],quantity:3}],null)).toBe(false);});
    expect(view.result.current.dirty).toBe(true);
    expect(view.result.current.value).toMatchObject({source:initial.source,cart:[{quantity:3}],customer:null});
    fault.mockRestore();
    act(()=>{expect(view.result.current.retry()).toBe(true);});
    expect(view.result.current.error).toBe("");expect(view.result.current.dirty).toBe(false);
    expect(JSON.parse(sessionStorage.getItem("hasba:pos-resumed-basket:write-check")!)).toMatchObject({cart:[{quantity:3}],customer:null});
  });
});
