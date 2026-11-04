import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import PosIconic from "./pos-iconic";
import { beforeEach } from "vitest";

const sessionMock = vi.hoisted(() => ({ id:9,status: "open", refetch: vi.fn(),branchId:7 as number|null,
  role: null as string | null, branchOptions: [{ id: 7, name: "فرع تجربة المالك" }], branchError: false,
  loading: false, fetching: false, error: false, rows: null as null | Array<Record<string, unknown>> }));
beforeEach(() => {
  sessionMock.status = "open";
  sessionMock.id=9;
  sessionMock.branchId=7;
  sessionMock.role=null; sessionMock.branchOptions=[{ id: 7, name: "فرع تجربة المالك" }]; sessionMock.branchError=false;
  sessionMock.refetch.mockClear();
  sessionMock.loading=false; sessionMock.fetching=false; sessionMock.error=false; sessionMock.rows=null;
});
import { usePosCheckout } from "@/hooks/use-pos-checkout";
import ar from "@/i18n/ar.json";
import { posPreviewServer } from "@/lib/tax-preview-mock";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: 11, companyId: 21,role:sessionMock.role ?? (sessionMock.branchId?"cashier":"owner"),branchId:sessionMock.branchId} }),
}));
vi.mock("@/hooks/use-vat-status", () => ({ useVatEnabled: () => false }));
vi.mock("@/hooks/use-language", () => ({
  useLanguage: () => ({
    language: "ar",
    t: (key: string) => key.startsWith("pos_iconic.")
      ? ar.pos_iconic[key.slice("pos_iconic.".length) as keyof typeof ar.pos_iconic] ?? key : key,
  }),
}));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useListProducts: () => ({ data: [{ id: 5, name: "منتج تجريبي", nameAr: "منتج تجريبي", price: 100, stock: 20 }] }),
  useListProductCategories: () => ({ data: [] }),
  useListPosSessions: () => ({ data: sessionMock.loading || sessionMock.error ? undefined : sessionMock.rows ?? [{ id: sessionMock.id, sessionNumber: `SHIFT-${sessionMock.id}`, status: sessionMock.status, branchId: sessionMock.branchId ?? 7, cashierUserId: 11 }], isLoading: sessionMock.loading, isFetching: sessionMock.loading || sessionMock.fetching, isError: sessionMock.error, refetch: sessionMock.refetch }),
  useListPosShiftBranches: () => ({ data: sessionMock.branchOptions, isLoading: false, isError: sessionMock.branchError, refetch: vi.fn() }),
}));

