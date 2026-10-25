import type { PermissionTemplate, TeamGrantInput } from "@workspace/api-client-react";
import { Link2, RotateCcw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bindingOf, grantSource, inheritFrom, toManual, toOverride } from "@/lib/team-access";

export function GrantSourceSelector({ index, grant, templates, available, onChange }: {
  index: number; grant: TeamGrantInput; templates: PermissionTemplate[]; available: Set<string>;
  onChange: (p: Partial<TeamGrantInput>) => void;
}) {
  const source = grantSource(grant);
  const b = bindingOf(grant);
  const matching = templates.filter((t) => t.resource === grant.resource);
  const current = templates.find((t) => t.id === b.templateId) ?? null;
  const stale = current && b.templateRevision !== current.revision;

  return (
    <div className="mt-3 rounded-lg border bg-muted/30 p-2.5 text-xs" data-testid={`panel-grant-source-${index}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">مصدر الأفعال</span>
        <select
          className="h-8 rounded-md border bg-background px-2 text-xs"
          value={b.templateId ? String(b.templateId) : "manual"}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "manual") return onChange(toManual());
            const t = matching.find((x) => String(x.id) === v);
            if (t) onChange(inheritFrom(t, available));
          }}
          data-testid={`select-grant-source-${index}`}
        >
          <option value="manual">يدوي لهذه المسؤولية</option>
          {matching.map((t) => <option key={t.id} value={t.id}>قالب: {t.name}</option>)}
          {b.templateId && !current && <option value={b.templateId}>قالب #{b.templateId} (غير متاح)</option>}
        </select>
        <span className="rounded border px-1.5 py-0.5 text-[10px]" data-testid={`status-grant-source-${index}`}>
          {source === "manual" ? "يدوي" : source === "inherit" ? `يرث · إصدار ${b.templateRevision}` : `استثناء فردي · من إصدار ${b.templateRevision}`}
        </span>
        {source === "inherit" && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onChange(toOverride(grant))} data-testid={`button-grant-override-${index}`}>
            <Unlink className="me-1 size-3.5" /> استثناء فردي
          </Button>
        )}
        {source === "override" && current && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onChange(inheritFrom(current, available))} data-testid={`button-grant-inherit-${index}`}>
            <RotateCcw className="me-1 size-3.5" /> العودة للوراثة (إصدار {current.revision})
          </Button>
        )}
        {source === "inherit" && stale && current && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onChange(inheritFrom(current, available))} data-testid={`button-grant-refresh-${index}`}>
            <Link2 className="me-1 size-3.5" /> تحديث إلى الإصدار {current.revision}
          </Button>
        )}
      </div>
      {source === "inherit" && <p className="mt-1 text-[11px] text-muted-foreground">الأفعال تتبع القالب ولا تعدل هنا. الفرع والمستودعات والسقف والفترة تبقى لهذه المسؤولية.</p>}
      {source === "override" && <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">تعديلات القالب لن تصل لهذه المسؤولية حتى تعيدها للوراثة.</p>}
    </div>
  );
}
