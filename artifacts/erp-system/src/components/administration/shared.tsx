import { type AdministrationHandover, type AdministrationHandoverInputResponsibilitiesItem } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

export const RIGHT_LABEL: Record<string, string> = {
  users: "المستخدمون",
  administrators: "مديرو النظام",
  settings: "الإعدادات",
  subscription: "الاشتراك",
  contact: "التواصل مع حاسبة",
};
export const RIGHTS = Object.keys(RIGHT_LABEL) as AdministrationHandoverInputResponsibilitiesItem[];

export const DEPARTURE_LABEL: Record<string, { title: string; body: string; destructive: boolean }> = {
  retain: { title: "إضافة مدير دون مغادرة", body: "يُعيَّن المدير الإضافي وتبقى أنت مديرًا بمسؤولياتك الحالية.", destructive: false },
  stay: { title: "البقاء بوظيفة أخرى", body: "تفقد مسؤوليات الإدارة وتصبح عضوًا محدد المسؤوليات؛ تُحفظ فقط مسؤولياتك الوظيفية السابقة ولا تُمنح صلاحيات مالية. تُبطل جلسات المنشأة الحالية.", destructive: true },
  suspend: { title: "تعليق الوصول", body: "يُعلَّق وصولك إلى هذه المنشأة وتُبطل جلساتها ووسائل دخولها.", destructive: true },
  terminate: { title: "إنهاء العضوية", body: "تنتهي عضويتك في هذه المنشأة وتُبطل جلساتها وتفويضاتها. يبقى التاريخ وعضوياتك في المنشآت الأخرى.", destructive: true },
};

export const STATE_LABEL: Record<string, { label: string; tone: string }> = {
  draft: { label: "مسودة", tone: "border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-900 dark:text-slate-300" },
  proposed: { label: "بانتظار قبول البديل", tone: "border-sky-300 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200" },
  pending: { label: "بانتظار قبول البديل", tone: "border-sky-300 bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200" },
  accepted: { label: "قَبِل البديل — بانتظار تنفيذ المرسل", tone: "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" },
  completed: { label: "نُفِّذ", tone: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" },
  cancelled: { label: "ملغى", tone: "border-slate-300 bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-400" },
};
export const stateMeta = (s: string) => STATE_LABEL[s] ?? { label: s, tone: STATE_LABEL.draft.tone };

/* ---------- finalize evidence (user/company scoped, survives departure) ---------- */
export type FinalizeEvidence = { id: string; revision: number; departure: string; at: string; companyId: number | null };
export const EVIDENCE_PREFIX = "hasiba.admin.finalize";
export const evidenceKey = (userId: number, companyId: number | null | undefined, id: string) => `${EVIDENCE_PREFIX}:${userId}:${companyId ?? "none"}:${id}`;
export function writeEvidence(userId: number, ev: FinalizeEvidence) {
  localStorage.setItem(evidenceKey(userId, ev.companyId, ev.id), JSON.stringify(ev));
}
export function readAllEvidence(userId: number): FinalizeEvidence[] {
  const out: FinalizeEvidence[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(`${EVIDENCE_PREFIX}:${userId}:`)) continue;
    try {
      const v = JSON.parse(localStorage.getItem(k) ?? "");
      if (v && typeof v.id === "string" && typeof v.revision === "number") out.push(v);
    } catch { /* keep unreadable evidence untouched */ }
  }
  return out;
}
export function clearEvidence(userId: number, ev: FinalizeEvidence) {
  localStorage.removeItem(evidenceKey(userId, ev.companyId, ev.id));
}

export function StatePill({ state, testId }: { state: string; testId?: string }) {
  const m = stateMeta(state);
  return <span data-testid={testId} className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium", m.tone)}>{m.label}</span>;
}
export function RightChips({ list, testId }: { list: string[]; testId?: string }) {
  if (!list.length) return <span className="text-xs text-muted-foreground" data-testid={testId}>لا مسؤوليات إدارية</span>;
  return (
    <span className="flex flex-wrap gap-1" data-testid={testId}>
      {list.map((r) => <span key={r} className="rounded-md border border-primary/30 bg-primary/5 px-1.5 py-0.5 text-[11px] text-primary">{RIGHT_LABEL[r] ?? r}</span>)}
    </span>
  );
}
export function Panel({ title, icon: Icon, count, testId, children }: { title: string; icon: React.ComponentType<{ className?: string }>; count: number; testId: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card" data-testid={testId}>
      <h2 className="flex items-center gap-2 border-b p-4 font-bold"><Icon className="size-4 text-primary" /> {title} <span className="text-sm font-normal text-muted-foreground">({count})</span></h2>
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}
export function Empty({ text, testId }: { text: string; testId: string }) {
  return <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid={testId}>{text}</p>;
}

export function HandoverDetails({ h }: { h: AdministrationHandover }) {
  const dep = DEPARTURE_LABEL[h.departure];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
      <dt className="text-muted-foreground">من</dt><dd data-testid={`text-from-${h.id}`}>{h.from_name ?? `#${h.from_user_id}`}</dd>
      <dt className="text-muted-foreground">إلى</dt><dd data-testid={`text-to-${h.id}`}>{h.to_name ?? h.invited_name ?? "—"}{!h.to_user_id && h.invited_name && <span className="ms-1 text-xs text-amber-700 dark:text-amber-300">(دعوة لم تُفعّل بعد)</span>}</dd>
      <dt className="text-muted-foreground">المسؤوليات</dt><dd><RightChips list={h.responsibilities} testId={`list-resp-${h.id}`} /></dd>
      <dt className="text-muted-foreground">المرسل بعدها</dt>
      <dd data-testid={`text-departure-${h.id}`}><span className={cn("font-medium", dep?.destructive && "text-destructive")}>{dep?.title ?? h.departure}</span>{dep && <p className="text-xs text-muted-foreground">{dep.body}</p>}</dd>
      <dt className="text-muted-foreground">المراجعة</dt><dd className="tabular-nums" data-testid={`text-revision-${h.id}`}>{h.revision}</dd>
    </dl>
  );
}

