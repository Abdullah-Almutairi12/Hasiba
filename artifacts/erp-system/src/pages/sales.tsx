import React, { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Money } from "@/components/riyal";
import { Plus, FileText, Truck, Receipt, ArrowLeftRight, Tag, Percent, Award, AlertCircle } from "lucide-react";
import { useApiQuery, useApiMutation, apiPost, apiDelete } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import { useListCustomers, useListProducts } from "@workspace/api-client-react";
import { usePermissions } from "@/hooks/use-permissions";
import { ApprovalActions } from "@/components/approval-actions";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
type ProductLite = { id: number; name: string; nameAr?: string | null };
type CustomerLite = { id: number; name: string };

interface Quotation {
  id: number;
  reference: string;
  customerName: string;
  status: string;
  quoteDate: string;
  validUntil: string | null;
  total: number;
  subtotal: number;
  discount: number;
  vat: number;
}
interface SalesOrder extends Quotation {
  orderDate: string;
  expectedDate: string | null;
  source: string;
}
interface Invoice extends Quotation {
  invoiceDate: string;
  dueDate: string | null;
  amountPaid: number;
  source: string;
}
interface Receipt {
  id: number;
  reference: string;
  customerName: string;
  receiptDate: string;
  amount: number;
  paymentMethod: string;
}
interface CreditNote extends Quotation {
  noteDate: string;
  reason: string | null;
}
interface Pricelist {
  id: number;
  nameAr: string;
  segment: string | null;
  currencyCode: string;
  isDefault: boolean;
  isActive: boolean;
}
interface SalesSummary {
  monthStart: string;
  quotations: { count: number; value: number; accepted: number };
  salesOrders: { count: number; value: number };
  invoices: { outstanding: number; thisMonth: number };
}
interface ArAging {
  asOf: string;
  buckets: { current: number; d30: number; d60: number; d90: number; over90: number };
  total: number;
  customers: Array<{ customerId: number; customerName: string; total: number; current: number; d30: number; d60: number; d90: number; over90: number }>;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  sent: "مُرسل",
  accepted: "مقبول",
  rejected: "مرفوض",
  expired: "منتهي",
  confirmed: "مؤكد",
  partially_delivered: "تسليم جزئي",
  fully_delivered: "تم التسليم",
  invoiced: "مفوتر",
  done: "مكتمل",
  cancelled: "ملغي",
  open: "مفتوحة",
  partially_paid: "مدفوعة جزئياً",
  paid: "مدفوعة",
  issued: "صادر",
  applied: "مُطبق",
  ready: "جاهز",
  delivered: "تم التسليم",
};

function StatusBadge({ status }: { status: string }) {
  const variant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    draft: "outline",
    sent: "secondary",
    accepted: "default",
    rejected: "destructive",
    expired: "destructive",
    cancelled: "destructive",
    paid: "default",
    open: "secondary",
    partially_paid: "secondary",
    invoiced: "default",
    fully_delivered: "default",
  };
  return (
    <Badge variant={variant[status] ?? "outline"} className="font-normal">
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

export default function SalesPage() {
  const { canReadReports } = usePermissions();
  // The /sales/reports/* endpoints are guarded server-side by reportReadGuard
  // (owner/manager/accountant/auditor). Skipping the query for non-report
  // roles avoids a 403 + misleading zero-state on the summary cards and
  // hides the report-only tabs from the tab bar.
  const { data: summary } = useApiQuery<SalesSummary>(
    "/sales/reports/summary",
    { enabled: canReadReports },
  );

  return (
    <div className="space-y-6 pb-8 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">دورة المبيعات (Q2C)</h1>
        <p className="text-muted-foreground">
          من عرض السعر إلى أمر البيع إلى التسليم إلى الفاتورة إلى التحصيل
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard title="عروض الأسعار" value={summary?.quotations.value ?? 0} subtitle={`${summary?.quotations.count ?? 0} عرض، ${summary?.quotations.accepted ?? 0} مقبول`} icon={FileText} />
        <SummaryCard title="أوامر البيع" value={summary?.salesOrders.value ?? 0} subtitle={`${summary?.salesOrders.count ?? 0} أمر هذا الشهر`} icon={Truck} />
        <SummaryCard title="فواتير الشهر" value={summary?.invoices.thisMonth ?? 0} subtitle="الفواتير المُصدرة" icon={Receipt} />
        <SummaryCard title="ذمم مدينة قائمة" value={summary?.invoices.outstanding ?? 0} subtitle="غير مُحصّلة بعد" icon={AlertCircle} />
      </div>

      <Tabs defaultValue="quotations" className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="quotations">عروض الأسعار</TabsTrigger>
          <TabsTrigger value="orders">أوامر البيع</TabsTrigger>
          <TabsTrigger value="deliveries">إذونات التسليم</TabsTrigger>
          <TabsTrigger value="invoices">فواتير العملاء</TabsTrigger>
          <TabsTrigger value="receipts">سندات القبض</TabsTrigger>
          <TabsTrigger value="credit-notes">إشعارات دائنة</TabsTrigger>
          <TabsTrigger value="pricelists">قوائم الأسعار</TabsTrigger>
          <TabsTrigger value="commissions">العمولات</TabsTrigger>
          {canReadReports && <TabsTrigger value="aging">تقادم الذمم</TabsTrigger>}
          {canReadReports && <TabsTrigger value="by-rep">المبيعات حسب المندوب</TabsTrigger>}
          {canReadReports && <TabsTrigger value="by-customer">حسب العميل</TabsTrigger>}
          {canReadReports && <TabsTrigger value="by-product">حسب المنتج</TabsTrigger>}
        </TabsList>

        <TabsContent value="quotations"><QuotationsTab /></TabsContent>
        <TabsContent value="orders"><SalesOrdersTab /></TabsContent>
        <TabsContent value="deliveries"><DeliveriesTab /></TabsContent>
        <TabsContent value="invoices"><InvoicesTab /></TabsContent>
        <TabsContent value="receipts"><ReceiptsTab /></TabsContent>
        <TabsContent value="credit-notes"><CreditNotesTab /></TabsContent>
        <TabsContent value="pricelists"><PricelistsTab /></TabsContent>
        <TabsContent value="commissions"><CommissionsTab /></TabsContent>
        {canReadReports && <TabsContent value="aging"><ArAgingTab /></TabsContent>}
        {canReadReports && <TabsContent value="by-rep"><SalesByRepTab /></TabsContent>}
        {canReadReports && <TabsContent value="by-customer"><SalesByCustomerTab /></TabsContent>}
        {canReadReports && <TabsContent value="by-product"><SalesByProductTab /></TabsContent>}
      </Tabs>
    </div>
  );
}

function SummaryCard({
  title, value, subtitle, icon: Icon,
}: { title: string; value: number; subtitle: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-1">
        <div className="flex items-start justify-between">
          <div className="text-sm text-muted-foreground">{title}</div>
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="text-xl font-bold tabular-nums"><Money value={value} /></div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </CardContent>
    </Card>
  );
}

// ===== Quotations =====
function QuotationsTab() {
  const { data, isLoading, refetch } = useApiQuery<Quotation[]>("/sales/quotations");
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>عروض الأسعار</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2"><Plus className="size-4" />عرض سعر جديد</Button>
          </DialogTrigger>
          <DocumentFormDialog kind="quotation" onSuccess={() => { setOpen(false); refetch(); }} />
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <DocTable
          isLoading={isLoading}
          rows={data}
          columns={[
            { header: "المرجع", cell: (r) => <span className="font-mono text-sm">{r.reference}</span> },
            { header: "العميل", cell: (r) => r.customerName },
            { header: "التاريخ", cell: (r) => r.quoteDate },
            { header: "ساري حتى", cell: (r) => r.validUntil ?? "—" },
            { header: "الإجمالي", cell: (r) => <Money value={r.total} /> },
            { header: "الحالة", cell: (r) => <StatusBadge status={r.status} /> },
            { header: "إجراءات", cell: (r) => <QuotationActions q={r} onChange={refetch} /> },
          ]}
          emptyText="لا توجد عروض أسعار بعد"
        />
      </CardContent>
    </Card>
  );
}

