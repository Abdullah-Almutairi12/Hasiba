import React, { useState } from "react";
import {
  useGetAiReportSummary,
  useGetSalesReport,
  useGetTopProducts,
  useGetDashboardSalesChart,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Sparkles, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight, Package, DollarSign } from "lucide-react";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";

export default function Reports() {
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly" | "yearly">("monthly");
  const [chartPeriod, setChartPeriod] = useState<"weekly" | "monthly" | "yearly">("monthly");

  const { data: aiSummary, isLoading: isLoadingAi } = useGetAiReportSummary();
  const { data: salesReport, isLoading: isLoadingSales } = useGetSalesReport({ period });
  const { data: salesChart, isLoading: isLoadingChart } = useGetDashboardSalesChart({ period: chartPeriod });
  const { data: topProducts, isLoading: isLoadingTopProducts } = useGetTopProducts();

  return (
    <div className="space-y-6 pb-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">التقارير والتحليلات</h1>
          <p className="text-muted-foreground">تحليلات متقدمة للأداء وتقارير مدعومة بالذكاء الاصطناعي</p>
        </div>
      </div>

      {/* AI Summary Card */}
      <Card className="bg-gradient-to-r from-blue-50/50 to-indigo-50/50 dark:from-blue-900/20 dark:to-indigo-900/20 border-blue-100 dark:border-blue-800">
        <CardContent className="p-6">
          <div className="flex gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400">
              <Sparkles className="size-6" />
            </div>
            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-lg text-blue-900 dark:text-blue-100">ملخص حاسبة.AI الذكي</h3>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  آخر تحديث: {aiSummary?.updatedAt ? format(new Date(aiSummary.updatedAt), 'p', { locale: arSA }) : '---'}
                </span>
              </div>
              {isLoadingAi ? (
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full bg-blue-200/50 dark:bg-blue-800/50" />
                  <Skeleton className="h-4 w-5/6 bg-blue-200/50 dark:bg-blue-800/50" />
                </div>
              ) : (
                <p className="text-blue-800/80 dark:text-blue-200/80 leading-relaxed text-sm md:text-base">
                  {aiSummary?.summary || 'لا يوجد ملخص متاح حالياً.'}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Sales KPIs */}
        <div className="md:col-span-1 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">إيرادات المبيعات</CardTitle>
                <DollarSign className="size-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingSales ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className="text-2xl font-bold">
                    {new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(salesReport?.totalRevenue || 0)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    خلال الفترة: {period === 'daily' ? 'اليوم' : period === 'weekly' ? 'هذا الأسبوع' : period === 'monthly' ? 'هذا الشهر' : 'هذا العام'}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">الطلبات المكتملة</CardTitle>
                <Package className="size-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              {isLoadingSales ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{salesReport?.totalOrders || 0}</div>
                  <p className="text-xs text-muted-foreground mt-1">متوسط قيمة الطلب: {new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(salesReport?.avgOrderValue || 0)}</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">أفضل المنتجات مبيعاً</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              {isLoadingTopProducts ? (
                <div className="p-6 space-y-4">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-4 w-12" />
                    </div>
                  ))}
                </div>
              ) : topProducts?.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">لا توجد بيانات</div>
              ) : (
                <div className="space-y-0 divide-y">
                  {topProducts?.slice(0, 4).map((product, i) => (
                    <div key={product.id} className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
                          {i + 1}
                        </div>
                        <div>
                          <p className="text-sm font-medium">{product.nameAr || product.name}</p>
                          <p className="text-xs text-muted-foreground">{product.salesCount} طلب</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold">{new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(product.revenue)}</p>
                        <p className={`text-xs flex items-center justify-end gap-1 ${product.change > 0 ? "text-green-600" : "text-red-600"}`}>
                          {product.change > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
                          {Math.abs(product.change)}%
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Charts */}
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle>اتجاه المبيعات</CardTitle>
                <CardDescription>الإيرادات والتوقعات مقارنة بالفترات السابقة</CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant={chartPeriod === "weekly" ? "default" : "outline"} size="sm" onClick={() => setChartPeriod("weekly")}>أسبوعي</Button>
                <Button variant={chartPeriod === "monthly" ? "default" : "outline"} size="sm" onClick={() => setChartPeriod("monthly")}>شهري</Button>
                <Button variant={chartPeriod === "yearly" ? "default" : "outline"} size="sm" onClick={() => setChartPeriod("yearly")}>سنوي</Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-[350px] w-full mt-4">
                {isLoadingChart ? (
                  <Skeleton className="h-full w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={salesChart || []} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                      <XAxis dataKey="label" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value / 1000}k`} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#fff', borderColor: '#e2e8f0', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        itemStyle={{ color: '#0f172a' }}
                      />
                      <Bar dataKey="actual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="المبيعات" />
                      <Bar dataKey="forecast" fill="hsl(var(--primary) / 0.3)" radius={[4, 4, 0, 0]} name="توقعات AI" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
