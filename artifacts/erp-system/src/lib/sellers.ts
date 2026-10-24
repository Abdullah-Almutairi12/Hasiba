/** Seller attribution: safe parsing of the seller workspace/report and body building. */
export type SellerMode = "hidden" | "optional" | "required";
export type SellerGranularity = "invoice" | "line";
export function fmtSellerPolicyDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "تاريخ غير صحيح";
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(date);
}
export type SellerPolicy = {
  version: number | null; branchId: number | null; inherited: boolean; mode: SellerMode;
  granularity: SellerGranularity; commissionEnabled: boolean; planId: number | null;
  ratePercent: number | null; effectiveFrom: string; basis: string;
};
export type Seller = { id: number; name: string; employeeNo: string; branchId: number | null };
export type Employee = Seller & { status: string; eligible: boolean; branchIds: number[] | null };
export type Branch = { id: number; name: string };
export type Plan = { id: number; name: string };
export type Workspace = {
  policy: SellerPolicy; sellers: Seller[]; branches: Branch[]; employees: Employee[] | null;
  policies: Record<string, unknown>[]; commissionPlans: Plan[]; canConfigure: boolean; permissions: Set<string>;
};

type R = Record<string, unknown>;
const rec = (v: unknown): R => (v && typeof v === "object" && !Array.isArray(v) ? (v as R) : {});
const arr = (v: unknown): R[] => (Array.isArray(v) ? v.map(rec) : []);
export const s = (v: unknown, d = ""): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : d);
export const n = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** Defaults are HIDDEN with commissions OFF; never assume a percentage. */
export function parsePolicy(v: unknown): SellerPolicy {
  const p = rec(v);
  const mode = (["hidden", "optional", "required"] as const).find((m) => m === p.mode) ?? "hidden";
  return {
    version: n(p.version), branchId: n(p.branchId), inherited: p.inherited === true, mode,
    granularity: p.granularity === "line" ? "line" : "invoice",
    commissionEnabled: (p.commissionEnabled ?? p.commission_enabled) === true, planId: n(p.planId ?? p.commissionPlanId ?? p.commission_plan_id), ratePercent: n(p.ratePercent ?? p.commissionRatePercent ?? p.commission_rate_percent),
    effectiveFrom: s(p.effectiveFrom ?? p.effective_from), basis: s(p.basis),
  };
}
const person = (e: R): Seller => ({ id: n(e.id) ?? 0, name: s(e.name, `#${s(e.id)}`), employeeNo: s(e.employeeNo), branchId: n(e.branchId) });

export function parseWorkspace(v: unknown): Workspace {
  const d = rec(v);
  const permRaw = d.permissions;
  const permissions = new Set<string>(
    Array.isArray(permRaw) ? permRaw.filter((x): x is string => typeof x === "string")
      : Object.entries(rec(permRaw)).filter(([, on]) => on === true).map(([k]) => k),
  );
  return {
    policy: parsePolicy(d.policy),
    sellers: arr(d.sellers).map(person).filter((x) => x.id > 0),
    branches: arr(d.branches).map((b) => ({ id: n(b.id) ?? 0, name: s(b.name ?? b.name_ar, `فرع ${s(b.id)}`) })).filter((b) => b.id > 0),
    employees: Array.isArray(d.employees) ? arr(d.employees).map((e) => ({
      ...person(e), status: s(e.status), eligible: e.eligible === true,
      branchIds: Array.isArray(e.branchIds) ? e.branchIds.map(n).filter((x): x is number => x !== null) : null,
    })) : null,
    policies: arr(d.policies),
    commissionPlans: arr(d.commissionPlans).map((p) => ({ id: n(p.id) ?? 0, name: s(p.name, `خطة ${s(p.id)}`) })).filter((p) => p.id > 0),
    canConfigure: d.canConfigure === true,
    permissions,
  };
}

/** Selection: a whole-sale seller plus optional per-line overrides (line granularity only). */
export type SellerSelection = { whole: number | null; lines: Record<number, number | undefined> };

