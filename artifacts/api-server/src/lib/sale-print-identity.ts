import type { IssuerSnapshot } from "./document-identity";
import { sellerLineDescription, type SellerLine } from "./seller-ledger";

/** Never reinterpret legacy output. New issuance snapshots are independent
 * from the correctable reporting ledger and current employee/user profiles. */
export function salePrintDescription(description: string, lineId: number, issuer: IssuerSnapshot, legacy?: SellerLine) {
  if (issuer.invoiceDesign?.design.showSeller === false) return description;
  if (!issuer.saleIdentity) return sellerLineDescription(description, legacy);
  const seller = issuer.saleIdentity.sellers.find(s => s.invoiceLineId === lineId);
  return seller?.visible ? `${description} — البائع: ${seller.name}` : description;
}
export function saleCashierMetadata(issuer: IssuerSnapshot): Array<[string,string]> {
  if (!issuer.saleIdentity?.cashier || issuer.invoiceDesign?.design.showCashier !== true) return [];
  return [["المحصل", issuer.saleIdentity.cashier.name]];
}
