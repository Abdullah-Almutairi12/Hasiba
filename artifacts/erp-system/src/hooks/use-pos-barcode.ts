import {useEffect,useRef,useState} from "react";
import {lookupPosBarcode,type Product} from "@workspace/api-client-react";

type Scan={id:number;code:string;epoch:number;snapshot:string|undefined;
  status:"pending"|"waiting"|"failed";message?:string;product?:Product;attempt:number;
  timer?:ReturnType<typeof setTimeout>};
/** Read-only attempts, not financial intents. A retry owns the same scan, not another unit. */
export function usePosBarcode(options:{
  context:string;sessionId:number|undefined;blocked:boolean;
  basketSnapshot?:()=>string;
  add:(p:Product)=>void;error:(message:string)=>void;
}){
  const latest=useRef(options);
  const scans=useRef(new Map<number,Scan>());
  const sequence=useRef(0);
  const mounted=useRef(true);
  const [,redraw]=useState(0);
  const notify=()=>{if(mounted.current)redraw(n=>n+1);};
  const generation=useRef({context:options.context,epoch:0});
  if(generation.current.context!==options.context)
    generation.current={context:options.context,epoch:generation.current.epoch+1};
  latest.current=options;
  const belongs=(s:Scan)=>s.epoch===generation.current.epoch&&
    s.snapshot===latest.current.basketSnapshot?.();
  const remove=(s:Scan)=>{clearTimeout(s.timer);scans.current.delete(s.id);};
  const apply=(s:Scan)=>{
    if(!belongs(s)||!scans.current.has(s.id))return;
    if(latest.current.blocked){s.status="waiting";return;}
    remove(s); // Remove before the cart callback: never apply twice on a rerender.
    latest.current.add(s.product!);
  };
  useEffect(()=>{
    let cancelled=false;
    for(const s of scans.current.values()){
      if(!belongs(s)){remove(s);cancelled=true;}
      else if(s.status==="waiting"&&!options.blocked){apply(s);notify();}
    }
    if(cancelled){latest.current.error("أُلغيت مسحات معلقة لأن سياق السلة أو الوردية تغيّر؛ امسحها مجددًا في السلة الصحيحة.");notify();}
  });
  useEffect(()=>{mounted.current=true;return()=>{
    mounted.current=false;for(const s of scans.current.values())clearTimeout(s.timer);scans.current.clear();
  };},[]);
  const request=async(s:Scan)=>{
    const attempt=++s.attempt;
    s.status="pending";s.message=undefined;s.product=undefined;notify();
    try{
      const product=await Promise.race([
        lookupPosBarcode({code:s.code,sessionId:latest.current.sessionId!}),
        new Promise<never>((_,reject)=>{s.timer=setTimeout(()=>reject(new Error("تأخر البحث عن الباركود. أعد المحاولة أو ألغِ المسحة صراحةً.")),30_000);}),
      ]);
      if(!mounted.current||scans.current.get(s.id)!==s||s.attempt!==attempt)return;
      clearTimeout(s.timer);
      if(!belongs(s)){remove(s);latest.current.error("تغيّرت السلة أو الوردية؛ لم تُضف المسحة المتأخرة.");notify();return;}
      s.product=product;s.status="waiting";apply(s);notify();
    }catch(err){
      if(!mounted.current||scans.current.get(s.id)!==s||s.attempt!==attempt)return;
      clearTimeout(s.timer);
      s.status="failed";s.message=err instanceof Error?err.message:"تعذر البحث عن الباركود.";
      latest.current.error(s.message);notify();
    }
  };
  const scan=async(code:string)=>{
    code=code.trim();
    const start=latest.current,epoch=generation.current.epoch,snapshot=start.basketSnapshot?.();
    if(!code)return;
    if(start.blocked||!start.sessionId){start.error("لا يمكن المسح أثناء التحقق أو محاولة حفظ/دفع معلقة؛ اختر وردية مؤكدة أولًا.");return;}
    const s:Scan={id:++sequence.current,code,epoch,snapshot,status:"pending",attempt:0};
    scans.current.set(s.id,s);await request(s);
  };
  return Object.assign(scan,{
    entries:[...scans.current.values()].filter(belongs).map(({id,code,status,message})=>({id,code,status,message})),
    canRetry:!options.blocked,
    hasUnresolved:()=>[...scans.current.values()].some(belongs),
    retry:(id:number)=>{
      const s=scans.current.get(id);
      if(!s||!belongs(s)||s.status!=="failed"||latest.current.blocked)return;
      return request(s);
    },
    cancel:(id:number)=>{const s=scans.current.get(id);if(s){remove(s);notify();}},
  });
}
