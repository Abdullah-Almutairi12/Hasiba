import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeftRight, Plus, Truck } from "lucide-react";

interface TransferRow {
  id: number;
  productId: number;
  productName: string;
  fromWarehouseId: number | null;
  toWarehouseId: number | null;
  quantity: number;
  state: string;
  sourceRef: string | null;
  occurredAt: string;
}

interface Warehouse {
  id: number;
  nameAr: string;
}

interface Product {
  id: number;
  nameAr: string;
  sku: string;
}

export default function TransfersPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [qty, setQty] = useState<string>("1");
  const [notes, setNotes] = useState("");

  const { data: rows = [] } = useQuery<TransferRow[]>({
    queryKey: ["/inventory/transfers"],
    queryFn: () => apiGet("/inventory/transfers"),
  });
  const { data: warehouses = [] } = useQuery<Warehouse[]>({
    queryKey: ["/warehouses"],
    queryFn: () => apiGet("/warehouses"),
  });
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/products"],
    queryFn: () => apiGet("/products"),
  });

  const create = useMutation({
    mutationFn: () =>
      apiPost("/inventory/transfers", {
        productId: Number(productId),
        fromWarehouseId: Number(from),
        toWarehouseId: Number(to),
        quantity: Number(qty),
        notes,
      }),
    onSuccess: () => {
      toast({ title: "تم إنشاء التحويل" });
      qc.invalidateQueries({ queryKey: ["/inventory/transfers"] });
      setOpen(false);
      setQty("1");
      setNotes("");
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const receive = useMutation({
    mutationFn: (id: number) => apiPost(`/inventory/transfers/${id}/receive`, {}),
    onSuccess: () => {
      toast({ title: "تم استلام التحويل" });
      qc.invalidateQueries({ queryKey: ["/inventory/transfers"] });
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const whName = (id: number | null) =>
    id ? warehouses.find((w) => w.id === id)?.nameAr ?? `#${id}` : "—";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">التحويلات بين المستودعات</h1>
          <p className="mt-1 text-muted-foreground">نقل المخزون بين الفروع والمستودعات مع تتبّع كامل</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="ms-2 size-4" />
          تحويل جديد
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowLeftRight className="size-5" /> سجل التحويلات
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المرجع</TableHead>
                <TableHead>المنتج</TableHead>
                <TableHead>من</TableHead>
                <TableHead>إلى</TableHead>
                <TableHead>الكمية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                    لا توجد تحويلات
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.sourceRef ?? `#${r.id}`}</TableCell>
                    <TableCell>{r.productName}</TableCell>
                    <TableCell>{whName(r.fromWarehouseId)}</TableCell>
                    <TableCell>{whName(r.toWarehouseId)}</TableCell>
                    <TableCell>{r.quantity}</TableCell>
                    <TableCell>
                      <Badge variant={r.state === "done" ? "default" : "secondary"}>
                        {r.state === "in_transit" ? "في الطريق" : r.state === "done" ? "تم الاستلام" : r.state}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {r.state === "in_transit" && (
                        <Button size="sm" variant="outline" onClick={() => receive.mutate(r.id)} disabled={receive.isPending}>
                          <Truck className="ms-1 size-4" /> استلام
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إنشاء تحويل جديد</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>المنتج</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="اختر منتجاً" /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.nameAr} — {p.sku}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>من مستودع</Label>
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger><SelectValue placeholder="المصدر" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.nameAr}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>إلى مستودع</Label>
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger><SelectValue placeholder="الوجهة" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={String(w.id)}>{w.nameAr}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>الكمية</Label>
              <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>ملاحظات</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button
              onClick={() => create.mutate()}
              disabled={!productId || !from || !to || !qty || create.isPending}
            >
              إنشاء
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
