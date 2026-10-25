import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPermissionTemplates,
  getListPermissionTemplatesQueryKey,
  useCreatePermissionTemplate,
  usePreviewPermissionTemplate,
  useApplyPermissionTemplate,
  getListTeamPeopleQueryKey,
  type PermissionTemplate,
  type PermissionTemplateImpact,
  type TeamAction,
  type Branch,
  type Warehouse,
} from "@workspace/api-client-react";
import { AlertTriangle, Eye, Layers, Loader2, Pencil, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { RESOURCE_LABEL, actionsFor, errorStatus, errorText, type GrantResource } from "@/lib/team-access";
import { actionLabel } from "@/lib/pos-actions";
import { templateFormKey, templateFormIssues, type TemplateForm } from "@/lib/permission-templates";

type Props = { catalogActions: TeamAction[]; branches: Branch[] | undefined; warehouses: Warehouse[] | undefined };

export function PermissionTemplatesPanel({ catalogActions, branches, warehouses }: Props) {
  const listQ = useListPermissionTemplates({ query: { queryKey: getListPermissionTemplatesQueryKey() } });
  const [mode, setMode] = useState<{ kind: "create" } | { kind: "edit"; tpl: PermissionTemplate } | null>(null);
  const templates = listQ.data ?? [];

  return (
    <section className="rounded-2xl border bg-card" data-testid="panel-permission-templates">
      <div className="flex flex-wrap items-center gap-2 border-b p-4">
        <Layers className="size-4 text-primary" />
        <h2 className="font-bold">قوالب صلاحيات المنشأة</h2>
        <span className="text-xs text-muted-foreground">مجموعة أفعال مشتركة؛ الفرع والمستودعات والسقف والفترة تبقى لكل مسؤولية.</span>
        <Button size="sm" variant="outline" className="ms-auto" onClick={() => setMode({ kind: "create" })} data-testid="button-new-template">
          <Plus className="me-1 size-4" /> قالب
        </Button>
      </div>
      <div className="grid gap-0 lg:grid-cols-[280px_1fr]">
        <div className="border-b lg:border-b-0 lg:border-e">
          {listQ.isLoading ? (
            <div className="space-y-2 p-4" data-testid="state-templates-loading"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
          ) : listQ.error ? (
            <div className="p-4 text-sm" role="alert" data-testid="state-templates-error">
              <p className="text-destructive">{errorText(listQ.error)}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => void listQ.refetch()} data-testid="button-retry-templates"><RefreshCw className="me-1 size-4" /> إعادة</Button>
            </div>
          ) : templates.length === 0 ? (
            <p className="p-5 text-center text-xs text-muted-foreground" data-testid="state-templates-empty">لا قوالب بعد. أنشئ قالبًا ثم اربط المسؤوليات به.</p>
          ) : (
            <ul className="divide-y">
              {templates.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => setMode({ kind: "edit", tpl: t })} data-testid={`row-template-${t.id}`}
                    className={cn("flex w-full items-center gap-2 p-3 text-start text-sm hover:bg-muted/50", mode?.kind === "edit" && mode.tpl.id === t.id && "bg-primary/5")}>
                    <span className="flex-1 font-medium">{t.name}</span>
                    <span className="text-[10px] text-muted-foreground">{RESOURCE_LABEL[t.resource]} · {t.actions.length} فعل · إصدار {t.revision}</span>
                    <Pencil className="size-3.5 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="p-4">
          {mode?.kind === "create" && <CreateTemplate catalogActions={catalogActions} onDone={() => setMode(null)} />}
          {mode?.kind === "edit" && (
            <EditTemplate key={`${mode.tpl.id}:${mode.tpl.revision}`} tpl={mode.tpl} catalogActions={catalogActions} branches={branches} warehouses={warehouses}
              onDone={(t) => setMode(t ? { kind: "edit", tpl: t } : null)} />
          )}
          {!mode && <p className="py-6 text-center text-xs text-muted-foreground" data-testid="state-template-none">اختر قالبًا لتعديله. أي تعديل يُعاين أثره على الأشخاص قبل تطبيقه.</p>}
        </div>
      </div>
    </section>
  );
}

function ActionPicker({ resource, catalogActions, value, onChange }: { resource: string; catalogActions: TeamAction[]; value: string[]; onChange: (v: string[]) => void }) {
  const acts = actionsFor(catalogActions, resource);
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {acts.map((a) => (
        <label key={a.key} className={cn("flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs", !a.available && "opacity-55")}>
          <Checkbox disabled={!a.available} checked={value.includes(a.key)}
            onCheckedChange={(v) => onChange(v ? [...value, a.key] : value.filter((x) => x !== a.key))} data-testid={`checkbox-template-action-${a.key}`} />
          <span className="flex-1">{actionLabel(a.key, a.label)}</span>
          {!a.available && <span className="text-[10px] text-muted-foreground">غير متاح</span>}
        </label>
      ))}
    </div>
  );
}

function CreateTemplate({ catalogActions, onDone }: { catalogActions: TeamAction[]; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const create = useCreatePermissionTemplate();
  const [form, setForm] = useState<TemplateForm>({ name: "", resource: "inventory", actions: [] });
  const issues = templateFormIssues(form, catalogActions);
  const submit = async () => {
    if (issues.length) return;
    try {
      await create.mutateAsync({ data: { name: form.name.trim(), resource: form.resource, actions: form.actions } });
      await qc.invalidateQueries({ queryKey: getListPermissionTemplatesQueryKey() });
      toast({ title: "أُنشئ القالب" });
      onDone();
    } catch (err) {
      toast({ title: "تعذر إنشاء القالب", description: errorText(err), variant: "destructive" });
    }
  };
  return (
    <div className="space-y-3" data-testid="form-create-template">
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <div><Label className="text-xs">اسم القالب</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="مثال: أمين مستودع" data-testid="input-template-name" /></div>
        <div>
          <Label className="text-xs">المورد</Label>
          <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.resource}
            onChange={(e) => setForm({ ...form, resource: e.target.value as GrantResource, actions: [] })} data-testid="select-template-resource">
            <option value="inventory">المخزون</option><option value="pos">نقطة البيع</option><option value="procurement">الموردون وأوامر الشراء</option>
          </select>
        </div>
      </div>
      <ActionPicker resource={form.resource} catalogActions={catalogActions} value={form.actions} onChange={(actions) => setForm({ ...form, actions })} />
      {issues.length > 0 && <ul className="text-[11px] text-muted-foreground" data-testid="list-template-issues">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void submit()} disabled={!!issues.length || create.isPending} data-testid="button-create-template">
          {create.isPending && <Loader2 className="me-1 size-4 animate-spin" />} إنشاء
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>إلغاء</Button>
      </div>
    </div>
  );
}

export function EditTemplate({ tpl, catalogActions, branches, warehouses, onDone }: {
  tpl: PermissionTemplate; catalogActions: TeamAction[]; branches: Branch[] | undefined; warehouses: Warehouse[] | undefined;
  onDone: (t: PermissionTemplate | null) => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const preview = usePreviewPermissionTemplate();
  const apply = useApplyPermissionTemplate();
  const [form, setForm] = useState<TemplateForm>({ name: tpl.name, resource: tpl.resource, actions: [...tpl.actions] });
  const [impact, setImpact] = useState<{ key: string; result: PermissionTemplateImpact } | null>(null);
  const [conflict, setConflict] = useState(false);
  const key = templateFormKey(form);
  const fresh = impact?.key === key;
  const issues = templateFormIssues(form, catalogActions);
  const unchanged = key === templateFormKey({ name: tpl.name, resource: tpl.resource, actions: tpl.actions });

  const edit = (f: TemplateForm) => { setForm(f); setImpact(null); };

  const runPreview = async () => {
    setConflict(false);
    try {
      const result = await preview.mutateAsync({ id: tpl.id, data: { expectedRevision: tpl.revision, name: form.name.trim(), actions: form.actions } });
      setImpact({ key, result });
    } catch (err) {
      if (errorStatus(err) === 409) setConflict(true);
      else toast({ title: "تعذرت معاينة الأثر", description: errorText(err), variant: "destructive" });
    }
  };

  const runApply = async () => {
    if (!impact || !fresh) return;
    try {
      const saved = await apply.mutateAsync({ id: tpl.id, data: { expectedRevision: tpl.revision, name: form.name.trim(), actions: form.actions, digest: impact.result.digest } });
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListPermissionTemplatesQueryKey() }),
        qc.invalidateQueries({ queryKey: getListTeamPeopleQueryKey() }),
      ]);
      toast({ title: "طُبق القالب", description: `الإصدار ${saved.revision} — ${impact.result.effects.length} مسؤولية راجعتها` });
      onDone(saved);
    } catch (err) {
      setImpact(null);
      if (errorStatus(err) === 409) setConflict(true);
      else toast({ title: "لم يُطبق شيء", description: errorText(err), variant: "destructive" });
    }
  };

  const refresh = async () => {
    setConflict(false); setImpact(null);
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListPermissionTemplatesQueryKey() }),
      qc.invalidateQueries({ queryKey: getListTeamPeopleQueryKey() }),
    ]);
    onDone(null);
  };

  const label = (a: string) => actionLabel(a, catalogActions.find((x) => x.key === a)?.label);
  const bName = (id: number) => { const b = branches?.find((x) => x.id === id); return b ? b.nameAr || b.name : `فرع #${id}`; };
  const wName = (id: number) => { const w = warehouses?.find((x) => x.id === id); return w ? w.nameAr || w.name : `مستودع #${id}`; };

  return (
    <div className="space-y-3" data-testid={`form-edit-template-${tpl.id}`}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1"><Label className="text-xs">اسم القالب</Label><Input value={form.name} onChange={(e) => edit({ ...form, name: e.target.value })} data-testid="input-edit-template-name" /></div>
        <span className="text-xs text-muted-foreground">{RESOURCE_LABEL[tpl.resource]} · الإصدار الحالي {tpl.revision}</span>
      </div>
      <ActionPicker resource={tpl.resource} catalogActions={catalogActions} value={form.actions} onChange={(actions) => edit({ ...form, actions })} />
      {issues.length > 0 && <ul className="text-[11px] text-muted-foreground">{issues.map((i) => <li key={i}>{i}</li>)}</ul>}

      {conflict && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="banner-template-conflict">
          <AlertTriangle className="size-4" /> تغيّر القالب أو أحد المرتبطين به منذ فتحه. لم يُطبق شيء؛ افتح أحدث نسخة وراجع الأثر من جديد.
          <Button size="sm" variant="outline" className="ms-auto" onClick={() => void refresh()} data-testid="button-template-reload"><RefreshCw className="me-1 size-3.5" /> مراجعة جديدة</Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void runPreview()} disabled={!!issues.length || unchanged || preview.isPending} data-testid="button-preview-template">
          {preview.isPending ? <Loader2 className="me-1 size-4 animate-spin" /> : <Eye className="me-1 size-4" />} معاينة الأثر
        </Button>
        <Button size="sm" onClick={() => void runApply()} disabled={!fresh || apply.isPending} data-testid="button-apply-template">
          {apply.isPending ? <Loader2 className="me-1 size-4 animate-spin" /> : <ShieldCheck className="me-1 size-4" />} تطبيق على المرتبطين
        </Button>
        <span className="text-[11px] text-muted-foreground" data-testid="text-template-preview-state">
          {unchanged ? "لا تعديل بعد." : fresh ? `معاينة حالية · بصمة ${impact!.result.digest.slice(0, 12)}` : "التعديل يتطلب معاينة جديدة قبل التطبيق."}
        </span>
      </div>

      {impact && fresh && <ImpactTable impact={impact.result} label={label} bName={bName} wName={wName} />}
    </div>
  );
}

