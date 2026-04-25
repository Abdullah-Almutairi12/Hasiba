import { useListUsers, useListRoles } from "@workspace/api-client-react";
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
} from "lucide-react";
import { Input } from "@/components/ui/input";

const ROLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  manager: ShieldCheck,
  accountant: Calculator,
  cashier: KeyRound,
  auditor: ScanEye,
};

const ROLE_COLORS: Record<string, string> = {
  manager: "bg-purple-500/10 text-purple-600 border-purple-500/30",
  accountant: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  cashier: "bg-green-500/10 text-green-600 border-green-500/30",
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

export default function UsersPage() {
  const { data: users } = useListUsers();
  const { data: roles } = useListRoles();

  const userList = users ?? [];
  const roleList = roles ?? [];

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
        <Button>
          <UserPlus className="ms-2 size-4" />
          مستخدم جديد
        </Button>
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
              <Input placeholder="بحث..." className="w-64 ps-10" />
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
                {userList.map((user) => {
                  const role = roleList.find((r) => r.key === user.role);
                  return (
                    <tr key={user.id} className="text-sm">
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
                        <Button variant="ghost" size="sm">
                          تعديل
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
