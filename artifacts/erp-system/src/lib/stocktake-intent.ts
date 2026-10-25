/** One durable, unresolved scan per user/company/count/device browser origin.
 * Never contains customer names, prices or costs. Logout must not discard it.
 */
import { getSelectedResponsibility } from "./workspace-responsibility";

export const countHeaders = ():Record<string,string> => {
  const selected=getSelectedResponsibility();
  return selected?{"X-Workspace-Responsibility":String(selected.id)}:{};
};
export type CountIntent = { key: string; code: string; productId: number; countedQty: 1; uncertain?: boolean };
export const countIntentKey = (userId: number, companyId: number, takeId: number) =>
  `hasiba:stocktake-scan:v1:${userId}:${companyId}:${takeId}`;

export function loadCountIntent(storage: Pick<Storage,"getItem">, scope: string): CountIntent | null {
  const raw=storage.getItem(scope);
  if(raw===null)return null;
  const value=JSON.parse(raw);
  if(!value || typeof value.key!=="string" || !/^[0-9a-f-]{36}$/i.test(value.key) ||
    typeof value.code!=="string" || !Number.isSafeInteger(value.productId) || value.productId<=0 || value.countedQty!==1 ||
    value.uncertain!==undefined&&typeof value.uncertain!=="boolean") {
    throw new Error("تعذر قراءة محاولة العد المحفوظة؛ لا تبدأ مسحة جديدة قبل معالجة سجل الاستعادة");
  }
  return value;
}

export class CountRequestError extends Error {
  constructor(message: string, public readonly uncertain: boolean, public readonly status?: number) {super(message);}
}
export async function sendCountIntent(base: string,takeId: number,intent: CountIntent) {
  let response:Response;
  try {
    response=await fetch(`${base}/inventory/stock-takes/${takeId}/lines`,{
      method:"POST",credentials:"include",headers:{"Content-Type":"application/json","Idempotency-Key":intent.key,...countHeaders()},
      body:JSON.stringify({productId:intent.productId,countedQty:intent.countedQty}),
    });
  } catch {throw new CountRequestError("انقطع الاتصال؛ نتيجة المسحة غير مؤكدة. أعد المحاولة بنفس المعرف",true);}
  // Even a proxy 502/408 can follow a committed operation.
  const definite=[400,401,403,404,409,422,428].includes(response.status);
  let body:{error?:string;countedQty?:number};
  try {body=await response.json();} catch {
    throw new CountRequestError("تعذر تأكيد نتيجة المسحة؛ احتُفظ بمعرفها للاستعادة",true,response.status);
  }
  if(!response.ok)throw new CountRequestError(body.error??"تعذر حفظ العد",!definite,response.status);
  if(typeof body.countedQty!=="number"||!Number.isFinite(body.countedQty)) {
    throw new CountRequestError("استجابة العد غير مكتملة؛ أعد التحقق بنفس المعرف",true,response.status);
  }
  return body.countedQty;
}
