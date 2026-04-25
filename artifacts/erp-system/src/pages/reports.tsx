import React, { useState } from "react";
import {
  useGetAiReportSummary,
  useGetSalesReport,
  useGetTopProducts,
  useGetDashboardSalesChart,
  useGetReportInsights,
  useGetFraudDetection,
  useGetZatcaStatus,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Package,
  DollarSign,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Heart,
  Target,
  Zap,
  ArrowUpRight,
} from "lucide-react";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";

const fmtSAR = (v: number) =>
  new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR", maximumFractionDigits: 0 }).format(v);

function severityClass(severity: string) {
  if (severity === "critical") return "border-red-300 bg-red-50 text-red-800";
  if (severity === "high") return "border-orange-300 bg-orange-50 text-orange-800";
  if (severity === "medium") return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-blue-300 bg-blue-50 text-blue-800";
}

function severityLabel(severity: string) {
  return { critical: "حرج", high: "عالٍ", medium: "متوسط", info: "تنبيه" }[severity] ?? severity;
}

export default function Reports() {
  const [chartPeriod, setChartPeriod] = useState<"weekly" | "monthly" | "yearly">("monthly");

  const { data: aiSummary } = useGetAiReportSummary();
  const { data: salesReport } = useGetSalesReport({ period: "monthly" });
  const { data: salesChart, isLoading: isLoadingChart } = useGetDashboardSalesChart({ period: chartPeriod });
  const { data: topProducts } = useGetTopProducts();
  const { data: insights } = useGetReportInsights();
  const { data: fraud } = useGetFraudDetection();
  const { data: zatca } = useGetZatcaStatus();

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">التقارير والتحليلات الذكية</h1>
          <p className="mt-1 text-muted-foreground">
            رؤى مدعومة بالذكاء الاصطناعي، توقعات السوق، واكتشاف الاحتيال
          </p>
        </div>
        <div className="flex items-center gap-2">
          {zatca && (
            <Badge
              variant="outline"
              className={
                zatca.connected
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                  : "border-red-300 bg-red-50 text-red-700"
              }
            >
              <span
                className={`me-2 inline-block size-2 rounded-full ${
                  zatca.connected ? "bg-emerald-500 animate-pulse" : "bg-red-500"
                }`}
              />
              ZATCA {zatca.connected ? "متصل" : "غير متصل"}
            </Badge>
          )}
          <Button>
            <Sparkles className="ms-2 size-4" />
            توليد تقرير AI
          </Button>
        </div>
      </div>

      {/* AI Copilot Summary */}
      <Card className="overflow-hidden border-blue-200 bg-gradient-to-l from-blue-50 via-indigo-50 to-purple-50">
        <CardContent className="p-6">
          <div className="flex gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 text-white shadow-lg">
              <Sparkles className="size-6" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-800">حاسبة.AI Copilot — الملخص الذكي</h3>
                <span className="text-xs text-muted-foreground">
                  {aiSummary?.updatedAt
                    ? `آخر تحديث: ${format(new Date(aiSummary.updatedAt), "p", { locale: arSA })}`
                    : "..."}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-slate-700">
                {aiSummary?.summary ?? "لا يوجد ملخص متاح."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPIs Row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">صافي الربح اليوم</p>
                <p className="mt-2 text-3xl font-bold tabular-nums">
                  {fmtSAR(insights?.netProfitToday ?? 0)}
                </p>
                <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-green-600">
                  <ArrowUpRight className="size-3" />
                  {insights?.profitChange?.toFixed(1)}%
                </div>
              </div>
              <div className="grid size-12 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600">
                <DollarSign className="size-6" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">قيمة العميل (CLV)</p>
                <p className="mt-2 text-3xl font-bold tabular-nums">
                  {fmtSAR(insights?.customerLifetimeValue ?? 0)}
                </p>
                <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-purple-600">
                  <ArrowUpRight className="size-3" />
                  {insights?.clvChange?.toFixed(1)}% فوق المعدل
                </div>
              </div>
              <div className="grid size-12 place-items-center rounded-xl bg-purple-500/10 text-purple-600">
                <Heart className="size-6" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">توقع مبيعات الأسبوع</p>
                <p className="mt-2 text-3xl font-bold tabular-nums">
                  {fmtSAR(insights?.forecastNextWeek ?? 0)}
                </p>
                <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-600">
                  <Target className="size-3" />
                  دقة {insights?.forecastConfidence}%
                </div>
              </div>
              <div className="grid size-12 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
                <Zap className="size-6" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">تنبيهات الاحتيال (24س)</p>
                <p className="mt-2 text-3xl font-bold tabular-nums text-red-600">{fraud?.length ?? 0}</p>
                <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-red-600">
                  <ShieldAlert className="size-3" />
                  تتطلب مراجعة
                </div>
              </div>
              <div className="grid size-12 place-items-center rounded-xl bg-red-500/10 text-red-600">
                <ShieldAlert className="size-6" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Forecast Chart + Anomalies */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>التوقعات التنبؤية للمبيعات</CardTitle>
              <CardDescription>الفعلي vs توقعات الذكاء الاصطناعي</CardDescription>
            </div>
            <div className="flex gap-1">
              {(["weekly", "monthly", "yearly"] as const).map((p) => (
                <Button
                  key={p}
                  variant={chartPeriod === p ? "default" : "outline"}
                  size="sm"
                  onClick={() => setChartPeriod(p)}
                >
                  {{ weekly: "أسبوعي", monthly: "شهري", yearly: "سنوي" }[p]}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[320px] w-full">
              {isLoadingChart ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={salesChart || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#a855f7" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#a855f7" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="label" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis
                      stroke="#64748b"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#fff",
                        borderColor: "#e2e8f0",
                        borderRadius: "8px",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="actual"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="url(#actualGrad)"
                      name="فعلي"
                    />
                    <Area
                      type="monotone"
                      dataKey="forecast"
                      stroke="#a855f7"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      fill="url(#forecastGrad)"
                      name="توقع AI"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-purple-600" />
              رؤى وتنبيهات ذكية
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {insights?.anomalies?.map((a, i) => (
              <div
                key={i}
                className={`rounded-lg border-r-4 p-3 ${
                  a.severity === "positive"
                    ? "border-green-500 bg-green-50"
                    : "border-amber-500 bg-amber-50"
                }`}
              >
                <div className="flex items-start gap-2">
                  {a.severity === "positive" ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
                  ) : (
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-800">{a.title}</p>
                    <p className="mt-1 text-xs text-slate-600">{a.description}</p>
                    <p className="mt-2 text-xs font-medium text-slate-700">{a.action}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Benchmarks + Top Products */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="size-5 text-blue-600" />
              مقارنة معيارية بالسوق
            </CardTitle>
            <CardDescription>أداؤك مقارنة بمتوسط القطاع في المملكة</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {insights?.benchmarks?.map((b, i) => {
                const better = b.you >= b.industry;
                const max = Math.max(b.you, b.industry) * 1.2;
                return (
                  <div key={i}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium">{b.metric}</span>
                      <Badge
                        variant="outline"
                        className={
                          better
                            ? "border-green-300 bg-green-50 text-green-700"
                            : "border-orange-300 bg-orange-50 text-orange-700"
                        }
                      >
                        {better ? "متفوق" : "تحت المتوسط"}
                      </Badge>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-12 text-xs text-muted-foreground">أنت</span>
                        <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="absolute inset-y-0 right-0 rounded-full bg-gradient-to-l from-primary to-cyan-400"
                            style={{ width: `${(b.you / max) * 100}%` }}
                          />
                        </div>
                        <span className="w-10 text-left text-xs font-bold tabular-nums">{b.you}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-12 text-xs text-muted-foreground">السوق</span>
                        <div className="relative h-4 flex-1 overflow-hidden rounded-full bg-muted">
                          <div
                            className="absolute inset-y-0 right-0 rounded-full bg-slate-400"
                            style={{ width: `${(b.industry / max) * 100}%` }}
                          />
                        </div>
                        <span className="w-10 text-left text-xs tabular-nums">{b.industry}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>أفضل المنتجات مبيعاً</CardTitle>
            <CardDescription>الأكثر طلباً خلال الشهر</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topProducts?.slice(0, 5).map((p, i) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3"
                >
                  <div className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-primary to-cyan-400 text-sm font-bold text-white">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-semibold">{p.nameAr || p.name}</p>
                    <p className="text-xs text-muted-foreground">{p.salesCount} طلب</p>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold tabular-nums">{fmtSAR(p.revenue)}</p>
                    <p
                      className={`flex items-center justify-end gap-0.5 text-xs ${
                        p.change > 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {p.change > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                      {Math.abs(p.change)}%
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Fraud Detection */}
      <Card className="border-red-200">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="size-5 text-red-600" />
                كشف الاحتيال والعمليات المشبوهة
              </CardTitle>
              <CardDescription>تنبيهات تم رصدها بواسطة محرك AI خلال الـ 24 ساعة الماضية</CardDescription>
            </div>
            <Button variant="outline" size="sm">عرض الكل</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b text-right text-sm text-muted-foreground">
                <tr>
                  <th className="pb-3 font-medium">النوع</th>
                  <th className="pb-3 font-medium">الوصف</th>
                  <th className="pb-3 font-medium">الفرع / الكاشير</th>
                  <th className="pb-3 font-medium">المبلغ</th>
                  <th className="pb-3 font-medium">الوقت</th>
                  <th className="pb-3 font-medium">الخطورة</th>
                  <th className="pb-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {fraud?.map((f) => (
                  <tr key={f.id} className="text-sm">
                    <td className="py-3 font-medium">{f.type}</td>
                    <td className="py-3 text-muted-foreground">{f.description}</td>
                    <td className="py-3">
                      <p>{f.branch}</p>
                      <p className="text-xs text-muted-foreground">{f.cashier}</p>
                    </td>
                    <td className="py-3 font-bold tabular-nums">{fmtSAR(f.amount)}</td>
                    <td className="py-3 text-muted-foreground">{f.time}</td>
                    <td className="py-3">
                      <Badge variant="outline" className={severityClass(f.severity)}>
                        {severityLabel(f.severity)}
                      </Badge>
                    </td>
                    <td className="py-3 text-left">
                      <Button variant="ghost" size="sm">مراجعة</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
