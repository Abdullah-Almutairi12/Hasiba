import {createContext,useContext,useState,useRef,useEffect,type ReactNode,type MutableRefObject} from "react";
import {useCurrentCompany} from "@/hooks/use-current-company";
import {useGetAppSettings,usePatchAppSettings,getGetAppSettingsQueryKey} from "@workspace/api-client-react";
import {useQueryClient} from "@tanstack/react-query";
import {useToast} from "@/hooks/use-toast";
import {Button} from "@/components/ui/button";
export type SettingsBaseline={values:Record<string,unknown>;companyId:number;revision:number;parentRevision:number;scopeKey:number;dirty:boolean};
const Context=createContext<{branchId:number|undefined;setBranchId:(id:number|undefined)=>void;baseline:MutableRefObject<Record<string,SettingsBaseline>>;
 generation:number;reload:()=>void}>({branchId:undefined,setBranchId:()=>{},baseline:{current:{}},generation:0,reload:()=>{}});
export const useSettingsScope=()=>useContext(Context);
export function SettingsScopeProvider({children}:{children:ReactNode}){
 const [branchId,setBranchId]=useState<number>();
 const baseline=useRef<Record<string,SettingsBaseline>>({});
 const [generation,setGeneration]=useState(0);
 const {activeCompany}=useCurrentCompany(),client=useQueryClient(),previous=useRef(activeCompany?.id);
 useEffect(()=>{
  if(previous.current===activeCompany?.id)return;
  previous.current=activeCompany?.id;baseline.current={};setBranchId(undefined);setGeneration(n=>n+1);
  void client.resetQueries({queryKey:getGetAppSettingsQueryKey()});
 },[activeCompany?.id,client]);
 return <Context.Provider value={{branchId,setBranchId,baseline,generation,reload:()=>{baseline.current={};setGeneration(n=>n+1);}}}>{children}</Context.Provider>;
}
export function SettingsScopeBar(){
 const {branchId,setBranchId,reload}=useSettingsScope();
 const params=branchId?{branchId}:undefined;
 const settings=useGetAppSettings(params);
 const patch=usePatchAppSettings(),client=useQueryClient(),{toast}=useToast();
 const scope=settings.data?.scope;
 const overrides=Object.entries(scope?.overrides??{}).filter(([,keys])=>keys.length);
 async function restore(section:string,keys:string[]){
  if(!scope||!window.confirm("إزالة تخصيص هذا القسم للفرع والعودة إلى قيم المنشأة الحالية؟"))return;
  try{
   await patch.mutateAsync({params,data:{expectedCompanyId:scope.companyId,expectedRevision:scope.revision,expectedParentRevision:scope.parentRevision,reset:{[section]:keys}}});
   await client.invalidateQueries({queryKey:getGetAppSettingsQueryKey()});
   toast({title:"عاد القسم إلى إعداد المنشأة؛ لم تتغير إعدادات المنشأة"});
  }catch(error){toast({title:"لم تُحفظ العودة للموروث",description:error instanceof Error?error.message:"أعد تحميل النسخة",variant:"destructive"});}
 }
 return <section className="space-y-3 rounded-lg border p-4" aria-label="نطاق إعدادات المنشأة والفرع" data-testid="settings-scope">
  <label className="flex items-center gap-3">نطاق الإعدادات العامة
   <select aria-label="نطاق إعدادات الفرع" className="rounded border p-2" value={branchId??""} disabled={!scope?.canManage||patch.isPending}
    onChange={e=>{if(window.confirm("ستعرض إعدادات النطاق الآخر. احفظ تعديلات النموذج أولًا إن لزم."))setBranchId(e.target.value?Number(e.target.value):undefined);}}>
    <option value="">المنشأة — القيم الافتراضية</option>
    {(scope?.availableBranches??[]).map(b=><option key={b.id} value={b.id}>{b.nameAr??b.name}</option>)}
   </select>
  </label>
  <Button variant="outline" onClick={async()=>{if(window.confirm("تجاهل تعديلات النماذج غير المحفوظة وإعادة تحميل النسخة الحالية؟")){reload();await client.invalidateQueries({queryKey:getGetAppSettingsQueryKey()});}}}>إعادة تحميل نسخة الإعدادات</Button>
  {settings.isLoading?<p>جار تحميل نسخة الإعدادات…</p>:settings.isError?<p role="alert">تعذر تحميل الإعدادات؛ لن يُتاح الحفظ دون نسخة مؤكدة.</p>:
   <p className="text-sm text-muted-foreground">{branchId?"إعداد الفرع يرث قيم المنشأة إلا الحقول المخصصة أدناه.":"إعداد المنشأة الافتراضي للفروع."}
    {" "}نسخة النطاق: {scope?.revision}؛ نسخة المنشأة: {scope?.parentRevision}.
    {" "}إعدادات الهوية القانونية والموافقات وسياسة الاستلام لها خدماتها الأصلية على مستوى المنشأة؛ لا تتغير بهذا المحدد.
    {" "}الإعداد العام القديم غير المنسوب لا يُعتمد تلقائيًا لأي شركة.
    {" "}حفظ التفضيلات لا يثبت تفعيل تكامل خارجي أو تغيير سياسة مالية؛ إعدادات المحركات القانونية والمالية تبقى في خدماتها المخصصة.
   </p>}
  {branchId&&scope?.canManage&&(overrides.length?overrides.map(([section,keys])=><div key={section} className="flex flex-wrap items-center gap-3 text-sm">
   <span>{section}: مخصص — {keys.join("، ")}</span><Button variant="outline" disabled={patch.isPending} onClick={()=>restore(section,keys)}>إعادة {section} للموروث</Button>
  </div>):<p>لا تخصيصات؛ جميع الحقول من إعداد المنشأة.</p>)}
  {scope?.canManage&&<details><summary>سجل آخر50 نسخة لهذا النطاق — بلا قيم سرية</summary>
   {(scope.history??[]).length?(scope.history??[]).map((v,i)=><p key={i} className="text-sm">
    نسخة {String(v.revision)}؛ أصل المنشأة {String(v.parentRevision)}؛ المستخدم {String(v.createdBy)}؛ {String(v.createdAt)}
   </p>):<p>لا تغييرات محفوظة في هذا النطاق بعد.</p>}
  </details>}
 </section>;
}