function QuotationActions({ q, onChange }: { q: Quotation; onChange: () => void }) {
  const { toast } = useToast();
  async function transition(to: string) {
    try {
      await apiPost(`/sales/quotations/${q.id}/transition`, { to });
      onChange();
    } catch (e) {
      toast({ title: "تعذر تغيير الحالة", description: errMsg(e), variant: "destructive" });
    }
  }
  async function convert() {
    try {
      await apiPost(`/sales/quotations/${q.id}/convert`, {});
      toast({ title: "تم التحويل إلى أمر بيع" });
      onChange();
    } catch (e) {
      toast({ title: "تعذر التحويل", description: errMsg(e), variant: "destructive" });
    }
  }
  return (
    <div className="flex gap-1 flex-wrap">
      {(q.status === "draft" || q.status === "sent") && (
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              const r = await apiPost<{
                ok: boolean;
                dispatched: boolean;
                sentTo: string;
                outboxStatus: string;
                reason?: string;
                mailerConfigured: boolean;
              }>(`/sales/quotations/${q.id}/send`, {});
              if (r.dispatched) {
                toast({ title: "تم الإرسال", description: `إلى: ${r.sentTo}` });
              } else {
                // Backend honestly returns dispatched=false when SMTP is not
                // configured or the provider rejected the message. Surface
                // that to the user instead of pretending the email went out.
                toast({
                  title: r.mailerConfigured ? "تعذر الإرسال" : "تم وضع الرسالة في قائمة الانتظار",
                  description: r.reason ?? "البريد غير مُهيأ — يرجى ضبط SMTP_HOST/SMTP_PORT لإرسال الرسالة فعلياً",
                  variant: r.mailerConfigured ? "destructive" : "default",
                });
              }
              onChange();
            } catch (e) {
              toast({ title: "تعذر الإرسال", description: errMsg(e), variant: "destructive" });
            }
          }}
        >
          إرسال بالبريد
        </Button>
      )}
      {q.status === "sent" && <Button size="sm" variant="outline" onClick={() => transition("accepted")}>قبول</Button>}
      {q.status === "sent" && <Button size="sm" variant="outline" onClick={() => transition("rejected")}>رفض</Button>}
      {q.status === "accepted" && <Button size="sm" onClick={convert}>تحويل لأمر بيع</Button>}
    </div>
  );
}

// ===== Sales Orders =====
function SalesOrdersTab() {
  const { data, isLoading, refetch } = useApiQuery<SalesOrder[]>("/sales/orders");
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>أوامر البيع</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2"><Plus className="size-4" />أمر بيع جديد</Button>
          </DialogTrigger>
          <DocumentFormDialog kind="order" onSuccess={() => { setOpen(false); refetch(); }} />
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <DocTable
          isLoading={isLoading}
          rows={data}
          columns={[
            { header: "المرجع", cell: (r) => <span className="font-mono text-sm">{r.reference}</span> },
            { header: "العميل", cell: (r) => r.customerName },
            { header: "التاريخ", cell: (r) => r.orderDate },
            { header: "متوقع", cell: (r) => r.expectedDate ?? "—" },
            { header: "الإجمالي", cell: (r) => <Money value={r.total} /> },
            { header: "الحالة", cell: (r) => <StatusBadge status={r.status} /> },
            { header: "المصدر", cell: (r) => <Badge variant="outline" className="font-normal">{r.source}</Badge> },
            { header: "إجراءات", cell: (r) => <SoActions so={r} onChange={refetch} /> },
          ]}
          emptyText="لا توجد أوامر بيع بعد"
        />
      </CardContent>
    </Card>
  );
}

function SoActions({ so, onChange }: { so: SalesOrder; onChange: () => void }) {
  const { toast } = useToast();
  const { canManageFinance, canManageInventory } = usePermissions();
  async function deliver() {
    try {
      await apiPost(`/sales/deliveries`, { soId: so.id });
      toast({ title: "تم إنشاء إذن التسليم" });
      onChange();
    } catch (e) {
      toast({ title: "تعذر التسليم", description: errMsg(e), variant: "destructive" });
    }
  }
  async function invoice() {
    try {
      await apiPost(`/sales/invoices`, { soId: so.id });
      toast({ title: "تم إنشاء الفاتورة" });
      onChange();
    } catch (e) {
      toast({ title: "تعذر التفويتر", description: errMsg(e), variant: "destructive" });
    }
  }
  async function transition(to: string) {
    try {
      await apiPost(`/sales/orders/${so.id}/transition`, { to });
      toast({ title: `تم الانتقال إلى ${to}` });
      onChange();
    } catch (e) {
      toast({ title: "تعذر الانتقال", description: errMsg(e), variant: "destructive" });
    }
  }
  if (["done", "cancelled"].includes(so.status)) return null;
  return (
    <div className="flex gap-1 flex-wrap">
      {so.status === "draft" && (
        <Button size="sm" variant="outline" onClick={() => transition("confirmed")}>تأكيد</Button>
      )}
      {canManageInventory && ["confirmed", "partially_delivered"].includes(so.status) && (
        <Button size="sm" variant="outline" onClick={deliver}>تسليم</Button>
      )}
      {canManageFinance && !["draft", "cancelled"].includes(so.status) && (
        <Button size="sm" variant="outline" onClick={invoice}>تفويتر</Button>
      )}
      {so.status === "invoiced" && (
        <Button size="sm" variant="outline" onClick={() => transition("done")}>إنهاء</Button>
      )}
      {so.status === "pending_approval" && (
        <ApprovalActions docType="sales_order" recordId={so.id} compact />
      )}
    </div>
  );
}

