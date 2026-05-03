import React, { useMemo, useState } from "react";
import { Money } from "@/components/riyal";
import {
  useGetAccountingSummary,
  useListJournalEntries,
  useGetZatcaStatus,
  useListAccounts,
  useListCurrencies,
  useListFiscalYears,
  usePostJournalEntry,
  useReverseJournalEntry,
  useCloseFiscalPeriod,
  useReopenFiscalPeriod,
  useCreateJournalEntry,
  useGetTrialBalance,
  type Account,
  type JournalEntry,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calculator,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  XCircle,
  Plus,
  Trash2,
  Lock,
  Unlock,
  ShieldCheck,
  RefreshCcw,
  BookOpen,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: "أصول",
  liability: "خصوم",
  equity: "حقوق ملكية",
  revenue: "إيرادات",
  expense: "مصروفات",
};
const ACCOUNT_TYPE_COLORS: Record<string, string> = {
  asset: "bg-blue-100 text-blue-700",
  liability: "bg-red-100 text-red-700",
  equity: "bg-purple-100 text-purple-700",
  revenue: "bg-emerald-100 text-emerald-700",
  expense: "bg-amber-100 text-amber-700",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "مسودة",
  posted: "مرحَّل",
  reversed: "معكوس",
};
const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive"> =
  {
    draft: "secondary",
    posted: "default",
    reversed: "destructive",
  };

