import { useState } from "react";
import {
  useListCompanies,
  useDeleteCompany,
  getListCompaniesQueryKey,
  type Company,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useCurrentCompany } from "@/hooks/use-current-company";
import { ME_KEY } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Plus, Pencil, Trash2, Users, Building2, Sparkles } from "lucide-react";
import { CompanyFormDialog } from "./company-form-dialog";
import { CompanyUsersDialog } from "./company-users-dialog";

export function CompaniesTable() {
  const { data: companies, isLoading } = useListCompanies();
  const { activeCompanyId } = useCurrentCompany();
  const { toast } = useToast();
  const qc = useQueryClient();
  const deleteMut = useDeleteCompany();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [usersOpen, setUsersOpen] = useState(false);
  const [usersTarget, setUsersTarget] = useState<Company | null>(null);
  const [toDelete, setToDelete] = useState<Company | null>(null);

  const list = companies ?? [];
  const hasSingle = list.filter((c) => c.isActive).length <= 1;

  const onlyOne = list.length === 1;

  const handleDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteMut.mutateAsync({ id: toDelete.id });
      toast({ title: "تم حذف الشركة" });
      await qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
      await qc.invalidateQueries({ queryKey: ME_KEY });
    } catch (err) {
      const e = err as { response?: { data?: { message?: string; error?: string } } };
      toast({
        title: "تعذّر الحذف",
        description:
          e?.response?.data?.message ?? e?.response?.data?.error ?? (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setToDelete(null);
    }
  };

  return (
    <div className="space-y-4">
      {hasSingle && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="flex-row items-center gap-3 space-y-0">
            <Sparkles className="size-5 text-primary" />
            <div className="flex-1">
              <CardTitle className="text-base">
                {onlyOne
                  ? "أضف شركة جديدة لتفعيل النظام متعدد الشركات"
                  : "لديك شركة نشطة واحدة فقط"}
              </CardTitle>
              <CardDescription>
                نظامك يدعم العمل على عدة كيانات قانونية في نفس الوقت — أضف شركة لتجربة الميزة.
              </CardDescription>
            </div>
            <Button onClick={() => { setEditing(null); setFormOpen(true); }} data-testid="companies-empty-add">
              <Plus className="me-1 size-4" /> إضافة شركة
            </Button>
          </CardHeader>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-4 text-primary" /> الشركات
            </CardTitle>
            <CardDescription>
              الشركات التي لديك فيها عضوية مالك صريحة. التبديل بين الشركات المسموح بها من القائمة العلوية.
            </CardDescription>
          </div>
          <Button
            onClick={() => { setEditing(null); setFormOpen(true); }}
            data-testid="companies-add"
          >
            <Plus className="me-1 size-4" /> إضافة شركة
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>الرقم الضريبي</TableHead>
                <TableHead>العملة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-end">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    جاري التحميل…
                  </TableCell>
                </TableRow>
              ) : list.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    لا توجد شركات.
                  </TableCell>
                </TableRow>
              ) : (
                list.map((c) => (
                  <TableRow key={c.id} data-testid={`company-row-${c.id}`}>
                    <TableCell className="font-medium">
                      {c.name}
                      {c.id === activeCompanyId && (
                        <Badge variant="secondary" className="ms-2 text-[10px]">
                          النشطة
                        </Badge>
                      )}
                      {c.nameEn && (
                        <div className="text-[11px] text-muted-foreground" dir="ltr">
                          {c.nameEn}
                        </div>
                      )}
                    </TableCell>
                    <TableCell dir="ltr" className="text-xs">
                      {c.vatNumber ?? "—"}
                    </TableCell>
                    <TableCell dir="ltr">{c.baseCurrency}</TableCell>
                    <TableCell>
                      {c.isActive ? (
                        <Badge className="bg-emerald-100 text-emerald-700">نشطة</Badge>
                      ) : (
                        <Badge variant="outline">معطّلة</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => { setUsersTarget(c); setUsersOpen(true); }}
                          title="إدارة المستخدمين"
                          data-testid={`company-users-${c.id}`}
                        >
                          <Users className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => { setEditing(c); setFormOpen(true); }}
                          title="تعديل"
                          data-testid={`company-edit-${c.id}`}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setToDelete(c)}
                          title="حذف"
                          data-testid={`company-delete-${c.id}`}
                        >
                          <Trash2 className="size-4 text-rose-500" />
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

      <CompanyFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
      />
      <CompanyUsersDialog
        open={usersOpen}
        onOpenChange={setUsersOpen}
        company={usersTarget}
      />

      <AlertDialog open={Boolean(toDelete)} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الشركة؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم تعطيل الشركة "{toDelete?.name}" ومنع الوصول إليها. سيُرفض الحذف إذا كانت
              تحتوي على بيانات تشغيلية أو كانت آخر شركة نشطة.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-rose-600 hover:bg-rose-700"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
