import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  useGetVatStatus,
  useUpdateVatRegistration,
  getGetVatStatusQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, AlertTriangle, FileText, Loader2 } from "lucide-react";

type Status = "registered" | "voluntary" | "not_registered";

function statusLabel(s: Status): string {
  if (s === "registered") return "مسجَّل إلزامي";
  if (s === "voluntary") return "مسجَّل اختياري";
  return "غير مسجَّل";
}

function statusBadge(s: Status) {
  if (s === "registered") return <Badge className="bg-emerald-600">مسجَّل</Badge>;
  if (s === "voluntary") return <Badge className="bg-cyan-600">اختياري</Badge>;
  return <Badge variant="outline">غير مسجَّل</Badge>;
}

/**
 * ZATCA SMB threshold counter card. Shows the rolling-12-month sales
 * total against the 375K SAR mandatory line plus a CTA to start the
 * registration flow when ≥ 80%.
 */
export function VatThresholdCard() {
  const { data, isLoading } = useGetVatStatus({
    query: { queryKey: getGetVatStatusQueryKey(), staleTime: 60_000 },
  });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [vatNumber, setVatNumber] = useState("");
  const [newStatus, setNewStatus] = useState<Status>("registered");

  // Seed the dialog fields from the tenant's persisted status the
  // first time data lands AND every time the dialog re-opens, so
  // saving without touching the radio cannot silently overwrite the
  // current registration status.
  useEffect(() => {
    if (data) {
      setNewStatus((data.status as Status) ?? "registered");
      setVatNumber(data.vatNumber ?? "");
    }
  }, [data, open]);

  const update = useUpdateVatRegistration({
    mutation: {
      onSuccess: () => {
        toast({ title: "تم تحديث حالة التسجيل في ضريبة القيمة المضافة" });
        void qc.invalidateQueries({ queryKey: getGetVatStatusQueryKey() });
        setOpen(false);
      },
      onError: (e: unknown) => {
        toast({
          title: "تعذر التحديث",
          description: String(e),
          variant: "destructive",
        });
      },
    },
  });

  if (isLoading || !data) {
    return (
      <Card className="bg-card">
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <ShieldCheck className="size-4" /> حالة ضريبة القيمة المضافة
          </CardTitle>
        </CardHeader>
        <CardContent className="h-28 grid place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const d = data as {
    status: Status;
    rolling12mSales: number;
    percentOfMandatory: number;
    near80: boolean;
    crossedMandatory: boolean;
    eligibleVoluntary: boolean;
    remainingToMandatory: number;
    mandatoryThreshold: number;
    vatNumber: string | null;
  };

  const pct = Math.min(100, d.percentOfMandatory);
  const barColor = d.crossedMandatory
    ? "bg-red-500"
    : d.near80
      ? "bg-amber-500"
      : "bg-emerald-500";

  return (
    <Card className="bg-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ShieldCheck className="size-4 text-emerald-500" />
          حالة ضريبة القيمة المضافة (ZATCA)
        </CardTitle>
        {statusBadge(d.status)}
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="flex justify-between items-baseline text-xs text-muted-foreground">
            <span>مبيعات آخر 12 شهرًا</span>
            <span className="font-mono">
              {d.rolling12mSales.toLocaleString("ar-SA", {
                maximumFractionDigits: 0,
              })}{" "}
              /{" "}
              {d.mandatoryThreshold.toLocaleString("ar-SA", {
                maximumFractionDigits: 0,
              })}{" "}
              ر.س
            </span>
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-muted overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className={`h-full ${barColor}`}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {d.percentOfMandatory.toFixed(1)}٪ من حد التسجيل الإلزامي
          </p>
        </div>

        {d.status === "not_registered" && d.crossedMandatory && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>
              تجاوزت الحد الإلزامي — يجب التسجيل في ZATCA خلال 30 يومًا.
            </span>
          </div>
        )}
        {d.status === "not_registered" && d.near80 && !d.crossedMandatory && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <span>اقتربت من الحد الإلزامي. يُنصح بالاستعداد للتسجيل.</span>
          </div>
        )}

        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">الحالة الحالية</span>
          <span className="font-medium">{statusLabel(d.status)}</span>
        </div>
        {d.vatNumber && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">الرقم الضريبي</span>
            <span className="font-mono">{d.vatNumber}</span>
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              variant={d.status === "not_registered" && d.near80 ? "default" : "outline"}
              className="w-full gap-2"
              data-testid="button-vat-start-registration"
            >
              <FileText className="size-4" />
              {d.status === "not_registered" ? "ابدأ التسجيل" : "تحديث الحالة"}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>تحديث حالة التسجيل في ضريبة القيمة المضافة</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>الحالة</Label>
                <Select
                  value={newStatus}
                  onValueChange={(v) => setNewStatus(v as Status)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="registered">مسجَّل إلزامي</SelectItem>
                    <SelectItem value="voluntary">مسجَّل اختياري</SelectItem>
                    <SelectItem value="not_registered">غير مسجَّل</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {newStatus !== "not_registered" && (
                <div>
                  <Label>الرقم الضريبي (15 رقمًا)</Label>
                  <Input
                    value={vatNumber}
                    onChange={(e) => setVatNumber(e.target.value)}
                    placeholder="3xxxxxxxxxxxxxxx"
                    inputMode="numeric"
                  />
                </div>
              )}
              {newStatus === "voluntary" && !d.eligibleVoluntary && (
                <p className="text-xs text-amber-600">
                  مبيعاتك أقل من حد التسجيل الاختياري (187,500 ر.س). قد يرفض ZATCA الطلب.
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                onClick={() =>
                  update.mutate({
                    data: {
                      status: newStatus,
                      vatNumber: newStatus === "not_registered" ? null : (vatNumber || d.vatNumber || null),
                    },
                  })
                }
                disabled={update.isPending}
              >
                {update.isPending && <Loader2 className="size-4 animate-spin" />}
                حفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
