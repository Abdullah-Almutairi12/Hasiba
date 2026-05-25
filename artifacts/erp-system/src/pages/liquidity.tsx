import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Check,
  ChevronsUpDown,
  Droplets,
  Loader2,
  Search,
  Store,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Money } from "@/components/riyal";

type ForecastPoint = { date: string; projectedBalance: number; projectedNet: number };
type Warning = {
  code: string;
  severity: "info" | "warning" | "critical";
  message: string;
  dayOffset?: number;
  projectedBalance?: number;
};

interface CorporateSnapshot {
  currency: "SAR";
  cashOnHand: number;
  pendingPayables: number;
  intercompanyOpenNet: number;
  netPosition: number;
  averageDailyNet: number;
  forecast: ForecastPoint[];
  warnings: Warning[];
}

interface RetailBranch {
  branchId: number;
  branchName: string;
  cashOnHand: number;
  pendingPayables: number;
  netPosition: number;
  openSessions: number;
}

interface RetailSnapshot {
  currency: "SAR";
  totalCashOnHand: number;
  totalPendingPayables: number;
  netPosition: number;
  branches: RetailBranch[];
}

type Mode = "corporate" | "retail";
const MODE_STORAGE_KEY = "hasba.liquidity.mode";
const ALL_BRANCHES_VALUE = "__all__";

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

function severityBadgeVariant(s: Warning["severity"]) {
  if (s === "critical") return "destructive" as const;
  if (s === "warning") return "default" as const;
  return "secondary" as const;
}

// =================== Hero Net Position ===================

type Tone = "positive" | "warning" | "critical";

function classifyTone(
  netPosition: number,
  cashOnHand: number,
  pendingPayables: number,
): Tone {
  if (netPosition < 0) return "critical";
  // "Under pressure": cash can't cover at least half of payables.
  if (pendingPayables > 0 && cashOnHand < pendingPayables * 0.5) return "warning";
  return "positive";
}

function statusPillLabel(tone: Tone): string {
  if (tone === "critical") return "عجز";
  if (tone === "warning") return "تحت الضغط";
  return "متوازن";
}

function NetPositionHero({
  title,
  subtitle,
  cashOnHand,
  pendingPayables,
  netPosition,
  openSessions,
}: {
  title: string;
  subtitle?: string;
  cashOnHand: number;
  pendingPayables: number;
  netPosition: number;
  openSessions?: number;
}) {
  const tone = classifyTone(netPosition, cashOnHand, pendingPayables);
  // Headline number is strictly binary by sign — green when Net Position
  // is ≥ 0, red when < 0 — so the "unmistakable headline" requirement
  // doesn't get diluted by the 3-state pressure pill below it.
  const isNegative = netPosition < 0;
  const ring = isNegative
    ? "ring-2 ring-rose-500/40 bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/40 dark:to-background"
    : "ring-2 ring-emerald-500/40 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-background";
  const numberTone = isNegative
    ? "text-rose-600 dark:text-rose-400"
    : "text-emerald-600 dark:text-emerald-400";
  const pillTone =
    tone === "critical"
      ? "bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
      : tone === "warning"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"
        : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300";

  return (
    <Card className={ring} data-testid="card-net-position-hero">
      <CardContent className="p-5 sm:p-8">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-muted-foreground sm:text-base">{title}</p>
            {subtitle ? (
              <p className="mt-0.5 text-xs text-muted-foreground/80">{subtitle}</p>
            ) : null}
          </div>
          {typeof openSessions === "number" ? (
            <Badge variant={openSessions > 0 ? "default" : "secondary"} className="shrink-0">
              {openSessions > 0 ? `${openSessions} جلسة مفتوحة` : "مغلق"}
            </Badge>
          ) : null}
        </div>

        <div className="mt-3 flex items-baseline gap-2 sm:mt-4">
          <span
            className={cn(
              "text-5xl font-extrabold leading-none tabular-nums sm:text-7xl",
              numberTone,
            )}
            data-testid="text-net-position"
          >
            <Money value={netPosition} fractionDigits={0} />
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold sm:text-sm",
              pillTone,
            )}
            data-testid="badge-status-pill"
          >
            {statusPillLabel(tone)}
          </span>
          <span className="text-xs uppercase tracking-wide text-muted-foreground sm:text-sm">
            صافي الموقف (النقد − المستحقات)
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border/60 pt-4 sm:mt-6 sm:gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
              <ArrowUpRight className="size-3.5 text-emerald-500" />
              النقد المتاح
            </div>
            <div className="text-lg font-semibold text-emerald-600 tabular-nums dark:text-emerald-400 sm:text-2xl">
              <Money value={cashOnHand} fractionDigits={0} />
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
              <ArrowDownRight className="size-3.5 text-rose-500" />
              المستحقات
            </div>
            <div className="text-lg font-semibold text-rose-600 tabular-nums dark:text-rose-400 sm:text-2xl">
              <Money value={pendingPayables} fractionDigits={0} />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// =================== Secondary stat card ===================

