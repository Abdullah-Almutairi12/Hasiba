import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, ExternalLink, LayoutDashboard } from "lucide-react";
import { reportsFetch, type Dashboard, type DashboardWidget, type ReportDefinition } from "@/lib/reports-api";

export default function MyDashboardPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: dashboards = [] } = useQuery({
    queryKey: ["dashboards"],
    queryFn: () => reportsFetch<Dashboard[]>("/dashboards"),
  });
  const [activeId, setActiveId] = useState<number | null>(null);
  const dashboardId = activeId ?? dashboards[0]?.id ?? null;

  const { data: widgets = [] } = useQuery({
    queryKey: ["widgets", dashboardId],
    queryFn: () => reportsFetch<DashboardWidget[]>(`/dashboards/${dashboardId}/widgets`),
    enabled: dashboardId != null,
  });

  const createDashMut = useMutation({
    mutationFn: (name: string) => reportsFetch("/dashboards", { method: "POST", body: JSON.stringify({ name }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dashboards"] }),
  });

  const delWidgetMut = useMutation({
    mutationFn: (wid: number) => reportsFetch(`/dashboards/${dashboardId}/widgets/${wid}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["widgets", dashboardId] }); toast({ title: "تم الحذف" }); },
  });

  return (
    <div className="space-y-4 p-3 sm:p-4 md:p-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><LayoutDashboard className="h-6 w-6" /> لوحة تحكمي</h1>
          <p className="text-sm text-muted-foreground">لوحة شخصية قابلة للتخصيص بمؤشرات ورسوم وروابط</p>
        </div>
        <div className="flex gap-2">
          <Select value={dashboardId?.toString() ?? ""} onValueChange={(v) => setActiveId(Number(v))}>
            <SelectTrigger className="w-48"><SelectValue placeholder="اختر لوحة" /></SelectTrigger>
            <SelectContent>
              {dashboards.map((d) => <SelectItem key={d.id} value={d.id.toString()}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => {
            const name = window.prompt("اسم اللوحة الجديدة؟");
            if (name) createDashMut.mutate(name);
          }}><Plus className="h-4 w-4 ml-1" /> لوحة جديدة</Button>
          {dashboardId && <AddWidgetDialog dashboardId={dashboardId} />}
        </div>
      </div>

      {widgets.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            لا توجد عناصر في هذه اللوحة. أضف ودجت لتبدأ.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-12 gap-3">
          {widgets.map((w) => (
            <div key={w.id} className={`col-span-12 md:col-span-${Math.min(Math.max(w.width, 1), 12)}`} style={{ gridColumn: `span ${Math.min(Math.max(w.width, 1), 12)} / span ${Math.min(Math.max(w.width, 1), 12)}` }}>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base">{w.title}</CardTitle>
                  <Button size="icon" variant="ghost" onClick={() => delWidgetMut.mutate(w.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </CardHeader>
                <CardContent><WidgetView widget={w} /></CardContent>
              </Card>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WidgetView({ widget }: { widget: DashboardWidget }) {
  if (widget.type === "text") {
    return <p className="text-sm whitespace-pre-wrap">{String((widget.config?.markdown as string) ?? "")}</p>;
  }
  if (widget.type === "iframe") {
    const url = String(widget.config?.url ?? "");
    return (
      <div className="space-y-2">
        <iframe src={url} className="w-full h-64 rounded border" sandbox="allow-scripts allow-same-origin" />
        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1"><ExternalLink className="h-3 w-3" /> فتح في تبويب جديد</a>
      </div>
    );
  }
  // For kpi / chart / list widgets that point at a saved report, fetch live data.
  return <WidgetReportData widget={widget} />;
}

function WidgetReportData({ widget }: { widget: DashboardWidget }) {
  const reportId = Number(widget.config?.reportId ?? 0);
  const { data, isLoading, error } = useQuery({
    queryKey: ["widget-data", widget.id],
    queryFn: () => reportsFetch<{ rows: Record<string, unknown>[]; columns: { key: string; label: string; type: string }[] }>(`/dashboards/widgets/${widget.id}/data`, { method: "POST", body: "{}" }),
    enabled: reportId > 0,
  });
  if (!reportId) return <p className="text-xs text-muted-foreground">لم يتم ربط هذا الودجت بتقرير محفوظ</p>;
  if (isLoading) return <p className="text-xs text-muted-foreground">جارٍ التحميل...</p>;
  if (error) return <p className="text-xs text-destructive">{(error as Error).message}</p>;
  if (!data) return null;

  if (widget.type === "kpi") {
    const valueCol = data.columns.find((c) => c.type === "number")?.key ?? data.columns[0]?.key ?? "";
    let total = 0;
    for (const row of data.rows) total += Number(row[valueCol] ?? 0);
    return (
      <div className="text-center py-3">
        <div className="text-3xl font-bold">{total.toLocaleString("ar-SA")}</div>
        <div className="text-xs text-muted-foreground mt-1">{data.columns.find((c) => c.key === valueCol)?.label}</div>
      </div>
    );
  }

  // list / chart fallback to small table
  return (
    <div className="overflow-auto max-h-56 text-xs">
      <table className="w-full">
        <thead><tr>{data.columns.map((c) => <th key={c.key} className="text-right pb-1 font-medium">{c.label}</th>)}</tr></thead>
        <tbody>
          {data.rows.slice(0, 10).map((r, i) => (
            <tr key={i} className="border-t">{data.columns.map((c) => <td key={c.key} className="py-1">{c.type === "number" && r[c.key] != null ? Number(r[c.key]).toLocaleString("ar-SA") : String(r[c.key] ?? "")}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddWidgetDialog({ dashboardId }: { dashboardId: number }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<DashboardWidget["type"]>("kpi");
  const [title, setTitle] = useState("");
  const [reportId, setReportId] = useState<string>("");
  const [iframeUrl, setIframeUrl] = useState("");
  const [textBody, setTextBody] = useState("");
  const [width, setWidth] = useState(4);

  const { data: reports = [] } = useQuery({
    queryKey: ["report-definitions"],
    queryFn: () => reportsFetch<ReportDefinition[]>("/reports/definitions"),
  });

  const mut = useMutation({
    mutationFn: () => {
      const config: Record<string, unknown> = {};
      if (type === "kpi" || type === "chart" || type === "list") config.reportId = Number(reportId);
      if (type === "iframe") config.url = iframeUrl;
      if (type === "text") config.markdown = textBody;
      return reportsFetch(`/dashboards/${dashboardId}/widgets`, {
        method: "POST",
        body: JSON.stringify({ type, title, config, width, position: 0 }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["widgets", dashboardId] });
      toast({ title: "تمت الإضافة" });
      setOpen(false);
      setTitle("");
      setReportId("");
      setIframeUrl("");
      setTextBody("");
    },
    onError: (err: Error) => toast({ title: "فشل", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="h-4 w-4 ml-1" /> ودجت</Button></DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>إضافة ودجت</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>العنوان</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><Label>النوع</Label>
            <Select value={type} onValueChange={(v) => setType(v as DashboardWidget["type"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="kpi">مؤشر KPI</SelectItem>
                <SelectItem value="chart">رسم بياني</SelectItem>
                <SelectItem value="list">قائمة</SelectItem>
                <SelectItem value="iframe">إطار خارجي</SelectItem>
                <SelectItem value="text">نص</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>العرض (1-12)</Label><Input type="number" min={1} max={12} value={width} onChange={(e) => setWidth(Number(e.target.value))} /></div>
          {(type === "kpi" || type === "chart" || type === "list") && (
            <div>
              <Label>التقرير المرتبط</Label>
              <Select value={reportId} onValueChange={setReportId}>
                <SelectTrigger><SelectValue placeholder="اختر تقرير" /></SelectTrigger>
                <SelectContent>{reports.map((r) => <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {type === "iframe" && (
            <div><Label>رابط HTTPS</Label><Input value={iframeUrl} onChange={(e) => setIframeUrl(e.target.value)} placeholder="https://..." /></div>
          )}
          {type === "text" && (
            <div><Label>المحتوى</Label><textarea className="w-full border rounded p-2 text-sm min-h-24" value={textBody} onChange={(e) => setTextBody(e.target.value)} /></div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => mut.mutate()} disabled={!title || mut.isPending}>إضافة</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
