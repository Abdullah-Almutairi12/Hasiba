import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,it,expect,vi} from "vitest";
import {StocktakeLineCounter} from "./stocktake-line-counter";
const mock=vi.hoisted(()=>({post:vi.fn()}));
vi.mock("@/hooks/use-api",()=>({apiPost:mock.post}));
const done=vi.fn(),props={takeId:1,line:{id:2,productId:3,productName:"صنف مصطنع",countedQty:null},
 scope:"synthetic-count",disabled:false,onConfirmed:done};
const response=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status});
beforeEach(()=>{
 localStorage.clear();done.mockReset();mock.post.mockReset();
 mock.post.mockResolvedValue({checkpointId:crypto.randomUUID(),expectedRevision:"0",expectedQty:100,expiresAt:new Date(Date.now()+900000).toISOString()});
 Object.defineProperty(navigator,"locks",{configurable:true,value:{request:async(_s:string,_o:unknown,fn:(lock:unknown)=>Promise<void>)=>fn({})}});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
async function start(){
 fireEvent.click(screen.getByRole("button",{name:"بدء عد الصنف"}));
 await screen.findByLabelText(/العدد المطلق/);
 fireEvent.change(screen.getByLabelText(/العدد المطلق/),{target:{value:"97"}});
}
it("starts a server checkpoint before physical entry, then sends its exact revision and token without financial fields",async()=>{
 const fetcher=vi.fn().mockResolvedValue(response(200,{ok:true}));vi.stubGlobal("fetch",fetcher);
 render(<StocktakeLineCounter {...props}/>);
 expect(screen.queryByLabelText(/العدد المطلق/)).toBeNull();
 await start();fireEvent.click(screen.getByRole("button",{name:"تأكيد العدد"}));
 await waitFor(()=>expect(done).toHaveBeenCalledOnce());
 expect(mock.post).toHaveBeenCalledWith("/inventory/stock-takes/1/checkpoint",{productId:3});
 expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({countedQty:97,expectedRevision:"0"});
 expect(fetcher.mock.calls[0][1].body).not.toMatch(/cost|price|journal/);
});
it("recovers a lost response after reload with exactly the same identity and frozen body",async()=>{
 const fetcher=vi.fn().mockRejectedValueOnce(new Error("lost")).mockResolvedValueOnce(response(200,{ok:true}));
 vi.stubGlobal("fetch",fetcher);
 const view=render(<StocktakeLineCounter {...props}/>);await start();
 fireEvent.click(screen.getByRole("button",{name:"تأكيد العدد"}));
 await screen.findByRole("button",{name:"استعادة نتيجة العدد"});
 await waitFor(()=>expect(screen.getByRole("button",{name:"استعادة نتيجة العدد"}).hasAttribute("disabled")).toBe(false));
 view.unmount();render(<StocktakeLineCounter {...props}/>);
 fireEvent.click(await screen.findByRole("button",{name:"استعادة نتيجة العدد"}));
 await waitFor(()=>expect(done).toHaveBeenCalledOnce());
 expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
 expect(fetcher.mock.calls[0][1].headers["Idempotency-Key"]).toBe(fetcher.mock.calls[1][1].headers["Idempotency-Key"]);
 expect(localStorage.getItem("synthetic-count:absolute:2")).toBeNull();
});
it("rejects a moved/expired checkpoint, keeps the confirmed count untouched and requires a new physical count",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response(409,{error:"تحرك الصنف أثناء العد"})));
 render(<StocktakeLineCounter {...props}/>);await start();
 fireEvent.click(screen.getByRole("button",{name:"تأكيد العدد"}));await screen.findByText("تحرك الصنف أثناء العد");
 expect(done).not.toHaveBeenCalled();expect(screen.queryByLabelText(/العدد المطلق/)).toBeNull();
 expect(screen.getByRole("button",{name:"بدء عد الصنف"})).toBeTruthy();
});
it("never sends an absolute observation if durable intent storage fails",async()=>{
 const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
 render(<StocktakeLineCounter {...props}/>);await start();
 const spy=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("storage unavailable");});
 fireEvent.click(screen.getByRole("button",{name:"تأكيد العدد"}));
 await screen.findByText("storage unavailable");expect(fetcher).not.toHaveBeenCalled();spy.mockRestore();
});
it("does not grant completion or enable count controls to a read-only actor",()=>{
 render(<StocktakeLineCounter {...props} disabled/>);
 expect(screen.getByRole("button",{name:"بدء عد الصنف"}).hasAttribute("disabled")).toBe(true);
 expect(screen.queryByRole("button",{name:/إقفال/})).toBeNull();
});