const storageKey = "hasba:pos-checkout:11:21";
let previews: unknown[] = [];
beforeEach(() => { previews = []; });
// A new sale needs an explicitly reviewed authoritative server quote.
const review = async (u: { click: (el: Element) => Promise<void> }) => u.click(await screen.findByTestId("button-tax-preview-confirm"));
afterEach(() => vi.restoreAllMocks());
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><PosIconic variant="retail" /></QueryClientProvider>;
  const view = render(tree());
  return { ...view, refresh: () => view.rerender(tree()) };
}
describe("shift state must be established before a fresh opening", () => {
  const shiftRow = (id:number,status="open") => ({id,status,branchId:7,cashierUserId:11,sessionNumber:`SHIFT-${id}`,openedAt:"2026-11-04T02:00:00Z"});
  it("retains a reviewed sale across an unchanged background shift refresh, but invalidates it on closure", async()=>{
    const transport=saleTransport(),u=userEvent.setup();
    const view=mount();
    await u.click(await screen.findByTestId("product-icon-5"));
    await review(u);
    expect(screen.getByTestId("tax-preview-status").textContent).toBe("تمت المراجعة");
    const previewCount=previews.length;
    sessionMock.fetching=true;view.refresh();
    expect(screen.getByTestId("pos-active-session-context").textContent).toContain("SHIFT-9");
    expect(screen.queryByTestId("button-scoped-open-shift")).toBeNull();
    sessionMock.fetching=false;view.refresh();
    expect(screen.getByTestId("tax-preview-status").textContent).toBe("تمت المراجعة");
    expect(previews).toHaveLength(previewCount);
    await u.click(screen.getByTestId("product-icon-5"));
    await waitFor(()=>expect(screen.getByTestId("tax-preview-status").textContent).not.toBe("تمت المراجعة"));
    await review(u);
    sessionMock.rows=[shiftRow(9,"closed"),shiftRow(42)];view.refresh();
    expect(screen.queryByTestId("pos-active-session-context")).toBeNull();
    expect(JSON.parse(sessionStorage.getItem("hasba:pos-shift-selection:11:21:legacy")!).sessionId).toBe(9);
    sessionMock.rows=null;view.refresh();
    await waitFor(()=>expect(screen.getByTestId("tax-preview-status").textContent).not.toBe("تمت المراجعة"));
    await review(u);
    await u.click(screen.getByTestId("button-pay-rail"));
    await waitFor(()=>expect(transport.committed.size).toBe(1));
    expect(transport.attempts).toHaveLength(1);
  });
  it("cannot start a cart before explicit shift choice or lock the choice with an orphan cart",async()=>{
    sessionMock.rows=[shiftRow(42),shiftRow(43)];
    const transport=saleTransport(),u=userEvent.setup();
    mount();
    await u.click(await screen.findByTestId("product-icon-5"));
    const select=screen.getByRole("combobox",{name:"اختر الوردية"});
    expect(select.matches(":disabled")).toBe(false);
    expect(previews).toHaveLength(0);
    await u.selectOptions(select,"43");
    await u.click(screen.getByTestId("product-icon-5"));
    await review(u);
    await u.click(screen.getByTestId("button-pay-rail"));
    await waitFor(()=>expect(transport.committed.size).toBe(1));
    expect(JSON.parse(transport.attempts[0].body)).toMatchObject({sessionId:43,items:[{productId:5,quantity:1}]});
  });
  it("never attributes an unidentified legacy shift to the current cashier or opens a replacement",async()=>{
    sessionMock.rows=[{...shiftRow(41),cashierUserId:22},{...shiftRow(42),cashierUserId:null}];
    const fetcher=vi.fn(async()=>Response.json([]));vi.stubGlobal("fetch",fetcher);
    mount();
    expect(screen.queryByTestId("pos-active-session-context")).toBeNull();
    expect(screen.getByTestId("text-pos-unidentified-shift")).toBeTruthy();
    expect(screen.queryByTestId("button-scoped-open-shift")).toBeNull();
    expect(sessionStorage.getItem("hasba:pos-shift-selection:11:21:legacy")).toBeNull();
    expect(fetcher.mock.calls.filter(([,i]:any[])=>i?.method==="POST")).toHaveLength(0);
  });
  it("replaces a closed saved selection with the single eligible open shift without any opening POST", async()=>{
    sessionStorage.setItem("hasba:pos-shift-selection:11:21:legacy",JSON.stringify({branchId:7,sessionId:9}));
    sessionMock.rows=[shiftRow(9,"closed"),shiftRow(42)];
    const fetcher=vi.fn(async()=>Response.json([]));vi.stubGlobal("fetch",fetcher);
    mount();
    const fresh=screen.queryByTestId("button-scoped-open-shift");if(fresh)await userEvent.click(fresh);
    expect(fetcher.mock.calls.filter(([,i]:any[])=>i?.method==="POST")).toHaveLength(0);
    expect(screen.getByTestId("pos-active-session-context").textContent).toContain("SHIFT-42");
    await waitFor(()=>expect(JSON.parse(sessionStorage.getItem("hasba:pos-shift-selection:11:21:legacy")!).sessionId).toBe(42));
  });
  it("requires explicit selection among eligible shifts, persists it across reload, and never posts an opening", async()=>{
    sessionMock.rows=[shiftRow(42),shiftRow(43),{...shiftRow(44),cashierUserId:22},{...shiftRow(45),branchId:8}];
    const fetcher=vi.fn(async()=>Response.json([]));vi.stubGlobal("fetch",fetcher);
    const view=mount();
    const fresh=screen.queryByTestId("button-scoped-open-shift");if(fresh)await userEvent.click(fresh);
    expect(fetcher.mock.calls.filter(([,i]:any[])=>i?.method==="POST")).toHaveLength(0);
    expect(screen.getByTestId("pos-shift-status").textContent).toBe("اختر الوردية");
    const select=screen.getByRole("combobox",{name:"اختر الوردية"});
    expect(select.textContent).toContain("SHIFT-42");expect(select.textContent).toContain("SHIFT-43");
    expect(select.textContent).not.toContain("SHIFT-44");expect(select.textContent).not.toContain("SHIFT-45");
    await userEvent.selectOptions(select,"43");
    expect(screen.getByTestId("pos-active-session-context").textContent).toContain("SHIFT-43");
    view.unmount();mount();
    expect(screen.getByTestId("pos-active-session-context").textContent).toContain("SHIFT-43");
    expect(screen.queryByTestId("button-scoped-open-shift")).toBeNull();
    expect(fetcher.mock.calls.filter(([,i]:any[])=>i?.method==="POST")).toHaveLength(0);
  });
  it("blocks a new opening while the session read is loading", async () => {
    sessionMock.status="closed"; sessionMock.loading=true;
    const fetcher=vi.fn(async()=>Response.json([])); vi.stubGlobal("fetch",fetcher);
    const view=mount();
    expect(screen.queryByTestId("button-scoped-open-shift")).toBeNull();
    expect(await screen.findByTestId("text-pos-session-checking")).toBeTruthy();
    expect(screen.getByTestId("pos-shift-status").textContent).toBe("جارٍ التحقق من الوردية");
    expect(fetcher.mock.calls.some(([url,init]:any[])=>String(url).endsWith("/pos/sessions")&&init?.method==="POST")).toBe(false);
    view.unmount();
    sessionMock.loading=false; sessionMock.status="open"; sessionMock.id=123;
    mount();
    expect(await screen.findByTestId("text-scoped-pos-ready")).toBeTruthy();
    expect(screen.getByTestId("pos-active-session-context").textContent).toContain("SHIFT-123");
    expect(screen.queryByTestId("button-scoped-open-shift")).toBeNull();
  });
  it("blocks a new opening after a failed session read and permits explicit recheck", async () => {
    sessionMock.status="closed"; sessionMock.error=true;
    const fetcher=vi.fn(async()=>Response.json([]));vi.stubGlobal("fetch",fetcher);
    mount();
    expect(screen.getByTestId("pos-shift-status").textContent).toBe("تعذر التحقق");
    expect(screen.queryByTestId("button-scoped-open-shift")).toBeNull();
    await userEvent.click(await screen.findByTestId("button-pos-session-recheck"));
    expect(sessionMock.refetch).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.filter(([,i]:any[])=>i?.method==="POST")).toHaveLength(0);
  });
  it("keeps saved opening recovery available despite a failed session read", async () => {
    sessionMock.error=true;
    const attempts: Array<{key: string|null; body: unknown}>=[];
    vi.stubGlobal("fetch",vi.fn(async (url:RequestInfo|URL,init?:RequestInit)=>{
      if(String(url).endsWith("/api/pos/sessions")&&init?.method==="POST"){
        attempts.push({key:new Headers(init.headers).get("Idempotency-Key"),body:JSON.parse(String(init.body))});
        return Response.json({id:123,branchId:7,status:"open",cashierUserId:11},{status:201});
      }
      return Response.json([]);
    }));
    // Use the same public persistence helper as the original opening interface.
    const { saveSessionIntent }=await import("@/lib/pos-session-intent");
    saveSessionIntent("11:21", {key:"saved-opening",body:{branchId:7,cashierName:"test",openingCash:12},responsibility:null});
    mount();
    expect(await screen.findByTestId("button-scoped-open-retry")).toBeTruthy();
    expect(screen.queryByTestId("button-scoped-open-shift")).toBeNull();
    await userEvent.click(screen.getByTestId("button-scoped-open-retry"));
    await waitFor(()=>expect(attempts).toHaveLength(1));
    expect(attempts[0]).toEqual({key:"saved-opening",body:{branchId:7,cashierName:"test",openingCash:12}});
    await waitFor(()=>expect(sessionStorage.getItem("hasba:pos-session-open:11:21")).toBeNull());
    expect(screen.queryByTestId("button-scoped-open-shift")).toBeNull();
  });
});
function saleTransport(fault?: "lost" | "502" | "malformed" | "incomplete" | "reject") {
  const attempts: Array<{ key: string; body: string }> = [];
  const committed = new Map<string, { id: number; orderNumber: string; total: number }>();
  const seals:Array<{requestKey:string;body:unknown}>=[];
  const closed=new Set<string>();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).split("?")[0].endsWith("/api/customers")) {
      return Response.json([{id:17,name:"عميل تجربة السوبرماركت"}]);
    }
    if(String(input).split("?")[0].endsWith("/api/pos/tax-preview/close-intent")&&init?.method==="POST"){
      const seal=JSON.parse(String(init.body));
      expect(seal.body).toEqual(JSON.parse(attempts.find(a=>a.key===seal.requestKey)!.body));
      seals.push(seal);
      const saved=committed.get(seal.requestKey);
      if(saved)return Response.json({state:"completed",result:{order:saved}});
      closed.add(seal.requestKey);
      return Response.json({state:"closed_without_execution"});
    }
    const preview = posPreviewServer(input, init, { prices: { 5: 100 }, token: `sale-${previews.length}`, log: previews });
    if (preview) return preview;
    if (!String(input).split("?")[0].endsWith("/api/pos/orders") || init?.method !== "POST") {
      return Response.json([]);
    }
    const key = new Headers(init.headers).get("Idempotency-Key");
    expect(key).toBeTruthy();
    const body = String(init.body);
    attempts.push({ key: key!, body });
    if(closed.has(key!))return Response.json({error:"sealed identity"},{status:409});
    if (attempts.length === 1 && fault === "reject") {
      sessionMock.status = "closed";
      return Response.json({ error: "الوردية مغلقة. افتح وردية جديدة قبل إتمام البيع." }, { status: 409 });
    }
    let row = committed.get(key!);
    if (!row) {
      row = { id: committed.size + 1, orderNumber: `ORD-TEST-${committed.size + 1}`, total: 100 };
      committed.set(key!, row);
    }
    if (attempts.length === 1) {
      if (fault === "lost") throw new TypeError("Connection dropped AFTER test commit");
      if (fault === "502") return new Response("Bad Gateway", { status: 502 });
      if (fault === "malformed") return new Response('{"id":', { status: 201, headers: { "Content-Type": "application/json" } });
      if (fault === "incomplete") return Response.json({ total: 100 }, { status: 201 });
    }
    return Response.json(row, { status: 201 });
  }));
  return { attempts, committed,seals };
}

