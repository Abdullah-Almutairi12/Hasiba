import {useRef} from "react";
import {lookupPosBarcode,type Product} from "@workspace/api-client-react";

/** Each accepted keydown owns one lookup; replies can arrive in any order. */
export function usePosBarcode(options:{
  context:string;sessionId:number|undefined;blocked:boolean;
  basketSnapshot?:()=>string;
  add:(p:Product)=>void;error:(message:string)=>void;
}){
  const latest=useRef(options);
  const generation=useRef({context:options.context,epoch:0});
  if(generation.current.context!==options.context)
    generation.current={context:options.context,epoch:generation.current.epoch+1};
  latest.current=options;
  return async(code:string)=>{
    code=code.trim();
    const start=latest.current,epoch=generation.current.epoch,snapshot=start.basketSnapshot?.();
    if(!code)return;
    if(start.blocked||!start.sessionId){start.error("لا يمكن المسح أثناء التحقق أو محاولة حفظ/دفع معلقة؛ اختر وردية مؤكدة أولًا.");return;}
    try{
      const product=await lookupPosBarcode({code,sessionId:start.sessionId});
      if(generation.current.epoch!==epoch||latest.current.blocked||latest.current.basketSnapshot?.()!==snapshot)return;
      latest.current.add(product);
    }catch(err){
      if(generation.current.epoch===epoch&&!latest.current.blocked)
        latest.current.error(err instanceof Error?err.message:"تعذر البحث عن الباركود. أعد المحاولة.");
    }
  };
}
