import { useState } from "react";
import {
  useListUsers,
  useListRoles,
  useCreateUser,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Users,
  UserPlus,
  ShieldCheck,
  Shield,
  Calculator,
  Search,
  KeyRound,
  ScanEye,
  Crown,
  Briefcase,
  ShoppingCart,
  Package,
  Megaphone,
  Trash2,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

const ROLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  owner: Crown,
  manager: ShieldCheck,
  accountant: Calculator,
  sales: Briefcase,
  cashier: ShoppingCart,
  inventory: Package,
  marketing: Megaphone,
  auditor: ScanEye,
};

const ROLE_COLORS: Record<string, string> = {
  owner: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  manager: "bg-purple-500/10 text-purple-600 border-purple-500/30",
  accountant: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  sales: "bg-cyan-500/10 text-cyan-600 border-cyan-500/30",
  cashier: "bg-green-500/10 text-green-600 border-green-500/30",
  inventory: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
  marketing: "bg-pink-500/10 text-pink-600 border-pink-500/30",
  auditor: "bg-orange-500/10 text-orange-600 border-orange-500/30",
};

function timeAgo(iso: string | null) {
  if (!iso) return "لم يسجل دخول";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "الآن";
  if (mins < 60) return `قبل ${mins} دقيقة`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `قبل ${days} يوم`;
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((n) => n[0]).join("");
}

type RoleSummary = {
  key: string;
  nameAr: string;
  description?: string;
  requires2fa?: boolean;
};

interface CreateUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: RoleSummary[];
  isOwner: boolean;
}

