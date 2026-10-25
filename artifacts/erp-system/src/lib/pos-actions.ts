/**
 * Arabic, cashier-readable labels for responsibility action keys.
 * The server catalogue remains the source of truth for availability;
 * these labels only make keys understandable wherever they are rendered
 * (including unavailable catalogue items and legacy previews).
 */
export const ACTION_LABEL: Record<string, string> = {
  "procurement.invoices.read":"عرض فواتير الموردين وتفاصيلها ومرفقاتها ضمن النطاق",
  "procurement.invoices.compare":"معاينة مطابقة فاتورة المورد دون قرار مراجعة أو اعتماد أو ترحيل",
  "procurement.invoices.print":"طباعة فاتورة المورد",
  "procurement.invoices.export":"تنزيل ملف فاتورة المورد",
  "procurement.read":"تفعيل مساحة الموردين وأوامر الشراء",
  "procurement.suppliers.read":"عرض دليل الموردين بلا صلاحيات مالية ضمنية",
  "procurement.suppliers.create":"إنشاء مورد",
  "procurement.suppliers.edit":"تعديل بيانات مورد",
  "procurement.suppliers.export":"تصدير دليل الموردين",
  "procurement.orders.read":"عرض أوامر الشراء ضمن النطاق",
  "procurement.orders.create":"إنشاء أمر شراء",
  "procurement.orders.confirm":"تقديم أو تأكيد أمر شراء",
  "procurement.orders.approve":"مراجعة واعتماد أمر أنشأه شخص آخر",
  "procurement.orders.cancel":"إلغاء أمر شراء",
  "procurement.orders.close":"إغلاق أمر مستلم بالكامل دون تنفيذ الاستلام",
  "procurement.orders.print":"طباعة أمر شراء",
  "procurement.orders.export":"تنزيل أمر شراء",
  "procurement.orders.send":"إرسال أمر شراء ومراجعة صندوق إرساله",
  "procurement.receipts.read":"عرض كميات استلام المشتريات دون أسعار",
  "procurement.receipts.receive":"تسجيل استلام جزئي أو كامل — دون صرف أو اعتماد أو عكس",
  "procurement.receipts.receive_self":"استلام أمر أنشأته بنفسي — بسياسة منشأة مفعلة وإذن استلام مستقل",
  "inventory.read": "عرض المخزون",
  "inventory.cost.read": "عرض تكلفة الأصناف",
  "inventory.transfer.receive": "استلام كامل حركة تحويل إلى مستودع الوجهة",
  "inventory.stocktake.count": "عدّ جرد قائم في مستودع المسؤولية — دون اعتماد الفروق",
  "pos.read": "فتح نقطة البيع (عرض)",
  "pos.sell": "البيع وتحصيل النقد",
  "pos.shift.open": "فتح وردية",
  "pos.shift.close": "عد وإقفال ورديات الفرع المحدد، ولو فتحها زميل",
  "pos.shift.difference": "اعتماد فرق درج لوردية زميل",
  "pos.shift.responsibility": "قرار مسؤولية فرق درج دون خصم تلقائي",
  "pos.payment.record": "تسجيل دفع يدوي غير نقدي أو آجل (دون بوابة)",
  "pos.discount": "منح خصم ضمن السياسة المالية القائمة",
  "pos.discount.request": "طلب استثناء خصم بموافقة مستقلة للعملية",
  "pos.return.request": "طلب إرجاع (يحتاج اعتمادًا)",
  "pos.return.approve": "اعتماد مرتجع شخص آخر ضمن الفرع والمستودع وحد المبلغ",
  "pos.return.direct": "إرجاع مباشر إن سمحت سياسة الفرع",
  "pos.return.receive": "استلام المرتجع فعليًا وإعادته للمخزون",
  "pos.return.payout": "صرف رد نقدي أو طلب رد يدوي",
  "pos.return.external": "تأكيد إثبات رد خارجي",
};

export function canReachProcurement(sel:{resource:string;actions:readonly string[]}|null|undefined,path:string):boolean{
  if(sel?.resource!=="procurement"||!sel.actions.includes("procurement.read"))return false;
  return path==="/suppliers"?sel.actions.includes("procurement.suppliers.read"):
    path==="/invoices"?sel.actions.includes("procurement.invoices.read"):
    path==="/procurement"&&(sel.actions.includes("procurement.orders.read")||sel.actions.includes("procurement.receipts.read"));
}

/** Never invent meaning: unknown keys are shown as unrecognised, with the key kept for support. */
export function actionLabel(key: string, catalogLabel?: string | null): string {
  if (ACTION_LABEL[key]) return ACTION_LABEL[key];
  if (catalogLabel && catalogLabel.trim() && catalogLabel !== key) return catalogLabel;
  return `إجراء غير معروف (${key})`;
}

