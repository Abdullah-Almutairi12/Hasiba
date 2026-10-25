import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPosDevices, useRegisterPosDevice, useChangePosDevice, useSetPosEmployeePin,
  useListBranches, useListTeamPeople, getListPosDevicesQueryKey, type PosDevice,
} from "@workspace/api-client-react";
import { MonitorSmartphone, Plus, KeyRound, Ban, Copy, ShieldAlert, RefreshCw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { getPublicJwk, parsePublicJwk, setRegistrationId, deviceCryptoSupported } from "@/lib/pos-device-client";

const statusOf = (e: unknown) => (e as { status?: number })?.status;
const msgOf = (e: unknown, f: string) => (e as { data?: { error?: string } })?.data?.error ?? f;
const validPin = (p: string) => /^\d{6,10}$/.test(p) && !/^(\d)\1+$/.test(p);
const ACTION_AR: Record<string, string> = { register: "تسجيل", registered: "تسجيل", activation: "إصدار رمز تفعيل", activated: "تفعيل الجهاز", revoke: "إلغاء", revoked: "إلغاء" };
const STATUS_AR: Record<string, string> = { registered: "بانتظار التفعيل", active: "مفعّل", revoked: "ملغى" };

function Forbidden({ what }: { what: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid={`text-forbidden-${what}`}>
      <ShieldAlert className="mt-0.5 size-4 shrink-0" />
      ليست لديك صلاحية {what === "devices" ? "إدارة الإعدادات اللازمة لأجهزة نقاط البيع" : "إدارة المستخدمين اللازمة لتعيين الرموز السرية"}. اطلبها من مالك الشركة.
    </div>
  );
}

function ActivationCountdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => { const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000); return () => clearInterval(t); }, []);
  return <span className="font-mono" data-testid="text-activation-countdown">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</span>;
}

