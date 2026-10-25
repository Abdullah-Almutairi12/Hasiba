import { useState } from "react";
import { useUpdateAdministrator, useRevokeCompanyMemberAccess, type AdministrationMember, type AdministrationWorkspace } from "@workspace/api-client-react";
import { Crown, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/lib/team-access";
import { RIGHT_LABEL, RIGHTS, RightChips, Empty } from "@/components/administration/shared";

type Revoke = { member: AdministrationMember; departure: "suspend" | "terminate" } | null;

export function MembersPanel({ ws, canManage, onChanged }: { ws: AdministrationWorkspace; canManage: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const update = useUpdateAdministrator();
  const revoke = useRevokeCompanyMemberAccess();
  const owner = ws.isPrimaryOwner === true;
  const [target, setTarget] = useState<AdministrationMember | null>(null);
  const [resp, setResp] = useState<string[]>([]);
  const [rv, setRv] = useState<Revoke>(null);
  const [rvAck, setRvAck] = useState(false);
  const open = (m: AdministrationMember) => { setTarget(m); setResp(m.responsibilities ?? []); };
  const reducing = target ? (target.responsibilities ?? []).some((r) => !resp.includes(r)) : false;
  const isOwnerRow = (m: AdministrationMember) => m.primary_owner === true || (ws.primaryOwnerId != null && m.id === ws.primaryOwnerId);
  const save = async () => {
    if (!target) return;
    try {
      await update.mutateAsync({ id: target.id, data: { responsibilities: resp, active: resp.length > 0 } });
      toast({ title: "حُدّثت مسؤوليات الإدارة" }); setTarget(null);
    } catch (err) { toast({ title: "تعذر التحديث", description: errorText(err), variant: "destructive" }); }
    finally { onChanged(); }
  };
  const doRevoke = async () => {
    if (!rv) return;
    try {
      await revoke.mutateAsync({ id: rv.member.id, data: { departure: rv.departure } });
      toast({ title: rv.departure === "suspend" ? `عُلّق وصول ${rv.member.name}` : `أُزيلت عضوية ${rv.member.name}` });
      setRv(null); setRvAck(false);
    } catch (err) { toast({ title: "تعذر تنفيذ الإجراء", description: errorText(err), variant: "destructive" }); }
    finally { onChanged(); }
  };
  return (
    <section className="rounded-2xl border bg-card" data-testid="panel-members">
      <h2 className="flex items-center gap-2 border-b p-4 font-bold"><Users className="size-4 text-primary" /> أعضاء المنشأة <span className="text-sm font-normal text-muted-foreground">({ws.members.length} · {ws.pending.length} بانتظار التفعيل)</span></h2>
      {ws.members.length + ws.pending.length === 0 ? <div className="p-4"><Empty text="لا أعضاء ظاهرون لك." testId="state-members-empty" /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="p-2.5 text-start font-medium">الاسم</th><th className="p-2.5 text-start font-medium">الحالة</th><th className="p-2.5 text-start font-medium">مسؤوليات الإدارة</th><th className="p-2.5" /></tr></thead>
            <tbody className="divide-y">
              {ws.members.map((m) => {
                const protectedRow = isOwnerRow(m);
                const self = m.id === ws.userId;
                return (
                  <tr key={`m${m.id}`} data-testid={`row-member-${m.id}`}>
                    <td className="p-2.5 font-medium">{m.name}{self && <span className="ms-1 text-xs text-primary">(أنت)</span>}
                      {protectedRow && <span className="ms-2 inline-flex items-center gap-1 rounded-full border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" data-testid={`badge-primary-owner-${m.id}`}><Crown className="size-3" /> مالك النظام</span>}</td>
                    <td className="p-2.5 text-xs text-muted-foreground">{m.status==="active" ? (m.role==="scoped"?"دخول نشط · مستخدم مقيّد":"دخول نشط") : m.status??"دخول نشط"}</td>
                    <td className="p-2.5"><RightChips list={m.responsibilities ?? []} /></td>
                    <td className="p-2.5 text-end">
                      <div className="flex flex-wrap justify-end gap-1">
                        {canManage && !self && !protectedRow && (owner || (m.responsibilities?.length ?? 0) > 0) &&
                          <Button size="sm" variant="ghost" onClick={() => open(m)} data-testid={`button-edit-admin-${m.id}`}>{owner ? ((m.responsibilities?.length ?? 0) > 0 ? "تعديل المسؤوليات" : "تعيين مديرًا") : "سحب مسؤوليات"}</Button>}
                        {owner && !self && !protectedRow && <>
                          <Button size="sm" variant="ghost" className="text-amber-700 dark:text-amber-300" onClick={() => { setRvAck(false); setRv({ member: m, departure: "suspend" }); }} data-testid={`button-suspend-member-${m.id}`}>تعليق</Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { setRvAck(false); setRv({ member: m, departure: "terminate" }); }} data-testid={`button-terminate-member-${m.id}`}>إزالة العضوية</Button>
                        </>}
                        {protectedRow && !self && owner === false && canManage && <span className="text-[11px] text-muted-foreground" data-testid={`text-owner-protected-${m.id}`}>محمي — يتغير فقط بنقل مالك النظام</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
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
          <DialogHeader><DialogTitle>إدارة {target?.name}</DialogTitle><DialogDescription>{owner
            ? "بصفتك مالك النظام يمكنك إضافة مسؤوليات أو زيادتها أو سحبها فورًا دون انتظار قبول. لا تُمنح صلاحيات مالية مع الإدارة. الخادم يمنع إزالة آخر مدير نشط."
            : "هنا يمكنك سحب مسؤوليات فقط. منح مسؤوليات جديدة يتم بتعيين يقبله المستلم من «تسليم أو إضافة مدير». الخادم يمنع إزالة آخر مدير نشط."}</DialogDescription></DialogHeader>
          <RightsPicker value={resp} onChange={setResp} prefix="member" options={owner ? RIGHTS : target?.responsibilities ?? []} />
          {reducing && <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-2 text-xs" data-testid="warning-reduce-admin">تحذير: هذا يسحب مسؤوليات إدارية من {target?.name} فورًا.</p>}
          <DialogFooter><Button variant="ghost" onClick={() => setTarget(null)}>إلغاء</Button><Button variant={reducing ? "destructive" : "default"} disabled={update.isPending} onClick={() => void save()} data-testid="button-save-admin">حفظ</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!rv} onOpenChange={(o) => !o && setRv(null)}>
        <DialogContent dir="rtl" className="sm:max-w-md" data-testid="dialog-revoke-member">
          <DialogHeader><DialogTitle>{rv?.departure === "suspend" ? `تعليق وصول ${rv?.member.name}` : `إزالة ${rv?.member.name} من المنشأة`}</DialogTitle>
            <DialogDescription>لا يتطلب هذا موافقة العضو. يبقى السجل التاريخي وقيوده كما هي.</DialogDescription></DialogHeader>
          <ul className="list-disc space-y-1 ps-5 text-sm" data-testid="list-revoke-consequences">
            <li>تُبطل جلساته في هذه المنشأة فورًا.</li>
            <li>تُسحب منه أي مسؤوليات إدارية.</li>
            {rv?.departure === "suspend" ? <li>يمكن إعادة تفعيل وصوله لاحقًا من إعداد الفريق.</li> : <li>تنتهي عضويته في المنشأة؛ عودته تحتاج دعوة جديدة.</li>}
          </ul>
          <label className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-sm">
            <Checkbox checked={rvAck} onCheckedChange={(v) => setRvAck(v === true)} data-testid="checkbox-revoke-ack" /> فهمت العواقب وأريد المتابعة.
          </label>
          <DialogFooter><Button variant="ghost" onClick={() => setRv(null)}>إلغاء</Button>
            <Button variant="destructive" disabled={!rvAck || revoke.isPending} onClick={() => void doRevoke()} data-testid="button-confirm-revoke">{rv?.departure === "suspend" ? "تعليق الوصول" : "إزالة العضوية"}</Button></DialogFooter>
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
