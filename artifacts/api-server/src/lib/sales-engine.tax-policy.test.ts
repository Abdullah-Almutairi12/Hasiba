import {describe,it,expect} from "vitest";
import {computeTotals} from "./sales-engine";

describe("explicit company tax policy uses the original sales totals engine",()=>{
  it("does not change the legacy calculation until a policy is selected",()=>{
    const input=[{description:"خدمة",quantity:1,unitPrice:115,taxRate:15}];
    expect(computeTotals(input).total).toBe(132.25);
    expect(computeTotals(input,0,{priceIncludesVat:true})).toMatchObject({
      subtotal:100,discount:0,vat:15,total:115,
    });
  });
  it("does not lose halalas when an inclusive unit price times many units has a repeating net unit value",()=>{
    const result=computeTotals([{description:"مجزأ",quantity:100,unitPrice:1,taxRate:15,taxCategory:"standard"}],0,{priceIncludesVat:true});
    expect(result).toMatchObject({subtotal:86.96,discount:0,vat:13.04,total:100});
    expect(result.lines[0]).toMatchObject({lineNet:86.96,lineVat:13.04,lineTotal:100});
  });
  it("keeps standard, zero and exempt classes apart through a global discount",()=>{
    const lines=[
      {description:"أساسي",quantity:1,unitPrice:115,taxRate:15,taxCategory:"standard" as const},
      {description:"صفري",quantity:1,unitPrice:100,taxRate:0,taxCategory:"zero" as const},
      {description:"معفى",quantity:1,unitPrice:100,taxRate:0,taxCategory:"exempt" as const},
    ];
    const result=computeTotals(lines,23,{priceIncludesVat:true});
    expect(result.total).toBe(292);
    expect(result.lines[1]?.lineVat).toBe(0);
    expect(result.lines[2]?.lineVat).toBe(0);
    expect(result.subtotal-result.discount+result.vat).toBe(result.total);
    expect(result.lines.reduce((sum,line)=>sum+line.lineTotal,0)).toBe(result.total);
  });
  it("shows allocation in a tiny gross-discount case without inventing a negative discount",()=>{
    const r=computeTotals([
      {description:"أ",quantity:1,unitPrice:.02,taxRate:15,taxCategory:"standard"},
      {description:"ب",quantity:1,unitPrice:.02,taxRate:15,taxCategory:"standard"},
    ],.01,{priceIncludesVat:true});
    expect(r.total).toBe(.03);
    expect(r.lines.every(l=>l.lineDiscount>=0)).toBe(true);
    for(const l of r.lines)
      expect(Number((l.lineSubtotal-l.lineDiscount+(l.roundingAdjustment??0)).toFixed(2))).toBe(l.lineNet);
  });
  it("blocks unsupported category rates in reviewed policy rather than silently taxing them as standard",()=>{
    expect(()=>computeTotals([{description:"غير مصنف",quantity:1,unitPrice:100,taxRate:5}],0,{priceIncludesVat:false}))
      .toThrow("نسبة غير مدعومة");
  });
});