/** Describe the effective grant, not an obsolete fixed cashier template. */
export function posResponsibilitySummary(actions: readonly string[], denied: readonly string[] = []): string {
  const effective = actions.filter(a => !denied.includes(a));
  const caps = scopedCheckoutCaps(effective);
  return [
    caps.sell ? (caps.recordTender ? "بيع نقدي وتسجيل تحصيل غير نقدي أو آجل يدويًا؛ دون اتصال بشبكة دفع" : "بيع وتحصيل نقدي فقط") : "لا تتضمن هذه المسؤولية تنفيذ بيع",
    caps.discount ? "الخصم متاح ضمن سياسة الشركة وحدودها" : effective.includes("pos.discount.request") ? "طلب استثناء خصم فقط؛ لا ينفذ قبل اعتماد مستقل للعملية" : "الخصم غير ممنوح",
    effective.includes("pos.shift.close") ? "الإقفال يشمل ورديات هذا الفرع المصرح، لا ورديتك وحدها؛ اعتماد الفرق إذن مستقل" : "إقفال الوردية غير ممنوح",
  ].join(". ");
}

export const RETURN_ACTIONS = ["pos.return.request", "pos.return.approve", "pos.return.direct", "pos.return.receive", "pos.return.payout", "pos.return.external"] as const;

export type ReturnMode = "deny" | "approval" | "direct" | "custom";

/**
 * Projection of the explicit return checkboxes. Only request/direct are
 * projected; stock receipt, payout and external proof stay separate checkboxes
 * and are never implied by a mode.
 */
export function returnMode(actions: string[]): ReturnMode {
  const req = actions.includes("pos.return.request");
  const dir = actions.includes("pos.return.direct");
  if (!req && !dir) return "deny";
  if (req && !dir) return "approval";
  if (req && dir) return "direct";
  return "custom";
}

export function applyReturnMode(actions: string[], mode: Exclude<ReturnMode, "custom">): string[] {
  const rest = actions.filter((a) => a !== "pos.return.request" && a !== "pos.return.direct");
  if (mode === "approval") return [...rest, "pos.return.request"];
  if (mode === "direct") return [...rest, "pos.return.request", "pos.return.direct"];
  return rest;
}

export const RETURN_MODE_LABEL: Record<ReturnMode, string> = {
  deny: "ممنوع من إنشاء طلب إرجاع؛ المراجعة والاستلام والصرف أذونات مستقلة",
  approval: "طلب إرجاع بانتظار اعتماد",
  direct: "إرجاع مباشر إن سمحت السياسة (وإلا يتحول لطلب)",
  custom: "تركيبة مخصصة",
};

/** Is the return center reachable from this live responsibility? Server still enforces. */
export function canReachReturns(sel: { resource: string; actions: string[] } | null | undefined): boolean {
  if (!sel || sel.resource !== "pos" || !sel.actions.includes("pos.read")) return false;
  return sel.actions.some((a) => (RETURN_ACTIONS as readonly string[]).includes(a) || a === "pos.shift.close" || a === "pos.shift.difference" || a === "pos.shift.responsibility");
}

/** Split a preview into allowed vs blocked work against the offered ceiling. */
export function splitAllowed(allowed: string[], ceiling: string[]): { allowed: string[]; blocked: string[] } {
  const set = new Set(allowed);
  return { allowed: [...set], blocked: ceiling.filter((a) => !set.has(a)) };
}

export type PosTender = "cash" | "card" | "stc" | "transfer" | "deferred";

/**
 * Checkout controls for a managed cashier, derived ONLY from the selected
 * live responsibility's action list. Non-cash/deferred tenders are recorded
 * manually (no provider). A positive discount still needs the company's
 * financial limit for role "scoped"; the server decides, never this UI.
 */
export function scopedCheckoutCaps(actions: readonly string[] | null | undefined): {
  sell: boolean; discount: boolean; recordTender: boolean; tenders: PosTender[];
} {
  const a = new Set(actions ?? []);
  const sell = a.has("pos.read") && a.has("pos.sell");
  const recordTender = sell && a.has("pos.payment.record");
  return {
    sell,
    discount: sell && a.has("pos.discount"),
    recordTender,
    tenders: recordTender ? ["cash", "card", "stc", "transfer", "deferred"] : ["cash"],
  };
}

/** Body discount for a managed checkout: zero unless pos.discount is held. */
export function scopedBodyDiscount(actions: readonly string[] | null | undefined, discount: number): number {
  return scopedCheckoutCaps(actions).discount || actions?.includes("pos.discount.request") ? discount : 0;
}