function parkingTransport(failure?: "rejected" | "unknown" | "empty" | "delayed") {
  const sales = saleTransport();
  const original = globalThis.fetch;
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve});
  let parked: any[] = [];
  const parks: any[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split("?")[0];
    if (path.endsWith("/api/pos/orders/park") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)); parks.push(body);
      if(failure==="delayed")await gate;
      if (failure === "rejected") return Response.json({error:"رفض التعليق"},{status:409});
      parked = [{...body,id:71,requestId:new Headers(init.headers).get("Idempotency-Key"),orderNumber:"PARK-71",parkedLabel:body.label,createdAt:new Date().toISOString()}];
      if (failure === "unknown") throw new TypeError("Response lost after parking");
      if (failure === "empty") return new Response(null,{status:204});
      return Response.json(parked[0],{status:201});
    }
    if (path.endsWith("/api/pos/orders/parked")) return Response.json(parked);
    if (path.endsWith("/api/pos/orders/71/resume")) {
      const saved=parked[0];parked=[];return Response.json(saved);
    }
    return original(input,init);
  }));
  return {...sales,parks,release};
}

describe("one durable parking intent",()=>{
  async function prepare(u:ReturnType<typeof userEvent.setup>){
    await u.click(await screen.findByTestId("dock-customer"));
    await u.click(await screen.findByTestId("pos-customer-17"));
    await u.click(screen.getByTestId("product-icon-5"));
    await u.click(screen.getByTestId("dock-parking"));
  }
  it("sends only once when two clicks precede a delayed parking response",async()=>{
    const transport=parkingTransport("delayed"),u=userEvent.setup();mount();await prepare(u);
    const button=await screen.findByTestId("button-park-now");
    fireEvent.click(button);fireEvent.click(button);
    try{await waitFor(()=>expect(transport.parks).toHaveLength(1));}
    finally{transport.release();}
  });
  it("retains the basket and A after an empty204 rather than treating it as saved",async()=>{
    const transport=parkingTransport("empty"),u=userEvent.setup();mount();await prepare(u);
    await u.click(await screen.findByTestId("button-park-now"));
    await waitFor(()=>expect(transport.parks).toHaveLength(1));
    expect(screen.getByTestId("dock-customer").getAttribute("aria-label")).toBe("عميل تجربة السوبرماركت");
    expect(screen.getByTestId("cart-row-unit-5")).toBeTruthy();
  });
});

