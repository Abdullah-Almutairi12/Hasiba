/** Isolated native-UI evidence proxy. Never imported by the application. */
import "reflect-metadata";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {createServer,request} from "node:http";
import {createHash} from "node:crypto";
import {resolve} from "node:path";
import assert from "node:assert/strict";
const state=JSON.parse(readFileSync("/tmp/hasba-browser-state.json","utf8"));
const url=new URL(state.env.TEST_DATABASE_URL);
assert.equal(url.hostname,"127.0.0.1");assert.equal(url.username,"hasba_test");
assert.equal(url.pathname,"/hasba_test_verify");assert.ok(url.port);
assert.equal(state.env.DATABASE_URL,state.env.TEST_DATABASE_URL);
assert.equal(state.env.ACCOUNT_ISOLATED_TEST,"true");
Object.assign(process.env,state.env,{NODE_ENV:"test",VITEST:"true",LOG_LEVEL:"error",
  SMTP_HOST:"",SMTP_USER:"",SMTP_PASS:"",SENTRY_DSN:"",OPENAI_API_KEY:"",AI_INTEGRATIONS_OPENAI_API_KEY:""});
const {pool}=await import("@workspace/db");
const account=state.accounts.find((a:{role:string,posSession?:unknown})=>a.role==="owner"&&a.posSession);
assert.ok(account);
const summaryRefresh=process.argv.includes("--summary-refresh");
const discountFixes=summaryRefresh||process.argv.includes("--discount-fixes");
const dir=process.env.HASBA_MEETING_EVIDENCE==="true"?resolve(import.meta.dirname,"../../../../generated-artifacts/meeting-readiness/sales"):resolve(import.meta.dirname,summaryRefresh?"../../../../generated-artifacts/sales-summary-refresh":discountFixes?
  "../../../../generated-artifacts/sales-order-discount-fixes":"../../../../generated-artifacts/sales-order-pricing");
