import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAct } from "@/hooks/use-returns-actions";
import { Empty, ErrorBox } from "@/components/returns/ui";
import { cn } from "@/lib/utils";
import { CAPS, field, label, money, num, numArr, str, strArr, type ErrInfo, type Rec } from "@/lib/returns/shared";

/* ---------------- Config ---------------- */
export function ConfigTab({ members, access, templates, branches, policies, branchName, meId }: {
  members: Rec[]; access: Rec[]; templates: Rec; branches: Rec[]; policies: Rec[]; branchName: (id: unknown) => string; meId: number | null;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section className="space-y-2">
        <h3 className="font-bold">صلاحيات الأعضاء</h3>
        {members.length === 0 && <Empty title="لا يوجد أعضاء" hint="أعضاء الشركة يظهرون هنا لتحديد صلاحيات المرتجعات." />}
        {members.map((m) => {
          const uid = str(m.user_id);
          const a = access.find((x) => str(x.user_id) === uid);
          const self = meId !== null && num(m.user_id) === meId;
          return (
            <div key={uid} className="rounded-2xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{str(m.name, `مستخدم ${uid}`)}</span>
                <span className="text-xs text-muted-foreground">{str(m.role)}</span>
                {a && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{str(a.template)}</span>}
                {self ? <span className="ms-auto text-xs text-muted-foreground">لا يمكن تعديل صلاحياتك</span> : (
                  <Button size="sm" variant="outline" className="ms-auto" onClick={() => setEditing(editing === uid ? null : uid)}>{editing === uid ? "إغلاق" : "تعديل"}</Button>
                )}
              </div>
              {a && <p className="mt-1 text-xs text-muted-foreground">{strArr(a.capabilities).map((c) => label(CAPS, c)).join("، ") || "بدون صلاحيات"} · {numArr(a.branches).map(branchName).join("، ") || "بدون فروع"}</p>}
              {editing === uid && !self && <AccessEditor userId={uid} current={a} templates={templates} branches={branches} onDone={() => setEditing(null)} />}
            </div>
          );
        })}
      </section>
      <PolicyEditor policies={policies} branches={branches} branchName={branchName} />
    </div>
  );
}

function AccessEditor({ userId, current, templates, branches, onDone }: { userId: string; current?: Rec; templates: Rec; branches: Rec[]; onDone: () => void }) {
  const { run, pending } = useAct();
  const { toast } = useToast();
  const tplNames = Object.keys(templates);
  const [tpl, setTpl] = useState(str(current?.template) || tplNames[0] || "");
  const [capsSel, setCapsSel] = useState<string[]>(current ? strArr(current.capabilities) : strArr(templates[tpl]));
  const [br, setBr] = useState<number[]>(current ? numArr(current.branches) : []);
  const [err, setErr] = useState<ErrInfo | null>(null);
  const allCaps = Array.from(new Set([...Object.keys(CAPS), ...tplNames.flatMap((t) => strArr(templates[t]))]));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-muted/50 p-3">
      <div><Label>القالب</Label>
        <select className={field} value={tpl} onChange={(e) => { setTpl(e.target.value); setCapsSel(strArr(templates[e.target.value])); }}>
          {tplNames.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div><Label>الصلاحيات</Label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {allCaps.map((c) => (
            <button key={c} type="button" onClick={() => setCapsSel((s) => toggle(s, c))}
              className={cn("rounded-full border px-2.5 py-1 text-xs", capsSel.includes(c) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background")}>{label(CAPS, c)}</button>
          ))}
        </div>
      </div>
      <div><Label>الفروع</Label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {branches.map((b) => { const id = num(b.id); if (id === null) return null; return (
            <button key={id} type="button" onClick={() => setBr((s) => toggle(s, id))}
              className={cn("rounded-full border px-2.5 py-1 text-xs", br.includes(id) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background")}>{str(b.name_ar, `فرع ${id}`)}</button>
          ); })}
        </div>
      </div>
      {err && <ErrorBox err={err} onClose={() => setErr(null)} />}
      <Button size="sm" disabled={pending || !tpl} onClick={async () => {
        setErr(null);
        const r = await run("configure_access", { userId: Number(userId), template: tpl, capabilities: capsSel, branches: br });
        if (r.ok) { toast({ title: "حُفظت الصلاحيات" }); onDone(); } else setErr(r.err);
      }}>{pending ? "جارٍ الحفظ..." : "حفظ الصلاحيات"}</Button>
    </div>
  );
}

function PolicyEditor({ policies, branches, branchName }: { policies: Rec[]; branches: Rec[]; branchName: (id: unknown) => string }) {
  const { run, pending } = useAct();
  const { toast } = useToast();
  const [branchId, setBranchId] = useState("0");
  const cur = policies.find((p) => str(p.branch_id) === branchId);
  const [threshold, setThreshold] = useState("");
  const [allowResale, setAllowResale] = useState(false);
  const [err, setErr] = useState<ErrInfo | null>(null);
  useEffect(() => {
    setThreshold(cur && cur.approval_above != null ? str(cur.approval_above) : "");
    setAllowResale(cur?.allow_resale === true);
  }, [branchId, cur?.approval_above, cur?.allow_resale]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = threshold.trim() === "" ? null : num(threshold);
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <h3 className="font-bold">سياسة الاعتماد والبيع</h3>
      <ul className="space-y-1 text-xs">
        {policies.map((p) => (
          <li key={str(p.branch_id)} className="flex justify-between gap-2 rounded-lg bg-muted/50 px-2 py-1.5">
            <span>{branchName(p.branch_id)}</span>
            <span className="text-muted-foreground">{p.approval_above == null ? "مباشر للمعتمدين" : `اعتماد فوق ${money(p.approval_above)}`} · {p.allow_resale === true ? "إعادة البيع مسموحة" : "بدون إعادة بيع"}</span>
          </li>
        ))}
      </ul>
      <div><Label>النطاق</Label>
        <select className={field} value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="0">افتراضي الشركة</option>
          {branches.map((b) => <option key={str(b.id)} value={str(b.id)}>{str(b.name_ar, `فرع ${str(b.id)}`)}</option>)}
        </select>
      </div>
      <div><Label>يتطلب اعتمادًا فوق مبلغ (اتركه فارغًا = مباشر للمعتمدين المخولين)</Label>
        <Input type="number" min={0} step="0.01" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={allowResale} onChange={(e) => setAllowResale(e.target.checked)} />
        السماح بإعادة البضاعة المرتجعة للبيع
      </label>
      {err && <ErrorBox err={err} onClose={() => setErr(null)} />}
      <Button size="sm" disabled={pending || (threshold.trim() !== "" && (t === null || t < 0))} onClick={async () => {
        setErr(null);
        const r = await run("configure_policy", { branchId: Number(branchId), approvalAbove: t, allowResale });
        if (r.ok) toast({ title: "حُفظت السياسة" }); else setErr(r.err);
      }}>{pending ? "جارٍ الحفظ..." : "حفظ السياسة"}</Button>
    </section>
  );
}
