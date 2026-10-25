import { useEffect, useMemo, useState } from "react";
import { actionLabel, posResponsibilitySummary } from "@/lib/pos-actions";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetWorkspaceAccess,
  getGetWorkspaceAccessQueryKey,
  useGetWorkspaceInventory,
  getGetWorkspaceInventoryQueryKey,
  useListBranches,
  getListBranchesQueryKey,
  type TeamGrant,
} from "@workspace/api-client-react";
import { AlertTriangle, Building2, CalendarClock, Lock, Package, RefreshCw, Search, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { RESOURCE_LABEL, errorText, grantWindowState, statusMeta } from "@/lib/team-access";
import { refreshSelectedFromAccess, selectResponsibility, selectionFromAccess, useSelectedResponsibility } from "@/lib/workspace-responsibility";
import { readPendingPosAttempt } from "@/hooks/use-pos-checkout";
import { InventoryTransferReceipts } from "@/components/inventory-transfer-receipts";

const fmtQty = (q: string) => {
  const n = Number(q);
  return Number.isFinite(n) ? n.toLocaleString("ar-SA", { maximumFractionDigits: 4 }) : q;
};

export default function MyWorkPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const selected = useSelectedResponsibility();
  const accessQ = useGetWorkspaceAccess({ query: { queryKey: getGetWorkspaceAccessQueryKey(), refetchInterval: 30_000, refetchOnWindowFocus: true } });
  const { data: branches } = useListBranches({ query: { queryKey: getListBranchesQueryKey(), retry: false } });
  const access = accessQ.data;

  const grants = useMemo(() => access?.grants ?? [], [access]);
  const [, setLocation] = useLocation();
  const [switchBlock, setSwitchBlock] = useState("");
  // Unresolved financial evidence (read-only peek; never deleted here).
  const checkoutScope = user?.companyId ? `${user.id}:${user.companyId}` : null;
  const pending = readPendingPosAttempt(checkoutScope);
  const pendingId = pending && pending !== "unreadable" && pending.responsibility ? Number(pending.responsibility) : null;
  useEffect(() => { if (access) refreshSelectedFromAccess(access); }, [access]);

  const choose = (grantId: number) => {
    if (!access) return;
    // While an unknown sale exists, only its original responsibility may be selected.
    if (pending === "unreadable" || (pending && pendingId !== grantId)) {
      setSwitchBlock(pending === "unreadable"
        ? "توجد محاولة بيع محفوظة تعذرت قراءتها. لا يمكن تبديل المسؤولية قبل مراجعتها؛ افتح نقطة البيع بالمسؤولية الأصلية أو تواصل مع المالك."
        : "لديك عملية بيع غير مؤكدة في مسؤولية أخرى. استرجع نتيجتها أولًا قبل تبديل المسؤولية أو الفرع.");
      return;
    }
    setSwitchBlock("");
    selectResponsibility(qc, selectionFromAccess(access, grantId));
  };
  const recoverPending = () => {
    if (!access || !pendingId) return;
    const snap = selectionFromAccess(access, pendingId);
    if (!snap) { setSwitchBlock("المسؤولية الأصلية لهذه العملية لم تعد متاحة لك. تواصل مع المالك لمراجعة نتيجة البيع؛ الدليل محفوظ على هذا الجهاز."); return; }
    selectResponsibility(qc, snap);
    setLocation("/pos");
  };
  const active = access?.status === "active";

  // If the selected responsibility disappeared or stopped being usable, drop it.
  useEffect(() => {
    if (!selected || !access) return;
    const g = grants.find((x) => x.id === selected.id);
    if (!active || !g || grantWindowState(g) !== "active") selectResponsibility(qc, null);
  }, [selected, access, grants, active, qc]);

  const branchName = (id: number) => {
    const b = branches?.find((x) => x.id === id);
    return b ? b.nameAr || b.name : `فرع #${id}`;
  };

  if (accessQ.isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4" data-testid="state-my-work-loading">
        <Skeleton className="h-24 rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-2"><Skeleton className="h-32 rounded-2xl" /><Skeleton className="h-32 rounded-2xl" /></div>
      </div>
    );
  }
  if (accessQ.error || !access) {
    return (
      <div className="mx-auto mt-12 max-w-md rounded-2xl border border-destructive/40 bg-card p-6 text-center" role="alert" data-testid="state-my-work-error">
        <AlertTriangle className="mx-auto mb-2 size-7 text-destructive" />
        <p className="font-bold">تعذر تحميل مسؤولياتك</p>
        <p className="mt-1 text-sm text-muted-foreground">{errorText(accessQ.error)}</p>
        <Button className="mt-4" variant="outline" onClick={() => void accessQ.refetch()} data-testid="button-retry-access"><RefreshCw className="me-2 size-4" /> إعادة المحاولة</Button>
      </div>
    );
  }

  const st = statusMeta(access.status);
  const selectedGrant = selected ? grants.find((g) => g.id === selected.id) ?? null : null;

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-12" dir="rtl">
      <section className="rounded-2xl border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-primary">عملي</p>
            <h1 className="mt-1 text-2xl font-bold">أهلًا {user?.name?.split(" ")[0] ?? ""}</h1>
            <p className="mt-1 text-sm text-muted-foreground">اختر مسؤولية للبدء. ترى فقط ما يخص فرعك ومستودعاتك المحددة.</p>
          </div>
          <div className="text-end text-xs text-muted-foreground">
            <span className="inline-block rounded-full border px-2 py-0.5 font-medium text-foreground" data-testid="status-workspace">{st.label}</span>
            {access.revision != null && <div className="mt-1">مراجعة الصلاحيات {access.revision} · تتحدّث تلقائيًا</div>}
          </div>
        </div>
      </section>

      {pending && (
        <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="banner-pending-checkout">
          <p className="font-bold">عملية بيع غير مؤكدة بانتظار الاسترجاع</p>
          <p className="mt-1">قد تكون حُفظت بالفعل. لا تعاود التحصيل. تبديل المسؤولية مقفل حتى تُسترجع النتيجة من نقطة البيع الأصلية.</p>
          {pendingId ? <Button size="sm" className="mt-3" onClick={recoverPending} data-testid="button-recover-pending">العودة إلى نقطة البيع الأصلية</Button>
            : pending === "unreadable" ? <p className="mt-2 text-xs">تعذرت قراءة المحاولة المحفوظة؛ لا تحذف بيانات المتصفح وتواصل مع المالك.</p> : null}
        </div>
      )}
      {switchBlock && <p role="alert" className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm" data-testid="error-switch-blocked">{switchBlock}</p>}
      {!active ? (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="state-workspace-blocked">
          <div className="flex gap-3">
            <Lock className="size-5 shrink-0" />
            <div>
              <p className="font-bold">{access.status === "suspended" ? "أوقف المالك وصولك مؤقتًا" : access.status === "device_setup_required" ? "يلزم جهاز مسجّل قبل استخدام نقطة البيع" : "وصولك غير مفعّل حاليًا"}</p>
              <p className="mt-1 text-sm">تواصل مع مالك المنشأة. لا يمكن العمل على أي مسؤولية حتى يتغير ذلك.</p>
            </div>
          </div>
        </div>
      ) : grants.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card p-10 text-center" data-testid="state-no-responsibilities">
          <Package className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="font-bold">لا مسؤوليات مسندة إليك بعد</p>
          <p className="mt-1 text-sm text-muted-foreground">عندما يضيف المالك مسؤولية ستظهر هنا خلال لحظات.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="المسؤوليات">
          {grants.map((g) => (
            <GrantTile key={g.id} grant={g} branch={branchName(g.branchId)} selected={selected?.id === g.id} denied={access.deniedActions}
              onSelect={() => choose(g.id)} />
          ))}
        </div>
      )}

      {active && selectedGrant && selectedGrant.resource === "inventory" && <InventoryView grantId={selectedGrant.id} branch={branchName(selectedGrant.branchId)} />}
      {active && selectedGrant && selectedGrant.resource === "pos" && (
        <section className="flex flex-col items-start gap-3 rounded-2xl border bg-card p-6 sm:flex-row sm:items-center" data-testid="panel-pos-responsibility">
          <ShoppingCart className="size-8 text-primary" />
          <div className="flex-1">
            <p className="font-bold">نقطة بيع {branchName(selectedGrant.branchId)}</p>
            <p className="text-sm text-muted-foreground">
              {posResponsibilitySummary(selectedGrant.actions, access.deniedActions)}
              {selectedGrant.amountLimit ? ` · سقف المسؤولية ${selectedGrant.amountLimit} ر.س للعملية` : ""}
            </p>
          </div>
          <Link href="/pos" className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground" data-testid="link-open-pos">فتح نقطة البيع</Link>
        </section>
      )}
    </div>
  );
}