mkdirSync(dir,{recursive:true});
const file=resolve(dir,"browser-proxy.json");
const q=async(s:string,p:unknown[]=[]) => (await pool.query(s,p)).rows;
async function snapshot(query=q){
  const id=account.companyId;
  return {
    orders:await query("SELECT id,reference,total,pricing_basis,status,created_by FROM sales_orders WHERE company_id=$1 ORDER BY id",[id]),
    lines:await query(`SELECT l.* FROM sales_order_lines l JOIN sales_orders s ON s.id=l.so_id WHERE s.company_id=$1 ORDER BY l.id`,[id]),
    invoices:await query("SELECT id,reference,total,subtotal,discount,vat,so_id,applied_discounts FROM customer_invoices WHERE company_id=$1 ORDER BY id",[id]),
    quants:await query("SELECT quantity,avg_cost FROM stock_quants WHERE product_id=$1",[account.productId]),
    layers:await query("SELECT remaining_qty,unit_cost FROM stock_layers WHERE product_id=$1",[account.productId]),
    moves:await query("SELECT id,kind,quantity,unit_cost,journal_entry_id FROM stock_moves WHERE product_id=$1 ORDER BY id",[account.productId]),
    journals:await query("SELECT id,reference,status FROM journal_entries WHERE company_id=$1 ORDER BY id",[id]),
    ledger:await query(`SELECT a.system_key,sum(l.debit-l.credit)::text AS balance FROM journal_entries e
      JOIN journal_entry_lines l ON l.entry_id=e.id JOIN accounts a ON a.id=l.account_id
      WHERE e.company_id=$1 GROUP BY a.system_key ORDER BY a.system_key`,[id]),
    unbalanced:await query(`SELECT e.id FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id=e.id
      WHERE e.company_id=$1 GROUP BY e.id HAVING sum(l.debit-l.credit)<>0`,[id]),
    receipts:await query("SELECT operation,request_key,result->'value' AS value FROM financial_requests WHERE company_id=$1",[id]),
    sellers:await query("SELECT employee_id,seller_name,invoice_id,invoice_line_id FROM invoice_seller_lines WHERE company_id=$1 ORDER BY invoice_id,invoice_line_id",[id]),
    identities:await query("SELECT document_kind,document_id,issuer->'saleIdentity' AS identity,issuer->'taxCalculation' AS tax FROM document_issuer_snapshots WHERE company_id=$1",[id]),
  };
}
if(discountFixes&&process.argv.includes("--penny-setup")){
  await q("UPDATE discount_rules SET is_active=(scope='order') WHERE name LIKE 'SO-FIX-%'");
  console.log("[so-browser] isolated penny fixture activated; no document API invoked");
  await pool.end();process.exit(0);
}
if(process.argv.includes("--capture")){
  const c=await pool.connect();
  try{
    await c.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const saved=JSON.parse(readFileSync(file,"utf8"));
    const current=await snapshot(async(s,p=[]) => (await c.query(s,p)).rows);
    const multiple=discountFixes&&!summaryRefresh;
    assert.equal(current.orders.length,multiple?2:1);assert.equal(current.invoices.length,multiple?5:2);
    assert.deepEqual(current.invoices.map(i=>Number(i.total)).sort((a,b)=>a-b),
      summaryRefresh?[114.67,229.33]:multiple?[.99,.99,1,114.67,229.33]:[115,230]);
    assert.equal(current.lines.reduce((s,l)=>s+Number(l.invoiced_qty),0),multiple?6:3);
    assert.equal(current.lines.reduce((s,l)=>s+Number(l.delivered_qty),0),multiple?6:3);
    assert.equal(current.quants.reduce((s,l)=>s+Number(l.quantity),0),multiple?14:17);
    assert.equal(current.quants.reduce((s,l)=>s+Number(l.quantity)*Number(l.avg_cost),0),multiple?700:850);
    assert.equal(current.layers.reduce((s,l)=>s+Number(l.remaining_qty),0),multiple?14:17);
    assert.equal(current.layers.reduce((s,l)=>s+Number(l.remaining_qty)*Number(l.unit_cost),0),multiple?700:850);
    const balance=(key:string)=>Number(current.ledger.find(l=>l.system_key===key)?.balance??0);
    assert.equal(balance("inventory"),multiple?700:850);assert.equal(balance("cogs"),multiple?300:150);
    assert.equal(balance("ar"),summaryRefresh?344:multiple?346.98:345);
    assert.equal(balance("vat_output"),summaryRefresh?-44.87:multiple?-45.26:-45);
    assert.equal(balance("sales_revenue"),multiple?-302.61:-300);assert.deepEqual(current.unbalanced,[]);
    const issued=saved.events.filter((e:{kind:string})=>e.kind==="invoice");
    const replay=summaryRefresh?1:0;
    assert.equal(issued.length,multiple?6:3);assert.equal(issued[replay].droppedAfterCommit,true);
    assert.equal(issued[replay].key,issued[replay+1].key);assert.equal(issued[replay].bodyHash,issued[replay+1].bodyHash);
    assert.equal(issued[replay].id,issued[replay+1].id);
    assert.deepEqual(issued[replay].after,issued[replay+1].after);
    assert.equal(current.sellers.length,multiple?5:2);
    const invoices=current.invoices.map(i=>i.id);
    assert.equal(current.receipts.filter(r=>invoices.includes(r.value?.inv?.id)).length,multiple?5:2);
    if(summaryRefresh){
      assert.equal(Number(current.lines[0].discount_pct),.2899);
      assert.equal(current.moves.filter(m=>m.kind==="issue").length,1);
      assert.equal(balance("sales_discount"),.87);
      for(const expected of [114.67,344])assert.ok(saved.events.some((e:{kind:string;value?:{invoices?:{thisMonth:number}};independent?:{total:string}})=>
        e.kind==="summary"&&e.value?.invoices?.thisMonth===expected&&Number(e.independent?.total)===expected));
    }
    if(multiple){
      assert.equal(Number(current.lines[0].discount_pct),.2899);
      const sources=new Map<number,number>();
      for(const inv of current.invoices.slice(2)){
        const allocation=current.identities.find(d=>d.document_kind==="invoice"&&d.document_id===inv.id)!.tax.discountAllocation.lines[0];
        assert.equal(allocation.manualGrossDiscount,0);assert.equal(allocation.grossDiscount,Number(inv.discount));
        for(const a of inv.applied_discounts){assert.ok(a.amount>=0);sources.set(a.id,(sources.get(a.id)??0)+Math.round(a.amount*100));}
        assert.equal(inv.applied_discounts.reduce((n:number,a:{amount:number})=>n+Math.round(a.amount*100),0),Math.round(Number(inv.discount)*100));
      }
      assert.deepEqual([...sources.values()],[1,1]);
      assert.equal(current.moves.filter(m=>m.kind==="issue").length,2);
      assert.equal(balance("sales_discount"),.89);
    }
    writeFileSync(resolve(dir,"browser-reconciliation.json"),JSON.stringify({passed:true,source:saved.source,current},null,2));
    console.log("[so-browser] independent reconciliation passed");
  }finally{await c.query("ROLLBACK");c.release();await pool.end();}
  process.exit(0);
}
const {default:app,assertApplicationReady}=await import("../app");
await assertApplicationReady();
if(discountFixes){
  const {db,discountRulesTable}=await import("@workspace/db");
  await q("UPDATE discount_rules SET is_active=false");
  await q("DELETE FROM discount_rules WHERE name LIKE 'SO-FIX-%'");
  await db.insert(discountRulesTable).values([
    {name:"SO-FIX-LINE",nameAr:"إثبات خصم البند ريال",reasonCode:"test",kind:"fixed",scope:"line",value:"1",isActive:true,accountSystemKey:"sales_discount"},
    {name:"SO-FIX-PENNY-A",nameAr:"إثبات قاعدة الهللة ألف",reasonCode:"test",kind:"fixed",scope:"order",value:".01",isActive:false,accountSystemKey:"sales_discount"},
    {name:"SO-FIX-PENNY-B",nameAr:"إثبات قاعدة الهللة باء",reasonCode:"test",kind:"fixed",scope:"order",value:".01",isActive:false,accountSystemKey:"sales_discount"},
  ]);
}
const {verificationSource}=await import(new URL("../../../../scripts/verification-source.mjs",import.meta.url).href);
const evidence={source:await verificationSource(resolve(import.meta.dirname,"../../../..")),baseline:await snapshot(),
  events:[] as Record<string,unknown>[]};
