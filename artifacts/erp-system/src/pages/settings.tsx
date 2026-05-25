import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  useGetAppSettings,
  usePatchAppSettings,
  getGetAppSettingsQueryKey,
  useGetSecurityChecklist,
  useListAuditLogs,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentCompany } from "@/hooks/use-current-company";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Building2,
  AlertTriangle,
  Receipt,
  Boxes,
  CreditCard,
  Users,
  Calculator,
  Plug,
  ShieldCheck,
  Save,
  ChevronLeft,
  ExternalLink,
} from "lucide-react";

type SectionPayload = Record<string, unknown>;

function useSettingsSection<T extends SectionPayload>(section: keyof PatchableSections, initial: T) {
  const { data } = useGetAppSettings();
  const [draft, setDraft] = useState<T>(initial);
  useEffect(() => {
    if (data && data[section]) {
      setDraft({ ...initial, ...(data[section] as T) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  return [draft, setDraft] as const;
}

type PatchableSections = {
  company: SectionPayload;
  tax: SectionPayload;
  branches: SectionPayload;
  pos: SectionPayload;
  permissions: SectionPayload;
  accounting: SectionPayload;
  integrations: SectionPayload;
};

function useSavePatch() {
  const patchMut = usePatchAppSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return async (data: Partial<PatchableSections>) => {
    await patchMut.mutateAsync({ data });
    queryClient.invalidateQueries({ queryKey: getGetAppSettingsQueryKey() });
    toast({ title: "تم حفظ الإعدادات" });
  };
}

// ====================== 1. COMPANY PROFILE ======================
function CompanyTab({ readOnly }: { readOnly: boolean }) {
  const [draft, setDraft] = useSettingsSection("company", {
    nameAr: "",
    nameEn: "",
    logoUrl: "",
    vatNumber: "",
    crNumber: "",
    address: "",
    phone: "",
    email: "",
    currency: "SAR",
    timezone: "Asia/Riyadh",
    language: "ar",
  });
  const save = useSavePatch();
  const setF = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft({ ...draft, [k]: e.target.value });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="size-5 text-primary" />
          هوية المنشأة
        </CardTitle>
        <CardDescription>تظهر في الفواتير والتقارير الرسمية وترويسة النظام.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>الاسم التجاري (عربي)</Label>
            <Input value={String(draft.nameAr ?? "")} onChange={setF("nameAr")} disabled={readOnly} data-testid="input-company-name-ar" />
          </div>
          <div>
            <Label>Trade Name (English)</Label>
            <Input value={String(draft.nameEn ?? "")} onChange={setF("nameEn")} disabled={readOnly} dir="ltr" data-testid="input-company-name-en" />
          </div>
          <div>
            <Label>الرقم الضريبي (VAT)</Label>
            <Input value={String(draft.vatNumber ?? "")} onChange={setF("vatNumber")} disabled={readOnly} dir="ltr" placeholder="3xxxxxxxxxxxxx3" data-testid="input-company-vat" />
          </div>
          <div>
            <Label>السجل التجاري</Label>
            <Input value={String(draft.crNumber ?? "")} onChange={setF("crNumber")} disabled={readOnly} dir="ltr" data-testid="input-company-cr" />
          </div>
          <div className="md:col-span-2">
            <Label>العنوان الوطني</Label>
            <Textarea rows={2} value={String(draft.address ?? "")} onChange={setF("address")} disabled={readOnly} data-testid="input-company-address" />
          </div>
          <div>
            <Label>رقم الهاتف</Label>
            <Input value={String(draft.phone ?? "")} onChange={setF("phone")} disabled={readOnly} dir="ltr" data-testid="input-company-phone" />
          </div>
          <div>
            <Label>البريد الإلكتروني الرسمي</Label>
            <Input value={String(draft.email ?? "")} onChange={setF("email")} disabled={readOnly} dir="ltr" data-testid="input-company-email" />
          </div>
          <div>
            <Label>رابط الشعار (Logo URL)</Label>
            <Input value={String(draft.logoUrl ?? "")} onChange={setF("logoUrl")} disabled={readOnly} dir="ltr" data-testid="input-company-logo" />
          </div>
        </div>
        <Separator />
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>العملة الأساسية</Label>
            <Input value={String(draft.currency ?? "SAR")} onChange={setF("currency")} disabled={readOnly} dir="ltr" data-testid="input-company-currency" />
          </div>
          <div>
            <Label>المنطقة الزمنية</Label>
            <Input value={String(draft.timezone ?? "Asia/Riyadh")} onChange={setF("timezone")} disabled={readOnly} dir="ltr" data-testid="input-company-timezone" />
          </div>
          <div>
            <Label>لغة الواجهة الافتراضية</Label>
            <Input value={String(draft.language ?? "ar")} onChange={setF("language")} disabled={readOnly} dir="ltr" placeholder="ar | en" data-testid="input-company-language" />
          </div>
        </div>
        {!readOnly && (
          <div className="flex justify-end">
            <Button onClick={() => save({ company: draft })} data-testid="btn-save-company">
              <Save className="ms-2 size-4" /> حفظ
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ====================== 2. TAX SETTINGS ======================
function TaxTab({ readOnly }: { readOnly: boolean }) {
  const [draft, setDraft] = useSettingsSection("tax", {
    vatEnabled: true,
    vatRate: 15,
    priceIncludesVat: false,
    zatcaEnabled: false,
    zatcaApiUrl: "",
    zatcaCsid: "",
  });
  const save = useSavePatch();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="size-5 text-primary" />
          الإعدادات الضريبية
        </CardTitle>
        <CardDescription>الامتثال لمتطلبات هيئة الزكاة والضريبة والجمارك (ZATCA).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <div className="font-medium">تفعيل ضريبة القيمة المضافة</div>
            <div className="text-xs text-muted-foreground">إيقاف الضريبة سيوقف حسابها على جميع الفواتير الجديدة.</div>
          </div>
          <Switch
            checked={Boolean(draft.vatEnabled)}
            onCheckedChange={(v) => setDraft({ ...draft, vatEnabled: v })}
            disabled={readOnly}
            data-testid="switch-vat-enabled"
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>نسبة الضريبة (%)</Label>
            <Input
              type="number"
              step="0.01"
              value={Number(draft.vatRate ?? 15)}
              onChange={(e) => setDraft({ ...draft, vatRate: Number(e.target.value) })}
              disabled={readOnly}
              data-testid="input-vat-rate"
            />
          </div>
          <div className="flex items-end gap-2 rounded-lg border p-3">
            <Switch
              checked={Boolean(draft.priceIncludesVat)}
              onCheckedChange={(v) => setDraft({ ...draft, priceIncludesVat: v })}
              disabled={readOnly}
              data-testid="switch-vat-inclusive"
            />
            <div>
              <div className="text-sm font-medium">الأسعار شاملة الضريبة</div>
              <div className="text-xs text-muted-foreground">عند التفعيل: السعر المدخل يحوي الضريبة بداخله.</div>
            </div>
          </div>
        </div>
        <Separator />
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <div className="font-medium">ربط الفاتورة الإلكترونية (ZATCA)</div>
            <div className="text-xs text-muted-foreground">يفعّل إرسال الفواتير لـ "فاتورة" واستلام CSID.</div>
          </div>
          <Switch
            checked={Boolean(draft.zatcaEnabled)}
            onCheckedChange={(v) => setDraft({ ...draft, zatcaEnabled: v })}
            disabled={readOnly}
            data-testid="switch-zatca-enabled"
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>ZATCA API URL</Label>
            <Input
              value={String(draft.zatcaApiUrl ?? "")}
              onChange={(e) => setDraft({ ...draft, zatcaApiUrl: e.target.value })}
              disabled={readOnly}
              dir="ltr"
              placeholder="https://gw-fatoora.zatca.gov.sa/..."
              data-testid="input-zatca-url"
            />
          </div>
          <div>
            <Label>CSID (Compliance ID)</Label>
            <Input
              value={String(draft.zatcaCsid ?? "")}
              onChange={(e) => setDraft({ ...draft, zatcaCsid: e.target.value })}
              disabled={readOnly}
              dir="ltr"
              data-testid="input-zatca-csid"
            />
          </div>
        </div>
        {!readOnly && (
          <div className="flex justify-end">
            <Button onClick={() => save({ tax: draft })} data-testid="btn-save-tax">
              <Save className="ms-2 size-4" /> حفظ
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ====================== 3. BRANCHES & INVENTORY ======================
function BranchesTab({ readOnly }: { readOnly: boolean }) {
  const [, navigate] = useLocation();
  const [draft, setDraft] = useSettingsSection("branches", {
    allowNegativeStock: false,
    defaultUom: "حبة",
    lowStockThreshold: 10,
  });
  const save = useSavePatch();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Boxes className="size-5 text-primary" />
            إدارة الفروع
          </CardTitle>
          <CardDescription>إضافة فروع وتحديد مواقعها يتم من صفحة الفروع.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => navigate("/branches")} data-testid="btn-open-branches">
            فتح إدارة الفروع <ChevronLeft className="ms-2 size-4" />
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">إعدادات المخزون</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="font-medium">السماح بالبيع على المكشوف</div>
              <div className="text-xs text-muted-foreground">السماح بالبيع حتى لو وصل المخزون للسالب.</div>
            </div>
            <Switch
              checked={Boolean(draft.allowNegativeStock)}
              onCheckedChange={(v) => setDraft({ ...draft, allowNegativeStock: v })}
              disabled={readOnly}
              data-testid="switch-allow-negative-stock"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>وحدة القياس الافتراضية</Label>
              <Input
                value={String(draft.defaultUom ?? "حبة")}
                onChange={(e) => setDraft({ ...draft, defaultUom: e.target.value })}
                disabled={readOnly}
                data-testid="input-default-uom"
              />
            </div>
            <div>
              <Label>الحد الأدنى للتنبيه بانخفاض المخزون</Label>
              <Input
                type="number"
                value={Number(draft.lowStockThreshold ?? 10)}
                onChange={(e) => setDraft({ ...draft, lowStockThreshold: Number(e.target.value) })}
                disabled={readOnly}
                data-testid="input-low-stock-threshold"
              />
            </div>
          </div>
          {!readOnly && (
            <div className="flex justify-end">
              <Button onClick={() => save({ branches: draft })} data-testid="btn-save-branches">
                <Save className="ms-2 size-4" /> حفظ
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ====================== 4. POS SETTINGS ======================
const PAYMENT_METHODS = [
  { key: "cash", label: "نقدي" },
  { key: "mada", label: "مدى" },
  { key: "visa", label: "فيزا / ماستركارد" },
  { key: "bank_transfer", label: "تحويل بنكي" },
  { key: "credit", label: "آجل" },
] as const;

function PosTab({ readOnly }: { readOnly: boolean }) {
  const [draft, setDraft] = useSettingsSection<SectionPayload>("pos", {
    paymentMethods: { cash: true, mada: true, visa: true, bank_transfer: false, credit: false } as Record<string, boolean>,
    receiptFooter: "شكراً لتسوقكم معنا — سياسة الاسترجاع خلال 14 يوماً مع الفاتورة.",
    allowManualDiscount: true,
    promoCodesEnabled: false,
    printerName: "",
    cashDrawer: false,
    barcodeScanner: true,
  });
  const save = useSavePatch();
  const pm = (draft.paymentMethods as Record<string, boolean>) ?? {};

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="size-5 text-primary" />
          إعدادات نقاط البيع
        </CardTitle>
        <CardDescription>تجربة الكاشير، الأجهزة، والعروض في المعرض.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <Label className="mb-2 block text-sm font-bold">طرق الدفع المتاحة</Label>
          <div className="grid gap-2 md:grid-cols-2">
            {PAYMENT_METHODS.map((m) => (
              <div key={m.key} className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm">{m.label}</span>
                <Switch
                  checked={Boolean(pm[m.key])}
                  onCheckedChange={(v) =>
                    setDraft({ ...draft, paymentMethods: { ...pm, [m.key]: v } })
                  }
                  disabled={readOnly}
                  data-testid={`switch-pm-${m.key}`}
                />
              </div>
            ))}
          </div>
        </div>
        <Separator />
        <div>
          <Label>نص تذييل الفاتورة</Label>
          <Textarea
            rows={3}
            value={String(draft.receiptFooter ?? "")}
            onChange={(e) => setDraft({ ...draft, receiptFooter: e.target.value })}
            disabled={readOnly}
            data-testid="input-receipt-footer"
          />
        </div>
        <Separator />
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <span className="text-sm">السماح بالخصم اليدوي</span>
            <Switch
              checked={Boolean(draft.allowManualDiscount)}
              onCheckedChange={(v) => setDraft({ ...draft, allowManualDiscount: v })}
              disabled={readOnly}
              data-testid="switch-manual-discount"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <span className="text-sm">تفعيل الأكواد الترويجية</span>
            <Switch
              checked={Boolean(draft.promoCodesEnabled)}
              onCheckedChange={(v) => setDraft({ ...draft, promoCodesEnabled: v })}
              disabled={readOnly}
              data-testid="switch-promo-codes"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <span className="text-sm">درج النقود متصل</span>
            <Switch
              checked={Boolean(draft.cashDrawer)}
              onCheckedChange={(v) => setDraft({ ...draft, cashDrawer: v })}
              disabled={readOnly}
              data-testid="switch-cash-drawer"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <span className="text-sm">ماسح الباركود مفعّل</span>
            <Switch
              checked={Boolean(draft.barcodeScanner)}
              onCheckedChange={(v) => setDraft({ ...draft, barcodeScanner: v })}
              disabled={readOnly}
              data-testid="switch-barcode-scanner"
            />
          </div>
        </div>
        <div>
          <Label>اسم الطابعة الحرارية</Label>
          <Input
            value={String(draft.printerName ?? "")}
            onChange={(e) => setDraft({ ...draft, printerName: e.target.value })}
            disabled={readOnly}
            dir="ltr"
            placeholder="TM-T20III"
            data-testid="input-printer-name"
          />
        </div>
        {!readOnly && (
          <div className="flex justify-end">
            <Button onClick={() => save({ pos: draft })} data-testid="btn-save-pos">
              <Save className="ms-2 size-4" /> حفظ
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ====================== 5. USERS & PERMISSIONS ======================
function UsersTab() {
  const [, navigate] = useLocation();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-5 text-primary" /> إدارة المستخدمين
          </CardTitle>
          <CardDescription>أضف الموظفين واربط كل واحد بالفرع والدور المناسب.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => navigate("/users")} data-testid="btn-open-users">
            فتح صفحة المستخدمين <ChevronLeft className="ms-2 size-4" />
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>الأدوار والصلاحيات</CardTitle>
          <CardDescription>مصفوفة الصلاحيات تتاح للمدير في لوحة الإدارة.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => navigate("/admin")} data-testid="btn-open-permissions">
            فتح مصفوفة الصلاحيات <ChevronLeft className="ms-2 size-4" />
          </Button>
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>سجل النشاط (Audit Log)</CardTitle>
        </CardHeader>
        <CardContent>
          <AuditLogPreview />
        </CardContent>
      </Card>
    </div>
  );
}

function AuditLogPreview() {
  const { data: logs } = useListAuditLogs();
  const items = (logs ?? []).slice(0, 6);
  if (items.length === 0) {
    return <div className="text-sm text-muted-foreground">لا توجد أحداث.</div>;
  }
  return (
    <div className="space-y-2">
      {items.map((log) => (
        <div key={log.id} className="rounded-lg border p-3 text-sm">
          <div className="flex items-center justify-between">
            <div className="font-medium">{log.userName}</div>
            <Badge variant="outline" className="text-[10px]">{log.action}</Badge>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{log.entity}</div>
          {log.details && (
            <div className="mt-1 text-xs text-muted-foreground">{log.details}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ====================== 6. ACCOUNTING ======================
function AccountingTab({ readOnly }: { readOnly: boolean }) {
  const [, navigate] = useLocation();
  const [draft, setDraft] = useSettingsSection("accounting", {
    fiscalYearStart: "01-01",
    fiscalYearEnd: "12-31",
    depreciationEnabled: false,
    depreciationMethod: "straight_line",
  });
  const save = useSavePatch();
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="size-5 text-primary" /> السنة المالية
          </CardTitle>
          <CardDescription>تواريخ بداية/نهاية السنة + إغلاق الفترات (شجرة الحسابات تُدار من المحاسبة).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>بداية السنة المالية (شهر-يوم)</Label>
              <Input
                value={String(draft.fiscalYearStart ?? "01-01")}
                onChange={(e) => setDraft({ ...draft, fiscalYearStart: e.target.value })}
                disabled={readOnly}
                dir="ltr"
                placeholder="01-01"
                data-testid="input-fy-start"
              />
            </div>
            <div>
              <Label>نهاية السنة المالية (شهر-يوم)</Label>
              <Input
                value={String(draft.fiscalYearEnd ?? "12-31")}
                onChange={(e) => setDraft({ ...draft, fiscalYearEnd: e.target.value })}
                disabled={readOnly}
                dir="ltr"
                placeholder="12-31"
                data-testid="input-fy-end"
              />
            </div>
          </div>
          <Separator />
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="font-medium">إهلاك الأصول الثابتة</div>
              <div className="text-xs text-muted-foreground">تفعيل حساب الإهلاك الشهري للأصول.</div>
            </div>
            <Switch
              checked={Boolean(draft.depreciationEnabled)}
              onCheckedChange={(v) => setDraft({ ...draft, depreciationEnabled: v })}
              disabled={readOnly}
              data-testid="switch-depreciation"
            />
          </div>
          <div>
            <Label>طريقة الإهلاك</Label>
            <Input
              value={String(draft.depreciationMethod ?? "straight_line")}
              onChange={(e) => setDraft({ ...draft, depreciationMethod: e.target.value })}
              disabled={readOnly}
              dir="ltr"
              placeholder="straight_line | declining_balance"
              data-testid="input-depreciation-method"
            />
          </div>
          {!readOnly && (
            <div className="flex justify-end">
              <Button onClick={() => save({ accounting: draft })} data-testid="btn-save-accounting">
                <Save className="ms-2 size-4" /> حفظ
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>شجرة الحسابات</CardTitle>
          <CardDescription>إدارة دليل الحسابات وربط المبيعات والمشتريات بالحسابات المناسبة.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => navigate("/accounting")} data-testid="btn-open-accounting">
            فتح المحاسبة <ChevronLeft className="ms-2 size-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ====================== 7. INTEGRATIONS ======================
const INTEGRATIONS = [
  { key: "salla", label: "متجر سلة", category: "ecommerce" },
  { key: "zid", label: "متجر زد", category: "ecommerce" },
  { key: "shopify", label: "Shopify", category: "ecommerce" },
  { key: "sms_gateway", label: "بوابة الرسائل النصية (SMS)", category: "communication" },
  { key: "whatsapp", label: "WhatsApp Business", category: "communication" },
  { key: "bank_link", label: "الربط البنكي المباشر", category: "banking" },
] as const;

function IntegrationsTab({ readOnly }: { readOnly: boolean }) {
  const [draft, setDraft] = useSettingsSection("integrations", {} as Record<string, { enabled: boolean }>);
  const save = useSavePatch();
  const get = (k: string) =>
    ((draft as Record<string, { enabled?: boolean }>)[k]?.enabled) ?? false;
  const toggle = (k: string, v: boolean) => {
    setDraft({ ...draft, [k]: { enabled: v } } as Record<string, { enabled: boolean }>);
  };
  const grouped = INTEGRATIONS.reduce<Record<string, typeof INTEGRATIONS[number][]>>((acc, i) => {
    (acc[i.category] ??= []).push(i);
    return acc;
  }, {});
  const catLabels: Record<string, string> = {
    ecommerce: "المتاجر الإلكترونية",
    communication: "التواصل والإشعارات",
    banking: "الخدمات البنكية",
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-5 text-primary" /> الربط والتكامل
        </CardTitle>
        <CardDescription>التكاملات التفصيلية (المفاتيح/الـ webhooks) تُدار من تبويب التكاملات في لوحة الإدارة.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat}>
            <div className="mb-2 text-sm font-bold text-muted-foreground">{catLabels[cat] ?? cat}</div>
            <div className="grid gap-2 md:grid-cols-2">
              {items.map((i) => (
                <div key={i.key} className="flex items-center justify-between rounded-lg border p-3">
                  <span className="text-sm">{i.label}</span>
                  <Switch
                    checked={get(i.key)}
                    onCheckedChange={(v) => toggle(i.key, v)}
                    disabled={readOnly}
                    data-testid={`switch-int-${i.key}`}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
        {!readOnly && (
          <div className="flex justify-end">
            <Button onClick={() => save({ integrations: draft })} data-testid="btn-save-integrations">
              <Save className="ms-2 size-4" /> حفظ
            </Button>
          </div>
        )}
        <a
          className="inline-flex items-center gap-1 text-xs text-primary underline"
          href="/admin"
        >
          فتح إعدادات الربط المتقدمة <ExternalLink className="size-3" />
        </a>
      </CardContent>
    </Card>
  );
}

// ====================== 8. SECURITY (legacy NCA section preserved) ======================
function SecurityTab() {
  const { data: checklist } = useGetSecurityChecklist();
  const score = checklist?.score ?? 0;
  const items = checklist?.items ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-emerald-500" />
          الأمان والامتثال (NCA ECC)
        </CardTitle>
        <CardDescription>درجة الأمان العامة وضوابط الامتثال للهيئة الوطنية للأمن السيبراني.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="text-3xl font-bold tabular-nums">{score}%</div>
          <Badge variant="outline">
            {checklist?.ncaCompliant ? "متوافق NCA ECC" : "غير متوافق"}
          </Badge>
        </div>
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.key} className="rounded-lg border p-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="font-medium">{item.title}</div>
                <Badge variant="outline" className="text-[10px]">{item.severity}</Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{item.description}</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ====================== PAGE SHELL ======================
export default function SettingsPage() {
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const { activeCompany, canSwitch } = useCurrentCompany();
  const readOnly = !isAdmin;
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-3 sm:p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">الإعدادات</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          ضبط هوية المنشأة والضرائب والفروع ونقاط البيع والمحاسبة والربط.
          {readOnly && (
            <Badge variant="outline" className="ms-2">قراءة فقط — للتعديل يلزم دور المدير</Badge>
          )}
          {user?.role && <span className="ms-2 text-xs text-muted-foreground">({user.role})</span>}
        </p>
      </div>

      {activeCompany && canSwitch && (
        <div
          className="flex items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          data-testid="settings-active-company-banner"
        >
          <AlertTriangle className="size-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <div className="font-bold">
              أنت تعدّل: {activeCompany.name}
            </div>
            <div className="text-xs text-amber-800/80">
              التغييرات هنا تنطبق على الشركة النشطة فقط. بدّل الشركة من القائمة العلوية لتعديل شركة أخرى.
            </div>
          </div>
        </div>
      )}

      <Tabs defaultValue="company" className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start gap-1 bg-muted/40 p-1">
          <TabsTrigger value="company" data-testid="tab-company">
            <Building2 className="me-2 size-4" /> المنشأة
          </TabsTrigger>
          <TabsTrigger value="tax" data-testid="tab-tax">
            <Receipt className="me-2 size-4" /> الضرائب
          </TabsTrigger>
          <TabsTrigger value="branches" data-testid="tab-branches">
            <Boxes className="me-2 size-4" /> الفروع والمخزون
          </TabsTrigger>
          <TabsTrigger value="pos" data-testid="tab-pos">
            <CreditCard className="me-2 size-4" /> نقاط البيع
          </TabsTrigger>
          <TabsTrigger value="users" data-testid="tab-users">
            <Users className="me-2 size-4" /> المستخدمون والصلاحيات
          </TabsTrigger>
          <TabsTrigger value="accounting" data-testid="tab-accounting">
            <Calculator className="me-2 size-4" /> المحاسبة
          </TabsTrigger>
          <TabsTrigger value="integrations" data-testid="tab-integrations">
            <Plug className="me-2 size-4" /> الربط
          </TabsTrigger>
          <TabsTrigger value="security" data-testid="tab-security">
            <ShieldCheck className="me-2 size-4" /> الأمان
          </TabsTrigger>
        </TabsList>

        <TabsContent value="company"><CompanyTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="tax"><TaxTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="branches"><BranchesTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="pos"><PosTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="accounting"><AccountingTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="integrations"><IntegrationsTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="security"><SecurityTab /></TabsContent>
      </Tabs>
    </div>
  );
}
