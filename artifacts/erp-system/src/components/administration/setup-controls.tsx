import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetTeamSetup,useSaveTeamSetup,useSaveTeamPolicy,getGetTeamSetupQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/team-access";

/** Company-local existing setup/policy APIs, never a new subscription engine. */
export function AdministrationSetupControls({rights}:{rights:string[]}) {
  const qc=useQueryClient();
  const setup=useGetTeamSetup({query:{queryKey:getGetTeamSetupQueryKey(),retry:false}});
  const save=useSaveTeamSetup(),policy=useSaveTeamPolicy();
  const [message,setMessage]=useState("");
  const [seats,setSeats]=useState("");
  const refresh=()=>qc.invalidateQueries({queryKey:getGetTeamSetupQueryKey()});
  const choose=async(mode:"solo"|"team")=>{
    if(!setup.data)return;
    try{
      await save.mutateAsync({data:{expectedRevision:setup.data.revision,mode,step:setup.data.step,
        draft:setup.data.draft as Record<string,unknown>}});
      setMessage("حفظ وضع العمل دون تغيير صلاحيات الموظفين أو مسودات مسؤول المستخدمين.");await refresh();
    }catch(e){setMessage(errorText(e));await refresh();}
  };
  const updateLimit=async()=>{
    if(!setup.data)return;
    const limit=seats.trim()===""?null:Number(seats);
    if(limit!==null&&(!Number.isInteger(limit)||limit<0)){setMessage("حد المقاعد عدد صحيح غير سالب، أو اتركه فارغًا.");return;}
    try{
      await policy.mutateAsync({data:{enabledModules:setup.data.policy.enabledModules,seatLimit:limit}});
      setMessage("حفظ حد الدخول التطويري؛ لم يشترِ أو يغير اشتراكًا مدفوعًا.");await refresh();
    }catch(e){setMessage(errorText(e));}
  };
  return <section className="rounded-2xl border bg-card p-4 space-y-3" data-testid="panel-administration-controls" dir="rtl">
    <h2 className="font-bold">مسؤوليات الإعداد والاشتراك</h2>
    {setup.isLoading?<p>جارٍ تحميل إعداد المنشأة…</p>:setup.error?<div role="alert">{errorText(setup.error)} <Button variant="outline" onClick={()=>void setup.refetch()}>إعادة المحاولة</Button></div>:setup.data&&<>
      {rights.includes("settings")&&<div className="space-y-2"><p className="text-sm">وضع العمل لا يثبت الملكية ولا يمنح صلاحيات مالية. الإعداد الحالي: {setup.data.mode==="solo"?"بمفردي":"فريق"}.</p>
        <Button size="sm" variant="outline" disabled={save.isPending} onClick={()=>void choose("solo")} data-testid="button-administration-solo">أعمل بمفردي</Button>{" "}
        <Button size="sm" variant="outline" disabled={save.isPending} onClick={()=>void choose("team")} data-testid="button-administration-team">لدي فريق</Button>
      </div>}
      {rights.includes("subscription")&&<div className="space-y-2 border-t pt-3 text-sm">
        <p>المقاعد النشطة: {setup.data.policy.activeLoginSeats}؛ الأماكن المحجوزة: {setup.data.policy.reservedAccessSlots}؛ الحد الحالي: {setup.data.policy.seatLimit??"غير محدد"}.</p>
        <p className="text-muted-foreground">تعديل الحدود هنا تطويري فقط، ويرفضه الخادم في الإنتاج. لا شراء أو تسعير أو تحصيل مدفوع.</p>
        <Label htmlFor="administration-seat-limit">حد دخول تطويري جديد (فارغ = غير محدد)</Label>
        <Input id="administration-seat-limit" value={seats} onChange={e=>setSeats(e.target.value)} inputMode="numeric" className="max-w-xs"/>
        <Button size="sm" variant="outline" disabled={policy.isPending} onClick={()=>void updateLimit()} data-testid="button-administration-policy">حفظ الحد التطويري</Button>
      </div>}
    </>}
    {message&&<p role="status" className="text-sm">{message}</p>}
  </section>;
}
