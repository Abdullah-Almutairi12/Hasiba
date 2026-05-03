import { useState } from "react";
import { Money } from "@/components/riyal";
import {
  useListProducts,
  useGetProductStats,
  useListProductCategories,
  useDeleteProduct,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Plus, Package, AlertTriangle, DollarSign, Pencil, Trash2, Download, Warehouse } from "lucide-react";
import { ProductFormDialog } from "@/components/product-form-dialog";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useQuery } from "@tanstack/react-query";

interface BalanceRow {
  warehouseId: number;
  warehouseName: string;
  quantity: number;
  avgCost: number;
}
interface MoveRow {
  id: number;
  kind: string;
  quantity: number;
  unitCost: number;
  fromWarehouseName: string | null;
  toWarehouseName: string | null;
  occurredAt: string;
}

function StockPanel({ productId, onClose }: { productId: number | null; onClose: () => void }) {
  const open = productId != null;
  const { data: balances } = useQuery({
    queryKey: ["product-balances", productId],
    enabled: open,
    queryFn: async () =>
      (await fetch(`/api/inventory/products/${productId}/balances`, { credentials: "include" }).then((r) =>
        r.json(),
      )) as BalanceRow[],
  });
  const { data: moves } = useQuery({
    queryKey: ["product-moves", productId],
    enabled: open,
    queryFn: async () =>
      (await fetch(`/api/inventory/moves?productId=${productId}&limit=20`, {
        credentials: "include",
      }).then((r) => r.json())) as MoveRow[],
  });
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="left" className="w-[460px] sm:max-w-none overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Warehouse className="size-5" /> الأرصدة لكل مستودع
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-6">
          <div>
            <h4 className="font-semibold mb-2 text-sm">الأرصدة الحالية</h4>
            {balances?.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>المستودع</TableHead>
                    <TableHead className="text-center">الكمية</TableHead>
                    <TableHead className="text-left">متوسط التكلفة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {balances.map((b) => (
                    <TableRow key={b.warehouseId}>
                      <TableCell>{b.warehouseName}</TableCell>
                      <TableCell className="text-center">{b.quantity}</TableCell>
                      <TableCell className="text-left">
                        <Money value={b.avgCost} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">لا يوجد رصيد</p>
            )}
          </div>
          <div>
            <h4 className="font-semibold mb-2 text-sm">آخر الحركات</h4>
            {moves?.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>النوع</TableHead>
                    <TableHead className="text-center">الكمية</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {moves.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="text-xs">
                        {new Date(m.occurredAt).toLocaleDateString("ar")}
                      </TableCell>
                      <TableCell className="text-xs">{m.kind}</TableCell>
                      <TableCell className="text-center">{m.quantity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">لا توجد حركات</p>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface ProductFormState {
  id: number;
  name: string;
  nameAr: string;
  sku: string;
  categoryId: number;
  price: number;
  costPrice: number;
  stock: number;
  minStock: number;
  unit: string;
  barcode: string | null;
  trackingMode: "none" | "lot" | "serial";
  costingMethod: "average" | "fifo" | "standard";
}

function exportProductsToCsv(rows: Array<{
  nameAr: string;
  name: string;
  sku: string;
  categoryName?: string | null;
  price: number;
  stock: number;
  unit: string;
}>) {
  const header = ["الاسم العربي", "الاسم الإنجليزي", "SKU", "الفئة", "السعر", "المخزون", "الوحدة"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const values = [
      r.nameAr,
      r.name,
      r.sku,
      r.categoryName ?? "",
      String(r.price),
      String(r.stock),
      r.unit,
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
    lines.push(values.join(","));
  }
  const bom = "\ufeff";
  const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Products() {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProductFormState | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [panelProductId, setPanelProductId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteProduct();

  const { data: stats, isLoading: isLoadingStats } = useGetProductStats();
  const { data: categories } = useListProductCategories();
  const { data: products, isLoading: isLoadingProducts } = useListProducts({
    search: search || undefined,
    category: categoryId === "all" ? undefined : categoryId,
  });

  const handleDelete = async () => {
    if (deleteId == null) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteId });
      await queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/products/stats"] });
      toast({ title: "تم حذف المنتج" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "تعذر الحذف";
      toast({ title: "خطأ", description: msg, variant: "destructive" });
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <div className="space-y-6 pb-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">المنتجات والمخزون</h1>
          <p className="text-muted-foreground">إدارة المنتجات، التتبع، وتنبيهات المخزون</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => exportProductsToCsv(products ?? [])}
            disabled={!products?.length}
          >
            <Download className="size-4" />
            تصدير CSV
          </Button>
          <Button
            className="gap-2"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
            إضافة منتج
          </Button>
        </div>
      </div>

      <ProductFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o);
          if (!o) setEditing(null);
        }}
        initialData={editing}
      />

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المنتج</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف هذا المنتج نهائياً. هل أنت متأكد؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center p-6 gap-4">
            <div className="flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Package className="size-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">إجمالي المنتجات</p>
              {isLoadingStats ? (
                <Skeleton className="h-8 w-20 mt-1" />
              ) : (
                <h3 className="text-2xl font-bold">{stats?.totalProducts || 0}</h3>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center p-6 gap-4">
            <div className="flex size-12 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500">
              <AlertTriangle className="size-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">تنبيهات المخزون</p>
              {isLoadingStats ? (
                <Skeleton className="h-8 w-20 mt-1" />
              ) : (
                <h3 className="text-2xl font-bold">{stats?.lowStockCount || 0}</h3>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center p-6 gap-4">
            <div className="flex size-12 items-center justify-center rounded-lg bg-green-500/10 text-green-500">
              <DollarSign className="size-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">قيمة المخزون الكلية</p>
              {isLoadingStats ? (
                <Skeleton className="h-8 w-20 mt-1" />
              ) : (
                <h3 className="text-2xl font-bold">
                  <Money value={stats?.totalInventoryValue} />
                </h3>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3 border-b flex flex-row items-center justify-between">
          <div className="flex gap-4 flex-1 max-w-xl">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="ابحث برمز SKU أو اسم المنتج..."
                className="pl-4 pr-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 overflow-x-auto hide-scrollbar">
              <Button
                variant={categoryId === "all" ? "default" : "outline"}
                onClick={() => setCategoryId("all")}
                size="sm"
              >
                الكل
              </Button>
              {categories?.map((c) => (
                <Button
                  key={c.id}
                  variant={categoryId === c.id.toString() ? "default" : "outline"}
                  onClick={() => setCategoryId(c.id.toString())}
                  size="sm"
                >
                  {c.nameAr || c.name}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>المنتج</TableHead>
                <TableHead>رمز SKU</TableHead>
                <TableHead>الفئة</TableHead>
                <TableHead className="text-left">السعر</TableHead>
                <TableHead className="text-center">المخزون</TableHead>
                <TableHead className="text-center">الحالة</TableHead>
                <TableHead className="text-center w-32">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingProducts ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-10 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-24" /></TableCell>
                    <TableCell className="text-left"><Skeleton className="h-5 w-20 ml-auto" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-5 w-12 mx-auto" /></TableCell>
                    <TableCell className="text-center"><Skeleton className="h-6 w-20 mx-auto rounded-full" /></TableCell>
                  </TableRow>
                ))
              ) : products?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    لا توجد منتجات مطابقة للبحث
                  </TableCell>
                </TableRow>
              ) : (
                products?.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium flex items-center gap-3">
                      {product.imageUrl ? (
                        <div className="size-10 rounded-md overflow-hidden bg-muted border">
                          <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="size-10 rounded-md bg-muted border flex items-center justify-center text-muted-foreground">
                          <Package className="size-5" />
                        </div>
                      )}
                      <span>{product.nameAr || product.name}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-sm">{product.sku}</TableCell>
                    <TableCell>{product.categoryName}</TableCell>
                    <TableCell className="text-left font-semibold">
                      <Money value={product.price} />
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={product.stock <= product.minStock ? "text-red-500 font-bold" : ""}>
                        {product.stock} {product.unit}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {product.stock <= 0 ? (
                        <Badge variant="destructive">نفذ المخزون</Badge>
                      ) : product.stock <= product.minStock ? (
                        <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-400 dark:border-yellow-900/50">مخزون منخفض</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-900/50">متوفر</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setPanelProductId(product.id)}
                          title="الأرصدة لكل مستودع"
                        >
                          <Warehouse className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setEditing({
                              id: product.id,
                              name: product.name,
                              nameAr: product.nameAr ?? product.name,
                              sku: product.sku,
                              categoryId: product.categoryId ?? 0,
                              price: product.price,
                              costPrice: product.costPrice ?? 0,
                              stock: product.stock,
                              minStock: product.minStock ?? 0,
                              unit: product.unit ?? "قطعة",
                              barcode: product.barcode ?? null,
                              trackingMode: product.trackingMode,
                              costingMethod: product.costingMethod,
                            });
                            setFormOpen(true);
                          }}
                          title="تعديل"
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleteId(product.id)}
                          title="حذف"
                        >
                          <Trash2 className="size-4 text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <StockPanel productId={panelProductId} onClose={() => setPanelProductId(null)} />
    </div>
  );
}
