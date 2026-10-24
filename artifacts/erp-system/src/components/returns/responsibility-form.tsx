import { useRef,useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAct } from "@/hooks/use-returns-actions";
import { OwnerProof } from "./owner-exception";
import { num,str,rec,type Rec } from "@/lib/returns/shared";

export function ResponsibilityForm({session,employees,selfOwner}:{session:Rec;employees:Rec[];selfOwner:boolean}) {
  const old=rec(session.responsibility_decision);
  const [decision,setDecision]=useState("company_bears"),[employee,setEmployee]=useState("");
  const [reason,setReason]=useState(""),[evidence,setEvidence]=useState(""),[proof,setProof]=useState(""),[message,setMessage]=useState("");
  const key=useRef(crypto.randomUUID()),{run,pending}=useAct();
  if(old.id) return <div key="record" className="mt-3 rounded border p-3 text-xs" data-testid={`responsibility-${str(session.id)}`}>
    <p>قرار المسؤولية: {old.decision==="company_bears"?"تتحملها المنشأة":`مسؤولية الموظف #${str(old.employee_id)}`} · {str(old.reason)} · الدليل: {str(old.evidence)} · صاحب القرار #{str(old.decided_by)} · {str(old.decided_at)}</p>
    <p>{old.owner_exception===true?"قرار باستثناء مالك موثق — ليس مراجعة مستقلة. ":""}هذا سجل مسؤولية فقط؛ لا ينشئ مديونية موظف أو خصم راتب.</p></div>;
  const body={sessionId:num(session.id),decision,employeeId:decision==="employee_responsible"?Number(employee):null,reason,evidence,idempotencyKey:key.current};
  const change=(f:()=>void)=>{f();setProof("");};
  return <div key="form" className="mt-3 space-y-2 rounded-xl border p-3">
    <h4 className="font-semibold">قرار مسؤولية الفرق — منفصل عن مراجعة الإقفال</h4>
    <p className="text-xs">القرار موثق وغير قابل للاستبدال بإعادة الطلب. لا قيد مديونية ولا استقطاع راتب تلقائي. التصحيح يحتاج إجراءً موثقًا مستقلًا.</p>
    <fieldset disabled={pending} className="space-y-2">
      <legend className="text-sm font-medium">من يتحمل المسؤولية؟</legend>
      {([["company_bears","تتحملها المنشأة"],["employee_responsible","موظف محدد — دون تحميل مالي تلقائي"]] as const).map(([value,title])=>
        <label key={value} className="flex items-center gap-2 text-sm">
          <input type="radio" name={`responsibility-${str(session.id)}`} value={value} checked={decision===value}
            onChange={()=>change(()=>setDecision(value))}/><span>{title}</span>
        </label>)}
    </fieldset>
    {decision==="employee_responsible"&&<><Label htmlFor={`responsibility-employee-${str(session.id)}`}>الموظف ضمن فرع القرار</Label><select id={`responsibility-employee-${str(session.id)}`} disabled={pending} className="w-full rounded border bg-background p-2" value={employee} onChange={e=>change(()=>setEmployee(e.target.value))}>
      <option value="">اختر الموظف</option>{employees.filter(e=>num(e.branch_id)===num(session.branch_id)).map(e=><option key={str(e.id)} value={str(e.id)}>{str(e.name_ar)} — {str(e.employee_no)}</option>)}</select></>}
    <Label htmlFor={`responsibility-reason-${str(session.id)}`}>سبب القرار</Label><Input id={`responsibility-reason-${str(session.id)}`} disabled={pending} value={reason} onChange={e=>change(()=>setReason(e.target.value))}/>
    <Label htmlFor={`responsibility-evidence-${str(session.id)}`}>مرجع الأدلة</Label><Input id={`responsibility-evidence-${str(session.id)}`} disabled={pending} value={evidence} onChange={e=>change(()=>setEvidence(e.target.value))}/>
    {selfOwner&&<OwnerProof sessionId={str(session.id)} purpose="cash_difference_responsibility" decision={body} onProof={setProof}/>}
    <Button size="sm" disabled={pending||reason.trim().length<3||evidence.trim().length<3||(decision==="employee_responsible"&&!employee)||(selfOwner&&!proof)}
      onClick={async()=>{const result=await run("responsibility",{...body,...(proof?{ownerProof:proof}:{})});
        setMessage(result.ok?"حُفظ القرار دون مديونية أو خصم راتب":result.err.message);if(result.ok)setProof("");}}>حفظ قرار المسؤولية</Button>
    {message&&<p role="status" className="text-xs">{message}</p>}
  </div>;
}
