/** Isolated read-only browser acceptance host. Never imported by the app.
 * Policy publication below is service-level fixture setup, NOT live activation.
 * The real HTTP publishing gate remains blocked even in this harness. */
import "reflect-metadata";
import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {randomUUID,createHash} from "node:crypto";
import type {Request} from "express";
const root=resolve(import.meta.dirname,"../../../..");
const dir=resolve(root,process.env.HASBA_MEETING_EVIDENCE==="true"?
  "generated-artifacts/meeting-readiness/identity":"generated-artifacts/tax-identity-continuation");
mkdirSync(dir,{recursive:true});
const state=JSON.parse(readFileSync("/tmp/hasba-browser-state.json","utf8"));
const url=new URL(state.env.TEST_DATABASE_URL);
assert.equal(url.hostname,"127.0.0.1");assert.equal(url.username,"hasba_test");
assert.equal(url.pathname,"/hasba_test_verify");assert.ok(url.port);
assert.equal(state.env.DATABASE_URL,state.env.TEST_DATABASE_URL);
assert.equal(state.env.ACCOUNT_ISOLATED_TEST,"true");
Object.assign(process.env,state.env,{NODE_ENV:"test",VITEST:"true",LOG_LEVEL:"error",
  SMTP_HOST:"",SMTP_USER:"",SMTP_PASS:"",SENTRY_DSN:"",OPENAI_API_KEY:"",AI_INTEGRATIONS_OPENAI_API_KEY:""});
