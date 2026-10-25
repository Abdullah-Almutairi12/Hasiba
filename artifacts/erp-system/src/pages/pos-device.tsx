import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { activatePosDevice, issuePosDeviceChallenge, lockPosDevice, unlockPosDevice } from "@workspace/api-client-react";
import { KeyRound, Copy, ShieldCheck, Lock, MonitorSmartphone, AlertTriangle, Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { selectResponsibility } from "@/lib/workspace-responsibility";
import {
  deviceCryptoSupported, forgetBlockReason, forgetDevice, readActor, rememberActor, unlockBlockReason, getPublicJwk, getRegistrationId, hasDeviceKey,
  setPosMode, setRegistrationId, signProof, type PublicJwk,
} from "@/lib/pos-device-client";

const ACTIVATED_KEY = "hasba:pos-device:activated";
const isActivatedLocal = () => { try { return localStorage.getItem(ACTIVATED_KEY) === getRegistrationId(); } catch { return false; } };
const markActivated = (id: string | null) => { try { if (id) localStorage.setItem(ACTIVATED_KEY, id); else localStorage.removeItem(ACTIVATED_KEY); } catch { /* ignore */ } };

function errText(e: unknown, fallback: string): string {
  const err = e as { status?: number; data?: { error?: string }; message?: string };
  if (err?.status === 429) return "محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.";
  if (err?.status === 401 || err?.status === 403) return err.data?.error ?? "رُفض الطلب: الجهاز أو بيانات الكاشير غير صالحة.";
  return err?.data?.error ?? fallback;
}

const validPin = (p: string) => /^\d{6,10}$/.test(p) && !/^(\d)\1+$/.test(p);

export default function PosDevicePage() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { user, isLoading } = useAuth();
  const supported = deviceCryptoSupported();
  const [regId, setRegId] = useState<string | null>(getRegistrationId());
  const [activated, setActivated] = useState(isActivatedLocal());
  const [jwk, setJwk] = useState<PublicJwk | null>(null);
  const [keyLoading, setKeyLoading] = useState(true);
  const [keyError, setKeyError] = useState("");
  const [copied, setCopied] = useState(false);
  const [regInput, setRegInput] = useState("");
  const [token, setToken] = useState("");
  const [personId, setPersonId] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const after = new URLSearchParams(window.location.search).get("after");

  useEffect(() => {
    if (!supported) { setKeyLoading(false); return; }
    let live = true;
    (async () => {
      try {
        if (!(await hasDeviceKey()) && getRegistrationId()) { setRegistrationId(null); markActivated(null); if (live) { setRegId(null); setActivated(false); } }
        const k = await getPublicJwk();
        if (live) setJwk(k);
      } catch { if (live) setKeyError("تعذر إنشاء أو قراءة مفتاح الجهاز في هذا المتصفح (IndexedDB/WebCrypto)."); }
      finally { if (live) setKeyLoading(false); }
    })();
    return () => { live = false; };
  }, [supported]);

  const copyKey = async () => {
    if (!jwk) return;
    try { await navigator.clipboard.writeText(JSON.stringify(jwk)); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setError("تعذر النسخ. حدد النص يدوياً."); }
  };

  const saveReg = () => {
    const v = regInput.trim();
    if (!/^[A-Za-z0-9_-]{6,80}$/.test(v)) { setError("معرّف التسجيل غير صالح."); return; }
    setRegistrationId(v); markActivated(null); setRegId(v); setActivated(false); setRegInput(""); setError("");
  };

  const activate = async () => {
    const t = token.trim();
    if (t.length < 30) { setError("رمز التفعيل غير مكتمل."); return; }
    setBusy(true); setError("");
    try {
      const proof = await signProof("activate", "POST", "/api/pos-device/activate", { token: t }, (d) => issuePosDeviceChallenge(d));
      await activatePosDevice({ deviceId: regId!, proof, token: t });
      markActivated(regId); setActivated(true); setToken("");
    } catch (e) { setError(errText(e, "فشل التفعيل. تأكد من الرمز وأنه لم تنتهِ صلاحيته (5 دقائق).")); }
    finally { setBusy(false); setToken(""); }
  };

  const unlock = async () => {
    const pid = Number(personId);
    if (!Number.isInteger(pid) || pid < 1) { setError("أدخل رقم الموظف."); return; }
    if (!validPin(pin)) { setError("الرمز السري من 6 إلى 10 أرقام وليس رقماً مكرراً."); return; }
    const blockedBy = unlockBlockReason(pid);
    if (blockedBy) { setPin(""); setError(blockedBy); return; }
    setBusy(true); setError("");
    const body = { personId: pid, pin };
    try {
      const proof = await signProof("unlock", "POST", "/api/pos-device/unlock", body, (d) => issuePosDeviceChallenge(d));
      const res = await unlockPosDevice({ deviceId: regId!, proof, ...body });
      const prev = readActor();
      const samePerson = prev && prev !== "unreadable" && prev.personId === (res.personId ?? pid);
      rememberActor(samePerson ? { personId: res.personId ?? pid } : { personId: res.personId ?? pid, userId: null, companyId: null });
      // Fresh identity: no previous user/company/responsibility state survives.
      selectResponsibility(qc, null);
      qc.clear();
      setPosMode(true);
      setPin(""); setPersonId("");
      setLocation("/my-work", { replace: true });
    } catch (e) { setPin(""); setError(errText(e, "تعذر فتح الجهاز. حاول مرة أخرى.")); }
    finally { setBusy(false); }
  };

  const reset = async () => {
    setError("");
    const reason = forgetBlockReason();
    if (reason) { setError(reason); return; }
    if (!window.confirm("إزالة التسجيل نهائية: يُحذف مفتاح هذا المتصفح ولن يعمل الجهاز حتى يسجله مسؤول من جديد ويصدر رمز تفعيل جديداً. التسجيل القديم يبقى على الخادم حتى يلغيه المسؤول. متابعة؟")) return;
    // The server session must be ended first; refuse if that cannot be confirmed.
    try { await lockPosDevice(); } catch (e) {
      if ((e as { status?: number }).status !== 401) { setError("تعذر التأكد من إنهاء جلسة الجهاز على الخادم؛ لم يُحذف شيء."); return; }
    }
    try { await forgetDevice(); } catch (e) { setError((e as Error).message); return; }
    markActivated(null);
    setRegId(null); setActivated(false); setJwk(null); setKeyLoading(true);
    try { setJwk(await getPublicJwk()); } catch { setKeyError("تعذر إنشاء مفتاح جديد."); } finally { setKeyLoading(false); }
  };

  const step = !regId ? 1 : !activated ? 2 : 3;
  const sessionActive = !isLoading && !!user?.posDevice;

  return (
    <div dir="rtl" className="min-h-[100dvh] bg-muted/40 px-4 py-10" data-testid="page-pos-device">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><MonitorSmartphone className="size-6" /></div>
          <div>
            <h1 className="text-xl font-bold">جهاز نقطة البيع</h1>
            <p className="text-xs text-muted-foreground">سطح عمل الكاشير على جهاز موثوق — لا يمنح أي صلاحية إدارية.</p>
          </div>
        </div>

        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" data-testid="text-proof-kind">
          إثبات برمجي من المتصفح (مفتاح ECDSA غير قابل للتصدير محفوظ في هذا المتصفح). هذا ليس إثبات TPM من ويندوز ولا إثباتاً عتادياً.
        </div>

        {after && <p className="text-sm text-muted-foreground" data-testid="text-pos-device-after">{after === "switch" ? "انتهت جلسة الكاشير السابق. يمكن للكاشير التالي فتح الجهاز." : "تم قفل الجهاز وإنهاء جلسة الكاشير."}</p>}

        {!supported ? (
          <Card><CardContent className="p-6 text-sm text-destructive" data-testid="text-unsupported">هذا المتصفح لا يدعم WebCrypto/IndexedDB، لذلك لا يمكن استخدامه كجهاز نقطة بيع.</CardContent></Card>
        ) : sessionActive ? (
          <Card>
            <CardHeader><CardTitle className="text-base">جلسة كاشير مفتوحة: {user?.name}</CardTitle></CardHeader>
            <CardContent className="flex gap-2">
              <Button onClick={() => setLocation("/my-work")} data-testid="button-open-my-work">متابعة العمل</Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <ol className="flex gap-2 text-xs" data-testid="steps-pos-device">
              {["التسجيل", "التفعيل", "فتح الكاشير"].map((s, i) => (
                <li key={s} className={`flex-1 rounded-md border px-2 py-1.5 text-center ${step === i + 1 ? "border-primary bg-primary/10 font-semibold text-primary" : step > i + 1 ? "text-emerald-700" : "text-muted-foreground"}`}>
                  {step > i + 1 && <Check className="me-1 inline size-3" />}{s}
                </li>
              ))}
            </ol>

            {step === 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><KeyRound className="size-4" />المفتاح العام لهذا المتصفح</CardTitle>
                  <CardDescription>انسخه وأرسله للمسؤول المخوّل ليسجل الجهاز من «إعدادات أجهزة نقاط البيع»، ثم أدخل معرّف التسجيل.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {keyLoading ? <div className="h-16 animate-pulse rounded-md bg-muted" data-testid="skeleton-key" />
                    : keyError ? <p className="text-sm text-destructive" data-testid="text-key-error">{keyError}</p>
                    : <pre dir="ltr" className="max-h-28 overflow-auto rounded-md bg-muted p-2 text-[11px]" data-testid="text-public-jwk">{JSON.stringify(jwk)}</pre>}
                  <Button variant="outline" size="sm" onClick={() => void copyKey()} disabled={!jwk} data-testid="button-copy-public-key">
                    <Copy className="me-1 size-4" />{copied ? "تم النسخ" : "نسخ المفتاح العام"}
                  </Button>
                  <div className="space-y-1.5 pt-2">
                    <Label htmlFor="reg">معرّف تسجيل الجهاز</Label>
                    <div className="flex gap-2">
                      <Input id="reg" dir="ltr" value={regInput} onChange={(e) => setRegInput(e.target.value)} data-testid="input-registration-id" />
                      <Button onClick={saveReg} disabled={!regInput.trim()} data-testid="button-save-registration">حفظ</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {step === 2 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="size-4" />تفعيل الجهاز</CardTitle>
                  <CardDescription>أدخل رمز التفعيل لمرة واحدة الذي أصدره المسؤول (صالح 5 دقائق). لا يُحفظ الرمز.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-xs text-muted-foreground">معرّف التسجيل: <span dir="ltr" className="font-mono" data-testid="text-registration-id">{regId}</span></p>
                  <Input dir="ltr" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="رمز التفعيل" data-testid="input-activation-token" />
                  <Button className="w-full" onClick={() => void activate()} disabled={busy || !token.trim()} data-testid="button-activate-device">{busy ? "جارٍ التفعيل…" : "تفعيل"}</Button>
                </CardContent>
              </Card>
            )}

            {step === 3 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><Lock className="size-4" />فتح الكاشير</CardTitle>
                  <CardDescription>رقم الموظف والرمز السري الخاص بنقطة البيع. ليس كلمة مرور المنصة.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void unlock(); }}>
                    <div className="space-y-1.5">
                      <Label htmlFor="pid">رقم الموظف</Label>
                      <Input id="pid" dir="ltr" inputMode="numeric" value={personId} onChange={(e) => setPersonId(e.target.value.replace(/\D/g, ""))} data-testid="input-person-id" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pin">الرمز السري</Label>
                      <Input id="pin" dir="ltr" type="password" inputMode="numeric" autoComplete="off" maxLength={10} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} data-testid="input-pin" />
                    </div>
                    <Button type="submit" className="w-full" disabled={busy || !personId || !pin} data-testid="button-unlock">{busy ? "جارٍ التحقق…" : "فتح"}</Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {error && <p role="alert" className="flex items-center gap-2 text-sm text-destructive" data-testid="text-pos-device-error"><AlertTriangle className="size-4" />{error}</p>}

        {supported && regId && !sessionActive && (
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => void reset()} data-testid="button-forget-device">إزالة تسجيل هذا المتصفح</button>
        )}
      </div>
    </div>
  );
}