function StatCard({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "default" | "positive" | "negative";
}) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "negative"
        ? "text-rose-600 dark:text-rose-400"
        : "text-foreground";
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${toneClass}`}>
          <Money value={value} />
        </div>
      </CardContent>
    </Card>
  );
}

// =================== Mode toggle ===================

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  const items: Array<{ value: Mode; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { value: "retail", label: "وضع المتجر", icon: Store },
    { value: "corporate", label: "وضع الشركة", icon: Building2 },
  ];
  return (
    <div
      role="tablist"
      aria-label="تبديل وضع السيولة"
      className="inline-flex w-full max-w-md items-center gap-1 rounded-full border border-border bg-muted/40 p-1 shadow-sm sm:w-auto"
      data-testid="toggle-liquidity-mode"
    >
      {items.map((it) => {
        const active = mode === it.value;
        const Icon = it.icon;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors sm:flex-initial sm:px-5",
              active
                ? it.value === "retail"
                  ? "bg-emerald-600 text-white shadow"
                  : "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground",
            )}
            data-testid={`tab-${it.value}`}
          >
            <Icon className="size-4" />
            <span>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// =================== Branch picker ===================

function BranchPicker({
  branches,
  value,
  onChange,
  totalCashOnHand,
  totalPendingPayables,
  totalNetPosition,
}: {
  branches: RetailBranch[];
  value: string;
  onChange: (v: string) => void;
  totalCashOnHand: number;
  totalPendingPayables: number;
  totalNetPosition: number;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return branches;
    return branches.filter((b) => b.branchName.toLowerCase().includes(q));
  }, [branches, query]);

  const active =
    value === ALL_BRANCHES_VALUE
      ? null
      : branches.find((b) => String(b.branchId) === value) ?? null;

  const triggerLabel = active ? active.branchName : "كل الفروع";
  const triggerSubtitle = active
    ? active.openSessions > 0
      ? `${active.openSessions} جلسة مفتوحة`
      : "مغلق"
    : `${branches.length} فرع · الإجمالي`;

  const trigger = (
    <button
      type="button"
      className="flex h-14 w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 text-start shadow-sm transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="select-branch"
      onClick={() => setOpen(true)}
    >
      <span className="flex min-w-0 items-center gap-3">
        <Store className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-base font-semibold">
            {triggerLabel}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {triggerSubtitle}
          </span>
        </span>
      </span>
      <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );

  const rows = (
    <>
      <button
        type="button"
        onClick={() => {
          onChange(ALL_BRANCHES_VALUE);
          setOpen(false);
        }}
        className={cn(
          "flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 px-4 py-3 text-start transition-colors hover:bg-accent/40",
          value === ALL_BRANCHES_VALUE && "ring-2 ring-emerald-500/50",
        )}
        data-testid="option-branch-all"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold">
            كل الفروع (الإجمالي)
            {value === ALL_BRANCHES_VALUE ? (
              <Check className="size-4 text-emerald-600" />
            ) : null}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {branches.length} فرع نشط
          </div>
        </div>
        <div className="shrink-0 text-end">
          <div
            className={cn(
              "text-base font-bold tabular-nums",
              totalNetPosition >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400",
            )}
          >
            <Money value={totalNetPosition} fractionDigits={0} />
          </div>
          <div className="text-[10px] text-muted-foreground">
            نقد <Money value={totalCashOnHand} fractionDigits={0} />
          </div>
        </div>
      </button>
      {filtered.map((b) => {
        const selected = String(b.branchId) === value;
        return (
          <button
            key={b.branchId}
            type="button"
            onClick={() => {
              onChange(String(b.branchId));
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-center justify-between gap-3 rounded-lg border border-border/60 px-4 py-3 text-start transition-colors hover:bg-accent/40",
              selected && "ring-2 ring-emerald-500/50",
            )}
            data-testid={`option-branch-${b.branchId}`}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="truncate">{b.branchName}</span>
                {selected ? <Check className="size-4 text-emerald-600" /> : null}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <Badge
                  variant={b.openSessions > 0 ? "default" : "secondary"}
                  className="h-4 px-1.5 text-[10px]"
                >
                  {b.openSessions > 0 ? `${b.openSessions} مفتوح` : "مغلق"}
                </Badge>
              </div>
            </div>
            <div className="shrink-0 text-end">
              <div
                className={cn(
                  "text-base font-bold tabular-nums",
                  b.netPosition >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-600 dark:text-rose-400",
                )}
              >
                <Money value={b.netPosition} fractionDigits={0} />
              </div>
              <div className="text-[10px] text-muted-foreground">
                نقد <Money value={b.cashOnHand} fractionDigits={0} />
              </div>
            </div>
          </button>
        );
      })}
      {filtered.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          لا توجد نتائج مطابقة.
        </div>
      ) : null}
    </>
  );

  const searchBox = (
    <div className="relative">
      <Search className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="ابحث عن فرع…"
        className="h-11 pe-9"
        data-testid="input-branch-search"
      />
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] rounded-t-2xl p-0"
        >
          <SheetHeader className="border-b border-border/60 p-4 text-start">
            <SheetTitle>اختر الفرع</SheetTitle>
          </SheetHeader>
          <div className="space-y-3 p-4">
            {searchBox}
            <div className="space-y-2 overflow-y-auto" style={{ maxHeight: "55vh" }}>
              {rows}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[min(420px,calc(100vw-2rem))] p-0"
      >
        <div className="space-y-3 p-3">
          {searchBox}
          <div className="space-y-2 overflow-y-auto" style={{ maxHeight: "60vh" }}>
            {rows}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// =================== Corporate Mode ===================

function CorporateMode() {
  const { data, isLoading, error } = useQuery<CorporateSnapshot>({
    queryKey: ["/api/liquidity/corporate"],
    queryFn: () => fetchJson<CorporateSnapshot>("/api/liquidity/corporate"),
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        تعذر تحميل بيانات السيولة.
      </div>
    );
  }

  const chartData = [
    { date: "اليوم", projectedBalance: data.cashOnHand, projectedNet: 0 },
    ...data.forecast.map((p) => ({
      date: p.date.slice(5),
      projectedBalance: p.projectedBalance,
      projectedNet: p.projectedNet,
    })),
  ];

  return (
    <div className="space-y-6">
      <NetPositionHero
        title="موقف الشركة"
        subtitle="النقد + بين الشركات − المستحقات"
        cashOnHand={data.cashOnHand}
        pendingPayables={data.pendingPayables}
        netPosition={data.netPosition}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="صافي المعاملات بين الشركات"
          value={data.intercompanyOpenNet}
          icon={Building2}
          tone={data.intercompanyOpenNet >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="متوسط الحركة اليومية"
          value={data.averageDailyNet}
          icon={Droplets}
          tone={data.averageDailyNet >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="المستحقات المعلقة"
          value={data.pendingPayables}
          icon={TrendingDown}
          tone="negative"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>توقع التدفق النقدي خلال 45 يومًا</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full" data-testid="chart-cash-forecast">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="liquidityFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    fontSize: 12,
                  }}
                  formatter={(v: number) => v.toLocaleString("ar-SA")}
                />
                <ReferenceLine y={0} stroke="hsl(var(--destructive))" strokeDasharray="4 4" />
                <Area
                  type="monotone"
                  dataKey="projectedBalance"
                  stroke="hsl(var(--primary))"
                  fill="url(#liquidityFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4" />
            تحذيرات تنبؤية
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.warnings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              لا تحذيرات. التدفق النقدي المتوقع مستقر خلال 45 يومًا القادمة.
            </p>
          ) : (
            <ul className="space-y-3" data-testid="list-warnings">
              {data.warnings.map((w) => (
                <li
                  key={w.code}
                  className="flex items-start justify-between gap-4 rounded-md border border-border bg-card p-3"
                >
                  <div className="space-y-1">
                    <Badge variant={severityBadgeVariant(w.severity)}>
                      {w.severity === "critical"
                        ? "حرج"
                        : w.severity === "warning"
                          ? "تحذير"
                          : "معلومة"}
                    </Badge>
                    <p className="text-sm">{w.message}</p>
                  </div>
                  {typeof w.projectedBalance === "number" && (
                    <div className="text-end text-xs text-muted-foreground">
                      الرصيد المتوقع: <Money value={w.projectedBalance} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// =================== Retail Mode ===================

function RetailMode() {
  const { data, isLoading, error } = useQuery<RetailSnapshot>({
    queryKey: ["/api/liquidity/retail"],
    queryFn: () => fetchJson<RetailSnapshot>("/api/liquidity/retail"),
  });
  const [selected, setSelected] = useState<string>(ALL_BRANCHES_VALUE);

  // Auto-select the only branch a single-store manager can see, so they
  // land directly on their numbers instead of the all-branches rollup.
  useEffect(() => {
    if (data && selected === ALL_BRANCHES_VALUE && data.branches.length === 1) {
      setSelected(String(data.branches[0].branchId));
    }
  }, [data, selected]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        تعذر تحميل بيانات الفروع.
      </div>
    );
  }

  const activeBranch =
    selected === ALL_BRANCHES_VALUE
      ? null
      : data.branches.find((b) => String(b.branchId) === selected) ?? null;

  const heroProps =
    activeBranch === null
      ? {
          title: "كل الفروع",
          subtitle: `${data.branches.length} فرع نشط`,
          cashOnHand: data.totalCashOnHand,
          pendingPayables: data.totalPendingPayables,
          netPosition: data.netPosition,
        }
      : {
          title: activeBranch.branchName,
          subtitle: undefined,
          cashOnHand: activeBranch.cashOnHand,
          pendingPayables: activeBranch.pendingPayables,
          netPosition: activeBranch.netPosition,
          openSessions: activeBranch.openSessions,
        };

  return (
    <div className="space-y-5">
      {/* Sticky on mobile so the manager can change branch without scrolling
          back to the top. Desktop keeps it inline. */}
      <div className="sticky top-16 z-10 -mx-3 bg-background/95 px-3 pb-2 pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/70 sm:static sm:mx-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <BranchPicker
          branches={data.branches}
          value={selected}
          onChange={setSelected}
          totalCashOnHand={data.totalCashOnHand}
          totalPendingPayables={data.totalPendingPayables}
          totalNetPosition={data.netPosition}
        />
      </div>

      {data.branches.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            لا توجد فروع نشطة.
          </CardContent>
        </Card>
      ) : (
        <>
          <NetPositionHero {...heroProps} />

          {/* Secondary KPIs: full-width mobile, 2-up tablet, 3-up desktop. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              label="النقد المتاح"
              value={heroProps.cashOnHand}
              icon={Wallet}
              tone={heroProps.cashOnHand >= 0 ? "positive" : "negative"}
            />
            <StatCard
              label="المستحقات (الحصة)"
              value={heroProps.pendingPayables}
              icon={TrendingDown}
              tone="negative"
            />
            {activeBranch === null ? (
              <StatCard
                label="عدد الفروع النشطة"
                value={data.branches.length}
                icon={Store}
                tone="default"
              />
            ) : (
              <StatCard
                label="الجلسات المفتوحة"
                value={activeBranch.openSessions}
                icon={Store}
                tone={activeBranch.openSessions > 0 ? "positive" : "default"}
              />
            )}
          </div>

          {/* Per-branch grid (always shown so a manager can compare). Each
              card is a tap target ≥44px tall, filters the hero on tap. */}
          {data.branches.length > 1 ? (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">
                الفروع
              </h2>
              <div
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                data-testid="list-branches"
              >
                {data.branches.map((b) => {
                  const positive = b.netPosition >= 0;
                  const isActive = String(b.branchId) === selected;
                  return (
                    <button
                      key={b.branchId}
                      type="button"
                      onClick={() => setSelected(String(b.branchId))}
                      className={cn(
                        "min-h-[88px] rounded-lg border border-border bg-card p-4 text-start transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isActive && "ring-2 ring-emerald-500/60 bg-emerald-50/40 dark:bg-emerald-950/20",
                      )}
                      data-testid={`card-branch-${b.branchId}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{b.branchName}</span>
                        <Badge
                          variant={b.openSessions > 0 ? "default" : "secondary"}
                          className="shrink-0 text-[10px]"
                        >
                          {b.openSessions > 0 ? "مفتوح" : "مغلق"}
                        </Badge>
                      </div>
                      <div
                        className={cn(
                          "mt-2 text-2xl font-bold tabular-nums",
                          positive
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400",
                        )}
                      >
                        <Money value={b.netPosition} fractionDigits={0} />
                      </div>
                      <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                        <span>
                          نقد: <Money value={b.cashOnHand} fractionDigits={0} />
                        </span>
                        <span>
                          مستحقات: <Money value={b.pendingPayables} fractionDigits={0} />
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// =================== Page ===================

