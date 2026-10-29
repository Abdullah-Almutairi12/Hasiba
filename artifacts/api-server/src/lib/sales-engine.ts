import {
  db,
  pricelistsTable,
  pricelistItemsTable,
  productsTable,
  customersTable,
  discountRulesTable,
} from "@workspace/db";
import { and, eq, lte, gte, sql, desc, isNull, or } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";

export type DbOrTx = typeof db | PgTransaction<any, any, any>;

const VAT_RATE_DEFAULT = 15;

/**
 * Resolve the unit price for a product on a given pricelist.
 *
 * Order of precedence:
 *  1. Explicit pricelist item (with quantity tier matching)
 *  2. Pricelist-wide percentage discount entry (productId IS NULL row)
 *  3. Product list price.
 */
export async function resolvePrice(
  tx: DbOrTx,
  args: { productId: number; pricelistId?: number | null; quantity: number },
): Promise<{ unitPrice: number; source: "pricelist" | "product" }> {
  const { productId, pricelistId, quantity } = args;
  const [product] = await tx
    .select({ price: productsTable.price })
    .from(productsTable)
    .where(eq(productsTable.id, productId))
    .limit(1);
  const listPrice = Number(product?.price ?? 0);

  if (!pricelistId) return { unitPrice: listPrice, source: "product" };

  const items = await tx
    .select()
    .from(pricelistItemsTable)
    .where(
      and(
        eq(pricelistItemsTable.pricelistId, pricelistId),
        or(
          eq(pricelistItemsTable.productId, productId),
          isNull(pricelistItemsTable.productId),
        ),
      ),
    );
  const productMatches = items
    .filter((i) => i.productId === productId && Number(i.minQuantity) <= quantity)
    .sort((a, b) => Number(b.minQuantity) - Number(a.minQuantity));
  if (productMatches[0]) {
    const m = productMatches[0];
    if (m.discountPct) {
      return {
        unitPrice: listPrice * (1 - Number(m.discountPct) / 100),
        source: "pricelist",
      };
    }
    return { unitPrice: Number(m.unitPrice), source: "pricelist" };
  }
  const wide = items.find((i) => i.productId === null && i.discountPct);
  if (wide && wide.discountPct) {
    return {
      unitPrice: listPrice * (1 - Number(wide.discountPct) / 100),
      source: "pricelist",
    };
  }
  return { unitPrice: listPrice, source: "product" };
}

/**
 * Generate a sequential reference like SO-2026-00001 / QUO- / DO- / INV- /
 * RCT- / CN-.
 */
export async function nextRef(
  tx: DbOrTx,
  prefix: string,
): Promise<string> {
  const year = new Date().getUTCFullYear();
  // Postgres identifiers can't contain hyphens or other punctuation; sanitize
  // the prefix into a safe sequence name so callers can pass human-readable
  // reference prefixes like "POS-SO" without breaking sequence creation.
  const safe = prefix.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const seqName = `${safe}_seq_${year}`;
  // IF NOT EXISTS alone does not serialize concurrent pg_class inserts.
  // Lock only for first creation; existing sequences keep normal throughput.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`sequence:${seqName}`}, 0)) WHERE to_regclass(${seqName}) IS NULL`);
  await tx.execute(
    sql.raw(`CREATE SEQUENCE IF NOT EXISTS ${seqName} MINVALUE 1 START 1`),
  );
  const r = await tx.execute(sql.raw(`SELECT nextval('${seqName}')::bigint AS n`));
  const rows = (r as unknown as { rows?: Array<{ n: string | number }> }).rows
    ?? (r as unknown as Array<{ n: string | number }>);
  const seq = Number(rows?.[0]?.n ?? 1);
  return `${prefix}-${year}-${String(seq).padStart(5, "0")}`;
}

/**
 * Compute totals for a list of (qty, unitPrice, discountPct, taxRate) lines.
 * Returns rounded totals to 2 decimals plus a per-line lineTotal (qty * unitPrice * (1-disc)).
 */
export interface SalesLineInput {
  productId?: number | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct?: number;
  /** Internal server allocation of an already-evidenced commercial discount.
   * Public invoice schemas never accept this field. */
  discountAmount?: number;
  taxRate?: number;
  taxCategory?: "standard" | "zero" | "exempt" | "not_registered";
}

export interface ComputedLine extends SalesLineInput {
  /** A halala allocation adjustment when grouping creates a different net
   * per line; never label this as a negative customer discount. */
  roundingAdjustment?: number;
  discountPct: number;
  taxRate: number;
  lineSubtotal: number;
  lineDiscount: number;
  lineNet: number;
  lineVat: number;
  lineTotal: number;
}

export interface ComputedTotals {
  subtotal: number;
  discount: number;
  vat: number;
  total: number;
  lines: ComputedLine[];
}

