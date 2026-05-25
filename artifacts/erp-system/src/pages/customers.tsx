import { useState } from "react";
import { Money } from "@/components/riyal";
import {
  useListCustomers,
} from "@workspace/api-client-react";
import { useApiQuery } from "@/hooks/use-api";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, UserCircle, Users, Phone, Mail, FileText, Receipt, Target, Building2, Pencil } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiPost, apiPatch } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";

/**
 * Initial values for {@link CustomerFormDialog} in edit mode. When omitted,
 * the dialog operates as a create form and submits via POST /customers; when
 * provided, it submits via PATCH /customers/:id and only the fields the user
 * actually changes round-trip to the server.
 */
export interface CustomerFormInitial {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  segment: "retail" | "wholesale" | "vip" | "distributor" | null;
  creditLimit: number;
  paymentTermsDays: number | null;
  taxNumber: string | null;
  linkedCompanyId: number | null;
}

/**
 * Customer create/edit dialog. Phase-5 added the "linked sibling company"
 * dropdown to both modes so finance can wire an existing customer to the
 * intercompany mirror without recreating it; the underlying endpoint
 * (PATCH /customers/:id) already accepted `linkedCompanyId`.
 */
function CustomerFormDialog({
  onSuccess,
  initial,
}: {
  onSuccess: () => void;
  initial?: CustomerFormInitial;
}) {
  const { toast } = useToast();
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [segment, setSegment] = useState<"retail" | "wholesale" | "vip" | "distributor">(
    initial?.segment ?? "retail",
  );
  const [creditLimit, setCreditLimit] = useState(initial?.creditLimit ?? 0);
  const [paymentTermsDays, setPaymentTermsDays] = useState(initial?.paymentTermsDays ?? 0);
  const [taxNumber, setTaxNumber] = useState(initial?.taxNumber ?? "");
  const [linkedCompanyId, setLinkedCompanyId] = useState<string>(
    initial?.linkedCompanyId != null ? String(initial.linkedCompanyId) : "none",
  );
  // Sibling companies the current user can mirror to (intercompany).
  // Endpoint is per-user not owner-only, so non-owners see the same list.
  const { data: siblings = [] } = useApiQuery<Array<{ id: number; name: string }>>(
    "/companies/siblings",
  );

  const submit = async () => {
    if (!name.trim()) { toast({ title: "الاسم مطلوب", variant: "destructive" }); return; }
    const payload = {
      name,
      phone: phone || null,
      email: email || null,
      segment,
      creditLimit,
      paymentTermsDays,
      taxNumber: taxNumber || null,
      linkedCompanyId: linkedCompanyId === "none" ? null : Number(linkedCompanyId),
    };
    try {
      if (isEdit && initial) {
        await apiPatch(`/customers/${initial.id}`, payload);
        toast({ title: "تم تحديث العميل" });
      } else {
        await apiPost("/customers", payload);
        toast({ title: "تم إنشاء العميل" });
      }
      onSuccess();
    } catch (e) {
      toast({ title: "خطأ", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{isEdit ? "تعديل العميل" : "عميل جديد"}</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>الاسم</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>الهاتف</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div><Label>البريد</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>الفئة</Label>
            <Select value={segment} onValueChange={(v) => setSegment(v as typeof segment)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="retail">تجزئة</SelectItem>
                <SelectItem value="wholesale">جملة</SelectItem>
                <SelectItem value="vip">VIP</SelectItem>
                <SelectItem value="distributor">موزع</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>الرقم الضريبي</Label><Input value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>سقف الائتمان</Label><Input type="number" value={creditLimit} onChange={(e) => setCreditLimit(Number(e.target.value))} /></div>
          <div><Label>مدة السداد (أيام)</Label><Input type="number" value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(Number(e.target.value))} /></div>
        </div>
        <div>
          <Label>الشركة الشقيقة المرتبطة (اختياري)</Label>
          <Select value={linkedCompanyId} onValueChange={setLinkedCompanyId}>
            <SelectTrigger><SelectValue placeholder="بدون ربط" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">بدون ربط</SelectItem>
              {siblings.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            عند الربط، تُنشأ فاتورة مورد مرآة تلقائياً في الشركة الأخرى.
          </p>
        </div>
      </div>
      <DialogFooter><Button onClick={submit}>حفظ</Button></DialogFooter>
    </DialogContent>
  );
}

type Customer360 = {
  customer: {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    segment: string | null;
    totalSpent: number;
    creditLimit: number;
    paymentTermsDays: number | null;
    taxNumber: string | null;
    linkedCompanyId: number | null;
  };
  summary: {
    // Finance-only fields are nullable: backend returns null for non-finance
    // roles so the UI can hide AR balance / overdue / credit availability
    // without leaking those metrics through Customer 360.
    arBalance: number | null;
    overdue: number | null;
    creditAvailable: number | null;
    invoiceCount: number;
    openOpportunities: number;
    openOrders: number;
  };
  invoices: Array<{ id: number; reference: string; invoiceDate: string; total: number; amountPaid: number; status: string; source: string }>;
  receipts: Array<{ id: number; reference: string; receiptDate: string; amount: number; paymentMethod: string }>;
  quotations: Array<{ id: number; reference: string; quoteDate: string; total: number; status: string }>;
  orders: Array<{ id: number; reference: string; orderDate: string; total: number; status: string }>;
  opportunities: Array<{ id: number; name: string; expectedRevenue: number; stageName: string | null }>;
  canSeeFinance: boolean;
};

const statusBadge: Record<string, string> = {
  paid: "bg-emerald-100 text-emerald-700",
  open: "bg-blue-100 text-blue-700",
  partially_paid: "bg-amber-100 text-amber-700",
  cancelled: "bg-rose-100 text-rose-700",
  draft: "bg-slate-100 text-slate-700",
  sent: "bg-blue-100 text-blue-700",
  accepted: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
};

function Customer360Sheet({
  customerId,
  open,
  onOpenChange,
  onEdit,
}: {
  customerId: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEdit: (initial: CustomerFormInitial) => void;
}) {
  const { data, isLoading } = useApiQuery<Customer360>(
    customerId ? `/customers/${customerId}/360` : "/customers/0/360",
    { enabled: !!customerId && open },
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-3xl overflow-y-auto" dir="rtl">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="text-xl">
              {data?.customer.name ?? "تحميل..."}
            </SheetTitle>
            {data && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const c = data.customer;
                  onEdit({
                    id: c.id,
                    name: c.name,
                    phone: c.phone,
                    email: c.email,
                    segment: (c.segment as CustomerFormInitial["segment"]) ?? null,
                    creditLimit: c.creditLimit,
                    paymentTermsDays: c.paymentTermsDays,
                    taxNumber: c.taxNumber,
                    linkedCompanyId: c.linkedCompanyId,
                  });
                }}
                data-testid="button-edit-customer"
              >
                <Pencil className="size-4 ml-1" /> تعديل
              </Button>
            )}
          </div>
        </SheetHeader>
        {isLoading || !data ? (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 text-sm">
              {data.customer.phone && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="size-4" /> <span dir="ltr">{data.customer.phone}</span>
                </div>
              )}
              {data.customer.email && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="size-4" /> <span dir="ltr">{data.customer.email}</span>
                </div>
              )}
              {data.customer.segment && (
                <Badge variant="outline">{data.customer.segment}</Badge>
              )}
            </div>

            <div className={`grid grid-cols-2 gap-3 ${data.canSeeFinance ? "md:grid-cols-4" : "md:grid-cols-2"}`}>
              <Card><CardContent className="p-3">
                <p className="text-[11px] text-muted-foreground">إجمالي الإنفاق</p>
                <p className="mt-1 font-bold"><Money value={data.customer.totalSpent} /></p>
              </CardContent></Card>
              {data.canSeeFinance && data.summary.arBalance != null && (
                <Card><CardContent className="p-3">
                  <p className="text-[11px] text-muted-foreground">رصيد مستحق</p>
                  <p className="mt-1 font-bold text-amber-700"><Money value={data.summary.arBalance} /></p>
                </CardContent></Card>
              )}
              {data.canSeeFinance && data.summary.overdue != null && (
                <Card><CardContent className="p-3">
                  <p className="text-[11px] text-muted-foreground">متأخر</p>
                  <p className="mt-1 font-bold text-rose-700"><Money value={data.summary.overdue} /></p>
                </CardContent></Card>
              )}
              <Card><CardContent className="p-3">
                <p className="text-[11px] text-muted-foreground">عدد الفواتير</p>
                <p className="mt-1 font-bold">{data.summary.invoiceCount}</p>
              </CardContent></Card>
            </div>

            <Tabs defaultValue="invoices">
              <TabsList className={`grid w-full ${data.canSeeFinance ? "grid-cols-5" : "grid-cols-4"}`}>
                <TabsTrigger value="invoices"><FileText className="size-4 ml-1" />فواتير</TabsTrigger>
                {data.canSeeFinance && (
                  <TabsTrigger value="receipts"><Receipt className="size-4 ml-1" />سدادات</TabsTrigger>
                )}
                <TabsTrigger value="orders">أوامر</TabsTrigger>
                <TabsTrigger value="quotations">عروض</TabsTrigger>
                <TabsTrigger value="opps"><Target className="size-4 ml-1" />فرص</TabsTrigger>
              </TabsList>

              <TabsContent value="invoices">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>المرجع</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead className="text-left">الإجمالي</TableHead>
                    <TableHead className="text-left">المدفوع</TableHead>
                    <TableHead className="text-center">الحالة</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.invoices.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">لا فواتير</TableCell></TableRow>
                    ) : data.invoices.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="font-mono text-xs">{i.reference}</TableCell>
                        <TableCell className="text-xs">{i.invoiceDate}</TableCell>
                        <TableCell className="text-left"><Money value={i.total} /></TableCell>
                        <TableCell className="text-left"><Money value={i.amountPaid} /></TableCell>
                        <TableCell className="text-center">
                          <Badge className={statusBadge[i.status] ?? ""}>{i.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="receipts" className={data.canSeeFinance ? "" : "hidden"}>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>المرجع</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead className="text-left">المبلغ</TableHead>
                    <TableHead>الطريقة</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.receipts.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">لا سدادات</TableCell></TableRow>
                    ) : data.receipts.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs">{r.reference}</TableCell>
                        <TableCell className="text-xs">{r.receiptDate}</TableCell>
                        <TableCell className="text-left"><Money value={r.amount} /></TableCell>
                        <TableCell>{r.paymentMethod}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="orders">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>المرجع</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead className="text-left">الإجمالي</TableHead>
                    <TableHead className="text-center">الحالة</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.orders.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">لا أوامر</TableCell></TableRow>
                    ) : data.orders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell className="font-mono text-xs">{o.reference}</TableCell>
                        <TableCell className="text-xs">{o.orderDate}</TableCell>
                        <TableCell className="text-left"><Money value={o.total} /></TableCell>
                        <TableCell className="text-center"><Badge className={statusBadge[o.status] ?? ""}>{o.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="quotations">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>المرجع</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead className="text-left">الإجمالي</TableHead>
                    <TableHead className="text-center">الحالة</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.quotations.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">لا عروض</TableCell></TableRow>
                    ) : data.quotations.map((q) => (
                      <TableRow key={q.id}>
                        <TableCell className="font-mono text-xs">{q.reference}</TableCell>
                        <TableCell className="text-xs">{q.quoteDate}</TableCell>
                        <TableCell className="text-left"><Money value={q.total} /></TableCell>
                        <TableCell className="text-center"><Badge className={statusBadge[q.status] ?? ""}>{q.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>

              <TabsContent value="opps">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>الفرصة</TableHead>
                    <TableHead>المرحلة</TableHead>
                    <TableHead className="text-left">الإيراد المتوقع</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.opportunities.length === 0 ? (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">لا فرص</TableCell></TableRow>
                    ) : data.opportunities.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell>{o.name}</TableCell>
                        <TableCell><Badge variant="outline">{o.stageName}</Badge></TableCell>
                        <TableCell className="text-left"><Money value={o.expectedRevenue} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function Customers() {
  const [search, setSearch] = useState("");
  const [linkedOnly, setLinkedOnly] = useState(false);
  const { data: customers, isLoading, refetch } = useListCustomers({
    search: search || undefined,
    // Phase-5 filter: narrow the list to customers wired to a sibling company.
    // Coerced to "1"/undefined because the orval-generated query param is string.
    ...(linkedOnly ? { linkedOnly: "1" } : {}),
  } as Parameters<typeof useListCustomers>[0]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // Phase-6: edit dialog seeded from the Customer 360 sheet so finance can
  // change the linked sibling company (or any other field) without recreating
  // the customer. Kept as a separate state slice from the create dialog so
  // both can coexist if the user re-opens the sheet after closing the editor.
  const [editInitial, setEditInitial] = useState<CustomerFormInitial | null>(null);

  return (
    <div className="space-y-6 pb-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">العملاء</h1>
          <p className="text-muted-foreground">إدارة بيانات العملاء وتتبع سجلات الشراء</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" data-testid="button-add-customer">
              <Plus className="size-4" />
              إضافة عميل
            </Button>
          </DialogTrigger>
          <CustomerFormDialog onSuccess={() => { setAddOpen(false); refetch(); }} />
        </Dialog>
      </div>

      <Dialog open={!!editInitial} onOpenChange={(v) => { if (!v) setEditInitial(null); }}>
        {editInitial && (
          <CustomerFormDialog
            initial={editInitial}
            onSuccess={() => { setEditInitial(null); refetch(); }}
          />
        )}
      </Dialog>

      <Card>
        <CardHeader className="pb-3 border-b flex flex-row items-center justify-between gap-3">
          <div className="flex gap-4 flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="ابحث عن عميل بالاسم أو الهاتف..."
                className="pl-4 pr-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <Switch
              checked={linkedOnly}
              onCheckedChange={setLinkedOnly}
              data-testid="switch-customers-linked-only"
            />
            مرتبطة بشركة شقيقة فقط
          </label>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>العميل</TableHead>
                <TableHead>رقم الهاتف</TableHead>
                <TableHead>البريد الإلكتروني</TableHead>
                <TableHead>الشركة المرتبطة</TableHead>
                <TableHead className="text-center">إجمالي الطلبات</TableHead>
                <TableHead className="text-left">إجمالي الإنفاق</TableHead>
                <TableHead className="text-left">تاريخ الانضمام</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-5 w-12 mx-auto" /></TableCell>
                    <TableCell className="text-left"><Skeleton className="h-5 w-24 ml-auto" /></TableCell>
                    <TableCell className="text-left"><Skeleton className="h-5 w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : customers?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center">
                      <Users className="size-8 mb-2 opacity-20" />
                      لا يوجد عملاء مطابقين للبحث
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                customers?.map((customer) => (
                  <TableRow
                    key={customer.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => setSelectedId(customer.id)}
                    data-testid={`row-customer-${customer.id}`}
                  >
                    <TableCell className="font-medium flex items-center gap-3">
                      <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        <UserCircle className="size-5" />
                      </div>
                      {customer.name}
                    </TableCell>
                    <TableCell dir="ltr" className="text-right text-muted-foreground">{customer.phone || '---'}</TableCell>
                    <TableCell className="text-muted-foreground">{customer.email || '---'}</TableCell>
                    <TableCell>
                      {customer.linkedCompanyName ? (
                        <Badge variant="outline" className="gap-1 font-normal">
                          <Building2 className="size-3" />
                          مرتبط بـ {customer.linkedCompanyName}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-bold">{customer.totalOrders}</TableCell>
                    <TableCell className="text-left font-bold text-primary">
                      <Money value={customer.totalSpent} />
                    </TableCell>
                    <TableCell className="text-left text-sm text-muted-foreground">
                      {format(new Date(customer.createdAt), 'dd MMM yyyy', { locale: arSA })}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Customer360Sheet
        customerId={selectedId}
        open={selectedId !== null}
        onOpenChange={(v) => { if (!v) setSelectedId(null); }}
        onEdit={(init) => { setSelectedId(null); setEditInitial(init); }}
      />
    </div>
  );
}
