import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCompanyTaxPolicy,
  usePublishCompanyTaxPolicy,
  useGetCompanyTaxPolicyRequestStatus,
  getGetCompanyTaxPolicyRequestStatusQueryKey,
  useCloseCompanyTaxPolicyRequest,
  getGetCompanyTaxPolicyQueryKey,
  type GetCompanyTaxPolicy200,
  type PublishCompanyTaxPolicyBody,
  type PublishCompanyTaxPolicyBodyStatus,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Clock, History, Lock, Receipt, RefreshCw, ShieldCheck, ShieldQuestion } from "lucide-react";

type Category = "standard" | "zero" | "exempt";
type Rule = { category: Category; reason?: string };
type Frozen = Omit<PublishCompanyTaxPolicyBody, "proof">;
type PendingRecord = { userId: number; companyId: number; frozen: Frozen; savedAt: string; lastError: string };

const STATUS_LABEL: Record<string, { title: string; body: string }> = {
  registered: { title: "مسجّلة إلزاميًا", body: "إقرار المنشأة بأنها مسجّلة لدى الهيئة بحكم الحد الإلزامي." },
  voluntary: { title: "مسجّلة اختياريًا", body: "إقرار بتسجيل اختياري قائم لدى الهيئة." },
  not_registered: { title: "غير مسجّلة", body: "لا تُضاف ضريبة على المستندات الجديدة بعد تاريخ السريان." },
  unresolved: { title: "غير محسومة", body: "لم تُعلن المنشأة حالتها بعد عبر هذه السياسة." },
};
const CATEGORY_LABEL: Record<Category, string> = { standard: "قياسية", zero: "نسبة صفرية", exempt: "معفاة" };
const pendingKey = (userId: number, companyId: number) => `tax-policy-pending:${userId}:${companyId}`;

// Pre-user-scoped marker (`tax-policy-pending:<companyId>`). Its owner cannot be
// established, so it is only detected — never read into the form, adopted or cleared.
function hasLegacyMarker(companyId: number | null): boolean {
  if (!companyId) return false;
  try { return sessionStorage.getItem(`tax-policy-pending:${companyId}`) !== null; } catch { return false; }
}

function readPending(userId: number | null, companyId: number | null): PendingRecord | null {
  if (!userId || !companyId) return null;
  try {
    const raw = sessionStorage.getItem(pendingKey(userId, companyId));
    const rec = raw ? (JSON.parse(raw) as PendingRecord) : null;
    return rec && rec.userId === userId && rec.companyId === companyId ? rec : null;
  } catch { return null; }
}
function writePending(rec: PendingRecord) {
  // Non-secret frozen facts only. Proof fields are never part of `frozen`.
  try { sessionStorage.setItem(pendingKey(rec.userId, rec.companyId), JSON.stringify(rec)); } catch { /* storage unavailable */ }
}
function clearPending(userId: number, companyId: number) { try { sessionStorage.removeItem(pendingKey(userId, companyId)); } catch { /* ignore */ } }

function errorInfo(err: unknown): { status: number | null; message: string } {
  const status = typeof err === "object" && err && "status" in err && typeof (err as { status: unknown }).status === "number" ? (err as { status: number }).status : null;
  const data = typeof err === "object" && err && "data" in err ? (err as { data: unknown }).data : null;
  const serverMsg = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : null;
  return { status, message: serverMsg ?? (err instanceof Error ? err.message : "انقطع الاتصال قبل وصول الرد") };
}

function initialRules(p: GetCompanyTaxPolicy200): Record<number, Rule> {
  const out: Record<number, Rule> = {};
  for (const r of p.current.productRules ?? []) out[r.productId] = { category: r.rule.category, reason: r.rule.reason };
  return out;
}

