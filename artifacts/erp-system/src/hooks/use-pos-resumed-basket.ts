import {useEffect,useState} from "react";
import type {CreatePosOrderBody} from "@workspace/api-client-react";
import type {PosCartItem} from "./use-pos-checkout";
import type {PosCustomerChoice} from "@/components/pos-customer-picker";

export type ResumedBasket={
  source:NonNullable<CreatePosOrderBody["resumedDraft"]>;
  cart:PosCartItem[];
  customer:PosCustomerChoice|null;
};
export function usePosResumedBasket(scope:string){
  const key=`hasba:pos-resumed-basket:${scope}`;
  const [state,setState]=useState<{key:string;ready:boolean;value:ResumedBasket|null;error:string}>({key,ready:false,value:null,error:""});
  useEffect(()=>{
    try{
      const raw=sessionStorage.getItem(key),value=raw?JSON.parse(raw) as ResumedBasket:null;
      if(value&&(!Number.isSafeInteger(value.source?.id)||!Number.isSafeInteger(value.source.sessionId)||
        typeof value.source.requestId!=="string"||!Array.isArray(value.cart)||!value.cart.length))throw Error();
      setState({key,ready:true,value,error:""});
    }catch{setState({key,ready:false,value:null,error:"تعذر قراءة ربط السلة بالمسودة؛ لم يُسمح بتحصيل جديد. أعد تفعيل التخزين وتحقق."});}
  },[key]);
  function save(value:ResumedBasket){
    try{sessionStorage.setItem(key,JSON.stringify(value));setState({key,ready:true,value,error:""});return true;}
    catch{setState(s=>({...s,error:"تعذر حفظ هوية المسودة وورديتها؛ احتُفظ بمحاولة الاسترجاع ولم تُفتح سلة للدفع."}));return false;}
  }
  function clear(){
    try{sessionStorage.removeItem(key);setState({key,ready:true,value:null,error:""});return true;}
    catch{return false;}
  }
  return state.key===key?{...state,save,clear}:{ready:false,value:null,error:"",save,clear};
}