export type SellerBodyResult =
  | { ok: true; fields: { sellerEmployeeId?: number | null; lineSellers?: Array<{ lineIndex: number; employeeId: number | null }> } }
  | { ok: false; error: string };

/**
 * Build request fields. Hidden => nothing is sent. `lineCount` is the submitted
 * lines' count and indices match the submitted order.
 */
export function buildSellerFields(policy: SellerPolicy, sel: SellerSelection, lineCount: number): SellerBodyResult {
  if (policy.mode === "hidden") return { ok: true, fields: {} };
  const lineSellers: Array<{ lineIndex: number; employeeId: number | null }> = [];
  if (policy.granularity === "line") {
    for (let i = 0; i < lineCount; i++) {
      const o = sel.lines[i];
      if (typeof o === "number") lineSellers.push({ lineIndex: i, employeeId: o });
    }
  }
  if (policy.mode === "required") {
    for (let i = 0; i < lineCount; i++) {
      const eff = policy.granularity === "line" && typeof sel.lines[i] === "number" ? sel.lines[i] : sel.whole;
      if (eff == null) return { ok: false, error: policy.granularity === "line" ? `اختيار البائع إلزامي — البند ${i + 1} بلا بائع` : "اختيار البائع إلزامي قبل الحفظ" };
    }
  }
  return { ok: true, fields: { sellerEmployeeId: sel.whole, ...(policy.granularity === "line" ? { lineSellers } : {}) } };
}

/** Restore a saved selection from a persisted request body (e.g. checkout attempt). */
export function selectionFromBody(body: { sellerEmployeeId?: number | null; lineSellers?: Array<{ lineIndex: number; employeeId: number | null }> } | null | undefined): SellerSelection {
  const lines: Record<number, number | undefined> = {};
  for (const l of body?.lineSellers ?? []) if (typeof l.employeeId === "number") lines[l.lineIndex] = l.employeeId;
  return { whole: typeof body?.sellerEmployeeId === "number" ? body.sellerEmployeeId : null, lines };
}

/** Saved seller snapshot from a POS order response (sellerAttribution). null = historic response without snapshot. */
export type SavedAttribution = Array<{ invoiceLineId: number | null; employeeId: number | null; sellerName: string; revision: number | null }>;
export function parseSavedAttribution(v: unknown): SavedAttribution | null {
  if (!Array.isArray(v)) return null;
  return v.map(rec).map((a) => ({
    invoiceLineId: n(a.invoiceLineId ?? a.invoice_line_id), employeeId: n(a.employeeId ?? a.employee_id),
    sellerName: s(a.sellerName ?? a.seller_name), revision: n(a.revision),
  }));
}
/** Receipt label from saved names only; never today's picker or the cashier. */
export function savedSellerLabel(v: unknown): string {
  const a = parseSavedAttribution(v);
  if (a === null) return "غير معروف (لا توجد لقطة بائع محفوظة)";
  const names = Array.from(new Set(a.filter((x) => x.employeeId != null).map((x) => x.sellerName || `#${x.employeeId}`)));
  return names.length ? names.join("، ") : "بدون بائع";
}

/** Invoice detail attribution (GET /sales/invoices/:id). */
export type InvoiceAttribution = {
  ref: string; hasSnapshot: boolean; sellerId: number | null; sellerName: string;
  policy: { version: number | null; mode: SellerMode; granularity: SellerGranularity } | null;
  lines: Array<{ id: number; description: string; sellerId: number | null; sellerName: string; revision: number | null }>;
};
export function parseInvoiceAttribution(v: unknown, fallbackRef: string): InvoiceAttribution {
  const d = rec(v);
  const ap = d.attributionPolicy ?? d.attribution_policy;
  const pol = ap && typeof ap === "object" ? parsePolicy(ap) : null;
  return {
    ref: s(d.reference ?? d.invoiceNumber ?? d.invoice_number ?? d.number, fallbackRef),
    hasSnapshot: (d.hasSellerSnapshot ?? d.has_seller_snapshot) === true,
    sellerId: n(d.sellerEmployeeId ?? d.seller_employee_id), sellerName: s(d.sellerName ?? d.seller_name),
    policy: pol ? { version: pol.version, mode: pol.mode, granularity: pol.granularity } : null,
    lines: arr(d.lines).map((r) => ({
      id: n(r.id) ?? 0, description: s(r.description ?? r.productName ?? r.product_name, `بند ${s(r.id)}`),
      sellerId: n(r.sellerEmployeeId ?? r.seller_employee_id), sellerName: s(r.sellerName ?? r.seller_name), revision: n(r.sellerRevision ?? r.seller_revision),
    })).filter((l) => l.id > 0),
  };
}

