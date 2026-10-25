import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StocktakeScanner } from "./stocktake-scanner";
import { countIntentKey } from "@/lib/stocktake-intent";
const mock=vi.hoisted(()=>({toast:vi.fn(),lookup:vi.fn()}));
vi.mock("@/hooks/use-api",()=>({apiGet:mock.lookup}));
vi.mock("@/hooks/use-toast",()=>({useToast:()=>({toast:mock.toast})}));
const scope=countIntentKey(11,12,13),done=vi.fn();
const response=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
beforeEach(()=>{
  localStorage.clear();mock.toast.mockReset();mock.lookup.mockReset();done.mockReset();
  mock.lookup.mockResolvedValue({productId:14});
  Object.defineProperty(navigator,"locks",{configurable:true,value:{
    request:async(_name:string,_options:unknown,fn:(lock:unknown)=>Promise<void>)=>fn({}),
  }});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const scan=()=>{
  fireEvent.change(screen.getByLabelText(/مسح الباركود/),{target:{value:"SKU-SYNTHETIC"}});
  fireEvent.click(screen.getByRole("button",{name:"عدّ"}));
};
it("does not read cached quantity or announce success before a confirmed POST; a fresh scan has a fresh identity",async()=>{
  let resolve!:(r:Response)=>void;
  const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(r=>{resolve=r;}))
    .mockResolvedValueOnce(response(201,{countedQty:102}));
  vi.stubGlobal("fetch",fetcher);
  render(<StocktakeScanner id={13} scope={scope} onConfirmed={done}/>);
  scan();
  await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
  expect(mock.toast).not.toHaveBeenCalled();expect(done).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(scope)!)).toMatchObject({countedQty:1,uncertain:true});
  await act(async()=>resolve(response(201,{countedQty:101})));
  await waitFor(()=>expect(done).toHaveBeenCalledTimes(1));
  scan();await waitFor(()=>expect(done).toHaveBeenCalledTimes(2));
  const [first,second]=fetcher.mock.calls.map(c=>c[1]);
  expect(first.method).toBe("POST");expect(JSON.parse(first.body)).toEqual({productId:14,countedQty:1});
  expect(first.headers["Idempotency-Key"]).not.toBe(second.headers["Idempotency-Key"]);
});
it("preserves unknown commit across a real unmount/reload and reuses the exact request; later permission denial does not discard evidence",async()=>{
  const fetcher=vi.fn().mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValueOnce(response(403,{error:"سُحبت صلاحية العد"}))
    .mockResolvedValueOnce(response(201,{countedQty:1}));
  vi.stubGlobal("fetch",fetcher);
  const view=render(<StocktakeScanner id={13} scope={scope} onConfirmed={done}/>);
  scan();await screen.findByText(/نتيجة غير مؤكدة/);
  const saved=localStorage.getItem(scope);expect(saved).not.toBeNull();
  view.unmount();
  render(<StocktakeScanner id={13} scope={scope} onConfirmed={done}/>);
  fireEvent.click(screen.getByRole("button",{name:"استعادة نتيجة المسحة"}));
  await screen.findByText(/سُحبت صلاحية العد/);
  expect(localStorage.getItem(scope)).toBe(saved);expect(done).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"استعادة نتيجة المسحة"}));
  await waitFor(()=>expect(done).toHaveBeenCalledTimes(1));
  expect(fetcher.mock.calls[0][1]).toEqual(fetcher.mock.calls[1][1]);
  expect(fetcher.mock.calls[1][1]).toEqual(fetcher.mock.calls[2][1]);
  expect(mock.lookup).toHaveBeenCalledTimes(1);expect(localStorage.getItem(scope)).toBeNull();
});
it("reports a lookup permission/network error honestly, retaining the barcode without posting",async()=>{
  mock.lookup.mockRejectedValue(new Error("ليس لديك صلاحية"));
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  render(<StocktakeScanner id={13} scope={scope} onConfirmed={done}/>);
  scan();await screen.findByText("ليس لديك صلاحية");
  expect(screen.queryByText("باركود غير معروف")).toBeNull();
  expect((screen.getByLabelText(/مسح الباركود/) as HTMLInputElement).value).toBe("SKU-SYNTHETIC");
  expect(fetcher).not.toHaveBeenCalled();
});
it("fails closed if local evidence cannot be read and never sends without durable storage",async()=>{
  localStorage.setItem(scope,"broken");
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  render(<StocktakeScanner id={13} scope={scope} onConfirmed={done}/>);
  expect(screen.getByRole("button",{name:"عدّ"}).hasAttribute("disabled")).toBe(true);
  expect(fetcher).not.toHaveBeenCalled();
});
it("does not send or change another user/company/count's saved attempt",async()=>{
  const other=countIntentKey(11,99,13);
  localStorage.setItem(other,JSON.stringify({key:crypto.randomUUID(),code:"OTHER",productId:55,countedQty:1,uncertain:true}));
  const saved=localStorage.getItem(other),fetcher=vi.fn().mockResolvedValue(response(201,{countedQty:1}));
  vi.stubGlobal("fetch",fetcher);
  render(<StocktakeScanner id={13} scope={scope} onConfirmed={done}/>);
  scan();await waitFor(()=>expect(done).toHaveBeenCalled());
  expect(localStorage.getItem(other)).toBe(saved);
});
it("rejects a proxy error without inventing success and restores the persisted identity after reload",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(response(502,{error:"proxy lost response"}));
  vi.stubGlobal("fetch",fetcher);
  render(<StocktakeScanner id={13} scope={scope} onConfirmed={done}/>);
  scan();await screen.findByText(/نتيجة غير مؤكدة/);
  expect(done).not.toHaveBeenCalled();expect(mock.toast).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(scope)!)).toMatchObject({uncertain:true,countedQty:1});
});