function GrantTile({ grant, branch, selected, denied, onSelect }: { grant: TeamGrant; branch: string; selected: boolean; denied: string[]; onSelect: () => void }) {
  const win = grantWindowState(grant);
  const usable = win === "active";
  const Icon = grant.resource === "pos" ? ShoppingCart : Package;
  const actions = grant.actions.filter((a) => !denied.includes(a));
  return (
    <button type="button" role="radio" aria-checked={selected} disabled={!usable} onClick={onSelect} data-testid={`card-responsibility-${grant.id}`}
      className={cn("rounded-2xl border bg-card p-5 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        selected ? "border-primary ring-2 ring-primary/20" : "hover:border-primary/40")}>
      <div className="flex items-center gap-3">
        <span className={cn("grid size-10 place-items-center rounded-xl", selected ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}><Icon className="size-5" /></span>
        <div className="flex-1">
          <p className="font-bold">{RESOURCE_LABEL[grant.resource] ?? grant.resource}</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground"><Building2 className="size-3" /> {branch} · {grant.warehouseIds.length} مستودع</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {actions.map((a) => <span key={a} className="rounded-md bg-muted px-2 py-0.5 text-[11px]">{actionLabel(a)}</span>)}
      </div>
      {(grant.startsAt || grant.endsAt || !usable) && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
          <CalendarClock className="size-3" />
          {win === "upcoming" ? "تبدأ " : win === "expired" ? "انتهت " : ""}
          {grant.startsAt && `من ${new Date(grant.startsAt).toLocaleDateString("ar-SA")} `}
          {grant.endsAt && `حتى ${new Date(grant.endsAt).toLocaleDateString("ar-SA")}`}
        </p>
      )}
    </button>
  );
}

function InventoryView({ grantId, branch }: { grantId: number; branch: string }) {
  const [q, setQ] = useState("");
  const invQ = useGetWorkspaceInventory({ query: { queryKey: [...getGetWorkspaceInventoryQueryKey(), grantId] } });
  const rows = useMemo(() => {
    const all = invQ.data ?? [];
    const s = q.trim();
    return s ? all.filter((r) => r.productName.includes(s) || r.warehouseName.includes(s)) : all;
  }, [invQ.data, q]);
  const showCost = (invQ.data ?? []).some((r) => r.cost != null);

  return (
    <section className="rounded-2xl border bg-card" data-testid="panel-inventory">
      <div className="flex flex-wrap items-center gap-3 border-b p-4">
        <div className="flex-1">
          <h2 className="font-bold">مخزون {branch}</h2>
          <Link href="/inventory/stocktake" className="text-sm text-primary underline">عدّ جلسات الجرد القائمة</Link>
          <p className="text-xs text-muted-foreground">الرصيد ضمن مستودعات مسؤوليتك؛ التنفيذ يحتاج منحة مستقلة لكل فعل.</p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث عن صنف" className="ps-9" data-testid="input-inventory-search" />
        </div>
      </div>
      {invQ.isLoading ? (
        <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}</div>
      ) : invQ.error ? (
        <div className="p-6 text-center" role="alert" data-testid="state-inventory-error">
          <p className="text-sm">{errorText(invQ.error)}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => void invQ.refetch()} data-testid="button-retry-inventory">إعادة المحاولة</Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground" data-testid="state-inventory-empty">{q ? "لا نتائج مطابقة." : "لا أصناف في هذه المستودعات."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="p-3 text-start font-medium">الصنف</th>
                <th className="p-3 text-start font-medium">المستودع</th>
                <th className="p-3 text-end font-medium">الكمية</th>
                {showCost && <th className="p-3 text-end font-medium">التكلفة</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={`${r.productId}-${r.warehouseId}`} data-testid={`row-stock-${r.productId}-${r.warehouseId}`}>
                  <td className="p-3 font-medium">{r.productName}</td>
                  <td className="p-3 text-muted-foreground">{r.warehouseName}</td>
                  <td className={cn("p-3 text-end tabular-nums", Number(r.quantity) <= 0 && "text-destructive")}>{fmtQty(r.quantity)}</td>
                  {showCost && <td className="p-3 text-end tabular-nums">{r.cost ?? "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <InventoryTransferReceipts key={grantId} grantId={grantId}/>
    </section>
  );
}