export const MODE_AR: Record<SellerMode, string> = { hidden: "مخفي", optional: "اختياري", required: "إلزامي" };
export const GRAN_AR: Record<SellerGranularity, string> = { invoice: "على مستوى الفاتورة", line: "على مستوى البند" };
export const COMMISSION_STATUS: Record<string, { text: string; cls: string }> = {
  calculated: { text: "محسوبة — غير معتمدة", cls: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200" },
  approved: { text: "معتمدة — غير مدفوعة", cls: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200" },
  paid: { text: "موثقة كمدفوعة خارجيًا", cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
};

export type ReportRow = { sellerId: number | null; sellerName: string; currency: string; grossSales: number; discounts: number; returns: number; cancellations: number; net: number; invoiceCount: number };
export type Commission = { id: number; invoiceId: number | null; invoiceLineId: number | null; employeeId: number | null; sellerName: string; currency: string; kind: string; date: string; amount: number; net: number; policy: unknown; status: string; reference: string };
export type Source = { invoiceId: number | null; invoiceLineId: number | null; reference: string; kind: string; date: string; currency: string; net: number };
export type SellerReport = { from: string; to: string; basis: string; basisDescription: string; uniqueInvoiceCount: number | null; rows: ReportRow[]; commissions: Commission[]; sources: Source[]; warnings: string[] };

export function parseReport(v: unknown): SellerReport {
  const d = rec(v);
  return {
    from: s(d.from), to: s(d.to), basis: s(d.basis), basisDescription: s(d.basisDescription), uniqueInvoiceCount: n(d.uniqueInvoiceCount),
    rows: arr(d.rows).map((r) => ({
      sellerId: n(r.sellerId), sellerName: s(r.sellerName, "غير مسند"), currency: s(r.currency, "SAR"),
      grossSales: n(r.grossSales) ?? 0, discounts: n(r.discounts) ?? 0, returns: n(r.returns) ?? 0,
      cancellations: n(r.cancellations) ?? 0, net: n(r.net) ?? 0, invoiceCount: n(r.invoiceCount) ?? 0,
    })),
    commissions: arr(d.commissions).map((c) => ({
      id: n(c.id) ?? 0, invoiceId: n(c.invoice_id), invoiceLineId: n(c.invoice_line_id), employeeId: n(c.employee_id),
      sellerName: s(c.seller_name, "—"), currency: s(c.currency_code, "SAR"), kind: s(c.kind), date: s(c.effective_date),
      amount: n(c.amount) ?? 0, net: n(c.net) ?? 0, policy: c.policy, status: s(c.status).toLowerCase(), reference: s(c.external_reference),
    })),
    sources: arr(d.sources).map((x) => ({
      invoiceId: n(x.invoiceId ?? x.invoice_id), invoiceLineId: n(x.invoiceLineId ?? x.invoice_line_id), reference: s(x.reference ?? x.invoiceNumber ?? x.invoice_number), kind: s(x.kind),
      date: s(x.date), currency: s(x.currency, "SAR"), net: n(x.net) ?? 0,
    })),
    warnings: Array.isArray(d.warnings) ? d.warnings.map((w) => (typeof w === "string" ? w : s(rec(w).message, JSON.stringify(w)))) : [],
  };
}

/** Group rows/amounts per currency; currencies are never mixed. */
export function totalsByCurrency<T>(items: T[], cur: (x: T) => string, val: (x: T) => number): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const it of items) m.set(cur(it), (m.get(cur(it)) ?? 0) + val(it));
  return Array.from(m.entries());
}

export const fmtMoney = (v: number, currency: string) =>
  `${v.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
