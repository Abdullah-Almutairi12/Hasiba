import {useEffect,useRef,useState} from "react";
import type {CreatePosOrderBody} from "@workspace/api-client-react";
import type {PosCartItem} from "./use-pos-checkout";
import type {PosCustomerChoice} from "@/components/pos-customer-picker";
import type {PosResumedBasketInput} from "@workspace/api-client-react";

export type ResumedBasket={
  source:NonNullable<CreatePosOrderBody["resumedDraft"]>;
  cart:PosCartItem[];
  customer:PosCustomerChoice|null;
  serverDirty?:boolean;
  serverConflict?:boolean;
  serverFinalized?:boolean;
  syncIntent?:{key:string;body:PosResumedBasketInput;responsibility:string|null};
};
export function usePosResumedBasket(scope:string){
  const key=`hasba:pos-resumed-basket:${scope}`;
  const [state,setState]=useState<{key:string;ready:boolean;value:ResumedBasket|null;error:string;dirty:boolean}>({key,ready:false,value:null,error:"",dirty:false});
  const current=useRef(state);current.current=state;
  const publish=(next:typeof state)=>{current.current=next;setState(next);};
  useEffect(()=>{
    try{
      const raw=sessionStorage.getItem(key),value=raw?JSON.parse(raw) as ResumedBasket:null;
      if(value&&(!Number.isSafeInteger(value.source?.id)||!Number.isSafeInteger(value.source.sessionId)||
        typeof value.source.requestId!=="string"||!Array.isArray(value.cart)))throw Error();
      publish({key,ready:true,value,error:"",dirty:false});
    }catch{publish({key,ready:false,value:null,error:"تعذر قراءة ربط السلة بالمسودة؛ لم يُسمح بتحصيل جديد. أعد تفعيل التخزين وتحقق.",dirty:false});}
  },[key]);
  useEffect(()=>{
    if(!state.dirty||state.key!==key)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
  },[state.dirty,state.key,key]);
  function write(value:ResumedBasket){
    const raw=JSON.stringify(value);sessionStorage.setItem(key,raw);
    if(sessionStorage.getItem(key)!==raw)throw Error("Snapshot was not retained");
  }
  function save(value:ResumedBasket){
    try{write(value);publish({key,ready:true,value,error:"",dirty:false});return true;}
    catch{publish({...current.current,error:"تعذر حفظ هوية المسودة وورديتها؛ احتُفظ بمحاولة الاسترجاع ولم تُفتح سلة للدفع."});return false;}
  }
  function update(cart:PosCartItem[],customer:PosCustomerChoice|null){
    const previous=current.current;
    if(previous.key!==key||!previous.ready||!previous.value||previous.value.syncIntent)return false;
    // Source identity never comes from an edit. Only the working contents change.
    const value={source:previous.value.source,cart,customer,serverDirty:true};
    try{write(value);publish({key,ready:true,value,error:"",dirty:false});return true;}
    catch{publish({key,ready:true,value,dirty:true,error:"تعذر حفظ آخر تعديلات السلة؛ الدفع محجوب. لا تحدّث الصفحة قبل إعادة حفظ التعديلات، وإلا قد تعود النسخة السابقة."});return false;}
  }
  function retry(){
    const previous=current.current;
    return previous.key===key&&previous.value?update(previous.value.cart,previous.value.customer):false;
  }
  function clear(){
    try{sessionStorage.removeItem(key);publish({key,ready:true,value:null,error:"",dirty:false});return true;}
    catch{return false;}
  }
  return state.key===key?{...state,save,update,retry,clear}:{ready:false,value:null,error:"",dirty:false,save,update,retry,clear};
}