const {db,pool}=await import("@workspace/db");
const q=async(s:string,p:unknown[]=[]) => (await pool.query(s,p)).rows;
async function snapshot(query=q){
  const data:Record<string,unknown>={};
  for(const table of ["stock_quants","stock_layers","stock_moves","journal_entries","journal_entry_lines",
    "document_issuer_snapshots","customer_invoices","customer_invoice_lines","financial_requests"])
    data[table]=await query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`);
  return data;
}
if(process.argv.includes("--capture")){
  const client=await pool.connect();
  try{
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const before=JSON.parse(readFileSync(resolve(dir,"browser-baseline.json"),"utf8"));
    const after=await snapshot(async(s,p=[]) => (await client.query(s,p)).rows);
    assert.deepEqual(after,before);
    const summaries=await client.query(`SELECT
      (SELECT sum(quantity*avg_cost) FROM stock_quants) AS inventory,
      (SELECT sum(remaining_qty*unit_cost) FROM stock_layers) AS layers,
      (SELECT sum(l.debit-l.credit) FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
        WHERE a.system_key='inventory') AS inventory_ledger,
      (SELECT count(*) FROM document_issuer_snapshots) AS historical_snapshots`);
    assert.ok(Number(summaries.rows[0].historical_snapshots)>0);
    // Average/standard products do not require FIFO layers. Reconcile each
    // product according to its existing valuation method, never manufacture
    // layers or change the fixture's method to make evidence pass.
    const valuation=await client.query(`SELECT p.id,p.costing_method,
      coalesce((SELECT sum(quantity*avg_cost) FROM stock_quants WHERE product_id=p.id),0) AS carrying,
      coalesce((SELECT sum(remaining_qty*unit_cost) FROM stock_layers WHERE product_id=p.id),0) AS layers
      FROM products p ORDER BY p.id`);
    for(const product of valuation.rows){
      if(product.costing_method==="fifo")assert.equal(Number(product.carrying),Number(product.layers));
    }
    assert.equal(Number(summaries.rows[0].inventory),Number(summaries.rows[0].inventory_ledger));
    await client.query("COMMIT");
    writeFileSync(resolve(dir,"browser-reconciliation.json"),JSON.stringify({
      at:new Date().toISOString(),passed:true,readOnlySnapshot:true,unchangedTables:Object.keys(after),
      summary:summaries.rows[0],valuation:valuation.rows,
      beforeSha256:createHash("sha256").update(JSON.stringify(before)).digest("hex"),
      afterSha256:createHash("sha256").update(JSON.stringify(after)).digest("hex"),
    },null,2));
  }finally{client.release();await pool.end();}
  process.exit(0);
}
const {default:app,assertApplicationReady}=await import("../app");
await assertApplicationReady();
const meeting=process.env.HASBA_MEETING_EVIDENCE==="true";
// Keep the sales-demo company on its original legacy policy. Demonstrate the
// gated dated policy in the SECOND synthetic company, not by unlocking HTTP.
const account=state.accounts.find((a:{role:string})=>a.role===(meeting?"sales":"owner"));
assert.ok(account,"An isolated account fixture is required");
if(meeting){
  await q("UPDATE users SET role='owner' WHERE email=$1",[account.email]);
  await q(`UPDATE user_companies SET role='owner' WHERE company_id=$1
    AND user_id=(SELECT id FROM users WHERE email=$2)`,[account.companyId,account.email]);
}else assert.ok(account.receiptInvoice,"--receipts fixture is required");
const {captureIssuer,saveIssuer,documentIssuer}=await import("../lib/document-identity");
if(!meeting)await db.transaction(async tx=>{
  await saveIssuer(tx,"invoice",account.receiptInvoice.id,await captureIssuer(tx,account.companyId));
});
const before=await snapshot();
writeFileSync(resolve(dir,"browser-baseline.json"),JSON.stringify(before,null,2));
const request=(await import("supertest")).default;
const agent=request.agent(app);
assert.equal((await agent.post("/api/auth/login").send({email:account.email,password:account.password})).status,200);
const [u]=await q("SELECT id FROM users WHERE email=$1",[account.email]);
await q(`INSERT INTO company_administrators(company_id,user_id,responsibilities)
  VALUES($1,$2,ARRAY['tax','settings','administrators'])
  ON CONFLICT(company_id,user_id) DO UPDATE SET active=true,responsibilities=EXCLUDED.responsibilities`,[account.companyId,u.id]);
await q(`INSERT INTO branches(company_id,name,name_ar,city)
  VALUES($1,'Identity second branch','فرع الهوية الثاني','جدة')`,[account.companyId]);
if(meeting)await q(`INSERT INTO branches(company_id,name,name_ar,city)
  VALUES($1,'Identity first branch','فرع الهوية الأول','الرياض')`,[account.companyId]);
const [session]=await q(`SELECT sess FROM "session" WHERE sess->>'userId'=$1 ORDER BY expire DESC LIMIT 1`,[String(u.id)]);
const req={session:{...session.sess,save:(cb:()=>void)=>cb()},headers:{},ip:"198.51.100.240",
  get:()=>undefined} as unknown as Request;
const {taxPolicySchema,publishTaxPolicy,riyadhDate}=await import("../lib/vat-policy");
const input=taxPolicySchema.parse({revision:0,requestId:randomUUID(),effectiveFrom:riyadhDate(),
  status:"registered",vatNumber:"300000000000003",priceIncludesVat:true,
  productRules:[{productId:account.productId,rule:{category:"standard"}}],
  serviceRule:{category:"standard"},reason:"إثبات هوية مصطنعة فقط، لا تسجيل أو تفعيل إنتاجي",
  proof:{currentPassword:account.password}});
await publishTaxPolicy(req,input);
await publishTaxPolicy(req,{...input,requestId:randomUUID(),revision:1,effectiveFrom:"2099-01-01",
  status:"not_registered",vatNumber:null,priceIncludesVat:false});
assert.deepEqual(await snapshot(),before);
if(!meeting)assert.deepEqual(await documentIssuer(account.companyId,"invoice",account.receiptInvoice.id),
  (before.document_issuer_snapshots as {row:{issuer:unknown}}[])[0].row.issuer);
const {verificationSource}=await import(new URL("../../../../scripts/verification-source.mjs",import.meta.url).href);
const source=await verificationSource(root);
writeFileSync(resolve(dir,"browser-setup.json"),JSON.stringify({at:new Date().toISOString(),source,
  setup:"Real service publication into disposable PostgreSQL; live HTTP route remains gated",
  companyId:account.companyId,currentRevision:1,futureRevision:2,futureDate:"2099-01-01",
  historicalDocumentsUnchanged:true},null,2));
app.listen(8080,"0.0.0.0",()=>console.log("[tax-identity-browser] isolated original API ready:8080"));