describe("parked customer belongs only to the parked basket",()=>{
  async function selectAndPark(u:ReturnType<typeof userEvent.setup>){
    await u.click(await screen.findByTestId("dock-customer"));
    await u.click(await screen.findByTestId("pos-customer-17"));
    await u.click(screen.getByTestId("product-icon-5"));
    await u.click(screen.getByTestId("dock-parking"));
    await u.click(await screen.findByTestId("button-park-now"));
    await u.click(screen.getByTestId("overlay-parked"));
  }
  it("parks A, sells anonymously, then resumes and sells A without another sale at parking",async()=>{
    const transport=parkingTransport(),u=userEvent.setup(),view=mount();
    await selectAndPark(u);
    await waitFor(()=>expect(transport.parks).toHaveLength(1));
    expect(transport.parks[0].customerId).toBe(17);
    expect(transport.attempts).toHaveLength(0);
    expect(screen.getByTestId("dock-customer").getAttribute("aria-label")).toBe(ar.pos_iconic.customer);
    await u.click(screen.getByTestId("product-icon-5"));await review(u);
    await u.click(screen.getByTestId("button-pay-rail"));
    await screen.findByText("ORD-TEST-1");
    expect(JSON.parse(transport.attempts[0].body)).not.toHaveProperty("customerId");
    view.unmount();mount();
    await u.click(await screen.findByTestId("dock-parking"));
    await u.click(await screen.findByTestId("button-resume-71"));
    await waitFor(()=>expect(screen.getByTestId("dock-customer").getAttribute("aria-label")).toBe("عميل #17"));
    await review(u);await u.click(screen.getByTestId("button-pay-rail"));
    await screen.findByText("ORD-TEST-2");
    expect(JSON.parse(transport.attempts[1].body).customerId).toBe(17);
    expect(transport.committed.size).toBe(2);
    expect(transport.attempts[0].key).not.toBe(transport.attempts[1].key);
  });
  it.each(["rejected","unknown"]as const)("keeps A and the original basket when parking is %s",async(failure)=>{
    const transport=parkingTransport(failure),u=userEvent.setup();mount();
    await selectAndPark(u);
    await waitFor(()=>expect(transport.parks).toHaveLength(1));
    expect(screen.getByTestId("dock-customer").getAttribute("aria-label")).toBe("عميل تجربة السوبرماركت");
    await review(u);
    expect(screen.getByTestId("button-pay-rail").matches(":disabled")).toBe(true);
    expect(transport.attempts).toHaveLength(0);
    expect(previews.length).toBeGreaterThan(0);
  });
});