function CreateUserDialog({ open, onOpenChange, roles, isOwner }: CreateUserDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    role: "cashier",
    password: "",
    has2fa: false,
  });

  const createUser = useCreateUser({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
        toast({ title: "تم إنشاء المستخدم بنجاح" });
        onOpenChange(false);
        setForm({ name: "", email: "", phone: "", role: "cashier", password: "", has2fa: false });
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "فشل إنشاء المستخدم";
        toast({ title: "خطأ", description: msg, variant: "destructive" });
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) {
      toast({ title: "حقول ناقصة", description: "الاسم والبريد وكلمة المرور مطلوبة.", variant: "destructive" });
      return;
    }
    createUser.mutate({
      data: {
        name: form.name,
        email: form.email,
        phone: form.phone || null,
        role: form.role,
        has2fa: form.has2fa,
        // password is sent as an extra field; server accepts it via Zod.
        // CreateUserBody schema in spec is `additionalProperties: false`-free.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ password: form.password } as any),
      },
    });
  };

  // Owner can be assigned only by another owner.
  const visibleRoles = roles.filter((r) => (r.key === "owner" ? isOwner : true));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>إضافة مستخدم جديد</DialogTitle>
          <DialogDescription>أدخل بيانات الموظف ودوره داخل المنشأة.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">الاسم الكامل</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="فلان الفلاني"
              data-testid="input-user-name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="email">البريد الإلكتروني</Label>
            <Input
              id="email"
              type="email"
              dir="ltr"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="user@hasba.ai"
              data-testid="input-user-email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone">رقم الجوال</Label>
            <Input
              id="phone"
              dir="ltr"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+9665XXXXXXXX"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role">الدور</Label>
            <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
              <SelectTrigger id="role" data-testid="select-user-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {visibleRoles.map((r) => (
                  <SelectItem key={r.key} value={r.key}>
                    {r.nameAr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">كلمة المرور المؤقتة</Label>
            <Input
              id="password"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="حد أدنى 6 أحرف"
              data-testid="input-user-password"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">تفعيل 2FA</p>
              <p className="text-xs text-muted-foreground">طبقة أمان إضافية للأدوار الحساسة.</p>
            </div>
            <Switch
              checked={form.has2fa}
              onCheckedChange={(checked) => setForm({ ...form, has2fa: checked })}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={createUser.isPending} data-testid="button-submit-user">
              {createUser.isPending && <Loader2 className="ms-2 size-4 animate-spin" />}
              إنشاء المستخدم
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteUserState {
  id: number;
  name: string;
}

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const { isAdmin, isOwner } = usePermissions();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: users } = useListUsers();
  const { data: roles } = useListRoles();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [toDelete, setToDelete] = useState<DeleteUserState | null>(null);

  const userList = users ?? [];
  const roleList = roles ?? [];

  const deleteUser = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${API_BASE}/users/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Delete failed (${res.status})`);
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: getListUsersQueryKey() });
      toast({ title: "تم حذف المستخدم" });
      setToDelete(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "فشل الحذف";
      toast({ title: "تعذر الحذف", description: msg, variant: "destructive" });
    },
  });

  const filtered = userList.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      (u.phone ?? "").includes(search)
    );
  });

  const activeCount = userList.filter((u) => u.isActive).length;
  const twoFaCount = userList.filter((u) => u.has2fa).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">المستخدمون والصلاحيات</h1>
          <p className="mt-1 text-muted-foreground">
            إدارة الموظفين، الأدوار، والصلاحيات وفق معايير NCA ECC
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)} data-testid="button-new-user">
            <UserPlus className="ms-2 size-4" />
            مستخدم جديد
          </Button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">إجمالي المستخدمين</p>
                <p className="mt-2 text-3xl font-bold">{userList.length}</p>
              </div>
              <div className="grid size-12 place-items-center rounded-xl bg-blue-500/10 text-blue-600">
                <Users className="size-6" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">نشط الآن</p>
                <p className="mt-2 text-3xl font-bold text-green-600">{activeCount}</p>
              </div>
              <div className="grid size-12 place-items-center rounded-xl bg-green-500/10 text-green-600">
                <ShieldCheck className="size-6" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">مفعّل 2FA</p>
                <p className="mt-2 text-3xl font-bold text-purple-600">{twoFaCount}</p>
              </div>
              <div className="grid size-12 place-items-center rounded-xl bg-purple-500/10 text-purple-600">
                <KeyRound className="size-6" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">عدد الأدوار</p>
                <p className="mt-2 text-3xl font-bold">{roleList.length}</p>
              </div>
              <div className="grid size-12 place-items-center rounded-xl bg-orange-500/10 text-orange-600">
                <Shield className="size-6" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Roles overview */}
      <Card>
        <CardHeader>
          <CardTitle>قوالب الأدوار والصلاحيات</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {roleList.map((role) => {
              const Icon = ROLE_ICONS[role.key] ?? Shield;
              const colorClass = ROLE_COLORS[role.key] ?? "bg-muted text-foreground";
              const userCount = userList.filter((u) => u.role === role.key).length;
              return (
                <div
                  key={role.key}
                  className={`rounded-xl border p-4 ${colorClass}`}
                  data-testid={`card-role-${role.key}`}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <Icon className="size-6" />
                    {role.requires2fa && (
                      <Badge variant="outline" className="border-current text-xs">
                        2FA إجباري
                      </Badge>
                    )}
                  </div>
                  <h3 className="font-bold">{role.nameAr}</h3>
                  <p className="mt-1 text-xs opacity-80">{role.description}</p>
                  <div className="mt-3 flex items-center justify-between border-t border-current/20 pt-3 text-xs">
                    <span>عدد المستخدمين</span>
                    <span className="font-bold">{userCount}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>قائمة المستخدمين</CardTitle>
            <div className="relative">
              <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="بحث..."
                className="w-64 ps-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-user-search"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b text-right text-sm text-muted-foreground">
                <tr>
                  <th className="pb-3 font-medium">المستخدم</th>
                  <th className="pb-3 font-medium">الدور</th>
                  <th className="pb-3 font-medium">رقم الجوال</th>
                  <th className="pb-3 font-medium">آخر دخول</th>
                  <th className="pb-3 font-medium">2FA</th>
                  <th className="pb-3 font-medium">الحالة</th>
                  <th className="pb-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((user) => {
                  const role = roleList.find((r) => r.key === user.role);
                  const isSelf = currentUser?.id === user.id;
                  const canDelete = isOwner && !isSelf;
                  return (
                    <tr key={user.id} className="text-sm" data-testid={`row-user-${user.id}`}>
                      <td className="py-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="size-9">
                            <AvatarFallback className="bg-gradient-to-br from-primary to-cyan-400 text-white">
                              {initials(user.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{user.name}</p>
                            <p className="text-xs text-muted-foreground">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4">
                        <Badge
                          variant="outline"
                          className={ROLE_COLORS[user.role] ?? ""}
                        >
                          {role?.nameAr ?? user.role}
                        </Badge>
                      </td>
                      <td className="py-4 text-muted-foreground" dir="ltr">
                        {user.phone ?? "—"}
                      </td>
                      <td className="py-4 text-muted-foreground">
                        {timeAgo(user.lastLoginAt ?? null)}
                      </td>
                      <td className="py-4">
                        {user.has2fa ? (
                          <Badge className="bg-green-500/10 text-green-600 hover:bg-green-500/10">
                            مفعّل
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">
                            غير مفعّل
                          </Badge>
                        )}
                      </td>
                      <td className="py-4">
                        <span
                          className={`inline-flex items-center gap-1.5 ${
                            user.isActive ? "text-green-600" : "text-muted-foreground"
                          }`}
                        >
                          <span
                            className={`size-2 rounded-full ${
                              user.isActive ? "bg-green-500" : "bg-muted-foreground"
                            }`}
                          />
                          {user.isActive ? "نشط" : "موقوف"}
                        </span>
                      </td>
                      <td className="py-4 text-left">
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setToDelete({ id: user.id, name: user.name })}
                            data-testid={`button-delete-user-${user.id}`}
                            className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-muted-foreground">
                      لا توجد نتائج مطابقة.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {isAdmin && (
        <CreateUserDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          roles={roleList}
          isOwner={isOwner}
        />
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المستخدم</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف <span className="font-bold">{toDelete?.name}</span> نهائياً مع جميع جلساته. هذه العملية لا يمكن التراجع عنها.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => toDelete && deleteUser.mutate(toDelete.id)}
              className="bg-rose-600 hover:bg-rose-700"
              data-testid="button-confirm-delete-user"
            >
              {deleteUser.isPending ? <Loader2 className="size-4 animate-spin" /> : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