/** Existing POS arithmetic preserved exactly for unconverted companies.
 * Shared by read-only preview and issue; no per-line ERP rounding migration. */
export function legacyPosTotals(lines:SalesLineInput[],discount:number,registered:boolean):ComputedTotals{
  const subtotal=lines.reduce((a,l)=>a+l.unitPrice*l.quantity,0);
  const vat=registered?(subtotal-discount)*.15:0;
  return {subtotal,discount,vat,total:subtotal-discount+vat,
    lines:lines.map(l=>{
      const lineSubtotal=l.unitPrice*l.quantity;
      const lineDiscount=subtotal?lineSubtotal/subtotal*discount:0;
      const lineNet=lineSubtotal-lineDiscount,lineVat=registered?lineNet*.15:0;
      return {...l,discountPct:0,taxRate:registered?15:0,
        taxCategory:registered?"standard":"not_registered",lineSubtotal,lineDiscount,lineNet,lineVat,lineTotal:lineNet+lineVat};
    })};
}

export function computeTotals(
  lines: SalesLineInput[],
  orderDiscount = 0,
  policy?: { priceIncludesVat: boolean },
): ComputedTotals {
  if (policy) return computePolicyTotals(lines,orderDiscount,policy.priceIncludesVat);
  const computed: ComputedLine[] = lines.map((ln) => {
    const taxRate = ln.taxRate ?? VAT_RATE_DEFAULT;
    const discountPct = ln.discountPct ?? 0;
    const lineSubtotal = +(ln.quantity * ln.unitPrice).toFixed(2);
    const lineDiscount = +(lineSubtotal * (discountPct / 100)).toFixed(2);
    const lineNet = +(lineSubtotal - lineDiscount).toFixed(2);
    const lineVat = +(lineNet * (taxRate / 100)).toFixed(2);
    const lineTotal = +(lineNet + lineVat).toFixed(2);
    return {
      ...ln,
      discountPct,
      taxRate,
      lineSubtotal,
      lineDiscount,
      lineNet,
      lineVat,
      lineTotal,
    };
  });
  const subtotal = +computed.reduce((a, l) => a + l.lineSubtotal, 0).toFixed(2);
  const lineDiscountSum = +computed.reduce((a, l) => a + l.lineDiscount, 0).toFixed(2);
  const orderDisc = +Math.max(0, orderDiscount).toFixed(2);
  // Order-level discount is split proportionally before VAT.
  const netBeforeOrderDisc = subtotal - lineDiscountSum;
  const orderDiscApplied = Math.min(orderDisc, netBeforeOrderDisc);
  const netAfter = +(netBeforeOrderDisc - orderDiscApplied).toFixed(2);
  // Recompute VAT on net after order discount, prorated using each line's taxRate.
  let vat = 0;
  if (netBeforeOrderDisc > 0) {
    for (const ln of computed) {
      const share = ln.lineNet / netBeforeOrderDisc;
      const lineNetAfter = +(ln.lineNet - orderDiscApplied * share).toFixed(2);
      vat += +(lineNetAfter * (ln.taxRate / 100)).toFixed(2);
    }
  }
  vat = +vat.toFixed(2);
  const total = +(netAfter + vat).toFixed(2);
  return {
    subtotal,
    discount: +(lineDiscountSum + orderDiscApplied).toFixed(2),
    vat,
    total,
    lines: computed,
  };
}

/** The same sales engine, with explicit policy arithmetic. Monetary totals are
 * exact halalas, grouped by evidenced category/rate. The legacy call signature
 * remains unchanged until a company's reviewed policy is activated. */
