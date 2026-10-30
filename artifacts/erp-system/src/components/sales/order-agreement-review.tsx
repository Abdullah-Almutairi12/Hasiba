import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {apiGet} from "@/hooks/use-api";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogFooter} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Money} from "@/components/riyal";

type Agreement = {
  id:number;reference:string;status:string;total:number;vat:number;currencyCode:string;
  pricingBasis?:{priceIncludesVat:boolean}|null;
  appliedDiscounts?:Array<{id:number;name:string;amount:number;scope:string}>|null;
  lines:Array<{id:number;description:string;quantity:number;unitPrice:number;discountPct:number}>;
};

/** Read the persisted agreement, not local draft arithmetic or current catalogue prices.
 * Confirmation still uses the original server transition/approval service.
 */
export function OrderAgreementReview({id,onClose,onConfirm}:{
  id:number;onClose:()=>void;onConfirm:()=>Promise<void>;
}){
  const {data,isFetching,error,refetch}=useQuery({
    queryKey:[`/sales/orders/${id}`,"agreement-review"],
    queryFn:()=>apiGet<Agreement>(`/sales/orders/${id}`),
    staleTime:0,retry:false,
  });
  const [reviewed,setReviewed]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  // Any new server facts, even after a focus/refetch, require review again.
  const facts=data?JSON.stringify(data):null;
  const valid=!!data&&data.id===id&&data.status==="draft"&&
    Number.isFinite(data.total)&&Number.isFinite(data.vat)&&Array.isArray(data.lines)&&data.lines.length>0;
  const ready=valid&&!isFetching&&!error;
  return <Dialog open onOpenChange={v=>{if(!v&&!busy)onClose();}}>
    <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>مراجعة اتفاق أمر البيع قبل التأكيد</DialogTitle></DialogHeader>
      {isFetching?<p role="status">جارٍ قراءة الاتفاق المحفوظ من الخادم…</p>:
        error||!valid?<div role="alert">
          تعذر تحميل مسودة صالحة للمراجعة. لم يُؤكّد الأمر.
          <Button variant="outline" onClick={()=>void refetch()}>إعادة القراءة</Button>
        </div>:<>
          <p>{data.reference} — {data.currencyCode}</p>
          <p role="note">قد يختلف تقدير الإدخال بسبب قواعد الخصم الآلية أو المعالجة الضريبية.
            المبالغ أدناه هي الاتفاق المحفوظ من الخادم، وليست إعادة تسعير بالأسعار الحالية.</p>
          <p>{data.pricingBasis?.priceIncludesVat===true?"أسعار البنود شاملة الضريبة":
            data.pricingBasis?.priceIncludesVat===false?"أسعار البنود غير شاملة الضريبة":"أساس السعر القديم غير مثبت؛ لا يجيز التأكيد تجاوز حجب الفوترة."}</p>
          <ul className="space-y-2">{data.lines.map(l=><li key={l.id}>
            {l.description}: {Number(l.quantity)} × <Money value={Number(l.unitPrice)}/>
            {" — "}نسبة خصم البند المحفوظة: {Number(l.discountPct)}%
          </li>)}</ul>
          <div><h3 className="font-semibold">قواعد الخصم المطبقة عند الحفظ</h3>
            {data.appliedDiscounts?.length?<ul>{data.appliedDiscounts.map((r,i)=><li key={`${r.id}-${i}`}>
              {r.name} — {r.scope==="line"?"خصم بند":"خصم أمر"}: <Money value={Number(r.amount)}/>
            </li>)}</ul>:<p>لا توجد قواعد خصم آلية مسجلة لهذا الأمر.</p>}
          </div>
          <p>الضريبة المحفوظة: <Money value={data.vat}/></p>
          <p className="font-bold" data-testid="saved-order-total">الإجمالي المحفوظ من الخادم: <Money value={data.total}/></p>
          <p className="text-sm text-muted-foreground">مبالغ قواعد الخصم تبين مصادرها؛ ليست مبالغ إضافية تُطرح مرة أخرى.
            المعاينة الضريبية قبل إصدار الفاتورة تبقى مطلوبة، وأي موافقة لازمة تمر بالمسار الأصلي.</p>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={busy}
            checked={reviewed===facts} onChange={e=>setReviewed(e.target.checked?facts:null)}/>
            راجعت مبلغ الخادم وأساس السعر وقواعد الخصم المحفوظة</label>
        </>}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={onClose}>العودة دون تأكيد</Button>
        {ready&&<Button disabled={busy||reviewed!==facts} onClick={async()=>{
          if(!ready||reviewed!==facts||busy)return;
          setBusy(true);try{await onConfirm();}finally{setBusy(false);}
        }}>تأكيد الاتفاق المحفوظ</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
