import {useEffect,useMemo,useState} from "react";
import {Dialog,DialogContent,DialogHeader,DialogTitle} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {FactorInput} from "@/components/account/factor-input";
import type {FactorMode} from "@/lib/account-security";
import {useApiQuery,apiPost,apiPostWithKey} from "@/hooks/use-api";
import {useAuth} from "@/hooks/use-auth";
import {useDurableIntent} from "@/hooks/use-durable-intent";
import {useTaxPreview} from "@/hooks/use-tax-preview";
import type {TaxPreview} from "@/lib/tax-preview";
import {TaxPreviewPanel} from "@/components/tax-preview-panel";
import {IntentRecoveryPanel} from "@/components/intent-recovery-panel";
import {InvoiceSellerFields,useInvoiceSellers} from "@/components/sellers/invoice-seller-fields";

type OrderLine={id:number;description:string;quantity:number;deliveredQty:number;invoicedQty:number;unitPrice:number};
type Order={id:number;reference:string;branchId:number|null;total:number;currencyCode:string;
  pricingBasis:{priceIncludesVat:boolean}|null;lines:OrderLine[]};
type Created={id:number;reference?:string};
const valid=(r:unknown):r is Created=>!!r&&typeof r==="object"&&Number.isInteger((r as Created).id);
const quote=(body:Record<string,unknown>)=>apiPost<TaxPreview>("/sales/invoices/tax-preview",body);

