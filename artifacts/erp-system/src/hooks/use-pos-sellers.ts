import { useCallback, useMemo, useState } from "react";
import { useGetSellerWorkspace } from "@workspace/api-client-react";
import { buildSellerFields, parseWorkspace, selectionFromBody } from "@/lib/sellers";

type Row = { product: { id: number } };
type SavedBody = Parameters<typeof selectionFromBody>[0];

/** Classic POS glue only; policy, eligibility and request construction remain shared. */
export function usePosSellers(branchId: number | undefined, rows: Row[], frozen: boolean, hasSession: boolean) {
  const [whole, setWhole] = useState<number | null>(null);
  const [lines, setLines] = useState<Record<number, number | undefined>>({});
  const query = useGetSellerWorkspace(branchId ? { branchId } : undefined, {
    query: { enabled: hasSession && !frozen, retry: false, staleTime: 10_000, refetchOnMount: "always" },
  });
  // Do not reinterpret a malformed/missing policy as an authorised hidden policy.
  const data = useMemo(() => {
    const raw = query.data as { policy?: { mode?: string; granularity?: string } } | undefined;
    if (!raw?.policy || !["hidden", "optional", "required"].includes(raw.policy.mode ?? "") ||
      !["invoice", "line"].includes(raw.policy.granularity ?? "")) return null;
    return parseWorkspace(raw);
  }, [query.data]);
  const result = data ? buildSellerFields(data.policy, {
    whole, lines: Object.fromEntries(rows.map((row, index) => [index, lines[row.product.id]])),
  }, rows.length) : null;
  const eligible = new Set(data?.sellers.map((seller) => seller.id));
  const selected = data?.policy.mode !== "hidden"
    ? [whole, ...(data?.policy.granularity === "line" ? rows.map((r) => lines[r.product.id]) : [])]
    : [];
  const failed = query.isError || (!!query.data && !data);
  const block = frozen ? null : failed
    ? "تعذر تحميل سياسة البائعين؛ أعد المحاولة قبل تحصيل الدفع."
    : !data ? "جارٍ تحميل سياسة البائعين…"
    : data.policy.mode === "required" && !data.sellers.length
      ? "لا يوجد بائع مؤهل لهذا الفرع؛ راجع أهلية الموظفين قبل بدء البيع."
      : selected.some((id) => typeof id === "number" && !eligible.has(id))
        ? "البائع المحدد لم يعد ضمن البائعين المؤهلين؛ اختر بائعًا مؤهلًا."
        : result && !result.ok ? result.error : null;
  const restore = useCallback((body: SavedBody, savedRows: Row[]) => {
    const saved = selectionFromBody(body);
    setWhole(saved.whole);
    setLines(Object.fromEntries(savedRows.map((row, index) => [row.product.id, saved.lines[index]])));
  }, []);
  const removeLine = (productId: number) => setLines((old) => {
    const next = { ...old }; delete next[productId]; return next;
  });
  return {
    data, whole, lines, block, failed, frozen, restore, removeLine,
    fields: result?.ok ? result.fields : null,
    refetch: () => void query.refetch(),
    selectWhole: (value: number | null) => { if (!frozen) setWhole(value); },
    selectLine: (id: number, value: number | null) => { if (!frozen) setLines((old) => ({ ...old, [id]: value ?? undefined })); },
    reset: () => { setWhole(null); setLines({}); },
  };
}
