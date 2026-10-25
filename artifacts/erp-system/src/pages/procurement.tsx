import { useState, useMemo } from "react";
import {openFileDownload,downloadPdf} from "@/lib/download-file";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ApprovalActions } from "@/components/approval-actions";
import { SendStatusBadge, type LastSend } from "@/components/send-status-badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/hooks/use-language";
import { usePermissions } from "@/hooks/use-permissions";
import { useVatEnabled } from "@/hooks/use-vat-status";
import {
  ShoppingBag, Plus, FileText, ClipboardCheck, Truck, Wallet, FileCheck2, BarChart3,
  Mail, Download,
} from "lucide-react";

interface Stats {
  openPOs: number;
  awaitingApproval: number;
  committedValue: number;
  totalAp: number;
  approvalThreshold: number;
  priceTolerancePct: number;
}

interface Requisition {
  id: number; reference: string; status: string;
  lineCount: number; estimatedTotal: number; createdAt: string;
}

interface PO {
  receiptOnly?: boolean;
  warehouseId?: number|null; warehouseName?: string|null;
  id: number; reference: string; supplierId: number; supplierName: string;
  status: string; orderDate: string; expectedDate: string | null;
  total: number; subtotal: number; vat: number;
  requiresApproval: boolean; approvedAt: string | null; createdAt: string;
  sentToSupplierAt?: string | null; sentToSupplierEmail?: string | null;
  lastSend?: LastSend | null;
}

interface PoLine {
  id: number; productId: number | null; description: string;
  quantity: number; receivedQty: number; billedQty: number;
  unitPrice: number; taxRate: number; lineTotal: number;
}

interface PoOutboxEntry {
  id: number;
  recipient: string;
  subject: string;
  attachmentFilename: string | null;
  status: "sent" | "failed" | "queued" | string;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}

interface PoDetail extends PO {
  review?: {id:number;recordId:number;currentStep:number;policyReviewRequired:boolean;
    actionableSteps:Array<{sequence:number;stepToken:string}>}|null;
  notes: string | null;
  lines: PoLine[];
  receipts: Array<{ id: number; reference: string; receivedAt: string; notes: string | null }>;
  invoices: Array<{ id: number; invoiceNumber: string; amount: number; status: string }>;
  outbox?: PoOutboxEntry[];
}

interface GRN {
  id: number; reference: string; poId: number; poReference: string;
  supplierName: string; receivedAt: string; notes: string | null;
}

interface PaymentRun {
  id: number; reference: string; paymentDate: string; paymentMethod: string;
  totalAmount: number; status: string; executedAt: string | null;
}

interface Agreement {
  id: number; reference: string; supplierId: number; supplierName: string;
  startDate: string; endDate: string; status: string;
  totalCommittedValue: number; releasedValue: number;
}

interface AgingRow {
  supplierId: number; supplierName: string; paymentTermsDays: number;
  currentDue: number; days1To30: number; days31To60: number;
  days61To90: number; daysOver90: number; totalOutstanding: number;
}

interface Supplier { id: number; name: string }
interface Product { id: number; nameAr: string; sku: string; costPrice?: number | null }

