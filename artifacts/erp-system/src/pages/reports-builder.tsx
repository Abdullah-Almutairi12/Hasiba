import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { Trash2, Plus, Play, Save, Download } from "lucide-react";
import {
  reportsFetch,
  type DataSource,
  type ReportConfig,
  type ReportFilter,
  type ReportAggregate,
  type ReportRunResult,
} from "@/lib/reports-api";

const CHART_COLORS = ["#2563EB", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6"];

export default function ReportsBuilderPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: sources = [] } = useQuery({
    queryKey: ["data-sources"],
    queryFn: () => reportsFetch<DataSource[]>("/reports/data-sources"),
  });

  const [sourceKey, setSourceKey] = useState<string>("");
  const [columns, setColumns] = useState<string[]>([]);
  const [filters, setFilters] = useState<ReportFilter[]>([]);
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [aggregates, setAggregates] = useState<ReportAggregate[]>([]);
  const [chartType, setChartType] = useState<"table" | "bar" | "line" | "pie" | "kpi">("table");
  const [name, setName] = useState("");
  const [result, setResult] = useState<ReportRunResult | null>(null);

  const source = useMemo(() => sources.find((s) => s.key === sourceKey), [sources, sourceKey]);

  useEffect(() => {
    setColumns([]);
    setFilters([]);
    setGroupBy([]);
    setAggregates([]);
    setResult(null);
  }, [sourceKey]);

  const runMut = useMutation({
    mutationFn: () => {
      const config: ReportConfig = { columns, filters, groupBy, aggregates, limit: 1000 };
      return reportsFetch<ReportRunResult>("/reports/run", {
        method: "POST",
        body: JSON.stringify({ source: sourceKey, config }),
      });
    },
    onSuccess: (data) => setResult(data),
    onError: (err: Error) => toast({ title: "فشل تشغيل التقرير", description: err.message, variant: "destructive" }),
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const config: ReportConfig = { columns, filters, groupBy, aggregates, limit: 1000 };
      return reportsFetch("/reports/definitions", {
        method: "POST",
        body: JSON.stringify({ name, dataSource: sourceKey, config, chartType }),
      });
    },
    onSuccess: () => {
      toast({ title: "تم حفظ التقرير" });
      qc.invalidateQueries({ queryKey: ["report-definitions"] });
    },
    onError: (err: Error) => toast({ title: "فشل الحفظ", description: err.message, variant: "destructive" }),
  });

  function toggleColumn(key: string) {
    setColumns((prev) => (prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]));
  }
  function toggleGroup(key: string) {
    setGroupBy((prev) => (prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]));
  }

  return (
    <div className="space-y-4 p-3 sm:p-4 md:p-6" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">منشئ التقارير</h1>
          <p className="text-sm text-muted-foreground">اختر مصدر البيانات والأعمدة والفلاتر، ثم شاهد النتيجة فوراً</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>1) مصدر البيانات</CardTitle></CardHeader>
        <CardContent>
          <Select value={sourceKey} onValueChange={setSourceKey}>
            <SelectTrigger><SelectValue placeholder="اختر مصدر البيانات" /></SelectTrigger>
            <SelectContent>
              {sources.map((s) => (<SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {source && (
        <>
          <Card>
            <CardHeader><CardTitle>2) الأعمدة</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {source.columns.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 cursor-pointer text-sm">
                    <Checkbox checked={columns.includes(c.key)} onCheckedChange={() => toggleColumn(c.key)} />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>3) الفلاتر</span>
                <Button size="sm" variant="outline" onClick={() => setFilters([...filters, { column: source.columns[0].key, op: "eq", value: "" }])}>
                  <Plus className="h-3 w-3 ml-1" /> إضافة فلتر
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {filters.length === 0 && <p className="text-sm text-muted-foreground">لا توجد فلاتر</p>}
              {filters.map((f, i) => (
                <div key={i} className="flex flex-wrap gap-2 items-center">
                  <Select value={f.column} onValueChange={(v) => setFilters(filters.map((x, ix) => ix === i ? { ...x, column: v } : x))}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>{source.columns.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={f.op} onValueChange={(v) => setFilters(filters.map((x, ix) => ix === i ? { ...x, op: v as ReportFilter["op"] } : x))}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="eq">=</SelectItem>
                      <SelectItem value="neq">≠</SelectItem>
                      <SelectItem value="gt">&gt;</SelectItem>
                      <SelectItem value="gte">≥</SelectItem>
                      <SelectItem value="lt">&lt;</SelectItem>
                      <SelectItem value="lte">≤</SelectItem>
                      <SelectItem value="contains">يحتوي</SelectItem>
                      <SelectItem value="is_null">فارغ</SelectItem>
                      <SelectItem value="not_null">غير فارغ</SelectItem>
                    </SelectContent>
                  </Select>
                  {f.op !== "is_null" && f.op !== "not_null" && (
                    <Input className="w-44" value={String(f.value ?? "")} onChange={(e) => setFilters(filters.map((x, ix) => ix === i ? { ...x, value: e.target.value } : x))} />
                  )}
                  <Button size="icon" variant="ghost" onClick={() => setFilters(filters.filter((_, ix) => ix !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>4) التجميع والاحتسابات (اختياري)</span>
                <Button size="sm" variant="outline" onClick={() => {
                  const aggCol = source.columns.find((c) => c.aggregatable);
                  if (aggCol) setAggregates([...aggregates, { column: aggCol.key, fn: "sum" }]);
                }}><Plus className="h-3 w-3 ml-1" /> إضافة احتساب</Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">تجميع حسب</Label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {source.columns.map((c) => (
                    <Badge key={c.key} variant={groupBy.includes(c.key) ? "default" : "outline"} className="cursor-pointer" onClick={() => toggleGroup(c.key)}>
                      {c.label}
                    </Badge>
                  ))}
                </div>
              </div>
              {aggregates.map((a, i) => (
                <div key={i} className="flex flex-wrap gap-2 items-center">
                  <Select value={a.fn} onValueChange={(v) => setAggregates(aggregates.map((x, ix) => ix === i ? { ...x, fn: v as ReportAggregate["fn"] } : x))}>
                    <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sum">مجموع</SelectItem>
                      <SelectItem value="avg">متوسط</SelectItem>
                      <SelectItem value="count">عدد</SelectItem>
                      <SelectItem value="min">أدنى</SelectItem>
                      <SelectItem value="max">أعلى</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={a.column} onValueChange={(v) => setAggregates(aggregates.map((x, ix) => ix === i ? { ...x, column: v } : x))}>
                    <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                    <SelectContent>{source.columns.filter((c) => c.aggregatable).map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" onClick={() => setAggregates(aggregates.filter((_, ix) => ix !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>5) العرض والحفظ</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-3 items-end">
                <div className="flex-1 min-w-48">
                  <Label className="text-xs">اسم التقرير (للحفظ)</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثل: مبيعات شهرية حسب الفرع" />
                </div>
                <div>
                  <Label className="text-xs">نوع العرض</Label>
                  <Select value={chartType} onValueChange={(v) => setChartType(v as typeof chartType)}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="table">جدول</SelectItem>
                      <SelectItem value="bar">أعمدة</SelectItem>
                      <SelectItem value="line">خطي</SelectItem>
                      <SelectItem value="pie">دائري</SelectItem>
                      <SelectItem value="kpi">مؤشر KPI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={() => runMut.mutate()} disabled={runMut.isPending || (columns.length === 0 && aggregates.length === 0)}>
                  <Play className="h-4 w-4 ml-1" /> تشغيل
                </Button>
                <Button variant="outline" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !name || (columns.length === 0 && aggregates.length === 0)}>
                  <Save className="h-4 w-4 ml-1" /> حفظ
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {result && <ResultView result={result} chartType={chartType} />}
    </div>
  );
}

function ResultView({ result, chartType }: { result: ReportRunResult; chartType: string }) {
  const labelCol = result.columns[0]?.key ?? "";
  const valueCol = result.columns.find((c) => c.type === "number")?.key ?? result.columns[1]?.key ?? "";

  return (
    <Card>
      <CardHeader><CardTitle>النتيجة ({result.rowCount} صف)</CardTitle></CardHeader>
      <CardContent>
        <Tabs defaultValue={chartType === "table" ? "table" : "chart"}>
          <TabsList>
            <TabsTrigger value="chart">رسم بياني</TabsTrigger>
            <TabsTrigger value="table">جدول</TabsTrigger>
          </TabsList>
          <TabsContent value="chart" className="mt-4">
            {chartType === "kpi" && (
              <div className="text-center py-8">
                <div className="text-5xl font-bold">{Number(result.rows[0]?.[valueCol] ?? 0).toLocaleString("ar-SA")}</div>
                <div className="text-sm text-muted-foreground mt-2">{result.columns.find((c) => c.key === valueCol)?.label}</div>
              </div>
            )}
            {chartType === "bar" && (
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={result.rows.slice(0, 50)}>
                  <XAxis dataKey={labelCol} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey={valueCol} fill="#2563EB" />
                </BarChart>
              </ResponsiveContainer>
            )}
            {chartType === "line" && (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={result.rows.slice(0, 100)}>
                  <XAxis dataKey={labelCol} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey={valueCol} stroke="#2563EB" />
                </LineChart>
              </ResponsiveContainer>
            )}
            {chartType === "pie" && (
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie data={result.rows.slice(0, 8)} dataKey={valueCol} nameKey={labelCol} outerRadius={120} label>
                    {result.rows.slice(0, 8).map((_, i) => (<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
            {(chartType === "table" || !chartType) && <p className="text-sm text-muted-foreground">انتقل إلى تبويب الجدول لعرض البيانات</p>}
          </TabsContent>
          <TabsContent value="table" className="mt-4">
            <div className="overflow-auto max-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>{result.columns.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}</TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((r, i) => (
                    <TableRow key={i}>
                      {result.columns.map((c) => (
                        <TableCell key={c.key}>
                          {c.type === "number" && r[c.key] != null
                            ? Number(r[c.key]).toLocaleString("ar-SA")
                            : String(r[c.key] ?? "")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