export function OrderInvoiceDialog({id,open,onOpenChange,onSaved}:{
  id:number;open:boolean;onOpenChange:(open:boolean)=>void;onSaved:()=>void;
}){
  const {data:order,isLoading,error,refetch}=useApiQuery<Order>(`/sales/orders/${id}`);
  const {user}=useAuth();
  const [quantities,setQuantities]=useState<Record<number,string>>({});
  const [message,setMessage]=useState("");
  const [review,setReview]=useState({inclusive:false,discount:"0",reason:"",password:"",factor:""});
  const [factorMode,setFactorMode]=useState<FactorMode>("totp");
  const [reviewBusy,setReviewBusy]=useState(false);
  const sellers=useInvoiceSellers(open);
  useEffect(()=>{if(order)sellers.setBranchId(order.branchId);},[order?.id,order?.branchId]);
  const intent=useDurableIntent<Record<string,unknown>,Created>({
    endpoint:"/sales/invoices",closePath:"/sales/invoices/tax-preview/close-intent",
    userId:user?.id,companyId:user?.companyId,send:(body,key)=>apiPostWithKey<Created>("/sales/invoices",body,key),isValid:valid,
  });
  const frozen=!!intent.attempt;
  const savedQuantities=(intent.attempt?.body.soId===id&&Array.isArray(intent.attempt.body.soQuantities))
    ?intent.attempt.body.soQuantities as Array<{soLineId:number;quantity:number}>:null;
  const selected=useMemo(()=>order?.lines.map(l=>({soLineId:l.id,
    quantity:Number(quantities[l.id]??Math.max(0,Number(l.deliveredQty)-Number(l.invoicedQty)))}))
    .filter(l=>l.quantity>0)??[],[order,quantities]);
  const body=useMemo(()=>order&&!frozen&&selected.length?{soId:id,soQuantities:selected}:null,[id,order,frozen,selected]);
  const tp=useTaxPreview({body,fetcher:quote,frozen});
  const comparison=(tp.preview as (TaxPreview&{comparison?:{
    totalIssuedAfter:number;finalDifferenceFromOrder:number|null;explanation:string}})|null)?.comparison;
  const settle=(out:Awaited<ReturnType<typeof intent.recover>>)=>{
    if(out?.kind==="created"){setMessage(`حُفظت الفاتورة ${out.result.reference??out.result.id}`);onSaved();void refetch();}
    else if(out?.kind==="rejected")setMessage(out.message);
  };
  async function submit(){
    if(frozen){settle(await intent.recover());return;}
    if(!body||tp.freshBlock)return;
    const indices=order!.lines.map((l,i)=>selected.some(p=>p.soLineId===l.id)?i:-1).filter(i=>i>=0);
    const seller=sellers.build(indices);
    if(!seller.ok){setMessage(seller.error);return;}
    settle(await intent.submit({...body,...seller.fields,...tp.tokens()}));
  }
  async function closeIntent(){
    const out=await intent.close();
    if(out?.kind==="completed"){setMessage(`استُرجعت الفاتورة ${out.result.reference??out.result.id}`);onSaved();void refetch();}
    else if(out?.kind==="closed")setMessage("أُغلقت المحاولة دون تنفيذ؛ يمكنك مراجعة طلب جديد.");
  }
  async function reviewLegacy(){
    setReviewBusy(true);
    try{
      await apiPost(`/sales/orders/${id}/review-price-basis`,{priceIncludesVat:review.inclusive,
        currencyCode:"SAR",orderDiscount:Number(review.discount),reason:review.reason,
        proof:{currentPassword:review.password,...(review.factor?factorMode==="totp"?{token:review.factor}:{recoveryCode:review.factor}:{})}});
      setReview(r=>({...r,password:"",factor:""}));setMessage("حُفظ دليل المراجعة دون تغيير الإجماليات التاريخية.");void refetch();tp.retry();
    }catch(e){setMessage(e instanceof Error?e.message:String(e));}
    finally{setReview(r=>({...r,password:"",factor:""}));setReviewBusy(false);}
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" dir="rtl">
      <DialogHeader><DialogTitle>فوترة أمر البيع {order?.reference}</DialogTitle></DialogHeader>
      {isLoading&&<p>جارٍ تحميل حقائق الأمر…</p>}
      {error&&<p role="alert">تعذر تحميل الأمر. <Button onClick={()=>void refetch()}>إعادة المحاولة</Button></p>}
      {message&&<p role="status">{message}</p>}
      {frozen&&<IntentRecoveryPanel error={intent.error} busy={intent.busy} recoveryRejected={intent.recoveryRejected}
        scopeMismatch={intent.scopeMismatch} onRecover={()=>void submit()} onClose={()=>void closeIntent()} testId="order-invoice-intent"/>}
      {!frozen&&intent.error&&<p role="alert">{intent.error}</p>}
      {frozen&&<p>الاسترجاع يستخدم بيانات المحاولة المحفوظة وبائعها، لا اختيارات جديدة.
        {intent.attempt?.body.soId!==id?" هذه المحاولة تخص فاتورة أخرى؛ لا يبدأ طلب جديد قبل حسمها.":""}</p>}
      {order&&<>
        <p>إجمالي الأمر: {order.total} {order.currencyCode} — سعر الاتفاق {order.pricingBasis?order.pricingBasis.priceIncludesVat?"شامل":"غير شامل":"غير مثبت"} الضريبة.
          المعاينة تخص الكميات المختارة؛ المعاملة الضريبية ليست مجمدة بتاريخ الاتفاق.</p>
        {!order.pricingBasis&&<fieldset disabled={reviewBusy||frozen} className="space-y-2 rounded border p-3">
          <p role="alert">أساس السعر القديم غير مثبت. راجع أصل الاتفاق قبل التصريح؛ لا يغيّر هذا الإجراء التاريخ أو الأسعار.
            الأوامر المفوترة جزئيًا بلا دليل تبقى محجوبة للمصالحة.</p>
          <label><input type="checkbox" checked={review.inclusive} onChange={e=>setReview(r=>({...r,inclusive:e.target.checked}))}/>أُثبت أن أسعار الاتفاق شاملة الضريبة</label>
          <label className="block">خصم الأمر المتفق عليه (غير خصم نسب البنود)
            <Input type="number" min="0" step="0.01" value={review.discount} onChange={e=>setReview(r=>({...r,discount:e.target.value}))}/></label>
          <label className="block">مرجع الدليل وسبب المراجعة<Input value={review.reason} onChange={e=>setReview(r=>({...r,reason:e.target.value}))}/></label>
          <label className="block">كلمة مرور حسابك لتأكيد الهوية<Input type="password" autoComplete="current-password" value={review.password}
            onChange={e=>setReview(r=>({...r,password:e.target.value}))}/></label>
          <FactorInput id="legacy-order-basis-factor" mode={factorMode} onMode={setFactorMode} value={review.factor}
            onChange={v=>setReview(r=>({...r,factor:v}))}/>
          <Button variant="outline" disabled={review.reason.trim().length<10||!review.password} onClick={()=>void reviewLegacy()}>تأكيد المراجعة وتدقيقها</Button>
        </fieldset>}
        <fieldset disabled={frozen||intent.busy} className="space-y-3">
          {order.lines.map(l=><div key={l.id} className="grid grid-cols-2 gap-2">
            <label htmlFor={`so-qty-${l.id}`}>{l.description} — سعر الاتفاق {l.unitPrice}؛ المتبقي المسلّم {Math.max(0,Number(l.deliveredQty)-Number(l.invoicedQty))}</label>
            <Input id={`so-qty-${l.id}`} data-testid={`so-invoice-qty-${l.id}`} type="number" min="0" step="0.0001"
              max={Math.max(0,Number(l.deliveredQty)-Number(l.invoicedQty))}
              value={frozen?savedQuantities?.find(q=>q.soLineId===l.id)?.quantity??0:
                quantities[l.id]??Math.max(0,Number(l.deliveredQty)-Number(l.invoicedQty))}
              onChange={e=>setQuantities(q=>({...q,[l.id]:e.target.value}))}/>
          </div>)}
          {!frozen&&<InvoiceSellerFields state={sellers} lines={order.lines.map(l=>l.description)} hideBranch/>}
        </fieldset>
        <TaxPreviewPanel tp={tp} frozenNote={frozen?"محاولة محفوظة؛ تُسترجع بالجسم والمعرف نفسيهما دون إعادة حساب.":undefined}/>
        {comparison&&<div className="rounded border p-2 text-sm" data-testid="order-invoice-comparison">
          <p>{comparison.explanation}</p>
          <p>مجموع الفواتير بعد هذه الفاتورة: {comparison.totalIssuedAfter.toFixed(2)} SAR</p>
          {comparison.finalDifferenceFromOrder!==null&&<p>الفرق النهائي عن تقدير الأمر: {comparison.finalDifferenceFromOrder.toFixed(2)} SAR</p>}
        </div>}
        <Button data-testid="issue-order-invoice" onClick={()=>void submit()}
          disabled={!intent.ready||intent.busy||!frozen&&(!order.pricingBasis||!body||!!tp.freshBlock)}>
          {frozen?"استرجاع النتيجة":"إصدار الفاتورة بالكميات والمعاينة المؤكدتين"}
        </Button>
      </>}
    </DialogContent>
  </Dialog>;
}
