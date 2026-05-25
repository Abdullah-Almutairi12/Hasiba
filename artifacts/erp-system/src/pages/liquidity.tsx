import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
import { AlertTriangle, Building2, Droplets, Loader2, TrendingDown, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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

function RetailMode() {
  const { data, isLoading, error } = useQuery<RetailSnapshot>({
    queryKey: ["/api/liquidity/retail"],
    queryFn: () => fetchJson<RetailSnapshot>("/api/liquidity/retail"),
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
        تعذر تحميل بيانات الفروع.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="إجمالي النقد في الفروع"
          value={data.totalCashOnHand}
          icon={Wallet}
          tone="positive"
        />
        <StatCard
          label="إجمالي المستحقات"
          value={data.totalPendingPayables}
          icon={TrendingDown}
          tone="negative"
        />
        <StatCard
          label="صافي الموقف"
          value={data.netPosition}
          icon={Droplets}
          tone={data.netPosition >= 0 ? "positive" : "negative"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="list-branches">
        {data.branches.length === 0 ? (
          <Card className="md:col-span-2 lg:col-span-3">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              لا توجد فروع نشطة.
            </CardContent>
          </Card>
        ) : (
          data.branches.map((b) => (
            <Card key={b.branchId} data-testid={`card-branch-${b.branchId}`}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">{b.branchName}</CardTitle>
                <Badge variant={b.openSessions > 0 ? "default" : "secondary"}>
                  {b.openSessions > 0 ? `${b.openSessions} جلسة مفتوحة` : "مغلق"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">النقد المتاح</span>
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    <Money value={b.cashOnHand} />
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">حصة الفرع من المستحقات</span>
                  <span className="font-medium text-rose-600 dark:text-rose-400">
                    <Money value={b.pendingPayables} />
                  </span>
                </div>
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">صافي الموقف</span>
                    <span
                      className={`text-lg font-bold ${
                        b.netPosition >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      <Money value={b.netPosition} />
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
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
            وضع الفروع (Retail)
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
