import { useState } from "react";
import { useListCustomers } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type PosCustomerChoice = { id: number; name: string };

/** Directory access stays in the existing server-scoped customer endpoint. */
export function PosCustomerPicker({ open, onOpenChange, scope, disabled, selected, onSelect }: {
  open: boolean; onOpenChange: (open: boolean) => void; scope: string; disabled: boolean;
  selected: PosCustomerChoice | null; onSelect: (customer: PosCustomerChoice | null) => void;
}) {
  const [search, setSearch] = useState("");
  const customers = useListCustomers({ search }, { query: {
    queryKey: ["/customers", "pos-picker", scope, search],
    enabled: open && !disabled, retry: false, staleTime: 0,
  } });
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
      {customers.isLoading ? <p role="status">جارٍ تحميل العملاء…</p> : customers.isError
        ? <div role="alert">تعذر تحميل العملاء ضمن مسؤوليتك. <Button onClick={() => void customers.refetch()}>إعادة المحاولة</Button></div>
        : <div className="max-h-72 overflow-y-auto space-y-2">
          {(customers.data ?? []).map(c => <Button key={c.id} variant="outline" className="w-full justify-start"
            data-testid={`pos-customer-${c.id}`} onClick={() => select({ id: c.id, name: c.name })}>{c.name}</Button>)}
          {!customers.data?.length && <p>لا يوجد عميل مطابق ضمن النطاق المسموح.</p>}
        </div>}
    </DialogContent>
  </Dialog>;
}
