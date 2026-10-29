/** Disposable native-UI evidence harness. Never imported by the application.
 * Stop the normal API workflow first; restore it after this proxy is stopped. */
import "reflect-metadata";
import {readFileSync,writeFileSync,mkdirSync,existsSync,unlinkSync} from "node:fs";
import {createServer,request} from "node:http";
import {createHash,randomUUID} from "node:crypto";
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
const account=state.accounts.find((a:{role:string;posSession?:unknown})=>a.role==="owner"&&a.posSession);
assert.ok(account,"--browser --pos --tax-preview fixtures required");
const cid=account.companyId,pid=account.productId;
const dir=resolve(import.meta.dirname,"../../../../generated-artifacts/tax-preview-slice");
mkdirSync(dir,{recursive:true});
const reportPath=resolve(dir,"browser-proxy.json");
const classicMarker="/tmp/hasba-tax-preview-classic";
const q=async(s:string,p:unknown[]=[]) => (await pool.query(s,p)).rows;

if(process.argv.includes("--classic")){
  await q("UPDATE companies SET business_type='services' WHERE id=$1",[cid]);
  await q("UPDATE products SET price=115 WHERE id=$1",[pid]);
  writeFileSync(classicMarker,"synthetic-only",{mode:0o600});
  await pool.end();process.exit(0);
}
if(process.argv.includes("--capture")){
  const {reconcileTaxPreviewBrowser}=await import("./tax-preview-reconciliation");
  const result=await reconcileTaxPreviewBrowser(pool,cid,pid);
  writeFileSync(resolve(dir,"browser-reconciliation.json"),JSON.stringify(result,null,2));
  console.log("[tax-preview-browser] Independent SQL reconciliation captured.");
  await pool.end();process.exit(0);
}
const {default:app,assertApplicationReady}=await import("../app");
if(existsSync(classicMarker))unlinkSync(classicMarker);
await assertApplicationReady();
const {verificationSource}=await import(new URL("../../../../scripts/verification-source.mjs",import.meta.url).href);
const evidence={source:await verificationSource(resolve(import.meta.dirname,"../../../..")),
  companyId:cid,productId:pid,events:[] as Record<string,unknown>[]};
const save=()=>writeFileSync(reportPath,JSON.stringify(evidence,null,2));
const hash=(s:string|Buffer)=>createHash("sha256").update(s).digest("hex");
const policy=async(status:string,inclusive:boolean)=>{
  await q(`INSERT INTO company_tax_policy_versions(company_id,revision,request_id,request_hash,effective_from,
    status,vat_number,price_includes_vat,product_rules,service_rule,legacy_state,reason,created_by)
    SELECT company_id,revision+1,$2,'synthetic-native-drift',effective_from,$3,
      CASE WHEN $3='registered' THEN vat_number ELSE NULL END,$4,
      product_rules,service_rule,legacy_state,'Synthetic native preview drift',created_by
    FROM company_tax_policy_versions WHERE company_id=$1 ORDER BY revision DESC LIMIT 1`,
    [cid,randomUUID(),status,inclusive]);
};
let posQuotes=0,invoiceQuotes=0,posSaved=0,invoiceSaved=0,classicDropped=false;
const backend=app.listen(0,"127.0.0.1");
await new Promise<void>(done=>backend.once("listening",done));
const address=backend.address();assert.ok(address&&typeof address!=="string");
const proxy=createServer((req,res)=>{
  const chunks:Buffer[]=[];
  req.on("data",c=>chunks.push(c));
  req.on("end",()=>{
    const body=Buffer.concat(chunks),path=req.url?.split("?")[0];
    const upstream=request({hostname:"127.0.0.1",port:address.port,path:req.url,
      method:req.method,headers:req.headers},reply=>{
      const output:Buffer[]=[];
      reply.on("data",c=>output.push(c));
      reply.on("end",()=>void(async()=>{
        const bytes=Buffer.concat(output),status=reply.statusCode??502;
        const pos=path==="/api/pos/orders",invoice=path==="/api/sales/invoices";
        const financially=!!(req.method==="POST"&&(pos||invoice));
        let data:Record<string,any>|null=null;
        try{data=JSON.parse(bytes.toString());}catch{/* non-JSON passthrough */}
        if(req.method==="POST"&&status===200&&data?.previewToken){
          evidence.events.push({type:"preview",path,status,context:data.context,totals:data.totals,
            previewTokenHash:hash(data.previewToken),expiresAt:data.expiresAt});
          if(path==="/api/pos/tax-preview"&&++posQuotes===1){
            await q("UPDATE products SET price=230 WHERE id=$1",[pid]);
            evidence.events.push({type:"catalog_changed_after_preview_before_response",newPrice:230});
          }
          if(path==="/api/sales/invoices/tax-preview"&&++invoiceQuotes===1){
            await policy("registered",false);
            evidence.events.push({type:"policy_changed_after_preview_before_response",newPriceIncludesVat:false});
          }
        }
        if(financially){
          const key=String(req.headers["idempotency-key"]??"");
          evidence.events.push({type:"issue_response",path,status,key,bodyHash:hash(body),
            id:data?.id,total:data?.total,tax:data?.tax??data?.vat});
          if(status===201){
            const receipt=await q("SELECT operation,request_key,result->'value' AS result FROM financial_requests WHERE company_id=$1 AND request_key=$2",[cid,key]);
            assert.equal(receipt.length,1,"Commit must be evidenced BEFORE dropping response");
            evidence.events.push({type:"commit_proven",path,key,bodyHash:hash(body),operation:receipt[0].operation,
              documentId:receipt[0].result.order?.id??receipt[0].result.inv?.id});
            let drop=false;
            if(pos&&++posSaved===1){
              await q("UPDATE products SET price=345 WHERE id=$1",[pid]);drop=true;
            }else if(pos&&posSaved===2)await q("UPDATE products SET price=115 WHERE id=$1",[pid]);
            if(invoice&&++invoiceSaved===1){await policy("not_registered",false);drop=true;}
            if(pos&&existsSync(classicMarker)&&!classicDropped){classicDropped=true;drop=true;}
            if(drop){evidence.events.push({type:"response_dropped_after_commit",path,key,bodyHash:hash(body)});save();res.destroy();return;}
          }
        }
        if(req.method==="POST"&&path?.endsWith("/tax-preview/close-intent"))
          evidence.events.push({type:"close_response",path,status,state:data?.state,id:data?.result?.id});
        save();res.writeHead(status,reply.headers);res.end(bytes);
      })().catch(error=>{console.error("[tax-preview-browser] Evidence capture failure",error);res.destroy();}));
    });
    upstream.on("error",()=>{res.writeHead(502);res.end("Isolated upstream unavailable");});
    upstream.end(body);
  });
});
proxy.listen(8080,"0.0.0.0",()=>{save();console.log("[tax-preview-browser] Isolated native API ready on 8080.");});
async function shutdown(){
  proxy.closeAllConnections();backend.closeAllConnections();
  await Promise.all([new Promise<void>(r=>proxy.close(()=>r())),new Promise<void>(r=>backend.close(()=>r()))]);
  await pool.end();process.exit(0);
}
process.on("SIGTERM",shutdown);process.on("SIGINT",shutdown);
