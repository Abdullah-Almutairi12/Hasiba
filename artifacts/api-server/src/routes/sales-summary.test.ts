import {beforeAll,describe,it,expect,vi} from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import {randomUUID} from "node:crypto";
import {db,pool,companiesTable,usersTable,userCompaniesTable,branchesTable,customersTable,customerInvoicesTable} from "@workspace/db";
import app,{assertApplicationReady} from "../app";
import {riyadhDate} from "../lib/vat-policy";
import * as businessDates from "../lib/vat-policy";
beforeAll(assertApplicationReady);
const q=async(s:string,p:unknown[]=[]) => (await pool.query(s,p)).rows;
let ip=211;
async function fixture(){
  if(process.env.ACCOUNT_ISOLATED_TEST!=="true")throw new Error("Disposable PostgreSQL only");
  const tag=randomUUID(),password=`Synthetic-${tag}`;
  const [c]=await db.insert(companiesTable).values({name:tag}).returning();
  const [other]=await db.insert(companiesTable).values({name:`other-${tag}`}).returning();
  const [u]=await db.insert(usersTable).values({name:"مصطنع",email:`summary-${tag}@example.invalid`,
    passwordHash:await bcrypt.hash(password,4),role:"owner",isActive:true}).returning();
  await db.insert(userCompaniesTable).values({companyId:c.id,userId:u.id,role:"owner",isDefault:true});
  const branches=await db.insert(branchesTable).values([1,2].map(n=>({companyId:c.id,name:`${tag}-${n}`,nameAr:`فرع${n}`,city:"اختبار"}))).returning();
  const [customer]=await db.insert(customersTable).values({companyId:c.id,name:"مصطنع"}).returning();
  const [otherCustomer]=await db.insert(customersTable).values({companyId:other.id,name:"مصطنع آخر"}).returning();
  const [otherBranch]=await db.insert(branchesTable).values({companyId:other.id,name:`other-${tag}`,nameAr:"فرع آخر",city:"اختبار"}).returning();
  const a=request.agent(app).set("X-Forwarded-For",`198.51.100.${ip++}`);
  expect((await a.post("/api/auth/login").send({email:u.email,password})).status).toBe(200);
  const monthStart=riyadhDate().slice(0,7)+"-01";
  const [year,month]=monthStart.split("-").map(Number);
  const monthEnd=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);
  const oldDate=new Date(new Date(monthStart).getTime()-86400000).toISOString().slice(0,10);
  async function invoice(status:string,total:number,date=monthStart,paid=0,branch=0,company=c.id){
    return (await db.insert(customerInvoicesTable).values({companyId:company,customerId:company===c.id?customer.id:otherCustomer.id,
      customerName:"مصطنع",branchId:company===c.id?branches[branch].id:otherBranch.id,reference:randomUUID(),status,
      invoiceDate:date,subtotal:String(total),total:String(total),amountPaid:String(paid)}).returning())[0];
  }
  return {a,c,u,other,branches,monthStart,monthEnd,oldDate,invoice};
}
describe("native sales summary definition and isolation",()=>{
  it.each(["draft","cancelled","next-month"])("excludes %s from issued invoices of this month",async(kind)=>{
    const f=await fixture();
    await f.invoice(kind==="next-month"?"open":kind,123,kind==="next-month"?f.monthEnd:f.monthStart);
    const res=await f.a.get("/api/sales/reports/summary");
    expect(res.status).toBe(200);expect(res.body.invoices.thisMonth).toBe(0);
  });
  it("uses the shared Riyadh business date when UTC is still in the preceding month",async()=>{
    const f=await fixture();
    await f.invoice("open",10,"2026-10-31");
    await f.invoice("open",20,"2026-11-01");
    await f.invoice("open",30,"2026-12-01");
    expect(riyadhDate(new Date("2026-10-31T21:00:00Z"))).toBe("2026-11-01");
    const clock=vi.spyOn(businessDates,"riyadhDate").mockReturnValue("2026-11-01");
    try{
      const res=await f.a.get("/api/sales/reports/summary");
      expect(res.status).toBe(200);expect(res.body.monthStart).toBe("2026-11-01");
      expect(res.body.invoices.thisMonth).toBe(20);
    }finally{clock.mockRestore();}
  });
  it("sums only issued invoices inside the Riyadh calendar month, across permitted company branches, not another company",async()=>{
    const f=await fixture();
    await f.invoice("open",100);
    await f.invoice("partially_paid",200,f.monthStart,40,1);
    await f.invoice("paid",50,f.monthStart,50);
    await f.invoice("draft",1000);
    await f.invoice("cancelled",2000);
    await f.invoice("open",70,f.oldDate);
    await f.invoice("open",80,f.monthEnd);
    await f.invoice("open",9999,f.monthStart,0,0,f.other.id);
    const res=await f.a.get("/api/sales/reports/summary");
    expect(res.status).toBe(200);expect(res.body.monthStart).toBe(f.monthStart);
    const [independent]=await q(`SELECT sum(total::numeric)::text AS total FROM customer_invoices
      WHERE company_id=$1 AND status IN ('open','paid','partially_paid') AND invoice_date >= $2 AND invoice_date < $3`,
      [f.c.id,f.monthStart,f.monthEnd]);
    expect(Number(independent.total)).toBe(350);
    expect(res.body.invoices.thisMonth).toBe(Number(independent.total));
    expect(res.body.invoices.outstanding).toBe(410);
  });
  it.each(["sales","scoped"])("does not expose company summary to %s or an old open session after role withdrawal",async(role)=>{
    const f=await fixture();await f.invoice("open",100);
    expect((await f.a.get("/api/sales/reports/summary")).status).toBe(200);
    await q("UPDATE user_companies SET role=$1 WHERE user_id=$2 AND company_id=$3",[role,f.u.id,f.c.id]);
    const denied=await f.a.get(`/api/sales/reports/summary?branchId=${f.branches[0].id}`);
    expect(denied.status).toBe(403);expect(denied.body).not.toHaveProperty("invoices");
  });
  it("re-reading the summary changes no invoice, journal, inventory movement or financial receipt",async()=>{
    const f=await fixture();await f.invoice("open",100);
    const snapshot=()=>q(`SELECT
      (SELECT count(*)::int FROM customer_invoices WHERE company_id=$1) AS invoices,
      (SELECT count(*)::int FROM journal_entries WHERE company_id=$1) AS journals,
      (SELECT count(*)::int FROM stock_moves WHERE product_id IN (SELECT id FROM products WHERE company_id=$1)) AS moves,
      (SELECT count(*)::int FROM financial_requests WHERE company_id=$1) AS receipts`,[f.c.id]);
    const before=await snapshot();
    for(let n=0;n<3;n++)expect((await f.a.get("/api/sales/reports/summary")).status).toBe(200);
    expect(await snapshot()).toEqual(before);
  });
});
