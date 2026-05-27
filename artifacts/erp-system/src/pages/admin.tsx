import { Fragment, useEffect, useRef, useState } from "react";
import { Money } from "@/components/riyal";
import { useLocation } from "wouter";
import {
  useGetAdminStats,
  useGetAdminSystemHealth,
  useGetAlertsCleanupLastRun,
  useGetAlertsCleanupHistory,
  useCountAlertsCleanupRuns,
  useListSupportTickets,
  useCreateSupportTicket,
  useUpdateSupportTicket,
  useListAnnouncements,
  useCreateAnnouncement,
  useDeleteAnnouncement,
  useListFeatureFlags,
  useUpdateFeatureFlag,
  useGetSystemSettings,
  useUpdateSystemSettings,
  useUpdateAdminPrefs,
  getGetSystemSettingsQueryKey,
  useRunAlertsCleanupNow,
  useSendCleanupReportNow,
  useSendCleanupReportTest,
  useGetCleanupReportTestHistory,
  useGetCleanupReportPreview,
  useListCleanupReportSends,
  useResendCleanupReport,
  useUnsuppressCleanupReportRecipient,
  useListCleanupReportSuppressionExpiries,
  useListPermissionMatrix,
  useSetPermissionCell,
  useListAuditLogs,
  useListAnomalyEvents,
  useUpdateAnomalyEvent,
  useListInvoiceSendFailures,
  useRetryInvoiceSendFailure,
  useListAiModels,
  useTrainAiModel,
  useTrainAllAiModels,
  useGetSalesForecast,
  useGetAtRiskCustomers,
  useGetFraudAnomalies,
  useGetProductRecommendations,
  useAskAiAssistant,
  useListTeamConsents,
  useRequestTeamConsentReconfirm,
  getListTeamConsentsQueryKey,
} from "@workspace/api-client-react";
import type { SupportTicket, TeamConsentRow } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ShieldCheck,
  LifeBuoy,
  Megaphone,
  ToggleRight,
  Activity,
  History,
  Plus,
  Trash2,
  FileDown,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Database,
  Cpu,
  Loader2,
  Send,
  Workflow,
  PlayCircle,
  RotateCw,
  ChevronDown,
  ChevronRight,
  Mail,
  MailX,
  Clock,
  ShieldOff,
  Eye,
  EyeOff,
  UserCheck,
} from "lucide-react";
import { WorkflowTab } from "@/components/workflow-tab";
import { IntegrationsTab } from "@/components/integrations-tab";
import MarketplacesTab from "@/components/marketplaces-tab";
import { CompanySettingsTab } from "@/components/company-settings-tab";
import { CompaniesTable } from "@/components/multi-company/companies-table";
import { Plug, Building2, Briefcase } from "lucide-react";

