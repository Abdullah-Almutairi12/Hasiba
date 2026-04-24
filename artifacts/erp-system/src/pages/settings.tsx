import { useGetSecurityChecklist, useListAuditLogs } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Lock,
  Activity,
  FileSearch,
  Sparkles,
  Check,
  X,
} from "lucide-react";

function StatusIcon({ status }: { status: string }) {
  if (status === "active") return <CheckCircle2 className="size-5 text-green-400" />;
  if (status === "warning") return <AlertTriangle className="size-5 text-amber-400" />;
  return <XCircle className="size-5 text-red-400" />;
}

function severityBadge(severity: string) {
  const map: Record<string, string> = {
    critical: "border-red-500/40 bg-red-500/10 text-red-300",
    high: "border-orange-500/40 bg-orange-500/10 text-orange-300",
    medium: "border-amber-500/40 bg-amber-500/10 text-amber-300",
    info: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  };
  const labels: Record<string, string> = {
    critical: "حرج",
    high: "عالٍ",
    medium: "متوسط",
    info: "معلوماتي",
  };
  return (
    <Badge variant="outline" className={`border ${map[severity] ?? map.info}`}>
      {labels[severity] ?? severity}
    </Badge>
  );
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  return `قبل ${Math.floor(hours / 24)} يوم`;
}

export default function SettingsPage() {
  const { data: checklist } = useGetSecurityChecklist();
  const { data: logs } = useListAuditLogs();

  const score = checklist?.score ?? 0;
  const items = checklist?.items ?? [];
  const matrix = checklist?.roleMatrix ?? [];
  const auditLogs = logs ?? [];

  return (
    <div dir="rtl" className="min-h-screen bg-[#0a0e1a] text-white">
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">الأمان والإعدادات المتقدمة</h1>
            <p className="mt-1 text-white/60">
              لوحة الامتثال لمعايير الهيئة الوطنية للأمن السيبراني (NCA ECC)
            </p>
          </div>
          <Button className="bg-gradient-to-l from-blue-500 to-cyan-400 hover:from-blue-600 hover:to-cyan-500">
            <Sparkles className="ms-2 size-4" />
            تصدير تقرير الامتثال
          </Button>
        </div>

        {/* Top KPIs */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Score Card with circular progress */}
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-500/20 via-cyan-500/10 to-blue-500/20 p-6 backdrop-blur-xl">
            <div className="absolute inset-0 bg-grid-white/[0.02]" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/70">درجة الأمان العامة</p>
                  <p className="mt-1 text-5xl font-bold tabular-nums">{score}%</p>
                  <Badge className="mt-3 border-emerald-400/40 bg-emerald-500/20 text-emerald-300">
                    <ShieldCheck className="ms-1 size-3" />
                    {checklist?.ncaCompliant ? "متوافق NCA ECC" : "غير متوافق"}
                  </Badge>
                </div>
                <div className="relative size-24">
                  <svg className="size-24 -rotate-90" viewBox="0 0 100 100">
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      stroke="currentColor"
                      strokeWidth="8"
                      fill="none"
                      className="text-white/10"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="42"
                      stroke="currentColor"
                      strokeWidth="8"
                      fill="none"
                      strokeLinecap="round"
                      strokeDasharray={`${(score / 100) * 264} 264`}
                      className="text-emerald-400"
                    />
                  </svg>
                  <ShieldCheck className="absolute inset-0 m-auto size-8 text-emerald-300" />
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-white/70">العناصر النشطة</p>
                <p className="mt-2 text-4xl font-bold tabular-nums">
                  {items.filter((i) => i.status === "active").length}
                  <span className="text-xl text-white/40">/{items.length}</span>
                </p>
                <p className="mt-2 text-xs text-white/50">من ضوابط الأمان السيبراني</p>
              </div>
              <div className="grid size-12 place-items-center rounded-xl bg-blue-500/20 text-blue-300">
                <Lock className="size-6" />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-white/70">محاولات دخول مشبوهة (24س)</p>
                <p className="mt-2 text-4xl font-bold tabular-nums text-red-400">
                  {auditLogs.filter((l) => l.severity === "critical").length}
                </p>
                <p className="mt-2 text-xs text-white/50">تم الحظر تلقائياً</p>
              </div>
              <div className="grid size-12 place-items-center rounded-xl bg-red-500/20 text-red-300">
                <ShieldAlert className="size-6" />
              </div>
            </div>
          </div>
        </div>

        {/* Two-column: Checklist + Audit Logs */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card className="border-white/10 bg-white/[0.04] text-white backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <ShieldCheck className="size-5 text-cyan-400" />
                ضوابط الامتثال — NCA ECC
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {items.map((item) => (
                  <div
                    key={item.key}
                    className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                  >
                    <div className="flex items-start gap-3">
                      <StatusIcon status={item.status} />
                      <div className="flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-medium">{item.title}</h4>
                          {severityBadge(item.severity)}
                        </div>
                        <p className="mt-1 text-sm text-white/60">{item.description}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/[0.04] text-white backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-white">
                <Activity className="size-5 text-purple-400" />
                سجل التدقيق المباشر
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`rounded-lg border-r-4 bg-white/[0.03] p-3 ${
                      log.severity === "critical"
                        ? "border-red-500"
                        : log.severity === "medium"
                          ? "border-amber-500"
                          : "border-cyan-500"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{log.userName}</span>
                          <span className="text-xs text-white/50">{log.action}</span>
                        </div>
                        <p className="mt-1 text-xs text-white/70">{log.entity}</p>
                        {log.details && (
                          <p className="mt-1 text-xs text-white/50">{log.details}</p>
                        )}
                      </div>
                      <div className="text-left">
                        <p className="text-xs text-white/40">{timeAgo(log.createdAt)}</p>
                        {log.ipAddress && (
                          <p className="mt-0.5 text-[10px] text-white/30" dir="ltr">
                            {log.ipAddress}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                className="mt-4 w-full border-white/20 bg-white/5 text-white hover:bg-white/10"
              >
                <FileSearch className="ms-2 size-4" />
                عرض السجل الكامل
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Role Matrix */}
        <Card className="border-white/10 bg-white/[0.04] text-white backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Lock className="size-5 text-orange-400" />
              مصفوفة الصلاحيات (RBAC)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10 text-right text-sm text-white/60">
                    <th className="pb-3 font-medium">الصلاحية</th>
                    <th className="pb-3 text-center font-medium">مدير عام</th>
                    <th className="pb-3 text-center font-medium">محاسب</th>
                    <th className="pb-3 text-center font-medium">كاشير</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {matrix.map((row, i) => (
                    <tr key={i} className="text-sm">
                      <td className="py-3 font-medium">{row.permission}</td>
                      <td className="py-3 text-center">
                        {row.manager ? (
                          <Check className="mx-auto size-5 text-green-400" />
                        ) : (
                          <X className="mx-auto size-5 text-red-400/60" />
                        )}
                      </td>
                      <td className="py-3 text-center">
                        {row.accountant ? (
                          <Check className="mx-auto size-5 text-green-400" />
                        ) : (
                          <X className="mx-auto size-5 text-red-400/60" />
                        )}
                      </td>
                      <td className="py-3 text-center">
                        {row.cashier ? (
                          <Check className="mx-auto size-5 text-green-400" />
                        ) : (
                          <X className="mx-auto size-5 text-red-400/60" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
