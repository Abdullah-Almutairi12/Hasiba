import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { LogOut } from "lucide-react";
import { portalApi, getPortalToken, clearPortalSession } from "@/lib/portal-api";

type Overview = {
  customer: { id: number; name: string; email: string };
  invoices: Array<{ id: number; reference: string; total: string; status: string; issuedAt: string }>;
  quotations: Array<{ id: number; reference: string; total: string; status: string; createdAt: string }>;
  orders: Array<{ id: number; reference: string; total: string; status: string; createdAt: string }>;
  tickets: Array<{ id: number; subject: string; status: string; createdAt: string }>;
};

export default function PortalCustomer() {
  const [, setLocation] = useLocation();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");

  const load = async () => {
    try {
      const r = await portalApi.get<Overview>("/portal/customer/overview");
      setData(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    if (!getPortalToken()) {
      setLocation("/portal/login");
      return;
    }
    load();
  }, [setLocation]);

  const logout = async () => {
    try { await portalApi.post("/portal/auth/logout", {}); } catch { /* ignore */ }
    clearPortalSession();
    setLocation("/portal/login");
  };

  const acceptQuote = async (id: number) => {
    await portalApi.post(`/portal/customer/quotations/${id}/accept`, {});
    load();
  };
  const rejectQuote = async (id: number) => {
    await portalApi.post(`/portal/customer/quotations/${id}/reject`, { reason });
    setReason("");
    load();
  };
  const createTicket = async () => {
    if (!subject.trim()) return;
    await portalApi.post("/portal/customer/tickets", { subject, message });
    setSubject("");
    setMessage("");
    load();
  };

  if (error) {
    return (
      <div className="p-8 text-center text-destructive" dir="rtl">
        {error}
        <Button variant="link" onClick={() => setLocation("/portal/login")}>الدخول مجدداً</Button>
      </div>
    );
  }
  if (!data) return <div className="p-8 text-center" dir="rtl">جاري التحميل...</div>;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950" dir="rtl">
      <header className="bg-white dark:bg-slate-900 border-b px-4 sm:px-6 py-3 flex items-center justify-between">
        <div>
          <div className="text-sm text-muted-foreground">بوابة العميل</div>
          <div className="font-semibold">{data.customer.name}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={logout}>
          <LogOut className="size-4 ml-1" /> خروج
        </Button>
      </header>

      <main className="p-4 sm:p-6 max-w-6xl mx-auto">
        <Tabs defaultValue="invoices">
          <TabsList>
            <TabsTrigger value="invoices">الفواتير</TabsTrigger>
            <TabsTrigger value="quotes">عروض الأسعار</TabsTrigger>
            <TabsTrigger value="orders">الطلبات</TabsTrigger>
            <TabsTrigger value="tickets">الدعم</TabsTrigger>
          </TabsList>

          <TabsContent value="invoices">
            <Card>
              <CardHeader><CardTitle>الفواتير</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>المرجع</TableHead><TableHead>التاريخ</TableHead><TableHead>الإجمالي</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.invoices.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.reference}</TableCell>
                        <TableCell>{new Date(r.issuedAt).toLocaleDateString("ar-SA")}</TableCell>
                        <TableCell>{r.total}</TableCell>
                        <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="quotes">
            <Card>
              <CardHeader><CardTitle>عروض الأسعار</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>المرجع</TableHead><TableHead>الإجمالي</TableHead><TableHead>الحالة</TableHead><TableHead>إجراء</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.quotations.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.reference}</TableCell>
                        <TableCell>{r.total}</TableCell>
                        <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                        <TableCell className="space-x-2 space-x-reverse">
                          {r.status === "draft" || r.status === "sent" ? (
                            <>
                              <Button size="sm" onClick={() => acceptQuote(r.id)}>قبول</Button>
                              <Button size="sm" variant="outline" onClick={() => rejectQuote(r.id)}>رفض</Button>
                            </>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Textarea placeholder="سبب الرفض (اختياري)" value={reason} onChange={(e) => setReason(e.target.value)} className="mt-3" />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="orders">
            <Card>
              <CardHeader><CardTitle>الطلبات</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>المرجع</TableHead><TableHead>التاريخ</TableHead><TableHead>الإجمالي</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.orders.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.reference}</TableCell>
                        <TableCell>{new Date(r.createdAt).toLocaleDateString("ar-SA")}</TableCell>
                        <TableCell>{r.total}</TableCell>
                        <TableCell><Badge variant="outline">{r.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tickets">
            <Card>
              <CardHeader><CardTitle>طلبات الدعم</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <input className="w-full border rounded px-3 py-2 text-sm" placeholder="موضوع الطلب" value={subject} onChange={(e) => setSubject(e.target.value)} />
                  <Textarea placeholder="تفاصيل" value={message} onChange={(e) => setMessage(e.target.value)} />
                  <Button onClick={createTicket}>إرسال طلب</Button>
                </div>
                <Table>
                  <TableHeader><TableRow><TableHead>الموضوع</TableHead><TableHead>الحالة</TableHead><TableHead>التاريخ</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.tickets.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>{t.subject}</TableCell>
                        <TableCell><Badge variant="outline">{t.status}</Badge></TableCell>
                        <TableCell>{new Date(t.createdAt).toLocaleDateString("ar-SA")}</TableCell>
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
