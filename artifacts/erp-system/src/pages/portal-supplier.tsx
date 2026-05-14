import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LogOut } from "lucide-react";
import { portalApi, getPortalToken, clearPortalSession } from "@/lib/portal-api";

type Overview = {
  supplier: { id: number; name: string; email: string };
  purchaseOrders: Array<{ id: number; reference: string; total: string; status: string; createdAt: string }>;
  invoices: Array<{ id: number; reference: string; total: string; status: string; issuedAt: string }>;
};

export default function PortalSupplier() {
  const [, setLocation] = useLocation();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [poRef, setPoRef] = useState("");
  const [invRef, setInvRef] = useState("");
  const [total, setTotal] = useState("");

  const load = async () => {
    try {
      setData(await portalApi.get<Overview>("/portal/supplier/overview"));
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

  const submitInvoice = async () => {
    if (!invRef.trim() || !total.trim()) return;
    await portalApi.post("/portal/supplier/invoices", {
      reference: invRef,
      poReference: poRef || undefined,
      total,
    });
    setInvRef(""); setPoRef(""); setTotal("");
    load();
  };

  if (error) return <div className="p-8 text-center text-destructive" dir="rtl">{error}</div>;
  if (!data) return <div className="p-8 text-center" dir="rtl">جاري التحميل...</div>;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950" dir="rtl">
      <header className="bg-white dark:bg-slate-900 border-b px-4 sm:px-6 py-3 flex items-center justify-between">
        <div>
          <div className="text-sm text-muted-foreground">بوابة المورد</div>
          <div className="font-semibold">{data.supplier.name}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={logout}><LogOut className="size-4 ml-1" /> خروج</Button>
      </header>

      <main className="p-4 sm:p-6 max-w-6xl mx-auto">
        <Tabs defaultValue="po">
          <TabsList>
            <TabsTrigger value="po">أوامر الشراء</TabsTrigger>
            <TabsTrigger value="invoices">الفواتير</TabsTrigger>
            <TabsTrigger value="submit">رفع فاتورة</TabsTrigger>
          </TabsList>

          <TabsContent value="po">
            <Card>
              <CardHeader><CardTitle>أوامر الشراء</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>المرجع</TableHead><TableHead>التاريخ</TableHead><TableHead>الإجمالي</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.purchaseOrders.map((r) => (
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

          <TabsContent value="invoices">
            <Card>
              <CardHeader><CardTitle>فواتيري</CardTitle></CardHeader>
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

          <TabsContent value="submit">
            <Card>
              <CardHeader><CardTitle>رفع فاتورة جديدة</CardTitle></CardHeader>
              <CardContent className="space-y-3 max-w-md">
                <div>
                  <label className="text-sm">مرجع الفاتورة *</label>
                  <Input value={invRef} onChange={(e) => setInvRef(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm">مرجع أمر الشراء (اختياري)</label>
                  <Input value={poRef} onChange={(e) => setPoRef(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm">الإجمالي *</label>
                  <Input type="number" value={total} onChange={(e) => setTotal(e.target.value)} />
                </div>
                <Button onClick={submitInvoice}>إرسال للمراجعة</Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
