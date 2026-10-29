import { CATEGORY_LABEL, lineCategory, type TaxCategory } from "@/lib/tax-preview";
import type { TaxPreviewHandle } from "@/hooks/use-tax-preview";

const num = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Number(v).toFixed(2));

/** Server-quoted tax summary, reviewed for every new attempt in any mode. */
export function TaxPreviewPanel({ tp, frozenNote, compact = false }: { tp: TaxPreviewHandle; frozenNote?: string | null; compact?: boolean }) {
  if (frozenNote) {
    return <div className="rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="tax-preview-frozen">{frozenNote}</div>;
  }
  if (tp.status === "idle" && !tp.preview) return null;
  const p = tp.preview;
  const groups = new Map<TaxCategory, NonNullable<typeof p>["totals"]["lines"]>();
  if (p) for (const l of p.totals.lines) { const c = lineCategory(p, l); groups.set(c, [...(groups.get(c) ?? []), l]); }
  return (
    <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/50 p-2.5 text-xs dark:border-blue-900 dark:bg-blue-950/30" data-testid="tax-preview-panel">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">حساب الضريبة من الخادم</span>
        <span className="text-[10px] text-neutral-500" data-testid="tax-preview-status">
          {tp.status === "loading" ? "جارٍ الحساب…" : tp.status === "error" ? "تعذر الحساب" : tp.expired ? "منتهية" : tp.confirmed ? "تمت المراجعة" : "بانتظار المراجعة"}
        </span>
      </div>
      {tp.status === "error" && (
        <p role="alert" className="text-red-700 dark:text-red-300" data-testid="tax-preview-error">{tp.error}{" "}
          <button type="button" className="underline" onClick={tp.retry} data-testid="button-tax-preview-retry">إعادة المحاولة</button></p>
      )}
      {p && (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5" data-testid="tax-preview-totals">
            <dt>قبل الضريبة</dt><dd className="text-end font-mono" data-testid="tax-preview-subtotal">{num(p.totals.subtotal)}</dd>
            <dt>الخصم</dt><dd className="text-end font-mono" data-testid="tax-preview-discount">{num(p.totals.discount)}</dd>
            <dt>الضريبة</dt><dd className="text-end font-mono" data-testid="tax-preview-vat">{num(p.totals.vat)}</dd>
            <dt className="font-bold">الإجمالي</dt><dd className="text-end font-mono font-bold" data-testid="tax-preview-total">{num(p.totals.total)}</dd>
          </dl>
          <p className="text-[10px] text-neutral-500">{p.context.priceIncludesVat ? "الأسعار شاملة الضريبة" : "الأسعار غير شاملة الضريبة"} — صالحة حتى {new Date(p.expiresAt).toLocaleTimeString("ar-SA")}</p>
          {!compact && [...groups.entries()].map(([c, lines]) => (
            <div key={c} data-testid={`tax-preview-category-${c}`}>
              <p className="font-semibold">{CATEGORY_LABEL[c]}</p>
              {lines.map((l, i) => (
                <p key={i} className="flex justify-between text-[11px] text-neutral-600 dark:text-neutral-300">
                  <span className="truncate">{l.description} × {String(l.quantity)}</span>
                  <span className="font-mono">{num(l.lineNet)} + {num(l.lineVat)}</span>
                </p>
              ))}
            </div>
          ))}
        </>
      )}
      {tp.diffs.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" data-testid="tax-preview-diffs">
          <p className="mb-1 font-semibold">تغيّر الحساب منذ آخر مراجعة</p>
          {tp.diffs.map((d, i) => <p key={i} className="flex justify-between gap-2"><span>{d.label}</span><span className="font-mono">{d.before} ← {d.after}</span></p>)}
        </div>
      )}
      {p && !tp.confirmed && !tp.expired && (
        <button type="button" onClick={tp.confirm} className="w-full rounded-lg bg-blue-600 py-1.5 text-xs font-bold text-white hover:bg-blue-700" data-testid="button-tax-preview-confirm">
          راجعت حساب الضريبة وأؤكده
        </button>
      )}
    </div>
  );
}
