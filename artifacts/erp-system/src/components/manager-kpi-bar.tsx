import {
  useGetManagerKpiBar,
  getGetManagerKpiBarQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import {
  TrendingUp,
  TrendingDown,
  FileWarning,
  PackageX,
  Bell,
  Activity,
  ShoppingCart,
} from "lucide-react";

/** Roles allowed to see the sticky KPI bar. Mirrors server adminGuard. */
const ALLOWED_ROLES = new Set(["owner", "manager"]);

function formatSAR(n: number): string {
  return new Intl.NumberFormat("ar-SA", {
    style: "currency",
    currency: "SAR",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("ar-SA").format(n);
}

function healthTone(score: number): { text: string; bg: string; label: string } {
  if (score >= 75) return { text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10", label: "ممتاز" };
  if (score >= 50) return { text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10", label: "جيد" };
  return { text: "text-red-600 dark:text-red-400", bg: "bg-red-500/10", label: "يحتاج انتباه" };
}

type KpiCellProps = {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: React.ReactNode;
  href: string;
  tone?: "default" | "warn" | "danger";
};

function KpiCell({ icon, label, value, hint, href, tone = "default" }: KpiCellProps) {
  const toneClass =
    tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  return (
    <Link
      href={href}
      className="group flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60 sm:gap-3 sm:px-3"
      data-testid={`kpi-cell-${label}`}
    >
      <div className="shrink-0 text-muted-foreground group-hover:text-foreground">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[10px] text-muted-foreground sm:text-xs">{label}</div>
        <div className={`truncate text-sm font-semibold leading-tight sm:text-base ${toneClass}`}>
          {value}
        </div>
        {hint && <div className="truncate text-[10px] text-muted-foreground">{hint}</div>}
      </div>
    </Link>
  );
}

/**
 * Sticky KPI bar shown directly below the top header for owners/managers.
 * Refreshes every 60s. Silently hidden for other roles or while loading first time.
 */
export function ManagerKpiBar() {
  const { user } = useAuth();
  const enabled = !!user?.role && ALLOWED_ROLES.has(user.role);

  const { data, isLoading, isError } = useGetManagerKpiBar({
    query: {
      queryKey: getGetManagerKpiBarQueryKey(),
      enabled,
      refetchInterval: 60_000,
      staleTime: 30_000,
    },
  });

  if (!enabled) return null;
  if (isLoading || isError || !data) return null;

  const tone = healthTone(data.healthScore);
  const salesUp = data.salesChange >= 0;

  return (
    <div
      className="sticky top-16 z-[9] flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-border/50 bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:gap-2 sm:px-4"
      data-testid="manager-kpi-bar"
    >
      <KpiCell
        icon={<ShoppingCart className="h-4 w-4" />}
        label="مبيعات اليوم"
        value={formatSAR(data.salesToday)}
        hint={
          <span className={`inline-flex items-center gap-0.5 ${salesUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {salesUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {Math.abs(data.salesChange)}٪ • {formatNumber(data.ordersToday)} طلب
          </span>
        }
        href="/"
      />

      <div className="hidden h-8 w-px bg-border/60 sm:block" />

      <KpiCell
        icon={<FileWarning className="h-4 w-4" />}
        label="فواتير معلقة"
        value={formatNumber(data.pendingInvoicesCount)}
        hint={data.pendingInvoicesCount > 0 ? formatSAR(data.pendingInvoicesAmount) : "لا توجد"}
        href="/invoices"
        tone={data.pendingInvoicesCount > 0 ? "warn" : "default"}
      />

      <div className="hidden h-8 w-px bg-border/60 sm:block" />

      <KpiCell
        icon={<PackageX className="h-4 w-4" />}
        label="منخفض المخزون"
        value={formatNumber(data.lowStockCount)}
        href="/products"
        tone={data.lowStockCount > 0 ? "danger" : "default"}
      />

      <div className="hidden h-8 w-px bg-border/60 sm:block" />

      <KpiCell
        icon={<Bell className="h-4 w-4" />}
        label="تنبيهات"
        value={formatNumber(data.unreadAlertsCount)}
        href="/"
        tone={data.unreadAlertsCount > 0 ? "warn" : "default"}
      />

      <div className="hidden h-8 w-px bg-border/60 sm:block" />

      <Link
        href="/"
        className={`shrink-0 inline-flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:opacity-90 sm:px-3 ${tone.bg}`}
        data-testid="kpi-health-score"
      >
        <Activity className={`h-4 w-4 ${tone.text}`} />
        <div className="leading-tight">
          <div className="text-[10px] text-muted-foreground sm:text-xs">صحة العمل</div>
          <div className={`text-sm font-bold sm:text-base ${tone.text}`}>
            {data.healthScore}/100 · {tone.label}
          </div>
        </div>
      </Link>
    </div>
  );
}
