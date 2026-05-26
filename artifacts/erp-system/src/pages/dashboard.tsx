import React, { useMemo, useState } from "react";
import { Money } from "@/components/riyal";
import { motion, type Variants } from "framer-motion";
import {
  useGetDashboardSummary,
  useGetDashboardSalesChart,
  useGetDashboardAlerts,
  useDismissDashboardAlert,
  getGetDashboardAlertsQueryKey,
  useGetBranchPerformance,
  useListDismissedDashboardAlerts,
  useUndismissDashboardAlert,
  getListDismissedDashboardAlertsQueryKey,
  useUploadStorageAttachment,
} from "@workspace/api-client-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { VatThresholdCard } from "@/components/vat-threshold-card";
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
  X,
  EyeOff,
  RotateCcw,
  Paperclip,
  FileText,
  Loader2,
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

function DismissedAlertIcon({ type }: { type: string }) {
  if (type === "danger") return <AlertCircle className="size-4 text-red-500 shrink-0 mt-0.5" />;
  if (type === "warning") return <AlertTriangle className="size-4 text-yellow-500 shrink-0 mt-0.5" />;
  if (type === "success") return <CheckCircle2 className="size-4 text-green-500 shrink-0 mt-0.5" />;
  return <Info className="size-4 text-cyan-500 shrink-0 mt-0.5" />;
}