export default function Accounting() {
  return (
    <div className="space-y-6 pb-8 max-w-7xl mx-auto">
      <SummaryCards />
      <Tabs defaultValue="journal" dir="rtl" className="w-full">
        <TabsList className="grid grid-cols-5 w-full max-w-3xl">
          <TabsTrigger value="journal">دفتر اليومية</TabsTrigger>
          <TabsTrigger value="new">قيد جديد</TabsTrigger>
          <TabsTrigger value="coa">دليل الحسابات</TabsTrigger>
          <TabsTrigger value="periods">الفترات المالية</TabsTrigger>
          <TabsTrigger value="zatca">زاتكا</TabsTrigger>
        </TabsList>
        <TabsContent value="journal" className="mt-4">
          <JournalTab />
        </TabsContent>
        <TabsContent value="new" className="mt-4">
          <NewEntryTab />
        </TabsContent>
        <TabsContent value="coa" className="mt-4">
          <ChartOfAccountsTab />
        </TabsContent>
        <TabsContent value="periods" className="mt-4">
          <FiscalPeriodsTab />
        </TabsContent>
        <TabsContent value="zatca" className="mt-4">
          <ZatcaTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCards() {
  const { data: summary, isLoading } = useGetAccountingSummary();
  const { data: tb } = useGetTrialBalance();
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-4">
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">صافي النقدية</CardTitle>
          <ArrowUpRight className="h-4 w-4 text-emerald-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            <Money value={summary?.netCashFlow ?? 0} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">الذمم المدينة</CardTitle>
          <ArrowDownRight className="h-4 w-4 text-blue-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            <Money value={summary?.receivables ?? 0} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">الذمم الدائنة</CardTitle>
          <ArrowDownRight className="h-4 w-4 text-amber-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            <Money value={summary?.payables ?? 0} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">حالة ميزان المراجعة</CardTitle>
          {tb?.isBalanced ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          ) : (
            <XCircle className="h-4 w-4 text-red-600" />
          )}
        </CardHeader>
        <CardContent>
          <div className="text-lg font-semibold">
            {tb?.isBalanced ? "متوازن" : "غير متوازن"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            مدين: <Money value={tb?.totalDebit ?? 0} /> · دائن:{" "}
            <Money value={tb?.totalCredit ?? 0} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function JournalTab() {
  const { data: entries, isLoading } = useListJournalEntries();
  const qc = useQueryClient();
  const post = usePostJournalEntry({
    mutation: {
      onSuccess: () => {
        toast.success("تم ترحيل القيد");
        qc.invalidateQueries();
      },
      onError: (e: any) =>
        toast.error(e?.response?.data?.error ?? "تعذر الترحيل"),
    },
  });
  const reverse = useReverseJournalEntry({
    mutation: {
      onSuccess: () => {
        toast.success("تم عكس القيد");
        qc.invalidateQueries();
      },
      onError: (e: any) =>
        toast.error(e?.response?.data?.error ?? "تعذر العكس"),
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-4 w-4" /> دفتر اليومية
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>رقم القيد</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>البيان</TableHead>
                <TableHead>المصدر</TableHead>
                <TableHead>المبلغ</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(entries ?? []).map((e: JournalEntry) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs">
                    {e.entryNumber}
                  </TableCell>
                  <TableCell>{e.entryDate}</TableCell>
                  <TableCell className="max-w-xs truncate">
                    {e.description}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{e.source}</Badge>
                  </TableCell>
                  <TableCell>
                    <Money value={e.totalAmount} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[e.status] ?? "secondary"}>
                      {STATUS_LABELS[e.status] ?? e.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="flex gap-1">
                    {e.status === "draft" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => post.mutate({ id: e.id })}
                      >
                        ترحيل
                      </Button>
                    )}
                    {e.status === "posted" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => reverse.mutate({ id: e.id, data: {} })}
                      >
                        <RefreshCcw className="h-3 w-3" /> عكس
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(entries ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center text-muted-foreground py-8"
                  >
                    لا توجد قيود محاسبية بعد. أنشئ قيداً جديداً من تبويب «قيد
                    جديد».
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

interface NewLine {
  accountId: number | null;
  description: string;
  debit: number;
  credit: number;
}

function NewEntryTab() {
  const { data: accounts } = useListAccounts();
  const { data: currencies } = useListCurrencies();
  const qc = useQueryClient();
  const create = useCreateJournalEntry({
    mutation: {
      onSuccess: () => {
        toast.success("تم إنشاء القيد");
        qc.invalidateQueries();
        setLines([
          { accountId: null, description: "", debit: 0, credit: 0 },
          { accountId: null, description: "", debit: 0, credit: 0 },
        ]);
        setDescription("");
        setReference("");
      },
      onError: (e: any) =>
        toast.error(e?.response?.data?.error ?? "تعذر الإنشاء"),
    },
  });
  const [entryDate, setEntryDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [currencyCode, setCurrencyCode] = useState("SAR");
  const [status, setStatus] = useState<"draft" | "posted">("posted");
  const [lines, setLines] = useState<NewLine[]>([
    { accountId: null, description: "", debit: 0, credit: 0 },
    { accountId: null, description: "", debit: 0, credit: 0 },
  ]);

  const postable = (accounts ?? []).filter((a: Account) => !a.isGroup);
  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005 && totalDebit > 0;

  function update(i: number, patch: Partial<NewLine>) {
    setLines((arr) =>
      arr.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
    );
  }
  function addLine() {
    setLines((arr) => [
      ...arr,
      { accountId: null, description: "", debit: 0, credit: 0 },
    ]);
  }
  function removeLine(i: number) {
    setLines((arr) => arr.filter((_, idx) => idx !== i));
  }

  function submit() {
    if (!balanced) {
      toast.error("القيد غير متوازن");
      return;
    }
    if (!description.trim()) {
      toast.error("البيان مطلوب");
      return;
    }
    const cleanLines = lines
      .filter((l) => l.accountId && (l.debit > 0 || l.credit > 0))
      .map((l) => ({
        accountId: l.accountId!,
        description: l.description || undefined,
        debit: Number(l.debit) || 0,
        credit: Number(l.credit) || 0,
      }));
    if (cleanLines.length < 2) {
      toast.error("القيد يجب أن يحتوي على سطرين على الأقل");
      return;
    }
    create.mutate({
      data: {
        entryDate,
        description,
        reference: reference || null,
        currencyCode,
        status,
        lines: cleanLines,
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>قيد محاسبي جديد</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label>التاريخ</Label>
            <Input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
            />
          </div>
          <div>
            <Label>المرجع</Label>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="اختياري"
            />
          </div>
          <div>
            <Label>العملة</Label>
            <Select value={currencyCode} onValueChange={setCurrencyCode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(currencies ?? []).map((c: any) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.symbol} {c.nameAr}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>الحالة</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as "draft" | "posted")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">حفظ كمسودة</SelectItem>
                <SelectItem value="posted">حفظ وترحيل</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>البيان</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="وصف القيد"
            rows={2}
          />
        </div>
        <div className="border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الحساب</TableHead>
                <TableHead>الوصف</TableHead>
                <TableHead className="w-32">مدين</TableHead>
                <TableHead className="w-32">دائن</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((ln, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Select
                      value={ln.accountId ? String(ln.accountId) : ""}
                      onValueChange={(v) =>
                        update(i, { accountId: Number(v) })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="اختر حساباً" />
                      </SelectTrigger>
                      <SelectContent>
                        {postable.map((a: Account) => (
                          <SelectItem key={a.id} value={String(a.id)}>
                            {a.code} — {a.nameAr}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      value={ln.description}
                      onChange={(e) =>
                        update(i, { description: e.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={ln.debit || ""}
                      onChange={(e) =>
                        update(i, {
                          debit: Number(e.target.value),
                          credit: 0,
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={ln.credit || ""}
                      onChange={(e) =>
                        update(i, {
                          credit: Number(e.target.value),
                          debit: 0,
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    {lines.length > 2 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeLine(i)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold bg-muted/30">
                <TableCell colSpan={2}>الإجمالي</TableCell>
                <TableCell>
                  <Money value={totalDebit} />
                </TableCell>
                <TableCell>
                  <Money value={totalCredit} />
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between">
          <Button variant="outline" onClick={addLine}>
            <Plus className="h-4 w-4 ml-1" /> إضافة سطر
          </Button>
          <div className="flex items-center gap-3">
            <Badge variant={balanced ? "default" : "destructive"}>
              {balanced
                ? "متوازن"
                : `الفرق: ${(totalDebit - totalCredit).toFixed(2)}`}
            </Badge>
            <Button
              onClick={submit}
              disabled={!balanced || create.isPending}
            >
              {status === "posted" ? "حفظ وترحيل" : "حفظ كمسودة"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartOfAccountsTab() {
  const { data: accounts, isLoading } = useListAccounts();
  return (
    <Card>
      <CardHeader>
        <CardTitle>دليل الحسابات</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الكود</TableHead>
                <TableHead>الاسم</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>العملة</TableHead>
                <TableHead>المفتاح النظامي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(accounts ?? []).map((a: Account) => (
                <TableRow key={a.id}>
                  <TableCell className="font-mono">{a.code}</TableCell>
                  <TableCell
                    className={a.isGroup ? "font-semibold" : ""}
                    style={
                      !a.isGroup
                        ? { paddingInlineStart: 16 }
                        : undefined
                    }
                  >
                    {a.nameAr}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${ACCOUNT_TYPE_COLORS[a.type]}`}
                    >
                      {ACCOUNT_TYPE_LABELS[a.type]}
                    </span>
                  </TableCell>
                  <TableCell>{a.currencyCode}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {a.systemKey ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function FiscalPeriodsTab() {
  const { data: years, isLoading } = useListFiscalYears();
  const qc = useQueryClient();
  const close = useCloseFiscalPeriod({
    mutation: {
      onSuccess: () => {
        toast.success("تم إقفال الفترة");
        qc.invalidateQueries();
      },
      onError: (e: any) =>
        toast.error(e?.response?.data?.error ?? "تعذر الإقفال"),
    },
  });
  const reopen = useReopenFiscalPeriod({
    mutation: {
      onSuccess: () => {
        toast.success("تم إعادة فتح الفترة");
        qc.invalidateQueries();
      },
      onError: (e: any) =>
        toast.error(e?.response?.data?.error ?? "تعذر إعادة الفتح"),
    },
  });
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  return (
    <div className="space-y-4">
      {(years ?? []).map((y: any) => (
        <Card key={y.id}>
          <CardHeader>
            <CardTitle>
              السنة المالية {y.name} ({y.startDate} → {y.endDate})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الفترة</TableHead>
                  <TableHead>من</TableHead>
                  <TableHead>إلى</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>إجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(y.periods ?? []).map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.startDate}</TableCell>
                    <TableCell>{p.endDate}</TableCell>
                    <TableCell>
                      <Badge
                        variant={p.status === "open" ? "default" : "secondary"}
                      >
                        {p.status === "open" ? "مفتوحة" : "مغلقة"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {p.status === "open" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => close.mutate({ id: p.id })}
                        >
                          <Lock className="h-3 w-3 ml-1" /> إقفال
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => reopen.mutate({ id: p.id })}
                        >
                          <Unlock className="h-3 w-3 ml-1" /> إعادة فتح
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ZatcaTab() {
  const { data: zatca } = useGetZatcaStatus();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> حالة التكامل مع زاتكا
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span>الاتصال</span>
            <Badge variant={zatca?.connected ? "default" : "destructive"}>
              {zatca?.connected ? "متصل" : "غير متصل"}
            </Badge>
          </div>
          <div className="flex justify-between">
            <span>انتهاء الشهادة (يوم)</span>
            <span>{zatca?.certExpiry ?? "-"}</span>
          </div>
          <div className="flex justify-between">
            <span>آخر مزامنة</span>
            <span className="text-sm text-muted-foreground">
              {zatca?.lastSync ? new Date(zatca.lastSync).toLocaleString("ar-SA") : "-"}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
