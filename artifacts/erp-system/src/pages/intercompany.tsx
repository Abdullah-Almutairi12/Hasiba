import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, apiPatch } from "@/hooks/use-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePermissions } from "@/hooks/use-permissions";
import { Loader2, RefreshCcw, X } from "lucide-react";
import { Money } from "@/components/riyal";
import { useState } from "react";
import { Input } from "@/components/ui/input";

interface Sibling { id: number; name: string }
interface PartyRow { id: number; name: string; linkedCompanyId: number | null }

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

function LinkPartyRow({
  party,
  kind,
  siblings,
  onChange,
}: {
  party: PartyRow;
  kind: "customer" | "supplier";
  siblings: Sibling[];
  onChange: () => void;
}) {
  const { toast } = useToast();
  const mut = useMutation({
    mutationFn: (linkedCompanyId: number | null) =>
      apiPatch(`/${kind}s/${party.id}`, { linkedCompanyId }),
    onSuccess: () => {
      toast({ title: "تم تحديث الربط" });
      onChange();
    },
    onError: (e: unknown) =>
      toast({ title: "تعذر التحديث", description: String(e), variant: "destructive" }),
  });
  const value = party.linkedCompanyId ? String(party.linkedCompanyId) : "none";
  return (
    <TableRow>
      <TableCell>{party.name}</TableCell>
      <TableCell>
        <Select
          value={value}
          onValueChange={(v) => mut.mutate(v === "none" ? null : Number(v))}
          disabled={mut.isPending}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="بدون ربط" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">بدون ربط</SelectItem>
            {siblings.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
    </TableRow>
  );
}

function PartyLinkTab({ kind }: { kind: "customer" | "supplier" }) {
  const path = kind === "customer" ? "/customers" : "/suppliers";
  const qc = useQueryClient();
  const { data: rows = [] } = useQuery<PartyRow[]>({
    queryKey: [path],
    queryFn: () => fetchJson<PartyRow[]>(`/api${path}`),
  });
  const { data: siblings = [] } = useQuery<Sibling[]>({
    queryKey: ["/companies/siblings"],
    queryFn: () => fetchJson<Sibling[]>("/api/companies/siblings"),
  });
  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{kind === "customer" ? "العميل" : "المورد"}</TableHead>
              <TableHead>الشركة الشقيقة المرتبطة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <LinkPartyRow
                key={r.id}
                party={r}
                kind={kind}
                siblings={siblings}
                onChange={() => qc.invalidateQueries({ queryKey: [path] })}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

interface EliminationRow {
  id: number;
  kind: "sales_invoice" | "purchase_order";
  period: string;
  docDate: string;
  sourceCompanyId: number;
  sourceCompanyName: string;
  sourceRef: string;
  targetCompanyId: number;
  targetCompanyName: string;
  targetRef: string;
  sourceAmount: number;
  targetAmount: number;
  eliminationAmount: number;
}
interface EliminationGroup {
  period: string;
  sourceCompanyId: number;
  sourceCompanyName: string;
  targetCompanyId: number;
  targetCompanyName: string;
  sourceAmount: number;
  targetAmount: number;
  eliminationAmount: number;
  count: number;
}
interface EliminationResponse {
  from: string;
  to: string;
  rows: EliminationRow[];
  groups: EliminationGroup[];
  totals: { sourceAmount: number; targetAmount: number; eliminationAmount: number; count: number };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function yearAgoIso() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function EliminationTab() {
  const [from, setFrom] = useState(yearAgoIso());
  const [to, setTo] = useState(todayIso());
  const { data, isLoading } = useQuery<EliminationResponse>({
    queryKey: ["intercompany-elimination", from, to],
    queryFn: () =>
      fetchJson<EliminationResponse>(
        `/api/intercompany/elimination?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">من تاريخ</label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">إلى تاريخ</label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-[160px]"
            />
          </div>
          <div className="text-xs text-muted-foreground mr-auto max-w-md leading-relaxed">
            يُحتسب الإلغاء على الروابط ذات الحالة <b>متطابق</b> فقط؛ الروابط الملغاة أو المُعاد مزامنتها مستثناة.
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">إجمالي المصدر</div>
            <div className="text-2xl font-semibold mt-1">
              <Money value={data?.totals.sourceAmount ?? 0} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">إجمالي الهدف</div>
            <div className="text-2xl font-semibold mt-1">
              <Money value={data?.totals.targetAmount ?? 0} />
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="pt-6">
            <div className="text-xs text-amber-800">إجمالي الإلغاء</div>
            <div className="text-2xl font-semibold mt-1 text-amber-900">
              <Money value={data?.totals.eliminationAmount ?? 0} />
            </div>
            <div className="text-[11px] text-amber-700 mt-1">
              {data?.totals.count ?? 0} حركة
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">الملخص حسب الفترة وزوج الشركات</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : !data || data.groups.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              لا توجد بيانات في هذه الفترة.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الفترة</TableHead>
                  <TableHead>الشركة المصدر</TableHead>
                  <TableHead>الشركة الهدف</TableHead>
                  <TableHead>عدد</TableHead>
                  <TableHead>المصدر</TableHead>
                  <TableHead>الهدف</TableHead>
                  <TableHead>الإلغاء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.groups.map((g) => (
                  <TableRow key={`${g.period}-${g.sourceCompanyId}-${g.targetCompanyId}`}>
                    <TableCell className="font-mono text-xs">{g.period}</TableCell>
                    <TableCell>{g.sourceCompanyName}</TableCell>
                    <TableCell>{g.targetCompanyName}</TableCell>
                    <TableCell>{g.count}</TableCell>
                    <TableCell><Money value={g.sourceAmount} /></TableCell>
                    <TableCell><Money value={g.targetAmount} /></TableCell>
                    <TableCell className="font-semibold text-amber-900">
                      <Money value={g.eliminationAmount} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">التفاصيل ({data?.rows.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              لا توجد روابط متطابقة في هذه الفترة.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>المرجع المصدر</TableHead>
                  <TableHead>الشركة المصدر</TableHead>
                  <TableHead>المرجع الهدف</TableHead>
                  <TableHead>الشركة الهدف</TableHead>
                  <TableHead>المصدر</TableHead>
                  <TableHead>الهدف</TableHead>
                  <TableHead>الإلغاء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.docDate.slice(0, 10)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {r.kind === "sales_invoice" ? "فاتورة مبيعات" : "أمر شراء"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.sourceRef}</TableCell>
                    <TableCell>{r.sourceCompanyName}</TableCell>
                    <TableCell className="font-mono text-xs">{r.targetRef}</TableCell>
                    <TableCell>{r.targetCompanyName}</TableCell>
                    <TableCell><Money value={r.sourceAmount} /></TableCell>
                    <TableCell><Money value={r.targetAmount} /></TableCell>
                    <TableCell className="font-semibold text-amber-900">
                      <Money value={r.eliminationAmount} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface IntercompanyLink {
  id: number;
  kind: "sales_invoice" | "purchase_order";
  status: "matched" | "unmatched" | "void" | "resynced";
  direction: "outbound" | "inbound";
  sourceCompanyId: number;
  sourceCompanyName: string | null;
  sourceRef: string | null;
  targetCompanyId: number;
  targetCompanyName: string | null;
  targetRef: string | null;
  createdAt: string;
  updatedAt: string;
}

async function fetchLinks(): Promise<IntercompanyLink[]> {
  const res = await fetch("/api/intercompany/links", { credentials: "include" });
  if (!res.ok) throw new Error("failed");
  return res.json();
}

export default function IntercompanyPage() {
  const { canManageFinance } = usePermissions();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["intercompany-links"],
    queryFn: fetchLinks,
    enabled: canManageFinance,
  });

  const voidMut = useMutation({
    mutationFn: (id: number) => apiPost(`/intercompany/links/${id}/void`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["intercompany-links"] });
      toast({ title: "تم إلغاء المرآة" });
    },
    onError: (e: unknown) => toast({ title: "فشل الإلغاء", description: String(e), variant: "destructive" }),
  });

  const resyncMut = useMutation({
    mutationFn: (id: number) => apiPost(`/intercompany/links/${id}/resync`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["intercompany-links"] });
      toast({ title: "تمت إعادة المزامنة" });
    },
    onError: (e: unknown) => toast({ title: "فشل إعادة المزامنة", description: String(e), variant: "destructive" }),
  });

  if (!canManageFinance) {
    return <div className="p-6 text-sm text-muted-foreground">لا تملك صلاحية الوصول لهذه الصفحة.</div>;
  }

  return (
    <div className="p-3 sm:p-4 md:p-6 space-y-4" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold">المعاملات بين الشركات</h1>
        <p className="text-sm text-muted-foreground">
          مرايا الفواتير وأوامر الشراء التي تربط شركتك بالشركات الشقيقة.
        </p>
      </div>

      <Tabs defaultValue="links">
        <TabsList>
          <TabsTrigger value="links">الروابط</TabsTrigger>
          <TabsTrigger value="elimination">إلغاء الازدواج (P&amp;L)</TabsTrigger>
          <TabsTrigger value="customers">ربط العملاء</TabsTrigger>
          <TabsTrigger value="suppliers">ربط الموردين</TabsTrigger>
        </TabsList>
        <TabsContent value="elimination" className="mt-4">
          <EliminationTab />
        </TabsContent>
        <TabsContent value="customers" className="mt-4">
          <PartyLinkTab kind="customer" />
        </TabsContent>
        <TabsContent value="suppliers" className="mt-4">
          <PartyLinkTab kind="supplier" />
        </TabsContent>
        <TabsContent value="links" className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">الروابط ({data?.length ?? 0})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : !data || data.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              لا توجد معاملات بين الشركات بعد.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>النوع</TableHead>
                  <TableHead>الاتجاه</TableHead>
                  <TableHead>مرجع المصدر</TableHead>
                  <TableHead>الشركة المصدر</TableHead>
                  <TableHead>مرجع الهدف</TableHead>
                  <TableHead>الشركة الهدف</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {row.kind === "sales_invoice" ? "فاتورة مبيعات" : "أمر شراء"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.direction === "outbound" ? "default" : "secondary"}>
                        {row.direction === "outbound" ? "صادر" : "وارد"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.sourceRef}</TableCell>
                    <TableCell>{row.sourceCompanyName}</TableCell>
                    <TableCell className="font-mono text-xs">{row.targetRef}</TableCell>
                    <TableCell>{row.targetCompanyName}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.status === "matched"
                            ? "default"
                            : row.status === "void"
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {row.status === "matched"
                          ? "متطابق"
                          : row.status === "unmatched"
                          ? "غير متطابق"
                          : row.status === "void"
                          ? "ملغى"
                          : "مُعاد المزامنة"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.createdAt).toLocaleString("ar-SA")}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={row.status === "void" || row.direction === "inbound"}
                          onClick={() => resyncMut.mutate(row.id)}
                        >
                          <RefreshCcw className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={row.status === "void" || row.direction === "inbound"}
                          onClick={() => voidMut.mutate(row.id)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
