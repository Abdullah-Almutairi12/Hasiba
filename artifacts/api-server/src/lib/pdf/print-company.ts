import { db } from "@workspace/db";
import { captureIssuer, issuerLogo, type IssuerSnapshot } from "../document-identity";
import type { CompanyInfo } from "./purchase-order";
/** Legacy company_settings is global: never use it as another tenant's identity. */
export async function getPrintCompany(companyId: number): Promise<CompanyInfo & {vatEnabled:boolean}> {
  return printableIssuer(await captureIssuer(db,companyId));
}
export async function printableIssuer(issuer: IssuerSnapshot) {
  const url = await issuerLogo(issuer);
  return { ...issuer, logo: url ? { data:Buffer.from(url.split(",")[1]!, "base64"),contentType:url.startsWith("data:image/png")?"image/png":"image/jpeg" } : null };
}
