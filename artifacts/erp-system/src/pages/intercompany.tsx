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
          <TabsTrigger value="customers">ربط العملاء</TabsTrigger>
          <TabsTrigger value="suppliers">ربط الموردين</TabsTrigger>
        </TabsList>
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
