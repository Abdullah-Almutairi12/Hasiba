import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateWarehouse, getListWarehousesQueryKey } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export interface WarehouseBranchOption {
  id: number;
  name: string;
  nameAr?: string | null;
}

interface WarehouseFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: WarehouseBranchOption[];
}

export const WAREHOUSE_SUMMARY_KEY = ["/inventory/warehouse-summary"] as const;
export const WH_ERR_FORBIDDEN = "ليست لديك صلاحية إضافة مستودع. تواصل مع مالك المنشأة.";
export const WH_ERR_BRANCH = "الفرع المختار غير متاح لمنشأتك أو غير نشط. اختر فرعاً آخر.";
export const WH_ERR_INVALID = "تحقق من البيانات: اختر الفرع واكتب اسم المستودع بالعربية والإنجليزية.";
export const WH_ERR_UNKNOWN =
  "تعذّر التأكد من نتيجة الحفظ. قد يكون المستودع أُنشئ أو لا؛ راجع قائمة المستودعات وحدّثها للتحقق قبل إعادة المحاولة.";

const hasArabic = (s: unknown): s is string => typeof s === "string" && /[\u0600-\u06FF]/.test(s);

/** Map a create-warehouse failure to an honest Arabic message. */
export function describeWarehouseError(err: unknown): { message: string; unknown: boolean } {
  const e = err as { status?: unknown; data?: unknown } | null;
  const status = typeof e?.status === "number" ? e.status : undefined;
  const data = (e?.data ?? null) as { error?: unknown; message?: unknown } | null;
  const serverMsg = data?.error ?? data?.message;
  if (status === 403) return { message: WH_ERR_FORBIDDEN, unknown: false };
  if (status === 404) return { message: WH_ERR_BRANCH, unknown: false };
  if (status === 400 || status === 422) {
    return { message: hasArabic(serverMsg) ? serverMsg : WH_ERR_INVALID, unknown: false };
  }
  return { message: WH_ERR_UNKNOWN, unknown: true };
}

const EMPTY = { branchId: "", nameAr: "", name: "" };

export function WarehouseFormDialog({ open, onOpenChange, branches }: WarehouseFormDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreateWarehouse();
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const requestClose = (next: boolean) => {
    if (submittingRef.current) return;
    onOpenChange(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    const branchId = Number(form.branchId);
    const nameAr = form.nameAr.trim();
    const name = form.name.trim();
    if (!branchId || !nameAr || !name) {
      setError(WH_ERR_INVALID);
      return;
    }
    submittingRef.current = true;
    setPending(true);
    setError(null);
    try {
      await createMutation.mutateAsync({ data: { branchId, name, nameAr } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListWarehousesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: WAREHOUSE_SUMMARY_KEY }),
      ]);
      toast({ title: "تمت إضافة المستودع" });
      setForm(EMPTY);
      submittingRef.current = false;
      setPending(false);
      onOpenChange(false);
    } catch (err) {
      const { message, unknown } = describeWarehouseError(err);
      setError(message);
      if (unknown) {
        void queryClient.invalidateQueries({ queryKey: getListWarehousesQueryKey() });
      }
      submittingRef.current = false;
      setPending(false);
    }
  };

  const noBranches = branches.length === 0;

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        dir="rtl"
        className="max-h-[90dvh] overflow-y-auto sm:max-w-md"
        onEscapeKeyDown={(e) => pending && e.preventDefault()}
        onInteractOutside={(e) => pending && e.preventDefault()}
      >
        <DialogHeader className="text-right">
          <DialogTitle>مستودع جديد</DialogTitle>
          <DialogDescription>
            أضف مستودعاً لأحد فروع منشأتك. لا يُدخل هنا أي رصيد أو مخزون افتتاحي.
          </DialogDescription>
        </DialogHeader>
        {noBranches ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-testid="text-warehouse-no-branches">
            لا توجد فروع متاحة. أضف فرعاً أولاً ثم أنشئ المستودع.
          </p>
        ) : null}
        <form onSubmit={handleSubmit} className="space-y-4" aria-busy={pending}>
          <fieldset disabled={pending || noBranches} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="whBranch">الفرع *</Label>
              <select
                id="whBranch"
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
                data-testid="select-warehouse-branch"
              >
                <option value="">اختر الفرع</option>
                {branches.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.nameAr || b.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="whNameAr">اسم المستودع بالعربية *</Label>
              <Input
                id="whNameAr"
                value={form.nameAr}
                onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
                placeholder="مثال: المستودع الرئيسي"
                data-testid="input-warehouse-name-ar"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="whName">اسم المستودع بالإنجليزية *</Label>
              <Input
                id="whName"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Main Warehouse"
                dir="ltr"
                data-testid="input-warehouse-name"
              />
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" data-testid="text-warehouse-error">
              {error}
            </p>
          )}
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" disabled={pending} onClick={() => requestClose(false)} className="w-full sm:w-auto">
              إلغاء
            </Button>
            <Button type="submit" disabled={pending || noBranches} className="w-full sm:w-auto" data-testid="button-warehouse-submit">
              {pending ? "جارٍ الحفظ..." : "إضافة المستودع"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
