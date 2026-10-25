import {useEffect,useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {apiGet} from "@/hooks/use-api";
import {useAuth} from "@/hooks/use-auth";
import {Card,CardContent,CardHeader,CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";

type Policy={allowCreator:boolean;revision:number};
export function ProcurementReceivingPolicy(){
  const {user}=useAuth(),activeCompanyId=user?.companyId??null,qc=useQueryClient();
  const key=["procurement-receiving-policy",activeCompanyId];
  const q=useQuery({queryKey:key,queryFn:()=>apiGet<Policy>("/team/procurement-receiving-policy"),retry:false});
  const [allow,setAllow]=useState(false),[password,setPassword]=useState(""),[token,setToken]=useState(""),
    [recovery,setRecovery]=useState(""),[pending,setPending]=useState(false),[message,setMessage]=useState("");
  useEffect(()=>{if(q.data)setAllow(q.data.allowCreator);},[q.data]);
  useEffect(()=>{setPassword("");setToken("");setRecovery("");setMessage("");},[activeCompanyId]);
  async function save(){
    if(!q.data)return;
    setPending(true);setMessage("");
    try{
      const res=await fetch(`${import.meta.env.BASE_URL.replace(/\/$/,"")}/api/team/procurement-receiving-policy`,{
        method:"PUT",credentials:"include",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({allowCreator:allow,revision:q.data.revision,
          proof:{currentPassword:password,...(token?{token}:{}),...(recovery?{recoveryCode:recovery}:{})}})});
      const data=await res.json();
      if(!res.ok)throw new Error(data.error??"تعذر تحديث السياسة");
      qc.setQueryData(key,data);setMessage("حُفظت سياسة المنشأة مع تأكيد الهوية وتدقيق التغيير.");
      await qc.invalidateQueries({queryKey:key});
    }catch(e){setMessage(e instanceof Error?e.message:"تعذر حفظ السياسة؛ أعد المحاولة");}
    finally{setPending(false);setPassword("");setToken("");setRecovery("");}
  }
  return <Card data-testid="procurement-receiving-policy"><CardHeader><CardTitle>سياسة الفصل عند استلام المشتريات</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p>الافتراضي: يستلم شخص مختلف عن منشئ أمر الشراء. السماح المرن يحتاج أيضًا إذن «استلام أمر أنشأته بنفسي» مع القراءة والاستلام والنطاق والحدود.</p>
      <p>لا يغيّر ذلك اعتماد الأمر ولا يجيز اعتمادًا ذاتيًا أو صرفًا أو تعديل أسعار. لا يُفعّل تلقائيًا بسبب اسم الدور أو عدد الموظفين.</p>
      {q.isLoading?<p>جارٍ تحميل السياسة…</p>:q.isError?<p role="alert">إدارة هذه السياسة تتطلب مسؤولية إعدادات المنشأة. {q.error.message}</p>:<>
        <Label className="flex items-center gap-2"><input type="checkbox" checked={allow} disabled={pending}
          onChange={e=>setAllow(e.target.checked)} aria-label="السماح لمنشئ أمر الشراء باستلامه"/>السماح لمنشئ أمر الشراء باستلامه بإذن صريح</Label>
        <p>الحالة المحفوظة: {q.data?.allowCreator?"السماح المرن بإذن مستقل":"اشتراط مستلم مختلف"} — النسخة {q.data?.revision}</p>
        <Label htmlFor="receipt-policy-password">كلمة مرور حسابك لتأكيد الهوية</Label>
        <Input id="receipt-policy-password" type="password" autoComplete="current-password" value={password} disabled={pending} onChange={e=>setPassword(e.target.value)}/>
        <Label htmlFor="receipt-policy-token">رمز تطبيق المصادقة إن كان مفعّلًا</Label>
        <Input id="receipt-policy-token" type="password" autoComplete="one-time-code" value={token} disabled={pending} onChange={e=>setToken(e.target.value)}/>
        <Label htmlFor="receipt-policy-recovery">رمز استعادة بدل رمز التطبيق عند الحاجة</Label>
        <Input id="receipt-policy-recovery" type="password" autoComplete="off" value={recovery} disabled={pending} onChange={e=>setRecovery(e.target.value)}/>
        <Button onClick={save} disabled={pending||!password||allow===q.data?.allowCreator}>{pending?"جارٍ التأكيد والحفظ…":"تأكيد الهوية وحفظ سياسة الاستلام"}</Button>
      </>}
      {message&&<p role="status">{message}</p>}
    </CardContent></Card>;
}
