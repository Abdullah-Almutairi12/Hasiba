import { useState } from "react";
import { Money } from "@/components/riyal";
import {
  useGetAiReportSummary,
  useGetTopProducts,
  useGetDashboardSalesChart,
  useGetReportInsights,
  useGetFraudDetection,
  useGetZatcaStatus,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  Sparkles,
  Bot,
  ArrowLeft,
  CalendarPlus,
  FileDown,
  Wand2,
  TrendingUp,
  Crown,
  PackageOpen,
  AlertTriangle,
  UserX,
  Gem,
  Scale,
  ShieldCheck,
  CloudUpload,
  Fingerprint,
  Ban,
  Percent,
  Box,
  Search,
  Clock,
  FileSpreadsheet,
  FileBadge,
  FileCode2,
  Plus,
} from "lucide-react";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";

const fmtSAR = (v: number) =>
  new Intl.NumberFormat("ar-SA", {
    style: "decimal",
    maximumFractionDigits: 0,
  }).format(v);

/**
 * Header dropdown that triggers a file download for the selected report+format.
 * Uses an <a download> click rather than fetch+blob so the browser handles auth cookies
 * and saves the file to disk natively.
 */
function ExportMenu() {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/api";
  const reports: Array<{ key: string; label: string }> = [
    { key: "sales", label: "المبيعات (آخر 30 يوم)" },
    { key: "products", label: "المنتجات والمخزون" },
    { key: "invoices", label: "فواتير الموردين" },
    { key: "suppliers", label: "الموردين" },
    { key: "journal", label: "دفتر اليومية" },
  ];
  function download(reportKey: string, ext: "xlsx" | "pdf") {
    // Open in a new tab so the download starts but the page stays in place.
    window.open(`${base}/exports/${reportKey}.${ext}`, "_blank", "noopener");
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-9 gap-2 border-neutral-200 bg-white text-sm font-medium text-neutral-700 shadow-sm hover:bg-neutral-50"
          data-testid="button-export-menu"
        >
          <FileDown className="size-4 text-neutral-400" />
          <span>تصدير</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>اختر التقرير والصيغة</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {reports.map((r) => (
          <div key={r.key} className="px-1">
            <div className="px-2 pt-2 pb-1 text-[11px] font-semibold text-neutral-500">{r.label}</div>
            <div className="grid grid-cols-2 gap-1 px-1 pb-1">
              <button
                onClick={() => download(r.key, "xlsx")}
                className="flex items-center justify-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 text-xs font-medium text-neutral-700 hover:bg-blue-50 hover:text-[#1D4ED8]"
                data-testid={`button-export-${r.key}-xlsx`}
              >
                <FileDown className="size-3" /> Excel
              </button>
              <button
                onClick={() => download(r.key, "pdf")}
                className="flex items-center justify-center gap-1.5 rounded-md border border-neutral-200 px-2 py-1.5 text-xs font-medium text-neutral-700 hover:bg-blue-50 hover:text-[#1D4ED8]"
                data-testid={`button-export-${r.key}-pdf`}
              >
                <FileDown className="size-3" /> PDF
              </button>
            </div>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function severityBadgeClass(severity: string) {
  if (severity === "critical")
    return "bg-red-100 text-red-700 border-red-200 animate-pulse";
  if (severity === "high")
    return "bg-red-100 text-red-700 border-red-200";
  if (severity === "medium")
    return "bg-orange-100 text-orange-700 border-orange-200";
  return "bg-yellow-100 text-yellow-700 border-yellow-200";
}

function severityLabel(severity: string) {
  return (
    { critical: "عالي جداً", high: "عالي", medium: "متوسط", info: "منخفض" }[
      severity
    ] ?? severity
  );
}

function fraudIcon(type?: string) {
  if (!type) return Ban;
  if (type.includes("خصم") || type.includes("Discount")) return Percent;
  if (type.includes("مخزون") || type.includes("جرد")) return Box;
  return Ban;
}

function FinancialStatementsSection() {
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const [from, setFrom] = useState(yearStart);
  const [to, setTo] = useState(today);
  const apiBase = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/api";
  const reports: Array<{ key: string; label: string }> = [
    { key: "trial-balance", label: "ميزان المراجعة" },
    { key: "profit-loss", label: "قائمة الدخل" },
    { key: "balance-sheet", label: "الميزانية العمومية" },
    { key: "cash-flow", label: "قائمة التدفقات النقدية" },
  ];
  const buildUrl = (key: string, ext: "xlsx" | "pdf") =>
    `${apiBase}/exports/${key}.${ext}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-neutral-800">القوائم المالية الرسمية</h3>
          <p className="mt-1 text-xs text-neutral-500">
            تقارير محاسبية مبنية من القيود المرحَّلة فقط — قابلة للتصدير Excel / PDF.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[10px] font-medium text-neutral-500">من</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-36" />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-neutral-500">إلى</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-36" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        {reports.map((r) => (
          <div key={r.key} className="rounded-xl border border-neutral-100 p-4">
            <p className="text-sm font-bold text-neutral-800">{r.label}</p>
            <p className="mt-1 text-[10px] text-neutral-400">
              {r.key === "balance-sheet" ? `حتى ${to}` : `${from} → ${to}`}
            </p>
            <div className="mt-3 flex gap-2">
              <a
                href={buildUrl(r.key, "xlsx")}
                className="flex-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-center text-xs font-medium text-white hover:bg-emerald-700"
              >
                Excel
              </a>
              <a
                href={buildUrl(r.key, "pdf")}
                className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-center text-xs font-medium text-white hover:bg-red-700"
              >
                PDF
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Reports() {
  const [chartPeriod] = useState<"weekly" | "monthly" | "yearly">("monthly");
  const [chartTab, setChartTab] = useState<"sales" | "inventory">("sales");

  const { data: aiSummary } = useGetAiReportSummary();
  const { data: salesChart, isLoading: isLoadingChart } =
    useGetDashboardSalesChart({ period: chartPeriod });
  const { data: topProducts } = useGetTopProducts();
  const { data: insights } = useGetReportInsights();
  const insightsExt = insights as
    | (typeof insights & {
        slowMoversCount?: number;
        retentionRate?: number;
        acquisitionCost?: number;
      })
    | undefined;
  const { data: fraud } = useGetFraudDetection();
  const { data: zatca } = useGetZatcaStatus();
  const zatcaExt = zatca as
    | (typeof zatca & {
        invoicesApprovedToday?: number;
        invoicesRejected?: number;
        invoicesProcessing?: number;
      })
    | undefined;

  const bestSeller = topProducts?.[0];

  return (
    <div
      dir="rtl"
      className="-m-6 flex h-[calc(100vh-0px)] flex-col bg-[#F9FAFB] font-sans text-neutral-900"
    >
      {/* Header */}
      <header className="z-20 flex h-16 shrink-0 items-center justify-between border-b border-neutral-200 bg-white px-6 shadow-sm">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-neutral-900">
            مركز التقارير والتحليلات
            <span className="flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-[10px] tracking-wide text-[#1D4ED8]">
              <Sparkles className="size-2.5" /> AI POWERED
            </span>
          </h1>
          <p className="mt-0.5 text-xs text-neutral-500">
            تحليلات ذكية، تنبؤات بالمبيعات، وكشف الاحتيال المالي
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Input
              placeholder="اسأل المساعد الذكي..."
              className="h-9 w-64 border-neutral-200 bg-neutral-50 ps-3 pe-10 text-sm focus-visible:border-[#2563EB] focus-visible:ring-blue-200"
            />
            <Wand2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[#2563EB]" />
          </div>

          <div className="mx-1 h-6 w-px bg-neutral-200" />

          <ExportMenu />


          <Button className="grid size-9 place-items-center rounded-lg bg-[#2563EB] p-0 text-white shadow hover:bg-[#1D4ED8]">
            <CalendarPlus className="size-4" />
          </Button>
        </div>
      </header>

      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        <FinancialStatementsSection />

        {/* AI Copilot widget */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-l from-[#1E40AF] to-[#1D4ED8] p-6 text-white shadow-xl shadow-blue-900/20">
          <div className="absolute -right-10 -top-10 size-40 rounded-full bg-blue-400/30 blur-3xl" />
          <div className="relative z-10 flex items-start gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-xl border border-white/20 bg-white/10 backdrop-blur">
              <Bot className="size-6 animate-pulse text-white" />
            </div>
            <div className="flex-1">
              <h3 className="mb-1 flex items-center gap-2 text-lg font-bold">
                ملخص الذكاء الاصطناعي اليومي
                <span className="rounded bg-white/20 px-2 py-0.5 text-[10px] font-normal text-white/90">
                  {aiSummary?.updatedAt
                    ? `تم التحديث: ${format(new Date(aiSummary.updatedAt), "p", { locale: arSA })}`
                    : "تم التحديث: منذ قليل"}
                </span>
              </h3>
              <p className="text-sm leading-relaxed text-white/90">
                {aiSummary?.summary ||
                  "جاري تحليل بيانات اليوم... سيظهر الملخص الذكي خلال لحظات."}
              </p>
            </div>
            <Button className="shrink-0 self-center gap-2 bg-white px-4 py-2 text-sm font-bold text-[#1E40AF] shadow-lg hover:bg-blue-50">
              <span>تحليل التفاصيل</span>
              <ArrowLeft className="size-3.5" />
            </Button>
          </div>
        </div>

        {/* Top KPI grid (4 cards) */}
        <div className="grid grid-cols-12 gap-6">
          {/* Daily profit */}
          <div className="group relative col-span-12 overflow-hidden rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm transition-transform duration-300 hover:-translate-y-1 sm:col-span-6 lg:col-span-3">
            <div className="mb-4 flex items-start justify-between">
              <div className="grid size-10 place-items-center rounded-lg bg-emerald-50 text-emerald-600 transition-transform group-hover:scale-110">
                <TrendingUp className="size-5" />
              </div>
              <span className="flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-600">
                <TrendingUp className="size-3" />+
                {insights?.profitChange?.toFixed(1) || "4.2"}%
              </span>
            </div>
            <p className="mb-1 text-xs font-medium text-neutral-500">
              صافي الربح اليومي
            </p>
            <h3 className="text-2xl font-bold text-neutral-800">
              <Money value={insights?.netProfitToday ?? 12450} fractionDigits={0} symbolClassName="size-[0.5em] text-neutral-400" />
            </h3>
          </div>

          {/* Best seller */}
          <div className="group relative col-span-12 overflow-hidden rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm transition-transform duration-300 hover:-translate-y-1 sm:col-span-6 lg:col-span-3">
            <div className="mb-4 flex items-start justify-between">
              <div className="grid size-10 place-items-center rounded-lg bg-blue-50 text-[#2563EB] transition-transform group-hover:scale-110">
                <Crown className="size-5" />
              </div>
              <span className="rounded bg-neutral-50 px-2 py-1 text-xs font-bold text-neutral-500">
                {bestSeller?.salesCount ?? 340} قطعة
              </span>
            </div>
            <p className="mb-1 text-xs font-medium text-neutral-500">
              المنتج الأكثر مبيعاً
            </p>
            <h3 className="truncate text-lg font-bold text-neutral-800">
              {bestSeller?.nameAr || bestSeller?.name || "قهوة أرابيكا مختصة 250ج"}
            </h3>
          </div>

          {/* Slow movers */}
          <div className="group relative col-span-12 overflow-hidden rounded-2xl border border-neutral-100 bg-white p-5 shadow-sm transition-transform duration-300 hover:-translate-y-1 sm:col-span-6 lg:col-span-3">
            <div className="mb-4 flex items-start justify-between">
              <div className="grid size-10 place-items-center rounded-lg bg-orange-50 text-orange-600 transition-transform group-hover:scale-110">
                <PackageOpen className="size-5" />
              </div>
              <span className="flex animate-pulse items-center gap-1 rounded bg-orange-50 px-2 py-1 text-xs font-bold text-orange-600">
                <AlertTriangle className="size-3" /> ركود
              </span>
            </div>
            <p className="mb-1 text-xs font-medium text-neutral-500">
              منتجات راكدة (&gt;60 يوم)
            </p>
            <h3 className="text-2xl font-bold text-neutral-800">
              {insightsExt?.slowMoversCount ?? 24}{" "}
              <span className="text-sm font-normal text-neutral-400">صنف</span>
            </h3>
          </div>

          {/* Fraud */}
          <div className="group relative col-span-12 overflow-hidden rounded-2xl border border-red-100 bg-white p-5 shadow-sm ring-1 ring-red-50 transition-transform duration-300 hover:-translate-y-1 sm:col-span-6 lg:col-span-3">
            <div className="absolute right-0 top-0 h-full w-1 bg-red-500" />
            <div className="mb-4 flex items-start justify-between">
              <div className="grid size-10 place-items-center rounded-lg bg-red-50 text-red-600 transition-transform group-hover:scale-110">
                <UserX className="size-5" />
              </div>
              <span className="rounded bg-red-50 px-2 py-1 text-xs font-bold text-red-600">
                {fraud?.length ?? 3} حالات
              </span>
            </div>
            <p className="mb-1 text-xs font-medium text-neutral-500">
              أنماط احتيال محتملة
            </p>
            <h3 className="text-lg font-bold text-neutral-800">خصومات مشبوهة</h3>
          </div>
        </div>

        {/* Predictive chart + side cards */}
        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-12 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm lg:col-span-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-bold text-neutral-800">
                  <TrendingUp className="size-5 text-[#2563EB]" />
                  التحليلات التنبؤية (Predictive Analytics)
                </h3>
                <p className="mt-1 text-xs text-neutral-500">
                  توقعات الذكاء الاصطناعي للمبيعات واحتياجات المخزون للشهر القادم
                </p>
              </div>
              <div className="flex rounded-lg border border-neutral-200 bg-neutral-50 p-1">
                {(["sales", "inventory"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setChartTab(t)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      chartTab === t
                        ? "bg-white text-neutral-800 shadow-sm"
                        : "text-neutral-500 hover:text-neutral-700"
                    }`}
                  >
                    {t === "sales" ? "المبيعات" : "المخزون"}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-[320px] w-full">
              {isLoadingChart ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={salesChart || []}
                    margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient
                        id="forecastGrad"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="0%" stopColor="#10B981" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#f1f5f9"
                    />
                    <XAxis
                      dataKey="label"
                      stroke="#64748b"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="#64748b"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#fff",
                        borderColor: "#e2e8f0",
                        borderRadius: "8px",
                        fontFamily: "Inter",
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 12 }}
                      iconType="circle"
                      verticalAlign="top"
                      align="right"
                    />
                    <Area
                      type="monotone"
                      dataKey="actual"
                      stroke="#3B82F6"
                      strokeWidth={3}
                      fill="url(#actualGrad)"
                      name="المبيعات الفعلية"
                    />
                    <Area
                      type="monotone"
                      dataKey="forecast"
                      stroke="#10B981"
                      strokeWidth={3}
                      strokeDasharray="6 4"
                      fill="url(#forecastGrad)"
                      name="توقعات AI للشهر القادم"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="col-span-12 flex flex-col gap-6 lg:col-span-4">
            {/* Market benchmark */}
            <div className="flex-1 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-bold text-neutral-800">
                  <Scale className="size-4 text-[#2563EB]" />
                  مقارنة بالسوق
                </h3>
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-[#1D4ED8]">
                  قطاع التجزئة
                </span>
              </div>
              <div className="space-y-4">
                {(insights?.benchmarks ?? [
                  { metric: "نمو المبيعات", you: 23, industry: 8 },
                  { metric: "هامش الربح", you: 20, industry: 22 },
                ]).map((b: any, i: number) => {
                  const better = b.you >= b.industry;
                  const total = b.you + b.industry;
                  const youPct = Math.min(100, (b.you / total) * 100);
                  const indPct = 100 - youPct;
                  const diff = (((b.you - b.industry) / b.industry) * 100).toFixed(0);
                  return (
                    <div key={i}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="font-medium text-neutral-700">{b.metric}</span>
                        <span
                          className={`font-bold ${
                            better ? "text-emerald-600" : "text-orange-500"
                          }`}
                        >
                          {better ? "+" : ""}
                          {diff}% vs السوق
                        </span>
                      </div>
                      <div className="flex h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                        <div
                          className={`h-2 ${better ? "bg-[#2563EB]" : "bg-orange-500"}`}
                          style={{ width: `${youPct}%` }}
                        />
                        <div
                          className="h-2 bg-neutral-300"
                          style={{ width: `${indPct}%` }}
                        />
                      </div>
                      <p className="mt-1 text-left text-[10px] text-neutral-400">
                        متوسط السوق: {b.industry}%
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* CLV dark card */}
            <div className="group relative overflow-hidden rounded-2xl border border-blue-700/40 bg-gradient-to-br from-[#1E3A8A] to-[#1E40AF] p-5 text-white shadow-sm">
              <div className="absolute -right-10 -top-10 size-32 rounded-full bg-blue-500 opacity-20 blur-3xl transition-opacity group-hover:opacity-40" />
              <div className="relative z-10 mb-4 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-bold">
                  <Gem className="size-4 text-blue-300" />
                  قيمة حياة العميل (CLV)
                </h3>
                <span className="rounded bg-white/10 px-2 py-1 text-xs backdrop-blur">
                  +{insights?.clvChange?.toFixed(1) || "12.5"}%
                </span>
              </div>
              <div className="relative z-10">
                <div className="mb-1 text-3xl font-bold">
                  <Money value={insights?.customerLifetimeValue ?? 4850} fractionDigits={0} symbolClassName="size-[0.5em] text-blue-200" />
                </div>
                <p className="mb-4 text-[10px] text-blue-200">
                  متوسط قيمة العميل خلال 12 شهر
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-white/5 bg-black/20 p-2">
                    <p className="mb-1 text-[9px] text-blue-300">معدل الاحتفاظ</p>
                    <p className="text-sm font-bold">
                      {insightsExt?.retentionRate ?? 68}%
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/5 bg-black/20 p-2">
                    <p className="mb-1 text-[9px] text-blue-300">تكلفة الاستحواذ</p>
                    <p className="text-sm font-bold">
                      <Money value={insightsExt?.acquisitionCost ?? 120} fractionDigits={0} />
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ZATCA + Fraud detection */}
        <div className="grid grid-cols-12 gap-6">
          {/* ZATCA */}
          <div className="col-span-12 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm lg:col-span-4">
            <div className="flex items-center justify-between border-b border-neutral-100 bg-neutral-50/50 p-5">
              <h3 className="flex items-center gap-2 text-sm font-bold text-neutral-800">
                <ShieldCheck className="size-4 text-[#2563EB]" />
                حالة الربط مع ZATCA
              </h3>
              <span
                className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-bold ${
                  zatca?.connected
                    ? "border-emerald-100 bg-emerald-50 text-emerald-600"
                    : "border-red-100 bg-red-50 text-red-600"
                }`}
              >
                <span
                  className={`size-1.5 rounded-full ${
                    zatca?.connected
                      ? "animate-pulse bg-emerald-500"
                      : "bg-red-500"
                  }`}
                />
                {zatca?.connected ? "متصل" : "غير متصل"}
              </span>
            </div>
            <div className="p-5">
              <div className="mb-6 flex items-center justify-between">
                <div className="flex-1 border-l border-neutral-100 text-center">
                  <p className="text-2xl font-bold text-neutral-800">
                    {zatcaExt?.invoicesApprovedToday ?? 1245}
                  </p>
                  <p className="mt-1 text-[10px] text-neutral-500">
                    فواتير معتمدة اليوم
                  </p>
                </div>
                <div className="flex-1 border-l border-neutral-100 text-center">
                  <p className="text-2xl font-bold text-red-600">
                    {zatcaExt?.invoicesRejected ?? 0}
                  </p>
                  <p className="mt-1 text-[10px] text-neutral-500">مرفوضة</p>
                </div>
                <div className="flex-1 text-center">
                  <p className="text-2xl font-bold text-[#2563EB]">
                    {zatcaExt?.invoicesProcessing ?? 12}
                  </p>
                  <p className="mt-1 text-[10px] text-neutral-500">قيد المعالجة</p>
                </div>
              </div>
              <Button className="h-11 w-full gap-2 bg-neutral-900 text-sm font-medium text-white hover:bg-neutral-800">
                <CloudUpload className="size-4" />
                تصدير تقرير ZATCA (XML)
              </Button>
            </div>
          </div>

          {/* Fraud detection */}
          <div className="col-span-12 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm lg:col-span-8">
            <div className="flex items-center justify-between border-b border-neutral-100 bg-red-50/30 p-5">
              <h3 className="flex items-center gap-2 text-sm font-bold text-neutral-800">
                <span className="grid size-6 place-items-center rounded bg-red-100 text-red-600">
                  <Fingerprint className="size-3" />
                </span>
                كشف الاحتيال والأنماط المشبوهة (Fraud Detection)
              </h3>
              <button className="flex items-center gap-1 text-xs font-medium text-red-600 hover:underline">
                عرض التقرير الأمني الكامل <ArrowLeft className="size-3" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-sm">
                <thead className="border-b border-neutral-100 bg-neutral-50 text-xs font-medium text-neutral-500">
                  <tr>
                    <th className="px-5 py-3">نوع التنبيه</th>
                    <th className="px-5 py-3">التفاصيل</th>
                    <th className="px-5 py-3">الموظف / الفرع</th>
                    <th className="px-5 py-3">وقت الاكتشاف</th>
                    <th className="px-5 py-3">مستوى الخطورة</th>
                    <th className="px-5 py-3">الإجراء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-50 text-neutral-600">
                  {(fraud && fraud.length > 0
                    ? fraud
                    : ([] as any[])
                  ).map((f: any) => {
                    const Icon = fraudIcon(f.type);
                    return (
                      <tr key={f.id} className="hover:bg-neutral-50/50">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2 font-medium text-neutral-800">
                            <Icon
                              className={`size-4 ${
                                f.severity === "critical" || f.severity === "high"
                                  ? "text-red-500"
                                  : f.severity === "medium"
                                    ? "text-orange-500"
                                    : "text-yellow-500"
                              }`}
                            />
                            {f.type}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-xs">{f.description}</td>
                        <td className="px-5 py-3 text-xs">
                          {f.cashier && <p>{f.cashier}</p>}
                          <p className="text-neutral-400">{f.branch}</p>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs">{f.time}</td>
                        <td className="px-5 py-3">
                          <span
                            className={`rounded border px-2 py-0.5 text-[10px] font-bold ${severityBadgeClass(f.severity)}`}
                          >
                            {severityLabel(f.severity)}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <button className="flex items-center gap-1 text-xs text-neutral-400 transition-colors hover:text-[#2563EB]">
                            <Search className="size-3" /> تحقيق
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {(!fraud || fraud.length === 0) && (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-5 py-12 text-center text-sm text-neutral-400"
                      >
                        لا توجد تنبيهات احتيال خلال آخر 24 ساعة. ✓
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Scheduled exports */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-neutral-800">
              <Clock className="size-4 text-neutral-400" />
              التقارير المجدولة (Scheduled Exports)
            </h3>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 border-neutral-200 bg-neutral-50 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
            >
              <Plus className="size-3" /> جدولة تقرير جديد
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[
              {
                icon: FileSpreadsheet,
                color: "bg-emerald-50 text-emerald-600 border-emerald-100",
                title: "تقرير ضريبة القيمة المضافة (VAT)",
                schedule: "تكرار: شهري (يوم 28)",
              },
              {
                icon: FileBadge,
                color: "bg-blue-50 text-blue-600 border-blue-100",
                title: "ملخص الأداء التنفيذي",
                schedule: "تكرار: أسبوعي (الخميس)",
              },
              {
                icon: FileCode2,
                color: "bg-orange-50 text-orange-600 border-orange-100",
                title: "ZATCA XML Export",
                schedule: "تكرار: يومي (تلقائي)",
              },
            ].map((e, i) => {
              const Icon = e.icon;
              return (
                <div
                  key={i}
                  className="group flex cursor-pointer items-center gap-3 rounded-xl border border-neutral-100 p-3 transition-colors hover:bg-neutral-50"
                >
                  <div
                    className={`grid size-10 place-items-center rounded-lg border ${e.color}`}
                  >
                    <Icon className="size-5" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-bold text-neutral-800 transition-colors group-hover:text-[#2563EB]">
                      {e.title}
                    </p>
                    <p className="text-[10px] text-neutral-400">{e.schedule}</p>
                  </div>
                  <span
                    className="block size-2 rounded-full bg-emerald-500"
                    title="نشط"
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
