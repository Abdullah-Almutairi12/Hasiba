import { useEffect,useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAct } from "@/hooks/use-returns-actions";
import { str,num,strArr,type Rec } from "@/lib/returns/shared";

export function OwnerProof({sessionId,purpose,decision,onProof}:{sessionId:string;
  purpose:"cash_difference_review"|"cash_difference_responsibility";decision?:Rec;onProof:(proof:string)=>void}) {
  const [password,setPassword]=useState(""),[error,setError]=useState("");
  const {run,pending}=useAct();
  return <div className="space-y-2 rounded-lg border p-3">
    <p className="text-xs">استثناء المالك المنفرد يتطلب سياسة صريحة وحدًا ماليًا. تأكيد الهوية لهذه العملية فقط، وليس موافقة شخص مستقل أو جلسة مدير.</p>
    <Label>كلمة مرور حسابك لتأكيد الهوية لهذه العملية</Label>
    <Input type="password" autoComplete="current-password" value={password} onChange={e=>{setPassword(e.target.value);onProof("");}}/>
    <Button size="sm" variant="outline" disabled={pending||!password} onClick={async()=>{
      const result=await run("owner_proof",{sessionId:Number(sessionId),purpose,password,...(decision?{decision}: {})});
      setPassword("");
      if(result.ok) {onProof(str(result.res.proof));setError("");}
      else {onProof("");setError(result.err.message);}
    }}>تأكيد هويتي للعملية المحددة</Button>
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}

export function OwnerPolicyEditor({policy}:{policy:Rec}) {
  const [enabled,setEnabled]=useState(false),[operations,setOperations]=useState<string[]>([]);
  const [limit,setLimit]=useState("0"),[reason,setReason]=useState(""),[message,setMessage]=useState("");
  const {run,pending}=useAct();
  useEffect(()=>{setEnabled(policy.enabled===true);setOperations(strArr(policy.operations));
    setLimit(str(policy.amount_limit,"0"));setReason(str(policy.reason));},[policy.revision]);
  const choices=[["cash_difference_review","مراجعة فرق وردية أنشأها المالك"],["cash_difference_responsibility","قرار مسؤولية فرق وردية أنشأها المالك"]];
  return <section className="space-y-3 rounded-2xl border bg-card p-4">
    <h3 className="font-bold">سياسة المالك المنفرد — فروق الصندوق</h3>
    <p className="text-xs text-muted-foreground">معطلة افتراضيًا. تخص مالك الشركة الوحيد فقط. لا تتجاوز موافقات الفواتير أو الخصم أو الدفع، ولا تمنح موظفًا استثناء المالك.</p>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>تفعيل الاستثناء الصريح</label>
    {choices.map(([key,text])=><label className="flex gap-2 text-sm" key={key}><input type="checkbox" checked={operations.includes(key)}
      onChange={e=>setOperations(e.target.checked?[...operations,key]:operations.filter(x=>x!==key))}/>{text}</label>)}
    <Label>الحد الأعلى للفرق بالريال</Label><Input type="number" min="0" step="0.01" value={limit} onChange={e=>setLimit(e.target.value)}/>
    <Label>سبب السياسة المدقق</Label><Input value={reason} onChange={e=>setReason(e.target.value)}/>
    <Button disabled={pending||reason.trim().length<3||num(limit)===null||(enabled&&(!operations.length||Number(limit)<=0))}
      onClick={async()=>{const result=await run("configure_owner_policy",{enabled,operations,amountLimit:Number(limit),reason});
        setMessage(result.ok?"حُفظت السياسة؛ يلزم تأكيد هوية جديد لكل عملية":result.err.message);}}>حفظ سياسة المالك</Button>
    {message&&<p role="status" className="text-xs">{message}</p>}
  </section>;
}