function computePolicyTotals(lines:SalesLineInput[],discount:number,inclusive:boolean):ComputedTotals {
  const ratio=(v:number):[bigint,bigint]=>{
    if(!Number.isFinite(v)||v<0)throw new Error("قيمة مالية غير صحيحة");
    const [mantissa,exponent="0"]=String(v).toLowerCase().split("e");
    const parts=mantissa!.split(".");
    const digits=parts.join("");const scale=(parts[1]?.length??0)-Number(exponent);
    return scale>=0?[BigInt(digits),10n**BigInt(scale)]:[BigInt(digits)*10n**BigInt(-scale),1n];
  };
  const round=(n:bigint,d:bigint)=>(n*2n+d)/(2n*d);
  const cents=(v:number)=>{const[n,d]=ratio(v);return round(n*100n,d);};
  const money=(v:bigint)=>{
    if(v>BigInt(Number.MAX_SAFE_INTEGER)||v< -BigInt(Number.MAX_SAFE_INTEGER))throw new Error("المبلغ يتجاوز الدقة المدعومة");
    return Number(v)/100;
  };
  const allocate=(target:bigint,weights:bigint[])=>{
    const sum=weights.reduce((a,b)=>a+b,0n);
    if(!sum){if(target)throw new Error("لا يمكن توزيع مبلغ دون أساس");return weights.map(()=>0n);}
    const result=weights.map(w=>target*w/sum);
    let remaining=target-result.reduce((a,b)=>a+b,0n);
    const order=weights.map((w,i)=>({i,r:target*w%sum})).sort((a,b)=>a.r===b.r?a.i-b.i:a.r>b.r?-1:1);
    for(const entry of order){if(!remaining)break;result[entry.i]=result[entry.i]!+1n;remaining--;}
    return result;
  };
  const gross=lines.map(l=>{
    const[q,qd]=ratio(l.quantity),[p,pd]=ratio(l.unitPrice);
    return round(q*p*100n,qd*pd);
  });
  const afterLine=lines.map((l,i)=>{
    if(l.discountAmount!=null){
      if(l.discountPct)throw new Error("لا يجمع خصم مبلغ مخصص مع نسبة أخرى");
      const discount=cents(l.discountAmount);
      if(discount>gross[i]!)throw new Error("خصم البند يتجاوز أساس السعر");
      return gross[i]!-discount;
    }
    const[n,d]=ratio(l.discountPct??0);
    if(n>100n*d)throw new Error("خصم البند يتجاوز100%");
    return gross[i]!-round(gross[i]!*n,100n*d);
  });
  const available=afterLine.reduce((a,b)=>a+b,0n);
  const wanted=cents(Math.max(0,discount));
  const order=allocate(wanted>available?available:wanted,afterLine);
  const payable=afterLine.map((v,i)=>v-order[i]!);
  const groups=new Map<string,number[]>();
  lines.forEach((l,i)=>{
    const rate=l.taxRate??0;
    if(rate!==0&&rate!==15)throw new Error("نسبة غير مدعومة في السياسة السعودية المحددة");
    const key=`${l.taxCategory??"rate"}:${rate}`;
    groups.set(key,[...(groups.get(key)??[]),i]);
  });
  const rawBase=gross.map(()=>0n),net=gross.map(()=>0n),vat=gross.map(()=>0n);
  for(const indexes of groups.values()){
    const rate=BigInt(lines[indexes[0]!]!.taxRate??0);
    const rawWeights=indexes.map(i=>gross[i]!);
    const finalWeights=indexes.map(i=>payable[i]!);
    const rawSum=rawWeights.reduce((a,b)=>a+b,0n);
    const sum=finalWeights.reduce((a,b)=>a+b,0n);
    const baseSum=inclusive?round(sum*100n,100n+rate):sum;
    const baseBefore=inclusive?round(rawSum*100n,100n+rate):rawSum;
    const tax=inclusive?sum-baseSum:round(baseSum*rate,100n);
    const baseParts=allocate(baseSum,finalWeights),beforeParts=allocate(baseBefore,rawWeights);
    const taxParts=inclusive?finalWeights.map((v,i)=>v-baseParts[i]!):allocate(tax,baseParts);
    indexes.forEach((idx,j)=>{rawBase[idx]=beforeParts[j]!;net[idx]=baseParts[j]!;vat[idx]=taxParts[j]!;});
  }
  const subtotal=rawBase.reduce((a,b)=>a+b,0n),netSum=net.reduce((a,b)=>a+b,0n);
  const vatSum=vat.reduce((a,b)=>a+b,0n);
  return {subtotal:money(subtotal),discount:money(subtotal-netSum),vat:money(vatSum),total:money(netSum+vatSum),
    lines:lines.map((l,i)=>({...l,
      unitPrice:inclusive?Number((l.unitPrice/(1+(l.taxRate??0)/100)).toFixed(12)):l.unitPrice,
      discountPct:l.discountPct??0,taxRate:l.taxRate??0,lineSubtotal:money(rawBase[i]!),
      lineDiscount:money(rawBase[i]!>net[i]!?rawBase[i]!-net[i]!:0n),
      roundingAdjustment:money(rawBase[i]!<net[i]!?net[i]!-rawBase[i]!:0n),
      lineNet:money(net[i]!),lineVat:money(vat[i]!),
      lineTotal:money(net[i]!+vat[i]!)}))};
}

/**
 * Resolve active order-level discount rules and aggregate them into a single
 * applied discount + a per-account breakdown. Pricing is invoked from the
 * SO/Quote/Invoice POSTs so reason codes feed the right GL bucket and so the
 * discount metadata stays consistent across the document lifecycle.
 *
 * - Percent rules apply against `baseNet` sequentially.
 * - Fixed rules subtract their absolute value (capped at 0).
 * - The total discount is split per-account so the JE can post each bucket
 *   separately (e.g. "loyalty" vs "promo" discount accounts).
 */
