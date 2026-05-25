import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
  Droplets,
  Loader2,
  Store,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

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

function severityBadgeVariant(s: Warning["severity"]) {
  if (s === "critical") return "destructive" as const;
  if (s === "warning") return "default" as const;
  return "secondary" as const;
}

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
      date: p.date.slice(5), // MM-DD
      projectedBalance: p.projectedBalance,
      projectedNet: p.projectedNet,
    })),
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="النقد المتاح"
          value={data.cashOnHand}
          icon={Wallet}
          tone={data.cashOnHand >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="المستحقات المعلقة"
          value={data.pendingPayables}
          icon={TrendingDown}
          tone="negative"
        />
        <StatCard
          label="صافي المعاملات بين الشركات"
          value={data.intercompanyOpenNet}
          icon={Building2}
          tone={data.intercompanyOpenNet >= 0 ? "positive" : "negative"}
        />
        <StatCard
          label="صافي الموقف"
          value={data.netPosition}
          icon={Droplets}
          tone={data.netPosition >= 0 ? "positive" : "negative"}
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
          <p className="mt-2 text-xs text-muted-foreground">
            متوسط الحركة اليومية: <Money value={data.averageDailyNet} />
          </p>
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

/**
 * Aggregated "all branches" view rendered as a synthetic RetailBranch
 * so the same hero card can render either a single branch or the
 * company-wide rollup without branching its JSX.
 */
const ALL_BRANCHES_VALUE = "__all__";

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
  const isPositive = netPosition >= 0;
  // "Critical" threshold for retail: negative OR cash can't cover even
  // half of the payable share. Drives the red hero treatment.
  const isCritical = netPosition < 0 || (pendingPayables > 0 && cashOnHand < pendingPayables * 0.5);
  const toneRing = isCritical
    ? "ring-2 ring-rose-500/40 bg-gradient-to-br from-rose-50 to-white dark:from-rose-950/40 dark:to-background"
    : isPositive
      ? "ring-2 ring-emerald-500/40 bg-gradient-to-br from-emerald-50 to-white dark:from-emerald-950/40 dark:to-background"
      : "ring-2 ring-amber-500/40 bg-gradient-to-br from-amber-50 to-white dark:from-amber-950/40 dark:to-background";
  const numberTone = isCritical
    ? "text-rose-600 dark:text-rose-400"
    : isPositive
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-amber-600 dark:text-amber-400";

  return (
    <Card className={toneRing} data-testid="card-net-position-hero">
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
            className={`text-4xl font-extrabold leading-none tabular-nums sm:text-6xl ${numberTone}`}
            data-testid="text-net-position"
          >
            <Money value={netPosition} fractionDigits={0} />
          </span>
        </div>
        <p className="mt-2 text-xs uppercase tracking-wide text-muted-foreground sm:text-sm">
          صافي الموقف (النقد − المستحقات)
        </p>

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

function RetailMode() {
  const { data, isLoading, error } = useQuery<RetailSnapshot>({
    queryKey: ["/api/liquidity/retail"],
    queryFn: () => fetchJson<RetailSnapshot>("/api/liquidity/retail"),
  });
  const [selected, setSelected] = useState<string>(ALL_BRANCHES_VALUE);

  // Default the selector to the first real branch as soon as data arrives,
  // so a store manager with a single branch lands directly on their numbers.
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
      {/* Native-feeling branch selector. Uses Radix Select which renders a
          full-screen picker on touch devices and a popover on desktop. */}
      <div className="flex items-center gap-2">
        <Store className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger
            className="h-12 flex-1 text-base font-medium sm:max-w-sm"
            data-testid="select-branch"
          >
            <SelectValue placeholder="اختر الفرع" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_BRANCHES_VALUE} data-testid="option-branch-all">
              كل الفروع (الإجمالي)
            </SelectItem>
            {data.branches.map((b) => (
              <SelectItem
                key={b.branchId}
                value={String(b.branchId)}
                data-testid={`option-branch-${b.branchId}`}
              >
                {b.branchName}
                {b.openSessions > 0 ? " • مفتوح" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {data.branches.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            لا توجد فروع نشطة.
          </CardContent>
        </Card>
      ) : (
        <NetPositionHero {...heroProps} />
      )}

      {/* Compact secondary list — only shown in "all branches" view so a
          store manager who picked their own branch isn't distracted by the
          rest of the company. Below `sm` it stacks to a single column so
          numbers stay readable without zoom. */}
      {selected === ALL_BRANCHES_VALUE && data.branches.length > 1 ? (
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          data-testid="list-branches"
        >
          {data.branches.map((b) => {
            const positive = b.netPosition >= 0;
            return (
              <button
                key={b.branchId}
                type="button"
                onClick={() => setSelected(String(b.branchId))}
                className="rounded-lg border border-border bg-card p-4 text-start transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  className={`mt-2 text-2xl font-bold tabular-nums ${
                    positive
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
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
      ) : null}
    </div>
  );
}

export default function LiquidityPage() {
  const [mode, setMode] = useState<"corporate" | "retail">("corporate");
  return (
    <div className="space-y-6 p-3 sm:p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">السيولة والتدفق النقدي</h1>
        <p className="text-sm text-muted-foreground">
          عرض موحّد لموقف السيولة على مستوى الشركة (مع توقعات 45 يومًا) أو موقف الفروع المبسّط للمدراء التشغيليين.
        </p>
      </div>

      <Tabs value={mode} onValueChange={(v) => setMode(v as "corporate" | "retail")}>
        <TabsList>
          <TabsTrigger value="corporate" data-testid="tab-corporate">
            وضع الشركة
          </TabsTrigger>
          <TabsTrigger value="retail" data-testid="tab-retail">
            وضع المتاجر
          </TabsTrigger>
        </TabsList>
        <TabsContent value="corporate" className="mt-6">
          <CorporateMode />
        </TabsContent>
        <TabsContent value="retail" className="mt-6">
          <RetailMode />
        </TabsContent>
      </Tabs>
    </div>
  );
}