let dropped=false;
const save=()=>writeFileSync(file,JSON.stringify(evidence,null,2));
const backend=app.listen(0,"127.0.0.1");
await new Promise<void>(r=>backend.once("listening",r));
const address=backend.address();assert.ok(address&&typeof address!=="string");
const hash=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const proxy=createServer((req,res)=>{
  const chunks:Buffer[]=[];req.on("data",c=>chunks.push(c));req.on("end",()=>{
    const body=Buffer.concat(chunks),key=String(req.headers["idempotency-key"]??"");
    const upstream=request({hostname:"127.0.0.1",port:address.port,method:req.method,path:req.url,headers:req.headers},r=>{
      const chunks:Buffer[]=[];r.on("data",c=>chunks.push(c));r.on("end",async()=>{
        const bytes=Buffer.concat(chunks);
        if(req.method==="POST"&&req.url?.split("?")[0]==="/api/sales/invoices"){
          const [receipt]=await q("SELECT result->'value' AS value FROM financial_requests WHERE company_id=$1 AND request_key=$2",
            [account.companyId,key]);
          const after=await snapshot(),willDrop=!dropped&&r.statusCode===201&&!!receipt?.value?.inv?.id&&
            (!summaryRefresh||evidence.events.filter(e=>e.kind==="invoice"&&e.status===201).length===1);
          evidence.events.push({kind:"invoice",key,bodyHash:hash(body),id:receipt?.value?.inv?.id,status:r.statusCode,
            droppedAfterCommit:willDrop,after});
          save();
          if(willDrop){dropped=true;res.writeHead(502,{"content-type":"application/json"});
            res.end(JSON.stringify({error:"Synthetic lost response AFTER durable commit"}));return;}
        }
        if(summaryRefresh&&req.method==="GET"&&req.url?.split("?")[0]==="/api/sales/reports/summary"&&r.statusCode===200){
          const [independent]=await q(`SELECT coalesce(sum(total::numeric),0)::text AS total,
            array_agg(id ORDER BY id) AS invoice_ids FROM customer_invoices WHERE company_id=$1
            AND status IN ('open','partially_paid','paid')
            AND invoice_date >= date_trunc('month',now() AT TIME ZONE 'Asia/Riyadh')::date
            AND invoice_date < (date_trunc('month',now() AT TIME ZONE 'Asia/Riyadh')+interval '1 month')::date`,
            [account.companyId]);
          evidence.events.push({kind:"summary",value:JSON.parse(bytes.toString()),independent});save();
        }
        if(req.method==="GET"&&/^\/src\/.*\.(tsx?|css)(\?|$)/.test(req.url??"")){
          evidence.events.push({kind:"served-module",path:req.url,sha256:hash(bytes)});save();
        }
        res.writeHead(r.statusCode??502,r.headers);res.end(bytes);
      });
    });
    upstream.on("error",()=>{res.writeHead(502);res.end("isolated upstream unavailable");});
    upstream.end(body);
  });
});
proxy.listen(8080,"0.0.0.0",()=>{save();console.log("[so-browser] isolated API proxy ready:8080");});
const shutdown=()=>{proxy.close();backend.close();void pool.end().then(()=>process.exit(0));};
process.on("SIGTERM",shutdown);process.on("SIGINT",shutdown);
