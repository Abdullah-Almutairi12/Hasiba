import { useState } from "react";
import { useCreatePosSession, useListBranches } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { readErr } from "@/lib/returns/shared";

/** Legacy access still goes through the existing server authorization. No role
 * conversion, implicit branch, or synthetic opening balance is introduced here. */
export function LegacyShiftStart({ onOpened, onBack }: {
  onOpened: () => void; onBack: () => void;
}) {
  const { user } = useAuth();
  const branches = useListBranches();
  const create = useCreatePosSession();
  const [branchId, setBranchId] = useState("");
  const [openingCash, setOpeningCash] = useState("0");
  const [error, setError] = useState("");
  const [confirmedId, setConfirmedId] = useState<number | null>(null);
  const allowed = branches.data ?? [];
  const branch = allowed.find(b => String(b.id) === branchId);
  const cashValid = /^\d+(?:\.\d{1,2})?$/.test(openingCash) && Number(openingCash) <= 99_999_999.99;
  const valid = !!branch && !!user?.name && cashValid && !branches.isLoading && !branches.isError;
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md space-y-4 p-6">
        <h1 className="text-xl font-bold">جلسة البيع مغلقة</h1>
        <p className="text-sm text-muted-foreground">اختر الفرع المسموح ورصيد درج النقد الفعلي قبل فتح ورديتك.</p>
        {branches.isLoading && <p role="status">جارٍ تحميل الفروع المسموحة…</p>}
        {branches.isError && <div role="alert" className="space-y-2 text-destructive">
          <p>تعذر تحميل الفروع. لا يمكن فتح وردية بفرع افتراضي.</p>
          <Button variant="outline" onClick={() => void branches.refetch()}>إعادة المحاولة</Button>
        </div>}
        {!branches.isLoading && !branches.isError && allowed.length === 0
          && <p role="status">لا توجد فروع متاحة لك؛ راجع مسؤول المنشأة.</p>}
        <form className="space-y-4" onSubmit={e => {
          e.preventDefault();
          if (!valid || create.isPending || confirmedId != null) return;
          setError("");
          create.mutate({ data: {
            branchId: branch!.id, cashierName: user!.name, openingCash: Number(openingCash),
          } }, {
            onSuccess: session => { setConfirmedId(session.id); onOpened(); },
            onError: e => setError(readErr(e).message),
          });
        }}>
          <div className="space-y-1">
            <Label htmlFor="legacy-shift-branch">الفرع</Label>
            <select id="legacy-shift-branch" value={branchId}
              disabled={create.isPending || confirmedId != null || branches.isLoading || branches.isError}
              onChange={e => setBranchId(e.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3">
              <option value="">اختر الفرع صراحةً</option>
              {allowed.map(b => <option key={b.id} value={String(b.id)}>{b.nameAr || b.name}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="legacy-shift-cash">رصيد النقد الافتتاحي</Label>
            <Input id="legacy-shift-cash" inputMode="decimal" value={openingCash}
              onChange={e => setOpeningCash(e.target.value)} disabled={create.isPending || confirmedId != null} dir="ltr" />
            {!cashValid && <p role="alert" className="text-sm text-destructive">أدخل مبلغًا غير سالب بمنزلتين عشريتين كحد أقصى.</p>}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={!valid || create.isPending || confirmedId != null}
            data-testid="button-legacy-open-shift">
            {confirmedId != null ? "أُكد فتح الوردية" : create.isPending ? "جارٍ فتح الوردية…" : "فتح جلسة جديدة"}
          </Button>
        </form>
        {confirmedId != null && <div role="status" className="space-y-2 text-sm">
          <p>أُكد فتح الوردية #{confirmedId}. إذا تأخر العرض، حدّث الوردية المؤكدة ولا تنشئ وردية أخرى.</p>
          <Button variant="outline" onClick={onOpened}>تحديث الوردية المؤكدة</Button>
        </div>}
        <Button variant="ghost" className="w-full" onClick={onBack} disabled={create.isPending}>العودة للوحة القيادة</Button>
      </Card>
    </div>
  );
}
