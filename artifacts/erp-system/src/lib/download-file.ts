export class DownloadError extends Error {
  constructor(message:string,public diagnosticRef:string){super(message);}
}
const pending=new Set<string>();
/** Use a real link so the shared PDF status handler can manage existing file buttons. */
export function openFileDownload(url:string):void{
  const a=document.createElement("a");a.href=url;a.target="_blank";a.rel="noopener";document.body.append(a);a.click();a.remove();
}
/** Validate the response before creating any downloadable file. Never save JSON as PDF. */
export async function downloadPdf(url:string,filename:string):Promise<void>{
  const got=await fetchPdf(url,filename);if(!got)return;
  const href=URL.createObjectURL(got.blob),a=document.createElement("a");a.href=href;a.download=got.filename;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),1000);
}
/** Fetch and validate a PDF; returns null when the same URL is already in flight. */
export async function fetchPdf(url:string,filename:string):Promise<{blob:Blob;filename:string}|null>{
  if(pending.has(url))return null;
  pending.add(url);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
  try {
    const r=await fetch(url,{credentials:"include",headers:{Accept:"application/pdf"},signal:controller.signal});
    if(!r.ok||!r.headers.get("content-type")?.toLowerCase().includes("application/pdf")){
      let error="تعذر إنشاء الملف",ref=r.headers.get("x-diagnostic-ref")??r.headers.get("x-request-id")??"";
      try{const b=await r.json();if(typeof b.error==="string")error=b.error.slice(0,250);if(typeof b.diagnosticRef==="string")ref=b.diagnosticRef;}catch{}
      throw new DownloadError(error,ref||`HTTP-${r.status}`);
    }
    const b=await r.blob();
    if(b.size>30*1024*1024||(await b.slice(0,5).text())!=="%PDF-")throw new DownloadError("الاستجابة ليست ملف PDF صالحًا","INVALID_PDF_RESPONSE");
    const disposition=r.headers.get("content-disposition")??"";
    try{
      const encoded=disposition.match(/filename\*=UTF-8''([^;]+)/i),plain=disposition.match(/filename="([^"]+)"/i);
      filename=encoded?decodeURIComponent(encoded[1]!):plain?.[1]??filename;
    }catch{}
    filename=filename.replace(/[\\/:*?"<>|\u0000-\u001f]/g,"_").slice(0,180);
    if(!filename.toLowerCase().endsWith(".pdf"))filename+=".pdf";
    return {blob:b,filename};
  }catch(e){if(e instanceof DownloadError)throw e;throw new DownloadError("تعذر تنزيل الملف؛ تحقق من الاتصال وأعد المحاولة","DOWNLOAD_CONNECTION");}
  finally{clearTimeout(timer);pending.delete(url);}
}