export interface AppliedDiscountRule {
  id: number;
  name: string;
  reasonCode: string;
  accountSystemKey: string;
  amount: number;
}
export async function applyDiscountRules(
  tx: DbOrTx,
  args: { baseNet: number; scope?: "line" | "order" },
): Promise<{
  discountAmount: number;
  applied: AppliedDiscountRule[];
}> {
  const scope = args.scope ?? "order";
  const rules = await tx
    .select()
    .from(discountRulesTable)
    .where(
      and(
        eq(discountRulesTable.isActive, true),
        eq(discountRulesTable.scope, scope),
      ),
    );
  let remaining = +args.baseNet.toFixed(2);
  const applied: AppliedDiscountRule[] = [];
  for (const r of rules) {
    if (remaining <= 0) break;
    let amt = 0;
    if (r.kind === "percent") {
      amt = +(remaining * (Number(r.value) / 100)).toFixed(2);
    } else {
      amt = Math.min(remaining, +Number(r.value).toFixed(2));
    }
    if (amt <= 0) continue;
    remaining = +(remaining - amt).toFixed(2);
    applied.push({
      id: r.id,
      name: r.name,
      reasonCode: r.reasonCode,
      accountSystemKey: r.accountSystemKey,
      amount: amt,
    });
  }
  const discountAmount = +applied.reduce((a, x) => a + x.amount, 0).toFixed(2);
  return { discountAmount, applied };
}

/**
 * Apply active line-scope discount rules in-place. Each rule reduces every
 * eligible line's net by its percent/fixed value and we bump that line's
 * `discountPct` so downstream `computeTotals` sees the new effective price.
 * Returns the per-rule aggregated amount so the invoice JE can post each
 * rule's discount to its configured GL account, just like order-scope rules.
 */
export async function applyLineDiscountRules(
  tx: DbOrTx,
  lines: SalesLineInput[],
  onApplied?: (rule: AppliedDiscountRule, after: SalesLineInput[]) => void,
): Promise<{ applied: AppliedDiscountRule[] }> {
  const rules = await tx
    .select()
    .from(discountRulesTable)
    .where(
      and(
        eq(discountRulesTable.isActive, true),
        eq(discountRulesTable.scope, "line"),
      ),
    );
  const agg = new Map<number, AppliedDiscountRule>();
  for (const rule of rules) {
    for (const ln of lines) {
      const baseDisc = ln.discountPct ?? 0;
      const lineSubtotal = ln.quantity * ln.unitPrice;
      if (lineSubtotal <= 0) continue;
      const lineNet = lineSubtotal * (1 - baseDisc / 100);
      let extra = 0;
      if (rule.kind === "percent") {
        extra = lineNet * (Number(rule.value) / 100);
      } else {
        extra = Math.min(lineNet, Number(rule.value));
      }
      extra = +extra.toFixed(2);
      if (extra <= 0) continue;
      const newNet = Math.max(0, lineNet - extra);
      ln.discountPct = +((1 - newNet / lineSubtotal) * 100).toFixed(4);
      const cur = agg.get(rule.id) ?? {
        id: rule.id,
        name: rule.name,
        reasonCode: rule.reasonCode,
        accountSystemKey: rule.accountSystemKey,
        amount: 0,
      };
      cur.amount = +(cur.amount + extra).toFixed(2);
      agg.set(rule.id, cur);
    }
    const applied=agg.get(rule.id);
    if(applied&&onApplied)onApplied({...applied},lines.map(l=>({...l})));
  }
  return { applied: [...agg.values()] };
}

/**
 * Pick the pricelist that should apply to a customer.
 * Priority: customer.defaultPricelistId → first active pricelist matching segment → default.
 */
export async function resolveCustomerPricelist(
  tx: DbOrTx,
  customerId: number,
): Promise<number | null> {
  const [customer] = await tx
    .select()
    .from(customersTable)
    .where(eq(customersTable.id, customerId))
    .limit(1);
  if (!customer) return null;
  if (customer.defaultPricelistId) return customer.defaultPricelistId;
  const today = new Date().toISOString().slice(0, 10);
  const [bySegment] = await tx
    .select({ id: pricelistsTable.id })
    .from(pricelistsTable)
    .where(
      and(
        eq(pricelistsTable.isActive, true),
        eq(pricelistsTable.segment, customer.segment ?? "retail"),
        or(
          isNull(pricelistsTable.startDate),
          lte(pricelistsTable.startDate, today),
        ),
        or(
          isNull(pricelistsTable.endDate),
          gte(pricelistsTable.endDate, today),
        ),
      ),
    )
    .orderBy(desc(pricelistsTable.isDefault))
    .limit(1);
  if (bySegment) return bySegment.id;
  const [def] = await tx
    .select({ id: pricelistsTable.id })
    .from(pricelistsTable)
    .where(eq(pricelistsTable.isDefault, true))
    .limit(1);
  return def?.id ?? null;
}
