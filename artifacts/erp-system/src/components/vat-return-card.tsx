import { useMemo,useRef,useState } from "react";
import { useTranslation } from "react-i18next";
import { Card,CardContent,CardHeader,CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "@/components/ui/select";
import { FileText,Download } from "lucide-react";
import { useVatEnabled } from "@/hooks/use-vat-status";
import { downloadPdf,DownloadError } from "@/lib/download-file";
export function VatReturnCard(){
  const enabled=useVatEnabled(),{i18n}=useTranslation(),en=i18n.language.startsWith("en");
  const now=new Date(),q=Math.floor(now.getMonth()/3)+1;
  const [year,setYear]=useState(String(q===1?now.getFullYear()-1:now.getFullYear()));
  const [quarter,setQuarter]=useState(String(q===1?4:q-1));
  const [busy,setBusy]=useState(false),[error,setError]=useState<DownloadError|null>(null);
  const working=useRef(false);
  const years=useMemo(()=>Array.from({length:4},(_,i)=>now.getFullYear()-i),[now.getFullYear()]);
  if(!enabled)return null;
  async function download(){
    if(working.current)return;working.current=true;setBusy(true);setError(null);
    try{
      const base=(import.meta.env.BASE_URL||"/").replace(/\/$/,"");
      await downloadPdf(`${base}/api/vat/return?year=${year}&quarter=${quarter}&format=pdf&lang=${en?"en":"ar"}`,`VAT-${year}-Q${quarter}-${en?"en":"ar"}.pdf`);
    }catch(e){setError(e instanceof DownloadError?e:new DownloadError("تعذر التنزيل","DOWNLOAD_FAILED"));}
    finally{working.current=false;setBusy(false);}
  }
  return <Card className="bg-card" data-testid="vat-return-card"><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="size-5"/>{en?"Quarterly VAT report":"تقرير ضريبة القيمة المضافة الربعي"}</CardTitle></CardHeader>
  <CardContent className="space-y-4">
  <p className="text-sm text-muted-foreground">{en?"For review and return preparation. Not an official upload format or evidence of filing.":"للمراجعة وإعداد الإقرار؛ ليس ملف رفع رسميًا ولا إثباتًا لتقديم الإقرار أو قبوله."}</p>
  <p className="text-xs text-muted-foreground">{en?"Current company · all branches · Asia/Riyadh time":"الشركة الحالية · جميع الفروع · توقيت الرياض"}</p>
  <div className="flex flex-wrap gap-3">
  <Select value={year} onValueChange={setYear} disabled={busy}><SelectTrigger className="h-9 w-28" data-testid="select-vat-year"><SelectValue/></SelectTrigger><SelectContent>{years.map(y=><SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent></Select>
  <Select value={quarter} onValueChange={setQuarter} disabled={busy}><SelectTrigger className="h-9 w-28" data-testid="select-vat-quarter"><SelectValue/></SelectTrigger><SelectContent>{[1,2,3,4].map(n=><SelectItem key={n} value={String(n)}>{en?"Quarter":"الربع"} {n}</SelectItem>)}</SelectContent></Select>
  </div>
  <Button type="button" size="sm" disabled={busy} onClick={download} className="w-full gap-2" data-testid="button-vat-return-download"><Download className="size-4"/>{busy?(en?"Generating…":"جارٍ الإنشاء…"):`${en?"Download":"تنزيل"} PDF — ${year} Q${quarter}`}</Button>
  {error&&<div role="alert" className="space-y-2 rounded border border-destructive/40 p-3 text-sm"><p>{en?"Report download failed":error.message}</p><p dir="ltr">{error.diagnosticRef}</p><Button type="button" variant="outline" size="sm" onClick={()=>navigator.clipboard.writeText(error.diagnosticRef)}>{en?"Copy diagnostic reference":"نسخ مرجع التشخيص"}</Button></div>}
  </CardContent></Card>;
}
