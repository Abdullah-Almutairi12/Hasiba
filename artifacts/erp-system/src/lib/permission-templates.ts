import type { TeamAction } from "@workspace/api-client-react";
import { availableKeys, baseReadAction, type GrantResource } from "@/lib/team-access";

export type TemplateForm = { name: string; resource: GrantResource; actions: string[] };

/** Stable identity of a template edit; any change invalidates an earlier impact preview. */
export function templateFormKey(f: TemplateForm): string {
  return JSON.stringify([f.name.trim(), f.resource, Array.from(new Set(f.actions)).sort()]);
}

/** Only actions marked available in the TEAM catalog for the same resource may be chosen. */
export function templateFormIssues(f: TemplateForm, catalog: TeamAction[]): string[] {
  const out: string[] = [];
  if (!f.name.trim()) out.push("اكتب اسم القالب.");
  if (f.actions.length === 0) out.push("اختر فعلًا واحدًا على الأقل.");
  else if (!f.actions.includes(baseReadAction(f.resource))) out.push(`القالب يحتاج صلاحية العرض الأساسية (${baseReadAction(f.resource)}).`);
  const avail = availableKeys(catalog);
  const own = new Set(catalog.filter((a) => a.resource === f.resource).map((a) => a.key));
  const bad = f.actions.filter((a) => !avail.has(a) || !own.has(a));
  if (bad.length) out.push(`أفعال غير متاحة: ${bad.join("، ")}`);
  return out;
}
