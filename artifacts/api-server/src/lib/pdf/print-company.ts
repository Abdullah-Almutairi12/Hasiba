import { db, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { CompanyInfo } from "./purchase-order";
/** Legacy company_settings is global: never use it as another tenant's identity. */
export async function getPrintCompany(companyId: number): Promise<CompanyInfo & {vatEnabled:boolean}> {
  const [c]=await db.select().from(companiesTable).where(eq(companiesTable.id,companyId)).limit(1);
  if(!c) throw new Error("PRINT_COMPANY_NOT_FOUND");
  const a=c.address as Record<string,unknown>;
  return {nameAr:c.name,nameEn:c.nameEn??c.name,vatNumber:c.vatNumber??"—",vatEnabled:c.vatRegistrationStatus==="registered"||c.vatRegistrationStatus==="voluntary",
    address:Object.values(a??{}).filter(v=>typeof v==="string").join("، "),phone:"",email:"",
    bankName:"",bankIban:"",termsAr:"",termsEn:""};
}
