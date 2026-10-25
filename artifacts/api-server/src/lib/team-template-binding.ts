import { sql } from "drizzle-orm";
import type { DbOrTx } from "./journal-posting";
import type { TeamGrant } from "./team-catalog";
import { FinancialRequestError } from "./financial-transaction";

export async function validateTemplateBinding(tx:DbOrTx,companyId:number,g:TeamGrant) {
  if(!g.templateId)return;
  const rows=(await tx.execute(sql`SELECT resource,actions,revision FROM team_permission_templates
    WHERE id=${g.templateId} AND company_id=${companyId}`)).rows as Array<{resource:string;actions:string[];revision:number}>;
  const template=rows[0];
  if(!template||template.resource!==g.resource)throw new FinancialRequestError("القالب خارج الشركة أو نوع المسؤولية",403);
  if(g.templateMode==="inherit" && (g.templateRevision!==template.revision ||
    JSON.stringify([...new Set(g.actions)].sort())!==JSON.stringify([...template.actions].sort())))
    throw new FinancialRequestError("تغير القالب أو أفعاله؛ أعد تحميل مصدر الوراثة قبل الحفظ",409);
  const versions=await tx.execute(sql`SELECT revision FROM team_permission_template_versions
    WHERE template_id=${g.templateId} AND revision=${g.templateRevision}`);
  if(!versions.rows.length)throw new FinancialRequestError("إصدار مصدر الصلاحية غير متاح",409);
}