describe("POS inline tender and durable checkout recovery", () => {
  it("offers explicit branch selection and shift opening for an authorized unbound legacy owner",async()=>{
    sessionMock.status="closed";sessionMock.branchId=null;
    saleTransport();
    mount();
    expect(await screen.findByLabelText("فرع الوردية")).toBeTruthy();
    expect(screen.queryByTestId("button-scoped-open-shift")).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("فرع الوردية"), "7");
    expect(screen.getByTestId("button-scoped-open-shift")).toBeTruthy();
  });
  it("opens from the native branch picker with frozen cash and recovers the exact shift after a lost reply and reload",async()=>{
    sessionMock.status="closed";sessionMock.branchId=null;
    saleTransport();
    const baseFetch=globalThis.fetch;
    const attempts:Array<{key:string|null;body:string}>=[];
    const saved=new Map<string,object>();
    vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      if(!String(input).endsWith("/api/pos/sessions")||init?.method!=="POST")return baseFetch(input,init);
      const key=new Headers(init.headers).get("Idempotency-Key");
      attempts.push({key,body:String(init.body)});
      if(!saved.has(key!))saved.set(key!,{id:17,branchId:7,status:"open",cashierUserId:11,cashierName:"هوية الخادم",branchName:"فرع تجربة المالك",sessionNumber:"WRD-17"});
      sessionMock.status="open";sessionMock.id=17;
      if(attempts.length===1)throw new TypeError("reply lost AFTER commit");
      return Response.json(saved.get(key!),{status:201});
    }));
    const u=userEvent.setup(),view=mount();
    await u.selectOptions(await screen.findByLabelText("فرع الوردية"),"7");
    await u.type(screen.getByTestId("input-scoped-opening-cash"),"125.50");
    await u.dblClick(screen.getByTestId("button-scoped-open-shift"));
    expect(await screen.findByTestId("button-scoped-open-retry")).toBeTruthy();
    expect(attempts.length).toBe(1);
    const frozen=sessionStorage.getItem("hasba:pos-session-open:11:21");
    expect(JSON.parse(frozen!).body).toMatchObject({branchId:7,openingCash:125.5});
    view.unmount();mount();
    expect(sessionStorage.getItem("hasba:pos-session-open:11:21")).toBe(frozen);
    await u.click(await screen.findByTestId("button-scoped-open-retry"));
    await waitFor(()=>expect(sessionStorage.getItem("hasba:pos-session-open:11:21")).toBeNull());
    expect(attempts[1]).toEqual(attempts[0]);expect(saved.size).toBe(1);
    expect(screen.getByTestId("pos-active-session-context").textContent).toContain("الوردية مفتوحة");
  });
  it.each(["-1","abc","0.001","100000000"])("rejects invalid opening cash %s without an HTTP attempt",async(cash)=>{
    sessionMock.status="closed";saleTransport();mount();
    const u=userEvent.setup();
    await u.type(await screen.findByTestId("input-scoped-opening-cash"),cash);
    await u.click(screen.getByTestId("button-scoped-open-shift"));
    expect(sessionStorage.getItem("hasba:pos-session-open:11:21")).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([input,init])=>String(input).endsWith("/pos/sessions")&&init?.method==="POST")).toBe(false);
  });
  it("shows denial, empty branch and loading failure reasons without choosing a branch",async()=>{
    sessionMock.status="closed";sessionMock.branchId=null;sessionMock.role="auditor";saleTransport();
    let v=mount();
    expect(await screen.findByTestId("text-scoped-no-shift-permission")).toBeTruthy();
    expect(screen.queryByLabelText("فرع الوردية")).toBeNull();
    v.unmount();sessionMock.role="owner";sessionMock.branchOptions=[];v=mount();
    expect(await screen.findByText(/لا توجد فروع نشطة متاحة/)).toBeTruthy();
    v.unmount();sessionMock.branchError=true;mount();
    expect(await screen.findByText(/تعذر التحقق من فروعك المسموحة/)).toBeTruthy();
  });
  it("shows the existing shift-opening control to an authorized legacy cashier assigned to a branch",async()=>{
    sessionMock.status="closed";sessionMock.branchId=7;
    saleTransport();
    mount();
    expect((await screen.findByTestId("button-scoped-open-shift")).isConnected).toBe(true);
    expect(screen.getByTestId("input-scoped-opening-cash")).toBeTruthy();
  });
  it("selects a tender inside the cart, without a fullscreen selector, and records a sale", async () => {
    const transport = saleTransport();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId("product-icon-5"));
    expect(screen.getByTestId("button-pay-cash").isConnected).toBe(true);
    expect(screen.queryByTestId("overlay-payment")).toBeNull();
    await user.click(screen.getByTestId("button-pay-cash"));
    await review(user);
    await user.click(screen.getByTestId("button-pay-rail"));
    expect((await screen.findByText("ORD-TEST-1")).isConnected).toBe(true);
    expect(JSON.parse(transport.attempts[0].body)).toMatchObject({
      sessionId: 9, paymentMethod: "cash", items: [{ productId: 5, quantity: 1 }],
    });
    // Legacy authoritative quote: preview token only, never a context token.
    expect(JSON.parse(transport.attempts[0].body).taxPreviewToken).toMatch(/^pv-sale-\d+$/);
    expect(JSON.parse(transport.attempts[0].body)).not.toHaveProperty("taxContextToken");
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(screen.getByText(ar.pos_iconic.cart_empty).isConnected).toBe(true);
  });
  it("selects the customer through the native dock and sends its identity with the sale",async()=>{
    const transport=saleTransport(),u=userEvent.setup();mount();
    await u.click(await screen.findByTestId("dock-customer"));
    await u.click(await screen.findByTestId("pos-customer-17"));
    expect(screen.getByTestId("dock-customer").getAttribute("aria-label")).toBe("عميل تجربة السوبرماركت");
    await u.click(screen.getByTestId("product-icon-5"));await review(u);
    await u.click(screen.getByTestId("button-pay-rail"));
    await screen.findByText("ORD-TEST-1");
    expect(JSON.parse(transport.attempts[0].body).customerId).toBe(17);
    expect(transport.committed.size).toBe(1);
  });
  it("freezes the selected customer in an unknown attempt and recovers the same identity after reload",async()=>{
    const transport=saleTransport("lost"),u=userEvent.setup();const v=mount();
    await u.click(await screen.findByTestId("dock-customer"));
    await u.click(await screen.findByTestId("pos-customer-17"));
    await u.click(screen.getByTestId("product-icon-5"));await review(u);
    await u.click(screen.getByTestId("button-pay-rail"));
    await waitFor(()=>expect(transport.attempts).toHaveLength(1));
    await waitFor(()=>expect(screen.getByTestId("dock-customer").matches(":disabled")).toBe(true));
    const saved=JSON.parse(sessionStorage.getItem(storageKey)!);
    expect(saved.body.customerId).toBe(17);v.unmount();mount();
    await u.click(await screen.findByTestId("button-pay-rail"));
    await screen.findByText("ORD-TEST-1");
    expect(transport.attempts).toHaveLength(2);
    expect(transport.attempts[1]).toEqual(transport.attempts[0]);
    expect(transport.committed.size).toBe(1);
  });

  it.each(["lost", "502", "malformed", "incomplete"] as const)(
    "freezes and restores the same cart and key across a reload after %s",
    async (fault) => {
      const transport = saleTransport(fault);
      const user = userEvent.setup();
      const view = mount();
      await user.click(await screen.findByTestId("product-icon-5"));
      await user.click(screen.getByTestId("button-pay-cash"));
      await review(user);
      await user.click(screen.getByTestId("button-pay-rail"));
      expect((await screen.findByRole("alert")).textContent).toContain("تعذر تأكيد نتيجة البيع");
      expect(screen.getByTestId("button-pay-card").matches(":disabled")).toBe(true);
      await user.click(screen.getByTestId("product-icon-5")); // must not change frozen cart
      const previewsWhileFrozen = previews.length;
      view.unmount();
      mount();
      await waitFor(() => expect(screen.getByTestId("button-pay-rail").textContent).toContain("استرجاع نتيجة البيع"));
      await user.click(screen.getByTestId("button-pay-rail"));
      expect((await screen.findByText("ORD-TEST-1")).isConnected).toBe(true);
      expect(transport.attempts).toHaveLength(2);
      expect(transport.attempts[1]).toEqual(transport.attempts[0]);
      expect(transport.committed.size).toBe(1);
      // No re-quote while the unknown attempt existed; its original token was resent.
      expect(previews.length).toBe(previewsWhileFrozen);
      // Intentional identical NEXT sale gets a fresh key after confirmation.
      await user.click(screen.getByTestId("product-icon-5"));
      await review(user);
      await user.click(screen.getByTestId("button-pay-rail"));
      await waitFor(() => expect(transport.committed.size).toBe(2));
      expect(transport.attempts[2].key).not.toBe(transport.attempts[0].key);
    },
  );

  it("retains a quoted rejection until server sealing, then permits a new shift and identity", async () => {
    const transport = saleTransport("reject");
    const user = userEvent.setup();
    const view = mount();
    await user.click(await screen.findByTestId("product-icon-5"));
    await review(user);
    await user.click(screen.getByTestId("button-pay-rail"));
    expect((await screen.findByRole("alert")).textContent).toContain("الوردية مغلقة");
    expect(screen.getByTestId("button-pay-cash").matches(":disabled")).toBe(true);
    expect(JSON.parse(sessionStorage.getItem(storageKey)!).key).toBe(transport.attempts[0].key);
    expect(screen.queryByText(ar.pos_iconic.cart_empty)).toBeNull();
    expect(screen.getByTestId("pos-shift-status").textContent).toBe("لا توجد وردية مفتوحة");
    expect(sessionMock.refetch).toHaveBeenCalled();
    await user.click(screen.getByTestId("button-pos-close-intent"));
    await waitFor(()=>expect(sessionStorage.getItem(storageKey)).toBeNull());
    expect(transport.seals).toHaveLength(1);
    expect(transport.committed.size).toBe(0);
    view.unmount();
    sessionMock.status = "open";
    sessionMock.id=10;
    mount();
    await user.click(await screen.findByTestId("product-icon-5"));
    await review(user);
    await user.click(screen.getByTestId("button-pay-rail"));
    expect((await screen.findByText("ORD-TEST-1")).isConnected).toBe(true);
    expect(transport.committed.size).toBe(1);
    expect(transport.attempts[1].key).not.toBe(transport.attempts[0].key);
    expect(JSON.parse(transport.attempts[1].body).sessionId).toBe(10);
  });

  it("keeps confirmed success recoverable if storage cleanup fails", async () => {
    const transport = saleTransport();
    const user = userEvent.setup();
    const original = Storage.prototype.removeItem;
    const cleanup = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
      if (key === storageKey) throw new DOMException("Synthetic cleanup fault", "SecurityError");
      return original.call(this, key);
    });
    mount();
    await user.click(await screen.findByTestId("product-icon-5"));
    await review(user);
    await user.click(screen.getByTestId("button-pay-rail"));
    expect((await screen.findByRole("alert")).textContent).toContain("تم تسجيل البيع بالفعل");
    expect(screen.getByTestId("button-pay-cash").matches(":disabled")).toBe(true);
    cleanup.mockRestore();
    await user.click(screen.getByTestId("button-pay-rail"));
    expect((await screen.findByText("ORD-TEST-1")).isConnected).toBe(true);
    expect(transport.committed.size).toBe(1);
    expect(transport.attempts[1]).toEqual(transport.attempts[0]);
  });

  it("does not send a sale when the pending snapshot cannot be persisted", async () => {
    const transport = saleTransport();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId("product-icon-5"));
    await review(user);
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Synthetic storage fault", "QuotaExceededError");
    });
    await user.click(screen.getByTestId("button-pay-rail"));
    expect((await screen.findByRole("alert")).textContent).toContain("لم يُرسل طلب جديد");
    expect(transport.attempts).toHaveLength(0);
    write.mockRestore();
  });

  it("separates saved attempts by user/company and refuses to erase corrupt state", async () => {
    const transport = saleTransport("lost");
    const cart = [{ product: { id: 5, name: "منتج", price: 100 }, quantity: 1 }];
    const body = { sessionId: 9, items: [{ productId: 5, quantity: 1 }], paymentMethod: "cash" as const };
    const hook = renderHook(({ scope }) => usePosCheckout(scope), { initialProps: { scope: "11:21" } });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await act(() => hook.result.current.pay(body, cart));
    hook.rerender({ scope: "11:22" });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    expect(hook.result.current.attempt).toBeNull();
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
    sessionStorage.setItem("hasba:pos-checkout:11:23", "invalid saved intent");
    hook.rerender({ scope: "11:23" });
    await waitFor(() => expect(hook.result.current.error).toContain("تعذر قراءة"));
    expect(hook.result.current.ready).toBe(false);
    await act(() => hook.result.current.pay(body, cart));
    expect(transport.attempts).toHaveLength(1);
    expect(sessionStorage.getItem("hasba:pos-checkout:11:23")).toBe("invalid saved intent");
  });
});

