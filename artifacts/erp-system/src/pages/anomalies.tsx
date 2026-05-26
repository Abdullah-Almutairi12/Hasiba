import { useState, useMemo } from "react";
import {
  useListAnomalyRules,
  useUpdateAnomalyRule,
  useListAnomalyEvents,
  useUpdateAnomalyEvent,
  useGetAnomalyStats,
} from "@workspace/api-client-react";
import type { AnomalyRule, AnomalyEvent } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InsightAlert } from "@/components/insight-alert";
import { useLanguage } from "@/hooks/use-language";
import {
  AlertTriangle,
  ShieldAlert,
  Activity,
  Clock,
  CheckCircle2,
  X,
  Save,
} from "lucide-react";

const SEVERITY_LABEL: Record<string, string> = {
  low: "منخفض",
  medium: "متوسط",
  high: "مرتفع",
  critical: "حرج",
};

function severityBadge(sev: string) {
  const variant: "secondary" | "default" | "destructive" =
    sev === "critical" || sev === "high"
      ? "destructive"
      : sev === "medium"
        ? "default"
        : "secondary";
  return <Badge variant={variant}>{SEVERITY_LABEL[sev] ?? sev}</Badge>;
}

function statusBadge(s: string) {
  if (s === "open") return <Badge variant="destructive">مفتوح</Badge>;
  if (s === "acknowledged") return <Badge>تمت المعالجة</Badge>;
  return <Badge variant="secondary">مرفوض</Badge>;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ar-SA", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default function AnomaliesPage() {
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "acknowledged" | "dismissed">("open");

  const statsQuery = useGetAnomalyStats();
  const eventsQuery = useListAnomalyEvents(
    statusFilter === "all" ? { limit: 200 } : { status: statusFilter, limit: 200 },
  );
  const rulesQuery = useListAnomalyRules();

  const updateEvent = useUpdateAnomalyEvent({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["/api/anomalies/events"] });
        void queryClient.invalidateQueries({ queryKey: ["/api/anomalies/stats"] });
        toast({ title: "تم تحديث التنبيه" });
      },
      onError: () => toast({ title: "فشل تحديث التنبيه", variant: "destructive" }),
    },
  });

  const updateRule = useUpdateAnomalyRule({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: ["/api/anomalies/rules"] });
        toast({ title: "تم تحديث القاعدة" });
      },
      onError: () => toast({ title: "فشل تحديث القاعدة", variant: "destructive" }),
    },
  });

  const stats = statsQuery.data;
  const events = eventsQuery.data ?? [];
  const rules = rulesQuery.data ?? [];

  const acknowledge = (id: number, status: "acknowledged" | "dismissed") => {
    updateEvent.mutate({ id, data: { status } });
  };

  return (
    <div className="space-y-6 p-3 sm:p-4 md:p-6" dir="rtl" data-testid="page-anomalies">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="size-6 text-destructive" />
            التنبيهات الذكية للسلوك الشاذ
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            رصد فوري لأنماط مريبة في نقاط البيع والفواتير والمخزون
          </p>
        </div>
      </div>

      <InsightAlert
        tone="warning"
        alertText={t("insight.anomalies_warning")}
        insightText={t("insight.anomalies_insight")}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          icon={<AlertTriangle className="size-5 text-destructive" />}
          label="تنبيهات مفتوحة"
          value={stats?.openCount ?? 0}
        />
        <KpiCard
          icon={<ShieldAlert className="size-5 text-destructive" />}
          label="عالية الخطورة"
          value={stats?.criticalOpen ?? 0}
        />
        <KpiCard
          icon={<Clock className="size-5 text-primary" />}
          label="آخر 24 ساعة"
          value={stats?.last24h ?? 0}
        />
        <KpiCard
          icon={<Activity className="size-5 text-muted-foreground" />}
          label="إجمالي التنبيهات"
          value={stats?.total ?? 0}
        />
      </div>

      <Tabs defaultValue="events" className="w-full">
        <TabsList>
          <TabsTrigger value="events" data-testid="tab-events">
            التنبيهات النشطة
          </TabsTrigger>
          <TabsTrigger value="rules" data-testid="tab-rules">
            القواعد ({rules.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle>سجل التنبيهات</CardTitle>
                <CardDescription>
                  راجع وأقرّ كل تنبيه ليُرفع من قائمة العمل المفتوحة
                </CardDescription>
              </div>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
              >
                <SelectTrigger className="w-48" data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">مفتوح فقط</SelectItem>
                  <SelectItem value="acknowledged">تمت المعالجة</SelectItem>
                  <SelectItem value="dismissed">مرفوض</SelectItem>
                  <SelectItem value="all">الكل</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <CheckCircle2 className="size-12 mx-auto mb-2 text-emerald-500" />
                  لا توجد تنبيهات حالياً ضمن هذا التصنيف.
                </div>
              ) : (
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الوقت</TableHead>
                        <TableHead>القاعدة</TableHead>
                        <TableHead>المنفّذ</TableHead>
                        <TableHead>الخطورة</TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead>التفاصيل</TableHead>
                        <TableHead className="text-end">إجراء</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {events.map((e: AnomalyEvent) => (
                        <TableRow key={e.id} data-testid={`row-anomaly-${e.id}`}>
                          <TableCell className="text-xs whitespace-nowrap">
                            {formatTime(e.createdAt)}
                          </TableCell>
                          <TableCell className="font-medium">{e.ruleName}</TableCell>
                          <TableCell>{e.actorName ?? "—"}</TableCell>
                          <TableCell>{severityBadge(e.severity)}</TableCell>
                          <TableCell>{statusBadge(e.status)}</TableCell>
                          <TableCell className="text-xs max-w-xs truncate">
                            {e.payload ? JSON.stringify(e.payload) : "—"}
                          </TableCell>
                          <TableCell className="text-end">
                            {e.status === "open" ? (
                              <div className="flex gap-1 justify-end">
                                <Button
                                  size="sm"
                                  variant="default"
                                  data-testid={`button-ack-${e.id}`}
                                  onClick={() => acknowledge(e.id, "acknowledged")}
                                  disabled={updateEvent.isPending}
                                >
                                  <CheckCircle2 className="size-4 ms-1" />
                                  إقرار
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  data-testid={`button-dismiss-${e.id}`}
                                  onClick={() => acknowledge(e.id, "dismissed")}
                                  disabled={updateEvent.isPending}
                                >
                                  <X className="size-4" />
                                </Button>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {e.acknowledgedByName ?? "—"}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" className="space-y-3">
          {rules.map((r: AnomalyRule) => (
            <RuleCard
              key={r.id}
              rule={r}
              onSave={(patch) => updateRule.mutate({ key: r.ruleKey, data: patch })}
              saving={updateRule.isPending}
            />
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="rounded-md bg-muted p-2">{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-2xl font-bold">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

type RulePatch = {
  windowMinutes?: number;
  threshold?: number;
  severity?: "low" | "medium" | "high" | "critical";
  isEnabled?: boolean;
};

function RuleCard({
  rule,
  onSave,
  saving,
}: {
  rule: AnomalyRule;
  onSave: (patch: RulePatch) => void;
  saving: boolean;
}) {
  const [windowMinutes, setWindowMinutes] = useState(rule.windowMinutes);
  const [threshold, setThreshold] = useState(rule.threshold);
  const [severity, setSeverity] = useState(rule.severity);
  const [isEnabled, setIsEnabled] = useState(rule.isEnabled);

  const dirty = useMemo(
    () =>
      windowMinutes !== rule.windowMinutes ||
      threshold !== rule.threshold ||
      severity !== rule.severity ||
      isEnabled !== rule.isEnabled,
    [windowMinutes, threshold, severity, isEnabled, rule],
  );

  return (
    <Card data-testid={`rule-${rule.ruleKey}`}>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{rule.name}</CardTitle>
            {rule.description && (
              <CardDescription className="mt-1">{rule.description}</CardDescription>
            )}
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={setIsEnabled}
            data-testid={`switch-${rule.ruleKey}`}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className="text-xs text-muted-foreground">نافذة الزمن (دقيقة)</label>
            <Input
              type="number"
              min={1}
              value={windowMinutes}
              onChange={(e) => setWindowMinutes(Number(e.target.value) || 1)}
              data-testid={`input-window-${rule.ruleKey}`}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">العتبة</label>
            <Input
              type="number"
              min={1}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value) || 1)}
              data-testid={`input-threshold-${rule.ruleKey}`}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">الخطورة</label>
            <Select
              value={severity}
              onValueChange={(v) => setSeverity(v)}
            >
              <SelectTrigger data-testid={`select-severity-${rule.ruleKey}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">منخفض</SelectItem>
                <SelectItem value="medium">متوسط</SelectItem>
                <SelectItem value="high">مرتفع</SelectItem>
                <SelectItem value="critical">حرج</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={!dirty || saving}
            onClick={() =>
              onSave({
                windowMinutes,
                threshold,
                severity: severity as RulePatch["severity"],
                isEnabled,
              })
            }
            data-testid={`button-save-${rule.ruleKey}`}
          >
            <Save className="size-4 ms-1" />
            حفظ
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
