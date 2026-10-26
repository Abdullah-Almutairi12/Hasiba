import {useEffect,useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {apiGet} from "@/hooks/use-api";
import {useAuth} from "@/hooks/use-auth";
import {Card,CardContent,CardHeader,CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";

type Policy={allowCreator?:boolean;allowParticipant?:boolean;revision:number};
export function ProcurementReceivingPolicy({kind="procurement"}:{kind?:"procurement"|"stocktake"}={}){
  const stocktake=kind==="stocktake",path=stocktake?"/team/stocktake-policy":"/team/procurement-receiving-policy";
  const field=stocktake?"allowParticipant":"allowCreator";
  const proofPrefix=stocktake?"stocktake-policy":"receipt-policy";
  const {user}=useAuth(),activeCompanyId=user?.companyId??null,qc=useQueryClient();
  const key=[stocktake?"stocktake-separation-policy":"procurement-receiving-policy",activeCompanyId];
  const q=useQuery({queryKey:key,queryFn:()=>apiGet<Policy>(path),retry:false});
  const [reason,setReason]=useState("");
  const [allow,setAllow]=useState(false),[password,setPassword]=useState(""),[token,setToken]=useState(""),
    [recovery,setRecovery]=useState(""),[pending,setPending]=useState(false),[message,setMessage]=useState("");
  useEffect(()=>{if(q.data)setAllow(q.data[field]===true);},[q.data,field]);
  useEffect(()=>{setPassword("");setToken("");setRecovery("");setMessage("");},[activeCompanyId]);
  async function save(){
    if(!q.data)return;
    setPending(true);setMessage("");
    try{
      const res=await fetch(`${import.meta.env.BASE_URL.replace(/\/$/,"")}/api${path}`,{
        method:"PUT",credentials:"include",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({[field]:allow,revision:q.data.revision,...(stocktake?{reason}:{}),
          proof:{currentPassword:password,...(token?{token}:{}),...(recovery?{recoveryCode:recovery}:{})}})});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error??"تعذر تحديث السياسة");
      qc.setQueryData(key,data);setMessage("حُفظت سياسة المنشأة مع تأكيد الهوية وتدقيق التغيير.");
      await qc.invalidateQueries({queryKey:key});
    }catch(e){setMessage(e instanceof Error?e.message:"تعذر حفظ السياسة؛ أعد المحاولة");}
    finally{setPending(false);setPassword("");setToken("");setRecovery("");}
  }
  return <Card data-testid={stocktake?"stocktake-separation-policy":"procurement-receiving-policy"}><CardHeader><CardTitle>{stocktake?"سياسة فصل مهام اعتماد فروق الجرد":"سياسة الفصل عند استلام المشتريات"}</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      {stocktake?<p>الافتراضي: لا يعتمد أي مشارك في العد فروق الجلسة. الاستثناء يحتاج سياسة منشأة وإذن «استثناء اعتماد جلسة شاركت في عدها» وحدًا ماليًا صريحًا وسببًا وتأكيد هوية عند الاعتماد؛ لا يمنحه اسم المدير أو المالك. هوية العد التاريخية المفقودة لا تقبل استثناء.</p>:<>
        <p>الافتراضي: يستلم شخص مختلف عن منشئ أمر الشراء. السماح المرن يحتاج أيضًا إذن «استلام أمر أنشأته بنفسي» مع القراءة والاستلام والنطاق والحدود.</p>
        <p>لا يغيّر ذلك اعتماد الأمر ولا يجيز اعتمادًا ذاتيًا أو صرفًا أو تعديل أسعار. لا يُفعّل تلقائيًا بسبب اسم الدور أو عدد الموظفين.</p></>}
      {q.isLoading?<p>جارٍ تحميل السياسة…</p>:q.isError?<p role="alert">إدارة هذه السياسة تتطلب مسؤولية إعدادات المنشأة. {q.error.message}</p>:<>
        <Label className="flex items-center gap-2"><input type="checkbox" checked={allow} disabled={pending}
          onChange={e=>setAllow(e.target.checked)} aria-label={stocktake?"السماح باستثناء صريح لمشارك العد":"السماح لمنشئ أمر الشراء باستلامه"}/>{stocktake?"السماح باستثناء صريح لمشارك العد":"السماح لمنشئ أمر الشراء باستلامه بإذن صريح"}</Label>
        <p>الحالة المحفوظة: {q.data?.[field]?"السماح المرن بإذن مستقل":stocktake?"اشتراط معتمد مستقل":"اشتراط مستلم مختلف"} — النسخة {q.data?.revision}</p>
        {stocktake&&<><Label htmlFor="stocktake-policy-reason">سبب تغيير سياسة الجرد</Label>
          <Input id="stocktake-policy-reason" value={reason} maxLength={500} onChange={e=>setReason(e.target.value)}/></>}
        <Label htmlFor={`${proofPrefix}-password`}>كلمة مرور حسابك لتأكيد الهوية</Label>
        <Input id={`${proofPrefix}-password`} type="password" autoComplete="current-password" value={password} disabled={pending} onChange={e=>setPassword(e.target.value)}/>
        <Label htmlFor={`${proofPrefix}-token`}>رمز تطبيق المصادقة إن كان مفعّلًا</Label>
        <Input id={`${proofPrefix}-token`} type="password" autoComplete="one-time-code" value={token} disabled={pending} onChange={e=>setToken(e.target.value)}/>
        <Label htmlFor={`${proofPrefix}-recovery`}>رمز استعادة بدل رمز التطبيق عند الحاجة</Label>
        <Input id={`${proofPrefix}-recovery`} type="password" autoComplete="off" value={recovery} disabled={pending} onChange={e=>setRecovery(e.target.value)}/>
        <Button onClick={save} disabled={pending||!password||allow===(q.data?.[field]===true)||(stocktake&&reason.trim().length<3)}>{pending?"جارٍ التأكيد والحفظ…":stocktake?"تأكيد الهوية وحفظ سياسة الجرد":"تأكيد الهوية وحفظ سياسة الاستلام"}</Button>
      </>}
      {message&&<p role="status">{message}</p>}
    </CardContent></Card>;
}
