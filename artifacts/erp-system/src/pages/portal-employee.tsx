import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LogOut } from "lucide-react";
import { portalApi, getPortalToken, clearPortalSession } from "@/lib/portal-api";

type Overview = {
  employee: { id: number; name: string; email: string };
  payslips: Array<{ id: number; reference: string; netPay: string; period: string }>;
  leaves: Array<{ id: number; reference: string; days: string; status: string; startDate: string }>;
  balances: Array<{ leaveTypeId: number; typeName: string; entitlement: string; used: string; pending: string }>;
  attendance: Array<{ id: number; punchAt: string; direction: string }>;
};

export default function PortalEmployee() {
  const [, setLocation] = useLocation();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");

  const load = async () => {
    try {
      setData(await portalApi.get<Overview>("/portal/employee/overview"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    if (!getPortalToken()) return setLocation("/portal/login");
    load();
  }, [setLocation]);

  const logout = async () => {
    try { await portalApi.post("/portal/auth/logout", {}); } catch { /* ignore */ }
    clearPortalSession();
    setLocation("/portal/login");
  };

  const submitLeave = async () => {
    if (!leaveTypeId || !start || !end) return;
    await portalApi.post("/portal/employee/leaves", {
      leaveTypeId: Number(leaveTypeId),
      startDate: start,
      endDate: end,
      days,
      reason,
    });
    setStart(""); setEnd(""); setReason("");
    load();
  };

  if (error) return <div className="p-8 text-center text-destructive" dir="rtl">{error}</div>;
  if (!data) return <div className="p-8 text-center" dir="rtl">جاري التحميل...</div>;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950" dir="rtl">
      <header className="bg-white dark:bg-slate-900 border-b px-4 sm:px-6 py-3 flex items-center justify-between">
        <div>
          <div className="text-sm text-muted-foreground">بوابة الموظف</div>
          <div className="font-semibold">{data.employee.name}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={logout}><LogOut className="size-4 ml-1" /> خروج</Button>
      </header>

      <main className="p-4 sm:p-6 max-w-6xl mx-auto">
        <Tabs defaultValue="payslips">
          <TabsList>
            <TabsTrigger value="payslips">قسائم الراتب</TabsTrigger>
            <TabsTrigger value="leaves">الإجازات</TabsTrigger>
            <TabsTrigger value="attendance">الحضور</TabsTrigger>
          </TabsList>

          <TabsContent value="payslips">
            <Card>
              <CardHeader><CardTitle>آخر قسائم الراتب</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>المرجع</TableHead><TableHead>الفترة</TableHead><TableHead>صافي الراتب</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.payslips.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.reference}</TableCell>
                        <TableCell>{p.period}</TableCell>
                        <TableCell>{p.netPay}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leaves">
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>الأرصدة</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>النوع</TableHead><TableHead>الاستحقاق</TableHead><TableHead>المستخدم</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.balances.map((b) => (
                        <TableRow key={b.leaveTypeId}>
                          <TableCell>{b.typeName}</TableCell>
                          <TableCell>{b.entitlement}</TableCell>
                          <TableCell>{b.used}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle>طلب إجازة جديدة</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <Input placeholder="نوع الإجازة (id)" value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} />
                  <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                  <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                  <Input type="number" placeholder="الأيام" value={days} onChange={(e) => setDays(e.target.value)} />
                  <Textarea placeholder="السبب" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button onClick={submitLeave}>إرسال الطلب</Button>
                </CardContent>
              </Card>
            </div>

            <Card className="mt-4">
              <CardHeader><CardTitle>طلباتي</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>المرجع</TableHead><TableHead>من</TableHead><TableHead>أيام</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.leaves.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>{l.reference}</TableCell>
                        <TableCell>{l.startDate}</TableCell>
                        <TableCell>{l.days}</TableCell>
                        <TableCell><Badge variant="outline">{l.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="attendance">
            <Card>
              <CardHeader><CardTitle>سجل الحضور (آخر 30 يوماً)</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>الوقت</TableHead><TableHead>الاتجاه</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.attendance.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>{new Date(a.punchAt).toLocaleString("ar-SA")}</TableCell>
                        <TableCell><Badge variant="outline">{a.direction}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
