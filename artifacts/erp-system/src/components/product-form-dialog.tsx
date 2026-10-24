import { useState, useEffect } from "react";
import { useCreateProduct, useUpdateProduct, useListProductCategories } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialData?: {
    id: number;
    name: string;
    nameAr: string;
    sku: string;
    categoryId: number;
    price: number;
    /** Omitted when the caller cannot read cost; never treated as 0. */
    costPrice?: number;
    stock: number;
    minStock: number;
    unit: string;
    barcode?: string | null;
    trackingMode?: "none" | "lot" | "serial";
    costingMethod?: "average" | "fifo" | "standard";
  } | null;
}

const emptyForm = {
  name: "",
  nameAr: "",
  sku: "",
  categoryId: "",
  price: "",
  costPrice: "",
  stock: "",
  minStock: "",
  unit: "قطعة",
  barcode: "",
  trackingMode: "none" as "none" | "lot" | "serial",
  costingMethod: "average" as "average" | "fifo" | "standard",
};

export function ProductFormDialog({ open, onOpenChange, initialData }: ProductFormDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: categories } = useListProductCategories();
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();

  const [form, setForm] = useState(emptyForm);
  const isEdit = Boolean(initialData);

  useEffect(() => {
    if (initialData) {
      setForm({
        name: initialData.name,
        nameAr: initialData.nameAr,
        sku: initialData.sku,
        categoryId: String(initialData.categoryId),
        price: String(initialData.price),
        costPrice: initialData.costPrice == null ? "" : String(initialData.costPrice),
        stock: String(initialData.stock),
        minStock: String(initialData.minStock),
        unit: initialData.unit,
        barcode: initialData.barcode ?? "",
        trackingMode: initialData.trackingMode ?? "none",
        costingMethod: initialData.costingMethod ?? "average",
      });
    } else {
      setForm(emptyForm);
    }
  }, [initialData, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const categoryIdNum = Number(form.categoryId);
    if (!form.nameAr || !form.name || !form.sku || !categoryIdNum) {
      toast({ title: "حقول مطلوبة ناقصة", description: "تأكد من تعبئة الاسم، رمز SKU، واختيار فئة صحيحة", variant: "destructive" });
      return;
    }
    // Missing cost on edit stays unsent rather than overwritten with 0.
    const costUnknown = isEdit && initialData?.costPrice == null && form.costPrice.trim() === "";
    const payload = {
      name: form.name,
      nameAr: form.nameAr,
      sku: form.sku,
      categoryId: categoryIdNum,
      price: Number(form.price) || 0,
      ...(costUnknown ? {} : { costPrice: Number(form.costPrice) || 0 }),
      stock: Number(form.stock) || 0,
      minStock: Number(form.minStock) || 0,
      unit: form.unit,
      barcode: form.barcode || null,
      trackingMode: form.trackingMode,
      costingMethod: form.costingMethod,
    };
    try {
      if (isEdit && initialData) {
        await updateMutation.mutateAsync({ id: initialData.id, data: payload });
        toast({ title: "تم تحديث المنتج" });
      } else {
        await createMutation.mutateAsync({ data: { ...payload, costPrice: Number(form.costPrice) || 0 } });
        toast({ title: "تمت إضافة المنتج" });
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/products/stats"] });
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "تعذر الحفظ";
      toast({ title: "خطأ", description: message, variant: "destructive" });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "تعديل منتج" : "منتج جديد"}</DialogTitle>
          <DialogDescription>
            أدخل بيانات المنتج. الحقول المعلمة بـ * مطلوبة.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="nameAr">الاسم بالعربية *</Label>
              <Input
                id="nameAr"
                value={form.nameAr}
                onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">الاسم بالإنجليزية *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sku">رمز SKU *</Label>
              <Input
                id="sku"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                required
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="categoryId">الفئة *</Label>
              <Select
                value={form.categoryId}
                onValueChange={(v) => setForm({ ...form, categoryId: v })}
              >
                <SelectTrigger id="categoryId">
                  <SelectValue placeholder="اختر فئة" />
                </SelectTrigger>
                <SelectContent>
                  {categories?.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.nameAr || c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">سعر البيع (ر.س)</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="costPrice">سعر التكلفة (ر.س)</Label>
              <Input
                id="costPrice"
                type="number"
                step="0.01"
                value={form.costPrice}
                onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                placeholder={isEdit && initialData?.costPrice == null ? "التكلفة غير متاحة لك — تبقى كما هي" : undefined}
                data-testid="input-product-cost"
              />
            </div>
            {!isEdit && (
              <div className="space-y-2">
                <Label htmlFor="stock">الرصيد الافتتاحي</Label>
                <Input
                  id="stock"
                  type="number"
                  value={form.stock}
                  onChange={(e) => setForm({ ...form, stock: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  يُسجَّل كحركة استلام في دفتر المخزون. للتعديل لاحقاً استخدم حركات/تحويلات المخزون.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="minStock">حد التنبيه</Label>
              <Input
                id="minStock"
                type="number"
                value={form.minStock}
                onChange={(e) => setForm({ ...form, minStock: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">وحدة القياس</Label>
              <Input
                id="unit"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="barcode">الباركود</Label>
              <Input
                id="barcode"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="trackingMode">وضع التتبع</Label>
              <Select
                value={form.trackingMode}
                onValueChange={(v) => setForm({ ...form, trackingMode: v as "none" | "lot" | "serial" })}
              >
                <SelectTrigger id="trackingMode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">بدون</SelectItem>
                  <SelectItem value="lot">تشغيلات (Lot)</SelectItem>
                  <SelectItem value="serial">أرقام تسلسلية (Serial)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="costingMethod">طريقة احتساب التكلفة</Label>
              <Select
                value={form.costingMethod}
                onValueChange={(v) => setForm({ ...form, costingMethod: v as "average" | "fifo" | "standard" })}
              >
                <SelectTrigger id="costingMethod"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="average">المتوسط المرجح</SelectItem>
                  <SelectItem value="fifo">FIFO</SelectItem>
                  <SelectItem value="standard">تكلفة معيارية</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? "جاري الحفظ..." : isEdit ? "تحديث" : "إضافة"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
