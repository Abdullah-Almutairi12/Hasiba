import {describe,it,expect} from "vitest";
import {posTemplateFixture,fixtureRows as rows,accepted as ok} from "../test/pos-template-fixture";
import {randomUUID} from "node:crypto";
async function fixture(){
  const f=await posTemplateFixture();
  f.actors[0].set("X-Workspace-Responsibility",String(f.people[0].grants[0].id));
  const shift=ok(await f.actors[0].post("/api/pos/sessions").set("Idempotency-Key",randomUUID()).send({
    branchId:f.branches[0].id,cashierName:"كاشير باركود",openingCash:100}),201);
  const code=`000${Date.now()}${Math.random().toString().slice(2,8)}`;
  await rows("UPDATE products SET barcode=$1 WHERE id=$2",[code,f.products[0].id]);
  return {...f,shift,code,scan:(c=code)=>f.actors[0].get("/api/pos/barcode-lookup").query({code:c,sessionId:shift.id})};
}
describe("ordinary POS exact barcode in isolated PostgreSQL",()=>{
  it("finds an off-page leading-zero product for a limited cashier without exposing costs or financial writes",async()=>{
    const f=await fixture();
    await rows(`INSERT INTO products(company_id,category_id,name,name_ar,sku,price,cost_price)
      SELECT p.company_id,p.category_id,'filler','حشو',$2||g,1,0 FROM products p CROSS JOIN generate_series(1,510)g WHERE p.id=$1`,
      [f.products[0].id,randomUUID()]);
    await rows("UPDATE products SET barcode=NULL WHERE id=$1",[f.products[0].id]);
    const [target]=await rows(`INSERT INTO products(company_id,category_id,name,name_ar,sku,barcode,price,cost_price)
      SELECT company_id,category_id,'off-page','خارج الصفحة',$2,$3,1,0 FROM products WHERE id=$1 RETURNING id`,
      [f.products[0].id,randomUUID(),f.code]);
    const catalog=ok(await f.actors[0].get("/api/products"));
    expect(catalog.some((p:any)=>p.id===target.id)).toBe(false);
    for(let i=0;i<2;i++){
      const product=ok(await f.scan());expect(product.id).toBe(target.id);expect(product.barcode).toBe(f.code);
      expect(product.costPrice).toBeUndefined();expect(product.cost_price).toBeUndefined();
    }
    expect((await rows("SELECT count(*)::int n FROM customer_invoices WHERE company_id=$1",[f.companies[0].id]))[0].n).toBe(0);
    expect((await rows("SELECT count(*)::int n FROM pos_orders WHERE session_id=$1",[f.shift.id]))[0].n).toBe(0);
  });
  it("rejects unknown, ambiguous, disabled, tracked and variant identifiers instead of choosing a parent",async()=>{
    const f=await fixture();ok(await f.scan("unknown"),404);
    await rows("UPDATE products SET is_active=false WHERE id=$1",[f.products[0].id]);ok(await f.scan(),422);
    await rows("UPDATE products SET is_active=true,tracking_mode='lot' WHERE id=$1",[f.products[0].id]);ok(await f.scan(),422);
    await rows("UPDATE products SET tracking_mode='none' WHERE id=$1",[f.products[0].id]);
    await rows(`INSERT INTO products(company_id,category_id,name,name_ar,sku,barcode,price,cost_price)
      SELECT company_id,category_id,'duplicate','مكرر',$2,$3,1,0 FROM products WHERE id=$1`,[f.products[0].id,randomUUID(),f.code]);
    ok(await f.scan(),409);
    const vcode=randomUUID();
    await rows("INSERT INTO product_variants(product_id,sku,barcode) VALUES($1,$2,$3)",[f.products[0].id,randomUUID(),vcode]);
    ok(await f.scan(vcode),422);
  });
  it("enforces company, cashier/branch source, current responsibility revocation and closure",async()=>{
    const f=await fixture();
    const foreign=`foreign-${randomUUID()}`;await rows("UPDATE products SET barcode=$1 WHERE id=$2",[foreign,f.products[1].id]);
    ok(await f.scan(foreign),404);
    ok(await f.actors[1].get("/api/pos/barcode-lookup").set("X-Workspace-Responsibility",String(f.people[1].grants[0].id)).query({code:f.code,sessionId:f.shift.id}),403);
    await rows("UPDATE pos_sessions SET status='closed',closed_at=now() WHERE id=$1",[f.shift.id]);ok(await f.scan(),409);
    await rows("UPDATE responsibility_grants SET actions=ARRAY[]::text[] WHERE id=$1",[f.people[0].grants[0].id]);
    ok(await f.scan(),403);
  });
});
