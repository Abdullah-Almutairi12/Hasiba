import {useEffect,useRef,useState} from "react";
import {clearIntentIfKey,parseIntent,saveIntent,type StoredIntent} from "@/lib/durable-intent";

type Kind="resume"|"cancel";
type Body={sessionId:number};
type Meta={id:number;kind:Kind};
export type ResumeIntent=StoredIntent<Body,Meta>;
export type ResumeResult={
  id:number;requestId:string;sessionId:number;state:"resumed"|"cancelled"|"unavailable";
  customerId?:number|null;
  items?:{productId:number;quantity:number;priceSnapshot?:number;nameSnapshot?:string}[];
};
export const resumeStorageKey=(scope:string)=>`hasba:pos-resume:${scope}`;
function read(scope:string):ResumeIntent|null|"unreadable"{
  try{
    const raw=sessionStorage.getItem(resumeStorageKey(scope));if(!raw)return null;
    const endpoint=JSON.parse(raw).endpoint;
    const v=parseIntent<Body,Meta>(raw,endpoint);
    if(!Number.isSafeInteger(v.meta?.id)||!["resume","cancel"].includes(v.meta?.kind??"")||
      endpoint!==`pos/orders/${v.meta!.id}/${v.meta!.kind}`||!Number.isSafeInteger(v.body.sessionId)||v.body.sessionId<=0)return "unreadable";
    return v;
  }catch{return "unreadable";}
}
const uncertain="تعذر تأكيد فتح المسودة؛ احتُفظ بالمحاولة الأصلية. تحقق منها ولا تفتح مسودة بديلة.";
/** Exact durable request identity; delivery and deliberate cancellation use distinct endpoints. */
export function usePosResume(scope:string){
  const scopeRef=useRef(scope);scopeRef.current=scope;
  const alive=useRef(true),sending=useRef(false);
  const [state,setState]=useState<{scope:string;ready:boolean;intent:ResumeIntent|null;busy:boolean;error:string}>(
    {scope,ready:false,intent:null,busy:false,error:""});
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    const v=read(scope);
    setState({scope,ready:v!=="unreadable",intent:v==="unreadable"?null:v,busy:false,
      error:v==="unreadable"?"تعذرت قراءة محاولة فتح المسودة؛ لم يُرسل طلب جديد. أعد تفعيل التخزين وتحقق.":""});
  },[scope]);
  const current=state.scope===scope?state:{ready:false,intent:null,busy:false,error:""};
  const update=(patch:Partial<typeof state>)=>{
    if(alive.current&&scopeRef.current===scope)setState(s=>({...s,...patch}));
  };
  async function submit(id?:number,sessionId?:number,kind:Kind="resume"){
    if(sending.current)return null;
    sending.current=true;
    let intent:ResumeIntent|null=null;
    try{
      const existing=read(scope);
      if(existing==="unreadable")throw Error("تعذر قراءة المحاولة؛ لم يُرسل طلب جديد.");
      intent=existing;
      if(intent&&id!==undefined&&(intent.meta!.id!==id||intent.meta!.kind!==kind))
        throw Error("استرجع المحاولة الأصلية أولًا؛ الاستئناف والإلغاء عمليتان منفصلتان.");
      if(!intent){
        if(!id||!sessionId)throw Error("لا توجد محاولة محفوظة للاسترجاع.");
        intent={v:1,key:crypto.randomUUID(),endpoint:`pos/orders/${id}/${kind}`,
          body:{sessionId},meta:{id,kind},responsibility:null,createdAt:new Date().toISOString()};
        try{saveIntent(resumeStorageKey(scope),intent);}
        catch{throw Error("تعذر حفظ هوية المحاولة بأمان؛ لم يُرسل طلب. فعّل التخزين وأعد المحاولة.");}
      }
      update({intent,busy:true,error:""});
      const res=await fetch(`${import.meta.env.BASE_URL}api/${intent.endpoint}`,{
        method:"POST",credentials:"include",headers:{"Content-Type":"application/json","Idempotency-Key":intent.key,
          ...(intent.responsibility?{"X-Responsibility-Id":intent.responsibility}:{})},
        body:JSON.stringify(intent.body)});
      const data=await res.json() as ResumeResult;
      if(data?.id!==intent.meta!.id||data.requestId!==intent.key||data.sessionId!==intent.body.sessionId)
        throw Error(uncertain);
      if(data.state==="unavailable"){
        if(res.status!==404)throw Error(uncertain);
      }else{
        if(!res.ok||data.state!==(intent.meta!.kind==="resume"?"resumed":"cancelled"))throw Error(uncertain);
        if(data.state==="resumed"&&(!Array.isArray(data.items)||!data.items.length||
          !(data.customerId===null||Number.isSafeInteger(data.customerId)&&Number(data.customerId)>0)||
          data.items.some(i=>!Number.isSafeInteger(i.productId)||i.productId<=0||!Number.isSafeInteger(i.quantity)||i.quantity<=0)))
          throw Error(uncertain);
      }
      if(!alive.current||scopeRef.current!==scope)return null;
      return {intent,result:data};
    }catch(e){
      update({intent,error:e instanceof TypeError||e instanceof SyntaxError?uncertain:e instanceof Error?e.message:uncertain});return null;
    }finally{sending.current=false;update({busy:false});}
  }
  function acknowledge(intent:ResumeIntent){
    try{
      if(scopeRef.current!==scope||clearIntentIfKey(resumeStorageKey(scope),intent.key)!=="cleared")
        throw Error("لم تُمسح محاولة أحدث؛ احتُفظ بالسلة. أعد التحقق.");
      update({intent:null,error:""});return true;
    }catch(e){update({error:e instanceof Error?e.message:uncertain});return false;}
  }
  return {...current,submit,acknowledge};
}
