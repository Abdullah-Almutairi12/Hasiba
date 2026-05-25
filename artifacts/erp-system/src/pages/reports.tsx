import { useEffect, useState } from "react";
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

// ============== Consolidated group reports (Multi-Company Phase 6) ==============

interface SiblingCompany {
  id: number;
  name: string;
  isActive: boolean;
}

interface EliminationEntry {
  linkId: number;
  sourceCompanyId: number;
  sourceCompanyName: string;
  sourceRef: string;
  targetCompanyId: number;
  targetCompanyName: string;
  targetRef: string;
  amount: number;
  sourceAmount: number;
  targetAmount: number;
  imbalance: boolean;
}

interface ConsolidatedRow {
  code: string;
  nameAr: string;
  type: string;
  gross: number;
  eliminated: number;
  amount: number;
}

interface InvalidReference {
  linkId: number;
  kind: string;
  status: string;
  reason:
    | "missing_source_doc"
    | "missing_target_doc"
    | "missing_source_company"
    | "missing_target_company";
  sourceRef: string;
  targetRef: string;
  sourceCompanyId: number;
  targetCompanyId: number;
}

interface PLPayload {
  revenue: ConsolidatedRow[];
  expenses: ConsolidatedRow[];
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
  eliminations: EliminationEntry[];
  invalidReferences: InvalidReference[];
  totalRevenueEliminated: number;
  totalExpenseEliminated: number;
  imbalance: number;
  hasImbalance: boolean;
}

