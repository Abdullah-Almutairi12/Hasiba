import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type JSX } from "react";
import {
  AlertTriangle,
  FileWarning,
  Loader2,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface ComplianceAlert {
  id: number;
  kind: "transfer_pricing" | "agreement_missing" | "zakat";
  severity: "warning" | "critical";
  refType: string;
  refId: number;
  ref: string | null;
  counterpartyCompanyId: number | null;
  message: string;
  deviationPct: string | null;
  details: Record<string, unknown>;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
}

interface Agreement {
  id: number;
  counterpartyCompanyId: number;
  counterpartyName: string;
  title: string;
  pdfUrl: string;
  pdfFilename: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  uploadedAt: string;
  notes: string | null;
}

interface Sibling {
  id: number;
  name: string;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`${r.status} ${text}`);
  }
  return r.json() as Promise<T>;
}

function kindBadge(kind: ComplianceAlert["kind"]): JSX.Element {
  if (kind === "transfer_pricing")
    return <Badge variant="destructive">تسعير تحويلي</Badge>;
  if (kind === "agreement_missing")
    return <Badge variant="destructive">اتفاقية مفقودة</Badge>;
  return <Badge variant="secondary">زكاة</Badge>;
}

function severityBadge(s: ComplianceAlert["severity"]): JSX.Element {
  return s === "critical" ? (
    <Badge variant="destructive">حرج</Badge>
  ) : (
    <Badge variant="outline">تحذير</Badge>
  );
}