describe("POS confirmed receipt printing", () => {
  it("keeps the saved order receipt action after cart clear and prints by actual saved ID", async () => {
    saleTransport();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId("product-icon-5"));
    await review(user);
    await user.click(screen.getByTestId("button-pay-rail"));
    const panel = await screen.findByTestId("panel-last-receipt");
    expect(panel.textContent).toContain("ORD-TEST-1");
    expect(screen.getByText(ar.pos_iconic.cart_empty).isConnected).toBe(true);
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockClear();
    await user.click(screen.getByTestId("button-print-receipt"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => {
      const request=new URL(String(u),"https://test.invalid");
      return request.pathname.endsWith("/api/pos/orders/1/receipt.pdf")&&request.searchParams.get("intent")==="file_generated"&&
        !!request.searchParams.get("eventId");
    })).toBe(true));
    expect(fetchMock.mock.calls.every(([, i]) => (i as RequestInit | undefined)?.method !== "POST")).toBe(true);
  });

  it("recovers the original saved order before offering a receipt", async () => {
    const transport = saleTransport("lost");
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId("product-icon-5"));
    await review(user);
    await user.click(screen.getByTestId("button-pay-rail"));
    await screen.findByRole("alert");
    expect(screen.queryByTestId("panel-last-receipt")).toBeNull();
    await user.click(screen.getByTestId("button-pay-rail"));
    expect((await screen.findByTestId("panel-last-receipt")).textContent).toContain("ORD-TEST-1");
    expect(transport.committed.size).toBe(1);
  });
});
