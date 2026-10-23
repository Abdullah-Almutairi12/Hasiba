import {useEffect,useState} from "react";
import {Button} from "@/components/ui/button";
import {downloadPdf,DownloadError} from "@/lib/download-file";
/** Existing internal PDF links share one pending/error experience. Other links are untouched. */
export function PdfDownloadStatus(){
  const [pending,setPending]=useState(0),[error,setError]=useState<DownloadError|null>(null);
  useEffect(()=>{
    function click(e:MouseEvent){
      if(e.defaultPrevented||e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;
      const a=e.target instanceof Element?e.target.closest<HTMLAnchorElement>("a[href]"):null;
      if(!a)return;
      const u=new URL(a.href,location.href),base=(import.meta.env.BASE_URL||"/").replace(/\/$/,"");
      if(u.origin!==location.origin||!u.pathname.startsWith(`${base}/api/`))return;
      const pdf=/\.pdf$|\/pdf$/.test(u.pathname)||u.searchParams.get("format")==="pdf"||(u.pathname.endsWith("/docs/export")&&!u.searchParams.has("format"));
      if(!pdf)return;
      e.preventDefault();setPending(n=>n+1);setError(null);
      const filename=u.pathname.replace(/^.*\/api\//,"").replace(/\/pdf$|\.pdf$/,"").replaceAll("/","-")+".pdf";
      void downloadPdf(u.href,filename).catch(x=>setError(x instanceof DownloadError?x:new DownloadError("تعذر تنزيل الملف","DOWNLOAD_FAILED"))).finally(()=>setPending(n=>Math.max(0,n-1)));
    }
    document.addEventListener("click",click,true);return()=>document.removeEventListener("click",click,true);
  },[]);
  if(!pending&&!error)return null;
  return <aside className="fixed bottom-4 start-4 z-[100] max-w-sm space-y-2 rounded-lg border bg-background p-4 shadow-lg" aria-live="polite" data-testid="pdf-download-status">
    {pending>0&&<p role="status">جارٍ إنشاء الملف وتنزيله… ({pending})</p>}
    {error&&<div role="alert"><p className="text-sm">{error.message}</p><p dir="ltr" className="select-text text-xs">{error.diagnosticRef}</p>
    <div className="mt-2 flex gap-2"><Button size="sm" variant="outline" onClick={()=>void navigator.clipboard.writeText(error.diagnosticRef).catch(()=>{})}>نسخ مرجع التشخيص</Button><Button size="sm" variant="ghost" onClick={()=>setError(null)}>إغلاق</Button></div></div>}
  </aside>;
}