// ===== Deliveries =====
function DeliveriesTab() {
  const { data, isLoading } = useApiQuery<Array<{ id: number; reference: string; soId: number; deliveryDate: string; status: string; createdAt: string }>>("/sales/deliveries");
  return (
    <Card>
      <CardHeader><CardTitle>إذونات التسليم</CardTitle></CardHeader>
      <CardContent className="p-0">
        <DocTable
          isLoading={isLoading}
          rows={data}
          columns={[
            { header: "المرجع", cell: (r) => <span className="font-mono text-sm">{r.reference}</span> },
            { header: "أمر البيع", cell: (r) => <span className="font-mono text-xs">SO #{r.soId}</span> },
            { header: "التاريخ", cell: (r) => r.deliveryDate },
            { header: "الحالة", cell: (r) => <StatusBadge status={r.status} /> },
          ]}
          emptyText="لا توجد إذونات تسليم"
        />
      </CardContent>
    </Card>
  );
}

// ===== Invoices =====
function InvoicesTab() {
  const { data, isLoading, refetch } = useApiQuery<Invoice[]>("/sales/invoices");
  const [open, setOpen] = useState(false);
  const { canManageFinance } = usePermissions();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>فواتير العملاء</CardTitle>
        {canManageFinance && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2"><Plus className="size-4" />فاتورة جديدة</Button>
            </DialogTrigger>
            <DocumentFormDialog kind="invoice" onSuccess={() => { setOpen(false); refetch(); }} />
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <DocTable
          isLoading={isLoading}
          rows={data}
          columns={[
            { header: "المرجع", cell: (r) => <span className="font-mono text-sm">{r.reference}</span> },
            { header: "العميل", cell: (r) => r.customerName },
            { header: "التاريخ", cell: (r) => r.invoiceDate },
            { header: "الاستحقاق", cell: (r) => r.dueDate ?? "—" },
            { header: "الإجمالي", cell: (r) => <Money value={r.total} /> },
            { header: "المدفوع", cell: (r) => <Money value={r.amountPaid} /> },
            { header: "المتبقي", cell: (r) => <span className="font-medium"><Money value={r.total - r.amountPaid} /></span> },
            { header: "الحالة", cell: (r) => <StatusBadge status={r.status} /> },
            { header: "المصدر", cell: (r) => <Badge variant="outline" className="font-normal">{r.source}</Badge> },
          ]}
          emptyText="لا توجد فواتير بعد"
        />
      </CardContent>
    </Card>
  );
}

// ===== Receipts =====
function ReceiptsTab() {
  const { canManageFinance } = usePermissions();
  const { data, isLoading, refetch } = useApiQuery<Receipt[]>("/sales/receipts", { enabled: canManageFinance });
  const [open, setOpen] = useState(false);
  if (!canManageFinance) {
    return <Card><CardContent className="p-6 text-center text-muted-foreground">سندات القبض متاحة لفريق المالية فقط.</CardContent></Card>;
  }
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>سندات القبض</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2"><Plus className="size-4" />سند قبض</Button>
          </DialogTrigger>
          <ReceiptFormDialog onSuccess={() => { setOpen(false); refetch(); }} />
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <DocTable
          isLoading={isLoading}
          rows={data}
          columns={[
            { header: "المرجع", cell: (r) => <span className="font-mono text-sm">{r.reference}</span> },
            { header: "العميل", cell: (r) => r.customerName },
            { header: "التاريخ", cell: (r) => r.receiptDate },
            { header: "المبلغ", cell: (r) => <Money value={r.amount} /> },
            { header: "الطريقة", cell: (r) => <Badge variant="outline" className="font-normal">{r.paymentMethod}</Badge> },
          ]}
          emptyText="لا توجد سندات قبض"
        />
      </CardContent>
    </Card>
  );
}

// ===== Credit Notes =====
function CreditNotesTab() {
  const { data, isLoading, refetch } = useApiQuery<CreditNote[]>("/sales/credit-notes");
  const [open, setOpen] = useState(false);
  const { canManageFinance } = usePermissions();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>الإشعارات الدائنة (مردودات)</CardTitle>
        {canManageFinance && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2"><Plus className="size-4" />إشعار جديد</Button>
            </DialogTrigger>
            <CreditNoteFormDialog onSuccess={() => { setOpen(false); refetch(); }} />
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <DocTable
          isLoading={isLoading}
          rows={data}
          columns={[
            { header: "المرجع", cell: (r) => <span className="font-mono text-sm">{r.reference}</span> },
            { header: "العميل", cell: (r) => r.customerName },
            { header: "التاريخ", cell: (r) => r.noteDate },
            { header: "الإجمالي", cell: (r) => <Money value={r.total} /> },
            { header: "السبب", cell: (r) => r.reason ?? "—" },
            { header: "الحالة", cell: (r) => <StatusBadge status={r.status} /> },
            {
              header: "اعتماد",
              cell: (r) => r.status === "pending_approval"
                ? <ApprovalActions docType="credit_note" recordId={r.id} compact />
                : null,
            },
          ]}
          emptyText="لا توجد إشعارات دائنة"
        />
      </CardContent>
    </Card>
  );
}