/**
 * Hard ceiling that mirrors the server-side MAX_ATTACHMENT_BYTES.
 * Keeps the UX from kicking off a doomed upload for huge files.
 */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Read a `File` into the base64 string the upload endpoint expects.
 * Strips the `data:...;base64,` prefix that `FileReader` produces.
 */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("unexpected reader result"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

interface DismissAlertDialogProps {
  open: boolean;
  alertKey: string | null;
  alertTitle: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (payload: {
    justificationNotes?: string;
    attachmentUrl?: string;
  }) => void;
  submitting: boolean;
}

/**
 * Confirmation dialog shown when a finance user hides an alert. Lets
 * them attach an audit-trail justification (free-text note + optional
 * PDF). The PDF is uploaded via POST /storage/attachments BEFORE the
 * dismiss call, so the resulting URL can be persisted on the
 * dismissal row in one atomic write.
 */
function DismissAlertDialog({
  open,
  alertKey,
  alertTitle,
  onOpenChange,
  onConfirm,
  submitting,
}: DismissAlertDialogProps) {
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const uploadAttachment = useUploadStorageAttachment();

  React.useEffect(() => {
    if (!open) {
      setNotes("");
      setFile(null);
      setFileError(null);
      setUploadedUrl(null);
    }
  }, [open, alertKey]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const picked = e.target.files?.[0] ?? null;
    setFileError(null);
    setUploadedUrl(null);
    if (!picked) {
      setFile(null);
      return;
    }
    if (!picked.name.toLowerCase().endsWith(".pdf")) {
      setFile(null);
      setFileError("الملف يجب أن يكون بصيغة PDF.");
      return;
    }
    if (picked.size > MAX_ATTACHMENT_BYTES) {
      setFile(null);
      setFileError("حجم الملف يتجاوز 10 ميجابايت.");
      return;
    }
    setFile(picked);
  };

  const handleConfirm = async (): Promise<void> => {
    let attachmentUrl: string | undefined;
    if (file) {
      try {
        const contentBase64 = await readFileAsBase64(file);
        const result = await uploadAttachment.mutateAsync({
          data: { filename: file.name, contentBase64 },
        });
        attachmentUrl = result.url;
        setUploadedUrl(result.url);
      } catch (err) {
        setFileError(
          err instanceof Error ? err.message : "تعذّر رفع الملف، حاول مرة أخرى.",
        );
        return;
      }
    }
    const trimmed = notes.trim();
    onConfirm({
      justificationNotes: trimmed.length > 0 ? trimmed : undefined,
      attachmentUrl,
    });
  };

  const isBusy = submitting || uploadAttachment.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-dismiss-alert">
        <DialogHeader>
          <DialogTitle>إخفاء التنبيه مع مبرر</DialogTitle>
          <DialogDescription>
            سجّل سبب إخفائك لهذا التنبيه وأرفق المستند الداعم (اختياري) ليُحفظ في سجل التدقيق.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">التنبيه:</span> {alertTitle}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dismiss-notes">ملاحظات المحاسب</Label>
            <Textarea
              id="dismiss-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              placeholder="مثال: تمت تسوية الفرق يدوياً بناءً على إشعار البنك المرفق."
              rows={4}
              data-testid="textarea-dismiss-notes"
            />
            <p className="text-[10px] text-muted-foreground text-left">
              {notes.length}/2000
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dismiss-attachment" className="flex items-center gap-1.5">
              <Paperclip className="size-3.5" />
              مستند داعم (PDF، اختياري)
            </Label>
            <input
              id="dismiss-attachment"
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileChange}
              disabled={isBusy}
              data-testid="input-dismiss-attachment"
              className="block w-full text-xs file:mr-2 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:text-foreground hover:file:bg-muted/80"
            />
            {file && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <FileText className="size-3" />
                {file.name} ({Math.round(file.size / 1024)} كيلوبايت)
              </p>
            )}
            {fileError && (
              <p className="text-[11px] text-red-500" role="alert">
                {fileError}
              </p>
            )}
            {uploadedUrl && (
              <p className="text-[11px] text-green-500">تم رفع الملف بنجاح.</p>
            )}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isBusy}
            data-testid="button-cancel-dismiss"
          >
            إلغاء
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={isBusy}
            data-testid="button-confirm-dismiss"
          >
            {isBusy && <Loader2 className="size-3.5 animate-spin" />}
            تأكيد الإخفاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DismissedAlertsPopover() {
  const queryClient = useQueryClient();
  const { data: dismissed, isLoading } = useListDismissedDashboardAlerts();
  const undismiss = useUndismissDashboardAlert({
    mutation: {
      // Optimistically remove the row from the dismissed list and
      // invalidate the live alerts feed so the alert reappears on
      // its next render (if the underlying condition still holds).
      onMutate: async ({ params }) => {
        const key = params.key;
        const queryKey = getListDismissedDashboardAlertsQueryKey();
        await queryClient.cancelQueries({ queryKey });
        const previous = queryClient.getQueryData<typeof dismissed>(queryKey);
        if (previous) {
          queryClient.setQueryData(
            queryKey,
            previous.filter((d) => d.key !== key),
          );
        }
        return { previous };
      },
      onError: (_err, _vars, ctx) => {
        const queryKey = getListDismissedDashboardAlertsQueryKey();
        if (ctx && "previous" in ctx && ctx.previous) {
          queryClient.setQueryData(queryKey, ctx.previous);
        }
      },
      onSettled: () => {
        queryClient.invalidateQueries({
          queryKey: getListDismissedDashboardAlertsQueryKey(),
        });
        queryClient.invalidateQueries({ queryKey: getGetDashboardAlertsQueryKey() });
      },
    },
  });

  const count = dismissed?.length ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          data-testid="button-dismissed-alerts"
          aria-label="إخفاءات سابقة"
        >
          <EyeOff className="size-3.5" />
          <span>إخفاءات سابقة</span>
          {count > 0 && (
            <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/10 px-1.5 text-[10px] font-medium text-foreground">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 max-h-[60vh] overflow-y-auto p-0"
        data-testid="popover-dismissed-alerts"
      >
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">التنبيهات المخفية</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            تنبيهات أخفيتها من اللوحة، يمكنك إعادة إظهار أي منها.
          </p>
        </div>
        <div className="p-2 space-y-2">
          {isLoading ? (
            Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))
          ) : count === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              لا توجد تنبيهات مخفية حالياً.
            </div>
          ) : (
            dismissed!.map((d) => (
              <div
                key={d.key}
                className="flex gap-2 p-2 rounded-md bg-muted/40 border border-border/50"
                data-testid={`dismissed-alert-${d.key}`}
              >
                <DismissedAlertIcon type={d.type} />
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-medium text-foreground truncate">{d.title}</h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{d.message}</p>
                  {d.justificationNotes && (
                    <div
                      className="mt-1.5 rounded border-l-2 border-cyan-500/40 bg-cyan-500/5 px-2 py-1"
                      data-testid={`dismissed-notes-${d.key}`}
                    >
                      <p className="text-[10px] font-medium text-cyan-500/90">مبرر الإخفاء</p>
                      <p className="text-[11px] text-foreground/90 whitespace-pre-wrap break-words">
                        {d.justificationNotes}
                      </p>
                    </div>
                  )}
                  {d.attachmentUrl && (
                    <a
                      href={d.attachmentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-cyan-500 hover:underline"
                      data-testid={`dismissed-attachment-${d.key}`}
                    >
                      <Paperclip className="size-3" />
                      عرض المستند الداعم (PDF)
                    </a>
                  )}
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    أُخفي في {new Date(d.dismissedAt).toLocaleString("ar-SA")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 gap-1 px-2 text-[11px]"
                  onClick={() => undismiss.mutate({ params: { key: d.key } })}
                  disabled={undismiss.isPending}
                  data-testid={`button-undismiss-${d.key}`}
                  aria-label="إظهار من جديد"
                  title="إظهار من جديد"
                >
                  <RotateCcw className="size-3" />
                  <span>إظهار</span>
                </Button>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary();
  const { data: salesChart, isLoading: isLoadingSales } = useGetDashboardSalesChart({ period: 'monthly' });
  const { data: alerts, isLoading: isLoadingAlerts } = useGetDashboardAlerts();
  const { data: branches, isLoading: isLoadingBranches } = useGetBranchPerformance();
  const queryClient = useQueryClient();
  const [dismissTarget, setDismissTarget] = useState<{
    key: string;
    title: string;
  } | null>(null);
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

      {/* ZATCA SMB threshold counter — visible to all roles that can see /dashboard */}
      <motion.div variants={itemVariants} data-testid="vat-threshold-card">
        <VatThresholdCard />
      </motion.div>

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
              <DismissedAlertsPopover />
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
                      setDismissTarget({ key: alert.key, title: alert.title });
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

      <DismissAlertDialog
        open={dismissTarget !== null}
        alertKey={dismissTarget?.key ?? null}
        alertTitle={dismissTarget?.title ?? ""}
        submitting={dismissAlert.isPending}
        onOpenChange={(open) => {
          if (!open) setDismissTarget(null);
        }}
        onConfirm={({ justificationNotes, attachmentUrl }) => {
          if (!dismissTarget) return;
          dismissAlert.mutate(
            {
              data: {
                key: dismissTarget.key,
                ...(justificationNotes ? { justificationNotes } : {}),
                ...(attachmentUrl ? { attachmentUrl } : {}),
              },
            },
            {
              onSuccess: () => {
                setDismissTarget(null);
                queryClient.invalidateQueries({
                  queryKey: getListDismissedDashboardAlertsQueryKey(),
                });
              },
            },
          );
        }}
      />
    </motion.div>
  );
}
