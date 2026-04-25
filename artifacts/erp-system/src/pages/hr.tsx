import { useState } from "react";
import { useApiQuery, useApiMutation } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Users as UsersIcon,
  Building2,
  Wallet,
  CalendarCheck2,
  UserCircle,
} from "lucide-react";

type Employee = {
  id: number;
  fullName: string;
  jobTitle: string;
  email: string | null;
  phone: string | null;
  departmentId: number | null;
  branchId: number | null;
  baseSalary: number;
  housingAllowance: number;
  transportAllowance: number;
  hireDate: string | null;
  status: string;
};
type Department = { id: number; name: string; code: string | null };
type AttendanceRow = {
  id: number;
  employeeId: number;
  employeeName: string | null;
  workDate: string;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
  hoursWorked: number;
};
type PayrollRow = {
  id: number;
  employeeName: string | null;
  period: string;
  baseSalary: number;
  allowances: number;
  deductions: number;
  bonus: number;
  netPay: number;
  status: string;
};
type Summary = {
  totalEmployees: number;
  activeEmployees: number;
  totalDepartments: number;
  monthlyPayrollTotal: number;
};

const SAR = (n: number) =>
  new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR", maximumFractionDigits: 0 }).format(n);

const statusBadge: Record<string, { label: string; cls: string }> = {
  active: { label: "نشط", cls: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" },
  on_leave: { label: "في إجازة", cls: "bg-amber-100 text-amber-800 hover:bg-amber-100" },
  terminated: { label: "منتهي", cls: "bg-rose-100 text-rose-800 hover:bg-rose-100" },
  present: { label: "حاضر", cls: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" },
  late: { label: "متأخر", cls: "bg-amber-100 text-amber-800 hover:bg-amber-100" },
  absent: { label: "غائب", cls: "bg-rose-100 text-rose-800 hover:bg-rose-100" },
  paid: { label: "مدفوع", cls: "bg-emerald-100 text-emerald-800 hover:bg-emerald-100" },
  pending: { label: "قيد الإصدار", cls: "bg-amber-100 text-amber-800 hover:bg-amber-100" },
};

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

function NewEmployeeDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fullName: "", jobTitle: "", email: "", phone: "", baseSalary: "" });
  const create = useApiMutation<unknown, Employee>("/hr/employees", ["/hr/employees", "/hr/summary"]);

  const submit = async () => {
    if (!form.fullName.trim() || !form.jobTitle.trim()) return;
    await create.mutateAsync({
      fullName: form.fullName.trim(),
      jobTitle: form.jobTitle.trim(),
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      baseSalary: form.baseSalary ? Number(form.baseSalary) : 0,
    });
    setForm({ fullName: "", jobTitle: "", email: "", phone: "", baseSalary: "" });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2" data-testid="button-new-employee">
          <Plus className="size-4" />
          إضافة موظف
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>موظف جديد</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold">الاسم الكامل</label>
            <Input
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              placeholder="مثال: محمد أحمد العتيبي"
              data-testid="input-employee-name"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold">المسمى الوظيفي</label>
            <Input
              value={form.jobTitle}
              onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
              placeholder="مثال: محاسب أول"
              data-testid="input-employee-title"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold">البريد</label>
              <Input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                dir="ltr"
                placeholder="name@hasba.ai"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold">الجوال</label>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                dir="ltr"
                placeholder="05xxxxxxxx"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold">الراتب الأساسي (ر.س)</label>
            <Input
              type="number"
              value={form.baseSalary}
              onChange={(e) => setForm({ ...form, baseSalary: e.target.value })}
              dir="ltr"
              placeholder="10000"
            />
          </div>
          {create.isError && (
            <p className="text-xs text-rose-600">{(create.error as Error).message}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={create.isPending} data-testid="button-save-employee">
            {create.isPending ? "جارِ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function HRPage() {
  const { data: summary } = useApiQuery<Summary>("/hr/summary");
  const { data: employees, isLoading: empLoading } = useApiQuery<Employee[]>("/hr/employees");
  const { data: departments } = useApiQuery<Department[]>("/hr/departments");
  const { data: attendance, isLoading: attLoading } = useApiQuery<AttendanceRow[]>("/hr/attendance");
  const { data: payroll, isLoading: payLoading } = useApiQuery<PayrollRow[]>("/hr/payroll");

  const deptMap = new Map(departments?.map((d) => [d.id, d.name]) ?? []);

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">الموارد البشرية</h1>
          <p className="text-muted-foreground">إدارة الموظفين، الحضور والانصراف، والرواتب</p>
        </div>
        <NewEmployeeDialog />
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={UsersIcon}
          label="إجمالي الموظفين"
          value={String(summary?.totalEmployees ?? 0)}
          hint={`${summary?.activeEmployees ?? 0} نشط`}
        />
        <StatCard
          icon={Building2}
          label="الإدارات"
          value={String(summary?.totalDepartments ?? 0)}
          iconClass="bg-blue-100 text-blue-700"
        />
        <StatCard
          icon={Wallet}
          label="إجمالي الرواتب الشهرية"
          value={SAR(summary?.monthlyPayrollTotal ?? 0)}
          iconClass="bg-emerald-100 text-emerald-700"
        />
        <StatCard
          icon={CalendarCheck2}
          label="معدل الحضور"
          value="92%"
          hint="آخر 7 أيام"
          iconClass="bg-purple-100 text-purple-700"
        />
      </div>

      <Tabs defaultValue="employees">
        <TabsList>
          <TabsTrigger value="employees" data-testid="tab-employees">الموظفون</TabsTrigger>
          <TabsTrigger value="attendance" data-testid="tab-attendance">الحضور والانصراف</TabsTrigger>
          <TabsTrigger value="payroll" data-testid="tab-payroll">الرواتب</TabsTrigger>
        </TabsList>

        <TabsContent value="employees" className="mt-4">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">قائمة الموظفين</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>الموظف</TableHead>
                    <TableHead>المسمى</TableHead>
                    <TableHead>الإدارة</TableHead>
                    <TableHead>البريد</TableHead>
                    <TableHead className="text-left">الراتب</TableHead>
                    <TableHead className="text-center">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {empLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-28" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      </TableRow>
                    ))
                  ) : (employees ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                        لا يوجد موظفون. أضف أول موظف لبدء الإدارة.
                      </TableCell>
                    </TableRow>
                  ) : (
                    employees!.map((e) => (
                      <TableRow key={e.id} data-testid={`row-employee-${e.id}`}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-3">
                            <div className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary">
                              <UserCircle className="size-5" />
                            </div>
                            {e.fullName}
                          </div>
                        </TableCell>
                        <TableCell>{e.jobTitle}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {e.departmentId ? deptMap.get(e.departmentId) ?? "—" : "—"}
                        </TableCell>
                        <TableCell dir="ltr" className="text-right text-muted-foreground">{e.email ?? "—"}</TableCell>
                        <TableCell className="text-left font-bold text-primary">{SAR(e.baseSalary)}</TableCell>
                        <TableCell className="text-center">
                          <Badge className={statusBadge[e.status]?.cls ?? ""}>
                            {statusBadge[e.status]?.label ?? e.status}
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

        <TabsContent value="attendance" className="mt-4">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">سجلات الحضور (آخر 200 سجل)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>الموظف</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>دخول</TableHead>
                    <TableHead>خروج</TableHead>
                    <TableHead className="text-center">ساعات</TableHead>
                    <TableHead className="text-center">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-12" /></TableCell>
                        <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                      </TableRow>
                    ))
                  ) : (
                    (attendance ?? []).slice(0, 50).map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.employeeName ?? "—"}</TableCell>
                        <TableCell dir="ltr" className="text-right text-muted-foreground">{a.workDate}</TableCell>
                        <TableCell dir="ltr" className="text-right text-muted-foreground">
                          {a.checkIn ? new Date(a.checkIn).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }) : "—"}
                        </TableCell>
                        <TableCell dir="ltr" className="text-right text-muted-foreground">
                          {a.checkOut ? new Date(a.checkOut).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }) : "—"}
                        </TableCell>
                        <TableCell className="text-center font-bold">{a.hoursWorked.toFixed(1)}</TableCell>
                        <TableCell className="text-center">
                          <Badge className={statusBadge[a.status]?.cls ?? ""}>
                            {statusBadge[a.status]?.label ?? a.status}
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

        <TabsContent value="payroll" className="mt-4">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">قسائم الرواتب</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>الموظف</TableHead>
                    <TableHead>الفترة</TableHead>
                    <TableHead className="text-left">أساسي</TableHead>
                    <TableHead className="text-left">بدلات</TableHead>
                    <TableHead className="text-left">خصومات</TableHead>
                    <TableHead className="text-left">الصافي</TableHead>
                    <TableHead className="text-center">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={7}><Skeleton className="h-5 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : (
                    (payroll ?? []).map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.employeeName ?? "—"}</TableCell>
                        <TableCell dir="ltr" className="text-right text-muted-foreground">{p.period}</TableCell>
                        <TableCell className="text-left">{SAR(p.baseSalary)}</TableCell>
                        <TableCell className="text-left text-emerald-700">+{SAR(p.allowances)}</TableCell>
                        <TableCell className="text-left text-rose-700">-{SAR(p.deductions)}</TableCell>
                        <TableCell className="text-left font-bold text-primary">{SAR(p.netPay)}</TableCell>
                        <TableCell className="text-center">
                          <Badge className={statusBadge[p.status]?.cls ?? ""}>
                            {statusBadge[p.status]?.label ?? p.status}
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