export default function SettingsPosDevicesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const devices = useListPosDevices({ query: { queryKey: getListPosDevicesQueryKey(), retry: false } });
  const branches = useListBranches();
  const people = useListTeamPeople({ query: { retry: false } as never });
  const register = useRegisterPosDevice();
  const change = useChangePosDevice();
  const setPin = useSetPosEmployeePin();

  const [regOpen, setRegOpen] = useState(false);
  const [form, setForm] = useState({ name: "", branchId: "", stationName: "", keySource: "this" as "this" | "pasted", pasted: "" });
  const [regError, setRegError] = useState("");
  const [token, setToken] = useState<{ deviceId: string; value: string; expiresIn: number } | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<PosDevice | null>(null);
  const [pinTarget, setPinTarget] = useState<{ id: number; name: string } | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [pinError, setPinError] = useState("");

  const branchName = useMemo(() => new Map((branches.data ?? []).map((b) => [b.id, b.nameAr || b.name])), [branches.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: getListPosDevicesQueryKey() });

  const submitRegister = async () => {
    setRegError("");
    const branchId = Number(form.branchId);
    if (!form.name.trim() || !form.stationName.trim() || !branchId) { setRegError("أكمل الاسم والفرع ونقطة البيع."); return; }
    let publicJwk;
    try {
      publicJwk = form.keySource === "this" ? await getPublicJwk() : parsePublicJwk(form.pasted.trim());
    } catch { setRegError("تعذر قراءة مفتاح هذا المتصفح."); return; }
    if (!publicJwk) { setRegError("المفتاح العام الملصق غير صالح (EC P-256 بالحقول kty/crv/x/y فقط)."); return; }
    register.mutate({ data: { name: form.name.trim(), branchId, stationName: form.stationName.trim(), publicJwk } }, {
      onSuccess: (d) => {
        if (form.keySource === "this") setRegistrationId(d.id);
        toast({ title: "تم تسجيل الجهاز", description: `معرّف التسجيل: ${d.id}` });
        setRegOpen(false);
        setForm({ name: "", branchId: "", stationName: "", keySource: "this", pasted: "" });
        void refresh();
      },
      onError: (e) => setRegError(statusOf(e) === 403 ? "ليست لديك صلاحية تسجيل الأجهزة." : msgOf(e, "تعذر تسجيل الجهاز.")),
    });
  };

  const issueActivation = (d: PosDevice) => change.mutate({ id: d.id, action: "activation" }, {
    onSuccess: (r) => { if (r.activationToken) setToken({ deviceId: d.id, value: r.activationToken, expiresIn: r.expiresIn ?? 300 }); void refresh(); },
    onError: (e) => toast({ title: statusOf(e) === 403 ? "غير مصرح" : "تعذر إصدار رمز التفعيل", description: msgOf(e, ""), variant: "destructive" }),
  });

  const doRevoke = () => revokeTarget && change.mutate({ id: revokeTarget.id, action: "revoke" }, {
    onSuccess: () => { toast({ title: "تم إلغاء الجهاز" }); setRevokeTarget(null); void refresh(); },
    onError: (e) => toast({ title: "تعذر الإلغاء", description: msgOf(e, ""), variant: "destructive" }),
  });

  const savePin = () => {
    if (!pinTarget) return;
    if (!validPin(pinValue)) { setPinError("من 6 إلى 10 أرقام، ولا يكون رقماً واحداً مكرراً."); return; }
    setPin.mutate({ id: pinTarget.id, data: { pin: pinValue } }, {
      onSuccess: () => { toast({ title: `تم تعيين الرمز السري لـ ${pinTarget.name}` }); setPinTarget(null); setPinValue(""); setPinError(""); },
      onError: (e) => { setPinValue(""); setPinError(statusOf(e) === 403 ? "ليست لديك صلاحية إدارة المستخدمين." : msgOf(e, "تعذر حفظ الرمز.")); },
    });
  };

  const devForbidden = statusOf(devices.error) === 403;
  const peopleForbidden = statusOf(people.error) === 403;
  const activePeople = (people.data ?? []).filter((p) => p.status !== "removed");

  return (
    <div dir="rtl" className="space-y-6" data-testid="page-settings-pos-devices">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><MonitorSmartphone className="size-6 text-primary" />أجهزة نقاط البيع الموثوقة</h1>
          <p className="text-sm text-muted-foreground">الكاشير يفتح الجهاز برقمه ورمز سري، ولا يحصل على أي صلاحية إدارية. الإثبات برمجي من المتصفح وليس TPM.</p>
        </div>
        {!devForbidden && <Button onClick={() => setRegOpen(true)} data-testid="button-register-device"><Plus className="me-1 size-4" />تسجيل جهاز</Button>}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div><CardTitle className="text-base">الأجهزة</CardTitle><CardDescription>كل جهاز مرتبط بفرع ونقطة بيع.</CardDescription></div>
          <Button variant="ghost" size="sm" onClick={() => void devices.refetch()} disabled={devices.isFetching} data-testid="button-refresh-devices"><RefreshCw className={`size-4 ${devices.isFetching ? "animate-spin" : ""}`} /></Button>
        </CardHeader>
        <CardContent>
          {devices.isLoading ? (
            <div className="space-y-2" data-testid="skeleton-devices">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}</div>
          ) : devForbidden ? <Forbidden what="devices" />
          : devices.isError ? (
            <div className="flex items-center gap-3 text-sm text-destructive" data-testid="text-devices-error">تعذر تحميل الأجهزة.<Button size="sm" variant="outline" onClick={() => void devices.refetch()} data-testid="button-retry-devices">إعادة المحاولة</Button></div>
          ) : !devices.data?.length ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="empty-devices">لا توجد أجهزة مسجلة بعد. سجّل أول جهاز لكاشير الفرع.</div>
          ) : (
            <div className="divide-y">
              {devices.data.map((d) => (
                <div key={d.id} className="flex flex-wrap items-center gap-3 py-3" data-testid={`row-device-${d.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium">
                      <span data-testid={`text-device-name-${d.id}`}>{d.name ?? "—"}</span>
                      <Badge variant={d.status === "active" ? "default" : d.status === "revoked" ? "destructive" : "secondary"} data-testid={`status-device-${d.id}`}>{STATUS_AR[d.status] ?? d.status}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {d.branchId ? branchName.get(d.branchId) ?? `فرع #${d.branchId}` : "—"} · {d.stationName ?? "—"} · الجيل {d.generation ?? 0}
                      {d.activationExpiresAt && d.status === "registered" && <> · ينتهي التفعيل {new Date(d.activationExpiresAt).toLocaleTimeString("ar-SA")}</>}
                    </div>
                    <div dir="ltr" className="truncate text-end font-mono text-[10px] text-muted-foreground">id {d.id} · key {d.keyHash?.slice(0, 16)}</div>
                    <details className="mt-1 text-xs" data-testid={`history-device-${d.id}`}>
                      <summary className="cursor-pointer text-muted-foreground" data-testid={`button-history-${d.id}`}>السجل ({d.history?.length ?? 0})</summary>
                      {d.history?.length ? (
                        <ol className="mt-1 space-y-0.5 border-s ps-3">
                          {d.history.map((h, i) => (
                            <li key={i} data-testid={`row-history-${d.id}-${i}`}>
                              <span className="font-medium">{ACTION_AR[h.action] ?? h.action}</span>
                              <span className="text-muted-foreground"> · {h.actor} · {new Date(h.createdAt).toLocaleString("ar-SA")}</span>
                            </li>
                          ))}
                        </ol>
                      ) : <p className="mt-1 text-muted-foreground" data-testid={`empty-history-${d.id}`}>لا يوجد سجل.</p>}
                    </details>
                  </div>
                  {d.status !== "revoked" && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={change.isPending} onClick={() => issueActivation(d)} data-testid={`button-activation-${d.id}`}>
                        <KeyRound className="me-1 size-4" />{d.status === "active" ? "إعادة التفعيل" : "رمز تفعيل"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setRevokeTarget(d)} data-testid={`button-revoke-${d.id}`}><Ban className="me-1 size-4" />إلغاء</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">الرموز السرية للكاشيرين</CardTitle><CardDescription>رقم الموظف هو ما يدخله الكاشير على الجهاز. لا تُعرض الرموز بعد حفظها.</CardDescription></CardHeader>
        <CardContent>
          {people.isLoading ? <div className="h-24 animate-pulse rounded-md bg-muted" data-testid="skeleton-people" />
          : peopleForbidden ? <Forbidden what="people" />
          : people.isError ? <div className="flex items-center gap-3 text-sm text-destructive" data-testid="text-people-error">تعذر تحميل الفريق.<Button size="sm" variant="outline" onClick={() => void people.refetch()} data-testid="button-retry-people">إعادة المحاولة</Button></div>
          : !activePeople.length ? <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="empty-people">لا يوجد أفراد في الفريق. أضفهم من المستخدمين والصلاحيات.</div>
          : (
            <div className="divide-y">
              {activePeople.map((p) => (
                <div key={p.personId} className="flex items-center gap-3 py-2.5" data-testid={`row-person-${p.personId}`}>
                  <span className="grid size-8 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">{p.name.slice(0, 1)}</span>
                  <div className="flex-1"><div className="text-sm font-medium">{p.name}</div><div className="text-xs text-muted-foreground">رقم الموظف <span className="font-mono" data-testid={`text-person-id-${p.personId}`}>{p.personId}</span>{p.status !== "active" && ` · ${p.status}`}</div></div>
                  <Button size="sm" variant="outline" onClick={() => { setPinTarget({ id: p.personId, name: p.name }); setPinValue(""); setPinError(""); }} data-testid={`button-set-pin-${p.personId}`}>تعيين رمز سري</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={regOpen} onOpenChange={setRegOpen}>
        <DialogContent dir="rtl" data-testid="dialog-register-device">
          <DialogHeader><DialogTitle>تسجيل جهاز نقطة بيع</DialogTitle><DialogDescription>المفتاح الخاص لا يغادر الجهاز أبداً؛ يُرسل المفتاح العام فقط.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label>اسم الجهاز</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} data-testid="input-device-name" /></div>
            <div className="space-y-1.5">
              <Label>الفرع</Label>
              <select className="h-10 w-full rounded-md border bg-background px-2 text-sm" value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })} disabled={branches.isLoading} data-testid="select-device-branch">
                <option value="">{branches.isLoading ? "جارٍ التحميل…" : branches.isError ? "تعذر تحميل الفروع" : "اختر الفرع"}</option>
                {(branches.data ?? []).filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.nameAr || b.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label>نقطة البيع (المحطة)</Label><Input value={form.stationName} onChange={(e) => setForm({ ...form, stationName: e.target.value })} maxLength={120} placeholder="مثال: الكاشير 2" data-testid="input-station-name" /></div>
            <div className="space-y-2">
              <Label>المفتاح العام</Label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" checked={form.keySource === "this"} disabled={!deviceCryptoSupported()} onChange={() => setForm({ ...form, keySource: "this" })} data-testid="radio-key-this" />هذا المتصفح هو جهاز نقطة البيع</label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" checked={form.keySource === "pasted"} onChange={() => setForm({ ...form, keySource: "pasted" })} data-testid="radio-key-pasted" />لصق مفتاح منسوخ من متصفح آخر (/pos-device)</label>
              {form.keySource === "pasted" && <Textarea dir="ltr" rows={3} value={form.pasted} onChange={(e) => setForm({ ...form, pasted: e.target.value })} placeholder='{"kty":"EC","crv":"P-256","x":"…","y":"…"}' data-testid="input-public-jwk" />}
            </div>
            {regError && <p role="alert" className="text-sm text-destructive" data-testid="text-register-error">{regError}</p>}
          </div>
          <DialogFooter><Button onClick={() => void submitRegister()} disabled={register.isPending} data-testid="button-submit-register">{register.isPending ? "جارٍ التسجيل…" : "تسجيل"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!token} onOpenChange={(o) => !o && setToken(null)}>
        <DialogContent dir="rtl" data-testid="dialog-activation-token">
          <DialogHeader><DialogTitle>رمز التفعيل — يُعرض مرة واحدة</DialogTitle><DialogDescription>أدخله على الجهاز في صفحة /pos-device قبل انتهاء المهلة. لن يظهر مرة أخرى.</DialogDescription></DialogHeader>
          {token && <>
            <pre dir="ltr" className="select-all break-all rounded-md bg-muted p-3 font-mono text-sm" data-testid="text-activation-token">{token.value}</pre>
            <p className="text-sm">معرّف التسجيل: <span dir="ltr" className="font-mono" data-testid="text-activation-device-id">{token.deviceId}</span> · المتبقي <ActivationCountdown seconds={token.expiresIn} /></p>
          </>}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => token && void navigator.clipboard.writeText(token.value).then(() => toast({ title: "تم النسخ" }), () => toast({ title: "تعذر النسخ", variant: "destructive" }))} data-testid="button-copy-token"><Copy className="me-1 size-4" />نسخ</Button>
            <Button onClick={() => setToken(null)} data-testid="button-close-token">تم</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!revokeTarget} onOpenChange={(o) => !o && setRevokeTarget(null)}>
        <DialogContent dir="rtl" data-testid="dialog-revoke-device">
          <DialogHeader><DialogTitle>إلغاء الجهاز «{revokeTarget?.name}»؟</DialogTitle><DialogDescription>تنتهي أي جلسة كاشير مفتوحة عليه فوراً، ويحتاج تسجيلاً جديداً لإعادة استخدامه.</DialogDescription></DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setRevokeTarget(null)} data-testid="button-cancel-revoke">تراجع</Button>
            <Button variant="destructive" onClick={doRevoke} disabled={change.isPending} data-testid="button-confirm-revoke">{change.isPending ? "جارٍ…" : "إلغاء الجهاز"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pinTarget} onOpenChange={(o) => { if (!o) { setPinTarget(null); setPinValue(""); } }}>
        <DialogContent dir="rtl" data-testid="dialog-set-pin">
          <DialogHeader><DialogTitle>رمز سري لـ {pinTarget?.name}</DialogTitle><DialogDescription>من 6 إلى 10 أرقام، ليس رقماً مكرراً. خاص بنقطة البيع فقط وليس كلمة مرور المنصة.</DialogDescription></DialogHeader>
          <Input dir="ltr" type="password" inputMode="numeric" autoComplete="new-password" maxLength={10} value={pinValue} onChange={(e) => { setPinValue(e.target.value.replace(/\D/g, "")); setPinError(""); }} data-testid="input-new-pin" />
          {pinError && <p role="alert" className="text-sm text-destructive" data-testid="text-pin-error">{pinError}</p>}
          <DialogFooter><Button onClick={savePin} disabled={setPin.isPending || !pinValue} data-testid="button-save-pin">{setPin.isPending ? "جارٍ الحفظ…" : "حفظ"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