function AlertsTab(): JSX.Element {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [status, setStatus] = useState<"open" | "resolved" | "dismissed" | "all">("open");
  const [kind, setKind] = useState<ComplianceAlert["kind"] | "all">("all");

  const queryKey = useMemo(
    () => ["compliance-alerts", status, kind] as const,
    [status, kind],
  );

  const { data = [], isLoading } = useQuery<ComplianceAlert[]>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (kind !== "all") params.set("kind", kind);
      const qs = params.toString();
      return getJson<ComplianceAlert[]>(
        `/api/compliance/alerts${qs ? `?${qs}` : ""}`,
      );
    },
  });

  const resolveMut = useMutation({
    mutationFn: (vars: { id: number; status: "resolved" | "dismissed"; note?: string }) =>
      postJson(`/api/compliance/alerts/${vars.id}/resolve`, {
        status: vars.status,
        note: vars.note,
      }),
    onSuccess: () => {
      toast({ title: "تم تحديث التنبيه" });
      void qc.invalidateQueries({ queryKey: ["compliance-alerts"] });
    },
    onError: (e: unknown) =>
      toast({ title: "تعذر التحديث", description: String(e), variant: "destructive" }),
  });

  const zakatMut = useMutation({
    mutationFn: () => postJson("/api/compliance/zakat/run", {}),
    onSuccess: (r: unknown) => {
      const res = r as { alertsCreated: number; exposuresChecked: number };
      toast({
        title: "اكتمل فحص الزكاة",
        description: `تنبيهات جديدة: ${res.alertsCreated} · حسابات: ${res.exposuresChecked}`,
      });
      void qc.invalidateQueries({ queryKey: ["compliance-alerts"] });
    },
    onError: (e: unknown) =>
      toast({ title: "فشل الفحص", description: String(e), variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="size-5 text-amber-500" />
          تنبيهات الامتثال
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">مفتوحة</SelectItem>
              <SelectItem value="resolved">محلولة</SelectItem>
              <SelectItem value="dismissed">مرفوضة</SelectItem>
              <SelectItem value="all">الكل</SelectItem>
            </SelectContent>
          </Select>
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأنواع</SelectItem>
              <SelectItem value="transfer_pricing">تسعير تحويلي</SelectItem>
              <SelectItem value="agreement_missing">اتفاقية مفقودة</SelectItem>
              <SelectItem value="zakat">زكاة</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => zakatMut.mutate()}
            disabled={zakatMut.isPending}
          >
            {zakatMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            فحص الزكاة الآن
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin" /></div>
        ) : data.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">لا توجد تنبيهات</div>
        ) : (
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الخطورة</TableHead>
                  <TableHead>المرجع</TableHead>
                  <TableHead>الانحراف %</TableHead>
                  <TableHead className="w-[40%]">الرسالة</TableHead>
                  <TableHead>إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap text-xs">{a.createdAt.slice(0, 10)}</TableCell>
                    <TableCell>{kindBadge(a.kind)}</TableCell>
                    <TableCell>{severityBadge(a.severity)}</TableCell>
                    <TableCell className="font-mono text-xs">{a.ref ?? `${a.refType}#${a.refId}`}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.deviationPct ? `${Number(a.deviationPct).toFixed(2)}٪` : "—"}
                    </TableCell>
                    <TableCell className="text-sm">{a.message}</TableCell>
                    <TableCell>
                      {a.status === "open" ? (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => resolveMut.mutate({ id: a.id, status: "resolved" })}
                            disabled={resolveMut.isPending}
                          >
                            حل
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => resolveMut.mutate({ id: a.id, status: "dismissed" })}
                            disabled={resolveMut.isPending}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      ) : (
                        <Badge variant="outline">{a.status}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UploadAgreementDialog({
  siblings,
  onUploaded,
}: {
  siblings: Sibling[];
  onUploaded: () => void;
}): JSX.Element {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [counterpartyId, setCounterpartyId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [effectiveTo, setEffectiveTo] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = (): void => {
    setCounterpartyId("");
    setTitle("");
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setEffectiveTo("");
    setNotes("");
    setFile(null);
  };

  const submit = async (): Promise<void> => {
    if (!file || !counterpartyId || !title || !effectiveFrom) {
      toast({ title: "بيانات ناقصة", variant: "destructive" });
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast({ title: "يجب أن يكون الملف PDF", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
      const contentBase64 = btoa(binary);
      const uploaded = await postJson<{ url: string; filename: string }>(
        "/api/storage/attachments",
        { filename: file.name, contentBase64 },
      );
      await postJson("/api/compliance/agreements", {
        counterpartyCompanyId: Number(counterpartyId),
        title,
        pdfUrl: uploaded.url,
        pdfFilename: uploaded.filename,
        effectiveFrom,
        effectiveTo: effectiveTo || null,
        notes: notes || undefined,
      });
      toast({ title: "تم رفع الاتفاقية" });
      reset();
      setOpen(false);
      onUploaded();
    } catch (err) {
      toast({ title: "فشل الرفع", description: String(err), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Upload className="size-4" /> رفع اتفاقية</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>اتفاقية بين الشركات</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>الشركة المقابلة</Label>
            <Select value={counterpartyId} onValueChange={setCounterpartyId}>
              <SelectTrigger><SelectValue placeholder="اختر شركة" /></SelectTrigger>
              <SelectContent>
                {siblings.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>عنوان الاتفاقية</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>سارية من</Label>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
            </div>
            <div>
              <Label>سارية إلى (اختياري)</Label>
              <Input type="date" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>ملف PDF</Label>
            <Input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div>
            <Label>ملاحظات (اختياري)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            رفع وحفظ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgreementsTab(): JSX.Element {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data = [], isLoading } = useQuery<Agreement[]>({
    queryKey: ["compliance-agreements"],
    queryFn: () => getJson<Agreement[]>("/api/compliance/agreements"),
  });
  const { data: siblings = [] } = useQuery<Sibling[]>({
    queryKey: ["companies-siblings"],
    queryFn: () => getJson<Sibling[]>("/api/companies/siblings"),
  });

  const deactivate = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/compliance/agreements/${id}`, {
        method: "DELETE",
        credentials: "include",
      }).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
      }),
    onSuccess: () => {
      toast({ title: "تم إلغاء التفعيل" });
      void qc.invalidateQueries({ queryKey: ["compliance-agreements"] });
    },
    onError: (e) => toast({ title: "فشل", description: String(e), variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <FileWarning className="size-5" />
          اتفاقيات بين الشركات
        </CardTitle>
        <UploadAgreementDialog
          siblings={siblings}
          onUploaded={() => void qc.invalidateQueries({ queryKey: ["compliance-agreements"] })}
        />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin" /></div>
        ) : data.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            لم يتم رفع أي اتفاقية. ارفع اتفاقية لتغطية تسعير المعاملات بين الشركات.
          </div>
        ) : (
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الشركة المقابلة</TableHead>
                  <TableHead>العنوان</TableHead>
                  <TableHead>السريان</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>PDF</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((ag) => (
                  <TableRow key={ag.id}>
                    <TableCell>{ag.counterpartyName}</TableCell>
                    <TableCell>{ag.title}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {ag.effectiveFrom} → {ag.effectiveTo ?? "∞"}
                    </TableCell>
                    <TableCell>
                      {ag.isActive ? <Badge>سارية</Badge> : <Badge variant="outline">ملغية</Badge>}
                    </TableCell>
                    <TableCell>
                      <a href={ag.pdfUrl} target="_blank" rel="noreferrer" className="text-primary underline">
                        فتح
                      </a>
                    </TableCell>
                    <TableCell>
                      {ag.isActive ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deactivate.mutate(ag.id)}
                          disabled={deactivate.isPending}
                        >
                          <X className="size-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Phase 3 — compliance console (transfer pricing, agreements, zakat). */
export default function CompliancePage(): JSX.Element {
  useEffect(() => {
    document.title = "الامتثال · حاسبة.AI";
  }, []);
  return (
    <div className="space-y-4 p-3 sm:p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold">الامتثال والتدقيق</h1>
        <p className="text-sm text-muted-foreground">
          تسعير تحويلي · اتفاقيات بين الشركات · مراقبة وعاء الزكاة
        </p>
      </div>
      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts">التنبيهات</TabsTrigger>
          <TabsTrigger value="agreements">الاتفاقيات</TabsTrigger>
        </TabsList>
        <TabsContent value="alerts" className="mt-4"><AlertsTab /></TabsContent>
        <TabsContent value="agreements" className="mt-4"><AgreementsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
