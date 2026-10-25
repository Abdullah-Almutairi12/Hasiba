import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { apiGet } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import { CountRequestError, countHeaders, loadCountIntent, sendCountIntent, type CountIntent } from "@/lib/stocktake-intent";

type Saved = CountIntent & { uncertain?: boolean };
/** This is shared by the original stocktake page, not a separate counting UI. */
export function StocktakeScanner({id,scope,onConfirmed,disabled=false}:{
  id:number;scope:string;onConfirmed:()=>void;disabled?:boolean;
}) {
  const [code,setCode]=useState("");
  const [pending,setPending]=useState<Saved|null>(null);
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [storageError,setStorageError]=useState(false);
  const lock=useRef(false);
  const {toast}=useToast();
  useEffect(()=>{
    const restore=()=>{
    try {
      const saved=loadCountIntent(localStorage,scope) as Saved|null;
      setPending(saved);setStorageError(false);
      setMessage(saved?"هناك مسحة غير محسومة محفوظة؛ استعد نتيجتها بنفس المعرف قبل أي مسحة جديدة":"");
    } catch {setStorageError(true);setMessage("تعذر فتح سجل الاستعادة المحلي؛ العد متوقف لحماية المسحات");}
    };
    restore();
    const sync=(event:StorageEvent)=>{if(event.key===scope&&!lock.current)restore();};
    window.addEventListener("storage",sync);
    return ()=>window.removeEventListener("storage",sync);
  },[scope]);
  const persist=(intent:Saved|null)=>{
    if(intent)localStorage.setItem(scope,JSON.stringify(intent));else localStorage.removeItem(scope);
    setPending(intent);
  };
  const submit=async()=>{
    if(lock.current||storageError||disabled&&!pending||!pending&&!code.trim())return;
    lock.current=true;setBusy(true);
    let intent:Saved|null=null;
    try {
      // Re-read under the origin-wide lock; another tab may hold recovery evidence.
      intent=loadCountIntent(localStorage,scope);setPending(intent);
      if(!intent) {
        setMessage("جارٍ البحث عن الباركود…");
        // Only the lookup's actual 404 is an unknown code. Auth/network errors are not.
        const lookup=await apiGet<{productId:number}>(`/inventory/stock-takes/${id}/lookup?code=${encodeURIComponent(code.trim())}`,countHeaders());
        // Mark in-flight evidence uncertain BEFORE the request: a reload/crash
        // after commit but before the response must not clear it on later 403.
        intent={key:crypto.randomUUID(),code:code.trim(),productId:lookup.productId,countedQty:1};
        persist(intent); // Must succeed BEFORE sending anything.
      }
      localStorage.setItem(scope,JSON.stringify({...intent,uncertain:true}));
      setMessage("جارٍ حفظ المسحة؛ لا تعد مسح المنتج نفسه…");
      const quantity=await sendCountIntent(`${import.meta.env.BASE_URL.replace(/\/$/,"")}/api`,id,intent);
      persist(null);
      setCode("");setMessage(`تم تأكيد العد من الخادم: ${quantity}`);
      onConfirmed();toast({title:"تم العد",description:`العدد المؤكد: ${quantity}`});
    } catch(error) {
      const detail=error instanceof Error?error.message:"تعذر حفظ المسحة";
      if(error instanceof CountRequestError && intent) {
        // A permission/closed response AFTER an unknown result cannot prove the
        // earlier request never committed. Preserve evidence until reconciliation.
        const uncertain=error.uncertain||intent.uncertain===true;
        try {persist(uncertain?{...intent,uncertain:true}:null);}
        catch {setStorageError(true);}
        setMessage(uncertain?`نتيجة غير مؤكدة — ${detail}. المحاولة محفوظة ولا يسمح بمسحة جديدة`:`رفض مؤكد — ${detail}`);
      } else {
        setMessage(detail);
        // Storage errors must fail closed, never send an unpersisted intent.
        if(intent)setStorageError(true);
      }
    } finally {lock.current=false;setBusy(false);}
  };
  const guardedSubmit=async()=>{
    if(!navigator.locks){setMessage("هذا المتصفح لا يوفر قفل المسحات بين النوافذ؛ استخدم متصفحًا مدعومًا");return;}
    await navigator.locks.request(scope,{ifAvailable:true},async lock=>{
      if(!lock){setMessage("توجد مسحة قيد المعالجة في نافذة أخرى؛ انتظر تأكيدها");return;}
      await submit();
    });
  };
  return <div className="space-y-2">
    <div className="flex items-end gap-2">
      <div className="grid flex-1 gap-2">
        <Label htmlFor={`scan-${id}`}>مسح الباركود (كل مسحة تزيد العدد في الخادم)</Label>
        <Input id={`scan-${id}`} value={code} disabled={busy||!!pending||storageError||disabled}
          onChange={e=>setCode(e.target.value)} dir="ltr" placeholder="امسح باركود المنتج…"
          onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();void guardedSubmit();}}} />
      </div>
      <Button type="button" variant="outline" disabled={busy||storageError||disabled&&!pending||!pending&&!code.trim()}
        onClick={()=>void guardedSubmit()}>{busy?"جارٍ الحفظ…":pending?"استعادة نتيجة المسحة":"عدّ"}</Button>
    </div>
    {message&&<p role="status" aria-live="polite" className="text-sm">{message}</p>}
    {pending&&<p className="text-xs text-muted-foreground" dir="ltr">مرجع المسحة: {pending.key}</p>}
  </div>;
}
