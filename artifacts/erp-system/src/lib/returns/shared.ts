/** Safe readers, labels, error parsing and CSV helpers for the returns desk. */
export type Rec = Record<string, unknown>;

export const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
export const arr = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : []);
export const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : d);
export const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
export const money = (v: unknown) => {
  const n = num(v);
  return n === null ? "—" : `${n.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
};
export const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
export const numArr = (v: unknown): number[] => (Array.isArray(v) ? v.map(num).filter((x): x is number => x !== null) : []);

export const CAPS: Record<string, string> = {
  view: "عرض", request: "طلب إرجاع", approve: "اعتماد", payout: "صرف", external: "توثيق رد خارجي",
  close: "إغلاق وردية", difference: "اعتماد فروقات", reports: "تقارير", export: "تصدير", sell: "بيع",
  configure: "إعداد الصلاحيات", expense: "مصروف نقدي",
};
export const METHODS: Record<string, string> = {
  credit: "رصيد دائن للعميل", cash: "نقدًا من الدرج", card: "عكس على البطاقة (طلب يدوي)",
  transfer: "تحويل بنكي (طلب يدوي)", stc: "STC Pay (طلب يدوي)",
};
export const DISPOSITIONS: Record<string, string> = {
  no_goods: "بدون استلام بضاعة", discard: "إتلاف البضاعة", resale: "إعادة للمخزون للبيع",
};
export const label = (map: Record<string, string>, k: string) => map[k] ?? (k || "غير معروف");

/** Review and physical receipt are not financial issuance. Never offer payout
 * or an issued-document print merely because the review was approved. */
export function returnNoteState(n: Rec) {
  const status = str(n.status);
  const financialPending = status.toLowerCase().includes("pending");
  const approved = n.review_status === "approved";
  const awaitingReceipt = financialPending && approved && n.receipt_required === true && n.received_by == null;
  return {
    financialPending,
    awaitingApproval: financialPending && !approved,
    awaitingReceipt,
    status: awaitingReceipt ? "pending_receipt" : financialPending && approved ? "pending_issue" : status,
  };
}

const AMBER = "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
const ROSE = "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-200";
const GREEN = "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";
const SKY = "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200";
const VIOLET = "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200";
const SLATE = "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200";

const EXACT: Record<string, { text: string; cls: string }> = {
  pending_receipt: { text: "معتمد — بانتظار الاستلام", cls: AMBER },
  pending_issue: { text: "معتمد — بانتظار الترحيل", cls: AMBER },
  partially_paid: { text: "مدفوع جزئيًا", cls: AMBER },
  partially_refunded: { text: "مسترد جزئيًا", cls: AMBER },
  requested: { text: "مطلوب — لم يُرسل لأي مزود", cls: VIOLET },
  external_confirmed: { text: "توثيق رد خارجي (يدوي)", cls: SKY },
  cancelled: { text: "ملغى", cls: ROSE },
  open: { text: "مفتوحة", cls: SLATE },
  closed: { text: "مغلقة", cls: SLATE },
};

export function statusTone(s: string): { text: string; cls: string } {
  const k = s.toLowerCase();
  if (EXACT[k]) return EXACT[k];
  if (k.includes("pending") || k.includes("await")) return { text: "بانتظار الاعتماد", cls: AMBER };
  if (k.includes("reject")) return { text: "مرفوض", cls: ROSE };
  if (k.includes("cancel")) return { text: "ملغى", cls: ROSE };
  if (k.includes("refund") || k.includes("paid") || k.includes("settled") || k.includes("delivered")) return { text: "مسدد", cls: GREEN };
  if (k.includes("approv")) return { text: "معتمد — مستحق الصرف", cls: SKY };
  if (k.includes("request")) return EXACT.requested;
  if (k.includes("regist") || k.includes("draft")) return { text: "مسجّل", cls: SLATE };
  return { text: s || "غير معروف", cls: "bg-muted text-muted-foreground" };
}

export type ErrInfo = { status: number | null; message: string; diagnosticRef: string };
export function readErr(e: unknown): ErrInfo {
  const o = rec(e);
  const status = num(o.status);
  const data = rec(o.data);
  const diag = str(data.diagnosticRef) || str(data.diagnostic_ref) || str(rec(data.error).diagnosticRef);
  const msg = str(data.message) || str(data.error) || (e instanceof Error ? e.message : "") || "تعذّر إكمال الطلب";
  return { status, message: msg.slice(0, 400), diagnosticRef: diag.replace(/[^\w\-:.]/g, "").slice(0, 120) };
}
/** 4xx = server definitively rejected; anything else (5xx/transport) is unknown. */
export const isDefinitive = (e: ErrInfo) => e.status !== null && e.status >= 400 && e.status < 500;

export function csvCell(v: unknown): string {
  let s = str(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export const field =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";
