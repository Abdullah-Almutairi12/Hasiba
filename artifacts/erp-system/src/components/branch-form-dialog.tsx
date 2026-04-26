import { useState, useEffect } from "react";
import { useCreateBranch } from "@workspace/api-client-react";
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
import { useToast } from "@/hooks/use-toast";

interface BranchFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BranchFormDialog({ open, onOpenChange }: BranchFormDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createMutation = useCreateBranch();
  const [form, setForm] = useState({ nameAr: "", name: "", city: "" });

  useEffect(() => {
    if (!open) setForm({ nameAr: "", name: "", city: "" });
  }, [open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nameAr || !form.name || !form.city) {
      toast({ title: "جميع الحقول مطلوبة", variant: "destructive" });
      return;
    }
    try {
      await createMutation.mutateAsync({
        data: { nameAr: form.nameAr, name: form.name, city: form.city, isActive: true },
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/branches"] });
      toast({ title: "تمت إضافة الفرع" });
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "تعذر الحفظ";
      toast({ title: "خطأ", description: message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>فرع جديد</DialogTitle>
          <DialogDescription>أضف فرعاً جديداً للشركة</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="branchNameAr">الاسم بالعربية *</Label>
            <Input
              id="branchNameAr"
              value={form.nameAr}
              onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
              placeholder="مثال: فرع الرياض"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="branchName">الاسم بالإنجليزية *</Label>
            <Input
              id="branchName"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Riyadh Branch"
              dir="ltr"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="branchCity">المدينة *</Label>
            <Input
              id="branchCity"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              placeholder="الرياض"
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "جاري الحفظ..." : "إضافة"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
