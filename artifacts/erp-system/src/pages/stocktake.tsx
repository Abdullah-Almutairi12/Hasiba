import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ClipboardList, Plus, CheckCircle2 } from "lucide-react";

interface StockTake {
  id: number;
  reference: string;
  warehouseId: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
}

interface StockTakeLine {
  id: number;
  productId: number;
  productName: string;
  sku: string | null;
  expectedQty: number;
  countedQty: number | null;
  unitCost: number;
}

interface Warehouse { id: number; nameAr: string }

export default function StockTakePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [openId, setOpenId] = useState<number | null>(null);

  const { data: takes = [] } = useQuery<StockTake[]>({
    queryKey: ["/inventory/stock-takes"],
    queryFn: () => apiGet("/inventory/stock-takes"),
  });
  const { data: warehouses = [] } = useQuery<Warehouse[]>({
    queryKey: ["/warehouses"],
    queryFn: () => apiGet("/warehouses"),
  });

  const start = useMutation({
    mutationFn: () => apiPost<{ id: number }>("/inventory/stock-takes", { warehouseId: Number(warehouseId) }),
    onSuccess: (data) => {
      toast({ title: "تم بدء جلسة الجرد" });
      qc.invalidateQueries({ queryKey: ["/inventory/stock-takes"] });
      setOpenId(data.id);
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const whName = (id: number) => warehouses.find((w) => w.id === id)?.nameAr ?? `#${id}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">جرد المخزون</h1>
          <p className="mt-1 text-muted-foreground">جلسات جرد دورية مع تعديلات تلقائية على الدفاتر</p>
        </div>
        <Link href="/inventory-revaluations" className="text-sm text-primary hover:underline" data-testid="link-revaluations">إعادة تقييم المخزون</Link>
      </div>

      <Card>
        <CardHeader><CardTitle>بدء جلسة جرد جديدة</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-2">
              <Label>المستودع</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger className="w-64"><SelectValue placeholder="اختر مستودعاً" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => <SelectItem key={w.id} value={String(w.id)}>{w.nameAr}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => start.mutate()} disabled={!warehouseId || start.isPending}>
              <Plus className="ms-2 size-4" /> بدء الجرد
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="size-5" /> جلسات الجرد</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المرجع</TableHead>
                <TableHead>المستودع</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>بدأت في</TableHead>
                <TableHead>إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {takes.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">لا توجد جلسات</TableCell></TableRow>
              ) : takes.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                  <TableCell>{whName(t.warehouseId)}</TableCell>
                  <TableCell>
                    <Badge variant={t.status === "done" ? "default" : "secondary"}>
                      {t.status === "in_progress" ? "جارٍ" : t.status === "done" ? "مكتمل" : t.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(t.startedAt).toLocaleString("ar-SA")}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => setOpenId(t.id)}>فتح</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {openId && <StockTakeDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function StockTakeDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [barcode, setBarcode] = useState("");
  const { data } = useQuery<{ id: number; reference: string; status: string; lines: StockTakeLine[] }>({
    queryKey: [`/inventory/stock-takes/${id}`],
    queryFn: () => apiGet(`/inventory/stock-takes/${id}`),
  });

  const updateLine = useMutation({
    mutationFn: ({ lineId, countedQty }: { lineId: number; countedQty: number }) =>
      fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/inventory/stock-takes/${id}/lines/${lineId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countedQty }),
      }).then((r) => { if (!r.ok) throw new Error("update failed"); return r.json(); }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`/inventory/stock-takes/${id}`] }),
  });

  const scanBarcode = async () => {
    const code = barcode.trim();
    if (!code || !data) return;
    try {
      const lookup = await apiGet<{ productId: number; nameAr: string }>(
        `/inventory/lookup?code=${encodeURIComponent(code)}`,
      );
      const line = data.lines.find((l) => l.productId === lookup.productId);
      if (!line) {
        // Unexpected item — server creates a fresh line (expected=0) so we
        // can record overage without leaving the count as "not in session".
        await apiPost(`/inventory/stock-takes/${id}/lines`, {
          productId: lookup.productId,
          countedQty: 1,
        });
        qc.invalidateQueries({ queryKey: [`/inventory/stock-takes/${id}`] });
        toast({ title: "تم إضافة عنصر غير متوقع", description: lookup.nameAr });
      } else {
        const next = (line.countedQty ?? 0) + 1;
        updateLine.mutate({ lineId: line.id, countedQty: next });
        toast({ title: "تم العد", description: `${lookup.nameAr} → ${next}` });
      }
    } catch {
      toast({ title: "باركود غير معروف", description: code, variant: "destructive" });
    }
    setBarcode("");
  };

  const complete = useMutation({
    mutationFn: () => apiPost(`/inventory/stock-takes/${id}/complete`, {}),
    onSuccess: () => {
      toast({ title: "تم إقفال الجرد وتسجيل التعديلات" });
      qc.invalidateQueries({ queryKey: [`/inventory/stock-takes/${id}`] });
      qc.invalidateQueries({ queryKey: ["/inventory/stock-takes"] });
      onClose();
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  if (!data) return null;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>جلسة الجرد {data.reference}</CardTitle>
          <div className="flex gap-2">
            {data.status !== "done" && (
              <Button onClick={() => complete.mutate()} disabled={complete.isPending}>
                <CheckCircle2 className="ms-2 size-4" /> إقفال وتسجيل التعديلات
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>إغلاق</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.status !== "done" && (
          <div className="flex items-end gap-2">
            <div className="grid flex-1 gap-2">
              <Label htmlFor="scan">مسح الباركود (اضغط Enter لزيادة العدد)</Label>
              <Input
                id="scan"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); scanBarcode(); } }}
                placeholder="امسح باركود المنتج…"
                dir="ltr"
                autoFocus
              />
            </div>
            <Button type="button" variant="outline" onClick={scanBarcode}>عدّ</Button>
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المنتج</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>المتوقع</TableHead>
              <TableHead>المعدود</TableHead>
              <TableHead>الفرق</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.lines.map((l) => {
              const variance = l.countedQty == null ? null : l.countedQty - l.expectedQty;
              return (
                <TableRow key={l.id}>
                  <TableCell>{l.productName}</TableCell>
                  <TableCell className="font-mono text-xs">{l.sku}</TableCell>
                  <TableCell>{l.expectedQty}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      defaultValue={l.countedQty ?? ""}
                      className="w-24"
                      disabled={data.status === "done"}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isNaN(v)) updateLine.mutate({ lineId: l.id, countedQty: v });
                      }}
                    />
                  </TableCell>
                  <TableCell className={variance == null ? "" : variance === 0 ? "text-muted-foreground" : variance > 0 ? "text-green-600" : "text-red-600"}>
                    {variance == null ? "—" : variance > 0 ? `+${variance}` : variance}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
