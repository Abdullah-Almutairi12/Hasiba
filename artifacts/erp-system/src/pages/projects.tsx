import { useState } from "react";
import { useApiQuery, useApiMutation } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  FolderKanban,
  Wallet,
  TrendingUp,
  CalendarClock,
} from "lucide-react";

type Project = {
  id: number;
  name: string;
  code: string | null;
  customerId: number | null;
  customerName: string | null;
  managerId: number | null;
  status: string;
  priority: string;
  budget: number;
  spent: number;
  progress: number;
  startDate: string | null;
  dueDate: string | null;
  description: string | null;
};
type Summary = { totalProjects: number; activeProjects: number; totalBudget: number; totalSpent: number };

const SAR = (n: number) =>
  new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR", maximumFractionDigits: 0 }).format(n);

const statusMeta: Record<string, { label: string; cls: string }> = {
  planning: { label: "تخطيط", cls: "bg-slate-100 text-slate-700" },
  active: { label: "نشط", cls: "bg-emerald-100 text-emerald-700" },
  on_hold: { label: "متوقف", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "مكتمل", cls: "bg-blue-100 text-blue-700" },
  cancelled: { label: "ملغى", cls: "bg-rose-100 text-rose-700" },
};

const priorityMeta: Record<string, { label: string; cls: string }> = {
  low: { label: "منخفض", cls: "bg-slate-100 text-slate-700" },
  medium: { label: "متوسط", cls: "bg-blue-100 text-blue-700" },
  high: { label: "عالٍ", cls: "bg-amber-100 text-amber-700" },
  urgent: { label: "عاجل", cls: "bg-rose-100 text-rose-700" },
};

const KANBAN_COLUMNS: { key: Project["status"]; title: string; color: string }[] = [
  { key: "planning", title: "تخطيط", color: "bg-slate-50 border-slate-200" },
  { key: "active", title: "نشط", color: "bg-emerald-50 border-emerald-200" },
  { key: "on_hold", title: "متوقف", color: "bg-amber-50 border-amber-200" },
  { key: "completed", title: "مكتمل", color: "bg-blue-50 border-blue-200" },
];

function NewProjectDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", budget: "", dueDate: "", description: "" });
  const create = useApiMutation<unknown, Project>("/projects", ["/projects", "/projects/summary"]);

  const submit = async () => {
    if (!form.name.trim()) return;
    await create.mutateAsync({
      name: form.name.trim(),
      code: form.code.trim() || undefined,
      budget: form.budget ? Number(form.budget) : 0,
      dueDate: form.dueDate || undefined,
      description: form.description.trim() || undefined,
    });
    setForm({ name: "", code: "", budget: "", dueDate: "", description: "" });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2" data-testid="button-new-project">
          <Plus className="size-4" />
          مشروع جديد
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>مشروع جديد</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold">اسم المشروع</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="مثال: تطوير متجر إلكتروني"
              data-testid="input-project-name"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold">الكود</label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="PRJ-007"
                dir="ltr"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold">الميزانية (ر.س)</label>
              <Input
                type="number"
                value={form.budget}
                onChange={(e) => setForm({ ...form, budget: e.target.value })}
                placeholder="50000"
                dir="ltr"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold">تاريخ الاستحقاق</label>
            <Input
              type="date"
              value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold">الوصف</label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
            />
          </div>
          {create.isError && <p className="text-xs text-rose-600">{(create.error as Error).message}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={create.isPending} data-testid="button-save-project">
            {create.isPending ? "جارِ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  iconClass,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  iconClass?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs font-bold text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-extrabold">{value}</p>
          {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <div className={`grid size-12 place-items-center rounded-2xl ${iconClass ?? "bg-primary/10 text-primary"}`}>
          <Icon className="size-6" />
        </div>
      </CardContent>
    </Card>
  );
}

function KanbanCard({ project }: { project: Project }) {
  return (
    <div className="rounded-xl border border-border/80 bg-white p-3 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold leading-tight">{project.name}</p>
        <Badge className={priorityMeta[project.priority]?.cls ?? ""}>
          {priorityMeta[project.priority]?.label ?? project.priority}
        </Badge>
      </div>
      {project.code && (
        <p className="mt-1 text-[11px] text-muted-foreground" dir="ltr">{project.code}</p>
      )}
      {project.customerName && (
        <p className="mt-2 text-xs text-muted-foreground">العميل: {project.customerName}</p>
      )}
      <div className="mt-3 space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">التقدم</span>
          <span className="font-bold">{project.progress}%</span>
        </div>
        <Progress value={project.progress} className="h-1.5" />
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{SAR(project.spent)} / {SAR(project.budget)}</span>
        {project.dueDate && (
          <span className="text-muted-foreground" dir="ltr">{project.dueDate}</span>
        )}
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const { data: summary } = useApiQuery<Summary>("/projects/summary");
  const { data: projects, isLoading } = useApiQuery<Project[]>("/projects");

  const grouped = (projects ?? []).reduce<Record<string, Project[]>>((acc, p) => {
    (acc[p.status] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">المشاريع</h1>
          <p className="text-muted-foreground">تتبع حالة المشاريع، الميزانيات، والمهام</p>
        </div>
        <NewProjectDialog />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={FolderKanban} label="إجمالي المشاريع" value={String(summary?.totalProjects ?? 0)}
          hint={`${summary?.activeProjects ?? 0} نشط`} />
        <StatCard icon={Wallet} label="إجمالي الميزانيات" value={SAR(summary?.totalBudget ?? 0)}
          iconClass="bg-blue-100 text-blue-700" />
        <StatCard icon={TrendingUp} label="إجمالي المصروف" value={SAR(summary?.totalSpent ?? 0)}
          iconClass="bg-emerald-100 text-emerald-700" />
        <StatCard
          icon={CalendarClock}
          label="معدل الاستهلاك"
          value={
            summary?.totalBudget
              ? `${Math.round((summary.totalSpent / summary.totalBudget) * 100)}%`
              : "0%"
          }
          iconClass="bg-purple-100 text-purple-700"
        />
      </div>

      <Tabs defaultValue="kanban">
        <TabsList>
          <TabsTrigger value="kanban" data-testid="tab-kanban">لوحة كانبان</TabsTrigger>
          <TabsTrigger value="list" data-testid="tab-list">قائمة</TabsTrigger>
        </TabsList>

        <TabsContent value="kanban" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {KANBAN_COLUMNS.map((col) => (
              <div key={col.key} className={`rounded-2xl border ${col.color} p-3`}>
                <div className="mb-3 flex items-center justify-between px-1">
                  <h3 className="text-sm font-bold">{col.title}</h3>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                    {(grouped[col.key] ?? []).length}
                  </span>
                </div>
                <div className="space-y-2">
                  {isLoading ? (
                    <Skeleton className="h-24" />
                  ) : (
                    (grouped[col.key] ?? []).map((p) => <KanbanCard key={p.id} project={p} />)
                  )}
                  {!isLoading && (grouped[col.key] ?? []).length === 0 && (
                    <p className="text-center text-[11px] text-muted-foreground py-6">لا يوجد مشاريع</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="list" className="mt-4">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">جميع المشاريع</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>المشروع</TableHead>
                    <TableHead>العميل</TableHead>
                    <TableHead className="text-center">الأولوية</TableHead>
                    <TableHead>التقدم</TableHead>
                    <TableHead className="text-left">الميزانية</TableHead>
                    <TableHead className="text-left">المصروف</TableHead>
                    <TableHead className="text-center">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={7}><Skeleton className="h-5 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : (projects ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                        لا يوجد مشاريع. ابدأ بإضافة أول مشروع.
                      </TableCell>
                    </TableRow>
                  ) : (
                    projects!.map((p) => (
                      <TableRow key={p.id} data-testid={`row-project-${p.id}`}>
                        <TableCell>
                          <div className="font-medium">{p.name}</div>
                          {p.code && <div className="text-[11px] text-muted-foreground" dir="ltr">{p.code}</div>}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{p.customerName ?? "—"}</TableCell>
                        <TableCell className="text-center">
                          <Badge className={priorityMeta[p.priority]?.cls ?? ""}>
                            {priorityMeta[p.priority]?.label ?? p.priority}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={p.progress} className="h-1.5 w-24" />
                            <span className="text-xs font-bold">{p.progress}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-left">{SAR(p.budget)}</TableCell>
                        <TableCell className="text-left">{SAR(p.spent)}</TableCell>
                        <TableCell className="text-center">
                          <Badge className={statusMeta[p.status]?.cls ?? ""}>
                            {statusMeta[p.status]?.label ?? p.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
