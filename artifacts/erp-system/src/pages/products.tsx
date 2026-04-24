import React, { useState } from "react";
import {
  useListProducts,
  useGetProductStats,
  useListProductCategories,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Search, Plus, Package, AlertTriangle, DollarSign } from "lucide-react";
import { motion } from "framer-motion";

export default function Products() {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");

  const { data: stats, isLoading: isLoadingStats } = useGetProductStats();
  const { data: categories } = useListProductCategories();
  const { data: products, isLoading: isLoadingProducts } = useListProducts({
    search: search || undefined,
    category: categoryId === "all" ? undefined : categoryId,
  });

  return (
    <div className="space-y-6 pb-8 max-w-7xl mx-auto">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">المنتجات والمخزون</h1>
          <p className="text-muted-foreground">إدارة المنتجات، التتبع، وتنبيهات المخزون</p>
        </div>
        <Button className="gap-2">
          <Plus className="size-4" />
          إضافة منتج
        </Button>
      </div>

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
                  {new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(stats?.totalInventoryValue || 0)}
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
                      {new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(product.price)}
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
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