// ===== Pricelists =====
function PricelistsTab() {
  const { data, isLoading, refetch } = useApiQuery<Pricelist[]>("/sales/pricelists");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Pricelist | null>(null);
  const { isAdmin } = usePermissions();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>قوائم الأسعار</CardTitle>
          {isAdmin && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2"><Plus className="size-4" />قائمة جديدة</Button>
              </DialogTrigger>
              <PricelistFormDialog onSuccess={() => { setOpen(false); refetch(); }} />
            </Dialog>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>الاسم</TableHead><TableHead>الفئة</TableHead><TableHead>العملة</TableHead><TableHead>الحالة</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={5}><Skeleton className="h-8" /></TableCell></TableRow>}
              {data?.map((r) => (
                <TableRow key={r.id} className={selected?.id === r.id ? "bg-muted/40" : ""}>
                  <TableCell><div className="flex items-center gap-2"><Tag className="size-4 text-muted-foreground" />{r.nameAr}</div></TableCell>
                  <TableCell>{r.segment ? <Badge variant="outline">{r.segment}</Badge> : "—"}</TableCell>
                  <TableCell>{r.currencyCode}</TableCell>
                  <TableCell>{r.isActive ? <Badge>نشطة</Badge> : <Badge variant="outline">غير نشطة</Badge>}</TableCell>
                  <TableCell><Button size="sm" variant="outline" onClick={() => setSelected(r)}>إدارة الأصناف</Button></TableCell>
                </TableRow>
              ))}
              {data?.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground h-20">لا توجد قوائم أسعار</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {selected && <PricelistItemsPanel pricelist={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

interface PricelistItem { id: number; productId: number | null; productName: string | null; minQuantity: number; unitPrice: number; discountPct: number | null }

function PricelistItemsPanel({ pricelist, onClose }: { pricelist: Pricelist; onClose: () => void }) {
  const { data, isLoading, refetch } = useApiQuery<PricelistItem[]>(`/sales/pricelists/${pricelist.id}/items`);
  const { data: products } = useListProducts({});
  const { toast } = useToast();
  const [productId, setProductId] = useState<string>("");
  const [minQty, setMinQty] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [discountPct, setDiscountPct] = useState(0);
  const add = async () => {
    if (!productId) { toast({ title: "اختر صنفاً", variant: "destructive" }); return; }
    try {
      await apiPost(`/sales/pricelists/${pricelist.id}/items`, {
        productId: Number(productId), minQuantity: minQty, unitPrice, discountPct: discountPct || null,
      });
      setProductId(""); setMinQty(1); setUnitPrice(0); setDiscountPct(0);
      refetch();
    } catch (e) { toast({ title: "خطأ", description: errMsg(e), variant: "destructive" }); }
  };
  const remove = async (id: number) => {
    try { await apiDelete(`/sales/pricelists/items/${id}`); refetch(); }
    catch (e) { toast({ title: "خطأ", description: errMsg(e), variant: "destructive" }); }
  };
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">أصناف القائمة: {pricelist.nameAr}</CardTitle>
        <Button size="sm" variant="ghost" onClick={onClose}>إغلاق</Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
          <div className="md:col-span-2">
            <Label>الصنف</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder="اختر صنفاً" /></SelectTrigger>
              <SelectContent>{products?.map((p: ProductLite) => <SelectItem key={p.id} value={String(p.id)}>{p.nameAr ?? p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>أدنى كمية</Label><Input type="number" value={minQty} onChange={(e) => setMinQty(+e.target.value)} /></div>
          <div><Label>السعر</Label><Input type="number" value={unitPrice} onChange={(e) => setUnitPrice(+e.target.value)} /></div>
          <div className="flex gap-2 items-end">
            <div className="flex-1"><Label>خصم %</Label><Input type="number" value={discountPct} onChange={(e) => setDiscountPct(+e.target.value)} /></div>
            <Button onClick={add}>إضافة</Button>
          </div>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>الصنف</TableHead><TableHead>أدنى كمية</TableHead><TableHead>السعر</TableHead><TableHead>خصم %</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5}><Skeleton className="h-8" /></TableCell></TableRow>}
            {data?.map((it) => (
              <TableRow key={it.id}>
                <TableCell>{it.productName ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{it.minQuantity}</TableCell>
                <TableCell className="tabular-nums"><Money value={it.unitPrice} /></TableCell>
                <TableCell className="tabular-nums">{it.discountPct ?? 0}%</TableCell>
                <TableCell><Button size="sm" variant="destructive" onClick={() => remove(it.id)}>حذف</Button></TableCell>
              </TableRow>
            ))}
            {data?.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground h-16">لا توجد أصناف بعد</TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ===== Commissions =====
function CommissionsTab() {
  const today = new Date();
  const [from, setFrom] = useState(new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  const { data: report, refetch } = useApiQuery<{ from: string; to: string; total: number; rows: Array<{ repId: number | null; repName: string; netRevenue: number; commission: number; planName: string | null; baseRate: number; bonusRate: number; invoiceCount: number }> }>(`/sales/commission-report?from=${from}&to=${to}`);
  const { data: plans, refetch: refetchPlans } = useApiQuery<Array<{ id: number; name: string; rate: number; quota: number; bonusRate: number; isActive: boolean }>>("/sales/commission-plans");
  const [open, setOpen] = useState(false);
  const { isAdmin, canManageFinance } = usePermissions();

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>خطط العمولات</CardTitle>
          {isAdmin && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2"><Plus className="size-4" />خطة جديدة</Button>
              </DialogTrigger>
              <CommissionPlanDialog onSuccess={() => { setOpen(false); refetchPlans(); }} />
            </Dialog>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>الاسم</TableHead><TableHead>المعدل %</TableHead><TableHead>الحصة</TableHead><TableHead>معدل المكافأة %</TableHead><TableHead>الحالة</TableHead><TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {plans?.map((p) => (
                <CommissionPlanRow key={p.id} plan={p} />
              ))}
              {plans?.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground h-20">لا توجد خطط، أنشئ خطة لبدء حساب العمولات</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2"><Award className="size-4" /> تقرير العمولات</CardTitle>
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
            <Button variant="outline" size="sm" onClick={() => refetch()}>تحديث</Button>
            {canManageFinance && <PostCommissionsButton from={from} to={to} onPosted={() => refetch()} />}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>المندوب</TableHead><TableHead>الفواتير</TableHead><TableHead>صافي الإيراد</TableHead><TableHead>الخطة</TableHead><TableHead>العمولة</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {report?.rows?.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.repName}</TableCell>
                  <TableCell className="tabular-nums">{r.invoiceCount}</TableCell>
                  <TableCell className="tabular-nums"><Money value={r.netRevenue} /></TableCell>
                  <TableCell>{r.planName ?? "—"}</TableCell>
                  <TableCell className="tabular-nums font-bold"><Money value={r.commission} /></TableCell>
                </TableRow>
              ))}
              {(!report || report.rows.length === 0) && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground h-20">لا توجد بيانات في الفترة المحددة</TableCell></TableRow>}
            </TableBody>
            {report && report.rows.length > 0 && (
              <tfoot><tr className="border-t font-bold"><td className="p-3" colSpan={4}>إجمالي العمولات</td><td className="p-3 tabular-nums"><Money value={report.total} /></td></tr></tfoot>
            )}
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ===== AR Aging =====
function ArAgingTab() {
  const { data, isLoading } = useApiQuery<ArAging>("/sales/reports/ar-aging");
  return (
    <Card>
      <CardHeader>
        <CardTitle>تقادم الذمم المدينة</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <Skeleton className="h-32" /> : data ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5 mb-4">
              <BucketCard label="ضمن المهلة" value={data.buckets.current} />
              <BucketCard label="1-30 يوم" value={data.buckets.d30} />
              <BucketCard label="31-60 يوم" value={data.buckets.d60} />
              <BucketCard label="61-90 يوم" value={data.buckets.d90} tone="warning" />
              <BucketCard label="فوق 90 يوم" value={data.buckets.over90} tone="danger" />
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>العميل</TableHead><TableHead>ضمن</TableHead><TableHead>1-30</TableHead>
                  <TableHead>31-60</TableHead><TableHead>61-90</TableHead><TableHead>+90</TableHead><TableHead>الإجمالي</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.customers.map((c) => (
                  <TableRow key={c.customerId}>
                    <TableCell>{c.customerName}</TableCell>
                    <TableCell><Money value={c.current} /></TableCell>
                    <TableCell><Money value={c.d30} /></TableCell>
                    <TableCell><Money value={c.d60} /></TableCell>
                    <TableCell className="text-amber-600"><Money value={c.d90} /></TableCell>
                    <TableCell className="text-destructive"><Money value={c.over90} /></TableCell>
                    <TableCell className="font-bold"><Money value={c.total} /></TableCell>
                  </TableRow>
                ))}
                {data.customers.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground h-16">لا توجد ذمم قائمة</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ===== Period-driven sales reports =====
// All three (by-rep / by-customer / by-product) hit the same shape of
// /sales/reports/* endpoints with a shared from/to range. Default to the
// month-to-date so the user sees something meaningful on first load.
function usePeriod() {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(first.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));
  return { from, to, setFrom, setTo };
}

function PeriodControls({ from, to, setFrom, setTo }: { from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3 mb-4">
      <div><Label className="text-xs">من</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
      <div><Label className="text-xs">إلى</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
    </div>
  );
}

type ByRepRow = { repId: number | null; repName: string; invoices: number; revenue: number; collected: number };
function SalesByRepTab() {
  const { from, to, setFrom, setTo } = usePeriod();
  const { data, isLoading } = useApiQuery<ByRepRow[]>(`/sales/reports/by-rep?from=${from}&to=${to}`);
  const totalRev = (data ?? []).reduce((a, r) => a + Number(r.revenue), 0);
  const totalCol = (data ?? []).reduce((a, r) => a + Number(r.collected), 0);
  return (
    <Card>
      <CardHeader><CardTitle>المبيعات حسب المندوب</CardTitle></CardHeader>
      <CardContent>
        <PeriodControls from={from} to={to} setFrom={setFrom} setTo={setTo} />
        {isLoading ? <Skeleton className="h-32" /> : (
          <Table>
            <TableHeader><TableRow><TableHead>المندوب</TableHead><TableHead>عدد الفواتير</TableHead><TableHead>الإيراد</TableHead><TableHead>المُحصّل</TableHead><TableHead>نسبة التحصيل</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data ?? []).map((r) => (
                <TableRow key={r.repId ?? "none"}>
                  <TableCell>{r.repName}</TableCell>
                  <TableCell className="tabular-nums">{r.invoices}</TableCell>
                  <TableCell className="tabular-nums"><Money value={r.revenue} /></TableCell>
                  <TableCell className="tabular-nums"><Money value={r.collected} /></TableCell>
                  <TableCell className="tabular-nums">{r.revenue > 0 ? `${((r.collected / r.revenue) * 100).toFixed(1)}%` : "—"}</TableCell>
                </TableRow>
              ))}
              {(!data || data.length === 0) && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground h-16">لا توجد بيانات</TableCell></TableRow>}
            </TableBody>
            {data && data.length > 0 && (
              <tfoot><tr className="border-t font-bold"><td className="p-3" colSpan={2}>الإجمالي</td><td className="p-3"><Money value={totalRev} /></td><td className="p-3"><Money value={totalCol} /></td><td className="p-3">{totalRev > 0 ? `${((totalCol / totalRev) * 100).toFixed(1)}%` : "—"}</td></tr></tfoot>
            )}
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

type ByCustomerRow = { customerId: number; customerName: string; invoices: number; revenue: number; collected: number; outstanding: number };
function SalesByCustomerTab() {
  const { from, to, setFrom, setTo } = usePeriod();
  const { data, isLoading } = useApiQuery<ByCustomerRow[]>(`/sales/reports/by-customer?from=${from}&to=${to}&limit=100`);
  return (
    <Card>
      <CardHeader><CardTitle>أعلى العملاء — المبيعات حسب العميل</CardTitle></CardHeader>
      <CardContent>
        <PeriodControls from={from} to={to} setFrom={setFrom} setTo={setTo} />
        {isLoading ? <Skeleton className="h-32" /> : (
          <Table>
            <TableHeader><TableRow><TableHead>العميل</TableHead><TableHead>عدد الفواتير</TableHead><TableHead>الإيراد</TableHead><TableHead>المُحصّل</TableHead><TableHead>المتبقي</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data ?? []).map((r) => (
                <TableRow key={r.customerId}>
                  <TableCell>{r.customerName}</TableCell>
                  <TableCell className="tabular-nums">{r.invoices}</TableCell>
                  <TableCell className="tabular-nums"><Money value={r.revenue} /></TableCell>
                  <TableCell className="tabular-nums"><Money value={r.collected} /></TableCell>
                  <TableCell className="tabular-nums text-amber-700"><Money value={r.outstanding} /></TableCell>
                </TableRow>
              ))}
              {(!data || data.length === 0) && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground h-16">لا توجد بيانات</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

type ByProductRow = { productId: number | null; description: string; quantity: number; revenue: number; invoices: number };
function SalesByProductTab() {
  const { from, to, setFrom, setTo } = usePeriod();
  const { data, isLoading } = useApiQuery<ByProductRow[]>(`/sales/reports/by-product?from=${from}&to=${to}&limit=100`);
  return (
    <Card>
      <CardHeader><CardTitle>المبيعات حسب المنتج</CardTitle></CardHeader>
      <CardContent>
        <PeriodControls from={from} to={to} setFrom={setFrom} setTo={setTo} />
        {isLoading ? <Skeleton className="h-32" /> : (
          <Table>
            <TableHeader><TableRow><TableHead>المنتج / الوصف</TableHead><TableHead>الكمية</TableHead><TableHead>الإيراد</TableHead><TableHead>عدد الفواتير</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data ?? []).map((r, i) => (
                <TableRow key={r.productId ?? `d-${i}`}>
                  <TableCell>{r.description}</TableCell>
                  <TableCell className="tabular-nums">{Number(r.quantity).toLocaleString("ar-SA")}</TableCell>
                  <TableCell className="tabular-nums"><Money value={r.revenue} /></TableCell>
                  <TableCell className="tabular-nums">{r.invoices}</TableCell>
                </TableRow>
              ))}
              {(!data || data.length === 0) && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground h-16">لا توجد بيانات</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function BucketCard({ label, value, tone }: { label: string; value: number; tone?: "warning" | "danger" }) {
  return (
    <Card className={tone === "danger" ? "border-destructive/40" : tone === "warning" ? "border-amber-500/40" : ""}>
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-bold tabular-nums"><Money value={value} /></div>
      </CardContent>
    </Card>
  );
}

// ===== Shared dialogs =====
function DocumentFormDialog({
  kind,
  onSuccess,
}: {
  kind: "quotation" | "order" | "invoice";
  onSuccess: () => void;
}) {
  const { data: customers } = useListCustomers({});
  const { data: products } = useListProducts({});
  const { toast } = useToast();
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [lines, setLines] = useState<Array<{ productId: number | null; description: string; quantity: number; unitPrice: number; discountPct: number; taxRate: number }>>([
    { productId: null, description: "", quantity: 1, unitPrice: 0, discountPct: 0, taxRate: 15 },
  ]);
  const total = useMemo(() => lines.reduce((a, l) => a + (l.quantity * l.unitPrice * (1 - l.discountPct / 100) * (1 + l.taxRate / 100)), 0), [lines]);

  const submit = async () => {
    if (!customerId) { toast({ title: "اختر العميل", variant: "destructive" }); return; }
    const cleanLines = lines.filter((l) => l.description && l.quantity > 0);
    if (cleanLines.length === 0) { toast({ title: "أضف بنوداً", variant: "destructive" }); return; }
    try {
      const path = kind === "quotation" ? "/sales/quotations" : kind === "order" ? "/sales/orders" : "/sales/invoices";
      const body: { customerId: number; lines: typeof cleanLines; notes: string; validUntil?: string } = { customerId, lines: cleanLines, notes };
      if (kind === "quotation" && validUntil) body.validUntil = validUntil;
      await apiPost(path, body);
      toast({ title: kind === "quotation" ? "تم إنشاء عرض السعر" : kind === "order" ? "تم إنشاء أمر البيع" : "تم إنشاء الفاتورة" });
      onSuccess();
    } catch (e) {
      toast({ title: "خطأ", description: errMsg(e), variant: "destructive" });
    }
  };

  return (
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          {kind === "quotation" ? "عرض سعر جديد" : kind === "order" ? "أمر بيع جديد" : "فاتورة عميل جديدة"}
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>العميل</Label>
            <Select value={customerId?.toString() ?? ""} onValueChange={(v) => setCustomerId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="اختر العميل" /></SelectTrigger>
              <SelectContent>
                {customers?.map((c) => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {kind === "quotation" && (
            <div>
              <Label>ساري حتى</Label>
              <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>البنود</Label>
            <Button size="sm" variant="outline" onClick={() => setLines([...lines, { productId: null, description: "", quantity: 1, unitPrice: 0, discountPct: 0, taxRate: 15 }])}>
              <Plus className="size-3" /> سطر
            </Button>
          </div>
          <div className="space-y-2">
            {lines.map((ln, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4">
                  <Select value={ln.productId?.toString() ?? ""} onValueChange={(v) => {
                    const p = products?.find((x) => x.id === Number(v));
                    const next = [...lines];
                    next[i] = { ...next[i], productId: Number(v), description: p?.nameAr ?? "", unitPrice: p?.price ?? 0 };
                    setLines(next);
                  }}>
                    <SelectTrigger className="text-sm"><SelectValue placeholder="منتج" /></SelectTrigger>
                    <SelectContent>{products?.map((p) => <SelectItem key={p.id} value={p.id.toString()}>{p.nameAr}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2"><Input type="number" min="0" step="0.01" placeholder="الكمية" value={ln.quantity} onChange={(e) => { const next = [...lines]; next[i].quantity = Number(e.target.value); setLines(next); }} /></div>
                <div className="col-span-2"><Input type="number" min="0" step="0.01" placeholder="السعر" value={ln.unitPrice} onChange={(e) => { const next = [...lines]; next[i].unitPrice = Number(e.target.value); setLines(next); }} /></div>
                <div className="col-span-2"><Input type="number" min="0" max="100" step="0.01" placeholder="خصم %" value={ln.discountPct} onChange={(e) => { const next = [...lines]; next[i].discountPct = Number(e.target.value); setLines(next); }} /></div>
                <div className="col-span-1 tabular-nums text-sm">
                  <Money value={+(ln.quantity * ln.unitPrice * (1 - ln.discountPct / 100)).toFixed(2)} />
                </div>
                <div className="col-span-1"><Button size="sm" variant="ghost" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>×</Button></div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <Label>ملاحظات</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
        <div className="text-end font-bold">الإجمالي مع الضريبة: <Money value={+total.toFixed(2)} /></div>
      </div>
      <DialogFooter>
        <Button onClick={submit}>حفظ</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function ReceiptFormDialog({ onSuccess }: { onSuccess: () => void }) {
  const { data: customers } = useListCustomers({});
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [amount, setAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const { data: invoices } = useApiQuery<Invoice[]>(customerId ? `/sales/invoices?customerId=${customerId}&status=open` : "/sales/invoices");
  const { data: invoicesPart } = useApiQuery<Invoice[]>(customerId ? `/sales/invoices?customerId=${customerId}&status=partially_paid` : "/sales/invoices");
  const { toast } = useToast();
  const [allocations, setAllocations] = useState<Record<number, number>>({});
  const eligible = customerId ? [...(invoices ?? []), ...(invoicesPart ?? [])] : [];

  const submit = async () => {
    if (!customerId || amount <= 0) { toast({ title: "بيانات ناقصة", variant: "destructive" }); return; }
    const allocs = Object.entries(allocations)
      .map(([invoiceId, amt]) => ({ invoiceId: Number(invoiceId), amount: Number(amt) }))
      .filter((a) => a.amount > 0);
    if (allocs.length === 0) { toast({ title: "وزّع المبلغ على فاتورة على الأقل", variant: "destructive" }); return; }
    try {
      await apiPost("/sales/receipts", { customerId, amount, paymentMethod, allocations: allocs });
      toast({ title: "تم تسجيل سند القبض" });
      onSuccess();
    } catch (e) {
      toast({ title: "خطأ", description: errMsg(e), variant: "destructive" });
    }
  };

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>سند قبض جديد</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>العميل</Label>
            <Select value={customerId?.toString() ?? ""} onValueChange={(v) => setCustomerId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="اختر" /></SelectTrigger>
              <SelectContent>{customers?.map((c) => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>المبلغ</Label>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          </div>
        </div>
        <div>
          <Label>طريقة الدفع</Label>
          <Select value={paymentMethod} onValueChange={setPaymentMethod}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">نقدي</SelectItem>
              <SelectItem value="bank">تحويل بنكي</SelectItem>
              <SelectItem value="card">بطاقة</SelectItem>
              <SelectItem value="transfer">حوالة</SelectItem>
              <SelectItem value="stc">STC Pay</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {customerId && (
          <div>
            <Label>التوزيع على الفواتير المفتوحة</Label>
            <div className="space-y-1 mt-1">
              {eligible.length === 0 && <p className="text-sm text-muted-foreground">لا توجد فواتير مفتوحة لهذا العميل</p>}
              {eligible.map((inv) => {
                const due = inv.total - inv.amountPaid;
                return (
                  <div key={inv.id} className="grid grid-cols-12 items-center gap-2 text-sm">
                    <span className="col-span-4 font-mono">{inv.reference}</span>
                    <span className="col-span-3 text-muted-foreground">{inv.invoiceDate}</span>
                    <span className="col-span-3 text-end"><Money value={due} /></span>
                    <Input className="col-span-2 text-sm" type="number" min="0" max={due} step="0.01"
                      value={allocations[inv.id] ?? ""} onChange={(e) => setAllocations({ ...allocations, [inv.id]: Number(e.target.value) })} />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <DialogFooter><Button onClick={submit}>حفظ السند</Button></DialogFooter>
    </DialogContent>
  );
}

function CreditNoteFormDialog({ onSuccess }: { onSuccess: () => void }) {
  const { data: customers } = useListCustomers({});
  const { data: products } = useListProducts({});
  const [customerId, setCustomerId] = useState<string>("");
  const [invoiceId, setInvoiceId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [lines, setLines] = useState<Array<{ productId: string; description: string; quantity: number; unitPrice: number; taxRate: number; invoiceLineId?: string }>>(
    [{ productId: "", description: "", quantity: 1, unitPrice: 0, taxRate: 15 }],
  );
  const { data: invoices } = useApiQuery<Array<{ id: number; reference: string; customerId: number; total: number }>>(
    customerId ? `/sales/invoices?customerId=${customerId}` : "/sales/invoices",
    { enabled: !!customerId },
  );
  const { data: invoiceDetail } = useApiQuery<{ id: number; lines: Array<{ id: number; productId: number | null; description: string; quantity: number; unitPrice: number; taxRate: number }> }>(
    invoiceId ? `/sales/invoices/${invoiceId}` : "/sales/invoices",
    { enabled: !!invoiceId },
  );
  const { toast } = useToast();
  const updateLine = (i: number, patch: Partial<typeof lines[number]>) =>
    setLines((arr) => arr.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const submit = async () => {
    if (!customerId || lines.length === 0) {
      toast({ title: "أكمل البيانات", variant: "destructive" });
      return;
    }
    try {
      await apiPost("/sales/credit-notes", {
        customerId: Number(customerId),
        invoiceId: invoiceId ? Number(invoiceId) : null,
        reason: reason || null,
        restock,
        lines: lines.map((l) => ({
          productId: l.productId ? Number(l.productId) : null,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          taxRate: l.taxRate,
          invoiceLineId: l.invoiceLineId ? Number(l.invoiceLineId) : null,
        })),
      });
      toast({ title: "تم إنشاء الإشعار الدائن" });
      onSuccess();
    } catch (e) {
      toast({ title: "خطأ", description: errMsg(e), variant: "destructive" });
    }
  };
  return (
    <DialogContent className="max-w-3xl">
      <DialogHeader><DialogTitle>إشعار دائن جديد</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>العميل</Label>
            <Select value={customerId} onValueChange={(v) => { setCustomerId(v); setInvoiceId(""); }}>
              <SelectTrigger><SelectValue placeholder="اختر عميلاً" /></SelectTrigger>
              <SelectContent>{customers?.map((c: CustomerLite) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>الفاتورة المرجعية (اختياري)</Label>
            <Select value={invoiceId} onValueChange={setInvoiceId}>
              <SelectTrigger><SelectValue placeholder="بدون فاتورة" /></SelectTrigger>
              <SelectContent>{invoices?.map((iv) => <SelectItem key={iv.id} value={String(iv.id)}>{iv.reference}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div><Label>السبب</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مردود/خصم/خطأ سعر" /></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> إعادة المخزون</label>
        {invoiceDetail?.lines && invoiceDetail.lines.length > 0 && (
          <div className="text-xs text-muted-foreground">
            ربط بنود الفاتورة:&nbsp;
            {invoiceDetail.lines.map((il) => (
              <Button key={il.id} type="button" size="sm" variant="outline" className="mx-1"
                onClick={() => setLines((arr) => [...arr, {
                  productId: il.productId ? String(il.productId) : "",
                  description: il.description,
                  quantity: Number(il.quantity),
                  unitPrice: Number(il.unitPrice),
                  taxRate: Number(il.taxRate),
                  invoiceLineId: String(il.id),
                }])}>{il.description.slice(0, 20)}</Button>
            ))}
          </div>
        )}
        <div className="space-y-2">
          {lines.map((ln, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-3">
                <Label className="text-xs">الصنف</Label>
                <Select value={ln.productId} onValueChange={(v) => updateLine(i, { productId: v })}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{products?.map((p: ProductLite) => <SelectItem key={p.id} value={String(p.id)}>{p.nameAr ?? p.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-4"><Label className="text-xs">الوصف</Label><Input value={ln.description} onChange={(e) => updateLine(i, { description: e.target.value })} /></div>
              <div className="col-span-1"><Label className="text-xs">الكمية</Label><Input type="number" value={ln.quantity} onChange={(e) => updateLine(i, { quantity: +e.target.value })} /></div>
              <div className="col-span-2"><Label className="text-xs">السعر</Label><Input type="number" value={ln.unitPrice} onChange={(e) => updateLine(i, { unitPrice: +e.target.value })} /></div>
              <div className="col-span-1"><Label className="text-xs">ض %</Label><Input type="number" value={ln.taxRate} onChange={(e) => updateLine(i, { taxRate: +e.target.value })} /></div>
              <div className="col-span-1"><Button type="button" variant="ghost" size="sm" onClick={() => setLines((arr) => arr.filter((_, idx) => idx !== i))}>×</Button></div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((arr) => [...arr, { productId: "", description: "", quantity: 1, unitPrice: 0, taxRate: 15 }])}>
            <Plus className="size-4" /> بند
          </Button>
        </div>
      </div>
      <DialogFooter><Button onClick={submit}>حفظ وترحيل</Button></DialogFooter>
    </DialogContent>
  );
}

function CommissionAssignDialog({ planId, onSuccess }: { planId: number; onSuccess: () => void }) {
  const [userId, setUserId] = useState<number>(0);
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState("");
  const { toast } = useToast();
  const submit = async () => {
    if (!userId) { toast({ title: "أدخل معرّف المندوب", variant: "destructive" }); return; }
    try {
      await apiPost(`/sales/commission-plans/${planId}/assign`, {
        userId, effectiveFrom: from, effectiveTo: to || null,
      });
      toast({ title: "تم التعيين" });
      onSuccess();
    } catch (e) { toast({ title: "خطأ", description: errMsg(e), variant: "destructive" }); }
  };
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>تعيين الخطة لمندوب</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>معرّف المستخدم (User ID)</Label><Input type="number" value={userId || ""} onChange={(e) => setUserId(+e.target.value)} /></div>
        <div><Label>من تاريخ</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div><Label>إلى تاريخ (اختياري)</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>
      <DialogFooter><Button onClick={submit}>تعيين</Button></DialogFooter>
    </DialogContent>
  );
}

function PricelistFormDialog({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [segment, setSegment] = useState("retail");
  const { toast } = useToast();
  const submit = async () => {
    if (!name || !nameAr) return;
    try {
      await apiPost("/sales/pricelists", { name, nameAr, segment });
      toast({ title: "تم إنشاء القائمة" });
      onSuccess();
    } catch (e) {
      toast({ title: "خطأ", description: errMsg(e), variant: "destructive" });
    }
  };
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>قائمة أسعار جديدة</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>الاسم بالعربية</Label><Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} /></div>
        <div><Label>Name (English)</Label><Input value={name} onChange={(e) => setName(e.target.value)} dir="ltr" /></div>
        <div>
          <Label>الفئة</Label>
          <Select value={segment} onValueChange={setSegment}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="retail">تجزئة</SelectItem>
              <SelectItem value="wholesale">جملة</SelectItem>
              <SelectItem value="vip">VIP</SelectItem>
              <SelectItem value="distributor">موزع</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter><Button onClick={submit}>حفظ</Button></DialogFooter>
    </DialogContent>
  );
}

function CommissionPlanRow({ plan }: { plan: { id: number; name: string; rate: number; quota: number; bonusRate: number; isActive: boolean } }) {
  const [open, setOpen] = useState(false);
  return (
    <TableRow>
      <TableCell className="font-medium">{plan.name}</TableCell>
      <TableCell className="tabular-nums">{plan.rate}%</TableCell>
      <TableCell className="tabular-nums"><Money value={plan.quota} /></TableCell>
      <TableCell className="tabular-nums">{plan.bonusRate}%</TableCell>
      <TableCell>{plan.isActive ? <Badge>نشطة</Badge> : <Badge variant="outline">معطلة</Badge>}</TableCell>
      <TableCell>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm" variant="outline">تعيين مندوب</Button></DialogTrigger>
          <CommissionAssignDialog planId={plan.id} onSuccess={() => setOpen(false)} />
        </Dialog>
      </TableCell>
    </TableRow>
  );
}

function PostCommissionsButton({ from, to, onPosted }: { from: string; to: string; onPosted: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const post = async () => {
    if (!confirm(`ترحيل عمولات الفترة ${from} → ${to}؟`)) return;
    setBusy(true);
    try {
      const r = await apiPost<{ total: number; posted: boolean; alreadyPosted?: boolean; breakdown: Array<{ repId: number | null; commission: number }> }>(
        "/sales/commissions/post", { from, to },
      );
      if (r.alreadyPosted) toast({ title: "سبق ترحيل هذه الفترة", description: `الإجمالي: ${r.total.toFixed(2)}` });
      else if (!r.posted) toast({ title: "لا توجد عمولات للترحيل" });
      else toast({ title: "تم الترحيل", description: `إجمالي العمولات: ${r.total.toFixed(2)}` });
      onPosted();
    } catch (e) {
      toast({ title: "تعذّر الترحيل", description: errMsg(e), variant: "destructive" });
    } finally { setBusy(false); }
  };
  return <Button size="sm" onClick={post} disabled={busy}>ترحيل عمولات الفترة</Button>;
}

function CommissionPlanDialog({ onSuccess }: { onSuccess: () => void }) {
  const [name, setName] = useState("");
  const [rate, setRate] = useState(2);
  const [quota, setQuota] = useState(0);
  const [bonusRate, setBonusRate] = useState(0);
  const { toast } = useToast();
  const submit = async () => {
    try {
      await apiPost("/sales/commission-plans", { name, rate, quota, bonusRate });
      toast({ title: "تم إنشاء الخطة" });
      onSuccess();
    } catch (e) {
      toast({ title: "خطأ", description: errMsg(e), variant: "destructive" });
    }
  };
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>خطة عمولة جديدة</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>الاسم</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid grid-cols-3 gap-2">
          <div><Label>المعدل %</Label><Input type="number" step="0.1" value={rate} onChange={(e) => setRate(Number(e.target.value))} /></div>
          <div><Label>الحصة</Label><Input type="number" step="100" value={quota} onChange={(e) => setQuota(Number(e.target.value))} /></div>
          <div><Label>مكافأة %</Label><Input type="number" step="0.1" value={bonusRate} onChange={(e) => setBonusRate(Number(e.target.value))} /></div>
        </div>
      </div>
      <DialogFooter><Button onClick={submit}>حفظ</Button></DialogFooter>
    </DialogContent>
  );
}

// ===== Generic doc table =====
interface DocColumn<R> { header: string; cell: (r: R) => React.ReactNode }
function DocTable<R>({
  isLoading, rows, columns, emptyText,
}: { isLoading: boolean; rows: R[] | undefined; columns: DocColumn<R>[]; emptyText: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>{columns.map((c, i) => <TableHead key={i}>{c.header}</TableHead>)}</TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <TableRow key={i}>{columns.map((_, j) => <TableCell key={j}><Skeleton className="h-5 w-24" /></TableCell>)}</TableRow>
          ))
        ) : !rows || rows.length === 0 ? (
          <TableRow><TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">{emptyText}</TableCell></TableRow>
        ) : (
          rows.map((r, i) => (
            <TableRow key={i}>{columns.map((c, j) => <TableCell key={j}>{c.cell(r)}</TableCell>)}</TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
