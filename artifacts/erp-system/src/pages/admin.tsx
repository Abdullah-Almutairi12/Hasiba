import { useState } from "react";
import { useLocation } from "wouter";
import {
  useGetAdminStats,
  useGetAdminSystemHealth,
  useListSupportTickets,
  useCreateSupportTicket,
  useUpdateSupportTicket,
  useListAnnouncements,
  useCreateAnnouncement,
  useDeleteAnnouncement,
  useListFeatureFlags,
  useUpdateFeatureFlag,
  useListAuditLogs,
} from "@workspace/api-client-react";
import type { SupportTicket } from "@workspace/api-client-react";
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
  ShieldCheck,
  LifeBuoy,
  Megaphone,
  ToggleRight,
  Activity,
  History,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Database,
  Cpu,
  Loader2,
  Send,
} from "lucide-react";

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

function OverviewTab() {
  const { data: stats } = useGetAdminStats();
  const { data: health } = useGetAdminSystemHealth();
  const { data: announcements } = useListAnnouncements();

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
    hr: "الموارد البشرية",
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
  const { isRTL } = useLanguage();
  const [, setLocation] = useLocation();

  if (user && user.role !== "manager") {
    return <AccessDenied />;
  }

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

      <Tabs defaultValue="overview" className="space-y-4">
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
          <TabsTrigger value="features" data-testid="tab-features">
            <ToggleRight className="me-2 size-4" />
            الميزات
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">
            <History className="me-2 size-4" />
            السجلات
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="tickets"><TicketsTab /></TabsContent>
        <TabsContent value="announcements"><AnnouncementsTab /></TabsContent>
        <TabsContent value="features"><FeatureFlagsTab /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
      </Tabs>
      {/* hint icon used for tone palette */}
      <AlertTriangle className="hidden" />
    </div>
  );
}
