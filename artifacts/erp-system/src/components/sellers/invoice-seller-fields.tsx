import { useMemo, useState } from "react";
import { useGetSellerWorkspace } from "@workspace/api-client-react";
import { Label } from "@/components/ui/label";
import { buildSellerFields, parseWorkspace, type SellerSelection, type Workspace } from "@/lib/sellers";
import { SellerSelect, wholeEmptyLabel } from "./seller-picker";

/** Seller state for the manual sales-invoice dialog; resolves effective company/branch policy. */
export function useInvoiceSellers(enabled: boolean) {
  const [branchId, setBranchId] = useState<number | null>(null);
  const q = useGetSellerWorkspace(branchId ? { branchId } : undefined, { query: { enabled, retry: false } });
  const ws = useMemo<Workspace | null>(() => (q.data ? parseWorkspace(q.data) : null), [q.data]);
  const [sel, setSel] = useState<SellerSelection>({ whole: null, lines: {} });
  /** `originalIndices` = original dialog row index for each submitted line, in submitted order. */
  const build = (originalIndices: number[]) => {
    if (!enabled) return { ok: true as const, fields: {} };
    if (!ws) {
      if (q.isError) { void q.refetch(); return { ok: false as const, error: "تعذر تحميل سياسة البائعين. أعد المحاولة قبل الحفظ." }; }
      return { ok: false as const, error: "جارٍ تحميل سياسة البائعين، أعد المحاولة بعد لحظة" };
    }
    const remapped: SellerSelection = { whole: sel.whole, lines: {} };
    originalIndices.forEach((orig, idx) => { remapped.lines[idx] = sel.lines[orig]; });
    const r = buildSellerFields(ws.policy, remapped, originalIndices.length);
    if (!r.ok) return r;
    return { ok: true as const, fields: { ...r.fields, ...(branchId ? { branchId } : {}) } };
  };
  return { ws, error: q.isError, retry: () => void q.refetch(), branchId, setBranchId, sel, setSel, build };
}

export function InvoiceSellerFields({ state, lines, hideBranch=false }: { state: ReturnType<typeof useInvoiceSellers>; lines: string[];hideBranch?:boolean }) {
  const { ws, error, retry, branchId, setBranchId, sel, setSel } = state;
  if (error && !ws) return <p role="alert" className="text-xs text-destructive" data-testid="invoice-seller-unavailable">تعذر تحميل سياسة البائعين؛ لا يمكن حفظ الفاتورة حتى تُحمَّل. <button type="button" className="underline" onClick={retry} data-testid="button-retry-invoice-seller">إعادة المحاولة</button></p>;
  if (!ws) return <p className="text-xs text-muted-foreground" data-testid="invoice-seller-loading">جارٍ تحميل سياسة البائعين…</p>;
  const branchPicker = !hideBranch && ws.branches.length > 1 && (
    <div>
      <Label className="text-xs">الفرع</Label>
      <select data-testid="select-invoice-branch" className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        value={branchId ?? 0} onChange={(e) => setBranchId(Number(e.target.value) || null)}>
        <option value={0}>الافتراضي</option>
        {ws.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </div>
  );
  if (ws.policy.mode === "hidden") return branchPicker ? <div className="grid grid-cols-2 gap-3">{branchPicker}</div> : null;
  const p = ws.policy;
  return (
    <div className="space-y-2 rounded-lg border p-3" data-testid="invoice-seller-fields">
      <div className="grid grid-cols-2 gap-3">
        {branchPicker}
        <div>
          <Label>البائع {p.mode === "required" ? "(إلزامي)" : "(اختياري)"}</Label>
          <SellerSelect sellers={ws.sellers} value={sel.whole} onChange={(v) => setSel({ ...sel, whole: v })}
            allowEmpty={p.mode === "optional" || p.granularity === "line"} emptyLabel={wholeEmptyLabel(p)} testId="select-invoice-seller" label="البائع" />
        </div>
      </div>
      {p.granularity === "line" && lines.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {lines.map((name, i) => (
            <div key={i}>
              <Label className="text-xs">بائع البند {i + 1}: {name}</Label>
              <SellerSelect sellers={ws.sellers} value={sel.lines[i]} onChange={(v) => setSel({ ...sel, lines: { ...sel.lines, [i]: v ?? undefined } })}
                allowEmpty emptyLabel="كبائع الفاتورة" testId={`select-invoice-line-seller-${i}`} label={`بائع البند ${i + 1}`} />
            </div>
          ))}
        </div>
      )}
      {ws.sellers.length === 0 && <p className="text-xs text-amber-700">لا يوجد بائعون مؤهلون لهذا الفرع. فعّل الأهلية من تبويب العمولات.</p>}
    </div>
  );
}
