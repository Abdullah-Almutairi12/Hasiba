import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLeaveCompanyMembership } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { errorText } from "@/lib/team-access";
import { ME_KEY } from "@/hooks/use-auth";

export function MembershipDeparture({ primary }: {primary:boolean}) {
  const leave=useLeaveCompanyMembership(),[,navigate]=useLocation();
  const qc=useQueryClient();
  const [departure,setDeparture]=useState<"suspend"|"terminate">("terminate");
  const [ack,setAck]=useState(false),[error,setError]=useState<string|null>(null);
  async function submit(){
    setError(null);
    try{
      await leave.mutateAsync({data:{acknowledge:true,departure}});
      qc.clear();
      qc.setQueryData(ME_KEY,null);
      navigate("/login");
    }catch(e){setError(errorText(e));}
  }
  return <section className="space-y-3 rounded-2xl border border-destructive/30 bg-card p-5" data-testid="panel-membership-departure">
    <h2 className="font-bold">خيارات عضويتي في المنشأة</h2>
    <p className="text-sm text-muted-foreground">المغادرة توقف جلساتك ووصولك لهذه المنشأة فقط. تحفظ العمليات والتاريخ والهوية والعضويات الأخرى، ولا تحذف أدلة المحاولات المالية المعلّقة على جهازك. راجع محاولات التحصيل غير المحسومة قبل المغادرة.</p>
    {primary?<p role="status" className="text-sm" data-testid="state-primary-cannot-leave">انقل مسؤولية مالك النظام إلى حساب مفعّل يقبل الاستلام قبل مغادرتك.</p>:<>
      <label className="flex flex-col gap-1 text-sm">الإجراء
        <select value={departure} onChange={e=>{setDeparture(e.target.value as typeof departure);setAck(false);}} className="rounded-md border bg-background p-2" data-testid="select-self-departure">
          <option value="suspend">تعليق وصولي لهذه المنشأة</option>
          <option value="terminate">إنهاء عضويتي بهذه المنشأة</option>
        </select>
      </label>
      <label className="flex items-start gap-2 text-sm"><Checkbox checked={ack} onCheckedChange={v=>setAck(v===true)} data-testid="checkbox-self-departure-ack"/> أفهم أن الوصول سيتوقف فورًا دون حذف السجل، وأنه لا يعاد تلقائيًا عند تسجيل الدخول.</label>
      {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button variant="destructive" disabled={!ack||leave.isPending} onClick={()=>void submit()} data-testid="button-self-departure">{leave.isPending?"جارٍ إيقاف الوصول…":"تأكيد مغادرتي لهذه المنشأة"}</Button>
    </>}
  </section>;
}
