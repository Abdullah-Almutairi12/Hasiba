import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText, Download } from "lucide-react";
import { useVatEnabled } from "@/hooks/use-vat-status";

/**
 * Dashboard card that lets accountants pick a quarter and download
 * the quarterly ZATCA VAT-return PDF. Hidden for tenants whose VAT
 * registration status is `not_registered` (gated by `useVatEnabled`).
 */
export function VatReturnCard() {
  const enabled = useVatEnabled();
  const apiBase = (import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/api";
  const now = new Date();
  const defaultQuarter = (Math.floor(now.getMonth() / 3) + 1) as 1 | 2 | 3 | 4;
  // Default to the most recently CLOSED quarter when possible —
  // accountants almost never file the current one.
  const defaultPrevQuarter: 1 | 2 | 3 | 4 = defaultQuarter === 1 ? 4 : ((defaultQuarter - 1) as 1 | 2 | 3 | 4);
  const defaultYear = defaultQuarter === 1 ? now.getFullYear() - 1 : now.getFullYear();
  const [year, setYear] = useState(String(defaultYear));
  const [quarter, setQuarter] = useState(String(defaultPrevQuarter));

  const years = useMemo(() => {
    const y = now.getFullYear();
    return [y, y - 1, y - 2, y - 3];
  }, [now]);

  if (!enabled) return null;

  const pdfUrl = `${apiBase}/vat/return?year=${year}&quarter=${quarter}&format=pdf`;

  return (
    <Card className="bg-card" data-testid="vat-return-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <FileText className="size-4 text-blue-500" />
          الإقرار الضريبي ربع السنوي
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          صدّر تقرير ZATCA لربع كامل (المخرجات − المدخلات) جاهز للرفع على بوابة هيئة الزكاة.
        </p>
        <div className="flex gap-2">
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="h-9 flex-1" data-testid="select-vat-year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={quarter} onValueChange={setQuarter}>
            <SelectTrigger className="h-9 w-28" data-testid="select-vat-quarter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">الربع 1</SelectItem>
              <SelectItem value="2">الربع 2</SelectItem>
              <SelectItem value="3">الربع 3</SelectItem>
              <SelectItem value="4">الربع 4</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          asChild
          size="sm"
          className="w-full gap-2"
          data-testid="button-vat-return-download"
        >
          <a href={pdfUrl} target="_blank" rel="noopener">
            <Download className="size-4" />
            تنزيل PDF
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
