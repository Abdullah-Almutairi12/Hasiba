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
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { TrendingDown, Plus, AlertTriangle } from "lucide-react";

interface Rule {
  id: number;
  productId: number;
  productName: string;
  sku: string;
  warehouseId: number;
  warehouseName: string;
  minQty: number;
  maxQty: number;
  eoq: number;
  isActive: boolean;
}

interface Suggestion {
  rule_id: number;
  product_id: number;
  product_name: string;
  sku: string;
  warehouse_id: number;
  warehouse_name: string;
  on_hand: number;
  min_qty: number;
  max_qty: number;
  suggested_qty: number;
}

interface Warehouse { id: number; nameAr: string }
interface Product { id: number; nameAr: string; sku: string }

export default function ReorderRulesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [minQty, setMinQty] = useState("0");
  const [maxQty, setMaxQty] = useState("0");
  const [eoq, setEoq] = useState("0");

  const { data: rules = [] } = useQuery<Rule[]>({
    queryKey: ["/inventory/reorder-rules"],
    queryFn: () => apiGet("/inventory/reorder-rules"),
  });
  const { data: suggestions = [] } = useQuery<Suggestion[]>({
    queryKey: ["/inventory/reorder-suggestions"],
    queryFn: () => apiGet("/inventory/reorder-suggestions"),
  });
  const { data: warehouses = [] } = useQuery<Warehouse[]>({
    queryKey: ["/warehouses"],
    queryFn: () => apiGet("/warehouses"),
  });
  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/products"],
    queryFn: () => apiGet("/products"),
  });

  const save = useMutation({
    mutationFn: () =>
      apiPost("/inventory/reorder-rules", {
        productId: Number(productId),
        warehouseId: Number(warehouseId),
        minQty: Number(minQty),
        maxQty: Number(maxQty),
        eoq: Number(eoq),
        isActive: true,
      }),
    onSuccess: () => {
      toast({ title: "تم حفظ القاعدة" });
      qc.invalidateQueries({ queryKey: ["/inventory/reorder-rules"] });
      qc.invalidateQueries({ queryKey: ["/inventory/reorder-suggestions"] });
      setOpen(false);
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">قواعد إعادة الطلب</h1>
          <p className="mt-1 text-muted-foreground">حدّ أدنى وأقصى لكل منتج/مستودع مع اقتراحات شراء تلقائية</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="ms-2 size-4" /> قاعدة جديدة</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-orange-500" /> اقتراحات إعادة الطلب
          </CardTitle>
        </CardHeader>
        <CardContent>
          {suggestions.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">لا توجد منتجات تحت الحد الأدنى حالياً</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>المنتج</TableHead>
                  <TableHead>المستودع</TableHead>
                  <TableHead>المتوفر</TableHead>
                  <TableHead>الحد الأدنى</TableHead>
                  <TableHead>الكمية المقترحة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suggestions.map((s) => (
                  <TableRow key={s.rule_id}>
                    <TableCell>{s.product_name} <span className="text-xs text-muted-foreground">({s.sku})</span></TableCell>
                    <TableCell>{s.warehouse_name}</TableCell>
                    <TableCell><Badge variant="destructive">{s.on_hand}</Badge></TableCell>
                    <TableCell>{s.min_qty}</TableCell>
                    <TableCell className="font-bold">{s.suggested_qty}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><TrendingDown className="size-5" /> القواعد المعرَّفة</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المنتج</TableHead>
                <TableHead>المستودع</TableHead>
                <TableHead>الأدنى</TableHead>
                <TableHead>الأقصى</TableHead>
                <TableHead>كمية الطلب الاقتصادية</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">لا توجد قواعد</TableCell></TableRow>
              ) : rules.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.productName} <span className="text-xs text-muted-foreground">({r.sku})</span></TableCell>
                  <TableCell>{r.warehouseName}</TableCell>
                  <TableCell>{r.minQty}</TableCell>
                  <TableCell>{r.maxQty}</TableCell>
                  <TableCell>{r.eoq}</TableCell>
                  <TableCell><Badge variant={r.isActive ? "default" : "secondary"}>{r.isActive ? "نشطة" : "متوقفة"}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>قاعدة إعادة طلب جديدة</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>المنتج</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder="اختر منتجاً" /></SelectTrigger>
                <SelectContent>
                  {products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.nameAr} — {p.sku}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>المستودع</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger><SelectValue placeholder="اختر مستودعاً" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => <SelectItem key={w.id} value={String(w.id)}>{w.nameAr}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-2"><Label>الحد الأدنى</Label><Input type="number" value={minQty} onChange={(e) => setMinQty(e.target.value)} /></div>
              <div className="grid gap-2"><Label>الحد الأقصى</Label><Input type="number" value={maxQty} onChange={(e) => setMaxQty(e.target.value)} /></div>
              <div className="grid gap-2"><Label>EOQ</Label><Input type="number" value={eoq} onChange={(e) => setEoq(e.target.value)} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={() => save.mutate()} disabled={!productId || !warehouseId || save.isPending}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