export function CompanyTaxPolicyPanel({ readOnly }: { readOnly: boolean }) {
  const { user } = useAuth();
  const companyId = user?.companyId ?? null;
  const userId = user?.id ?? null;
  const qc = useQueryClient();
  const q = useGetCompanyTaxPolicy({ query: { queryKey: [...getGetCompanyTaxPolicyQueryKey(),companyId,userId], enabled:!!companyId&&!!userId, retry: false } });
  const publish = usePublishCompanyTaxPolicy();
  const closeReq = useCloseCompanyTaxPolicyRequest();

  const [status, setStatus] = useState<PublishCompanyTaxPolicyBodyStatus | null>(null);
  const [vatNumber, setVatNumber] = useState("");
  const [inclusive, setInclusive] = useState<boolean | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [rules, setRules] = useState<Record<number, Rule>>({});
  const [service, setService] = useState<Rule | null>(null);
  const [reason, setReason] = useState("");
  const [adoptAuthority,setAdoptAuthority]=useState(false);
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [recovery, setRecovery] = useState("");
  const [pending, setPending] = useState<PendingRecord | null>(() => readPending(userId, companyId));
  const [outcome, setOutcome] = useState<{ tone: "ok" | "unknown" | "rejected"; text: string } | null>(null);
  const initFor = useRef<string | null>(null);

  useEffect(() => { setPassword(""); setTotp(""); setRecovery(""); setPending(readPending(userId, companyId)); initFor.current = null; }, [userId, companyId]);

  useEffect(() => {
    const p = q.data; if (!p) return;
    const k = `${p.current.companyId}:${p.revision}`;
    if (initFor.current === k) return;
    initFor.current = k;
    const pend = readPending(userId, p.current.companyId);
    const src = pend?.frozen;
    setStatus(src?.status ?? (p.current.status === "unresolved" ? null : p.current.status));
    setVatNumber(src ? src.vatNumber ?? "" : p.current.vatNumber ?? "");
    setInclusive(src?.priceIncludesVat ?? (p.current.mode === "legacy" && p.current.status === "unresolved" ? null : p.current.priceIncludesVat));
    setEffectiveFrom(src?.effectiveFrom ?? "");
    setRules(src ? Object.fromEntries(src.productRules.map((r) => [r.productId, r.rule])) : initialRules(p));
    setService(src?.serviceRule ?? p.current.serviceRule ?? null);
    setReason(src?.reason ?? "");
    setAdoptAuthority(src?.adoptTaxAdministration===true);
  }, [q.data]);

  const pendingId = pending?.frozen.requestId ?? "";
  const statusQ = useGetCompanyTaxPolicyRequestStatus(pendingId, { query: { enabled: !!pendingId && !!q.data, queryKey: getGetCompanyTaxPolicyRequestStatusQueryKey(pendingId), retry: false } });

  // Only the server's answer for this exact UUID may release the lock.
  async function applyStatus(st: { status: string; revision: number | null }, forId: string) {
    if (!userId || !companyId || readPending(userId, companyId)?.frozen.requestId !== forId) return;
    if (st.status === "saved") {
      clearPending(userId, companyId); setPending(null); initFor.current = null;
      setOutcome({ tone: "ok", text: `أكّد الخادم أن الطلب نُفّذ${st.revision != null ? ` (النسخة ${st.revision})` : ""}. المستندات السابقة لم تتغير.` });
      await qc.invalidateQueries({ queryKey: getGetCompanyTaxPolicyQueryKey() });
    } else if (st.status === "closed") {
      clearPending(userId, companyId); setPending(null); initFor.current = null;
      setOutcome({ tone: "ok", text: "أكّد الخادم إغلاق الطلب دون تنفيذ. يمكنك إعداد نسخة جديدة بمعرّف جديد." });
      await qc.invalidateQueries({ queryKey: getGetCompanyTaxPolicyQueryKey() });
    }
  }
  const applyRef = useRef(applyStatus);
  applyRef.current = applyStatus;
  useEffect(() => { if (statusQ.data && pendingId) void applyRef.current(statusQ.data, pendingId); }, [statusQ.data, pendingId]);

  async function closePending() {
    if (!pending) return;
    const id = pending.frozen.requestId;
    const proof = { currentPassword: password, ...(totp ? { token: totp } : {}), ...(recovery ? { recoveryCode: recovery } : {}) };
    setOutcome(null);
    try {
      const res = await closeReq.mutateAsync({ requestId: id, data: { facts: pending.frozen, proof } });
      if (res.status === "pending") setOutcome({ tone: "unknown", text: "لم يُغلق الطلب بعد وفق الخادم؛ يبقى مقفلًا بنفس المعرّف." });
      await applyStatus(res, id);
    } catch (err) {
      const { status: s, message } = errorInfo(err);
      setOutcome({ tone: s === null || s >= 500 ? "unknown" : "rejected", text: `لم يتأكد الإغلاق (${s ?? "بلا رد"}): ${message}. يبقى الطلب مقفلًا؛ جارٍ الاستعلام عن حالته.` });
      void statusQ.refetch();
    } finally { setPassword(""); setTotp(""); setRecovery(""); }
  }

  const legacyMarker = hasLegacyMarker(companyId);
  const locked = !!pending;
  const canEdit = !readOnly && !!(q.data?.canManage||q.data?.canAdopt) && !locked;
  const products = q.data?.products ?? [];
  const missing = useMemo(() => products.filter((p) => !rules[p.id]).length, [products, rules]);
  const needsReason = (r: Rule | null | undefined) => !!r && r.category !== "standard" && !(r.reason ?? "").trim();
  const reasonGaps = products.filter((p) => needsReason(rules[p.id])).length + (needsReason(service) ? 1 : 0);
  const vatRequired = status === "registered" || status === "voluntary";
  const vatValid = !vatRequired || /^3\d{13}3$/.test(vatNumber.trim());

  const blockers: string[] = [];
  if(q.data?.canAdopt&&!q.data.canManage&&!adoptAuthority)
    blockers.push("تهيئة المسؤولية الضريبية الأولى تحتاج موافقة صريحة وتأكيد الحساب.");
  if (!status) blockers.push("اختر حالة التسجيل المُعلنة.");
  if (!vatValid) blockers.push("الرقم الضريبي 15 رقمًا يبدأ وينتهي بالرقم 3.");
  if (inclusive === null) blockers.push("حدّد هل الأسعار المدخلة شاملة أم غير شاملة للضريبة.");
  if (!effectiveFrom) blockers.push("حدّد تاريخ سريان السياسة.");
  if (!service) blockers.push("صنّف الخدمات (قياسية/صفرية/معفاة).");
  if (missing) blockers.push(`${missing} منتج بلا تصنيف ضريبي صريح.`);
  if (reasonGaps) blockers.push(`${reasonGaps} تصنيف صفري/معفى بلا سبب.`);
  if (reason.trim().length < 6) blockers.push("اكتب سبب التغيير (6 أحرف على الأقل).");

  async function send(frozen: Frozen) {
    if (!companyId || !userId) return;
    setOutcome(null);
    const rec: PendingRecord = { userId, companyId, frozen, savedAt: new Date().toISOString(), lastError: "" };
    writePending(rec); setPending(rec);
    const proof = { currentPassword: password, ...(totp ? { token: totp } : {}), ...(recovery ? { recoveryCode: recovery } : {}) };
    try {
      const res = await publish.mutateAsync({ data: { ...frozen, proof } });
      clearPending(userId, companyId); setPending(null);
      setOutcome({ tone: "ok", text: `أكّد الخادم النسخة ${res.revision}${res.replayed ? " (طلب سابق بنفس المعرّف)" : ""}. المستندات السابقة لم تتغير.` });
      initFor.current = null;
      await qc.invalidateQueries({ queryKey: getGetCompanyTaxPolicyQueryKey() });
    } catch (err) {
      const { status: s, message } = errorInfo(err);
      const unknown = s === null || s >= 500 || s === 408;
      const next = { ...rec, lastError: `${s ?? "بلا رد"} — ${message}` };
      writePending(next); setPending(next);
      if (s === 503) {
        setOutcome({ tone: "unknown", text: "خدمة السياسة الضريبية غير جاهزة على الخادم (503). يبقى الطلب مقفلًا بنفس المعرّف حتى يؤكد الخادم حالته." });
        void statusQ.refetch();
        return;
      }
      if (unknown) void statusQ.refetch();
      setOutcome(unknown
        ? { tone: "unknown", text: "النتيجة غير معروفة: قد يكون الخادم استلم الطلب. أعد المحاولة بنفس المعرّف والبيانات؛ لن يُنشر مرتين." }
        : { tone: "rejected", text: `رفض الخادم الطلب (${s}): ${message}. المعرّف يبقى محجوزًا حتى يؤكد الخادم أنه أُغلق بلا أثر؛ يمكنك إعادة المحاولة بنفس البيانات.` });
    } finally { setPassword(""); setTotp(""); setRecovery(""); }
  }

  function submitNew() {
    if (legacyMarker || !q.data?.publishingReady || blockers.length || !status || inclusive === null || !service) return;
    const frozen: Frozen = {
      ...(adoptAuthority?{adoptTaxAdministration:true}:{}),
      revision: q.data.revision, requestId: crypto.randomUUID(), effectiveFrom, status,
      vatNumber: vatRequired ? vatNumber.trim() : null, priceIncludesVat: inclusive,
      productRules: products.map((p) => ({ productId: p.id, rule: rules[p.id]!.category === "standard" ? { category: "standard" } : { category: rules[p.id]!.category, reason: rules[p.id]!.reason?.trim() } })),
      serviceRule: service.category === "standard" ? { category: "standard" } : { category: service.category, reason: service.reason?.trim() },
      reason: reason.trim(),
    };
    void send(frozen);
  }

  if (q.isLoading) return <Card><CardContent className="space-y-3 p-6">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</CardContent></Card>;
  if (q.isError || !q.data) return (
    <Card data-testid="tax-policy-error"><CardContent className="space-y-3 p-6">
      <p role="alert" className="text-sm">تعذر تحميل السياسة الضريبية الموثوقة. لا تُعرض قيم افتراضية بدلًا منها.</p>
      <Button variant="outline" onClick={() => void q.refetch()} data-testid="button-retry-tax-policy"><RefreshCw className="me-2 size-4" /> إعادة التحميل</Button>
    </CardContent></Card>
  );

  const p = q.data;
  const cur = p.current;
  const radio = (on: boolean) => cn("rounded-xl border p-3 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-60", on ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "hover:border-primary/40");

  return (
    <div className="space-y-4" data-testid="company-tax-policy">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Receipt className="size-5 text-primary" /> السياسة الضريبية للمنشأة</CardTitle>
          <CardDescription>مصدر واحد موثوق لحالة التسجيل وطريقة التسعير وتصنيف الأصناف. كل تغيير يُنشر كنسخة مؤرخة ولا يمس المستندات الصادرة سابقًا.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4" data-testid="tax-policy-current">
            <Fact label="الحالة المعلنة" value={STATUS_LABEL[cur.status]?.title ?? cur.status} testId="text-tax-status" />
            <Fact label="الرقم الضريبي" value={cur.vatNumber ?? "—"} ltr testId="text-tax-vat" />
            <Fact label="الأسعار" value={cur.status === "unresolved" ? "غير محسوم" : cur.priceIncludesVat ? "شاملة الضريبة" : "غير شاملة"} testId="text-tax-inclusive" />
            <Fact label="النسخة / السريان" value={`${p.revision} — ${cur.effectiveFrom ?? "لم تُنشر"}`} testId="text-tax-revision" />
          </div>
          {cur.mode === "legacy" && (
            <Notice tone="amber" icon={<History className="size-4" />} testId="notice-tax-legacy" title="المنشأة تعمل بالإعداد القديم">
              لم يُنقل أي شيء تلقائيًا. {p.transition.legacyUnchanged ? "الإعداد القديم باقٍ كما هو" : "أبلغ الخادم بتغيّر في الإعداد القديم"}، {p.transition.historicalDocumentsUnchanged ? "والمستندات التاريخية دون تغيير." : "وأبلغ الخادم بأثر على مستندات تاريخية."} تبدأ السياسة الموحدة فقط بعد نشر صريح منك بتاريخ سريان.
            </Notice>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <Notice tone={p.integration.registrationVerified ? "green" : "slate"} icon={p.integration.registrationVerified ? <ShieldCheck className="size-4" /> : <ShieldQuestion className="size-4" />} testId="notice-tax-registry" title={p.integration.registrationVerified ? "تحقق السجل: مؤكَّد من الخادم" : "تحقق السجل: غير مؤكَّد"}>
              الحالة أعلاه إقرار من المنشأة. حالة التحقق من السجل: <span dir="ltr" className="font-mono">{cur.registrationVerification}</span>
            </Notice>
            <Notice tone={p.integration.productionAcceptance ? "green" : "slate"} icon={<Lock className="size-4" />} testId="notice-tax-phase2" title={p.integration.productionAcceptance ? "اعتماد بيئة الإنتاج: مؤكَّد" : "المرحلة الثانية: لا اعتماد إنتاج"}>
              جاهزية البرنامج لا تعني اعتماد بيئة الاختبار أو الإنتاج لدى الهيئة. {p.integration.explanation}
            </Notice>
          </div>
        </CardContent>
      </Card>
      {!p.publishingReady&&<Notice tone="slate" icon={<Lock className="size-4" />} testId="notice-tax-not-ready" title="المراجعة متاحة؛ تفعيل السياسة محجوب">
        لم تكتمل بعد مطابقة السلة والفواتير والمرتجعات والتقارير. يمكنك مراجعة المسودة، لكن النشر محجوب في الواجهة والخادم دون تغيير حالة المنشأة.
      </Notice>}

      {legacyMarker && (
        <Card className="border-destructive/60" data-testid="panel-tax-legacy-pending">
          <CardContent className="space-y-1.5 p-4 text-sm">
            <p className="flex items-center gap-2 font-bold text-destructive"><AlertTriangle className="size-4" /> يوجد طلب نشر سابق مجهول المالك على هذا المتصفح</p>
            <p className="text-muted-foreground">سُجّل هذا الطلب بصيغة قديمة لا تحدد المستخدم، فلا يمكن التحقق من صاحبه أو من نتيجته، وقد يكون الخادم استلمه. لذلك لا تُعرض بياناته، ويُمنع إنشاء طلب سياسة ضريبية جديد من هذا المتصفح حتى يُحسم وضعه.</p>
            <p className="text-muted-foreground">تواصل مع مسؤول النظام للتحقق من سجل نسخ السياسة الضريبية في الخادم. لا يُحذف هذا المؤشر تلقائيًا.</p>
          </CardContent>
        </Card>
      )}

      {pending && (
        <Card className="border-amber-400" data-testid="panel-tax-pending">
          <CardContent className="space-y-2 p-4 text-sm">
            <p className="flex items-center gap-2 font-bold"><Clock className="size-4 text-amber-600" /> طلب نشر بانتظار التأكيد</p>
            <p>معرّف الطلب: <code dir="ltr" className="text-xs" data-testid="text-tax-request-id">{pending.frozen.requestId}</code> — على النسخة {pending.frozen.revision}، سريان {pending.frozen.effectiveFrom}.</p>
            <p className="text-muted-foreground">لا يمكن التخلي عن هذا الطلب من المتصفح: قد يصل طلب متأخر وينشر لاحقًا. يُفك القفل فقط عند تأكيد الخادم أن هذا المعرّف نُفّذ أو أُغلق بلا تنفيذ. للإغلاق أدخل إثبات الحساب ثم «إغلاق الطلب دون تنفيذ».</p>
            <p className="text-muted-foreground">النموذج مقفل على البيانات المجمّدة نفسها. أعد إدخال إثبات الحساب ثم أعد المحاولة؛ لا يُحفظ الإثبات على الجهاز.</p>
            <p className="text-xs" data-testid="text-tax-request-server-status">حالة الخادم لهذا المعرّف: {statusQ.isFetching ? "جارٍ الاستعلام…" : statusQ.isError ? "تعذر الاستعلام — يبقى مقفلًا" : statusQ.data?.status === "pending" ? "قيد الانتظار" : statusQ.data ? statusQ.data.status : "غير معروفة"}</p>
            {pending.lastError && <p className="text-xs text-muted-foreground" data-testid="text-tax-last-error">آخر رد: {pending.lastError}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">1. حالة التسجيل المُعلنة</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div role="radiogroup" className="grid gap-2 md:grid-cols-3">
            {(["registered", "voluntary", "not_registered"] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={status === k} disabled={!canEdit} onClick={() => {setStatus(k);if(k==="not_registered")setInclusive(false);}} className={radio(status === k)} data-testid={`radio-tax-status-${k}`}>
                <p className="text-sm font-bold">{STATUS_LABEL[k]!.title}</p><p className="text-xs text-muted-foreground">{STATUS_LABEL[k]!.body}</p>
              </button>
            ))}
          </div>
          {vatRequired && (
            <div className="max-w-sm">
              <Label htmlFor="tax-vat-number">الرقم الضريبي المُعلن</Label>
              <Input id="tax-vat-number" dir="ltr" inputMode="numeric" maxLength={15} value={vatNumber} disabled={!canEdit} onChange={(e) => setVatNumber(e.target.value.replace(/\D/g, ""))} placeholder="3XXXXXXXXXXXXX3" data-testid="input-tax-vat-number" />
              <p className="mt-1 text-[11px] text-muted-foreground">فحص الشكل فقط؛ لا يُعد تحققًا من السجل.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">2. طريقة التسعير وتاريخ السريان</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {([[true, "الأسعار شاملة الضريبة", "السعر المدخل يتضمن الضريبة."], [false, "الأسعار غير شاملة", "تُضاف الضريبة فوق السعر المدخل."]] as const).map(([v, t, b]) => (
            <button key={String(v)} type="button" role="radio" aria-checked={inclusive === v} disabled={!canEdit || status==="not_registered"&&v} onClick={() => setInclusive(v)} className={radio(inclusive === v)} data-testid={`radio-tax-inclusive-${v}`}>
              <p className="text-sm font-bold">{t}</p><p className="text-xs text-muted-foreground">{b}</p>
            </button>
          ))}
          <div>
            <Label htmlFor="tax-effective-from">يسري من</Label>
            <Input id="tax-effective-from" type="date" dir="ltr" value={effectiveFrom} disabled={!canEdit} onChange={(e) => setEffectiveFrom(e.target.value)} data-testid="input-tax-effective-from" />
            <p className="mt-1 text-[11px] text-muted-foreground">يقبل الخادم أو يرفض التاريخ وفق قواعده.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">3. تصنيف الأصناف
            <Badge variant="outline" className={missing ? "border-amber-400 text-amber-700" : "border-emerald-400 text-emerald-700"} data-testid="badge-tax-completeness">{products.length - missing}/{products.length} مصنّف</Badge>
          </CardTitle>
          <CardDescription>تصنيف صريح لكل منتج. الصفري والمعفى يحتاجان سببًا. الخادم أبلغ عن {p.transition.missingClassifications} منتج غير مصنّف في النسخة المحفوظة.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <RuleRow name="الخدمات (قاعدة عامة)" rule={service} disabled={!canEdit} onChange={setService} testId="service" />
          {products.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground" data-testid="state-tax-no-products">لا منتجات في المنشأة بعد.</p>}
          <div className="max-h-[420px] space-y-2 overflow-y-auto">
            {products.map((pr) => (
              <RuleRow key={pr.id} name={pr.name} sub={`السعر المسجّل: ${pr.price}`} rule={rules[pr.id] ?? null} disabled={!canEdit} onChange={(r) => setRules((o) => ({ ...o, [pr.id]: r }))} testId={`product-${pr.id}`} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">4. المراجعة والنشر</CardTitle>
          <CardDescription>الأثر المعروض هنا مصدره الخادم فقط؛ لا تُحسب مبالغ ضريبية تقديرية في المتصفح.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <ul className="grid gap-1 text-sm" data-testid="list-tax-impact">
            <li>المستندات التاريخية: {p.transition.historicalDocumentsUnchanged ? "لن تتغير (تأكيد الخادم)" : "أبلغ الخادم بأثر محتمل — راجع قبل النشر"}</li>
            <li>الإعداد القديم: {p.transition.legacyUnchanged ? "باقٍ دون تعديل حتى تاريخ السريان" : "متغير وفق الخادم"}</li>
            <li>أصناف بلا تصنيف في النسخة المحفوظة: {p.transition.missingClassifications}</li>
          </ul>
          {(!p.canManage&&!p.canAdopt) || readOnly ? (
            <Notice tone="slate" icon={<Lock className="size-4" />} testId="notice-tax-readonly" title="عرض للقراءة فقط">نشر السياسة يتطلب مسؤولية «الإعداد الضريبي» الممنوحة صراحة من مدير النظام. إذا سُحبت المسؤولية يرفض الخادم أي محاولة.</Notice>
          ) : (
            <>
              {p.canAdopt&&!p.canManage&&<label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={adoptAuthority} disabled={locked} onChange={e=>setAdoptAuthority(e.target.checked)} data-testid="checkbox-tax-adopt-authority"/>
                أطلب تهيئة مسؤولية الضريبة الأولى لحسابي عند نشر أول سياسة فقط، باستخدام صلاحياتي الحالية لإدارة الإعدادات والمديرين وتأكيد هويتي. لا يمنحني المسمى الوظيفي هذه المسؤولية تلقائيًا.
              </label>}
              {!locked && <div><Label htmlFor="tax-change-reason">سبب التغيير (يُسجَّل في التدقيق)</Label>
                <Textarea id="tax-change-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-tax-reason" /></div>}
              <div className="grid gap-3 md:grid-cols-3">
                <div><Label htmlFor="tax-proof-password">كلمة مرور حسابك</Label>
                  <Input id="tax-proof-password" type="password" autoComplete="current-password" value={password} disabled={publish.isPending} onChange={(e) => setPassword(e.target.value)} data-testid="input-tax-proof-password" /></div>
                <div><Label htmlFor="tax-proof-token">رمز تطبيق المصادقة إن كان مفعّلًا</Label>
                  <Input id="tax-proof-token" type="password" inputMode="numeric" autoComplete="one-time-code" value={totp} disabled={publish.isPending} onChange={(e) => setTotp(e.target.value)} data-testid="input-tax-proof-token" /></div>
                <div><Label htmlFor="tax-proof-recovery">أو رمز استعادة</Label>
                  <Input id="tax-proof-recovery" type="password" autoComplete="off" value={recovery} disabled={publish.isPending} onChange={(e) => setRecovery(e.target.value)} data-testid="input-tax-proof-recovery" /></div>
              </div>
              {!locked && blockers.length > 0 && (
                <ul className="space-y-1 rounded-lg bg-muted p-3 text-xs" data-testid="list-tax-blockers">{blockers.map((b) => <li key={b} className="flex items-center gap-1.5"><AlertTriangle className="size-3 text-amber-600" /> {b}</li>)}</ul>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                {locked ? <>
                  <Button variant="outline" onClick={() => void statusQ.refetch()} disabled={statusQ.isFetching} data-testid="button-tax-check-request">التحقق من حالة الطلب</Button>
                  <Button variant="ghost" onClick={() => void closePending()} disabled={closeReq.isPending || publish.isPending || !password} title="يغلق هذا المعرّف تحديدًا بعد تأكيد الهوية" data-testid="button-tax-close-request">{closeReq.isPending ? "جارٍ الإغلاق…" : "إغلاق الطلب دون تنفيذ"}</Button>
                  <Button onClick={() => pending && void send(pending.frozen)} disabled={publish.isPending || closeReq.isPending || !password} data-testid="button-tax-retry">
                    <RefreshCw className={cn("me-2 size-4", publish.isPending && "animate-spin")} /> إعادة المحاولة بنفس الطلب</Button>
                </> : (
                  <Button onClick={submitNew} disabled={!p.publishingReady || legacyMarker || publish.isPending || !password || blockers.length > 0} data-testid="button-tax-publish">
                    <ShieldCheck className="me-2 size-4" /> {publish.isPending ? "جارٍ التأكيد…" : "تأكيد الهوية ونشر نسخة جديدة"}</Button>
                )}
              </div>
            </>
          )}
          {outcome && (
            <p role="status" data-testid="status-tax-outcome" className={cn("flex items-start gap-2 rounded-lg p-3 text-sm", outcome.tone === "ok" ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100" : outcome.tone === "unknown" ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" : "bg-destructive/10 text-destructive")}>
              {outcome.tone === "ok" ? <CheckCircle2 className="mt-0.5 size-4" /> : <AlertTriangle className="mt-0.5 size-4" />} {outcome.text}</p>
          )}
        </CardContent>
      </Card>

      {p.history.length > 0 && (
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><History className="size-4" /> سجل النسخ</CardTitle></CardHeader>
          <CardContent className="space-y-1.5" data-testid="list-tax-history">
            {p.history.slice(0, 10).map((h, i) => (
              <div key={i} className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-xs" data-testid={`row-tax-history-${i}`}>
                {Object.entries(h).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v)).slice(0, 6).map(([k, v]) => <span key={k}><span className="text-muted-foreground">{k}: </span>{String(v)}</span>)}
              </div>
            ))}
          </CardContent></Card>
      )}
    </div>
  );
}

function RuleRow({ name, sub, rule, disabled, onChange, testId }: { name: string; sub?: string; rule: Rule | null; disabled: boolean; onChange: (r: Rule) => void; testId: string }) {
  return (
    <div className={cn("rounded-lg border p-2.5", !rule && "border-amber-300 bg-amber-50/40 dark:bg-amber-950/20")} data-testid={`row-tax-rule-${testId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-medium">{name}</p>{sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}</div>
        <div className="flex gap-1">
          {(["standard", "zero", "exempt"] as const).map((c) => (
            <button key={c} type="button" disabled={disabled} onClick={() => onChange({ category: c, reason: c === "standard" ? undefined : rule?.reason })} data-testid={`button-tax-${testId}-${c}`}
              className={cn("rounded-md border px-2.5 py-1 text-xs disabled:opacity-60", rule?.category === c ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary/50")}>{CATEGORY_LABEL[c]}</button>
          ))}
        </div>
      </div>
      {rule && rule.category !== "standard" && (
        <Input className="mt-2 h-8 text-xs" maxLength={250} placeholder="سبب التصنيف (مثال: تصدير خارج المملكة)" value={rule.reason ?? ""} disabled={disabled} onChange={(e) => onChange({ ...rule, reason: e.target.value })} data-testid={`input-tax-${testId}-reason`} />
      )}
    </div>
  );
}

function Fact({ label, value, ltr, testId }: { label: string; value: string; ltr?: boolean; testId: string }) {
  return <div className="rounded-lg border bg-muted/30 p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p dir={ltr ? "ltr" : undefined} className="mt-0.5 text-sm font-bold" data-testid={testId}>{value}</p></div>;
}

function Notice({ tone, icon, title, children, testId }: { tone: "amber" | "green" | "slate"; icon: React.ReactNode; title: string; children: React.ReactNode; testId: string }) {
  const c = tone === "amber" ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" : tone === "green" ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100" : "border-slate-300 bg-slate-50 text-slate-800 dark:bg-slate-900 dark:text-slate-200";
  return <div className={cn("rounded-xl border p-3 text-sm", c)} data-testid={testId}><p className="flex items-center gap-1.5 font-bold">{icon} {title}</p><div className="mt-1 text-xs leading-relaxed">{children}</div></div>;
}
