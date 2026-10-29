import {describe,it,expect} from "vitest";
import {salePrintDescription,saleCashierMetadata} from "./sale-print-identity";
import {missingIssuer} from "./document-identity";
import {defaultInvoiceDesign} from "./invoice-design";
describe("independent sale identity visibility",()=>{
 it("hides names without erasing original evidence and does not invent legacy actors",()=>{
  const issuer={...missingIssuer(1),invoiceDesign:{schemaVersion:1 as const,design:{...defaultInvoiceDesign,showSeller:false,showCashier:false},
    source:"company" as const,companyRevision:1,branchRevision:0,branchId:1},
    saleIdentity:{version:1 as const,creator:{id:10,name:"المنشئ"},cashier:{id:11,name:"الكاشير"},
      sellers:[{invoiceLineId:3,employeeId:99,name:"البائع الأصلي",visible:true}]}};
  const evidence=JSON.stringify(issuer.saleIdentity);
  expect(salePrintDescription("صنف",3,issuer)).toBe("صنف");
  expect(saleCashierMetadata(issuer)).toEqual([]);
  issuer.invoiceDesign.design.showSeller=true;issuer.invoiceDesign.design.showCashier=true;
  expect(salePrintDescription("صنف",3,issuer)).toContain("البائع الأصلي");
  expect(saleCashierMetadata(issuer)).toEqual([["المحصل","الكاشير"]]);
  expect(JSON.stringify(issuer.saleIdentity)).toBe(evidence);
  expect(salePrintDescription("قديم",3,missingIssuer(1))).toBe("قديم");
  expect(saleCashierMetadata(missingIssuer(1))).toEqual([]);
 });
});
