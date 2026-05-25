import { useEffect, useState } from "react";
import {
  useListCompanyUsers,
  useAssignCompanyUser,
  useRevokeCompanyUser,
  useListUsers,
  getListCompanyUsersQueryKey,
  type Company,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Trash2, Plus, Loader2 } from "lucide-react";

const ROLES = [
  { value: "owner", label: "مالك" },
  { value: "manager", label: "مدير" },
  { value: "accountant", label: "محاسب" },
  { value: "sales", label: "مبيعات" },
  { value: "cashier", label: "كاشير" },
  { value: "inventory", label: "مخزون" },
  { value: "marketing", label: "تسويق" },
  { value: "auditor", label: "مراجع" },
] as const;

export function CompanyUsersDialog({
  open,
  onOpenChange,
  company,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  company: Company | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedUserIds, setSelectedUserIds] = useState<Set<number>>(new Set());
  const [selectedRole, setSelectedRole] = useState<string>("manager");
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    if (!open) {
      setSelectedUserIds(new Set());
      setSelectedRole("manager");
    }
  }, [open]);

  const { data: companyUsers } = useListCompanyUsers(company?.id ?? 0, {
    query: {
      enabled: open && Boolean(company),
      queryKey: getListCompanyUsersQueryKey(company?.id ?? 0),
    },
  });
  const { data: allUsers } = useListUsers({
    query: {
      enabled: open && Boolean(company),
      queryKey: ["/api/users"] as const,
    },
  });

  const assignMut = useAssignCompanyUser();
  const revokeMut = useRevokeCompanyUser();

  const assignedIds = new Set((companyUsers ?? []).map((u) => u.userId));
  const candidates = (allUsers ?? []).filter(
    (u) => u.isActive && !assignedIds.has(u.id),
  );

  const refresh = () => {
    if (!company) return;
    void qc.invalidateQueries({
      queryKey: getListCompanyUsersQueryKey(company.id),
    });
  };

  const toggleId = (id: number) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedUserIds.size === candidates.length) {
      setSelectedUserIds(new Set());
    } else {
      setSelectedUserIds(new Set(candidates.map((u) => u.id)));
    }
  };

  const handleAdd = async () => {
    if (!company || selectedUserIds.size === 0) return;
    setIsAdding(true);
    const ids = Array.from(selectedUserIds);
    let okCount = 0;
    let failCount = 0;
    for (const userId of ids) {
      try {
        await assignMut.mutateAsync({
          id: company.id,
          data: { userId, role: selectedRole },
        });
        okCount += 1;
      } catch {
        failCount += 1;
      }
    }
    setIsAdding(false);
    setSelectedUserIds(new Set());
    refresh();
    toast({
      title: `أُضيف ${okCount} مستخدم${failCount ? ` — فشل ${failCount}` : ""}`,
      variant: failCount > 0 ? "destructive" : undefined,
    });
  };

  const handleRemove = async (userId: number) => {
    if (!company) return;
    try {
      await revokeMut.mutateAsync({ id: company.id, userId });
      toast({ title: "تمت إزالة المستخدم" });
      refresh();
    } catch (err) {
      toast({
        title: "تعذّر الحذف",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  const allChecked =
    candidates.length > 0 && selectedUserIds.size === candidates.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>إدارة مستخدمي: {company?.name ?? "—"}</DialogTitle>
          <DialogDescription>
            أضف أو احذف الموظفين المرتبطين بهذه الشركة وحدّد دور كلٍّ منهم.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs font-bold">
              إضافة مستخدمين ({selectedUserIds.size} محدد)
            </Label>
            <div className="flex items-center gap-2">
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger
                  className="h-8 w-32 text-xs"
                  data-testid="company-users-select-role"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={selectedUserIds.size === 0 || isAdding}
                data-testid="company-users-add"
              >
                {isAdding ? (
                  <Loader2 className="me-1 size-4 animate-spin" />
                ) : (
                  <Plus className="me-1 size-4" />
                )}
                إضافة المحدد
              </Button>
            </div>
          </div>

          <div className="max-h-48 overflow-auto rounded border bg-background">
            {candidates.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground">
                لا يوجد مستخدمون متاحون للإضافة.
              </div>
            ) : (
              <>
                <label className="flex items-center gap-2 border-b bg-muted/40 p-2 text-xs font-bold">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={toggleAll}
                    data-testid="company-users-select-all"
                  />
                  تحديد الكل
                </label>
                {candidates.map((u) => (
                  <label
                    key={u.id}
                    className="flex cursor-pointer items-center gap-2 border-b p-2 text-sm last:border-b-0 hover:bg-muted/40"
                  >
                    <Checkbox
                      checked={selectedUserIds.has(u.id)}
                      onCheckedChange={() => toggleId(u.id)}
                      data-testid={`company-users-pick-${u.id}`}
                    />
                    <div className="flex-1">
                      <div className="font-medium">{u.name}</div>
                      <div className="text-[11px] text-muted-foreground" dir="ltr">
                        {u.email}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {u.role}
                    </Badge>
                  </label>
                ))}
              </>
            )}
          </div>
        </div>

        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الاسم</TableHead>
                <TableHead>البريد</TableHead>
                <TableHead>الدور</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(companyUsers ?? []).length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-6 text-center text-sm text-muted-foreground"
                  >
                    لا يوجد مستخدمون مرتبطون بعد.
                  </TableCell>
                </TableRow>
              ) : (
                (companyUsers ?? []).map((u) => (
                  <TableRow
                    key={u.id}
                    data-testid={`company-user-row-${u.userId}`}
                  >
                    <TableCell className="font-medium">
                      {u.name}
                      {u.isDefault && (
                        <Badge variant="secondary" className="ms-2 text-[10px]">
                          افتراضي
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell dir="ltr" className="text-xs text-muted-foreground">
                      {u.email}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{u.role}</Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleRemove(u.userId)}
                        disabled={revokeMut.isPending}
                        data-testid={`company-user-remove-${u.userId}`}
                      >
                        <Trash2 className="size-4 text-rose-500" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
