import React, { useMemo } from "react";
import { Money } from "@/components/riyal";
import { motion, type Variants } from "framer-motion";
import {
  useGetDashboardSummary,
  useGetDashboardSalesChart,
  useGetDashboardAlerts,
  useDismissDashboardAlert,
  getGetDashboardAlertsQueryKey,
  useGetBranchPerformance,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { 
  ArrowUpRight, 
  ArrowDownRight, 
  TrendingUp, 
  Wallet, 
  PackageSearch, 
  Activity,
  AlertCircle,
  Info,
  CheckCircle2,
  AlertTriangle,
  X
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 24 },
  },
};

function HealthScore({ score }: { score: number }) {
  const radius = 35;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  let color = "text-green-500";
  if (score < 70) color = "text-yellow-500";
  if (score < 50) color = "text-red-500";

  return (
    <div className="relative flex items-center justify-center">
      <svg className="h-24 w-24 -rotate-90 transform">
        <circle
          className="text-muted/20"
          strokeWidth="8"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx="48"
          cy="48"
        />
        <circle
          className={`${color} transition-all duration-1000 ease-in-out`}
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx="48"
          cy="48"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <span className="text-2xl font-bold">{score}</span>
        <span className="text-[10px] text-muted-foreground">%</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: salesChart, isLoading: isLoadingSales } = useGetDashboardSalesChart({ period: 'monthly' });
  const { data: alerts, isLoading: isLoadingAlerts } = useGetDashboardAlerts();
  const { data: branches, isLoading: isLoadingBranches } = useGetBranchPerformance();
  const queryClient = useQueryClient();
  const dismissAlert = useDismissDashboardAlert({
    mutation: {
      // Optimistically remove the row so finance gets instant feedback;
      // the next refetch reconciles against the server's truth.
      onMutate: async ({ data }) => {
        const queryKey = getGetDashboardAlertsQueryKey();
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData<typeof alerts>(queryKey);
        if (previous) {
          queryClient.setQueryData(
            queryKey,
            previous.filter((a) => a.key !== data.key),
          );
        }
        return { previous };
      },
      onError: (_err, _vars, ctx) => {
        const queryKey = getGetDashboardAlertsQueryKey();
        if (ctx && "previous" in ctx && ctx.previous) {
          queryClient.setQueryData(queryKey, ctx.previous);
        }
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getGetDashboardAlertsQueryKey() });
      },
    },
  });

  if (isLoadingSummary) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}
        </div>
        <Skeleton className="h-[400px] w-full rounded-xl" />
      </div>
    );
  }

  return (
    <motion.div 
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-6 pb-8"
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">لوحة القيادة التنفيذية</h1>
          <p className="text-muted-foreground">نظرة عامة على أداء أعمالك مع تحليلات الذكاء الاصطناعي</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="bg-white/5 border-white/10 backdrop-blur-sm">
            تصدير التقرير
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <motion.div variants={itemVariants}>
          <Card className="bg-card/40 backdrop-blur-xl border-white/10 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <TrendingUp className="size-12" />
            </div>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">إجمالي المبيعات</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold"><Money value={summary?.totalSalesToday} /></div>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <span className={summary?.totalSalesChange && summary.totalSalesChange > 0 ? "text-green-500" : "text-red-500"}>
                  {summary?.totalSalesChange && summary.totalSalesChange > 0 ? <ArrowUpRight className="size-3 inline" /> : <ArrowDownRight className="size-3 inline" />}
                  {Math.abs(summary?.totalSalesChange || 0)}%
                </span>
                مقارنة بالأمس
              </p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card className="bg-card/40 backdrop-blur-xl border-white/10 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Wallet className="size-12" />
            </div>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">إجمالي الربح</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-cyan-400"><Money value={summary?.totalProfit} /></div>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <span className={summary?.profitChange && summary.profitChange > 0 ? "text-green-500" : "text-red-500"}>
                  {summary?.profitChange && summary.profitChange > 0 ? <ArrowUpRight className="size-3 inline" /> : <ArrowDownRight className="size-3 inline" />}
                  {Math.abs(summary?.profitChange || 0)}%
                </span>
                هامش ربح {summary?.profitMargin}%
              </p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card className="bg-card/40 backdrop-blur-xl border-white/10 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <PackageSearch className="size-12" />
            </div>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">قيمة المخزون</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold"><Money value={summary?.inventoryValue} /></div>
              <p className="text-xs text-muted-foreground mt-1">
                <span className="text-orange-400">{summary?.lowStockCount} منتج</span> قارب على النفاذ
              </p>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div variants={itemVariants}>
          <Card className="bg-card/40 backdrop-blur-xl border-white/10 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
              <Activity className="size-12" />
            </div>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">صافي الربح</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-pink-400"><Money value={summary?.netProfit} /></div>
              <p className="text-xs text-muted-foreground mt-1">
                بعد خصم المصروفات والضرائب
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid gap-4 md:grid-cols-7 lg:grid-cols-8">
        {/* Main Chart */}
        <motion.div variants={itemVariants} className="md:col-span-4 lg:col-span-5">
          <Card className="bg-card/40 backdrop-blur-xl border-white/10 shadow-2xl h-full">
            <CardHeader>
              <CardTitle>المبيعات وتوقعات AI</CardTitle>
              <CardDescription>تحليل المبيعات الفعلية والتوقعات المستقبلية بناءً على النماذج الذكية</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                {isLoadingSales ? (
                  <Skeleton className="h-full w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={salesChart || []} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#00D4FF" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#00D4FF" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#7B61FF" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#7B61FF" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="label" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value / 1000}k`} />
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#333" />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1A1D2D', borderColor: '#333', borderRadius: '8px' }}
                        itemStyle={{ color: '#fff' }}
                      />
                      <Area type="monotone" dataKey="actual" stroke="#00D4FF" fillOpacity={1} fill="url(#colorActual)" name="المبيعات الفعلية" />
                      <Area type="monotone" dataKey="forecast" stroke="#7B61FF" strokeDasharray="5 5" fillOpacity={1} fill="url(#colorForecast)" name="توقعات AI" />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Health Score & AI Alerts */}
        <motion.div variants={itemVariants} className="md:col-span-3 lg:col-span-3 space-y-4">
          <Card className="bg-card/40 backdrop-blur-xl border-white/10 shadow-2xl">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">مؤشر الصحة العامة</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <HealthScore score={summary?.healthScore || 0} />
              <div className="space-y-2 text-sm flex-1 mr-4">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">السيولة</span>
                  <span className="text-green-400 font-medium">{summary?.liquidity || 'ممتازة'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">النمو</span>
                  <span className="text-cyan-400 font-medium">{summary?.growth || 'مستقر'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">المخاطر</span>
                  <span className="text-yellow-400 font-medium">{summary?.risk || 'متوسطة'}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/40 backdrop-blur-xl border-white/10 shadow-2xl">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="size-5 text-pink-400" />
                تنبيهات AI الذكية
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {isLoadingAlerts ? (
                  Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)
                ) : (
                  alerts?.slice(0, 3).map((alert) => {
                    const handleDismiss = (e: React.MouseEvent) => {
                      // Stop the outer anchor from navigating when the
                      // user is reaching for the dismiss control.
                      e.preventDefault();
                      e.stopPropagation();
                      dismissAlert.mutate({ data: { key: alert.key } });
                    };
                    const inner = (
                      <div className="flex gap-3 p-3 rounded-lg bg-black/20 border border-white/5 hover:bg-black/30 transition-colors">
                        {alert.type === 'danger' && <AlertCircle className="size-5 text-red-500 shrink-0 mt-0.5" />}
                        {alert.type === 'warning' && <AlertTriangle className="size-5 text-yellow-500 shrink-0 mt-0.5" />}
                        {alert.type === 'success' && <CheckCircle2 className="size-5 text-green-500 shrink-0 mt-0.5" />}
                        {alert.type === 'info' && <Info className="size-5 text-cyan-500 shrink-0 mt-0.5" />}
                        <div className="flex-1 min-w-0">
                          <h4 className="text-sm font-medium text-foreground">{alert.title}</h4>
                          <p className="text-xs text-muted-foreground mt-0.5">{alert.message}</p>
                        </div>
                        <button
                          type="button"
                          onClick={handleDismiss}
                          aria-label="إخفاء التنبيه"
                          title="إخفاء التنبيه"
                          data-testid={`button-dismiss-alert-${alert.id}`}
                          className="shrink-0 -mt-1 -ml-1 p-1 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-white/10 transition-colors"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    );
                    return alert.href ? (
                      <a key={alert.id} href={alert.href} className="block" data-testid={`link-alert-${alert.id}`}>
                        {inner}
                      </a>
                    ) : (
                      <div key={alert.id}>{inner}</div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
