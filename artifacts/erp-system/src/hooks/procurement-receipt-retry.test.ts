import {webcrypto} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {financialFetch} from "@workspace/api-client-react";

describe("goods receipt commit evidence survives recovery authorization denial",()=>{
  const network=vi.fn();
  beforeEach(()=>{sessionStorage.clear();network.mockReset();vi.stubGlobal("fetch",network);vi.stubGlobal("crypto",webcrypto);});
  afterEach(()=>vi.unstubAllGlobals());
  const send=(path="/api/procurement/goods-receipts")=>financialFetch(path,{method:"POST",body:JSON.stringify({poId:71,lines:[{poLineId:72,quantity:3}]})});
  it.each([401,403,404])("retains the SAME committed attempt after 502 and %s; only success clears it",async(status)=>{
    network.mockResolvedValueOnce(new Response("{}",{status:502}))
      .mockResolvedValueOnce(new Response("{}",{status}))
      .mockResolvedValue(new Response('{"id":11}',{status:201}));
    await expect(send()).rejects.toThrow("تعذر تأكيد");
    expect((await send()).status).toBe(status);
    expect((await send()).status).toBe(201);
    const keys=network.mock.calls.map(c=>new Headers(c[1].headers).get("Idempotency-Key"));
    expect(new Set(keys).size).toBe(1);expect(keys[0]).toBeTruthy();
    await send();
    expect(new Headers(network.mock.calls[3][1].headers).get("Idempotency-Key")).not.toBe(keys[0]);
  });
  it("does not change the accepted rejection behavior of unrelated financial routes",async()=>{
    network.mockResolvedValueOnce(new Response("{}",{status:403})).mockResolvedValueOnce(new Response("{}",{status:201}));
    await send("/api/sales/invoices");await send("/api/sales/invoices");
    const keys=network.mock.calls.map(c=>new Headers(c[1].headers).get("Idempotency-Key"));
    expect(keys[1]).not.toBe(keys[0]);
  });
});
