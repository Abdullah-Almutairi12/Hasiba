import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { FinancialRequestError } from "./financial-transaction";
/** Decode and normalize bytes in the existing isolated Chromium renderer.
 * Header signatures alone do not prove an image is valid. No URLs accepted. */
export async function normalizePrintLogo(encoded: string): Promise<Buffer> {
  if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded))
    throw new FinancialRequestError("ملف الشعار غير صحيح",400);
  const bytes=Buffer.from(encoded,"base64");
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if ((!png&&!jpeg)||bytes.length>2*1024*1024)
    throw new FinancialRequestError("الشعار PNG أو JPEG حتى 2MB",400);
  const browser=await chromium.launch({executablePath:execFileSync("which",["chromium"],{encoding:"utf8"}).trim(),
    headless:true,args:["--no-sandbox","--disable-dev-shm-usage"],timeout:45000});
  try {
    const context=await browser.newContext({serviceWorkers:"block"});
    await context.route("**/*",r=>r.abort());
    const page=await context.newPage();
    const result=await page.evaluate<string>(`(async () => {
      const url=${JSON.stringify(`data:image/${png?"png":"jpeg"};base64,${encoded}`)};
      const i=new Image();i.src=url;
      await Promise.race([i.decode(),new Promise((_,reject)=>setTimeout(()=>reject(new Error("timeout")),5000))]);
      if(i.width<1||i.height<1||i.width>4096||i.height>4096||i.width*i.height>8000000)throw new Error("dimensions");
      const canvas=document.createElement("canvas");canvas.width=i.width;canvas.height=i.height;
      canvas.getContext("2d")!.drawImage(i,0,0);return canvas.toDataURL("image/png").split(",")[1]!;
    })()`);
    const normalized=Buffer.from(result,"base64");
    if(normalized.length>2*1024*1024)throw new Error("size");
    return normalized;
  } catch {
    throw new FinancialRequestError("تعذر فك صورة الشعار أو تجاوزت أبعادها الحد الآمن",400);
  } finally { await browser.close(); }
}
