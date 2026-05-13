import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Trash2, Download, Mail, Bell, Plus, FilePlus2 } from "lucide-react";
import {
  reportsFetch,
  reportExportUrl,
  type ReportDefinition,
  type Subscription,
  type KpiAlert,
} from "@/lib/reports-api";

export default function ReportsSavedPage() {
  return (
    <div className="space-y-4 p-3 sm:p-4 md:p-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">التقارير المحفوظة</h1>
          <p className="text-sm text-muted-foreground">إدارة التقارير، الاشتراكات البريدية، وتنبيهات مؤشرات الأداء</p>
        </div>
        <Link href="/reports/builder">
          <Button><FilePlus2 className="h-4 w-4 ml-1" /> منشئ تقرير جديد</Button>
        </Link>
      </div>

      <Tabs defaultValue="reports">
        <TabsList>
          <TabsTrigger value="reports">التقارير</TabsTrigger>
          <TabsTrigger value="subscriptions">الاشتراكات البريدية</TabsTrigger>
          <TabsTrigger value="alerts">تنبيهات KPI</TabsTrigger>
        </TabsList>
        <TabsContent value="reports" className="mt-4"><ReportsTab /></TabsContent>
        <TabsContent value="subscriptions" className="mt-4"><SubscriptionsTab /></TabsContent>
        <TabsContent value="alerts" className="mt-4"><AlertsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function ReportsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: reports = [] } = useQuery({
    queryKey: ["report-definitions"],
    queryFn: () => reportsFetch<ReportDefinition[]>("/reports/definitions"),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => reportsFetch(`/reports/definitions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-definitions"] });
      toast({ title: "تم الحذف" });
    },
    onError: (err: Error) => toast({ title: "فشل الحذف", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader><CardTitle>التقارير ({reports.length})</CardTitle></CardHeader>
      <CardContent>
        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد تقارير محفوظة بعد. ابدأ من منشئ التقارير.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>المصدر</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>آخر تحديث</TableHead>
                <TableHead>إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell><Badge variant="outline">{r.dataSource}</Badge></TableCell>
                  <TableCell>{r.chartType}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(r.updatedAt).toLocaleDateString("ar-SA")}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      <a href={reportExportUrl(r.id, "xlsx")}><Button size="sm" variant="outline"><Download className="h-3 w-3 ml-1" /> Excel</Button></a>
                      <a href={reportExportUrl(r.id, "csv")}><Button size="sm" variant="outline">CSV</Button></a>
                      <a href={reportExportUrl(r.id, "pdf")}><Button size="sm" variant="outline">PDF</Button></a>
                      <SubscribeDialog report={r} />
                      <AlertDialog report={r} />
                      <Button size="icon" variant="ghost" onClick={() => delMut.mutate(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function SubscribeDialog({ report }: { report: ReportDefinition }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [cadence, setCadence] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [format, setFormat] = useState<"xlsx" | "csv" | "pdf">("xlsx");

  const mut = useMutation({
    mutationFn: () => reportsFetch("/reports/subscriptions", {
      method: "POST",
      body: JSON.stringify({ reportId: report.id, recipients: [email], cadence, format }),
    }),
    onSuccess: () => {
      toast({ title: "تم إنشاء الاشتراك" });
      qc.invalidateQueries({ queryKey: ["subscriptions"] });
      setOpen(false);
      setEmail("");
    },
    onError: (err: Error) => toast({ title: "فشل", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Mail className="h-3 w-3 ml-1" /> اشتراك</Button></DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>اشتراك بريدي: {report.name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>البريد الإلكتروني</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label>التكرار</Label>
            <Select value={cadence} onValueChange={(v) => setCadence(v as typeof cadence)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">يومي</SelectItem>
                <SelectItem value="weekly">أسبوعي</SelectItem>
                <SelectItem value="monthly">شهري</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>الصيغة</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as typeof format)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="xlsx">Excel</SelectItem>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => mut.mutate()} disabled={!email || mut.isPending}>إنشاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AlertDialog({ report }: { report: ReportDefinition }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`تنبيه ${report.name}`);
  const [metricColumn, setMetricColumn] = useState("");
  const [operator, setOperator] = useState<"above" | "below" | "changed_by">("above");
  const [threshold, setThreshold] = useState(0);

  const mut = useMutation({
    mutationFn: () => reportsFetch("/reports/kpi-alerts", {
      method: "POST",
      body: JSON.stringify({ name, reportId: report.id, metricColumn, operator, threshold }),
    }),
    onSuccess: () => {
      toast({ title: "تم إنشاء التنبيه" });
      qc.invalidateQueries({ queryKey: ["kpi-alerts"] });
      setOpen(false);
    },
    onError: (err: Error) => toast({ title: "فشل", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Bell className="h-3 w-3 ml-1" /> تنبيه</Button></DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>إنشاء تنبيه KPI</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>الاسم</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>اسم العمود الرقمي</Label>
            <Input value={metricColumn} onChange={(e) => setMetricColumn(e.target.value)} placeholder="مثل: total أو sum_total" />
            <p className="text-xs text-muted-foreground mt-1">يجب أن يكون عمود رقمي في نتيجة التقرير</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>الشرط</Label>
              <Select value={operator} onValueChange={(v) => setOperator(v as typeof operator)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="above">أعلى من</SelectItem>
                  <SelectItem value="below">أقل من</SelectItem>
                  <SelectItem value="changed_by">تغير بمقدار</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>الحد</Label><Input type="number" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => mut.mutate()} disabled={!metricColumn || mut.isPending}>إنشاء</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SubscriptionsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: subs = [] } = useQuery({
    queryKey: ["subscriptions"],
    queryFn: () => reportsFetch<Subscription[]>("/reports/subscriptions"),
  });
  const delMut = useMutation({
    mutationFn: (id: number) => reportsFetch(`/reports/subscriptions/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["subscriptions"] }); toast({ title: "تم الحذف" }); },
  });

  return (
    <Card>
      <CardHeader><CardTitle>الاشتراكات ({subs.length})</CardTitle></CardHeader>
      <CardContent>
        {subs.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد اشتراكات. أنشئ اشتراكاً من قائمة التقارير.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>التقرير</TableHead>
                <TableHead>المستلمون</TableHead>
                <TableHead>التكرار</TableHead>
                <TableHead>الصيغة</TableHead>
                <TableHead>التشغيل التالي</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subs.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>#{s.reportId}</TableCell>
                  <TableCell className="text-xs">{s.recipients.join(", ")}</TableCell>
                  <TableCell>{s.cadence}</TableCell>
                  <TableCell>{s.format}</TableCell>
                  <TableCell className="text-xs">{s.nextRunAt ? new Date(s.nextRunAt).toLocaleString("ar-SA") : "-"}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => delMut.mutate(s.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AlertsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: alerts = [] } = useQuery({
    queryKey: ["kpi-alerts"],
    queryFn: () => reportsFetch<KpiAlert[]>("/reports/kpi-alerts"),
  });
  const delMut = useMutation({
    mutationFn: (id: number) => reportsFetch(`/reports/kpi-alerts/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kpi-alerts"] }); toast({ title: "تم الحذف" }); },
  });

  return (
    <Card>
      <CardHeader><CardTitle>تنبيهات KPI ({alerts.length})</CardTitle></CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد تنبيهات. أنشئ تنبيهاً من قائمة التقارير.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>التقرير</TableHead>
                <TableHead>المؤشر</TableHead>
                <TableHead>الشرط</TableHead>
                <TableHead>الحد</TableHead>
                <TableHead>آخر قيمة</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {alerts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>#{a.reportId}</TableCell>
                  <TableCell>{a.metricColumn}</TableCell>
                  <TableCell>{a.operator}</TableCell>
                  <TableCell>{a.threshold.toLocaleString("ar-SA")}</TableCell>
                  <TableCell>{a.lastValue == null ? "-" : a.lastValue.toLocaleString("ar-SA")}</TableCell>
                  <TableCell>
                    <Button size="icon" variant="ghost" onClick={() => delMut.mutate(a.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
