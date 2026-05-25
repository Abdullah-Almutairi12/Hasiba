import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, apiPost, apiPatch, useApiQuery } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Plus, Truck, Pencil, Building2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

interface SupplierRow {
  id: number;
  name: string;
  vatNumber: string | null;
  email: string | null;
  phone: string | null;
  paymentTermsDays: number | null;
  defaultCurrency: string | null;
  balance: number;
  invoicesCount: number;
  createdAt: string;
  /** Phase-5 intercompany linkage; resolved server-side via LEFT JOIN. */
  linkedCompanyId: number | null;
  linkedCompanyName: string | null;
}

interface SupplierFull extends SupplierRow {
  address: string | null;
  notes: string | null;
  leadTimeDays: number | null;
  defaultTax: string | null;
  linkedCompanyId: number | null;
}

type Sibling = { id: number; name: string };

function SupplierForm({
  initial,
  onSaved,
}: {
  initial?: SupplierFull;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [vatNumber, setVatNumber] = useState(initial?.vatNumber ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [paymentTermsDays, setPaymentTermsDays] = useState<number>(
    initial?.paymentTermsDays ?? 0,
  );
  const [defaultCurrency, setDefaultCurrency] = useState(
    initial?.defaultCurrency ?? "SAR",
  );
  const [linkedCompanyId, setLinkedCompanyId] = useState<string>(
    initial?.linkedCompanyId != null ? String(initial.linkedCompanyId) : "none",
  );

  const { data: siblings = [] } = useApiQuery<Sibling[]>("/companies/siblings");

  const submit = async () => {
    if (!name.trim()) {
      toast({ title: "الاسم مطلوب", variant: "destructive" });
      return;
    }
    const payload = {
      name: name.trim(),
      vatNumber: vatNumber || null,
      email: email || null,
      phone: phone || null,
      address: address || null,
      paymentTermsDays,
      defaultCurrency,
      linkedCompanyId: linkedCompanyId === "none" ? null : Number(linkedCompanyId),
    };
    try {
      if (isEdit && initial) {
        await apiPatch(`/suppliers/${initial.id}`, payload);
        toast({ title: "تم تحديث المورد" });
      } else {
        await apiPost("/suppliers", payload);
        toast({ title: "تم إنشاء المورد" });
      }
      onSaved();
    } catch (e) {
      toast({
        title: "خطأ",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{isEdit ? "تعديل المورد" : "مورد جديد"}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <Label>الاسم</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>الهاتف</Label>
            <Input value={phone ?? ""} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label>البريد</Label>
            <Input value={email ?? ""} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>الرقم الضريبي</Label>
            <Input value={vatNumber ?? ""} onChange={(e) => setVatNumber(e.target.value)} />
          </div>
          <div>
            <Label>العملة الافتراضية</Label>
            <Input
              maxLength={3}
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value.toUpperCase())}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>مدة السداد (أيام)</Label>
            <Input
              type="number"
              value={paymentTermsDays}
              onChange={(e) => setPaymentTermsDays(Number(e.target.value))}
            />
          </div>
          <div>
            <Label>العنوان</Label>
            <Input value={address ?? ""} onChange={(e) => setAddress(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>الشركة الشقيقة المرتبطة (اختياري)</Label>
          <Select value={linkedCompanyId} onValueChange={setLinkedCompanyId}>
            <SelectTrigger>
              <SelectValue placeholder="بدون ربط" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">بدون ربط</SelectItem>
              {siblings.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">
            عند الربط، يُنشأ أمر شراء مرآة تلقائياً في الشركة الأخرى.
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button onClick={submit}>حفظ</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export default function Suppliers() {
  const [search, setSearch] = useState("");
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const { data: rows, isLoading, refetch } = useQuery<SupplierRow[]>({
    queryKey: ["/suppliers", search, linkedOnly],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (linkedOnly) params.set("linkedOnly", "1");
      const qs = params.toString();
      return apiGet<SupplierRow[]>(`/suppliers${qs ? `?${qs}` : ""}`);
    },
  });

  const { data: editing } = useQuery<{ supplier: SupplierFull }>({
    queryKey: ["/suppliers", editingId],
    queryFn: () => apiGet(`/suppliers/${editingId}`),
    enabled: editingId !== null,
  });

  return (
    <div className="space-y-6 pb-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">الموردون</h1>
          <p className="text-muted-foreground">
            إدارة بيانات الموردين وربطهم بالشركات الشقيقة
          </p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" data-testid="button-add-supplier">
              <Plus className="size-4" />
              إضافة مورد
            </Button>
          </DialogTrigger>
          <SupplierForm
            onSaved={() => {
              setAddOpen(false);
              refetch();
            }}
          />
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b flex flex-row items-center justify-between gap-3">
          <div className="flex gap-4 flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="ابحث عن مورد بالاسم أو الرقم الضريبي..."
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
              data-testid="switch-suppliers-linked-only"
            />
            مرتبطة بشركة شقيقة فقط
          </label>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>المورد</TableHead>
                <TableHead>الرقم الضريبي</TableHead>
                <TableHead>الهاتف</TableHead>
                <TableHead>البريد</TableHead>
                <TableHead>الشركة المرتبطة</TableHead>
                <TableHead className="text-center">الفواتير</TableHead>
                <TableHead className="text-left">الرصيد</TableHead>
                <TableHead className="text-end">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={8}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : rows?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                    <div className="flex flex-col items-center justify-center">
                      <Truck className="size-8 mb-2 opacity-20" />
                      لا يوجد موردون مطابقون للبحث
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                rows?.map((s) => (
                  <TableRow key={s.id} data-testid={`row-supplier-${s.id}`}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.vatNumber || "—"}
                    </TableCell>
                    <TableCell dir="ltr" className="text-right text-muted-foreground">
                      {s.phone || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.email || "—"}
                    </TableCell>
                    <TableCell>
                      {s.linkedCompanyName ? (
                        <Badge variant="outline" className="gap-1 font-normal">
                          <Building2 className="size-3" />
                          مرتبط بـ {s.linkedCompanyName}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">{s.invoicesCount}</TableCell>
                    <TableCell className="text-left font-bold">
                      {s.balance.toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingId(s.id)}
                        data-testid={`button-edit-supplier-${s.id}`}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={editingId !== null}
        onOpenChange={(v) => {
          if (!v) setEditingId(null);
        }}
      >
        {editing?.supplier && (
          <SupplierForm
            initial={editing.supplier}
            onSaved={() => {
              setEditingId(null);
              refetch();
            }}
          />
        )}
      </Dialog>

    </div>
  );
}
