import {SettingsScopeProvider,SettingsScopeBar} from "@/components/settings-scope";
import {InvoiceTemplatesTab} from "@/components/invoice-templates-tab";
/** Explicit settings administration does not require a legacy manager role.
 * The same scoped settings service authorizes this native entry and its writes. */
export default function InvoiceTemplatesPage(){
  return <SettingsScopeProvider><main className="mx-auto max-w-7xl space-y-5 p-4" dir="rtl">
    <h1 className="text-2xl font-bold">قوالب الفواتير</h1>
    <p className="text-sm text-muted-foreground">إعدادات تصميم المنشأة والفروع — دون منح صلاحية استخدام الفواتير أو طباعتها أو تصديرها.</p>
    <SettingsScopeBar/><InvoiceTemplatesTab/>
  </main></SettingsScopeProvider>;
}
