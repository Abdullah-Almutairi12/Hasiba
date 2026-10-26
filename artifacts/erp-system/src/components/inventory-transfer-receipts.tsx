import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetWorkspaceInventoryTransfers, getGetWorkspaceInventoryTransfersQueryKey,
  getGetWorkspaceInventoryQueryKey, receiveInventoryTransfer, type getWorkspaceInventoryTransfers,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorText } from "@/lib/team-access";

type Transfer=Awaited<ReturnType<typeof getWorkspaceInventoryTransfers>>["transfers"][number];
type Attempt={key:string;receiptReference:string};

export function TransferReceiptRow({transfer,grantId,canReceive,onReceived}:{
  transfer:Transfer;grantId:number;canReceive:boolean;onReceived:()=>Promise<unknown>;
}) {
  const [reference,setReference]=useState(""),[confirmed,setConfirmed]=useState(false);
  const [pending,setPending]=useState(false),[message,setMessage]=useState("");
  const attempt=useRef<Attempt|null>(null),busy=useRef(false);
  if(transfer.state==="done") return <p key="record" className="mt-2 text-xs text-emerald-700" role="status">مستلم في الخادم؛ لا استلام جديد لهذا التحويل.</p>;
  if(!canReceive&&!attempt.current) return <p className="mt-2 text-xs text-muted-foreground">العرض مسموح؛ استلام هذا التحويل يحتاج فعل استلام مستقلًا ضمن مستودع الوجهة.</p>;
  const run=async()=>{
    if(busy.current) return;
    if(!attempt.current) {
      if(!confirmed||reference.trim().length<3) return;
      attempt.current={key:crypto.randomUUID(),receiptReference:reference.trim()};
    }
    const intent=attempt.current;
    busy.current=true;setPending(true);setMessage("");
    let committed=false;
    try {
      await receiveInventoryTransfer(transfer.id,{receiptReference:intent.receiptReference},{
        headers:{"Idempotency-Key":intent.key,"X-Workspace-Responsibility":String(grantId)},
      });
      committed=true;setMessage("أكد الخادم استلام التحويل؛ يجري تحديث الرصيد.");
      await onReceived();
    } catch(error) {
      if(committed) setMessage("الاستلام مؤكد، لكن تحديث العرض تعذر. حدّث الحالة دون إنشاء استلام جديد.");
      else {
        const status=Number((error as {status?:number})?.status);
        if([400,401,403,404,409,422].includes(status)) {
          attempt.current=null;setMessage(errorText(error));
        } else setMessage("نتيجة الاستلام غير مؤكدة. استعد نتيجة الطلب نفسه أو حدّث الحالة؛ لن تتغير بيانات المحاولة.");
      }
    } finally {busy.current=false;setPending(false);}
  };
  return <div key="form" className="mt-3 space-y-2 border-t pt-3">
    <Label htmlFor={`transfer-reference-${transfer.id}`}>مرجع إثبات الاستلام الكامل</Label>
    <Input id={`transfer-reference-${transfer.id}`} value={reference} maxLength={200}
      disabled={pending||!!attempt.current} onChange={e=>setReference(e.target.value)}/>
    <label className="flex items-start gap-2 text-xs">
      <input type="checkbox" checked={confirmed} disabled={pending||!!attempt.current} onChange={e=>setConfirmed(e.target.checked)}/>
      <span>أؤكد وصول كامل كمية حركة التحويل إلى مستودع الوجهة؛ هذا ليس استلامًا جزئيًا أو اعتماد تسوية.</span>
    </label>
    <Button size="sm" disabled={pending||(!attempt.current&&(!canReceive||!confirmed||reference.trim().length<3))} onClick={()=>void run()}>
      {pending?"جارٍ التحقق والاستلام…":attempt.current?"استعادة نتيجة الطلب نفسه":"تأكيد استلام حركة التحويل كاملة"}
    </Button>
    {message&&<p role="status" className="text-xs">{message}</p>}
  </div>;
}

export function InventoryTransferReceipts({grantId}:{grantId:number}) {
  const client=useQueryClient(),key=[...getGetWorkspaceInventoryTransfersQueryKey(),grantId];
  const query=useGetWorkspaceInventoryTransfers({
    query:{queryKey:key,refetchOnWindowFocus:false,retry:false},
    request:{headers:{"X-Workspace-Responsibility":String(grantId)}},
  });
  const refresh=async()=>Promise.all([
    client.invalidateQueries({queryKey:key}),
    client.invalidateQueries({queryKey:[...getGetWorkspaceInventoryQueryKey(),grantId]}),
  ]);
  return <section className="space-y-3 border-t p-4" data-testid="panel-incoming-transfers">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-semibold">التحويلات الواردة إلى مستودعات مسؤوليتك</h3>
      <Button size="sm" variant="outline" disabled={query.isFetching} onClick={()=>void query.refetch()}>تحديث حالة التحويلات</Button>
    </div>
    <p className="text-xs text-muted-foreground">حتى100حركة، بالأولوية للأقدم قيد الاستلام. استلام بضائع في الطريق فقط؛ لا إرسال أو تعديل كمية أو تكلفة أو تسوية.</p>
    {query.isLoading?<p role="status">جارٍ تحميل التحويلات…</p>:query.error?<p role="alert">{errorText(query.error)}</p>:
      query.data?.transfers.length?query.data.transfers.map(t=><article key={t.id} className="rounded-lg border p-3" data-testid={`incoming-transfer-${t.id}`}>
        <p className="text-sm font-medium">{t.productName}{t.variantId?` · ${t.variantSku??`متغير#${t.variantId}`}`:""} · <bdi>{t.quantity}</bdi> {t.unit??""}</p>
        <p className="text-xs text-muted-foreground">{t.sourceWarehouse} ← {t.destinationWarehouse} · <bdi>{t.reference||"بدون مرجع"}</bdi> · حركة#<bdi>{t.id}</bdi></p>
        <TransferReceiptRow transfer={t} grantId={grantId} canReceive={query.data!.canReceive} onReceived={refresh}/>
      </article>):<p className="text-sm text-muted-foreground">لا تحويلات واردة ضمن هذه المستودعات.</p>}
  </section>;
}