export function ImpactTable({ impact, label, bName, wName }: { impact: PermissionTemplateImpact; label: (a: string) => string; bName: (id: number) => string; wName: (id: number) => string }) {
  if (impact.effects.length === 0) return <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground" data-testid="state-impact-empty">لا مسؤوليات مرتبطة بهذا القالب — يتغير القالب وحده.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border" data-testid="table-template-impact">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-[11px] text-muted-foreground">
          <tr><th className="p-2 text-start">الشخص</th><th className="p-2 text-start">النطاق</th><th className="p-2 text-start">الحالة</th><th className="p-2 text-start">الفعلي قبل ← بعد</th></tr>
        </thead>
        <tbody className="divide-y">
          {impact.effects.map((e) => {
            const added = e.effectiveAfter.filter((a) => !e.effectiveBefore.includes(a));
            const removed = e.effectiveBefore.filter((a) => !e.effectiveAfter.includes(a));
            const kept = e.effectiveAfter.filter((a) => e.effectiveBefore.includes(a));
            return (
              <tr key={e.grantId} className="align-top" data-testid={`row-impact-${e.grantId}`}>
                <td className="p-2"><div className="font-medium">{e.name}</div><div className="text-[10px] text-muted-foreground">{e.status}</div></td>
                <td className="p-2 text-[11px]">
                  {bName(e.branchId)} · {e.warehouseIds.map(wName).join("، ")}
                  <div className="text-muted-foreground">{e.amountLimit ? `سقف ${e.amountLimit} ر.س` : "بلا سقف"}{e.startsAt ? ` · من ${new Date(e.startsAt).toLocaleDateString("ar-SA")}` : ""}{e.endsAt ? ` · حتى ${new Date(e.endsAt).toLocaleDateString("ar-SA")}` : ""}</div>
                </td>
                <td className="p-2">
                  <span className={cn("rounded border px-1.5 py-0.5 text-[10px]", e.mode === "override" ? "border-amber-300 text-amber-800 dark:text-amber-300" : "border-sky-300 text-sky-800 dark:text-sky-300")} data-testid={`status-impact-mode-${e.grantId}`}>
                    {e.mode === "override" ? "استثناء فردي — لا يتغير" : "يرث القالب"}
                  </span>
                  {e.blocked && <div className="mt-1 text-[10px] font-semibold text-destructive" data-testid={`status-impact-blocked-${e.grantId}`}>محجوب: الحساب موقوف أو بلا استحقاق</div>}
                  {e.deniedActions.length > 0 && <div className="mt-1 text-[10px] text-destructive">ممنوع: {e.deniedActions.map(label).join("، ")}</div>}
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    {kept.map((a) => <span key={a} className="rounded bg-muted px-1.5 py-0.5">{label(a)}</span>)}
                    {added.map((a) => <span key={a} className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">+ {label(a)}</span>)}
                    {removed.map((a) => <span key={a} className="rounded bg-rose-100 px-1.5 py-0.5 text-rose-800 line-through dark:bg-rose-950 dark:text-rose-200">{label(a)}</span>)}
                    {e.effectiveAfter.length === 0 && removed.length === 0 && <span className="text-muted-foreground">لا وصول فعلي</span>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
