import type { usePosSellers } from "@/hooks/use-pos-sellers";
import { SellerSelect, wholeEmptyLabel } from "./seller-picker";

type Selection = ReturnType<typeof usePosSellers>;

export function PosSellerControls({ selection: s, locked }: { selection: Selection; locked: boolean }) {
  if (s.frozen) return <p data-testid="classic-seller-frozen" className="text-xs text-neutral-600">
    اختيار البائع محفوظ مع محاولة الدفع المعلقة؛ يُسترجع جسم العملية الأصلي دون تغيير الإسناد.
  </p>;
  if (!s.data || s.failed) return <div className="space-y-1 text-xs" data-testid="classic-seller-status">
    <p role={s.failed ? "alert" : "status"}>{s.block}</p>
    {s.failed && <button type="button" onClick={s.refetch} className="underline" data-testid="classic-seller-retry">إعادة المحاولة</button>}
  </div>;
  const { policy, sellers } = s.data;
  if (policy.mode === "hidden") return null;
  return <div className="space-y-1" data-testid="classic-seller-controls">
    <label className="text-xs font-semibold">
      {policy.granularity === "line" ? "البائع الافتراضي للبنود" : "بائع الفاتورة"}
      {policy.mode === "required" ? " (إلزامي لكل فاتورة أو بند وفق السياسة)" : " (اختياري)"}
    </label>
    <SellerSelect sellers={sellers} value={s.whole} onChange={s.selectWhole} disabled={locked}
      allowEmpty={policy.mode === "optional" || policy.granularity === "line"}
      emptyLabel={policy.granularity === "line" ? "حدّد البائع لكل بند أو اختر بائعًا افتراضيًا" : wholeEmptyLabel(policy)}
      testId="classic-seller-whole" label="بائع الفاتورة" />
    {s.block && <p role="alert" className="text-xs text-red-700">{s.block}</p>}
    {!sellers.length && policy.mode === "optional" && <p className="text-xs text-neutral-600">لا يوجد بائع مؤهل؛ يمكن البيع دون إسناد وفق السياسة الاختيارية.</p>}
  </div>;
}

export function PosLineSeller({ selection: s, productId, locked }: { selection: Selection; productId: number; locked: boolean }) {
  if (s.frozen || !s.data || s.data.policy.mode === "hidden" || s.data.policy.granularity !== "line") return null;
  // Keep a React-owned host when the browser's native-select layer reparents
  // SELECT. Freezing removes this host, never a SELECT from its former parent.
  return <div data-testid={`classic-line-seller-host-${productId}`}><SellerSelect sellers={s.data.sellers} value={s.lines[productId]} disabled={locked}
    onChange={(value) => s.selectLine(productId, value)} allowEmpty emptyLabel="كبائع الفاتورة"
    testId={`classic-line-seller-${productId}`} label={`بائع البند ${productId}`}
    className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs disabled:opacity-60" /></div>;
}
