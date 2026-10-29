import {act,renderHook,waitFor} from "@testing-library/react";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {createPosOrder,closePosTaxPreviewIntent,type CreatePosOrderBody} from "@workspace/api-client-react";
import {usePosCheckout} from "@/hooks/use-pos-checkout";

vi.mock("@workspace/api-client-react",()=>({
  createPosOrder:vi.fn(),closePosTaxPreviewIntent:vi.fn(),getWorkspaceResponsibility:()=>null,
}));
const body:CreatePosOrderBody={sessionId:7,items:[{productId:9,quantity:1}],discount:0,
  paymentMethod:"cash",taxContextToken:"original-context",taxPreviewToken:"original-expiring-quote"};
const cart=[{product:{id:9,name:"منتج اختبار",price:115},quantity:1}];
const key="hasba:pos-checkout:quoted-fixture";
const success={id:31,orderNumber:"SYNTHETIC-ONE",total:230} as Awaited<ReturnType<typeof createPosOrder>>;
const rejection=(status:number)=>Object.assign(new Error("تغيرت حقائق المعاينة"),{
  status,data:{requiresManagerApproval:status===403,approvalRequestId:17},
});
beforeEach(()=>{sessionStorage.clear();vi.resetAllMocks();});

describe("quoted iconic POS intent rejection",()=>{
  it.each([400,403,409])("keeps HTTP %s frozen until original server closure, then uses a NEW key",async(status)=>{
    vi.mocked(createPosOrder).mockRejectedValueOnce(rejection(status));
    const callback=vi.fn();
    const {result}=renderHook(()=>usePosCheckout("quoted-fixture"));
    await waitFor(()=>expect(result.current.ready).toBe(true));
    await act(async()=>{await result.current.pay(body,cart,{onRejected:callback});});
    const original=JSON.parse(sessionStorage.getItem(key)!);
    expect(result.current.attempt?.key).toBe(original.key);
    expect(original.body).toEqual(body);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(result.current.error).toContain("بقيت المحاولة محفوظة");

    vi.mocked(closePosTaxPreviewIntent).mockRejectedValueOnce(rejection(403));
    await act(async()=>{expect(await result.current.close()).toBeNull();});
    expect(JSON.parse(sessionStorage.getItem(key)!).key).toBe(original.key);
    expect(result.current.attempt?.body).toEqual(body);
    vi.mocked(closePosTaxPreviewIntent).mockResolvedValueOnce({state:"closed_without_execution"});
    await act(async()=>{expect(await result.current.close()).toEqual({kind:"closed"});});
    expect(closePosTaxPreviewIntent).toHaveBeenLastCalledWith({requestKey:original.key,body});
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(result.current.attempt).toBeNull();

    vi.mocked(createPosOrder).mockResolvedValueOnce(success);
    const reviewed={...body,taxPreviewToken:"new-reviewed-quote"};
    await act(async()=>{expect(await result.current.pay(reviewed,cart)).toEqual(success);});
    const sent=vi.mocked(createPosOrder).mock.calls[1];
    expect(sent[0]).toEqual(reviewed);
    expect((sent[1]?.headers as Record<string,string>)["Idempotency-Key"]).not.toBe(original.key);
  });

  it("reloads a rejected quote and recovers with the EXACT original token/body/key",async()=>{
    vi.mocked(createPosOrder).mockRejectedValueOnce(rejection(409));
    const first=renderHook(()=>usePosCheckout("quoted-fixture"));
    await waitFor(()=>expect(first.result.current.ready).toBe(true));
    await act(async()=>{await first.result.current.pay(body,cart);});
    const original=JSON.parse(sessionStorage.getItem(key)!);
    first.unmount();
    const second=renderHook(()=>usePosCheckout("quoted-fixture"));
    await waitFor(()=>expect(second.result.current.attempt?.key).toBe(original.key));
    vi.mocked(createPosOrder).mockResolvedValueOnce(success);
    await act(async()=>{await second.result.current.pay({...body,taxPreviewToken:"DO-NOT-SUBSTITUTE"},
      [{product:{...cart[0].product,price:230},quantity:1}]);});
    expect(createPosOrder).toHaveBeenLastCalledWith(body,{headers:{"Idempotency-Key":original.key}});
    expect(sessionStorage.getItem(key)).toBeNull();
  });
});
