import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import {
  Factory,
  Plus,
  Play,
  CheckCircle2,
  XCircle,
  Wrench,
  ClipboardCheck,
  Trash2,
  Calendar,
  Activity,
} from "lucide-react";

interface Product { id: number; nameAr: string; sku: string }
interface Warehouse { id: number; nameAr: string }
interface BomLine { id: number; componentId: number; componentName: string; sku: string; quantityPer: number; unit: string; scrapPct: number; costPrice: number }
interface Bom { id: number; reference: string; productId: number; productName: string; sku: string; quantity: number; isPhantom: boolean; isActive: boolean; routingId: number | null; notes: string | null; createdAt: string; lines?: BomLine[] }
interface WorkCenter { id: number; code: string; name: string; nameAr: string; capacityPerDay: number; hourlyCost: number; isActive: boolean; notes: string | null }
interface RoutingOp { id: number; sequence: number; name: string; nameAr: string; workCenterId: number; workCenterName: string; durationMinutes: number; instructions: string | null }
interface Routing { id: number; reference: string; name: string; nameAr: string; isActive: boolean; operations: RoutingOp[] }
interface WorkOrder { id: number; reference: string; bomId: number; productId: number; productName: string; sku: string; quantity: number; quantityProduced: number; warehouseId: number; warehouseName: string; state: string; plannedStart: string | null; plannedEnd: string | null; standardCost: number; notes: string | null; createdAt: string }
interface ScrapRow { id: number; reference: string; productId: number; productName: string; sku: string; quantity: number; warehouseName: string; reason: string; notes: string | null; createdAt: string; reworkedAt?: string | null }
interface UtilizationRow { workCenterId: number; code: string; nameAr: string; bookedMinutes: number; capacityMinutes: number; utilization: number }
interface Summary { throughput: number; ordersCompleted: number; onTimePct: number; scrapEvents: number; scrapQuantity: number; scrapRate: number; activeWorkCenters: number; utilization?: UtilizationRow[] }

const STATE_BADGES: Record<string, { label: string; cls: string }> = {
  draft: { label: "مسودة", cls: "bg-slate-200 text-slate-700" },
  confirmed: { label: "مؤكد", cls: "bg-blue-100 text-blue-700" },
  in_progress: { label: "قيد التنفيذ", cls: "bg-amber-100 text-amber-700" },
  done: { label: "تم الإنجاز", cls: "bg-emerald-100 text-emerald-700" },
  cancelled: { label: "ملغى", cls: "bg-rose-100 text-rose-700" },
};

