import { useState } from "react";
import { useUpdateAdministrator, type AdministrationMember, type AdministrationWorkspace } from "@workspace/api-client-react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/team-access";
import { RIGHT_LABEL, RIGHTS, RightChips, Empty } from "@/components/administration/shared";

export function MembersPanel({ ws, canManage, onChanged }: { ws: AdministrationWorkspace; canManage: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const update = useUpdateAdministrator();
  const [target, setTarget] = useState<AdministrationMember | null>(null);
  const [resp, setResp] = useState<string[]>([]);
  const open = (m: AdministrationMember) => { setTarget(m); setResp(m.responsibilities ?? []); };
  const reducing = target ? (target.responsibilities ?? []).some((r) => !resp.includes(r)) : false;
  const save = async () => {
    if (!target) return;
    try {
      await update.mutateAsync({ id: target.id, data: { responsibilities: resp, active: resp.length > 0 } });
      toast({ title: "حُدّثت مسؤوليات الإدارة" }); setTarget(null);
    } catch (err) { toast({ title: "تعذر التحديث", description: errorText(err), variant: "destructive" }); }
    finally { onChanged(); }
  };
  return (
    <section className="rounded-2xl border bg-card" data-testid="panel-members">
      <h2 className="flex items-center gap-2 border-b p-4 font-bold"><Users className="size-4 text-primary" /> أعضاء المنشأة <span className="text-sm font-normal text-muted-foreground">({ws.members.length} · {ws.pending.length} بانتظار التفعيل)</span></h2>
      {ws.members.length + ws.pending.length === 0 ? <div className="p-4"><Empty text="لا أعضاء ظاهرون لك." testId="state-members-empty" /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="p-2.5 text-start font-medium">الاسم</th><th className="p-2.5 text-start font-medium">الحالة</th><th className="p-2.5 text-start font-medium">مسؤوليات الإدارة</th><th className="p-2.5" /></tr></thead>
            <tbody className="divide-y">
              {ws.members.map((m) => (
                <tr key={`m${m.id}`} data-testid={`row-member-${m.id}`}>
                  <td className="p-2.5 font-medium">{m.name}{m.id === ws.userId && <span className="ms-1 text-xs text-primary">(أنت)</span>}</td>
                  <td className="p-2.5 text-xs text-muted-foreground">{m.active === false ? "غير نشط" : m.status ?? m.role ?? "نشط"}</td>
                  <td className="p-2.5"><RightChips list={m.responsibilities ?? []} /></td>
                  <td className="p-2.5 text-end">{canManage && m.id !== ws.userId && (m.responsibilities?.length ?? 0) > 0 && <Button size="sm" variant="ghost" onClick={() => open(m)} data-testid={`button-edit-admin-${m.id}`}>سحب مسؤوليات</Button>}</td>
                </tr>
              ))}
              {ws.pending.map((m) => (
                <tr key={`p${m.id}`} className="bg-amber-50/40 dark:bg-amber-950/10" data-testid={`row-pending-${m.id}`}>
                  <td className="p-2.5 font-medium">{m.name}</td><td className="p-2.5 text-xs text-amber-700 dark:text-amber-300">{m.status ?? "دعوة معلقة"}</td><td className="p-2.5 text-xs text-muted-foreground">—</td><td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader><DialogTitle>إدارة {target?.name}</DialogTitle><DialogDescription>هنا يمكنك سحب مسؤوليات فقط. منح مسؤوليات جديدة يتم بتعيين يقبله المستلم من «تسليم أو إضافة مدير». الخادم يمنع إزالة آخر مدير نشط.</DialogDescription></DialogHeader>
          <RightsPicker value={resp} onChange={setResp} prefix="member" options={target?.responsibilities ?? []} />
          {reducing && <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs" data-testid="warning-reduce-admin">تحذير: هذا يسحب مسؤوليات إدارية من {target?.name} فورًا.</p>}
          <DialogFooter><Button variant="ghost" onClick={() => setTarget(null)}>إلغاء</Button><Button variant={reducing ? "destructive" : "default"} disabled={update.isPending} onClick={() => void save()} data-testid="button-save-admin">حفظ</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function RightsPicker({ value, onChange, prefix, options = RIGHTS }: { value: string[]; onChange: (v: string[]) => void; prefix: string; options?: readonly string[] }) {
  return (
    <fieldset className="grid gap-1.5 sm:grid-cols-2">
      <legend className="mb-1 text-sm font-semibold">المسؤوليات الإدارية</legend>
      {options.map((r) => (
        <label key={r} className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm has-[[data-state=checked]]:border-primary/50 has-[[data-state=checked]]:bg-primary/5">
          <Checkbox checked={value.includes(r)} onCheckedChange={(v) => onChange(v === true ? [...value, r] : value.filter((x) => x !== r))} data-testid={`checkbox-${prefix}-right-${r}`} /> {RIGHT_LABEL[r] ?? r}
        </label>
      ))}
    </fieldset>
  );
}