interface BSPayload {
  assets: ConsolidatedRow[];
  liabilities: ConsolidatedRow[];
  equity: ConsolidatedRow[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  netIncome: number;
  isBalanced: boolean;
  eliminations: EliminationEntry[];
  invalidReferences: InvalidReference[];
  totalArEliminated: number;
  totalApEliminated: number;
  imbalance: number;
  hasImbalance: boolean;
}

interface CFPayload {
  inflow: number;
  outflow: number;
  net: number;
  bySource: { source: string; inflow: number; outflow: number; net: number }[];
  byCompany: { companyId: number; companyName: string; amount: number }[];
  invalidReferences: InvalidReference[];
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("ar-SA", {
    style: "decimal",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);

function ConsolidatedReportsSection() {
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const apiBase = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/api";

  const [siblings, setSiblings] = useState<SiblingCompany[]>([]);
  const [siblingsErr, setSiblingsErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [from, setFrom] = useState(yearStart);
  const [to, setTo] = useState(today);
  const [tab, setTab] = useState<"pl" | "bs" | "cf">("pl");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pl, setPl] = useState<PLPayload | null>(null);
  const [bs, setBs] = useState<BSPayload | null>(null);
  const [cf, setCf] = useState<CFPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBase}/companies/siblings`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return (await r.json()) as SiblingCompany[];
      })
      .then((rows) => {
        if (cancelled) return;
        const active = rows.filter((r) => r.isActive);
        setSiblings(active);
        // Default to selecting all to give an immediate consolidated view.
        setSelected(active.map((r) => r.id));
      })
      .catch((e: unknown) => {
        if (!cancelled) setSiblingsErr(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  const toggle = (id: number) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const run = async () => {
    if (selected.length === 0) {
      setErr("اختر شركة واحدة على الأقل");
      return;
    }
    setLoading(true);
    setErr(null);
    const qs = new URLSearchParams({ companies: selected.join(",") });
    if (tab === "bs") qs.set("asOf", to);
    else {
      qs.set("from", from);
      qs.set("to", to);
    }
    try {
      const r = await fetch(`${apiBase}/reports/consolidated/${tab}?${qs}`, {
        credentials: "include",
      });
      if (!r.ok) {
        const body = await r.text();
        throw new Error(body || `HTTP ${r.status}`);
      }
      const data = await r.json();
      if (tab === "pl") setPl(data as PLPayload);
      else if (tab === "bs") setBs(data as BSPayload);
      else setCf(data as CFPayload);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const exportUrl = (ext: "xlsx" | "pdf") => {
    const qs = new URLSearchParams({ companies: selected.join(",") });
    if (tab === "bs") qs.set("asOf", to);
    else {
      qs.set("from", from);
      qs.set("to", to);
    }
    return `${apiBase}/exports/consolidated-${tab}.${ext}?${qs}`;
  };

  const selectedNames = siblings
    .filter((s) => selected.includes(s.id))
    .map((s) => s.name)
    .join(" · ");

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-neutral-800">
            التقارير الموحّدة للمجموعة
          </h3>
          <p className="mt-1 text-xs text-neutral-500">
            دمج P&amp;L والميزانية والتدفقات النقدية عبر عدة شركات مع استبعاد
            المعاملات داخل المجموعة تلقائياً.
          </p>
        </div>
        <div className="flex items-end gap-2">
          {tab !== "bs" && (
            <div>
              <label className="block text-[10px] font-medium text-neutral-500">
                من
              </label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="h-9 w-36"
              />
            </div>
          )}
          <div>
            <label className="block text-[10px] font-medium text-neutral-500">
              {tab === "bs" ? "حتى" : "إلى"}
            </label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 w-36"
            />
          </div>
        </div>
      </div>

      <div className="mb-4">
        <p className="mb-2 text-[10px] font-medium text-neutral-500">
          الشركات في النطاق
        </p>
        {siblingsErr && (
          <p className="text-xs text-red-600">تعذّر جلب الشركات: {siblingsErr}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {siblings.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  on
                    ? "border-[#2563EB] bg-blue-50 text-[#1D4ED8]"
                    : "border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {c.name}
              </button>
            );
          })}
          {siblings.length === 0 && !siblingsErr && (
            <span className="text-xs text-neutral-400">جارٍ التحميل…</span>
          )}
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2 border-b border-neutral-100">
        {[
          { k: "pl" as const, label: "قائمة الدخل" },
          { k: "bs" as const, label: "الميزانية" },
          { k: "cf" as const, label: "التدفقات النقدية" },
        ].map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setTab(t.k)}
            className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
              tab === t.k
                ? "border-[#2563EB] text-[#1D4ED8]"
                : "border-transparent text-neutral-500 hover:text-neutral-700"
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="ms-auto flex gap-2">
          <Button
            size="sm"
            onClick={run}
            disabled={loading || selected.length === 0}
            className="h-8 bg-[#2563EB] text-xs text-white hover:bg-[#1D4ED8]"
          >
            {loading ? "جارٍ التوليد…" : "توليد التقرير"}
          </Button>
          <a
            href={exportUrl("xlsx")}
            className={`rounded-lg bg-emerald-600 px-3 py-1.5 text-center text-xs font-medium text-white hover:bg-emerald-700 ${
              selected.length === 0 ? "pointer-events-none opacity-50" : ""
            }`}
          >
            Excel
          </a>
          <a
            href={exportUrl("pdf")}
            className={`rounded-lg bg-red-600 px-3 py-1.5 text-center text-xs font-medium text-white hover:bg-red-700 ${
              selected.length === 0 ? "pointer-events-none opacity-50" : ""
            }`}
          >
            PDF
          </a>
        </div>
      </div>

      {err && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {err}
        </div>
      )}

      {selectedNames && (
        <p className="mb-3 text-[11px] text-neutral-500">
          النطاق: <span className="font-medium text-neutral-700">{selectedNames}</span>
        </p>
      )}

      {tab === "pl" && pl && <ConsolidatedPLView data={pl} />}
      {tab === "bs" && bs && <ConsolidatedBSView data={bs} />}
      {tab === "cf" && cf && <ConsolidatedCFView data={cf} />}
      {!loading && !pl && tab === "pl" && (
        <p className="text-center text-xs text-neutral-400">
          اضغط "توليد التقرير" لعرض النتائج.
        </p>
      )}
      {!loading && !bs && tab === "bs" && (
        <p className="text-center text-xs text-neutral-400">
          اضغط "توليد التقرير" لعرض النتائج.
        </p>
      )}
      {!loading && !cf && tab === "cf" && (
        <p className="text-center text-xs text-neutral-400">
          اضغط "توليد التقرير" لعرض النتائج.
        </p>
      )}
    </div>
  );
}

function ImbalanceBanner({ amount }: { amount: number }) {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4" />
        <span>
          تحذير: عدم اتزان في الاستبعادات بين الشركات بمقدار{" "}
          <span className="font-bold">{fmtMoney(amount)}</span>. راجع المعاملات
          المعلّمة بإطار أحمر أدناه.
        </span>
      </div>
      <a
        href={`${base}/intercompany#tab=imbalances`}
        className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2 py-1 text-[10px] font-bold text-red-700 hover:bg-red-100"
      >
        فتح قائمة عدم التطابق <ArrowLeft className="size-3" />
      </a>
    </div>
  );
}

function InvalidReferencesBanner({ items }: { items: InvalidReference[] }) {
  if (items.length === 0) return null;
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  const reasonLabel: Record<InvalidReference["reason"], string> = {
    missing_source_doc: "وثيقة المصدر مفقودة",
    missing_target_doc: "وثيقة الهدف مفقودة",
    missing_source_company: "شركة المصدر محذوفة",
    missing_target_company: "شركة الهدف محذوفة",
  };
  return (
    <div className="mb-3 rounded-lg border border-red-300 bg-red-50 p-3 text-xs text-red-800">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-bold">
          <AlertTriangle className="size-4" />
          INVALID_REFERENCE: تم العثور على {items.length} رابط داخل المجموعة بمراجع مكسورة
        </div>
        <a
          href={`${base}/intercompany`}
          className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2 py-1 text-[10px] font-bold text-red-700 hover:bg-red-100"
        >
          مراجعة في صفحة الروابط <ArrowLeft className="size-3" />
        </a>
      </div>
      <ul className="ms-5 list-disc space-y-0.5">
        {items.slice(0, 5).map((r) => (
          <li key={r.linkId}>
            <span className="font-mono">#{r.linkId}</span> · {reasonLabel[r.reason]} · {r.sourceRef} / {r.targetRef}
          </li>
        ))}
        {items.length > 5 && (
          <li className="text-red-600">… و {items.length - 5} رابط آخر</li>
        )}
      </ul>
    </div>
  );
}

function RowsTable({ rows }: { rows: ConsolidatedRow[] }) {
  return (
    <table className="w-full text-right text-xs">
      <thead className="border-b border-neutral-100 bg-neutral-50 text-[10px] font-medium text-neutral-500">
        <tr>
          <th className="px-3 py-2">الكود</th>
          <th className="px-3 py-2">الحساب</th>
          <th className="px-3 py-2">إجمالي</th>
          <th className="px-3 py-2">استبعاد</th>
          <th className="px-3 py-2">صافي</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-50 text-neutral-700">
        {rows.map((r) => (
          <tr key={r.code} className="hover:bg-neutral-50/50">
            <td className="px-3 py-2 font-mono text-[10px]">{r.code}</td>
            <td className="px-3 py-2">{r.nameAr}</td>
            <td className="px-3 py-2 font-mono">{fmtMoney(r.gross)}</td>
            <td className="px-3 py-2 font-mono text-orange-600">
              {r.eliminated > 0 ? fmtMoney(r.eliminated) : "—"}
            </td>
            <td className="px-3 py-2 font-mono font-bold text-neutral-900">
              {fmtMoney(r.amount)}
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={5} className="px-3 py-4 text-center text-neutral-400">
              لا توجد بيانات في هذا القسم.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function EliminationsTable({ items }: { items: EliminationEntry[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4 rounded-lg border border-neutral-100">
      <div className="border-b border-neutral-100 bg-neutral-50 px-3 py-2 text-xs font-bold text-neutral-700">
        الاستبعادات داخل المجموعة ({items.length})
      </div>
      <table className="w-full text-right text-xs">
        <thead className="bg-neutral-50/50 text-[10px] font-medium text-neutral-500">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">من → إلى</th>
            <th className="px-3 py-2">المرجع</th>
            <th className="px-3 py-2">المصدر</th>
            <th className="px-3 py-2">الهدف</th>
            <th className="px-3 py-2">الفرق</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-50">
          {items.map((e) => (
            <tr
              key={e.linkId}
              className={
                e.imbalance ? "bg-red-50/40 ring-1 ring-inset ring-red-200" : ""
              }
            >
              <td className="px-3 py-2 font-mono text-[10px]">{e.linkId}</td>
              <td className="px-3 py-2 text-[11px]">
                {e.sourceCompanyName} → {e.targetCompanyName}
              </td>
              <td className="px-3 py-2 font-mono text-[10px] text-neutral-500">
                {e.sourceRef} / {e.targetRef}
              </td>
              <td className="px-3 py-2 font-mono">{fmtMoney(e.sourceAmount)}</td>
              <td className="px-3 py-2 font-mono">{fmtMoney(e.targetAmount)}</td>
              <td
                className={`px-3 py-2 font-mono font-bold ${
                  e.imbalance ? "text-red-600" : "text-neutral-500"
                }`}
              >
                {fmtMoney(e.sourceAmount - e.targetAmount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConsolidatedPLView({ data }: { data: PLPayload }) {
  return (
    <div>
      {data.imbalance > 0.01 && <ImbalanceBanner amount={data.imbalance} />}
      <InvalidReferencesBanner items={data.invalidReferences} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-neutral-100">
          <div className="border-b border-neutral-100 bg-emerald-50/50 px-3 py-2 text-xs font-bold text-emerald-700">
            الإيرادات — صافي {fmtMoney(data.totalRevenue)}
          </div>
          <div className="overflow-x-auto">
            <RowsTable rows={data.revenue} />
          </div>
        </div>
        <div className="rounded-lg border border-neutral-100">
          <div className="border-b border-neutral-100 bg-red-50/50 px-3 py-2 text-xs font-bold text-red-700">
            المصروفات — صافي {fmtMoney(data.totalExpense)}
          </div>
          <div className="overflow-x-auto">
            <RowsTable rows={data.expenses} />
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-lg bg-neutral-900 px-4 py-3 text-sm text-white">
        <span>صافي الدخل (موحّد)</span>
        <span className="font-mono font-bold">{fmtMoney(data.netIncome)}</span>
      </div>
      <EliminationsTable items={data.eliminations} />
    </div>
  );
}

function ConsolidatedBSView({ data }: { data: BSPayload }) {
  return (
    <div>
      {data.imbalance > 0.01 && <ImbalanceBanner amount={data.imbalance} />}
      <InvalidReferencesBanner items={data.invalidReferences} />
      {!data.isBalanced && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <AlertTriangle className="size-4" />
          الميزانية غير متوازنة: الأصول {fmtMoney(data.totalAssets)} ≠
          الالتزامات + حقوق الملكية{" "}
          {fmtMoney(data.totalLiabilities + data.totalEquity)}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-neutral-100">
          <div className="border-b border-neutral-100 bg-blue-50/50 px-3 py-2 text-xs font-bold text-blue-700">
            الأصول — صافي {fmtMoney(data.totalAssets)}
          </div>
          <div className="overflow-x-auto">
            <RowsTable rows={data.assets} />
          </div>
        </div>
        <div className="rounded-lg border border-neutral-100">
          <div className="border-b border-neutral-100 bg-orange-50/50 px-3 py-2 text-xs font-bold text-orange-700">
            الالتزامات — صافي {fmtMoney(data.totalLiabilities)}
          </div>
          <div className="overflow-x-auto">
            <RowsTable rows={data.liabilities} />
          </div>
        </div>
        <div className="rounded-lg border border-neutral-100">
          <div className="border-b border-neutral-100 bg-purple-50/50 px-3 py-2 text-xs font-bold text-purple-700">
            حقوق الملكية — صافي {fmtMoney(data.totalEquity)}
          </div>
          <div className="overflow-x-auto">
            <RowsTable rows={data.equity} />
          </div>
        </div>
      </div>
      <EliminationsTable items={data.eliminations} />
    </div>
  );
}

function ConsolidatedCFView({ data }: { data: CFPayload }) {
  return (
    <div className="space-y-4">
      <InvalidReferencesBanner items={data.invalidReferences} />
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
          <p className="text-[10px] text-emerald-700">تدفق داخل</p>
          <p className="mt-1 font-mono text-lg font-bold text-emerald-800">
            {fmtMoney(data.inflow)}
          </p>
        </div>
        <div className="rounded-lg border border-red-100 bg-red-50 p-3">
          <p className="text-[10px] text-red-700">تدفق خارج</p>
          <p className="mt-1 font-mono text-lg font-bold text-red-800">
            {fmtMoney(data.outflow)}
          </p>
        </div>
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
          <p className="text-[10px] text-blue-700">صافي التدفق</p>
          <p className="mt-1 font-mono text-lg font-bold text-blue-800">
            {fmtMoney(data.net)}
          </p>
        </div>
      </div>
      <div className="rounded-lg border border-neutral-100">
        <div className="border-b border-neutral-100 bg-neutral-50 px-3 py-2 text-xs font-bold text-neutral-700">
          حسب المصدر
        </div>
        <table className="w-full text-right text-xs">
          <thead className="text-[10px] font-medium text-neutral-500">
            <tr>
              <th className="px-3 py-2">المصدر</th>
              <th className="px-3 py-2">داخل</th>
              <th className="px-3 py-2">خارج</th>
              <th className="px-3 py-2">صافي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {data.bySource.map((s) => (
              <tr key={s.source}>
                <td className="px-3 py-2">{s.source}</td>
                <td className="px-3 py-2 font-mono">{fmtMoney(s.inflow)}</td>
                <td className="px-3 py-2 font-mono">{fmtMoney(s.outflow)}</td>
                <td className="px-3 py-2 font-mono font-bold">{fmtMoney(s.net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-lg border border-neutral-100">
        <div className="border-b border-neutral-100 bg-neutral-50 px-3 py-2 text-xs font-bold text-neutral-700">
          حسب الشركة
        </div>
        <table className="w-full text-right text-xs">
          <thead className="text-[10px] font-medium text-neutral-500">
            <tr>
              <th className="px-3 py-2">الشركة</th>
              <th className="px-3 py-2">صافي التدفق</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-50">
            {data.byCompany.map((c) => (
              <tr key={c.companyId}>
                <td className="px-3 py-2">{c.companyName}</td>
                <td className="px-3 py-2 font-mono font-bold">
                  {fmtMoney(c.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-neutral-400">
        ملاحظة: لا يتم استبعاد المدفوعات بين الشركات لأنها حركة نقدية فعلية بين
        حسابات بنكية مختلفة.
      </p>
    </div>
  );
}
// ============================================================================

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
        <ConsolidatedReportsSection />

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
