import { useState } from "react";
import { useGetWorkspaceAccess, WORKSPACE_RESPONSIBILITY_HEADER } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/hooks/use-api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type PosCustomerChoice = { id: number; name: string };

/** Directory access stays in the existing server-scoped customer endpoint. */
export function PosCustomerPicker({ open, onOpenChange, scope, disabled, selected, onSelect, scoped = false }: {
  open: boolean; onOpenChange: (open: boolean) => void; scope: string; disabled: boolean;
  selected: PosCustomerChoice | null; onSelect: (customer: PosCustomerChoice | null) => void; scoped?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [chosenGrant, setChosenGrant] = useState<number | null>(null);
  const access = useGetWorkspaceAccess({ query: { queryKey:["/workspace/access","pos-customer-picker",scope],
    enabled: open && scoped && !disabled, retry: false, staleTime: 0, refetchInterval:30_000 } });
  const grants = (access.data?.grants ?? []).filter(g => g.resource === "sales" && g.actions.includes("sales.customers.read"));
  const grant = grants.find(g => g.id === chosenGrant) ?? (grants.length === 1 ? grants[0] : null);
  const canRead = !scoped || !!grant;
  const customers = useQuery<PosCustomerChoice[]>({
    queryKey: ["/customers", "pos-picker", scope, grant?.id ?? null, search],
    queryFn: () => apiGet(`/customers?search=${encodeURIComponent(search)}`,
      scoped && grant ? { [WORKSPACE_RESPONSIBILITY_HEADER]: String(grant.id) } : undefined),
    enabled: open && !disabled && canRead, retry: false, staleTime: 0,
  });
  const select = (customer: PosCustomerChoice | null) => {
    if (disabled) return;
    onSelect(customer); onOpenChange(false);
  };
  return <Dialog open={open && !disabled} onOpenChange={onOpenChange}>
    <DialogContent dir="rtl">
      <DialogHeader><DialogTitle>اختر العميل</DialogTitle></DialogHeader>
      {selected && <p>العميل المختار: {selected.name}</p>}
      <Input aria-label="البحث عن عميل نقطة البيع" placeholder="الاسم أو الهاتف" value={search} onChange={e => setSearch(e.target.value)} />
      <Button variant="outline" onClick={() => select(null)}>عميل نقدي دون اختيار عميل مسجل</Button>
      {scoped && <div>
        <label htmlFor="pos-customer-directory-grant">مسؤولية قراءة دليل العملاء — لا تمنح أرصدة أو تحصيلًا</label>
        <select id="pos-customer-directory-grant" className="w-full rounded border p-2" value={grant?.id ?? ""}
          onChange={e => setChosenGrant(e.target.value ? Number(e.target.value) : null)}>
          <option value="">اختر مسؤولية ممنوحة صراحة</option>
          {grants.map(g => <option key={g.id} value={g.id}>دليل العملاء — المسؤولية #{g.id}</option>)}
        </select>
      </div>}
      {scoped && access.isLoading ? <p role="status">جارٍ التحقق من صلاحية دليل العملاء…</p>
        : scoped && access.isError ? <div role="alert">تعذر التحقق من صلاحية الدليل. <Button onClick={()=>void access.refetch()}>إعادة التحقق</Button></div>
        : !canRead ? <p role="alert">اختر مسؤولية قراءة دليل العملاء الممنوحة لهذا الحساب؛ صلاحية البيع لا تمنح قراءة الدليل تلقائيًا.</p>
        : customers.isLoading ? <p role="status">جارٍ تحميل العملاء…</p> : customers.isError
        ? <div role="alert">تعذر تحميل العملاء ضمن مسؤوليتك. <Button onClick={() => void customers.refetch()}>إعادة المحاولة</Button></div>
        : <div className="max-h-72 overflow-y-auto space-y-2">
          {(customers.data ?? []).map(c => <Button key={c.id} variant="outline" className="w-full justify-start"
            data-testid={`pos-customer-${c.id}`} onClick={() => select({ id: c.id, name: c.name })}>{c.name}</Button>)}
          {!customers.data?.length && <p>لا يوجد عميل مطابق ضمن النطاق المسموح.</p>}
        </div>}
    </DialogContent>
  </Dialog>;
}