const fmt = (n: number) =>
  new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR", maximumFractionDigits: 2 }).format(n);

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    draft: "bg-slate-200 text-slate-700",
    submitted: "bg-blue-100 text-blue-700",
    approved: "bg-emerald-100 text-emerald-700",
    rejected: "bg-rose-100 text-rose-700",
    converted: "bg-violet-100 text-violet-700",
    confirmed: "bg-blue-100 text-blue-700",
    partially_received: "bg-amber-100 text-amber-700",
    fully_received: "bg-emerald-100 text-emerald-700",
    closed: "bg-slate-300 text-slate-800",
    cancelled: "bg-rose-100 text-rose-700",
    sent: "bg-cyan-100 text-cyan-700",
    awarded: "bg-emerald-100 text-emerald-700",
    executed: "bg-emerald-100 text-emerald-700",
    active: "bg-emerald-100 text-emerald-700",
    expired: "bg-slate-300 text-slate-800",
  };
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-bold ${colorMap[status] ?? "bg-slate-100"}`}>{status}</span>;
}

// =================================================================
function StatsRow() {
  const { data } = useQuery<Stats>({ queryKey: ["/procurement/stats"], queryFn: () => apiGet("/procurement/stats") });
  if (!data) return null;
  const items = [
    { label: "أوامر شراء مفتوحة", value: data.openPOs, icon: FileText, color: "text-blue-600" },
    { label: "بانتظار الاعتماد", value: data.awaitingApproval, icon: ClipboardCheck, color: "text-amber-600" },
    { label: "قيمة الالتزامات", value: fmt(data.committedValue), icon: BarChart3, color: "text-violet-600" },
    { label: "إجمالي الذمم الدائنة", value: fmt(data.totalAp), icon: Wallet, color: "text-rose-600" },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <div className="text-xs text-muted-foreground">{it.label}</div>
              <div className="text-2xl font-bold">{it.value}</div>
            </div>
            <it.icon className={`size-8 ${it.color}`} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// =================================================================
function RequisitionsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ description: "", quantity: 1, estimatedCost: 0 }]);

  const { data: rows = [] } = useQuery<Requisition[]>({
    queryKey: ["/procurement/requisitions"],
    queryFn: () => apiGet("/procurement/requisitions"),
  });

  const create = useMutation({
    mutationFn: () => apiPost("/procurement/requisitions", { notes: notes || null, lines }),
    onSuccess: () => {
      toast({ title: "تم إنشاء طلب الشراء" });
      setOpen(false); setNotes(""); setLines([{ description: "", quantity: 1, estimatedCost: 0 }]);
      qc.invalidateQueries({ queryKey: ["/procurement/requisitions"] });
      qc.invalidateQueries({ queryKey: ["/procurement/stats"] });
    },
    onError: (err: Error) => toast({ title: "تعذر الإنشاء", description: err.message, variant: "destructive" }),
  });

  const submit = useMutation({
    mutationFn: (id: number) => apiPost(`/procurement/requisitions/${id}/submit`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/procurement/requisitions"] }),
  });
  const approve = useMutation({
    mutationFn: (id: number) => apiPost(`/procurement/requisitions/${id}/approve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/procurement/requisitions"] }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>طلبات الشراء (PR)</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-pr"><Plus className="me-1 size-4" />طلب جديد</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>طلب شراء جديد</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>ملاحظات</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>البنود</Label>
                {lines.map((ln, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2">
                    <Input className="col-span-6" placeholder="الوصف" value={ln.description}
                      onChange={(e) => { const c = [...lines]; c[i] = { ...c[i], description: e.target.value }; setLines(c); }} />
                    <Input className="col-span-3" type="number" placeholder="الكمية" value={ln.quantity}
                      onChange={(e) => { const c = [...lines]; c[i] = { ...c[i], quantity: Number(e.target.value) }; setLines(c); }} />
                    <Input className="col-span-3" type="number" placeholder="السعر المتوقع" value={ln.estimatedCost}
                      onChange={(e) => { const c = [...lines]; c[i] = { ...c[i], estimatedCost: Number(e.target.value) }; setLines(c); }} />
                  </div>
                ))}
                <Button variant="outline" size="sm"
                  onClick={() => setLines([...lines, { description: "", quantity: 1, estimatedCost: 0 }])}>
                  + إضافة بند
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button onClick={() => create.mutate()} disabled={create.isPending || lines.some((l) => !l.description)}>
                حفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>المرجع</TableHead><TableHead>البنود</TableHead>
            <TableHead>القيمة المتوقعة</TableHead><TableHead>الحالة</TableHead>
            <TableHead>التاريخ</TableHead><TableHead>الإجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.reference}</TableCell>
                <TableCell>{r.lineCount}</TableCell>
                <TableCell>{fmt(r.estimatedTotal)}</TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                <TableCell>{new Date(r.createdAt).toLocaleDateString("ar-SA")}</TableCell>
                <TableCell className="space-x-1 space-x-reverse">
                  {r.status === "draft" && (
                    <Button size="sm" variant="outline" onClick={() => submit.mutate(r.id)}>تقديم</Button>
                  )}
                  {r.status === "submitted" && (
                    <Button size="sm" onClick={() => approve.mutate(r.id)}>اعتماد</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">لا توجد طلبات شراء</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// =================================================================
function POsTab({ onSelectPO }: { onSelectPO: (po: PO) => void }) {
  const {canProcurement,isScoped}=usePermissions();
  const showPrices=!isScoped||canProcurement("orders.read");
  const [warehouseId,setWarehouseId]=useState("");
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const vatEnabled = useVatEnabled();
  const defaultTaxRate = vatEnabled ? 15 : 0;
  const [lines, setLines] = useState([{ productId: "", description: "", quantity: 1, unitPrice: 0, taxRate: defaultTaxRate }]);

  const { data: rows = [] } = useQuery<PO[]>({
    queryKey: ["/procurement/purchase-orders"],
    queryFn: () => apiGet("/procurement/purchase-orders"),
  });
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/suppliers"], queryFn: () => apiGet("/suppliers"),
    enabled:canProcurement("suppliers.read"),
  });
  const {data:warehouses=[]}=useQuery<Array<{id:number;name:string}>>({
    queryKey:["/warehouses"],queryFn:()=>apiGet("/warehouses"),enabled:canProcurement("orders.create"),
  });
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/products"], queryFn: () => apiGet("/products"),
  });

  const create = useMutation({
    mutationFn: () => apiPost("/procurement/purchase-orders", {
      supplierId: Number(supplierId),
      warehouseId:warehouseId?Number(warehouseId):null,
      notes: notes || null,
      lines: lines.map((l) => ({
        productId: l.productId ? Number(l.productId) : null,
        description: l.description, quantity: l.quantity,
        unitPrice: l.unitPrice, taxRate: l.taxRate,
      })),
    }),
    onSuccess: () => {
      toast({ title: "تم إنشاء أمر الشراء" });
      setOpen(false); setSupplierId(""); setNotes("");
      setLines([{ productId: "", description: "", quantity: 1, unitPrice: 0, taxRate: defaultTaxRate }]);
      qc.invalidateQueries({ queryKey: ["/procurement/purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["/procurement/stats"] });
    },
    onError: (err: Error) => toast({ title: "تعذر الإنشاء", description: err.message, variant: "destructive" }),
  });

  const action = useMutation({
    mutationFn: ({ id, op }: { id: number; op: "confirm" | "approve" | "cancel" | "close" }) =>
      apiPost(`/procurement/purchase-orders/${id}/${op}`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/procurement/purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["/procurement/stats"] });
    },
    onError: (err: Error) => toast({ title: "تعذر التنفيذ", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>أوامر الشراء (PO)</CardTitle>
        <Dialog open={open&&canProcurement("orders.create")} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button hidden={!canProcurement("orders.create")} data-testid="button-new-po"><Plus className="me-1 size-4" />أمر شراء</Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader><DialogTitle>أمر شراء جديد</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Label>مستودع وفرع أمر الشراء</Label>
              <select aria-label="مستودع أمر الشراء" className="w-full rounded border p-2" value={warehouseId} onChange={e=>setWarehouseId(e.target.value)}>
                <option value="">{isScoped?"اختر المستودع المصرح":"بدون مستودع"}</option>
                {warehouses.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <div>
                <Label>المورد</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger><SelectValue placeholder="اختر مورداً" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>ملاحظات</Label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>البنود</Label>
                {lines.map((ln, i) => (
                  <div key={i} className="grid grid-cols-12 gap-1">
                    <Select value={ln.productId} onValueChange={(v) => {
                      const c = [...lines];
                      const p = products.find((p) => p.id === Number(v));
                      c[i] = { ...c[i], productId: v, description: p?.nameAr ?? c[i].description,
                              unitPrice: p && p.costPrice != null ? Number(p.costPrice) : c[i].unitPrice };
                      setLines(c);
                    }}>
                      <SelectTrigger className="col-span-4"><SelectValue placeholder="منتج" /></SelectTrigger>
                      <SelectContent>
                        {products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.nameAr}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input className="col-span-3" placeholder="الوصف" value={ln.description}
                      onChange={(e) => { const c = [...lines]; c[i] = { ...c[i], description: e.target.value }; setLines(c); }} />
                    <Input className="col-span-2" type="number" placeholder="كمية" value={ln.quantity}
                      onChange={(e) => { const c = [...lines]; c[i] = { ...c[i], quantity: Number(e.target.value) }; setLines(c); }} />
                    <Input className={vatEnabled ? "col-span-2" : "col-span-3"} type="number" placeholder="سعر" value={ln.unitPrice}
                      onChange={(e) => { const c = [...lines]; c[i] = { ...c[i], unitPrice: Number(e.target.value) }; setLines(c); }} />
                    {vatEnabled && (
                      <Input className="col-span-1" type="number" placeholder="ض%" value={ln.taxRate}
                        onChange={(e) => { const c = [...lines]; c[i] = { ...c[i], taxRate: Number(e.target.value) }; setLines(c); }} />
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm"
                  onClick={() => setLines([...lines, { productId: "", description: "", quantity: 1, unitPrice: 0, taxRate: defaultTaxRate }])}>
                  + إضافة بند
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button onClick={() => create.mutate()}
                disabled={create.isPending || !supplierId || lines.some((l) => !l.description)}>
                حفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>المرجع</TableHead><TableHead>المورد</TableHead>
            {showPrices&&<TableHead>الإجمالي</TableHead>}<TableHead>الحالة</TableHead>
            {canProcurement("orders.send")&&<TableHead>الإرسال</TableHead>}
            <TableHead>التاريخ</TableHead><TableHead>الإجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => {
              const sendTone = r.lastSend?.status === "failed"
                ? "bg-red-50/40 dark:bg-red-950/20"
                : r.lastSend?.status === "queued"
                ? "bg-amber-50/40 dark:bg-amber-950/20"
                : "";
              return (
              <TableRow key={r.id} className={`cursor-pointer hover:bg-muted/50 ${sendTone}`} onClick={() => onSelectPO(r)}>
                <TableCell className="font-mono">{r.reference}</TableCell>
                <TableCell>{r.supplierName}</TableCell>
                {showPrices&&<TableCell>{fmt(r.total)}</TableCell>}
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1">
                    <StatusBadge status={r.status} />
                    {r.requiresApproval && !r.approvedAt && <Badge variant="outline">يحتاج اعتماد</Badge>}
                    <SendStatusBadge doc={r} testIdPrefix="badge-po-send-status" />
                  </div>
                </TableCell>
                {canProcurement("orders.send")&&<TableCell>
                  <SendStatusBadge doc={r} testIdPrefix="badge-po-send-status" />
                </TableCell>}
                <TableCell>{new Date(r.orderDate).toLocaleDateString("ar-SA")}</TableCell>
                <TableCell className="space-x-1 space-x-reverse" onClick={(e) => e.stopPropagation()}>
                  {r.status === "pending_approval" && canProcurement("orders.approve") && (
                    <Button size="sm" variant="outline" onClick={() => onSelectPO(r)}>مراجعة الاعتماد</Button>
                  )}
                  {r.status === "draft" && canProcurement("orders.confirm") && (
                    <Button size="sm" onClick={() => action.mutate({ id: r.id, op: "confirm" })}>تأكيد</Button>
                  )}
                  {(r.status === "fully_received") && canProcurement("orders.close") && (
                    <Button size="sm" variant="outline" onClick={() => action.mutate({ id: r.id, op: "close" })}>إغلاق</Button>
                  )}
                  {canProcurement("orders.cancel") && (r.status !== "fully_received" && r.status !== "closed" && r.status !== "cancelled") && (
                    <Button size="sm" variant="ghost" className="text-rose-600"
                      onClick={() => action.mutate({ id: r.id, op: "cancel" })}>إلغاء</Button>
                  )}
                  {r.status === "pending_approval" && !isScoped && (
                    <ApprovalActions docType="purchase_order" recordId={r.id} compact />
                  )}
                </TableCell>
              </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">لا توجد أوامر شراء</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// =================================================================
function PODetailDialog({ po, onClose }: { po: PO | null; onClose: () => void }) {
  const {canProcurement,isScoped}=usePermissions();
  const showPrices=!isScoped||canProcurement("orders.read");
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data } = useQuery<PoDetail>({
    queryKey: [`/procurement/purchase-orders/${po?.id}`],
    queryFn: () => apiGet(`/procurement/purchase-orders/${po!.id}`),
    enabled: !!po,
  });
  const [recvQty, setRecvQty] = useState<Record<number, number>>({});
  // Keep the SAME intent after an unknown result, even if a refetch now says fully received.
  // The shared financialFetch lease and server receipt remain the authority, not this UI state.
  const [receiptIntent,setReceiptIntent]=useState<{poId:number;lines:Array<{poLineId:number;quantity:number}>}|null>(null);

  const receive = useMutation({
    mutationFn: () => {
      const intent=receiptIntent??{poId:po!.id,
      lines: Object.entries(recvQty).filter(([id, q]) => q > 0&&data?.lines.some(l=>l.id===Number(id))).map(([id, q]) => ({
        poLineId: Number(id), quantity: q,
      }))};
      setReceiptIntent(intent);
      return apiPost<{id:number;poId:number}>("/procurement/goods-receipts",intent);
    },
    onSuccess: (result) => {
      toast({ title: "تم تسجيل الاستلام" });
      setReceiptIntent(null);
      setRecvQty({});
      qc.invalidateQueries({ queryKey: [`/procurement/purchase-orders/${result.poId}`] });
      qc.invalidateQueries({ queryKey: ["/procurement/purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["/procurement/goods-receipts"] });
    },
    onError: (err: Error&{status?:number}) => {
      if(err.status===400||err.status===409)setReceiptIntent(null);
      toast({ title: "تعذر تأكيد الاستلام", description: err.message, variant: "destructive" });
    },
  });

  const canReceive = canProcurement("receipts.receive") && data && (data.status === "confirmed" || data.status === "partially_received");
  const canSend = canProcurement("orders.send") && data && ["confirmed", "partially_received", "fully_received", "closed"].includes(data.status);

  const send = useMutation({
    mutationFn: () => apiPost(`/procurement/purchase-orders/${po!.id}/send`, {}),
    onSuccess: (resp: { sentTo?: string; sentAt?: string }) => {
      toast({
        title: "تم إرسال أمر الشراء",
        description: resp.sentTo ? `إلى ${resp.sentTo}` : undefined,
      });
      qc.invalidateQueries({ queryKey: [`/procurement/purchase-orders/${po!.id}`] });
      qc.invalidateQueries({ queryKey: ["/procurement/purchase-orders"] });
    },
    onError: (err: Error) => {
      toast({ title: "تعذر الإرسال", description: err.message, variant: "destructive" });
      qc.invalidateQueries({ queryKey: [`/procurement/purchase-orders/${po!.id}`] });
    },
  });

  const retry = useMutation({
    mutationFn: (outboxId: number) =>
      apiPost(
        `/procurement/purchase-orders/${po!.id}/outbox/${outboxId}/retry`,
        {},
      ),
    onSuccess: (resp: { dispatched?: boolean; sentTo?: string }) => {
      toast({
        title: resp.dispatched ? "تمت إعادة الإرسال" : "فشل إعادة الإرسال",
        description: resp.sentTo ? `إلى ${resp.sentTo}` : undefined,
        variant: resp.dispatched ? "default" : "destructive",
      });
      qc.invalidateQueries({ queryKey: [`/procurement/purchase-orders/${po!.id}`] });
      qc.invalidateQueries({ queryKey: ["/procurement/purchase-orders"] });
    },
    onError: (err: Error) => {
      toast({ title: "تعذر إعادة الإرسال", description: err.message, variant: "destructive" });
      qc.invalidateQueries({ queryKey: [`/procurement/purchase-orders/${po!.id}`] });
    },
  });

  const vatEnabled = useVatEnabled();

  const previewPdf = () => {
    if (!po) return;
    void downloadPdf(`${(import.meta.env.BASE_URL||"/").replace(/\/$/,"")}/api/procurement/purchase-orders/${po.id}/pdf`,`PO-${po.reference}.pdf`)
      .catch(e=>toast({title:"تعذرت الطباعة",description:e.message,variant:"destructive"}));
  };

  return (
    <Dialog open={!!po} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>أمر الشراء {po?.reference} — {po?.supplierName}</DialogTitle>
        </DialogHeader>
        {data && (
          <>
          {isScoped&&data.status==="pending_approval"&&canProcurement("orders.approve")&&
            <ApprovalActions docType="purchase_order" recordId={data.id} nativePurchaseOrder={data.review??null}/>}
          </>
        )}
        {data && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><span className="text-muted-foreground">الحالة:</span> <StatusBadge status={data.status} /></div>
              {data.warehouseId&&<div><span className="text-muted-foreground">مستودع الوجهة:</span> {data.warehouseName||`#${data.warehouseId}`}</div>}
              {showPrices&&(vatEnabled ? (
                <>
                  <div><span className="text-muted-foreground">المجموع:</span> {fmt(data.subtotal)}</div>
                  <div><span className="text-muted-foreground">الضريبة:</span> {fmt(data.vat)}</div>
                  <div><span className="text-muted-foreground">الإجمالي:</span> <strong>{fmt(data.total)}</strong></div>
                </>
              ) : (
                <div><span className="text-muted-foreground">الإجمالي:</span> <strong>{fmt(data.total)}</strong></div>
              ))}
              <div><span className="text-muted-foreground">التاريخ:</span> {data.orderDate}</div>
              <div><span className="text-muted-foreground">المتوقع:</span> {data.expectedDate ?? "—"}</div>
            </div>
            {(canSend||canProcurement("orders.print")||canProcurement("orders.export")) && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3">
                <Button hidden={!canProcurement("orders.print")} variant="outline" size="sm" onClick={previewPdf} data-testid="button-preview-po-pdf">
                  <Download className="me-1 size-4" />معاينة PDF
                </Button>
                {canProcurement("orders.export")&&<Button variant="outline" size="sm" data-testid="button-export-po-pdf" onClick={()=>{
                  if(po)void downloadPdf(`${(import.meta.env.BASE_URL||"/").replace(/\/$/,"")}/api/procurement/purchase-orders/${po.id}/pdf?download=1`,`PO-${po.reference}.pdf`)
                    .catch(e=>toast({title:"تعذر التنزيل",description:e.message,variant:"destructive"}));
                }}>تنزيل أمر الشراء</Button>}
                <Button hidden={!canSend} size="sm" onClick={() => send.mutate()} disabled={send.isPending}
                  data-testid="button-send-po">
                  <Mail className="me-1 size-4" />
                  {data.sentToSupplierAt ? "إعادة الإرسال للمورد" : "إرسال للمورد"}
                </Button>
                {data.sentToSupplierAt && (
                  <span className="text-xs text-muted-foreground">
                    آخر إرسال: {new Date(data.sentToSupplierAt).toLocaleString("ar-SA")}
                    {data.sentToSupplierEmail ? ` إلى ${data.sentToSupplierEmail}` : ""}
                  </span>
                )}
              </div>
            )}
            <Card>
              <CardHeader><CardTitle className="text-base">البنود</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>الوصف</TableHead><TableHead>طلبت</TableHead>
                    <TableHead>استلمت</TableHead><TableHead>المتبقي</TableHead>
                    {showPrices&&<TableHead>فُوترت</TableHead>}
                    {showPrices&&<TableHead>السعر</TableHead>}
                    {canReceive && <TableHead>كمية الاستلام</TableHead>}
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.lines.map((ln) => {
                      const remaining = ln.quantity - ln.receivedQty;
                      return (
                        <TableRow key={ln.id}>
                          <TableCell>{ln.description}</TableCell>
                          <TableCell>{ln.quantity}</TableCell>
                          <TableCell>{ln.receivedQty}</TableCell>
                          <TableCell>{remaining}</TableCell>
                          {showPrices&&<TableCell>{ln.billedQty}</TableCell>}
                          {showPrices&&<TableCell>{fmt(ln.unitPrice)}</TableCell>}
                          {canReceive && (
                            <TableCell>
                              <Input aria-label={`كمية استلام ${ln.description}`} type="number" min={0} max={remaining} step="0.0001" className="w-24"
                                disabled={receive.isPending||!!receiptIntent}
                                value={recvQty[ln.id] ?? ""}
                                onChange={(e) => setRecvQty({ ...recvQty, [ln.id]: Number(e.target.value) })}
                                placeholder={`متبقي ${remaining}`} />
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            {(canReceive||receiptIntent) && (
              <div className="flex justify-end">
                <Button data-testid="button-receive-purchase" onClick={() => receive.mutate()}
                  disabled={receive.isPending || receiptIntent!=null&&receiptIntent.poId!==po?.id ||
                    !receiptIntent&&!data.lines.some(l=>(recvQty[l.id]??0)>0)}>
                  <Truck className="me-1 size-4" />{receiptIntent?"استرجاع نتيجة محاولة الاستلام":"تسجيل استلام"}
                </Button>
              </div>
            )}
            {data.receipts.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">الاستلامات المسجلة</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-sm">
                    {data.receipts.map((r) => (
                      <li key={r.id} className="flex justify-between">
                        <span className="font-mono">{r.reference}</span>
                        <span className="text-muted-foreground">{new Date(r.receivedAt).toLocaleString("ar-SA")}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
            {data.invoices.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">فواتير المورد المرتبطة</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-1 text-sm">
                    {data.invoices.map((i) => (
                      <li key={i.id} className="flex justify-between">
                        <span className="font-mono">{i.invoiceNumber}</span>
                        <span><StatusBadge status={i.status} /> <strong>{fmt(i.amount)}</strong></span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
            {data.outbox && data.outbox.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">سجل الإرسال للمورد</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>التاريخ</TableHead>
                        <TableHead>المستلم</TableHead>
                        <TableHead>المرفق</TableHead>
                        <TableHead>الحالة</TableHead>
                        <TableHead>السبب</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.outbox.map((e) => (
                        <TableRow key={e.id} data-testid={`row-po-outbox-${e.id}`}>
                          <TableCell className="text-xs">
                            {new Date(e.createdAt).toLocaleString("ar-SA")}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{e.recipient}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {e.attachmentFilename ?? "—"}
                          </TableCell>
                          <TableCell><StatusBadge status={e.status} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[240px] truncate">
                            {e.error ?? (e.sentAt ? new Date(e.sentAt).toLocaleString("ar-SA") : "—")}
                          </TableCell>
                          <TableCell>
                            {e.status !== "sent" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => retry.mutate(e.id)}
                                disabled={retry.isPending}
                                data-testid={`button-retry-po-outbox-${e.id}`}
                              >
                                <Mail className="me-1 size-3" />
                                إعادة المحاولة
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// =================================================================
function GRNsTab() {
  const { data: rows = [] } = useQuery<GRN[]>({
    queryKey: ["/procurement/goods-receipts"],
    queryFn: () => apiGet("/procurement/goods-receipts"),
  });
  return (
    <Card>
      <CardHeader><CardTitle>إيصالات الاستلام (GRN)</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>المرجع</TableHead><TableHead>أمر الشراء</TableHead>
            <TableHead>المورد</TableHead><TableHead>تاريخ الاستلام</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.reference}</TableCell>
                <TableCell className="font-mono">{r.poReference}</TableCell>
                <TableCell>{r.supplierName}</TableCell>
                <TableCell>{new Date(r.receivedAt).toLocaleString("ar-SA")}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">لم تُسجَّل استلامات بعد</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// =================================================================
type OpenInvoice = {
  id: number; invoiceNumber: string; supplierId: number; supplierName: string;
  amount: number; dueDate: string | null; status: string;
};

function PaymentRunsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<"bank" | "cash">("bank");
  // Each line picks a specific open AP invoice; supplierId is derived
  // from the chosen invoice so the user cannot mismatch them.
  const [lines, setLines] = useState<Array<{ invoiceId: string; amount: number }>>([{ invoiceId: "", amount: 0 }]);

  const { data: rows = [] } = useQuery<PaymentRun[]>({
    queryKey: ["/procurement/payment-runs"], queryFn: () => apiGet("/procurement/payment-runs"),
  });
  const { data: openInvoices = [] } = useQuery<OpenInvoice[]>({
    queryKey: ["/procurement/open-invoices"],
    queryFn: () => apiGet("/procurement/open-invoices"),
  });

  const create = useMutation({
    mutationFn: () => {
      const validLines = lines
        .filter((l) => l.invoiceId && l.amount > 0)
        .map((l) => {
          const inv = openInvoices.find((x) => x.id === Number(l.invoiceId))!;
          return { supplierId: inv.supplierId, invoiceId: inv.id, amount: l.amount };
        });
      return apiPost("/procurement/payment-runs", { paymentMethod: method, lines: validLines });
    },
    onSuccess: () => {
      toast({ title: "تم إنشاء الدفعة" });
      setOpen(false); setLines([{ invoiceId: "", amount: 0 }]);
      qc.invalidateQueries({ queryKey: ["/procurement/payment-runs"] });
    },
    onError: (err: Error) => toast({ title: "تعذر الإنشاء", description: err.message, variant: "destructive" }),
  });

  const exec = useMutation({
    mutationFn: (id: number) => apiPost(`/procurement/payment-runs/${id}/execute`, {}),
    onSuccess: () => {
      toast({ title: "تم تنفيذ الدفعة وترحيل القيد" });
      qc.invalidateQueries({ queryKey: ["/procurement/payment-runs"] });
      qc.invalidateQueries({ queryKey: ["/procurement/stats"] });
    },
    onError: (err: Error) => toast({ title: "فشل التنفيذ", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>دفعات الموردين</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="me-1 size-4" />دفعة جديدة</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>دفعة موردين جديدة</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>طريقة الدفع</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as "bank" | "cash")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank">حوالة بنكية</SelectItem>
                    <SelectItem value="cash">نقداً</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>الفواتير المستحقة</Label>
                {openInvoices.length === 0 && (
                  <div className="text-xs text-muted-foreground">لا توجد فواتير مستحقة حالياً.</div>
                )}
                {lines.map((ln, i) => {
                  const inv = openInvoices.find((x) => x.id === Number(ln.invoiceId));
                  return (
                    <div key={i} className="grid grid-cols-12 gap-2 items-center">
                      <Select value={ln.invoiceId} onValueChange={(v) => {
                        const c = [...lines];
                        const picked = openInvoices.find((x) => x.id === Number(v));
                        c[i] = { invoiceId: v, amount: picked ? picked.amount : 0 };
                        setLines(c);
                      }}>
                        <SelectTrigger className="col-span-8"><SelectValue placeholder="اختر فاتورة مستحقة" /></SelectTrigger>
                        <SelectContent>
                          {openInvoices.map((iv) => (
                            <SelectItem key={iv.id} value={String(iv.id)}>
                              {iv.invoiceNumber} — {iv.supplierName} — {fmt(iv.amount)}
                              {iv.dueDate ? ` (استحقاق ${iv.dueDate})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {/* Amount is locked to the invoice total: payment runs
                          must FULLY settle the invoice (server enforces). */}
                      <Input className="col-span-3" type="number" value={ln.amount} disabled
                        readOnly />
                      <Button variant="ghost" size="sm" className="col-span-1"
                        onClick={() => setLines((arr) => arr.filter((_, idx) => idx !== i))}>×</Button>
                    </div>
                  );
                })}
                <Button variant="outline" size="sm" onClick={() => setLines([...lines, { invoiceId: "", amount: 0 }])}>+ إضافة سطر</Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button onClick={() => create.mutate()}>حفظ</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>المرجع</TableHead><TableHead>الطريقة</TableHead>
            <TableHead>الإجمالي</TableHead><TableHead>الحالة</TableHead>
            <TableHead>التاريخ</TableHead><TableHead>إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.reference}</TableCell>
                <TableCell>{r.paymentMethod === "bank" ? "بنك" : "نقد"}</TableCell>
                <TableCell>{fmt(r.totalAmount)}</TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                <TableCell>{r.paymentDate}</TableCell>
                <TableCell className="space-x-1 space-x-reverse">
                  {r.status === "draft" && (
                    <Button size="sm" onClick={() => exec.mutate(r.id)}>تنفيذ</Button>
                  )}
                  {/* Surfaces approve / reject / request_changes inline when
                      this run is locked to pending_approval. Approvers don't
                      need to leave the page to act on it. */}
                  <ApprovalActions docType="payment_run" recordId={r.id} compact />
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">لا توجد دفعات</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// =================================================================
type RfqRow = { id: number; reference: string; status: string; dueDate: string | null; awardedSupplierId: number | null; createdAt: string };
type RfqDetail = RfqRow & {
  suppliers: Array<{ supplierId: number; sentAt: string | null; respondedAt: string | null; totalQuoted: number }>;
  quoteLines: Array<{ id: number; supplierId: number; description: string; quantity: string; unitPrice: string; leadTimeDays: number }>;
};

function RFQsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [openCreate, setOpenCreate] = useState(false);
  const [selectedRfqId, setSelectedRfqId] = useState<number | null>(null);
  const [supplierIds, setSupplierIds] = useState<string[]>([""]);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");

  const { data: rfqs = [] } = useQuery<RfqRow[]>({
    queryKey: ["/procurement/rfqs"], queryFn: () => apiGet("/procurement/rfqs"),
  });
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/suppliers"], queryFn: () => apiGet("/suppliers"),
  });
  const { data: detail } = useQuery<RfqDetail>({
    queryKey: ["/procurement/rfqs", selectedRfqId],
    queryFn: () => apiGet(`/procurement/rfqs/${selectedRfqId}`),
    enabled: !!selectedRfqId,
  });

  const create = useMutation({
    mutationFn: () => apiPost("/procurement/rfqs", {
      supplierIds: supplierIds.filter(Boolean).map(Number),
      dueDate: dueDate || null,
      notes: notes || null,
    }),
    onSuccess: () => {
      toast({ title: "تم إنشاء طلب عرض السعر" });
      setOpenCreate(false); setSupplierIds([""]); setNotes(""); setDueDate("");
      qc.invalidateQueries({ queryKey: ["/procurement/rfqs"] });
    },
    onError: (err: Error) => toast({ title: "تعذر الإنشاء", description: err.message, variant: "destructive" }),
  });
  const award = useMutation({
    mutationFn: (vars: { rfqId: number; supplierId: number }) =>
      apiPost(`/procurement/rfqs/${vars.rfqId}/award`, { supplierId: vars.supplierId }),
    onSuccess: () => {
      toast({ title: "تمت الترسية وأنشئ أمر شراء" });
      qc.invalidateQueries({ queryKey: ["/procurement/rfqs"] });
      qc.invalidateQueries({ queryKey: ["/procurement/purchase-orders"] });
      setSelectedRfqId(null);
    },
    onError: (err: Error) => toast({ title: "تعذر الترسية", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>طلبات عروض الأسعار (RFQs)</CardTitle>
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild><Button><Plus className="me-1 size-4" />طلب عرض جديد</Button></DialogTrigger>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>إصدار طلب عرض سعر</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div><Label>تاريخ الاستحقاق</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
              </div>
              <div className="space-y-2">
                <Label>الموردون المدعوون</Label>
                {supplierIds.map((sid, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Select value={sid} onValueChange={(v) => setSupplierIds((arr) => arr.map((x, i) => i === idx ? v : x))}>
                      <SelectTrigger><SelectValue placeholder="اختر مورداً" /></SelectTrigger>
                      <SelectContent>
                        {suppliers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="sm" onClick={() => setSupplierIds((arr) => arr.filter((_, i) => i !== idx))}>حذف</Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setSupplierIds((arr) => [...arr, ""])}>
                  <Plus className="me-1 size-3" />إضافة مورد
                </Button>
              </div>
              <div><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>
            <DialogFooter>
              <Button onClick={() => create.mutate()} disabled={create.isPending || supplierIds.filter(Boolean).length === 0}>
                إصدار الطلب
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>المرجع</TableHead><TableHead>الحالة</TableHead><TableHead>الاستحقاق</TableHead>
            <TableHead>المورد المرسى عليه</TableHead><TableHead className="text-end">إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rfqs.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.reference}</TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                <TableCell>{r.dueDate ?? "—"}</TableCell>
                <TableCell>{r.awardedSupplierId ? (suppliers.find((s) => s.id === r.awardedSupplierId)?.name ?? r.awardedSupplierId) : "—"}</TableCell>
                <TableCell className="text-end">
                  <Button variant="outline" size="sm" onClick={() => setSelectedRfqId(r.id)}>مقارنة العروض</Button>
                </TableCell>
              </TableRow>
            ))}
            {rfqs.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">لا توجد طلبات عروض.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!selectedRfqId} onOpenChange={(o) => !o && setSelectedRfqId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>مقارنة العروض — {detail?.reference ?? ""}</DialogTitle></DialogHeader>
          {!detail ? <div className="text-sm text-muted-foreground">جارٍ التحميل…</div> : (
            <div className="space-y-3">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>المورد</TableHead><TableHead>إجمالي العرض</TableHead>
                  <TableHead>تم الرد</TableHead><TableHead className="text-end">إجراءات</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {detail.suppliers.map((s) => (
                    <TableRow key={s.supplierId}>
                      <TableCell>{suppliers.find((x) => x.id === s.supplierId)?.name ?? s.supplierId}</TableCell>
                      <TableCell>{fmt(Number(s.totalQuoted))}</TableCell>
                      <TableCell>{s.respondedAt ? "نعم" : "لا"}</TableCell>
                      <TableCell className="text-end">
                        <Button size="sm" disabled={detail.status === "awarded" || award.isPending || s.totalQuoted <= 0}
                          onClick={() => award.mutate({ rfqId: detail.id, supplierId: s.supplierId })}>
                          ترسية
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="text-xs text-muted-foreground">
                ملاحظة: يمكن للموردين إرسال عروضهم عبر API <span className="font-mono">POST /procurement/rfqs/{detail.id}/quotes</span>.
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// =================================================================
function AgreementsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [items, setItems] = useState([{ productId: "", agreedPrice: 0, agreedQty: 0 }]);

  const { data: rows = [] } = useQuery<Agreement[]>({
    queryKey: ["/procurement/agreements"], queryFn: () => apiGet("/procurement/agreements"),
  });
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/suppliers"], queryFn: () => apiGet("/suppliers"),
  });
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/products"], queryFn: () => apiGet("/products"),
  });

  const create = useMutation({
    mutationFn: () => apiPost("/procurement/agreements", {
      supplierId: Number(supplierId),
      startDate, endDate,
      items: items.filter((i) => i.productId).map((i) => ({
        productId: Number(i.productId), agreedPrice: i.agreedPrice, agreedQty: i.agreedQty,
      })),
    }),
    onSuccess: () => {
      toast({ title: "تم إنشاء الاتفاقية" });
      setOpen(false); qc.invalidateQueries({ queryKey: ["/procurement/agreements"] });
    },
    onError: (err: Error) => toast({ title: "تعذر الإنشاء", description: err.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>الاتفاقيات الإطارية</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="me-1 size-4" />اتفاقية جديدة</Button></DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>اتفاقية إطارية</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>المورد</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger><SelectValue placeholder="اختر مورداً" /></SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>من</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
                <div><Label>إلى</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
              </div>
              <div className="space-y-2">
                <Label>البنود</Label>
                {items.map((it, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2">
                    <Select value={it.productId} onValueChange={(v) => {
                      const c = [...items]; c[i] = { ...c[i], productId: v }; setItems(c);
                    }}>
                      <SelectTrigger className="col-span-6"><SelectValue placeholder="منتج" /></SelectTrigger>
                      <SelectContent>
                        {products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.nameAr}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input className="col-span-3" type="number" placeholder="السعر" value={it.agreedPrice}
                      onChange={(e) => { const c = [...items]; c[i] = { ...c[i], agreedPrice: Number(e.target.value) }; setItems(c); }} />
                    <Input className="col-span-3" type="number" placeholder="الكمية" value={it.agreedQty}
                      onChange={(e) => { const c = [...items]; c[i] = { ...c[i], agreedQty: Number(e.target.value) }; setItems(c); }} />
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setItems([...items, { productId: "", agreedPrice: 0, agreedQty: 0 }])}>+ إضافة بند</Button>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
              <Button onClick={() => create.mutate()} disabled={!supplierId || !endDate}>حفظ</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>المرجع</TableHead><TableHead>المورد</TableHead>
            <TableHead>القيمة الكلية</TableHead><TableHead>المنفذ</TableHead>
            <TableHead>السريان</TableHead><TableHead>الحالة</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono">{r.reference}</TableCell>
                <TableCell>{r.supplierName}</TableCell>
                <TableCell>{fmt(r.totalCommittedValue)}</TableCell>
                <TableCell>{fmt(r.releasedValue)}</TableCell>
                <TableCell>{r.startDate} → {r.endDate}</TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">لا توجد اتفاقيات</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// =================================================================
function AgingTab() {
  const { data: rows = [] } = useQuery<AgingRow[]>({
    queryKey: ["/procurement/ap-aging"], queryFn: () => apiGet("/procurement/ap-aging"),
  });
  const totals = useMemo(() => rows.reduce(
    (a, r) => ({
      currentDue: a.currentDue + r.currentDue,
      days1To30: a.days1To30 + r.days1To30,
      days31To60: a.days31To60 + r.days31To60,
      days61To90: a.days61To90 + r.days61To90,
      daysOver90: a.daysOver90 + r.daysOver90,
      totalOutstanding: a.totalOutstanding + r.totalOutstanding,
    }),
    { currentDue: 0, days1To30: 0, days31To60: 0, days61To90: 0, daysOver90: 0, totalOutstanding: 0 },
  ), [rows]);

  return (
    <Card>
      <CardHeader><CardTitle>تقرير أعمار الذمم الدائنة (AP Aging)</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>المورد</TableHead><TableHead>سارية</TableHead>
            <TableHead>1-30 يوم</TableHead><TableHead>31-60</TableHead>
            <TableHead>61-90</TableHead><TableHead>أكثر من 90</TableHead>
            <TableHead>الإجمالي</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.supplierId}>
                <TableCell>{r.supplierName}</TableCell>
                <TableCell>{fmt(r.currentDue)}</TableCell>
                <TableCell>{fmt(r.days1To30)}</TableCell>
                <TableCell>{fmt(r.days31To60)}</TableCell>
                <TableCell className="text-amber-600">{fmt(r.days61To90)}</TableCell>
                <TableCell className="text-rose-600 font-bold">{fmt(r.daysOver90)}</TableCell>
                <TableCell className="font-bold">{fmt(r.totalOutstanding)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">لا توجد ذمم قائمة</TableCell></TableRow>
            )}
            {rows.length > 0 && (
              <TableRow className="bg-muted font-bold">
                <TableCell>الإجمالي</TableCell>
                <TableCell>{fmt(totals.currentDue)}</TableCell>
                <TableCell>{fmt(totals.days1To30)}</TableCell>
                <TableCell>{fmt(totals.days31To60)}</TableCell>
                <TableCell>{fmt(totals.days61To90)}</TableCell>
                <TableCell>{fmt(totals.daysOver90)}</TableCell>
                <TableCell>{fmt(totals.totalOutstanding)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// =================================================================
// Kanban / status-board view of POs grouped by lifecycle status. This
// gives procurement a glanceable workflow board (draft → confirmed →
// receiving → closed) without leaving the page.
function PoKanbanTab({ onSelectPO }: { onSelectPO: (po: PO) => void }) {
  const { data: rows = [] } = useQuery<PO[]>({
    queryKey: ["/procurement/purchase-orders"],
    queryFn: () => apiGet("/procurement/purchase-orders"),
  });
  const columns: Array<{ key: string; label: string }> = [
    { key: "draft", label: "مسودة" },
    { key: "confirmed", label: "مؤكد" },
    { key: "partially_received", label: "استلام جزئي" },
    { key: "fully_received", label: "مستلم بالكامل" },
    { key: "closed", label: "مغلق" },
    { key: "cancelled", label: "ملغي" },
  ];
  const grouped = new Map<string, PO[]>();
  for (const c of columns) grouped.set(c.key, []);
  for (const po of rows) {
    if (grouped.has(po.status)) grouped.get(po.status)!.push(po);
  }
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      {columns.map((col) => {
        const items = grouped.get(col.key) ?? [];
        const total = items.reduce((s, p) => s + Number(p.total), 0);
        return (
          <Card key={col.key} className="flex flex-col">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>{col.label}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{items.length}</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{fmt(total)}</p>
            </CardHeader>
            <CardContent className="flex-1 space-y-2">
              {items.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">لا توجد أوامر</p>
              ) : (
                items.map((po) => (
                  <button
                    key={po.id}
                    type="button"
                    onClick={() => onSelectPO(po)}
                    data-testid={`kanban-po-${po.id}`}
                    className="w-full rounded border bg-card p-2 text-start hover:bg-accent"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{po.reference}</span>
                      {po.requiresApproval && !po.approvedAt && (
                        <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">يحتاج اعتماد</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{po.supplierName}</p>
                    <p className="text-xs">{fmt(Number(po.total))}</p>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// =================================================================
export default function ProcurementPage() {
  const { isRTL } = useLanguage();
  const { has } = usePermissions();
  const [selectedPo, setSelectedPo] = useState<PO | null>(null);
  // Roles outside the procurement group (sales, cashier, marketing) can
  // raise PRs but cannot read suppliers/POs/stats — those endpoints are
  // server-guarded by supplierReadGuard. Render a PR-only experience
  // for them so the page doesn't fire 403s on load.
  const {isScoped,canProcurement}=usePermissions();
  const canReadProcurement = has("supplierRead");

  return (
    <div dir={isRTL ? "rtl" : "ltr"} className="space-y-4">
      <div className="flex items-center gap-3">
        <ShoppingBag className="size-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">دورة المشتريات</h1>
          <p className="text-sm text-muted-foreground">من طلب الشراء إلى الدفع — متكاملة مع المخزون والمحاسبة</p>
        </div>
      </div>
      {canReadProcurement && !isScoped && <StatsRow />}
      {isScoped ? ((canProcurement("orders.read")||canProcurement("receipts.read"))?<POsTab onSelectPO={setSelectedPo}/>:<p>اختر مسؤولية تجيز عرض أوامر الشراء أو كميات الاستلام.</p>) : !canReadProcurement ? (
        // Minimal PR-only view for non-procurement roles.
        <RequisitionsTab />
      ) : (
        <Tabs defaultValue="requisitions">
          <TabsList className="flex w-full flex-wrap">
            <TabsTrigger value="requisitions">طلبات الشراء</TabsTrigger>
            <TabsTrigger value="pos">أوامر الشراء</TabsTrigger>
            <TabsTrigger value="board">لوحة الحالات</TabsTrigger>
            <TabsTrigger value="grns"><Truck className="me-1 size-4" />الاستلامات</TabsTrigger>
            <TabsTrigger value="payments"><Wallet className="me-1 size-4" />الدفعات</TabsTrigger>
            <TabsTrigger value="rfqs">طلبات عروض الأسعار</TabsTrigger>
            <TabsTrigger value="agreements"><FileCheck2 className="me-1 size-4" />الاتفاقيات</TabsTrigger>
            <TabsTrigger value="aging"><BarChart3 className="me-1 size-4" />أعمار الذمم</TabsTrigger>
          </TabsList>
          <TabsContent value="requisitions" className="mt-4"><RequisitionsTab /></TabsContent>
          <TabsContent value="pos" className="mt-4"><POsTab onSelectPO={setSelectedPo} /></TabsContent>
          <TabsContent value="board" className="mt-4"><PoKanbanTab onSelectPO={setSelectedPo} /></TabsContent>
          <TabsContent value="grns" className="mt-4"><GRNsTab /></TabsContent>
          <TabsContent value="payments" className="mt-4"><PaymentRunsTab /></TabsContent>
          <TabsContent value="rfqs" className="mt-4"><RFQsTab /></TabsContent>
          <TabsContent value="agreements" className="mt-4"><AgreementsTab /></TabsContent>
          <TabsContent value="aging" className="mt-4"><AgingTab /></TabsContent>
        </Tabs>
      )}
      <PODetailDialog po={selectedPo} onClose={() => setSelectedPo(null)} />
    </div>
  );
}