function readInitialMode(): Mode {
  if (typeof window === "undefined") return "retail";
  const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
  if (stored === "corporate" || stored === "retail") return stored;
  return "retail";
}

export default function LiquidityPage() {
  const [mode, setMode] = useState<Mode>(() => readInitialMode());

  useEffect(() => {
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch {
      // ignore storage failures (private mode, quota, etc.)
    }
  }, [mode]);

  const isRetail = mode === "retail";
  const chipTone = isRetail
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
    : "bg-primary/10 text-primary";
  const ChipIcon = isRetail ? Store : Building2;
  const chipLabel = isRetail ? "وضع المتجر" : "وضع الشركة";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">السيولة والتدفق النقدي</h1>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                chipTone,
              )}
              data-testid="badge-active-mode"
            >
              <ChipIcon className="size-3.5" />
              {chipLabel}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {isRetail
              ? "موقف السيولة الفوري لكل فرع — مصمّم لمدراء المتاجر على الهاتف."
              : "عرض موحّد على مستوى الشركة مع توقعات تدفق نقدي لمدة 45 يومًا."}
          </p>
        </div>

        <ModeToggle mode={mode} onChange={setMode} />
      </div>

      {isRetail ? <RetailMode /> : <CorporateMode />}
    </div>
  );
}