export default function ManufacturingPage() {
  const { has } = usePermissions();
  const canWrite = has("production");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: boms = [] } = useQuery<Bom[]>({ queryKey: ["/manufacturing/boms"], queryFn: () => apiGet("/manufacturing/boms") });
  const { data: workCenters = [] } = useQuery<WorkCenter[]>({ queryKey: ["/manufacturing/work-centers"], queryFn: () => apiGet("/manufacturing/work-centers") });
  const { data: routings = [] } = useQuery<Routing[]>({ queryKey: ["/manufacturing/routings"], queryFn: () => apiGet("/manufacturing/routings") });
  const { data: workOrders = [] } = useQuery<WorkOrder[]>({ queryKey: ["/manufacturing/work-orders"], queryFn: () => apiGet("/manufacturing/work-orders") });
  const { data: scrap = [] } = useQuery<ScrapRow[]>({ queryKey: ["/manufacturing/scrap"], queryFn: () => apiGet("/manufacturing/scrap") });
  const { data: summary } = useQuery<Summary>({ queryKey: ["/manufacturing/reports/summary"], queryFn: () => apiGet("/manufacturing/reports/summary") });
  const { data: products = [] } = useQuery<Product[]>({ queryKey: ["/products"], queryFn: () => apiGet("/products") });
  const { data: warehouses = [] } = useQuery<Warehouse[]>({ queryKey: ["/warehouses"], queryFn: () => apiGet("/warehouses") });

  const invalidateAll = () => {
    ["/manufacturing/boms", "/manufacturing/work-orders", "/manufacturing/work-centers",
     "/manufacturing/routings", "/manufacturing/scrap", "/manufacturing/reports/summary"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  return (
    <div className="container mx-auto p-6 space-y-6" dir="rtl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Factory className="size-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">التصنيع (MRP)</h1>
            <p className="text-sm text-muted-foreground">إدارة قوائم المواد ومحطات العمل وأوامر الإنتاج والجودة</p>
          </div>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <KpiCard icon={<Activity className="size-4" />} label="إنتاج كلي" value={summary.throughput.toFixed(0)} />
          <KpiCard icon={<CheckCircle2 className="size-4" />} label="أوامر مكتملة" value={String(summary.ordersCompleted)} />
          <KpiCard icon={<Calendar className="size-4" />} label="نسبة الالتزام بالمواعيد" value={`${(summary.onTimePct * 100).toFixed(1)}%`} />
          <KpiCard icon={<Trash2 className="size-4" />} label="نسبة الإتلاف" value={`${(summary.scrapRate * 100).toFixed(2)}%`} />
          <KpiCard icon={<Wrench className="size-4" />} label="محطات عمل نشطة" value={String(summary.activeWorkCenters)} />
        </div>
      )}

      {summary?.utilization && summary.utilization.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">استغلال محطات العمل (آخر 30 يوماً)</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>المحطة</TableHead><TableHead>الدقائق المحجوزة</TableHead><TableHead>الطاقة (دقيقة)</TableHead><TableHead>الاستغلال</TableHead></TableRow></TableHeader>
              <TableBody>
                {summary.utilization.map((u) => (
                  <TableRow key={u.workCenterId}>
                    <TableCell>{u.code} — {u.nameAr}</TableCell>
                    <TableCell>{u.bookedMinutes.toFixed(0)}</TableCell>
                    <TableCell>{u.capacityMinutes.toFixed(0)}</TableCell>
                    <TableCell>
                      <Badge variant={u.utilization > 0.85 ? "destructive" : u.utilization > 0.6 ? "default" : "secondary"}>
                        {(u.utilization * 100).toFixed(1)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="work-orders" dir="rtl" className="w-full">
        <TabsList className="flex-wrap">
          <TabsTrigger value="work-orders">أوامر الإنتاج</TabsTrigger>
          <TabsTrigger value="boms">قوائم المواد</TabsTrigger>
          <TabsTrigger value="work-centers">محطات العمل</TabsTrigger>
          <TabsTrigger value="routings">المسارات</TabsTrigger>
          <TabsTrigger value="schedule">الجدولة</TabsTrigger>
          <TabsTrigger value="quality">الجودة</TabsTrigger>
          <TabsTrigger value="scrap">الإتلاف</TabsTrigger>
        </TabsList>

        <TabsContent value="work-orders" className="mt-4">
          <WorkOrdersTab boms={boms} warehouses={warehouses} workOrders={workOrders} canWrite={canWrite} onChange={invalidateAll} toast={toast} />
        </TabsContent>
        <TabsContent value="boms" className="mt-4">
          <BomsTab boms={boms} products={products} routings={routings} canWrite={canWrite} onChange={invalidateAll} toast={toast} />
        </TabsContent>
        <TabsContent value="work-centers" className="mt-4">
          <WorkCentersTab rows={workCenters} canWrite={canWrite} onChange={invalidateAll} toast={toast} />
        </TabsContent>
        <TabsContent value="routings" className="mt-4">
          <RoutingsTab routings={routings} workCenters={workCenters} canWrite={canWrite} onChange={invalidateAll} toast={toast} />
        </TabsContent>
        <TabsContent value="schedule" className="mt-4">
          <ScheduleTab />
        </TabsContent>
        <TabsContent value="quality" className="mt-4">
          <QualityTab workOrders={workOrders} canWrite={canWrite} onChange={invalidateAll} toast={toast} />
        </TabsContent>
        <TabsContent value="scrap" className="mt-4">
          <ScrapTab rows={scrap} products={products} workOrders={workOrders} warehouses={warehouses} canWrite={canWrite} onChange={invalidateAll} toast={toast} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
        <div className="mt-1 text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

// ---- Work Orders Tab ----
function WorkOrdersTab({ boms, warehouses, workOrders, canWrite, onChange, toast }: any) {
  const [open, setOpen] = useState(false);
  const [bomId, setBomId] = useState("");
  const [qty, setQty] = useState("1");
  const [warehouseId, setWarehouseId] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const create = useMutation({
    mutationFn: () => apiPost("/manufacturing/work-orders", { bomId: Number(bomId), quantity: Number(qty), warehouseId: warehouseId ? Number(warehouseId) : undefined, plannedEnd: plannedEnd || undefined, notes }),
    onSuccess: () => { toast({ title: "تم إنشاء أمر الإنتاج" }); setOpen(false); setBomId(""); setQty("1"); setNotes(""); setPlannedEnd(""); onChange(); },
    onError: (e: Error) => toast({ title: "فشل الإنشاء", description: e.message, variant: "destructive" }),
  });
  const action = useMutation({
    mutationFn: ({ id, action, body }: { id: number; action: string; body?: unknown }) => apiPost(`/manufacturing/work-orders/${id}/${action}`, body ?? {}),
    onSuccess: (_d, vars) => { toast({ title: `تم: ${vars.action}` }); onChange(); },
    onError: (e: Error) => toast({ title: "فشلت العملية", description: e.message, variant: "destructive" }),
  });

  const detail = useQuery<any>({
    queryKey: [`/manufacturing/work-orders/${selectedId}`],
    queryFn: () => apiGet(`/manufacturing/work-orders/${selectedId}`),
    enabled: !!selectedId,
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>أوامر الإنتاج</CardTitle>
        {canWrite && (
          <Button onClick={() => setOpen(true)} size="sm" data-testid="button-new-wo"><Plus className="size-4 ml-1" />أمر إنتاج جديد</Button>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المرجع</TableHead>
              <TableHead>المنتج</TableHead>
              <TableHead>الكمية</TableHead>
              <TableHead>منتج فعلياً</TableHead>
              <TableHead>المستودع</TableHead>
              <TableHead>التكلفة المعيارية</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workOrders.map((wo: WorkOrder) => {
              const badge = STATE_BADGES[wo.state] ?? { label: wo.state, cls: "" };
              return (
                <TableRow key={wo.id}>
                  <TableCell><button className="text-primary hover:underline" onClick={() => setSelectedId(wo.id)}>{wo.reference}</button></TableCell>
                  <TableCell>{wo.productName} <span className="text-xs text-muted-foreground">({wo.sku})</span></TableCell>
                  <TableCell>{wo.quantity}</TableCell>
                  <TableCell>{wo.quantityProduced}</TableCell>
                  <TableCell>{wo.warehouseName}</TableCell>
                  <TableCell>{wo.standardCost.toFixed(2)}</TableCell>
                  <TableCell><Badge className={badge.cls}>{badge.label}</Badge></TableCell>
                  <TableCell>
                    {canWrite && (
                      <div className="flex gap-1">
                        {wo.state === "draft" && <Button size="sm" variant="outline" onClick={() => action.mutate({ id: wo.id, action: "confirm" })}>تأكيد</Button>}
                        {wo.state === "confirmed" && <Button size="sm" variant="outline" onClick={() => action.mutate({ id: wo.id, action: "start" })} title="بدء"><Play className="size-3" /></Button>}
                        {wo.state === "in_progress" && <Button size="sm" variant="outline" onClick={() => action.mutate({ id: wo.id, action: "consume" })} title="استهلاك المكونات">استهلاك</Button>}
                        {wo.state === "in_progress" && <Button size="sm" variant="outline" onClick={() => { const q = prompt("الكمية المنتجة:", String(Number(wo.quantity) - Number(wo.quantityProduced))); if (q) action.mutate({ id: wo.id, action: "produce", body: { quantity: Number(q) } }); }} title="إنتاج تام">إنتاج</Button>}
                        {wo.state === "in_progress" && <Button size="sm" onClick={() => action.mutate({ id: wo.id, action: "complete" })} title="إنهاء"><CheckCircle2 className="size-3" /></Button>}
                        {wo.state !== "done" && wo.state !== "cancelled" && <Button size="sm" variant="ghost" onClick={() => action.mutate({ id: wo.id, action: "cancel" })}><XCircle className="size-3" /></Button>}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {workOrders.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">لا توجد أوامر إنتاج بعد</TableCell></TableRow>}
          </TableBody>
        </Table>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md" dir="rtl">
            <DialogHeader><DialogTitle>أمر إنتاج جديد</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>قائمة المواد</Label>
                <Select value={bomId} onValueChange={setBomId}>
                  <SelectTrigger><SelectValue placeholder="اختر BoM" /></SelectTrigger>
                  <SelectContent>{boms.filter((b: Bom) => b.isActive && !b.isPhantom).map((b: Bom) => (
                    <SelectItem key={b.id} value={String(b.id)}>{b.reference} — {b.productName}</SelectItem>
                  ))}</SelectContent>
                </Select>
              </div>
              <div><Label>الكمية</Label><Input type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
              <div>
                <Label>المستودع</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger><SelectValue placeholder="افتراضي" /></SelectTrigger>
                  <SelectContent>{warehouses.map((w: Warehouse) => (<SelectItem key={w.id} value={String(w.id)}>{w.nameAr}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div><Label>التاريخ المخطط للإنجاز</Label><Input type="date" value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} /></div>
              <div><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button onClick={() => create.mutate()} disabled={!bomId || !qty || create.isPending}>إنشاء</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!selectedId} onOpenChange={(v) => !v && setSelectedId(null)}>
          <DialogContent className="max-w-3xl" dir="rtl">
            <DialogHeader><DialogTitle>تفاصيل أمر الإنتاج</DialogTitle></DialogHeader>
            {detail.data && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">المرجع:</span> {detail.data.reference}</div>
                  <div><span className="text-muted-foreground">الحالة:</span> <Badge className={STATE_BADGES[detail.data.state]?.cls}>{STATE_BADGES[detail.data.state]?.label}</Badge></div>
                  <div><span className="text-muted-foreground">الكمية المخططة:</span> {detail.data.quantity}</div>
                  <div><span className="text-muted-foreground">الكمية المنتجة:</span> {detail.data.quantityProduced}</div>
                  <div><span className="text-muted-foreground">التكلفة المعيارية:</span> {Number(detail.data.standardCost).toFixed(2)}</div>
                </div>
                <div>
                  <h4 className="font-semibold mb-1">حجوزات المكونات</h4>
                  <Table>
                    <TableHeader><TableRow><TableHead>المكون</TableHead><TableHead>المحجوز</TableHead><TableHead>المستهلك</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {detail.data.reservations?.map((r: any) => (
                        <TableRow key={r.id}><TableCell>{r.componentName}</TableCell><TableCell>{r.quantity}</TableCell><TableCell>{r.consumedQty}</TableCell></TableRow>
                      ))}
                      {(!detail.data.reservations || detail.data.reservations.length === 0) && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">لا توجد حجوزات</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
                {detail.data.qualityChecks?.length > 0 && (
                  <div>
                    <h4 className="font-semibold mb-1">فحوصات الجودة</h4>
                    <Table>
                      <TableHeader><TableRow><TableHead>الاسم</TableHead><TableHead>إلزامي</TableHead><TableHead>النتيجة</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {detail.data.qualityChecks.map((q: any) => (
                          <TableRow key={q.id}>
                            <TableCell>{q.nameAr}</TableCell>
                            <TableCell>{q.isMandatory ? "نعم" : "لا"}</TableCell>
                            <TableCell><Badge variant={q.result === "pass" ? "default" : q.result === "fail" ? "destructive" : "secondary"}>{q.result}</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ---- BoMs Tab ----
function BomsTab({ boms, products, routings, canWrite, onChange, toast }: any) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [isPhantom, setIsPhantom] = useState(false);
  const [routingId, setRoutingId] = useState("");
  const [lines, setLines] = useState<Array<{ componentId: string; quantityPer: string; unit: string; scrapPct: string }>>([
    { componentId: "", quantityPer: "1", unit: "piece", scrapPct: "0" },
  ]);
  const [qcRows, setQcRows] = useState<Array<{ name: string; nameAr: string; isMandatory: boolean }>>([]);
  const [costView, setCostView] = useState<number | null>(null);

  const create = useMutation({
    mutationFn: () => apiPost("/manufacturing/boms", {
      productId: Number(productId),
      quantity: Number(quantity),
      isPhantom,
      routingId: routingId ? Number(routingId) : undefined,
      lines: lines.filter((l) => l.componentId).map((l) => ({
        componentId: Number(l.componentId), quantityPer: Number(l.quantityPer), unit: l.unit, scrapPct: Number(l.scrapPct || 0),
      })),
      qcTemplates: qcRows.filter((q) => q.nameAr).map((q) => ({
        name: q.name || q.nameAr, nameAr: q.nameAr, isMandatory: q.isMandatory,
      })),
    }),
    onSuccess: () => { toast({ title: "تم إنشاء قائمة المواد" }); setOpen(false); setProductId(""); setQuantity("1"); setIsPhantom(false); setRoutingId(""); setLines([{ componentId: "", quantityPer: "1", unit: "piece", scrapPct: "0" }]); setQcRows([]); onChange(); },
    onError: (e: Error) => toast({ title: "فشل الإنشاء", description: e.message, variant: "destructive" }),
  });

  const cost = useQuery<{ totalCost: number; unitCost: number }>({
    queryKey: [`/manufacturing/boms/${costView}/cost`],
    queryFn: () => apiGet(`/manufacturing/boms/${costView}/cost`),
    enabled: !!costView,
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>قوائم المواد</CardTitle>
        {canWrite && <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4 ml-1" />قائمة جديدة</Button>}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>المرجع</TableHead><TableHead>المنتج</TableHead><TableHead>الكمية</TableHead><TableHead>وهمية</TableHead><TableHead>التكلفة</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {boms.map((b: Bom) => (
              <TableRow key={b.id}>
                <TableCell>{b.reference}</TableCell>
                <TableCell>{b.productName}</TableCell>
                <TableCell>{b.quantity}</TableCell>
                <TableCell>{b.isPhantom ? "نعم" : "لا"}</TableCell>
                <TableCell><Button size="sm" variant="ghost" onClick={() => setCostView(b.id)}>عرض</Button></TableCell>
              </TableRow>
            ))}
            {boms.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">لا توجد قوائم مواد</TableCell></TableRow>}
          </TableBody>
        </Table>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl" dir="rtl">
            <DialogHeader><DialogTitle>قائمة مواد جديدة</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>المنتج النهائي</Label>
                  <Select value={productId} onValueChange={setProductId}>
                    <SelectTrigger><SelectValue placeholder="اختر منتج" /></SelectTrigger>
                    <SelectContent>{products.map((p: Product) => (<SelectItem key={p.id} value={String(p.id)}>{p.nameAr}</SelectItem>))}</SelectContent>
                  </Select>
                </div>
                <div><Label>الكمية المنتجة</Label><Input type="number" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="phantom" checked={isPhantom} onChange={(e) => setIsPhantom(e.target.checked)} />
                <Label htmlFor="phantom">قائمة وهمية (للتجميع الفرعي فقط)</Label>
              </div>
              <div>
                <Label>المسار (Routing)</Label>
                <Select value={routingId} onValueChange={setRoutingId}>
                  <SelectTrigger><SelectValue placeholder="بدون مسار" /></SelectTrigger>
                  <SelectContent>
                    {(routings ?? []).filter((r: Routing) => r.isActive).map((r: Routing) => (
                      <SelectItem key={r.id} value={String(r.id)}>{r.reference} — {r.nameAr}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>المكونات</Label>
                  <Button size="sm" variant="outline" type="button" onClick={() => setLines([...lines, { componentId: "", quantityPer: "1", unit: "piece", scrapPct: "0" }])}>+ مكون</Button>
                </div>
                <div className="space-y-2">
                  {lines.map((ln, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2">
                      <div className="col-span-5">
                        <Select value={ln.componentId} onValueChange={(v) => { const n = [...lines]; n[i].componentId = v; setLines(n); }}>
                          <SelectTrigger><SelectValue placeholder="مكون" /></SelectTrigger>
                          <SelectContent>{products.map((p: Product) => (<SelectItem key={p.id} value={String(p.id)}>{p.nameAr}</SelectItem>))}</SelectContent>
                        </Select>
                      </div>
                      <Input className="col-span-2" type="number" step="0.01" value={ln.quantityPer} onChange={(e) => { const n = [...lines]; n[i].quantityPer = e.target.value; setLines(n); }} />
                      <Input className="col-span-2" placeholder="وحدة" value={ln.unit} onChange={(e) => { const n = [...lines]; n[i].unit = e.target.value; setLines(n); }} />
                      <Input className="col-span-2" type="number" step="0.01" placeholder="هدر %" value={ln.scrapPct} onChange={(e) => { const n = [...lines]; n[i].scrapPct = e.target.value; setLines(n); }} />
                      <Button size="sm" variant="ghost" type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="size-3" /></Button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>قوالب فحص الجودة (تُنسخ تلقائياً لكل أمر إنتاج)</Label>
                  <Button size="sm" variant="outline" type="button" onClick={() => setQcRows([...qcRows, { name: "", nameAr: "", isMandatory: true }])}>+ فحص</Button>
                </div>
                <div className="space-y-2">
                  {qcRows.map((q, i) => (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <Input className="col-span-5" placeholder="اسم الفحص (عربي)" value={q.nameAr} onChange={(e) => { const n = [...qcRows]; n[i].nameAr = e.target.value; setQcRows(n); }} />
                      <Input className="col-span-4" placeholder="Name (en)" value={q.name} onChange={(e) => { const n = [...qcRows]; n[i].name = e.target.value; setQcRows(n); }} />
                      <label className="col-span-2 flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={q.isMandatory} onChange={(e) => { const n = [...qcRows]; n[i].isMandatory = e.target.checked; setQcRows(n); }} />
                        إلزامي
                      </label>
                      <Button size="sm" variant="ghost" type="button" onClick={() => setQcRows(qcRows.filter((_, j) => j !== i))}><Trash2 className="size-3" /></Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button onClick={() => create.mutate()} disabled={!productId || create.isPending}>حفظ</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!costView} onOpenChange={(v) => !v && setCostView(null)}>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>تكلفة قائمة المواد</DialogTitle></DialogHeader>
            {cost.data ? (
              <div className="grid gap-2 text-sm">
                <div>التكلفة الإجمالية: <strong>{cost.data.totalCost.toFixed(4)}</strong></div>
                <div>تكلفة الوحدة: <strong>{cost.data.unitCost.toFixed(4)}</strong></div>
              </div>
            ) : <p className="text-muted-foreground">جارِ الحساب...</p>}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ---- Work Centers Tab ----
function WorkCentersTab({ rows, canWrite, onChange, toast }: any) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [capacity, setCapacity] = useState("8");
  const [hourlyCost, setHourlyCost] = useState("0");

  const create = useMutation({
    mutationFn: () => apiPost("/manufacturing/work-centers", { code, name, nameAr, capacityPerDay: Number(capacity), hourlyCost: Number(hourlyCost) }),
    onSuccess: () => { toast({ title: "تم إضافة محطة العمل" }); setOpen(false); setCode(""); setName(""); setNameAr(""); setCapacity("8"); setHourlyCost("0"); onChange(); },
    onError: (e: Error) => toast({ title: "فشل", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>محطات العمل</CardTitle>
        {canWrite && <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4 ml-1" />محطة جديدة</Button>}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>الرمز</TableHead><TableHead>الاسم</TableHead><TableHead>الطاقة (ساعة/يوم)</TableHead><TableHead>التكلفة الساعية</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((wc: WorkCenter) => (
              <TableRow key={wc.id}><TableCell>{wc.code}</TableCell><TableCell>{wc.nameAr}</TableCell><TableCell>{wc.capacityPerDay}</TableCell><TableCell>{wc.hourlyCost.toFixed(2)}</TableCell><TableCell>{wc.isActive ? <Badge>نشط</Badge> : <Badge variant="secondary">معطل</Badge>}</TableCell></TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">لا توجد محطات بعد</TableCell></TableRow>}
          </TableBody>
        </Table>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>محطة عمل جديدة</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div><Label>الرمز</Label><Input value={code} onChange={(e) => setCode(e.target.value)} /></div>
              <div><Label>الاسم (إنجليزي)</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div><Label>الاسم (عربي)</Label><Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} /></div>
              <div><Label>الطاقة الإنتاجية (ساعة/يوم)</Label><Input type="number" step="0.5" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
              <div><Label>التكلفة الساعية</Label><Input type="number" step="0.01" value={hourlyCost} onChange={(e) => setHourlyCost(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button onClick={() => create.mutate()} disabled={!code || !nameAr}>حفظ</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ---- Routings Tab ----
function RoutingsTab({ routings, workCenters, canWrite, onChange, toast }: any) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [ops, setOps] = useState<Array<{ sequence: string; name: string; nameAr: string; workCenterId: string; durationMinutes: string }>>([
    { sequence: "10", name: "", nameAr: "", workCenterId: "", durationMinutes: "0" },
  ]);

  const create = useMutation({
    mutationFn: () => apiPost("/manufacturing/routings", {
      name, nameAr,
      operations: ops.filter((o) => o.workCenterId).map((o) => ({
        sequence: Number(o.sequence), name: o.name, nameAr: o.nameAr, workCenterId: Number(o.workCenterId), durationMinutes: Number(o.durationMinutes),
      })),
    }),
    onSuccess: () => { toast({ title: "تم إنشاء المسار" }); setOpen(false); setName(""); setNameAr(""); setOps([{ sequence: "10", name: "", nameAr: "", workCenterId: "", durationMinutes: "0" }]); onChange(); },
    onError: (e: Error) => toast({ title: "فشل", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>مسارات الإنتاج</CardTitle>
        {canWrite && <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4 ml-1" />مسار جديد</Button>}
      </CardHeader>
      <CardContent className="space-y-4">
        {routings.map((r: Routing) => (
          <div key={r.id} className="rounded border p-3">
            <div className="flex items-center justify-between"><div className="font-semibold">{r.nameAr}</div><Badge variant="outline">{r.reference}</Badge></div>
            <Table>
              <TableHeader><TableRow><TableHead>تسلسل</TableHead><TableHead>عملية</TableHead><TableHead>محطة</TableHead><TableHead>المدة (د)</TableHead></TableRow></TableHeader>
              <TableBody>
                {r.operations.map((o) => (
                  <TableRow key={o.id}><TableCell>{o.sequence}</TableCell><TableCell>{o.nameAr}</TableCell><TableCell>{o.workCenterName}</TableCell><TableCell>{o.durationMinutes}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))}
        {routings.length === 0 && <p className="text-center text-muted-foreground">لا توجد مسارات</p>}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-2xl" dir="rtl">
            <DialogHeader><DialogTitle>مسار إنتاج جديد</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>الاسم (إنجليزي)</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div><Label>الاسم (عربي)</Label><Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} /></div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label>العمليات</Label>
                  <Button size="sm" variant="outline" type="button" onClick={() => setOps([...ops, { sequence: String((ops.length + 1) * 10), name: "", nameAr: "", workCenterId: "", durationMinutes: "0" }])}>+ عملية</Button>
                </div>
                {ops.map((o, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 mb-2">
                    <Input className="col-span-1" value={o.sequence} onChange={(e) => { const n = [...ops]; n[i].sequence = e.target.value; setOps(n); }} />
                    <Input className="col-span-3" placeholder="اسم عربي" value={o.nameAr} onChange={(e) => { const n = [...ops]; n[i].nameAr = e.target.value; setOps(n); }} />
                    <Input className="col-span-3" placeholder="اسم إنجليزي" value={o.name} onChange={(e) => { const n = [...ops]; n[i].name = e.target.value; setOps(n); }} />
                    <div className="col-span-3">
                      <Select value={o.workCenterId} onValueChange={(v) => { const n = [...ops]; n[i].workCenterId = v; setOps(n); }}>
                        <SelectTrigger><SelectValue placeholder="محطة" /></SelectTrigger>
                        <SelectContent>{workCenters.map((wc: WorkCenter) => (<SelectItem key={wc.id} value={String(wc.id)}>{wc.nameAr}</SelectItem>))}</SelectContent>
                      </Select>
                    </div>
                    <Input className="col-span-2" type="number" placeholder="دقائق" value={o.durationMinutes} onChange={(e) => { const n = [...ops]; n[i].durationMinutes = e.target.value; setOps(n); }} />
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button onClick={() => create.mutate()} disabled={!nameAr}>حفظ</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ---- Schedule Tab ----
function ScheduleTab() {
  const { data = [] } = useQuery<any[]>({ queryKey: ["/manufacturing/schedule"], queryFn: () => apiGet("/manufacturing/schedule") });
  const grouped = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of data) {
      const k = r.workCenterName ?? "—";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return Array.from(m.entries());
  }, [data]);
  return (
    <Card>
      <CardHeader><CardTitle>جدولة الإنتاج (الحمل مقابل الطاقة)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {grouped.length === 0 && <p className="text-center text-muted-foreground">لا توجد أوامر إنتاج مجدولة</p>}
        {grouped.map(([wc, items]) => {
          const totalMinutes = items.reduce((s, x) => s + Number(x.durationMinutes ?? 0) * Number(x.quantity), 0);
          const cap = items[0]?.capacityPerDay ? Number(items[0].capacityPerDay) * 60 : 0;
          const loadPct = cap > 0 ? Math.min(100, (totalMinutes / cap) * 100) : 0;
          return (
            <div key={wc} className="rounded border p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">{wc}</div>
                <div className="text-sm text-muted-foreground">{totalMinutes.toFixed(0)} دقيقة / {cap.toFixed(0)} دقيقة يومياً</div>
              </div>
              <div className="h-2 rounded bg-slate-100 overflow-hidden mb-2"><div className="h-full bg-primary" style={{ width: `${loadPct}%` }} /></div>
              <Table>
                <TableHeader><TableRow><TableHead>أمر</TableHead><TableHead>المنتج</TableHead><TableHead>الكمية</TableHead><TableHead>التاريخ</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
                <TableBody>
                  {items.map((x, i) => (
                    <TableRow key={i}>
                      <TableCell>{x.woRef}</TableCell><TableCell>{x.productName}</TableCell><TableCell>{x.quantity}</TableCell>
                      <TableCell>{x.plannedEnd ?? "—"}</TableCell>
                      <TableCell><Badge className={STATE_BADGES[x.state]?.cls}>{STATE_BADGES[x.state]?.label}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---- Quality Tab ----
function QualityTab({ workOrders, canWrite, onChange, toast }: any) {
  const [woId, setWoId] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [isMandatory, setIsMandatory] = useState(true);

  const detail = useQuery<any>({
    queryKey: [`/manufacturing/work-orders/${woId}`],
    queryFn: () => apiGet(`/manufacturing/work-orders/${woId}`),
    enabled: !!woId,
  });

  const create = useMutation({
    mutationFn: () => apiPost("/manufacturing/quality-checks", { workOrderId: Number(woId), name, nameAr, isMandatory }),
    onSuccess: () => { toast({ title: "تم إضافة الفحص" }); setName(""); setNameAr(""); detail.refetch(); onChange(); },
    onError: (e: Error) => toast({ title: "فشل", description: e.message, variant: "destructive" }),
  });
  const setResult = useMutation({
    mutationFn: ({ id, result }: { id: number; result: "pass" | "fail" }) => apiPost(`/manufacturing/quality-checks/${id}/result`, { result }),
    onSuccess: () => { detail.refetch(); onChange(); },
    onError: (e: Error) => toast({ title: "فشل", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader><CardTitle><ClipboardCheck className="size-4 inline ml-1" />فحوصات الجودة</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-md">
          <Label>اختر أمر إنتاج</Label>
          <Select value={woId} onValueChange={setWoId}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>{workOrders.map((w: WorkOrder) => (<SelectItem key={w.id} value={String(w.id)}>{w.reference} — {w.productName}</SelectItem>))}</SelectContent>
          </Select>
        </div>

        {woId && detail.data && (
          <>
            {canWrite && (
              <div className="rounded border p-3 grid grid-cols-12 gap-2 items-end">
                <div className="col-span-3"><Label>اسم الفحص (عربي)</Label><Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} /></div>
                <div className="col-span-3"><Label>الاسم (إنجليزي)</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div className="col-span-2 flex items-center gap-2"><input type="checkbox" id="mand" checked={isMandatory} onChange={(e) => setIsMandatory(e.target.checked)} /><Label htmlFor="mand">إلزامي</Label></div>
                <Button className="col-span-2" onClick={() => create.mutate()} disabled={!nameAr}>إضافة فحص</Button>
              </div>
            )}
            <Table>
              <TableHeader><TableRow><TableHead>الاسم</TableHead><TableHead>إلزامي</TableHead><TableHead>النتيجة</TableHead><TableHead>إجراء</TableHead></TableRow></TableHeader>
              <TableBody>
                {detail.data.qualityChecks?.map((q: any) => (
                  <TableRow key={q.id}>
                    <TableCell>{q.nameAr}</TableCell>
                    <TableCell>{q.isMandatory ? "نعم" : "لا"}</TableCell>
                    <TableCell><Badge variant={q.result === "pass" ? "default" : q.result === "fail" ? "destructive" : "secondary"}>{q.result}</Badge></TableCell>
                    <TableCell>
                      {canWrite && q.result === "pending" && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => setResult.mutate({ id: q.id, result: "pass" })}>نجح</Button>
                          <Button size="sm" variant="destructive" onClick={() => setResult.mutate({ id: q.id, result: "fail" })}>فشل</Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {(!detail.data.qualityChecks || detail.data.qualityChecks.length === 0) && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">لا توجد فحوصات</TableCell></TableRow>}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Scrap Tab ----
function ScrapTab({ rows, products, workOrders, warehouses, canWrite, onChange, toast }: any) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [fromWarehouseId, setFrom] = useState("");
  const [woId, setWoId] = useState("");
  const [reason, setReason] = useState("defect");
  const [notes, setNotes] = useState("");

  const create = useMutation({
    mutationFn: () => apiPost("/manufacturing/scrap", {
      productId: Number(productId), quantity: Number(quantity), fromWarehouseId: Number(fromWarehouseId),
      workOrderId: woId ? Number(woId) : undefined, reason, notes,
    }),
    onSuccess: () => { toast({ title: "تم تسجيل الإتلاف" }); setOpen(false); setProductId(""); setQuantity("1"); setFrom(""); setWoId(""); setNotes(""); onChange(); },
    onError: (e: Error) => toast({ title: "فشل", description: e.message, variant: "destructive" }),
  });
  const rework = useMutation({
    mutationFn: (id: number) => apiPost(`/manufacturing/scrap/${id}/rework`, {}),
    onSuccess: (d: any) => { toast({ title: "تمت إعادة المعالجة", description: d?.reworkWoId ? `أمر إنتاج جديد #${d.reworkWoId}` : undefined }); onChange(); },
    onError: (e: Error) => toast({ title: "فشل", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>سجلات الإتلاف</CardTitle>
        {canWrite && <Button size="sm" onClick={() => setOpen(true)}><Plus className="size-4 ml-1" />تسجيل إتلاف</Button>}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>المرجع</TableHead><TableHead>المنتج</TableHead><TableHead>الكمية</TableHead><TableHead>المستودع</TableHead><TableHead>السبب</TableHead><TableHead>التاريخ</TableHead><TableHead>إجراءات</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r: ScrapRow) => (
              <TableRow key={r.id}>
                <TableCell>{r.reference}</TableCell>
                <TableCell>{r.productName}</TableCell>
                <TableCell>{r.quantity}</TableCell>
                <TableCell>{r.warehouseName}</TableCell>
                <TableCell><Badge variant="outline">{r.reason}</Badge></TableCell>
                <TableCell>{new Date(r.createdAt).toLocaleDateString("ar")}</TableCell>
                <TableCell>
                  {canWrite && (r.reworkedAt
                    ? <Badge variant="secondary">أُعيدت المعالجة</Badge>
                    : <Button size="sm" variant="outline" onClick={() => rework.mutate(r.id)} disabled={rework.isPending}>إعادة معالجة</Button>)}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">لا توجد سجلات إتلاف</TableCell></TableRow>}
          </TableBody>
        </Table>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>تسجيل إتلاف</DialogTitle></DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>المنتج</Label>
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger><SelectValue placeholder="اختر منتج" /></SelectTrigger>
                  <SelectContent>{products.map((p: Product) => (<SelectItem key={p.id} value={String(p.id)}>{p.nameAr}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div><Label>الكمية</Label><Input type="number" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
              <div>
                <Label>من مستودع</Label>
                <Select value={fromWarehouseId} onValueChange={setFrom}>
                  <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent>{warehouses.map((w: Warehouse) => (<SelectItem key={w.id} value={String(w.id)}>{w.nameAr}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>أمر إنتاج (اختياري)</Label>
                <Select value={woId} onValueChange={setWoId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{workOrders.map((w: WorkOrder) => (<SelectItem key={w.id} value={String(w.id)}>{w.reference}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>السبب</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="defect">عيب صناعي</SelectItem>
                    <SelectItem value="damaged">تالف</SelectItem>
                    <SelectItem value="expired">منتهي الصلاحية</SelectItem>
                    <SelectItem value="qc_fail">فشل فحص جودة</SelectItem>
                    <SelectItem value="other">آخر</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button onClick={() => create.mutate()} disabled={!productId || !fromWarehouseId}>حفظ</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