// Task #260 — owner-only Team Privacy tab. Lists every teammate's
// per-facet audit consent so the owner can spot overly restrictive
// choices that may block legitimate investigations, or coach staff
// who left the prompt at defaults. The "request re-confirm" action
// pings a user (server stamps a flag + writes audit-log) without
// mutating their settings.
function TeamPrivacyTab() {
  const { t, isRTL } = useLanguage();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useListTeamConsents();
  const reqMut = useRequestTeamConsentReconfirm();
  const rows: TeamConsentRow[] = data ?? [];

  const fmtDate = (iso: string | null | undefined) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleString(isRTL ? "ar-SA" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      });
    } catch {
      return iso;
    }
  };

  const requestReconfirm = async (row: TeamConsentRow) => {
    try {
      await reqMut.mutateAsync({ userId: row.userId });
      toast({
        title: t("teamPrivacy.reconfirmRequested", "تم طلب إعادة التأكيد"),
        description: t(
          "teamPrivacy.reconfirmRequestedDesc",
          "سيظهر للمستخدم تنبيه لمراجعة إعدادات الخصوصية.",
        ),
      });
      await qc.invalidateQueries({ queryKey: getListTeamConsentsQueryKey() });
    } catch {
      toast({
        title: t("teamPrivacy.reconfirmFailed", "فشل الطلب"),
        variant: "destructive",
      });
    }
  };

  const countRestrictive = rows.filter(
    (r) =>
      !r.consent.salesDetails ||
      !r.consent.customerPii ||
      !r.consent.locationContext,
  ).length;
  const countDefault = rows.filter((r) => r.isDefault).length;

  const FacetCell = ({ on, label }: { on: boolean; label: string }) => (
    <div
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
        on
          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
          : "bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
      }`}
      data-testid={`facet-${on ? "on" : "off"}`}
    >
      {on ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
      <span>{label}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="size-5 text-primary" />
            {t("teamPrivacy.title", "خصوصية الفريق")}
          </CardTitle>
          <CardDescription>
            {t(
              "teamPrivacy.subtitle",
              "راجع إعدادات الخصوصية التي اختارها كل مستخدم. اطلب إعادة تأكيد الموافقة إذا كانت مقيِّدة أكثر من اللازم أو لم تُعدَّل أبدًا.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <StatCard
            icon={UserCheck}
            label={t("teamPrivacy.totalUsers", "إجمالي الزملاء")}
            value={rows.length}
          />
          <StatCard
            icon={EyeOff}
            label={t("teamPrivacy.restrictive", "إعدادات مقيِّدة")}
            value={countRestrictive}
            tone={countRestrictive > 0 ? "warn" : "ok"}
            hint={t(
              "teamPrivacy.restrictiveHint",
              "مستخدمون أوقفوا ميزة أو أكثر",
            )}
          />
          <StatCard
            icon={AlertTriangle}
            label={t("teamPrivacy.defaults", "لم يُراجَع بعد")}
            value={countDefault}
            tone={countDefault > 0 ? "info" : "ok"}
            hint={t(
              "teamPrivacy.defaultsHint",
              "مستخدمون لم يفتحوا شاشة الخصوصية",
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table data-testid="table-team-consents">
            <TableHeader>
              <TableRow>
                <TableHead>{t("teamPrivacy.user", "المستخدم")}</TableHead>
                <TableHead>{t("teamPrivacy.role", "الدور")}</TableHead>
                <TableHead>
                  {t("teamPrivacy.salesDetails", "تفاصيل المبيعات")}
                </TableHead>
                <TableHead>
                  {t("teamPrivacy.customerPii", "بيانات العملاء")}
                </TableHead>
                <TableHead>
                  {t("teamPrivacy.locationContext", "الموقع/IP")}
                </TableHead>
                <TableHead>
                  {t("teamPrivacy.lastChanged", "آخر تعديل")}
                </TableHead>
                <TableHead className="text-end">
                  {t("teamPrivacy.actions", "إجراء")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    {t(
                      "teamPrivacy.empty",
                      "لا يوجد زملاء في هذه الشركة بعد.",
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const pending = !!row.reconfirmRequestedAt;
                  return (
                    <TableRow
                      key={row.userId}
                      data-testid={`row-team-consent-${row.userId}`}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{row.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {row.email}
                          </span>
                          {!row.isActive && (
                            <Badge variant="outline" className="mt-1 w-fit">
                              {t("teamPrivacy.inactive", "غير نشط")}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{row.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <FacetCell
                          on={row.consent.salesDetails ?? true}
                          label={
                            (row.consent.salesDetails ?? true)
                              ? t("teamPrivacy.visible", "مرئي")
                              : t("teamPrivacy.redacted", "محجوب")
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <FacetCell
                          on={row.consent.customerPii ?? true}
                          label={
                            (row.consent.customerPii ?? true)
                              ? t("teamPrivacy.visible", "مرئي")
                              : t("teamPrivacy.redacted", "محجوب")
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <FacetCell
                          on={row.consent.locationContext ?? true}
                          label={
                            (row.consent.locationContext ?? true)
                              ? t("teamPrivacy.visible", "مرئي")
                              : t("teamPrivacy.redacted", "محجوب")
                          }
                        />
                      </TableCell>
                      <TableCell>
                        {row.lastChangedAt ? (
                          <span className="text-xs text-muted-foreground">
                            {fmtDate(row.lastChangedAt)}
                          </span>
                        ) : (
                          <Badge variant="outline">
                            {t("teamPrivacy.default", "افتراضي")}
                          </Badge>
                        )}
                        {pending && (
                          <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                            {t(
                              "teamPrivacy.pendingReconfirm",
                              "طلب إعادة التأكيد:",
                            )}{" "}
                            {fmtDate(row.reconfirmRequestedAt)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-end">
                        <Button
                          size="sm"
                          variant={pending ? "outline" : "default"}
                          disabled={reqMut.isPending}
                          onClick={() => requestReconfirm(row)}
                          data-testid={`button-request-reconfirm-${row.userId}`}
                        >
                          {pending
                            ? t("teamPrivacy.resend", "إعادة الإرسال")
                            : t(
                                "teamPrivacy.requestReconfirm",
                                "اطلب إعادة التأكيد",
                              )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function AccessDenied() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Card className="max-w-md text-center">
        <CardHeader>
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-rose-100 text-rose-600">
            <ShieldCheck className="size-7" />
          </div>
          <CardTitle className="mt-3">غير مصرح بالدخول</CardTitle>
          <CardDescription>
            هذه اللوحة مخصصة للمدراء فقط. تواصل مع مالك النظام لمنحك الصلاحية.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "warn" | "ok" | "info";
}) {
  const toneClasses = {
    default: "from-slate-50 to-white border-slate-200 text-slate-700",
    warn: "from-amber-50 to-white border-amber-200 text-amber-700",
    ok: "from-emerald-50 to-white border-emerald-200 text-emerald-700",
    info: "from-blue-50 to-white border-blue-200 text-blue-700",
  }[tone];
  return (
    <Card className={`bg-gradient-to-br ${toneClasses}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium opacity-80">{label}</div>
            <div className="mt-1 text-3xl font-bold tabular-nums">{value}</div>
            {hint && <div className="mt-1 text-[11px] opacity-70">{hint}</div>}
          </div>
          <div className="rounded-xl bg-white/70 p-2 shadow-sm">
            <Icon className="size-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InvoiceSendFailuresCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: failures } = useListInvoiceSendFailures();
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const retryMut = useRetryInvoiceSendFailure({
    mutation: {
      onSuccess: () => {
        toast({ title: "تمت إعادة جدولة الإرسال" });
        setInlineError(null);
        void queryClient.invalidateQueries({
          predicate: (q) => {
            const k = q.queryKey?.[0];
            return (
              typeof k === "string" &&
              (k.includes("/admin/invoice-send-failures") ||
                k.includes("/admin/stats") ||
                k.includes("/dashboard/alerts"))
            );
          },
        });
      },
      onError: (err: unknown) => {
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data
            ?.error ?? "تعذّر إعادة الإرسال";
        setInlineError(msg);
      },
      onSettled: () => setPendingId(null),
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Send className="size-4 text-destructive" />
          فواتير فشل إرسالها
        </CardTitle>
        <CardDescription>
          تنبيهات لم تُحلّ بعد بعد استنفاد محاولات الإرسال التلقائي.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {inlineError && (
          <div
            className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
            data-testid="invoice-retry-inline-error"
          >
            {inlineError}
          </div>
        )}
        {failures && failures.length > 0 ? (
          failures.map((f) => (
            <div
              key={f.alertId}
              className="rounded-lg border bg-card p-3 flex items-start justify-between gap-2"
              data-testid={`invoice-failure-${f.alertId}`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-bold truncate">
                  {f.invoiceReference ?? f.title}
                </div>
                <div className="mt-1 text-xs text-muted-foreground" dir="ltr">
                  {f.recipient ?? "—"}
                </div>
                {f.lastError && (
                  <div className="mt-1 text-xs text-rose-600 line-clamp-2">
                    {f.lastError}
                  </div>
                )}
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {new Date(f.createdAt).toLocaleString("ar-SA")}
                </div>
              </div>
              <Button
                size="sm"
                variant="default"
                disabled={
                  !f.retriable ||
                  (retryMut.isPending && pendingId === f.alertId)
                }
                onClick={() => {
                  setPendingId(f.alertId);
                  setInlineError(null);
                  retryMut.mutate({ alertId: f.alertId });
                }}
                data-testid={`button-retry-invoice-${f.alertId}`}
              >
                {retryMut.isPending && pendingId === f.alertId && (
                  <Loader2 className="me-2 size-4 animate-spin" />
                )}
                إعادة المحاولة
              </Button>
            </div>
          ))
        ) : (
          <p className="text-muted-foreground">لا توجد إخفاقات إرسال حالياً.</p>
        )}
      </CardContent>
    </Card>
  );
}

function AlertsCleanupCard() {
  const { data } = useGetAlertsCleanupLastRun();
  const { data: history } = useGetAlertsCleanupHistory();
  // Task #198: pre-fill the cleanup runs date filter from per-admin prefs
  // stored on `users.admin_prefs` so the range survives reloads. We hydrate
  // once when settings first arrive and then debounce-persist any change.
  const { data: settings } = useGetSystemSettings();
  const updatePrefs = useUpdateAdminPrefs();
  const [csvFrom, setCsvFrom] = useState("");
  const [csvTo, setCsvTo] = useState("");
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated) return;
    if (!settings?.adminPrefs) return;
    setCsvFrom(settings.adminPrefs.cleanupRunsFrom ?? "");
    setCsvTo(settings.adminPrefs.cleanupRunsTo ?? "");
    setHydrated(true);
  }, [hydrated, settings]);
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      updatePrefs.mutate({
        data: {
          cleanupRunsFrom: csvFrom ? csvFrom : null,
          cleanupRunsTo: csvTo ? csvTo : null,
        },
      });
    }, 500);
    return () => clearTimeout(t);
    // updatePrefs is stable across renders for our purposes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvFrom, csvTo, hydrated]);
  const lastRunAt = data?.lastRunAt
    ? new Date(data.lastRunAt).toLocaleString("ar-SA")
    : null;
  const runs = history ?? [];
  // Task #175: keep CSV href and the count-preview endpoint in sync by
  // computing the from/to ISO boundaries once and reusing them.
  const csvRange = (() => {
    const params: { from?: string; to?: string } = {};
    if (csvFrom) params.from = new Date(csvFrom).toISOString();
    if (csvTo) {
      // include the whole "to" day by snapping to 23:59:59.999
      const d = new Date(csvTo);
      d.setHours(23, 59, 59, 999);
      params.to = d.toISOString();
    }
    return params;
  })();
  const { data: countData, isFetching: countLoading } =
    useCountAlertsCleanupRuns(csvRange);
  const matchCount = countData?.count;
  const baseHref = (suffix: string) => {
    const base =
      (import.meta.env.BASE_URL || "/").replace(/\/$/, "") +
      `/api/admin/system-settings/alerts-cleanup-runs${suffix}`;
    const qs = new URLSearchParams(csvRange).toString();
    return qs ? `${base}?${qs}` : base;
  };
  const csvHref = baseHref(".csv");
  const pdfHref = baseHref(".pdf");
  const maxDeleted = runs.reduce(
    (m, r) => (r.rowsDeleted > m ? r.rowsDeleted : m),
    0,
  );
  // Render oldest → newest so the bars read left-to-right in time order.
  const chronological = [...runs].reverse();
  return (
    <Card data-testid="card-alerts-cleanup">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <Trash2 className="size-4 text-primary" />
              تنظيف التنبيهات الليلي
            </CardTitle>
            <CardDescription>
              آخر مرة نظّف فيها النظام التنبيهات القديمة المقروءة تلقائياً.
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-1.5">
              <Input
                type="date"
                value={csvFrom}
                onChange={(e) => setCsvFrom(e.target.value)}
                max={csvTo || undefined}
                className="h-8 w-[8.5rem] text-xs"
                aria-label="من تاريخ"
                data-testid="input-alerts-cleanup-csv-from"
              />
              <span className="text-xs text-muted-foreground">إلى</span>
              <Input
                type="date"
                value={csvTo}
                onChange={(e) => setCsvTo(e.target.value)}
                min={csvFrom || undefined}
                className="h-8 w-[8.5rem] text-xs"
                aria-label="إلى تاريخ"
                data-testid="input-alerts-cleanup-csv-to"
              />
              <Button
                asChild
                variant="outline"
                size="sm"
                className="gap-1.5"
                data-testid="button-export-alerts-cleanup-csv"
              >
                <a href={csvHref} download>
                  <FileDown className="size-3.5" />
                  تصدير CSV
                </a>
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="gap-1.5"
                data-testid="button-export-alerts-cleanup-pdf"
              >
                <a href={pdfHref} download>
                  <FileDown className="size-3.5" />
                  تصدير PDF
                </a>
              </Button>
            </div>
            <div
              className="text-[11px] text-muted-foreground tabular-nums"
              data-testid="alerts-cleanup-csv-count"
            >
              {countLoading || matchCount === undefined
                ? "—"
                : `${matchCount.toLocaleString("ar-SA")} تشغيل في هذا النطاق`}
            </div>
            {(csvFrom || csvTo) && (
              <button
                type="button"
                onClick={() => {
                  setCsvFrom("");
                  setCsvTo("");
                }}
                className="text-[11px] text-muted-foreground hover:text-foreground"
                data-testid="button-alerts-cleanup-csv-reset"
              >
                إعادة تعيين النطاق (كل الفترات)
              </button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span>آخر تشغيل</span>
          <span
            className="font-mono text-xs text-muted-foreground"
            data-testid="alerts-cleanup-last-run-at"
          >
            {lastRunAt ?? "لم يُشغَّل بعد"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>التنبيهات المحذوفة</span>
          <span
            className="font-bold tabular-nums"
            data-testid="alerts-cleanup-rows-deleted"
          >
            {data?.rowsDeleted ?? "—"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span>نافذة الاحتفاظ</span>
          <Badge variant="outline" data-testid="alerts-cleanup-retention-days">
            {data?.retentionDays ?? 90} يوم
          </Badge>
        </div>
        {chronological.length > 0 && (
          <div
            className="space-y-1.5 pt-1"
            data-testid="alerts-cleanup-history"
          >
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>آخر {chronological.length} تشغيل</span>
              <span className="tabular-nums">
                الذروة: {maxDeleted.toLocaleString("ar-SA")}
              </span>
            </div>
            <div
              className="flex h-12 items-end gap-0.5"
              dir="ltr"
              aria-label="سجل آخر عمليات التنظيف"
            >
              {chronological.map((r, i) => {
                const pct =
                  maxDeleted > 0 ? (r.rowsDeleted / maxDeleted) * 100 : 0;
                const ranAt = new Date(r.ranAt).toLocaleString("ar-SA");
                return (
                  <div
                    key={`${r.ranAt}-${i}`}
                    className="flex-1 rounded-sm bg-primary/70 transition-colors hover:bg-primary"
                    style={{ height: `${Math.max(pct, 4)}%` }}
                    title={`${ranAt} — حُذف ${r.rowsDeleted}`}
                    data-testid={`alerts-cleanup-history-bar-${i}`}
                  />
                );
              })}
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">
          يحذف التنبيهات المقروءة الأقدم من نافذة الاحتفاظ كل ليلة.
        </p>
      </CardContent>
    </Card>
  );
}

function OverviewTab() {
  const { data: stats } = useGetAdminStats();
  const { data: health } = useGetAdminSystemHealth();
  const { data: announcements } = useListAnnouncements();
  const { data: anomalies } = useListAnomalyEvents({ status: "open", limit: 5 });
  const queryClient = useQueryClient();
  const ackAnomaly = useUpdateAnomalyEvent({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["/api/anomalies/events"] });
      },
    },
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          icon={LifeBuoy}
          label="تذاكر مفتوحة"
          value={stats?.openTickets ?? "—"}
          hint={`${stats?.criticalTickets ?? 0} حرجة`}
          tone={stats && stats.criticalTickets > 0 ? "warn" : "default"}
        />
        <StatCard
          icon={CheckCircle2}
          label="حُلّت اليوم"
          value={stats?.resolvedToday ?? "—"}
          tone="ok"
        />
        <StatCard
          icon={Activity}
          label="مستخدمون نشطون"
          value={stats?.activeUsers ?? "—"}
          hint={`من أصل ${stats?.totalUsers ?? 0}`}
          tone="info"
        />
        <StatCard
          icon={ToggleRight}
          label="ميزات مفعّلة"
          value={`${stats?.enabledFeatures ?? 0}/${stats?.totalFeatures ?? 0}`}
        />
        <StatCard
          icon={AlertTriangle}
          label="فواتير فشل إرسالها"
          value={stats?.failedInvoiceSends ?? "—"}
          hint="تحتاج مراجعة المدير"
          tone={stats && stats.failedInvoiceSends > 0 ? "warn" : "default"}
        />
        <StatCard
          icon={AlertTriangle}
          label="رسائل بريد مرتدّة"
          value={stats?.bouncedEmails ?? "—"}
          hint="خلال آخر 30 يوماً (كل الإرسالات)"
          tone={stats && stats.bouncedEmails > 0 ? "warn" : "default"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="size-4 text-primary" />
              صحة النظام
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Database className="size-4" /> قاعدة البيانات
              </span>
              {health?.databaseOk ? (
                <Badge className="bg-emerald-100 text-emerald-700">
                  متصلة • {health.databaseLatencyMs}ms
                </Badge>
              ) : (
                <Badge className="bg-rose-100 text-rose-700">منقطعة</Badge>
              )}
            </div>
            <div className="flex items-center justify-between">
              <span>وقت تشغيل الخادم</span>
              <span className="font-mono">
                {health ? Math.round(health.uptimeSeconds / 60) : 0} دقيقة
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>استخدام الذاكرة</span>
              <span className="font-mono">
                {health?.memoryUsedMb ?? 0} MB
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>الإصدار</span>
              <span className="font-mono">v{health?.appVersion}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>البيئة</span>
              <Badge variant="outline">{health?.environment}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Node</span>
              <span className="font-mono text-xs text-muted-foreground">
                {health?.nodeVersion}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-destructive" />
              تنبيهات نشطة (سلوك شاذ)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {anomalies && anomalies.length > 0 ? (
              anomalies.map((a) => (
                <div
                  key={a.id}
                  className="rounded-lg border bg-card p-3 flex items-start justify-between gap-2"
                  data-testid={`admin-anomaly-${a.id}`}
                >
                  <div className="min-w-0">
                    <div className="font-bold flex items-center gap-2">
                      {a.ruleName}
                      <Badge
                        variant={
                          a.severity === "critical" || a.severity === "high"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {a.severity}
                      </Badge>
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                      {a.actorName ?? "—"} • {new Date(a.createdAt).toLocaleString("ar-SA")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() =>
                      ackAnomaly.mutate({ id: a.id, data: { status: "acknowledged" } })
                    }
                    disabled={ackAnomaly.isPending}
                    data-testid={`admin-ack-anomaly-${a.id}`}
                  >
                    إقرار
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">لا توجد تنبيهات مفتوحة.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="size-4 text-primary" />
              آخر الإعلانات
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {announcements && announcements.length > 0 ? (
              announcements.slice(0, 4).map((a) => (
                <div
                  key={a.id}
                  className="rounded-lg border bg-card p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-bold">{a.title}</div>
                    <Badge variant={a.isActive ? "default" : "secondary"}>
                      {a.type}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {a.message}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">لا توجد إعلانات</p>
            )}
          </CardContent>
        </Card>

        <InvoiceSendFailuresCard />

        <AlertsCleanupCard />

        <AlertRetentionCard />
        <CleanupReportEmailCard />
      </div>
    </div>
  );
}

const PRIORITY_TONE: Record<string, string> = {
  critical: "bg-rose-100 text-rose-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-slate-100 text-slate-700",
};

const STATUS_TONE: Record<string, string> = {
  open: "bg-blue-100 text-blue-700",
  in_progress: "bg-amber-100 text-amber-700",
  resolved: "bg-emerald-100 text-emerald-700",
};

function TicketsTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<string>("all");
  const { data: tickets } = useListSupportTickets(
    filter === "all" ? undefined : { status: filter },
  );
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [reply, setReply] = useState("");
  const updateMut = useUpdateSupportTicket();

  const refresh = () => {
    queryClient.invalidateQueries({ predicate: (q) => {
      const k = q.queryKey?.[0];
      return typeof k === "string" && (k.includes("/admin/tickets") || k.includes("/admin/stats"));
    } });
  };

  const handleResolve = async (ticket: SupportTicket, status: "open" | "in_progress" | "resolved") => {
    await updateMut.mutateAsync({
      id: ticket.id,
      data: { status, ...(reply && ticket.id === selected?.id ? { reply } : {}) },
    });
    toast({ title: "تم تحديث التذكرة" });
    setSelected(null);
    setReply("");
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-sm">حالة:</Label>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">الكل</SelectItem>
              <SelectItem value="open">مفتوحة</SelectItem>
              <SelectItem value="in_progress">قيد المعالجة</SelectItem>
              <SelectItem value="resolved">محلولة</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <CreateTicketDialog onCreated={refresh} />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموضوع</TableHead>
                <TableHead>العميل</TableHead>
                <TableHead>الأولوية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead className="text-end">إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                    لا توجد تذاكر
                  </TableCell>
                </TableRow>
              )}
              {tickets?.map((t) => (
                <TableRow key={t.id} data-testid={`ticket-row-${t.id}`}>
                  <TableCell className="max-w-[260px]">
                    <div className="truncate font-medium">{t.subject}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t.message}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{t.customerName}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">
                      {t.customerEmail}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={PRIORITY_TONE[t.priority] ?? ""}>
                      {t.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_TONE[t.status] ?? ""}>
                      {t.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(t.createdAt).toLocaleDateString("ar-SA")}
                  </TableCell>
                  <TableCell className="text-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelected(t);
                        setReply(t.reply ?? "");
                      }}
                      data-testid={`button-open-ticket-${t.id}`}
                    >
                      فتح
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.subject}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-bold">{selected.customerName}</span>
                  <span className="text-xs text-muted-foreground" dir="ltr">
                    {selected.customerEmail}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {selected.message}
                </p>
              </div>
              <div>
                <Label htmlFor="reply" className="mb-2 block">
                  ردّك للعميل
                </Label>
                <Textarea
                  id="reply"
                  rows={4}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="اكتب ردك هنا..."
                  data-testid="textarea-reply"
                />
              </div>
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleResolve(selected, "in_progress")}
                  disabled={updateMut.isPending}
                  data-testid="button-mark-in-progress"
                >
                  قيد المعالجة
                </Button>
                <Button
                  onClick={() => handleResolve(selected, "resolved")}
                  disabled={updateMut.isPending}
                  data-testid="button-mark-resolved"
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <Send className="me-2 size-4" />
                  إرسال الرد وإغلاق
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateTicketDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const createMut = useCreateSupportTicket();
  const [form, setForm] = useState({
    subject: "",
    message: "",
    customerName: "",
    customerEmail: "",
    priority: "medium",
    category: "general",
  });

  const submit = async () => {
    try {
      await createMut.mutateAsync({ data: form });
      toast({ title: "تم إنشاء التذكرة" });
      setOpen(false);
      setForm({ subject: "", message: "", customerName: "", customerEmail: "", priority: "medium", category: "general" });
      onCreated();
    } catch {
      toast({ title: "فشل الإنشاء", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-create-ticket">
          <Plus className="me-2 size-4" />
          تذكرة جديدة
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>إنشاء تذكرة دعم</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>اسم العميل</Label>
              <Input
                value={form.customerName}
                onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                data-testid="input-customer-name"
              />
            </div>
            <div>
              <Label>البريد الإلكتروني</Label>
              <Input
                type="email"
                dir="ltr"
                value={form.customerEmail}
                onChange={(e) => setForm({ ...form, customerEmail: e.target.value })}
                data-testid="input-customer-email"
              />
            </div>
          </div>
          <div>
            <Label>الموضوع</Label>
            <Input
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              data-testid="input-subject"
            />
          </div>
          <div>
            <Label>الرسالة</Label>
            <Textarea
              rows={4}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              data-testid="textarea-message"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>الأولوية</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">منخفضة</SelectItem>
                  <SelectItem value="medium">متوسطة</SelectItem>
                  <SelectItem value="high">عالية</SelectItem>
                  <SelectItem value="critical">حرجة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>الفئة</Label>
              <Input
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={createMut.isPending} data-testid="button-submit-ticket">
            {createMut.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
            إنشاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AnnouncementsTab() {
  const { data: announcements } = useListAnnouncements();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createMut = useCreateAnnouncement();
  const deleteMut = useDeleteAnnouncement();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "",
    message: "",
    type: "info",
    expiresAt: "",
  });

  const refresh = () =>
    queryClient.invalidateQueries({ predicate: (q) => {
      const k = q.queryKey?.[0];
      return typeof k === "string" && (k.includes("/admin/announcements") || k.includes("/admin/stats"));
    } });

  const submit = async () => {
    try {
      await createMut.mutateAsync({
        data: {
          title: form.title,
          message: form.message,
          type: form.type,
          expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        },
      });
      toast({ title: "تم نشر الإعلان" });
      setOpen(false);
      setForm({ title: "", message: "", type: "info", expiresAt: "" });
      refresh();
    } catch {
      toast({ title: "فشل النشر", variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("حذف هذا الإعلان؟")) return;
    await deleteMut.mutateAsync({ id });
    toast({ title: "تم الحذف" });
    refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-announcement">
              <Plus className="me-2 size-4" />
              إعلان جديد
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>نشر إعلان</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>العنوان</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  data-testid="input-announcement-title"
                />
              </div>
              <div>
                <Label>الرسالة</Label>
                <Textarea
                  rows={4}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  data-testid="textarea-announcement-message"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>النوع</Label>
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="info">معلومات</SelectItem>
                      <SelectItem value="update">تحديث</SelectItem>
                      <SelectItem value="maintenance">صيانة</SelectItem>
                      <SelectItem value="warning">تحذير</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>تاريخ الانتهاء (اختياري)</Label>
                  <Input
                    type="datetime-local"
                    value={form.expiresAt}
                    onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button onClick={submit} disabled={createMut.isPending} data-testid="button-publish-announcement">
                {createMut.isPending && <Loader2 className="me-2 size-4 animate-spin" />}
                نشر
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {announcements?.length === 0 && (
          <Card><CardContent className="p-8 text-center text-muted-foreground">لا توجد إعلانات</CardContent></Card>
        )}
        {announcements?.map((a) => (
          <Card key={a.id} data-testid={`announcement-${a.id}`}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-bold">{a.title}</div>
                  <div className="mt-1 flex flex-wrap gap-1 text-xs">
                    <Badge variant={a.isActive ? "default" : "secondary"}>{a.type}</Badge>
                    {a.expiresAt && (
                      <Badge variant="outline">
                        ينتهي {new Date(a.expiresAt).toLocaleDateString("ar-SA")}
                      </Badge>
                    )}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                  onClick={() => handleDelete(a.id)}
                  data-testid={`button-delete-announcement-${a.id}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">{a.message}</p>
              <div className="text-[11px] text-muted-foreground">
                نُشر {new Date(a.publishedAt).toLocaleString("ar-SA")}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function PermissionsMatrixTab() {
  const { data: matrix, isLoading } = useListPermissionMatrix();
  const setMut = useSetPermissionCell();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const ROLE_LABELS: Record<string, string> = {
    owner: "المالك",
    manager: "مدير",
    accountant: "محاسب",
    sales: "مبيعات",
    cashier: "كاشير",
    inventory: "مخزون",
    marketing: "تسويق",
    auditor: "مراجع",
    hr: "موارد بشرية",
    production: "إنتاج",
  };
  const KEY_LABELS: Record<string, string> = {
    dashboard: "لوحة القيادة",
    pos: "نقاط البيع",
    products: "المنتجات",
    invoices: "فواتير الموردين",
    customers: "العملاء",
    accounting: "المحاسبة",
    reports: "التقارير",
    reports_builder: "منشئ التقارير",
    reports_saved: "التقارير المحفوظة",
    my_dashboard: "لوحتي",
    projects: "المشاريع",
    marketing: "التسويق",
    branches: "الفروع",
    transfers: "التحويلات",
    stocktake: "الجرد",
    reorder: "إعادة الطلب",
    procurement: "المشتريات",
    sales: "المبيعات",
    crm: "إدارة العملاء",
    users: "المستخدمون",
    admin: "لوحة الإدارة",
    hr: "الموارد البشرية",
    manufacturing: "التصنيع",
    approvals: "الموافقات",
    settings: "الإعدادات",
  };

  if (isLoading || !matrix) {
    return <div className="text-sm text-muted-foreground">جارٍ التحميل…</div>;
  }

  const overrideMap = new Map<string, boolean>();
  for (const o of matrix.overrides) overrideMap.set(`${o.role}::${o.permissionKey}`, o.enabled);

  const isEnabled = (role: string, key: string) => {
    const ov = overrideMap.get(`${role}::${key}`);
    if (ov !== undefined) return ov;
    return matrix.defaults[key]?.includes(role) ?? false;
  };

  const handleToggle = async (role: string, permissionKey: string, enabled: boolean) => {
    await setMut.mutateAsync({ data: { role, permissionKey, enabled } });
    toast({ title: enabled ? "تم تفعيل الصلاحية" : "تم إيقاف الصلاحية" });
    queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey?.[0];
        return typeof k === "string" && k.includes("/admin/permissions");
      },
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">مصفوفة الصلاحيات حسب الدور</CardTitle>
          <CardDescription>
            فعّل أو أوقف وصول كل دور إلى كل وحدة. هذه الإعدادات تتحكم في رؤية القوائم
            والصفحات. حماية كتابة العمليات الحساسة محفوظة على الخادم بشكل دائم.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="sticky right-0 bg-background p-2 text-right font-bold">الوحدة</th>
                {matrix.roles.map((r) => (
                  <th key={r} className="p-2 text-center font-medium text-muted-foreground whitespace-nowrap">
                    {ROLE_LABELS[r] ?? r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.permissionKeys.map((key) => (
                <tr key={key} className="border-b hover:bg-muted/40">
                  <td className="sticky right-0 bg-background p-2 font-medium whitespace-nowrap">
                    {KEY_LABELS[key] ?? key}
                  </td>
                  {matrix.roles.map((role) => (
                    <td key={role} className="p-2 text-center">
                      <Switch
                        checked={isEnabled(role, key)}
                        onCheckedChange={(v) => handleToggle(role, key, v)}
                        data-testid={`perm-${role}-${key}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function formatRelativeArabic(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "قبل لحظات";
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.round(hours / 24);
  return `قبل ${days} يوم`;
}

function AlertRetentionCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: settings } = useGetSystemSettings();
  const updateMut = useUpdateSystemSettings({
    mutation: {
      onSuccess: () => {
        toast({ title: "تم حفظ مدة الاحتفاظ" });
        void queryClient.invalidateQueries({
          predicate: (q) => {
            const k = q.queryKey?.[0];
            return typeof k === "string" && k.includes("/admin/system-settings");
          },
        });
      },
      onError: () => {
        toast({ title: "تعذّر حفظ الإعداد", variant: "destructive" });
      },
    },
  });
  const runCleanupMut = useRunAlertsCleanupNow({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "تم تشغيل التنظيف",
          description: `تم حذف ${data.deleted} تنبيه (المدة ${data.retentionDays} يوم).`,
        });
      },
      onError: () => {
        toast({ title: "تعذّر تشغيل التنظيف", variant: "destructive" });
      },
    },
  });

  const options = [
    { value: "default", label: "افتراضي (90 يوم)" },
    { value: "30", label: "30 يوم" },
    { value: "60", label: "60 يوم" },
    { value: "90", label: "90 يوم" },
    { value: "180", label: "180 يوم" },
    { value: "365", label: "365 يوم" },
  ];

  const auditKeepOptions = [
    { value: "default", label: "افتراضي (365 سجل)" },
    { value: "30", label: "30 سجل" },
    { value: "90", label: "90 سجل" },
    { value: "180", label: "180 سجل" },
    { value: "365", label: "365 سجل" },
    { value: "730", label: "730 سجل" },
    { value: "1095", label: "1095 سجل" },
  ];

  const currentValue =
    settings?.alertRetentionDays != null
      ? String(settings.alertRetentionDays)
      : "default";

  const currentAuditKeep =
    settings?.cleanupAuditKeepRuns != null
      ? String(settings.cleanupAuditKeepRuns)
      : "default";

  const sourceLabel: Record<string, string> = {
    db: "محفوظ في قاعدة البيانات",
    env: "متغيّر بيئة",
    default: "القيمة الافتراضية",
  };

  return (
    <Card data-testid="card-alert-retention">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-primary" />
          مدة الاحتفاظ بالتنبيهات القديمة
        </CardTitle>
        <CardDescription>
          يحذف النظام تلقائياً التنبيهات المقروءة الأقدم من هذه المدة كل ليلة.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Label className="min-w-32">المدة الحالية</Label>
          <Select
            value={currentValue}
            onValueChange={(v) => {
              const next = v === "default" ? null : Number(v);
              updateMut.mutate({ data: { alertRetentionDays: next } });
            }}
            disabled={updateMut.isPending}
          >
            <SelectTrigger className="w-56" data-testid="select-alert-retention">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {updateMut.isPending && <Loader2 className="size-4 animate-spin" />}
        </div>
        {settings && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            ينفّذ التنظيف القادم باستخدام{" "}
            <span className="font-bold tabular-nums text-foreground">
              {settings.effectiveAlertRetentionDays} يوم
            </span>{" "}
            ({sourceLabel[settings.source] ?? settings.source}).
            {settings.envOverride != null && settings.source !== "env" && (
              <>
                {" "}
                متغيّر البيئة المضبوط: {settings.envOverride} يوم.
              </>
            )}
          </div>
        )}
        {settings?.lastAlertSweep && (
          <div
            className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
            data-testid="text-last-alert-sweep"
          >
            آخر تنظيف: حُذف{" "}
            <span className="font-bold tabular-nums text-foreground">
              {settings.lastAlertSweep.deleted}
            </span>{" "}
            تنبيه{" "}
            <span title={new Date(settings.lastAlertSweep.runAt).toLocaleString("ar-SA")}>
              {formatRelativeArabic(settings.lastAlertSweep.runAt)}
            </span>
            {" "}(باستخدام {settings.lastAlertSweep.retentionDays} يوم).
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <Label className="min-w-32">عدد سجلات التنظيف المحفوظة</Label>
          <Select
            value={currentAuditKeep}
            onValueChange={(v) => {
              const next = v === "default" ? null : Number(v);
              updateMut.mutate({ data: { cleanupAuditKeepRuns: next } });
            }}
            disabled={updateMut.isPending}
          >
            <SelectTrigger
              className="w-56"
              data-testid="select-cleanup-audit-keep"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {auditKeepOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {settings && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            يحتفظ النظام بآخر{" "}
            <span className="font-bold tabular-nums text-foreground">
              {settings.effectiveCleanupAuditKeepRuns} سجل
            </span>{" "}
            من سجلات تنظيف التنبيهات (الافتراضي{" "}
            {settings.cleanupAuditKeepDefault}). الحد الأدنى{" "}
            {settings.cleanupAuditKeepMin} والأقصى{" "}
            {settings.cleanupAuditKeepMax}.
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => runCleanupMut.mutate()}
            disabled={runCleanupMut.isPending || updateMut.isPending}
            data-testid="button-run-alerts-cleanup"
          >
            {runCleanupMut.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <PlayCircle className="size-4" />
            )}
            تشغيل التنظيف الآن
          </Button>
          <span className="text-xs text-muted-foreground">
            لتطبيق المدة الجديدة فوراً بدلاً من انتظار التشغيل الليلي.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function CleanupReportEmailCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: settings } = useGetSystemSettings();
  const updateMut = useUpdateSystemSettings({
    mutation: {
      onSuccess: () => {
        toast({ title: "تم حفظ إعدادات التقرير" });
        void queryClient.invalidateQueries({
          predicate: (q) => {
            const k = q.queryKey?.[0];
            return typeof k === "string" && k.includes("/admin/system-settings");
          },
        });
      },
      onError: () => {
        toast({ title: "تعذّر حفظ الإعداد", variant: "destructive" });
      },
    },
  });
  const rememberedTestEmail = settings?.cleanupReportLastTestRecipient ?? "";
  const [testEmail, setTestEmail] = useState(rememberedTestEmail);
  const [testEmailTouched, setTestEmailTouched] = useState(false);
  const [testEmailError, setTestEmailError] = useState<string | null>(null);
  const invalidateSends = () =>
    queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey?.[0];
        return (
          typeof k === "string" &&
          k.includes("/admin/system-settings/cleanup-report-sends")
        );
      },
    });
  // Task #194: pre-fill the test recipient with the last value this admin
  // successfully sent a test to. Only sync from the server while the admin
  // hasn't started editing, so we don't fight their typing.
  useEffect(() => {
    if (!testEmailTouched) {
      setTestEmail(rememberedTestEmail);
    }
  }, [rememberedTestEmail, testEmailTouched]);
  const sendTestMut = useSendCleanupReportTest({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "تم إرسال البريد التجريبي",
          description: `إلى ${data.recipient} (${data.rowCount ?? 0} عملية تنظيف).`,
        });
        // Let the server tell us what was remembered (the override email, or
        // null if the admin explicitly cleared it) and re-sync from there.
        setTestEmailTouched(false);
        setTestEmailError(null);
        void invalidateSends();
        // Task #194: refresh system-settings so the remembered test recipient
        // (added/cleared by the server) flows back into the input.
        void queryClient.invalidateQueries({
          predicate: (q) => {
            const k = q.queryKey?.[0];
            return typeof k === "string" && k.includes("/admin/system-settings");
          },
        });
      },
      onError: (err: unknown) => {
        void invalidateSends();
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data
            ?.error ?? "تعذّر إرسال البريد التجريبي";
        toast({ title: msg, variant: "destructive" });
      },
    },
  });
  const sendTestEmail = () => {
    const v = testEmail.trim().toLowerCase();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setTestEmailError("بريد إلكتروني غير صحيح");
      return;
    }
    setTestEmailError(null);
    sendTestMut.mutate({ data: v ? { recipient: v } : {} });
  };
  const sendNowMut = useSendCleanupReportNow({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "تم إرسال التقرير",
          description: `إلى ${data.recipients?.length ?? 0} مستلم (${data.rowCount ?? 0} عملية تنظيف).`,
        });
        void queryClient.invalidateQueries({
          predicate: (q) => {
            const k = q.queryKey?.[0];
            return typeof k === "string" && k.includes("/admin/system-settings");
          },
        });
      },
      onError: (err: unknown) => {
        void invalidateSends();
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data
            ?.error ?? "تعذّر إرسال التقرير";
        toast({ title: msg, variant: "destructive" });
      },
    },
  });

  const schedule = settings?.cleanupReportSchedule ?? "off";
  const recipients = settings?.cleanupReportRecipients ?? [];
  const lastSentAt = settings?.cleanupReportLastSentAt ?? null;
  const savedSubject = settings?.cleanupReportSubject ?? "";
  const savedIntro = settings?.cleanupReportIntro ?? "";
  const suppressions = settings?.cleanupReportSuppressions ?? [];
  const suppressionThreshold =
    settings?.cleanupReportSuppressionThreshold ?? 3;
  const suppressionMaxAgeDays =
    settings?.cleanupReportSuppressionMaxAgeDays ?? 30;
  // Task #231 — separate the raw per-tenant override (which may be null
  // when the tenant hasn't customised it) from the effective value above.
  // The numeric input pre-fills with the override; the placeholder shows
  // the env-derived default so admins know what they'll fall back to.
  const suppressionMaxAgeOverride =
    settings?.cleanupReportSuppressionMaxAgeDaysOverride ?? null;
  const suppressionMaxAgeDefault =
    settings?.cleanupReportSuppressionMaxAgeDaysDefault ?? 30;
  const suppressionMaxAgeMax =
    settings?.cleanupReportSuppressionMaxAgeDaysMax ?? 365;
  const [suppressionMaxAgeDraft, setSuppressionMaxAgeDraft] = useState<string>(
    suppressionMaxAgeOverride == null ? "" : String(suppressionMaxAgeOverride),
  );
  const [suppressionMaxAgeError, setSuppressionMaxAgeError] = useState<
    string | null
  >(null);
  useEffect(() => {
    setSuppressionMaxAgeDraft(
      suppressionMaxAgeOverride == null
        ? ""
        : String(suppressionMaxAgeOverride),
    );
    setSuppressionMaxAgeError(null);
  }, [suppressionMaxAgeOverride]);
  const suppressionMaxAgeDirty =
    suppressionMaxAgeDraft.trim() !==
    (suppressionMaxAgeOverride == null ? "" : String(suppressionMaxAgeOverride));
  const saveSuppressionMaxAge = () => {
    const raw = suppressionMaxAgeDraft.trim();
    if (raw === "") {
      setSuppressionMaxAgeError(null);
      updateMut.mutate({
        data: { cleanupReportSuppressionMaxAgeDays: null },
      });
      return;
    }
    const parsed = Number(raw);
    if (
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < 0 ||
      parsed > suppressionMaxAgeMax
    ) {
      setSuppressionMaxAgeError(
        `أدخل عدداً صحيحاً بين 0 و${suppressionMaxAgeMax}`,
      );
      return;
    }
    setSuppressionMaxAgeError(null);
    updateMut.mutate({
      data: { cleanupReportSuppressionMaxAgeDays: parsed },
    });
  };
  const resetSuppressionMaxAge = () => {
    setSuppressionMaxAgeError(null);
    updateMut.mutate({
      data: { cleanupReportSuppressionMaxAgeDays: null },
    });
  };
  const suppressedSet = new Set(
    suppressions.map((s) => s.email.toLowerCase()),
  );
  const [draft, setDraft] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [inputWarning, setInputWarning] = useState<string | null>(null);
  const unsuppressMut = useUnsuppressCleanupReportRecipient({
    mutation: {
      onSuccess: (data) => {
        toast({
          title: "تمت إعادة تفعيل العنوان",
          description: data.email,
        });
        void queryClient.invalidateQueries({
          predicate: (q) => {
            const k = q.queryKey?.[0];
            return typeof k === "string" && k.includes("/admin/system-settings");
          },
        });
      },
      onError: (err: unknown) => {
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data
            ?.error ?? "تعذّر إعادة التفعيل";
        toast({ title: msg, variant: "destructive" });
      },
    },
  });
  const [subjectDraft, setSubjectDraft] = useState<string>(savedSubject);
  const [introDraft, setIntroDraft] = useState<string>(savedIntro);

  // Sync local drafts when the server-side values change (initial load or
  // after a successful save).
  useEffect(() => {
    setSubjectDraft(savedSubject);
  }, [savedSubject]);
  useEffect(() => {
    setIntroDraft(savedIntro);
  }, [savedIntro]);

  const subjectDirty = subjectDraft !== savedSubject;
  const introDirty = introDraft !== savedIntro;
  const textDirty = subjectDirty || introDirty;

  const saveText = () => {
    updateMut.mutate({
      data: {
        ...(subjectDirty ? { cleanupReportSubject: subjectDraft.trim() || null } : {}),
        ...(introDirty ? { cleanupReportIntro: introDraft.trim() || null } : {}),
      },
    });
  };

  const resetText = () => {
    updateMut.mutate({
      data: { cleanupReportSubject: null, cleanupReportIntro: null },
    });
  };

  const addRecipient = () => {
    const v = draft.trim().toLowerCase();
    if (!v) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      setInputError("بريد إلكتروني غير صحيح");
      return;
    }
    if (recipients.includes(v)) {
      setInputError("هذا البريد مضاف مسبقاً");
      return;
    }
    // Task #223: warn-then-confirm when an address still on the
    // suppression list is being re-added. The send loop will skip it
    // anyway until an admin clears the suppression, so adding it back
    // silently is a foot-gun.
    if (suppressedSet.has(v) && inputWarning !== v) {
      setInputError(null);
      setInputWarning(v);
      return;
    }
    setInputError(null);
    setInputWarning(null);
    setDraft("");
    updateMut.mutate({
      data: { cleanupReportRecipients: [...recipients, v] },
    });
  };

  const removeRecipient = (email: string) => {
    updateMut.mutate({
      data: {
        cleanupReportRecipients: recipients.filter((r) => r !== email),
      },
    });
  };

  return (
    <Card data-testid="card-cleanup-report-email">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Send className="size-4 text-primary" />
          إرسال تقرير التنظيف بالبريد تلقائياً
        </CardTitle>
        <CardDescription>
          يرسل النظام نفس ملف PDF الذي تنزّله يدوياً (مع نفس النطاق الزمني)
          إلى المراجعين والمدققين على جدول دوري.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Label className="min-w-32">الجدولة</Label>
          <Select
            value={schedule}
            onValueChange={(v) =>
              updateMut.mutate({
                data: {
                  cleanupReportSchedule: v as
                    | "off"
                    | "weekly"
                    | "monthly",
                },
              })
            }
            disabled={updateMut.isPending}
          >
            <SelectTrigger
              className="w-56"
              data-testid="select-cleanup-report-schedule"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">معطّلة</SelectItem>
              <SelectItem value="weekly">أسبوعياً (آخر 7 أيام)</SelectItem>
              <SelectItem value="monthly">شهرياً (آخر 30 يوم)</SelectItem>
            </SelectContent>
          </Select>
          {updateMut.isPending && <Loader2 className="size-4 animate-spin" />}
        </div>

        <div className="space-y-2">
          <Label>المستلمون</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="email"
              placeholder="audit@example.com"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (inputError) setInputError(null);
                if (inputWarning) setInputWarning(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addRecipient();
                }
              }}
              className="h-9 max-w-xs"
              dir="ltr"
              data-testid="input-cleanup-report-recipient"
            />
            <Button
              type="button"
              size="sm"
              onClick={addRecipient}
              disabled={updateMut.isPending || !draft.trim()}
              data-testid="button-add-cleanup-report-recipient"
            >
              <Plus className="me-1 size-4" />
              إضافة
            </Button>
          </div>
          {inputError && (
            <div className="text-xs text-rose-600">{inputError}</div>
          )}
          {inputWarning && (
            <div
              className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
              data-testid="warning-cleanup-recipient-suppressed"
            >
              <AlertTriangle className="mt-[1px] size-3 shrink-0" />
              <span>
                هذا العنوان موقوف حالياً بسبب الارتداد (تجاوز{" "}
                {suppressionThreshold} ارتدادات متتالية). اضغط "إضافة" مرة
                أخرى للإضافة على أي حال، أو ألغِ الإيقاف أولاً من قائمة
                "عناوين موقوفة".
              </span>
            </div>
          )}
          {recipients.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              لم تتم إضافة أي مستلم بعد.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {recipients.map((email) => {
                const isSuppressed = suppressedSet.has(email.toLowerCase());
                return (
                  <Badge
                    key={email}
                    variant={isSuppressed ? "outline" : "secondary"}
                    className={
                      isSuppressed
                        ? "gap-1.5 border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200"
                        : "gap-1.5"
                    }
                    data-testid={`badge-cleanup-recipient-${email}`}
                  >
                    {isSuppressed && (
                      <ShieldOff
                        className="size-3"
                        aria-label="موقوف بسبب الارتداد"
                      />
                    )}
                    <span dir="ltr">{email}</span>
                    {isSuppressed && (
                      <span className="text-[10px] font-normal">
                        موقوف بسبب الارتداد
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeRecipient(email)}
                      disabled={updateMut.isPending}
                      className="text-muted-foreground hover:text-rose-600"
                      aria-label={`حذف ${email}`}
                      data-testid={`button-remove-cleanup-recipient-${email}`}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          )}
        </div>

        {/* Task #231 — per-tenant override for how long auto-suppressions
            last. Always visible (even when no addresses are currently
            suppressed) so admins can tune the window proactively. */}
        <div
          className="space-y-2 rounded-md border bg-muted/30 p-3"
          data-testid="section-cleanup-report-suppression-max-age"
        >
          <Label
            htmlFor="cleanup-report-suppression-max-age"
            className="text-xs font-medium"
          >
            مدة الإيقاف التلقائي (بالأيام)
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="cleanup-report-suppression-max-age"
              type="number"
              inputMode="numeric"
              min={0}
              max={suppressionMaxAgeMax}
              step={1}
              value={suppressionMaxAgeDraft}
              placeholder={`الافتراضي: ${suppressionMaxAgeDefault}`}
              onChange={(e) => {
                setSuppressionMaxAgeDraft(e.target.value);
                if (suppressionMaxAgeError) setSuppressionMaxAgeError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (suppressionMaxAgeDirty) saveSuppressionMaxAge();
                }
              }}
              className="h-9 w-32"
              dir="ltr"
              data-testid="input-cleanup-report-suppression-max-age"
            />
            <Button
              type="button"
              size="sm"
              onClick={saveSuppressionMaxAge}
              disabled={!suppressionMaxAgeDirty || updateMut.isPending}
              data-testid="button-save-cleanup-report-suppression-max-age"
            >
              {updateMut.isPending && (
                <Loader2 className="me-1 size-4 animate-spin" />
              )}
              حفظ
            </Button>
            {suppressionMaxAgeOverride != null && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={resetSuppressionMaxAge}
                disabled={updateMut.isPending}
                data-testid="button-reset-cleanup-report-suppression-max-age"
              >
                استعادة الافتراضي
              </Button>
            )}
          </div>
          {suppressionMaxAgeError && (
            <div
              className="text-xs text-rose-600"
              data-testid="error-cleanup-report-suppression-max-age"
            >
              {suppressionMaxAgeError}
            </div>
          )}
          <p
            className="text-[11px] text-muted-foreground"
            data-testid="text-cleanup-report-suppression-max-age-effective"
          >
            {suppressionMaxAgeDays === 0
              ? "إيقاف الانتهاء التلقائي: يجب إلغاء كل إيقاف يدوياً."
              : `يتم إلغاء الإيقاف تلقائياً بعد ${suppressionMaxAgeDays} يوماً.`}
            {" "}
            {suppressionMaxAgeOverride == null
              ? `(القيمة الحالية افتراضية من النظام: ${suppressionMaxAgeDefault} يوماً.)`
              : "(تخصيص خاص بهذا الحساب.)"}
            {" "}
            اتركه فارغاً لاستخدام القيمة الافتراضية، أو 0 لإيقاف الانتهاء
            التلقائي.
          </p>
        </div>

        <div id="cleanup-report-suppressions" className="scroll-mt-20" />
        {suppressions.length > 0 && (
          <div
            className="space-y-2 rounded-md border border-amber-300 bg-amber-50/40 p-3 dark:border-amber-800 dark:bg-amber-950/20"
            data-testid="section-cleanup-report-suppressions"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-amber-900 dark:text-amber-200">
              <ShieldOff className="size-3.5" />
              عناوين موقوفة بسبب الارتداد ({suppressions.length})
            </div>
            <p className="text-[11px] text-amber-900/80 dark:text-amber-200/80">
              يتم إيقاف العناوين تلقائياً بعد {suppressionThreshold} ارتدادات
              متتالية بدون أي تسليم ناجح بينها. لن يحاول النظام إرسال أي
              تقارير قادمة إلى هذه العناوين حتى تُلغي الإيقاف يدوياً
              {suppressionMaxAgeDays > 0
                ? `، أو حتى تنتهي صلاحية الإيقاف تلقائياً بعد ${suppressionMaxAgeDays} يوماً`
                : ""}
              .
            </p>
            <div className="flex flex-col gap-1.5">
              {suppressions.map((s) => (
                <div
                  key={s.email}
                  className="flex flex-wrap items-center gap-2 rounded border border-amber-200 bg-white/60 px-2 py-1.5 text-xs dark:border-amber-800/60 dark:bg-amber-950/30"
                  data-testid={`row-cleanup-suppression-${s.email}`}
                >
                  <span dir="ltr" className="font-mono">{s.email}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {s.bounceCount} ارتداد
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    منذ{" "}
                    {new Date(s.suppressedAt).toLocaleString("ar", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </span>
                  {s.lastReason && (
                    <span
                      className="truncate text-[10px] text-muted-foreground"
                      title={s.lastReason}
                    >
                      — {s.lastReason}
                    </span>
                  )}
                  {suppressionMaxAgeDays === 0 ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-300"
                      data-testid={`badge-cleanup-suppression-retry-${s.email}`}
                      title="انتهاء الإيقاف التلقائي معطّل — يجب إلغاء الإيقاف يدوياً"
                    >
                      الانتهاء التلقائي معطّل
                    </Badge>
                  ) : (
                    (() => {
                      const suppressedAt = Date.parse(s.suppressedAt);
                      if (!Number.isFinite(suppressedAt)) return null;
                      const msPerDay = 24 * 60 * 60 * 1000;
                      const msLeft =
                        suppressionMaxAgeDays * msPerDay -
                        (Date.now() - suppressedAt);
                      const daysLeft = Math.max(0, Math.ceil(msLeft / msPerDay));
                      const expiringSoon = msLeft <= msPerDay;
                      return (
                        <Badge
                          variant="outline"
                          className={
                            expiringSoon
                              ? "text-[10px] border-emerald-400 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200"
                              : "text-[10px]"
                          }
                          data-testid={`badge-cleanup-suppression-retry-${s.email}`}
                          title="سيتم إلغاء الإيقاف تلقائياً بعد هذه المدة"
                        >
                          {daysLeft === 0
                            ? "0 يوم متبقي — إعادة المحاولة قريباً"
                            : expiringSoon
                              ? `إعادة المحاولة خلال أقل من 24 ساعة`
                              : `${daysLeft} يوم متبقي`}
                        </Badge>
                      );
                    })()
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="ms-auto h-7 px-2 text-xs"
                    disabled={unsuppressMut.isPending}
                    onClick={() =>
                      unsuppressMut.mutate({ data: { email: s.email } })
                    }
                    data-testid={`button-unsuppress-${s.email}`}
                  >
                    {unsuppressMut.isPending &&
                    unsuppressMut.variables?.data.email === s.email ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      "إلغاء الإيقاف"
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <CleanupReportSuppressionExpiriesPanel />

        <div className="space-y-3 border-t pt-3">
          <div className="space-y-1.5">
            <Label htmlFor="cleanup-report-subject">عنوان البريد</Label>
            <Input
              id="cleanup-report-subject"
              value={subjectDraft}
              maxLength={200}
              onChange={(e) => setSubjectDraft(e.target.value)}
              placeholder="تقرير تنظيف التنبيهات {period} ({from} → {to})"
              data-testid="input-cleanup-report-subject"
            />
            <p className="text-[11px] text-muted-foreground">
              الرموز المتاحة:{" "}
              <code dir="ltr" className="rounded bg-muted px-1">{"{period}"}</code>{" "}
              <code dir="ltr" className="rounded bg-muted px-1">{"{from}"}</code>{" "}
              <code dir="ltr" className="rounded bg-muted px-1">{"{to}"}</code>
              . اتركه فارغاً لاستخدام العنوان الافتراضي.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cleanup-report-intro">مقدمة الرسالة</Label>
            <Textarea
              id="cleanup-report-intro"
              value={introDraft}
              maxLength={2000}
              rows={3}
              onChange={(e) => setIntroDraft(e.target.value)}
              placeholder="مرفق تقرير تنظيف التنبيهات الأسبوعي."
              data-testid="textarea-cleanup-report-intro"
            />
            <p className="text-[11px] text-muted-foreground">
              تُضاف هذه الفقرة في بداية متن الرسالة. اتركها فارغة لاستخدام المقدمة الافتراضية.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={saveText}
              disabled={!textDirty || updateMut.isPending}
              data-testid="button-save-cleanup-report-text"
            >
              {updateMut.isPending && (
                <Loader2 className="me-1 size-4 animate-spin" />
              )}
              حفظ النص
            </Button>
            {(savedSubject || savedIntro) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetText}
                disabled={updateMut.isPending}
                data-testid="button-reset-cleanup-report-text"
              >
                استعادة الافتراضي
              </Button>
            )}
          </div>
        </div>

        <CleanupReportPreview
          subjectDraft={subjectDraft}
          introDraft={introDraft}
          schedule={schedule}
        />

        {lastSentAt && (
          <div
            className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
            data-testid="text-cleanup-report-last-sent"
          >
            آخر إرسال{" "}
            <span title={new Date(lastSentAt).toLocaleString("ar-SA")}>
              {formatRelativeArabic(lastSentAt)}
            </span>
            .
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => sendNowMut.mutate()}
            disabled={
              sendNowMut.isPending ||
              updateMut.isPending ||
              sendTestMut.isPending ||
              recipients.length === 0
            }
            data-testid="button-send-cleanup-report-now"
          >
            {sendNowMut.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
            إرسال الآن
          </Button>
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="email"
                placeholder="بريدك أو بريد المراجع"
                value={testEmail}
                onChange={(e) => {
                  setTestEmail(e.target.value);
                  setTestEmailTouched(true);
                  if (testEmailError) setTestEmailError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    sendTestEmail();
                  }
                }}
                className="h-9 w-56"
                dir="ltr"
                data-testid="input-cleanup-report-test-recipient"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={sendTestEmail}
                disabled={
                  sendTestMut.isPending ||
                  sendNowMut.isPending ||
                  updateMut.isPending
                }
                data-testid="button-send-cleanup-report-test"
                title="يرسل البريد إلى العنوان أعلاه (أو إلى حسابك إن تُرك فارغاً) للتحقق من الإعدادات."
              >
                {sendTestMut.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                إرسال نسخة تجريبية
              </Button>
            </div>
            {testEmailError && (
              <div
                className="text-xs text-rose-600"
                data-testid="text-cleanup-report-test-error"
              >
                {testEmailError}
              </div>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            يستخدم نفس قالب PDF الذي تنزّله من بطاقة سجل التنظيف. اتركه
            فارغاً لإرساله إلى بريد حسابك.
          </span>
        </div>

        <CleanupReportSendsHistory />
        <CleanupReportTestHistory
          refreshKey={sendTestMut.isSuccess ? sendTestMut.data?.recipient : null}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Task #201: per-recipient picker for the "re-send a past report"
 * action. Opens a popover with one checkbox per original recipient so
 * an admin can scope the re-send to just the user who reported they
 * never got the report, instead of duplicating to everyone. Sending
 * with all boxes ticked (or with the toggle-all flow) is equivalent
 * to the legacy "re-send to everyone" behaviour.
 */
function ResendRecipientPicker({
  rowId,
  recipients,
  windowLabel,
  isPending,
  onResend,
  statusByEmail,
}: {
  rowId: number;
  recipients: string[];
  windowLabel: string;
  isPending: boolean;
  /**
   * Task #206 — passes the chosen subset (or `null` for "send to
   * everyone") AND the original recipient total so callers can report
   * "X of Y" in toasts and audit logs without re-deriving it.
   * Task #210 — also passes any "additional" recipients the admin
   * typed into the second tab (addresses outside the original list).
   */
  onResend: (
    subset: string[] | null,
    originalTotal: number,
    additional: string[],
  ) => void;
  /**
   * Task #204 — per-recipient delivery status keyed by lowercased
   * email. When present, the picker highlights bounced/pending rows
   * and exposes a "تحديد غير المُسلَّمين فقط" shortcut.
   */
  statusByEmail?: Record<
    string,
    "delivered" | "bounced" | "pending" | "deferred"
  >;
}) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Task #210 — second tab "إرسال إلى مستلمين إضافيين" lets the admin
  // forward this report to addresses outside the original recipient
  // list (e.g. a new hire). State for that tab lives alongside the
  // existing subset picker so switching tabs preserves both inputs.
  const [mode, setMode] = useState<"subset" | "additional">("subset");
  const [additionalInput, setAdditionalInput] = useState("");
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const originalSetLower = new Set(recipients.map((r) => r.toLowerCase()));
  const parseAdditional = (raw: string) => {
    const tokens = raw
      .split(/[\s,;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const seen = new Set<string>();
    const valid: string[] = [];
    const invalid: string[] = [];
    const duplicates: string[] = [];
    const outsideOriginal: string[] = [];
    for (const t of tokens) {
      const lower = t.toLowerCase();
      if (seen.has(lower)) {
        duplicates.push(t);
        continue;
      }
      seen.add(lower);
      if (!EMAIL_RE.test(t)) {
        invalid.push(t);
        continue;
      }
      valid.push(t);
      if (!originalSetLower.has(lower)) {
        outsideOriginal.push(t);
      }
    }
    return { valid, invalid, duplicates, outsideOriginal };
  };
  const additionalParsed = parseAdditional(additionalInput);
  const undeliveredEmails = recipients.filter((r) => {
    const s = statusByEmail?.[r.toLowerCase()];
    return s === "bounced" || s === "pending" || s === "deferred";
  });
  const hasUndelivered = undeliveredEmails.length > 0;
  // When the row has undelivered recipients, pre-select only those so
  // the admin can resend the bounced ones with one click. Otherwise
  // fall back to the legacy "everyone selected" default.
  const initialSelection = () =>
    hasUndelivered
      ? Object.fromEntries(
          recipients.map((r) => [r, undeliveredEmails.includes(r)]),
        )
      : Object.fromEntries(recipients.map((r) => [r, true]));
  const [selected, setSelected] = useState<Record<string, boolean>>(initialSelection);
  // Re-sync when the popover is opened so a stale selection from a
  // previous open doesn't carry over if the recipient list changed.
  // Task #210 — also reset the additional-recipients tab back to a
  // clean state so a previously typed forward can't be re-sent by
  // accident the next time the popover opens.
  useEffect(() => {
    if (open) {
      setSelected(initialSelection());
      setMode("subset");
      setAdditionalInput("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const chosen = recipients.filter((r) => selected[r]);
  const excluded = recipients.filter((r) => !selected[r]);
  const allChecked = chosen.length === recipients.length;
  const noneChecked = chosen.length === 0;
  const isSubset = !allChecked && !noneChecked;
  const submit = () => {
    // Task #210 — the two tabs are independent send modes:
    //  - subset: pass the chosen subset (or `null` if every box is
    //    ticked so the backend takes the legacy "all originals"
    //    path), never any extras.
    //  - additional: ALWAYS send to all original recipients
    //    (subset=null) plus the typed extras. The subset checkbox
    //    state must not leak through, otherwise the UI's promise of
    //    "originals + extras" can silently turn into "subset +
    //    extras" — e.g. when undelivered-only is the pre-selected
    //    default, or when the admin tweaked checkboxes before
    //    switching tabs.
    if (mode === "additional") {
      onResend(null, recipients.length, additionalParsed.valid);
    } else {
      onResend(allChecked ? null : chosen, recipients.length, []);
    }
    setOpen(false);
    setConfirmOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          disabled={isPending}
          title={`إعادة إرسال نفس النطاق (${windowLabel}) — اختر المستلمين`}
          data-testid={`button-resend-cleanup-report-${rowId}`}
        >
          {isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <RotateCw className="size-3" />
          )}
          <span className="ms-1">إعادة الإرسال</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 p-3"
        align="end"
        data-testid={`popover-resend-recipients-${rowId}`}
      >
        <div className="space-y-2">
          <div>
            <div className="text-xs font-medium">إعادة الإرسال إلى</div>
            <div className="text-[11px] text-muted-foreground" dir="ltr">
              {windowLabel}
            </div>
          </div>
          <Tabs
            value={mode}
            onValueChange={(v) => setMode(v as "subset" | "additional")}
            className="space-y-2"
          >
            <TabsList
              className="grid w-full grid-cols-2 h-8"
              data-testid={`tabs-resend-mode-${rowId}`}
            >
              <TabsTrigger
                value="subset"
                className="text-[11px] h-6"
                data-testid={`tab-resend-mode-subset-${rowId}`}
              >
                المستلمون الأصليون
              </TabsTrigger>
              <TabsTrigger
                value="additional"
                className="text-[11px] h-6"
                data-testid={`tab-resend-mode-additional-${rowId}`}
              >
                إرسال إلى مستلمين إضافيين
              </TabsTrigger>
            </TabsList>
            <TabsContent value="subset" className="mt-0 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span data-testid={`text-resend-selection-count-${rowId}`}>
                  {chosen.length} / {recipients.length} مستلم
                </span>
                <div className="flex items-center gap-2">
                  {hasUndelivered && (
                    <button
                      type="button"
                      className="text-amber-600 hover:underline"
                      onClick={() =>
                        setSelected(
                          Object.fromEntries(
                            recipients.map((r) => [
                              r,
                              undeliveredEmails.includes(r),
                            ]),
                          ),
                        )
                      }
                      data-testid={`button-resend-undelivered-only-${rowId}`}
                    >
                      تحديد غير المُسلَّمين فقط ({undeliveredEmails.length})
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-primary hover:underline disabled:opacity-50"
                    disabled={recipients.length === 0}
                    onClick={() => {
                      const next = allChecked ? false : true;
                      setSelected(
                        Object.fromEntries(
                          recipients.map((r) => [r, next]),
                        ),
                      );
                    }}
                    data-testid={`button-resend-toggle-all-${rowId}`}
                  >
                    {allChecked ? "إلغاء الكل" : "اختيار الكل"}
                  </button>
                </div>
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded border bg-muted/20 p-2">
                {recipients.map((r) => {
                  const id = `resend-${rowId}-${r}`;
                  const status = statusByEmail?.[r.toLowerCase()];
                  const isUndelivered =
                    status === "bounced" ||
                    status === "pending" ||
                    status === "deferred";
                  return (
                    <label
                      key={r}
                      htmlFor={id}
                      className={`flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-muted/60 ${
                        isUndelivered
                          ? "bg-amber-50 dark:bg-amber-950/20"
                          : ""
                      }`}
                      dir="ltr"
                    >
                      <Checkbox
                        id={id}
                        checked={!!selected[r]}
                        onCheckedChange={(v) =>
                          setSelected((prev) => ({
                            ...prev,
                            [r]: v === true,
                          }))
                        }
                        data-testid={`checkbox-resend-recipient-${rowId}-${r}`}
                      />
                      <span className="flex-1 truncate" title={r}>
                        {r}
                      </span>
                      {status && (
                        <RecipientStatusBadge status={status} compact />
                      )}
                    </label>
                  );
                })}
              </div>
              {isSubset && (
                <div
                  className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900"
                  data-testid={`warning-resend-excluded-${rowId}`}
                >
                  <div className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-[1px] size-3 shrink-0" />
                    <div className="space-y-1">
                      <div className="font-medium">
                        تنبيه: لن يصل هذا التقرير إلى{" "}
                        <span className="tabular-nums">
                          {excluded.length}
                        </span>{" "}
                        من المستلمين الأصليين.
                      </div>
                      <div className="text-amber-800" dir="ltr">
                        {excluded.join("، ")}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>
            <TabsContent value="additional" className="mt-0 space-y-2">
              <div className="text-[11px] text-muted-foreground">
                سيتم إرسال نفس التقرير إلى المستلمين الأصليين (
                <span className="tabular-nums">{recipients.length}</span>)
                بالإضافة إلى العناوين التالية. افصل بينها بفواصل أو أسطر
                جديدة.
              </div>
              <Textarea
                rows={3}
                dir="ltr"
                placeholder="new.hire@example.com, manager@example.com"
                value={additionalInput}
                onChange={(e) => setAdditionalInput(e.target.value)}
                className="text-xs font-mono"
                data-testid={`textarea-resend-additional-${rowId}`}
              />
              <div
                className="flex items-center justify-between text-[11px] text-muted-foreground"
                data-testid={`text-resend-additional-count-${rowId}`}
              >
                <span>
                  <span className="tabular-nums">
                    {additionalParsed.valid.length}
                  </span>{" "}
                  عنوان صالح
                  {additionalParsed.outsideOriginal.length > 0 && (
                    <>
                      {" · "}
                      <span className="text-amber-600">
                        <span className="tabular-nums">
                          {additionalParsed.outsideOriginal.length}
                        </span>{" "}
                        خارج القائمة الأصلية
                      </span>
                    </>
                  )}
                </span>
                {additionalParsed.invalid.length > 0 && (
                  <span className="text-rose-600">
                    <span className="tabular-nums">
                      {additionalParsed.invalid.length}
                    </span>{" "}
                    غير صالح
                  </span>
                )}
              </div>
              {additionalParsed.outsideOriginal.length > 0 && (
                <div
                  className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900"
                  data-testid={`warning-resend-additional-outside-${rowId}`}
                >
                  <div className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-[1px] size-3 shrink-0" />
                    <div className="space-y-1">
                      <div className="font-medium">
                        تنبيه: ستذهب نسخة من هذا التقرير إلى عناوين لم تكن
                        ضمن المستلمين الأصليين.
                      </div>
                      <div className="text-amber-800" dir="ltr">
                        {additionalParsed.outsideOriginal.join("، ")}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {additionalParsed.invalid.length > 0 && (
                <div
                  className="rounded border border-rose-300 bg-rose-50 p-2 text-[11px] text-rose-900"
                  data-testid={`warning-resend-additional-invalid-${rowId}`}
                >
                  <div className="font-medium">
                    عناوين غير صالحة سيتم تجاهلها:
                  </div>
                  <div className="text-rose-800" dir="ltr">
                    {additionalParsed.invalid.join("، ")}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setOpen(false)}
              data-testid={`button-resend-cancel-${rowId}`}
            >
              إلغاء
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7 px-3 text-xs"
              disabled={
                isPending ||
                (mode === "subset"
                  ? noneChecked
                  : additionalParsed.valid.length === 0)
              }
              onClick={() => {
                if (mode === "subset" && isSubset) {
                  // A subset is a destructive omission — require an
                  // explicit confirmation so the admin can't quietly
                  // skip an original recipient by accident.
                  setConfirmOpen(true);
                  return;
                }
                submit();
              }}
              data-testid={`button-resend-confirm-${rowId}`}
            >
              {isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Send className="size-3" />
              )}
              <span className="ms-1">إرسال</span>
            </Button>
          </div>
        </div>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent
            data-testid={`dialog-resend-confirm-${rowId}`}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>
                إعادة إرسال إلى مجموعة أصغر؟
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-start">
                  <div>
                    سيتم إرسال التقرير إلى{" "}
                    <span className="font-medium tabular-nums">
                      {chosen.length}
                    </span>{" "}
                    من أصل{" "}
                    <span className="font-medium tabular-nums">
                      {recipients.length}
                    </span>{" "}
                    من المستلمين الأصليين فقط.
                  </div>
                  <div>
                    <div className="text-xs font-medium text-emerald-700">
                      سيستلم ({chosen.length}):
                    </div>
                    <div
                      className="text-xs text-emerald-800"
                      dir="ltr"
                      data-testid={`text-resend-included-list-${rowId}`}
                    >
                      {chosen.join("، ")}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-rose-700">
                      لن يستلم ({excluded.length}):
                    </div>
                    <div
                      className="text-xs text-rose-800"
                      dir="ltr"
                      data-testid={`text-resend-excluded-list-${rowId}`}
                    >
                      {excluded.join("، ")}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    هل تريد المتابعة؟
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                data-testid={`button-resend-confirm-cancel-${rowId}`}
              >
                رجوع
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={submit}
                data-testid={`button-resend-confirm-proceed-${rowId}`}
              >
                نعم، تابع الإرسال
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Task #211 — row-level quick action that re-sends a past cleanup
 * report to **only the bounced** recipients (hard failures). Distinct
 * from the picker's "undelivered" shortcut, which also includes
 * pending + deferred. Opens an AlertDialog with the exact address
 * list before firing so an admin can review which inboxes will get a
 * second copy.
 */
function ResendBouncedOnlyButton({
  rowId,
  bouncedEmails,
  windowLabel,
  isPending,
  onConfirm,
}: {
  rowId: number;
  bouncedEmails: string[];
  windowLabel: string;
  isPending: boolean;
  onConfirm: (bounced: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  if (bouncedEmails.length === 0) return null;
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-rose-700 hover:text-rose-800 hover:bg-rose-50"
          disabled={isPending}
          title={`إعادة إرسال إلى ${bouncedEmails.length} عنوان مرتد فقط (${windowLabel})`}
          data-testid={`button-resend-bounced-only-${rowId}`}
        >
          {isPending ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <MailX className="size-3" />
          )}
          <span className="ms-1 tabular-nums">
            للمرتدّين ({bouncedEmails.length})
          </span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent
        data-testid={`dialog-resend-bounced-only-${rowId}`}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>إعادة الإرسال إلى المرتدّين فقط؟</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-start">
              <div>
                سيتم إرسال نفس التقرير (
                <span dir="ltr">{windowLabel}</span>) إلى{" "}
                <span className="font-medium tabular-nums">
                  {bouncedEmails.length}
                </span>{" "}
                عنوان فُشل تسليمه سابقاً، دون باقي المستلمين.
              </div>
              <div>
                <div className="text-xs font-medium text-rose-700">
                  المرتدّون:
                </div>
                <div
                  className="text-xs text-rose-800"
                  dir="ltr"
                  data-testid={`text-resend-bounced-list-${rowId}`}
                >
                  {bouncedEmails.join("، ")}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                تأكّد أن العناوين أصبحت صالحة قبل المتابعة، وإلا ستفشل مجدداً.
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            data-testid={`button-resend-bounced-only-cancel-${rowId}`}
          >
            رجوع
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onConfirm(bouncedEmails);
              setOpen(false);
            }}
            data-testid={`button-resend-bounced-only-proceed-${rowId}`}
          >
            نعم، أعد الإرسال
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Task #204 — small status badge used both inside the resend popover
 * and in the per-recipient breakdown of the history table.
 */
function RecipientStatusBadge({
  status,
  compact = false,
}: {
  status: "delivered" | "bounced" | "pending" | "deferred";
  compact?: boolean;
}) {
  const map = {
    delivered: {
      label: "مُسلَّم",
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
      Icon: Mail,
    },
    bounced: {
      label: "مرتد",
      cls: "bg-rose-50 text-rose-700 border-rose-200",
      Icon: MailX,
    },
    pending: {
      label: "قيد الانتظار",
      cls: "bg-amber-50 text-amber-700 border-amber-200",
      Icon: Clock,
    },
    deferred: {
      label: "مؤجَّل",
      cls: "bg-amber-50 text-amber-700 border-amber-200",
      Icon: Clock,
    },
  } as const;
  const { label, cls, Icon } = map[status];
  return (
    <Badge
      variant="outline"
      className={`${cls} ${compact ? "px-1 py-0 text-[9px]" : "text-[10px]"}`}
      data-testid={`badge-recipient-status-${status}`}
    >
      <Icon className={compact ? "size-2.5" : "size-3"} />
      <span className="ms-1">{label}</span>
    </Badge>
  );
}

/**
 * Task #191: shows the last ~20 cleanup-report email send attempts so
 * admins can audit who triggered each send (cron / manual / test),
 * how many recipients it hit, and whether it succeeded.
 */
function CleanupReportSendsHistory() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListCleanupReportSends();
  const rows = data ?? [];
  // Task #204 — track which rows have their per-recipient delivery
  // breakdown expanded.
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const invalidateSends = () =>
    queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey?.[0];
        return (
          typeof k === "string" &&
          k.includes("/admin/system-settings/cleanup-report-sends")
        );
      },
    });
  // Track the original recipient count per source row id so the
  // success toast can show the "X of Y" subset framing the API
  // contract advertises (the response itself only carries the chosen
  // count, not the original total).
  const originalTotalsRef = useRef<Map<number, number>>(new Map());
  const resendMut = useResendCleanupReport({
    mutation: {
      onSuccess: (resp, vars) => {
        const count = resp.recipients?.length ?? 0;
        const additional = resp.additional ?? 0;
        const total =
          originalTotalsRef.current.get(vars.id) ?? count;
        originalTotalsRef.current.delete(vars.id);
        // Task #210 — surface the "forwarded to N extras" framing in
        // the toast so the admin can tell at a glance that the send
        // included addresses outside the original recipient list.
        const originalsCount = count - additional;
        let description: string;
        if (additional > 0 && resp.subset) {
          description = `تم الإرسال إلى ${originalsCount} من ${total} من المستلمين الأصليين + ${additional} مستلم إضافي (${resp.rowCount ?? 0} عملية تنظيف).`;
        } else if (additional > 0) {
          description = `إلى ${originalsCount} من المستلمين الأصليين + ${additional} مستلم إضافي (${resp.rowCount ?? 0} عملية تنظيف).`;
        } else if (resp.subset) {
          description = `تم الإرسال إلى ${count} من ${total} من المستلمين الأصليين (${resp.rowCount ?? 0} عملية تنظيف).`;
        } else {
          description = `إلى ${count} مستلم (${resp.rowCount ?? 0} عملية تنظيف).`;
        }
        toast({
          title: "تمت إعادة الإرسال",
          description,
        });
        void invalidateSends();
      },
      onError: (err: unknown) => {
        void invalidateSends();
        const msg =
          (err as { response?: { data?: { error?: string } } })?.response?.data
            ?.error ?? "تعذّر إعادة الإرسال";
        toast({ title: msg, variant: "destructive" });
      },
    },
  });
  const triggerLabel: Record<string, string> = {
    cron: "تلقائي",
    manual: "يدوي",
    test: "تجريبي",
  };
  const triggerTone: Record<string, string> = {
    cron: "bg-blue-50 text-blue-700 border-blue-200",
    manual: "bg-amber-50 text-amber-700 border-amber-200",
    test: "bg-slate-50 text-slate-700 border-slate-200",
  };
  const reasonLabel: Record<string, string> = {
    no_recipients: "لا يوجد مستلمون",
    mailer_not_configured: "البريد غير مهيأ",
    send_failed: "فشل الإرسال",
  };
  return (
    <div
      className="space-y-2 border-t pt-3"
      data-testid="panel-cleanup-report-sends-history"
    >
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground">
          سجل عمليات الإرسال
        </Label>
        <span className="text-[11px] text-muted-foreground">
          آخر {rows.length || 0} محاولة
        </span>
      </div>
      {isLoading ? (
        <div className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
          <Loader2 className="me-1 inline size-3 animate-spin" /> جارٍ
          التحميل…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          لم يتم إرسال أي تقرير بعد.
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs w-0"></TableHead>
                <TableHead className="text-xs">التاريخ</TableHead>
                <TableHead className="text-xs">النطاق</TableHead>
                <TableHead className="text-xs">النوع</TableHead>
                <TableHead className="text-xs">بواسطة</TableHead>
                <TableHead className="text-xs">المستلمون</TableHead>
                <TableHead className="text-xs">الحالة</TableHead>
                <TableHead className="text-xs w-0"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const date = new Date(r.sentAt).toLocaleString("ar-SA");
                const failTxt = r.failureReason
                  ? reasonLabel[r.failureReason] ?? r.failureReason
                  : null;
                const windowLabel =
                  r.windowFrom && r.windowTo
                    ? `${new Date(r.windowFrom).toISOString().slice(0, 10)} → ${new Date(r.windowTo).toISOString().slice(0, 10)}`
                    : null;
                const canResend = r.status === "success" && !!windowLabel;
                const recipientStatuses = r.recipientStatuses ?? [];
                const statusByEmail: Record<
                  string,
                  "delivered" | "bounced" | "pending" | "deferred"
                > = {};
                for (const s of recipientStatuses) {
                  statusByEmail[s.email.toLowerCase()] = s.status;
                }
                const counts = recipientStatuses.reduce(
                  (acc, s) => {
                    acc[s.status] = (acc[s.status] ?? 0) + 1;
                    return acc;
                  },
                  {} as Record<string, number>,
                );
                const isExpanded = !!expanded[r.id];
                const hasBreakdown = recipientStatuses.length > 0;
                return (
                  <Fragment key={r.id}>
                  <TableRow
                    id={`cleanup-report-send-${r.id}`}
                    data-testid={`row-cleanup-report-send-${r.id}`}
                    className="scroll-mt-24 transition-colors"
                  >
                    <TableCell className="p-1 align-top">
                      {hasBreakdown && (
                        <button
                          type="button"
                          className="rounded p-1 hover:bg-muted"
                          onClick={() =>
                            setExpanded((p) => ({
                              ...p,
                              [r.id]: !p[r.id],
                            }))
                          }
                          aria-label={
                            isExpanded ? "إخفاء التفاصيل" : "عرض التفاصيل"
                          }
                          data-testid={`button-toggle-recipient-statuses-${r.id}`}
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-3" />
                          ) : (
                            <ChevronRight className="size-3" />
                          )}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {date}
                    </TableCell>
                    <TableCell
                      className="text-xs whitespace-nowrap text-muted-foreground"
                      dir="ltr"
                      data-testid={`text-cleanup-report-send-window-${r.id}`}
                    >
                      {windowLabel ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${triggerTone[r.trigger] ?? ""}`}
                      >
                        {triggerLabel[r.trigger] ?? r.trigger}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className="text-xs text-muted-foreground truncate max-w-[10rem]"
                      title={r.triggeredByUserName ?? undefined}
                    >
                      {r.trigger === "cron"
                        ? "النظام"
                        : r.triggeredByUserName ?? "—"}
                    </TableCell>
                    <TableCell
                      className="text-xs max-w-[16rem]"
                      title={r.recipients}
                      dir="ltr"
                    >
                      <div className="flex items-center gap-1 truncate">
                        <span className="tabular-nums">
                          {r.recipientCount}
                        </span>
                        {r.recipients && (
                          <span className="text-muted-foreground truncate">
                            · {r.recipients}
                          </span>
                        )}
                      </div>
                      {hasBreakdown && (
                        <div
                          className="mt-1 flex flex-wrap gap-1"
                          data-testid={`text-cleanup-report-send-status-summary-${r.id}`}
                        >
                          {(["delivered", "bounced", "pending", "deferred"] as const).map(
                            (k) =>
                              counts[k] ? (
                                <Badge
                                  key={k}
                                  variant="outline"
                                  className={`px-1 py-0 text-[9px] ${
                                    k === "delivered"
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                      : k === "bounced"
                                        ? "bg-rose-50 text-rose-700 border-rose-200"
                                        : "bg-amber-50 text-amber-700 border-amber-200"
                                  }`}
                                >
                                  {k === "delivered"
                                    ? "مُسلَّم"
                                    : k === "bounced"
                                      ? "مرتد"
                                      : k === "pending"
                                        ? "قيد الانتظار"
                                        : "مؤجَّل"}
                                  <span className="ms-1 tabular-nums">
                                    {counts[k]}
                                  </span>
                                </Badge>
                              ) : null,
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.status === "success" ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200"
                        >
                          نجح
                          {typeof r.rowCount === "number" && (
                            <span className="ms-1 tabular-nums">
                              · {r.rowCount}
                            </span>
                          )}
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-rose-50 text-rose-700 border-rose-200"
                          title={failTxt ?? undefined}
                        >
                          فشل{failTxt ? ` · ${failTxt}` : ""}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {canResend && (counts.bounced ?? 0) > 0 && (
                        <ResendBouncedOnlyButton
                          rowId={r.id}
                          bouncedEmails={recipientStatuses
                            .filter((s) => s.status === "bounced")
                            .map((s) => s.email)}
                          windowLabel={windowLabel!}
                          isPending={
                            resendMut.isPending &&
                            resendMut.variables?.id === r.id
                          }
                          onConfirm={(bounced) => {
                            originalTotalsRef.current.set(
                              r.id,
                              (r.recipients ?? "")
                                .split(",")
                                .map((s) => s.trim())
                                .filter((s) => s.length > 0).length,
                            );
                            resendMut.mutate({
                              id: r.id,
                              data: { recipients: bounced },
                            });
                          }}
                        />
                      )}
                      {canResend && (
                        <ResendRecipientPicker
                          rowId={r.id}
                          recipients={(r.recipients ?? "")
                            .split(",")
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0)}
                          windowLabel={windowLabel!}
                          statusByEmail={statusByEmail}
                          isPending={
                            resendMut.isPending &&
                            resendMut.variables?.id === r.id
                          }
                          onResend={(subset, originalTotal, additional) => {
                            originalTotalsRef.current.set(
                              r.id,
                              originalTotal,
                            );
                            const body: {
                              recipients?: string[];
                              additionalRecipients?: string[];
                            } = {};
                            if (subset && subset.length > 0) {
                              body.recipients = subset;
                            }
                            if (additional && additional.length > 0) {
                              body.additionalRecipients = additional;
                            }
                            resendMut.mutate({ id: r.id, data: body });
                          }}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                  {isExpanded && hasBreakdown && (
                    <TableRow
                      data-testid={`row-cleanup-report-send-statuses-${r.id}`}
                      className="bg-muted/20"
                    >
                      <TableCell />
                      <TableCell colSpan={7} className="py-2">
                        <div className="space-y-1">
                          <div className="text-[11px] font-medium text-muted-foreground">
                            حالة التسليم لكل مستلم
                            {r.messageId && (
                              <span
                                className="ms-2 font-normal"
                                dir="ltr"
                                title={r.messageId}
                              >
                                · message-id: {r.messageId}
                              </span>
                            )}
                          </div>
                          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                            {recipientStatuses.map((s) => (
                              <div
                                key={s.email}
                                className="flex items-center justify-between gap-2 rounded border bg-background px-2 py-1 text-xs"
                                dir="ltr"
                                data-testid={`row-recipient-status-${r.id}-${s.email}`}
                              >
                                <span className="truncate" title={s.email}>
                                  {s.email}
                                </span>
                                <div className="flex shrink-0 items-center gap-1">
                                  <RecipientStatusBadge status={s.status} />
                                  {s.reason && (
                                    <span
                                      className="max-w-[10rem] truncate text-[10px] text-muted-foreground"
                                      title={s.reason}
                                    >
                                      {s.reason}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/**
 * Task #195: compact list of the last 5 cleanup report test sends so
 * admins can see at a glance who recently dry-ran the report and to
 * which inbox. Sourced from the existing
 * `system_settings.cleanup_report_sent_test` audit log entries.
 */
function CleanupReportTestHistory({ refreshKey }: { refreshKey: unknown }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetCleanupReportTestHistory();
  useEffect(() => {
    if (refreshKey) {
      void queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey?.[0];
          return (
            typeof k === "string" &&
            k.includes("/admin/system-settings/cleanup-report-test-history")
          );
        },
      });
    }
  }, [refreshKey, queryClient]);

  const entries = data?.entries ?? [];

  return (
    <div
      className="space-y-2 border-t pt-3"
      data-testid="panel-cleanup-report-test-history"
    >
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">
          آخر عمليات الإرسال التجريبي
        </Label>
        {isLoading && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
      </div>
      {entries.length === 0 ? (
        <div
          className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          data-testid="text-cleanup-report-test-history-empty"
        >
          لا توجد عمليات إرسال تجريبية حتى الآن.
        </div>
      ) : (
        <ul className="divide-y rounded-md border bg-muted/30 text-xs">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
              data-testid={`row-cleanup-report-test-history-${e.id}`}
            >
              <div className="flex flex-col">
                <span className="font-medium text-foreground">{e.userName}</span>
                {e.recipient && (
                  <span dir="ltr" className="text-muted-foreground">
                    {e.recipient}
                  </span>
                )}
              </div>
              <span
                className="text-muted-foreground"
                title={new Date(e.createdAt).toLocaleString("ar-SA")}
              >
                {formatRelativeArabic(e.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Task #232 — history of cleanup-report suppressions that the daily
 * sweeper auto-expired (see `sweepExpiredCleanupReportSuppressions`).
 * Lives directly under the "عناوين موقوفة بسبب الارتداد" panel and
 * shares the `#cleanup-report-suppressions` anchor so the proactive
 * notification email (task #230) deep-links straight here. Filterable
 * by date range so an admin investigating "I never got the report"
 * can quickly confirm whether the auditor's address was re-enabled
 * by the sweep vs. lifted manually.
 */
function CleanupReportSuppressionExpiriesPanel() {
  const [fromDraft, setFromDraft] = useState<string>("");
  const [toDraft, setToDraft] = useState<string>("");
  const params: { from?: string; to?: string; limit?: number } = { limit: 50 };
  if (fromDraft) {
    const t = Date.parse(fromDraft);
    if (Number.isFinite(t)) params.from = new Date(t).toISOString();
  }
  if (toDraft) {
    // Treat the `to` date as inclusive end-of-day.
    const t = Date.parse(toDraft);
    if (Number.isFinite(t)) {
      params.to = new Date(t + 24 * 60 * 60 * 1000 - 1).toISOString();
    }
  }
  const { data, isLoading, isFetching } =
    useListCleanupReportSuppressionExpiries(params);
  const rows = data ?? [];

  return (
    <div
      className="space-y-2 rounded-md border border-emerald-300 bg-emerald-50/40 p-3 dark:border-emerald-800 dark:bg-emerald-950/20"
      data-testid="section-cleanup-report-suppression-expiries"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-emerald-900 dark:text-emerald-200">
          <ShieldOff className="size-3.5" />
          عناوين أُعيد تفعيلها تلقائياً ({rows.length})
        </div>
        {(isLoading || isFetching) && (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        )}
      </div>
      <p className="text-[11px] text-emerald-900/80 dark:text-emerald-200/80">
        يعرض العناوين التي رفع النظام إيقافها تلقائياً بعد انتهاء فترة
        الإيقاف. يساعد على معرفة ما إذا كان عنوان المدقق قد عاد تلقائياً
        إلى قائمة المستلمين أم أنّ مديراً ألغى إيقافه يدوياً.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="cleanup-expiry-from" className="text-[11px]">
            من تاريخ
          </Label>
          <Input
            id="cleanup-expiry-from"
            type="date"
            value={fromDraft}
            onChange={(e) => setFromDraft(e.target.value)}
            className="h-8 w-40"
            data-testid="input-cleanup-expiry-from"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cleanup-expiry-to" className="text-[11px]">
            إلى تاريخ
          </Label>
          <Input
            id="cleanup-expiry-to"
            type="date"
            value={toDraft}
            onChange={(e) => setToDraft(e.target.value)}
            className="h-8 w-40"
            data-testid="input-cleanup-expiry-to"
          />
        </div>
        {(fromDraft || toDraft) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setFromDraft("");
              setToDraft("");
            }}
            data-testid="button-cleanup-expiry-clear-filter"
          >
            مسح المرشِّح
          </Button>
        )}
      </div>
      {rows.length === 0 ? (
        <div
          className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          data-testid="text-cleanup-report-suppression-expiries-empty"
        >
          لم يُعَد تفعيل أي عنوان تلقائياً ضمن هذا النطاق.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center gap-2 rounded border border-emerald-200 bg-white/60 px-2 py-1.5 text-xs dark:border-emerald-800/60 dark:bg-emerald-950/30"
              data-testid={`row-cleanup-report-suppression-expiry-${r.id}`}
            >
              <span dir="ltr" className="font-mono">
                {r.email}
              </span>
              <Badge variant="outline" className="text-[10px]">
                {r.bounceCount} ارتداد
              </Badge>
              <span
                className="text-[10px] text-muted-foreground"
                title={new Date(r.expiredAt).toLocaleString("ar-SA")}
              >
                أُعيد التفعيل {formatRelativeArabic(r.expiredAt)}
              </span>
              {r.suppressedAt && (
                <span className="text-[10px] text-muted-foreground">
                  • أُوقف منذ {r.suppressedAt.slice(0, 10)}
                </span>
              )}
              <Badge variant="outline" className="text-[10px]">
                بعد {r.maxAgeDays} يوماً
              </Badge>
              {r.lastReason && (
                <span
                  className="truncate text-[10px] text-muted-foreground"
                  title={r.lastReason}
                >
                  — {r.lastReason}
                </span>
              )}
              {/* Task #236 — recovery indicator: did the address
                 actually start delivering again after the sweeper
                 lifted its suppression? */}
              {r.lastSubsequentDeliveryAt ? (
                <Badge
                  variant="default"
                  className="bg-emerald-600 text-[10px] text-white hover:bg-emerald-600"
                  title={`آخر تسليم ناجح: ${new Date(r.lastSubsequentDeliveryAt).toLocaleString("ar-SA")}`}
                  data-testid={`badge-cleanup-expiry-recovered-${r.id}`}
                >
                  عاد للتسليم ({r.subsequentDeliveryCount})
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-amber-400 text-[10px] text-amber-700 dark:border-amber-700 dark:text-amber-300"
                  title="لم يُسجَّل أي تسليم ناجح بعد إعادة التفعيل"
                  data-testid={`badge-cleanup-expiry-pending-${r.id}`}
                >
                  بانتظار أول تسليم
                </Badge>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Task #181: live preview of the resolved cleanup report email
 * subject + body. Debounces updates so each keystroke doesn't fire a
 * request. Falls back gracefully on error (e.g. mailer unconfigured or
 * compliance loader hiccup — preview is non-critical).
 */
function CleanupReportPreview({
  subjectDraft,
  introDraft,
  schedule,
}: {
  subjectDraft: string;
  introDraft: string;
  schedule: "off" | "weekly" | "monthly";
}) {
  const [debounced, setDebounced] = useState({
    subject: subjectDraft,
    intro: introDraft,
  });
  useEffect(() => {
    const t = setTimeout(
      () => setDebounced({ subject: subjectDraft, intro: introDraft }),
      300,
    );
    return () => clearTimeout(t);
  }, [subjectDraft, introDraft]);

  const previewSchedule = schedule === "off" ? "weekly" : schedule;
  const { data, isLoading, isError } = useGetCleanupReportPreview({
    subject: debounced.subject,
    intro: debounced.intro,
    schedule: previewSchedule,
  });

  return (
    <div
      className="space-y-2 rounded-md border border-dashed bg-muted/30 p-3"
      data-testid="panel-cleanup-report-preview"
    >
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-medium text-muted-foreground">
          معاينة
        </Label>
        {isLoading && (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        )}
      </div>
      {isError ? (
        <div className="text-xs text-rose-600">تعذّر تحميل المعاينة.</div>
      ) : data ? (
        <>
          <div className="space-y-1">
            <div className="text-[11px] text-muted-foreground">
              العنوان
            </div>
            <div
              className="rounded border bg-background px-2 py-1.5 text-sm font-medium"
              data-testid="text-cleanup-report-preview-subject"
            >
              {data.subject}
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>المتن</span>
              <span>
                النطاق {data.from} → {data.to} · {data.rowCount} عملية تنظيف ·{" "}
                {data.complianceAlertCount} تنبيه امتثال
              </span>
            </div>
            <pre
              className="max-h-56 overflow-auto whitespace-pre-wrap rounded border bg-background px-2 py-2 text-xs leading-relaxed"
              dir="rtl"
              data-testid="text-cleanup-report-preview-body"
            >
              {data.body}
            </pre>
          </div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground">جارٍ التحميل…</div>
      )}
    </div>
  );
}

function FeatureFlagsTab() {
  const { data: flags } = useListFeatureFlags();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateMut = useUpdateFeatureFlag();

  const handleToggle = async (key: string, isEnabled: boolean) => {
    await updateMut.mutateAsync({ key, data: { isEnabled } });
    toast({ title: isEnabled ? "تم التفعيل" : "تم الإيقاف" });
    queryClient.invalidateQueries({ predicate: (q) => {
      const k = q.queryKey?.[0];
      return typeof k === "string" && (k.includes("/admin/feature-flags") || k.includes("/admin/stats"));
    } });
  };

  const grouped = (flags ?? []).reduce<Record<string, typeof flags>>((acc, f) => {
    if (!acc[f.category]) acc[f.category] = [] as never;
    (acc[f.category] as typeof flags)?.push(f);
    return acc;
  }, {});

  const categoryLabels: Record<string, string> = {
    pos: "نقاط البيع",
    compliance: "الامتثال والضرائب",
    accounting: "المحاسبة",
    ai: "الذكاء الاصطناعي",
    communication: "التواصل والإشعارات",
    developer: "المطورون",
    security: "الأمان",
    general: "عام",
  };

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat}>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-muted-foreground">
            <Sparkles className="size-4" />
            {categoryLabels[cat] ?? cat}
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            {(items ?? []).map((f) => (
              <Card key={f.id} data-testid={`flag-${f.key}`}>
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{f.name}</div>
                    {f.description && (
                      <p className="mt-1 text-xs text-muted-foreground">{f.description}</p>
                    )}
                    <code className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" dir="ltr">
                      {f.key}
                    </code>
                  </div>
                  <Switch
                    checked={f.isEnabled}
                    onCheckedChange={(v) => handleToggle(f.key, v)}
                    data-testid={`switch-${f.key}`}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AiModelsTab() {
  const { data: models, refetch, isLoading } = useListAiModels();
  const trainMut = useTrainAiModel();
  const trainAllMut = useTrainAllAiModels();
  const { toast } = useToast();

  const handleTrain = async (key: string, name: string) => {
    try {
      const r = await trainMut.mutateAsync({ key });
      toast({
        title: `تم تدريب نموذج "${name}"`,
        description: `الدقة: ${(((r as { accuracy?: number }).accuracy ?? 0) * 100).toFixed(1)}% • العينات: ${(r as { trainingSize?: number }).trainingSize ?? 0}`,
      });
      refetch();
    } catch (err) {
      toast({
        title: "فشل التدريب",
        description: err instanceof Error ? err.message : "خطأ غير معروف",
        variant: "destructive",
      });
    }
  };

  const handleTrainAll = async () => {
    try {
      await trainAllMut.mutateAsync();
      toast({ title: "اكتمل تدريب جميع النماذج" });
      refetch();
    } catch (err) {
      toast({
        title: "فشل التدريب الجماعي",
        description: err instanceof Error ? err.message : "خطأ",
        variant: "destructive",
      });
    }
  };

  const categoryLabels: Record<string, string> = {
    forecasting: "التنبؤ",
    customer: "العملاء",
    fraud: "كشف الاحتيال",
    recommendation: "التوصيات",
    assistant: "المساعد الذكي",
  };

  const statusBadge = (status: string) => {
    if (status === "ready")
      return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">جاهز</Badge>;
    if (status === "training")
      return <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400">قيد التدريب</Badge>;
    if (status === "error")
      return <Badge className="bg-red-500/15 text-red-700 dark:text-red-400">خطأ</Badge>;
    return <Badge variant="outline">غير مدرب</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">نماذج الذكاء الاصطناعي</h2>
          <p className="text-sm text-muted-foreground">
            5 نماذج مدربة على بيانات أعمالك الفعلية: تنبؤ المبيعات، تصنيف العملاء، كشف الاحتيال، التوصيات، والمساعد الذكي.
          </p>
        </div>
        <Button onClick={handleTrainAll} disabled={trainAllMut.isPending} data-testid="btn-train-all">
          {trainAllMut.isPending ? (
            <Loader2 className="me-2 size-4 animate-spin" />
          ) : (
            <Cpu className="me-2 size-4" />
          )}
          تدريب جميع النماذج
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">جارِ التحميل...</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {(models ?? []).map((m) => {
          const accPct = ((m.accuracy ?? 0) * 100).toFixed(1);
          const trained = m.lastTrainedAt
            ? new Date(m.lastTrainedAt).toLocaleString("ar-SA", { dateStyle: "short", timeStyle: "short" })
            : "—";
          return (
            <Card key={m.id} data-testid={`ai-model-${m.key}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="size-4 text-primary" />
                      {m.name}
                    </CardTitle>
                    {m.description && (
                      <CardDescription className="mt-1">{m.description}</CardDescription>
                    )}
                  </div>
                  {statusBadge(m.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-center text-xs">
                  <div>
                    <div className="text-muted-foreground">الدقة</div>
                    <div className="mt-0.5 text-base font-bold text-primary">{accPct}%</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">حجم التدريب</div>
                    <div className="mt-0.5 text-base font-bold">{m.trainingSize ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">الفئة</div>
                    <div className="mt-0.5 text-xs font-medium">{categoryLabels[m.category] ?? m.category}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Database className="size-3" />
                    آخر تدريب: {trained}
                  </span>
                </div>
                {m.lastError && (
                  <p className="rounded bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">
                    {m.lastError}
                  </p>
                )}
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleTrain(m.key, m.name)}
                  disabled={trainMut.isPending}
                  data-testid={`btn-train-${m.key}`}
                >
                  {trainMut.isPending ? (
                    <Loader2 className="me-2 size-4 animate-spin" />
                  ) : (
                    <Cpu className="me-2 size-4" />
                  )}
                  إعادة التدريب
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <AiPredictionsPanel />
    </div>
  );
}

function AiPredictionsPanel() {
  const { data: forecast } = useGetSalesForecast();
  const { data: atRisk } = useGetAtRiskCustomers({ limit: 5 });
  const { data: anomalies } = useGetFraudAnomalies({ limit: 5 });
  const { data: recs } = useGetProductRecommendations({ limit: 5 });

  const fc = forecast?.forecast ?? [];
  const totalForecast = fc.reduce((s, d) => s + Number(d.predicted), 0);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">توقع المبيعات (7 أيام)</CardTitle>
          <CardDescription className="inline-flex items-center gap-1">إجمالي متوقع: <Money value={totalForecast} fractionDigits={0} /></CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1 text-sm">
            {fc.length === 0 && <p className="text-muted-foreground">لا تتوفر توقعات. درّب نموذج توقع المبيعات أولاً.</p>}
            {fc.map((d) => (
              <div key={d.date} className="flex items-center justify-between border-b py-1 last:border-0">
                <span className="text-muted-foreground">{new Date(d.date).toLocaleDateString("ar-SA", { weekday: "short", day: "numeric", month: "short" })}</span>
                <span className="font-mono font-semibold"><Money value={d.predicted} fractionDigits={0} /></span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">عملاء معرضون لخطر الانقطاع</CardTitle>
          <CardDescription>أعلى 5 عملاء بحاجة لمتابعة</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {(atRisk?.customers ?? []).length === 0 && (
              <p className="text-muted-foreground">لا توجد بيانات. درّب نموذج تصنيف العملاء أولاً.</p>
            )}
            {(atRisk?.customers ?? []).map((c) => (
              <div key={c.customerId} className="flex items-center justify-between rounded border p-2">
                <span className="font-medium">{c.name}</span>
                <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                  خطر {(Number(c.riskScore) * 100).toFixed(0)}%
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">طلبات مشبوهة</CardTitle>
          <CardDescription>تنبيهات من نموذج كشف الاحتيال</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {(anomalies?.anomalies ?? []).length === 0 && (
              <p className="text-muted-foreground">لا توجد طلبات مشبوهة.</p>
            )}
            {(anomalies?.anomalies ?? []).map((a) => (
              <div key={a.orderId} className="flex items-center justify-between rounded border p-2">
                <div>
                  <div className="font-medium">طلب #{a.orderId}</div>
                  <div className="text-xs text-muted-foreground">{a.reason}</div>
                </div>
                <span className="font-mono text-amber-700 dark:text-amber-400"><Money value={a.amount} /></span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">توصيات منتجات</CardTitle>
          <CardDescription>منتجات يُشترى معاً (تحليل السلة)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {(recs?.recommendations ?? []).length === 0 && (
              <p className="text-muted-foreground">لا توجد توصيات. درّب نموذج التوصيات أولاً.</p>
            )}
            {(recs?.recommendations ?? []).map((r, i) => (
              <div key={i} className="rounded border p-2">
                <div className="font-medium">
                  {r.productAName} ↔ {r.productBName}
                </div>
                <div className="text-xs text-muted-foreground">قوة الارتباط: ×{Number(r.lift).toFixed(2)}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AssistantTab() {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);
  const askMut = useAskAiAssistant();
  const { toast } = useToast();

  const handleAsk = async () => {
    if (question.trim().length < 2) return;
    const q = question.trim();
    setQuestion("");
    try {
      const res = await askMut.mutateAsync({ data: { question: q } });
      setHistory((h) => [...h, { q, a: res.answer }]);
    } catch (err) {
      toast({
        title: "فشل المساعد الذكي",
        description: err instanceof Error ? err.message : "خطأ",
        variant: "destructive",
      });
    }
  };

  const examples = [
    "ما هي أهم 3 توصيات لزيادة المبيعات هذا الأسبوع؟",
    "كيف أداء فروعي خلال الشهر الماضي؟",
    "ما المنتجات التي يجب إعادة تخزينها قريباً؟",
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" />
          المساعد الذكي
        </CardTitle>
        <CardDescription>
          اسأل أي سؤال عن أعمالك. المساعد يحلل بياناتك الفعلية ويعطيك إجابات فورية.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-h-96 space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-3">
          {history.length === 0 && (
            <div className="space-y-2 py-8 text-center">
              <Sparkles className="mx-auto size-8 text-primary/40" />
              <p className="text-sm text-muted-foreground">ابدأ المحادثة. جرّب أحد الأمثلة:</p>
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {examples.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => setQuestion(ex)}
                    className="rounded-full border bg-background px-3 py-1 text-xs hover:bg-muted"
                    data-testid={`example-${examples.indexOf(ex)}`}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}
          {history.map((m, i) => (
            <div key={i} className="space-y-2">
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                  {m.q}
                </div>
              </div>
              <div className="flex justify-start">
                <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-background px-3 py-2 text-sm">
                  {m.a}
                </div>
              </div>
            </div>
          ))}
          {askMut.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              يفكر المساعد...
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleAsk();
              }
            }}
            placeholder="اكتب سؤالك..."
            disabled={askMut.isPending}
            data-testid="input-assistant-question"
          />
          <Button onClick={handleAsk} disabled={askMut.isPending || question.trim().length < 2} data-testid="btn-ask">
            <Send className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AuditTab() {
  const { data: logs } = useListAuditLogs({ limit: 50 });
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الإجراء</TableHead>
              <TableHead>المورد</TableHead>
              <TableHead>المستخدم</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>الوقت</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  لا توجد سجلات
                </TableCell>
              </TableRow>
            )}
            {logs?.map((l) => (
              <TableRow key={l.id}>
                <TableCell><Badge variant="outline">{l.action}</Badge></TableCell>
                <TableCell className="text-sm">{l.entity}</TableCell>
                <TableCell className="text-sm">{l.userName ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground" dir="ltr">{l.ipAddress ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(l.createdAt).toLocaleString("ar-SA")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function AdminPage() {
  const { user } = useAuth();
  const { isRTL, t } = useLanguage();
  const [, setLocation] = useLocation();
  // Task #198: remember the last selected top-level tab per-admin so the
  // panel feels sticky across reloads. Hydrate once when settings arrive.
  const { data: settings } = useGetSystemSettings();
  const updatePrefs = useUpdateAdminPrefs();
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [tabHydrated, setTabHydrated] = useState(false);
  // Task #222: deep link from the proactive "cleanup-report bounced"
  // admin notification. URL shape:
  //   /admin?tab=overview&cleanupReportSendId=NN#cleanup-report-send-NN
  // We force the tab from the query param BEFORE hydrating the
  // remembered-tab pref so the user always lands where the email
  // promised, then scroll/highlight the matching send-history row
  // once it appears in the DOM.
  const deepLinkSendId = (() => {
    if (typeof window === "undefined") return null;
    const sp = new URLSearchParams(window.location.search);
    const raw = sp.get("cleanupReportSendId");
    if (!raw) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  useEffect(() => {
    if (tabHydrated) return;
    if (deepLinkSendId !== null) {
      // Query-param target wins over the remembered pref.
      setActiveTab("overview");
      setTabHydrated(true);
      return;
    }
    if (!settings?.adminPrefs) return;
    const remembered = settings.adminPrefs.lastAdminTab;
    if (remembered) setActiveTab(remembered);
    setTabHydrated(true);
  }, [tabHydrated, settings, deepLinkSendId]);
  // After hydration, find the deep-linked row and scroll/highlight it.
  // Retries briefly because the cleanup-report-sends query may not have
  // resolved yet on first paint.
  useEffect(() => {
    if (!tabHydrated || deepLinkSendId === null) return;
    let cancelled = false;
    let attempts = 0;
    const tryScroll = () => {
      if (cancelled) return;
      const el = document.getElementById(
        `cleanup-report-send-${deepLinkSendId}`,
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-primary", "bg-primary/5");
        window.setTimeout(() => {
          el.classList.remove("ring-2", "ring-primary", "bg-primary/5");
        }, 4000);
        return;
      }
      if (attempts++ < 20) window.setTimeout(tryScroll, 250);
    };
    tryScroll();
    return () => {
      cancelled = true;
    };
  }, [tabHydrated, deepLinkSendId]);
  const handleTabChange = (v: string) => {
    setActiveTab(v);
    if (tabHydrated) {
      updatePrefs.mutate({ data: { lastAdminTab: v } });
    }
  };

  if (user && user.role !== "manager" && user.role !== "owner") {
    return <AccessDenied />;
  }

  const isOwner = user?.role === "owner";

  return (
    <div className="mx-auto max-w-7xl space-y-6" dir={isRTL ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldCheck className="size-6 text-primary" />
            لوحة تحكم المدير
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            تحكّم كامل في النظام: الدعم الفني، الإعلانات، الميزات، السجلات.
          </p>
        </div>
        <Button variant="outline" onClick={() => setLocation("/")}>
          عودة للوحة الرئيسية
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="overview" data-testid="tab-overview">
            <Activity className="me-2 size-4" />
            نظرة عامة
          </TabsTrigger>
          <TabsTrigger value="tickets" data-testid="tab-tickets">
            <LifeBuoy className="me-2 size-4" />
            الدعم الفني
          </TabsTrigger>
          <TabsTrigger value="announcements" data-testid="tab-announcements">
            <Megaphone className="me-2 size-4" />
            الإعلانات
          </TabsTrigger>
          <TabsTrigger value="permissions" data-testid="tab-permissions">
            مصفوفة الصلاحيات
          </TabsTrigger>
          <TabsTrigger value="features" data-testid="tab-features">
            <ToggleRight className="me-2 size-4" />
            الميزات
          </TabsTrigger>
          <TabsTrigger value="ai" data-testid="tab-ai">
            <Cpu className="me-2 size-4" />
            نماذج AI
          </TabsTrigger>
          <TabsTrigger value="assistant" data-testid="tab-assistant">
            <Sparkles className="me-2 size-4" />
            المساعد الذكي
          </TabsTrigger>
          <TabsTrigger value="workflow" data-testid="tab-workflow">
            <Workflow className="me-1 size-4" /> سير العمل
          </TabsTrigger>
          <TabsTrigger value="integrations" data-testid="tab-integrations">
            <Plug className="me-2 size-4" />
            التكاملات
          </TabsTrigger>
          <TabsTrigger value="marketplaces" data-testid="tab-marketplaces">
            <Plug className="me-2 size-4" />
            المتاجر
          </TabsTrigger>
          {isOwner && (
            <TabsTrigger value="companies" data-testid="tab-companies">
              <Briefcase className="me-1 size-4" /> الشركات
            </TabsTrigger>
          )}
          {isOwner && (
            <TabsTrigger value="team-privacy" data-testid="tab-team-privacy">
              <ShieldCheck className="me-1 size-4" /> {t("teamPrivacy.tab")}
            </TabsTrigger>
          )}
          <TabsTrigger value="company" data-testid="tab-company">
            <Building2 className="me-2 size-4" />
            بيانات الشركة
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">
            <History className="me-2 size-4" />
            السجلات
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="tickets"><TicketsTab /></TabsContent>
        <TabsContent value="announcements"><AnnouncementsTab /></TabsContent>
        <TabsContent value="permissions"><PermissionsMatrixTab /></TabsContent>
        <TabsContent value="features"><FeatureFlagsTab /></TabsContent>
        <TabsContent value="ai"><AiModelsTab /></TabsContent>
        <TabsContent value="assistant"><AssistantTab /></TabsContent>
        <TabsContent value="workflow"><WorkflowTab /></TabsContent>
        <TabsContent value="integrations"><IntegrationsTab /></TabsContent>
        <TabsContent value="marketplaces"><MarketplacesTab /></TabsContent>
        {isOwner && <TabsContent value="companies"><CompaniesTable /></TabsContent>}
        {isOwner && <TabsContent value="team-privacy"><TeamPrivacyTab /></TabsContent>}
        <TabsContent value="company"><CompanySettingsTab /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
      </Tabs>
      {/* hint icon used for tone palette */}
      <AlertTriangle className="hidden" />
    </div>
  );
}
