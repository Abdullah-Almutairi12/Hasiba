import { useState } from "react";
import { useListBranches, useListWarehouses } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Warehouse, Plus, MapPin, Package, TrendingUp } from "lucide-react";
import { BranchFormDialog } from "@/components/branch-form-dialog";

export default function BranchesPage() {
  const { data: branches } = useListBranches();
  const { data: warehouses } = useListWarehouses();
  const [createOpen, setCreateOpen] = useState(false);

  const branchList = branches ?? [];
  const warehouseList = warehouses ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">الفروع والمستودعات</h1>
          <p className="mt-1 text-muted-foreground">
            إدارة فروع الشركة، المستودعات، ومراكز التوزيع
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <Warehouse className="ms-2 size-4" />
            مستودع جديد
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="ms-2 size-4" />
            فرع جديد
          </Button>
        </div>
      </div>

      <BranchFormDialog open={createOpen} onOpenChange={setCreateOpen} />

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">إجمالي الفروع</p>
                <p className="mt-2 text-3xl font-bold">{branchList.length}</p>
              </div>
              <div className="grid size-12 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
                <Building2 className="size-6" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">إجمالي المستودعات</p>
                <p className="mt-2 text-3xl font-bold">{warehouseList.length}</p>
              </div>
              <div className="grid size-12 place-items-center rounded-xl bg-purple-500/10 text-purple-600">
                <Warehouse className="size-6" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">المدن المغطاة</p>
                <p className="mt-2 text-3xl font-bold">
                  {new Set(branchList.map((b) => b.city)).size}
                </p>
              </div>
              <div className="grid size-12 place-items-center rounded-xl bg-green-500/10 text-green-600">
                <MapPin className="size-6" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">الفروع النشطة</p>
                <p className="mt-2 text-3xl font-bold">
                  {branchList.filter((b) => b.isActive).length}
                </p>
              </div>
              <div className="grid size-12 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600">
                <TrendingUp className="size-6" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Branch Cards */}
      <div>
        <h2 className="mb-4 text-xl font-semibold">الفروع</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {branchList.map((branch) => {
            const branchWarehouses = warehouseList.filter((w) => w.branchId === branch.id);
            return (
              <Card key={branch.id} className="overflow-hidden transition-shadow hover:shadow-lg">
                <div className="h-2 bg-gradient-to-l from-primary to-cyan-400" />
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{branch.nameAr}</CardTitle>
                      <p className="mt-1 text-sm text-muted-foreground">{branch.name}</p>
                    </div>
                    <Badge variant={branch.isActive ? "default" : "secondary"}>
                      {branch.isActive ? "نشط" : "متوقف"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="size-4" />
                    <span>{branch.city}</span>
                  </div>
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        المستودعات المرتبطة
                      </span>
                      <span className="text-xs font-bold">{branchWarehouses.length}</span>
                    </div>
                    <div className="space-y-1.5">
                      {branchWarehouses.map((w) => (
                        <div
                          key={w.id}
                          className="flex items-center justify-between text-sm"
                        >
                          <div className="flex items-center gap-2">
                            <Package className="size-3.5 text-muted-foreground" />
                            <span>{w.nameAr}</span>
                          </div>
                          {w.isDefault && (
                            <Badge variant="outline" className="h-5 text-xs">
                              افتراضي
                            </Badge>
                          )}
                        </div>
                      ))}
                      {branchWarehouses.length === 0 && (
                        <p className="text-xs text-muted-foreground">لا توجد مستودعات</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" className="flex-1">
                      تعديل
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1">
                      التقارير
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
