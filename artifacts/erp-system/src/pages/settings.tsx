import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useGetAppSettings,
  usePatchAppSettings,
  getGetAppSettingsQueryKey,
  useGetSecurityChecklist,
  useListAuditLogs,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { WorkflowTab } from "@/components/workflow-tab";
import { SellerCommissionsPanel } from "@/components/sellers/seller-commissions";
import { useInsightMode } from "@/hooks/use-insight-mode";
import { useAuditConsent } from "@/hooks/use-audit-consent";
import { useLanguage } from "@/hooks/use-language";
import {
  useListAuditAccess,
  getListAuditAccessQueryKey,
} from "@workspace/api-client-react";
import { useCurrentCompany } from "@/hooks/use-current-company";
import { usePermissions } from "@/hooks/use-permissions";
import { useToast } from "@/hooks/use-toast";
import { CompanySettingsTab } from "@/components/company-settings-tab";
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
  Bell,
  Globe,
  Hash,
  Palette,
  Database,
  FileText,
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
  notifications: SectionPayload;
  localization: SectionPayload;
  numbering: SectionPayload;
  appearance: SectionPayload;
  backup: SectionPayload;
  templates: SectionPayload;
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
          الإعدادات الإقليمية
        </CardTitle>
        <CardDescription>العملة والمنطقة الزمنية ولغة الواجهة. الهوية القانونية وعروض الإيصال (58/80 مم) تُدار في قسم «الهوية القانونية والطباعة» أعلاه لكل شركة.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
          <CardTitle>المستخدمون والصلاحيات</CardTitle>
          <CardDescription>مالك النظام والمديرون ومسؤولياتهم، وتعليق الوصول أو إزالة العضوية. يظهر للمخوّلين فقط.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate("/settings/users")} data-testid="btn-open-settings-users">فتح المستخدمين والصلاحيات <ChevronLeft className="ms-2 size-4" /></Button>
          <Button variant="ghost" onClick={() => navigate("/account/membership")} data-testid="btn-open-account-membership">عضويتي</Button>
        </CardContent>
      </Card>
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

// ====================== 9. NOTIFICATIONS ======================
const NOTIFY_EVENTS = [
  { key: "lowStock", label: "تنبيه انخفاض المخزون" },
  { key: "newOrder", label: "أمر بيع/فاتورة جديدة" },
  { key: "invoiceOverdue", label: "فاتورة عميل متأخرة السداد" },
  { key: "posSessionClosed", label: "إغلاق جلسة نقطة بيع" },
  { key: "newLead", label: "عميل محتمل جديد" },
  { key: "fraudAnomaly", label: "نشاط مشبوه / احتيال محتمل" },
] as const;

/**
 * Notifications tab — controls channels (email/SMS/WhatsApp/in-app)
 * and per-event subscriptions. Sensitive transport credentials
 * (smtpUser/smtpPassword/smsApiKey/whatsappToken) are redacted from
 * non-admin responses by the API.
 */
function NotificationsTab({ readOnly }: { readOnly: boolean }) {
  const [draft, setDraft] = useSettingsSection<SectionPayload>("notifications", {
    channels: { email: true, sms: false, whatsapp: false, inApp: true } as Record<string, boolean>,
    events: NOTIFY_EVENTS.reduce<Record<string, boolean>>((a, e) => ({ ...a, [e.key]: true }), {}),
    fromAddress: "no-reply@hasba.ai",
    smtpHost: "",
    smtpPort: 587,
    smsSender: "HASBA",
    whatsappPhone: "",
  });
  const save = useSavePatch();
  const ch = (draft.channels as Record<string, boolean>) ?? {};
  const ev = (draft.events as Record<string, boolean>) ?? {};

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="size-5 text-primary" /> التنبيهات والإشعارات
        </CardTitle>
        <CardDescription>اختر القنوات والأحداث التي تريد تلقّي إشعار عنها.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <Label className="mb-2 block text-sm font-bold">قنوات التسليم</Label>
          <div className="grid gap-2 md:grid-cols-2">
            {[
              { k: "email", l: "البريد الإلكتروني" },
              { k: "sms", l: "رسائل SMS" },
              { k: "whatsapp", l: "WhatsApp" },
              { k: "inApp", l: "داخل النظام" },
            ].map((c) => (
              <div key={c.k} className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm">{c.l}</span>
                <Switch
                  checked={Boolean(ch[c.k])}
                  onCheckedChange={(v) => setDraft({ ...draft, channels: { ...ch, [c.k]: v } })}
                  disabled={readOnly}
                  data-testid={`switch-ch-${c.k}`}
                />
              </div>
            ))}
          </div>
        </div>
        <Separator />
        <div>
          <Label className="mb-2 block text-sm font-bold">الأحداث المُنبَّه عنها</Label>
          <div className="grid gap-2 md:grid-cols-2">
            {NOTIFY_EVENTS.map((e) => (
              <div key={e.key} className="flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm">{e.label}</span>
                <Switch
                  checked={Boolean(ev[e.key])}
                  onCheckedChange={(v) => setDraft({ ...draft, events: { ...ev, [e.key]: v } })}
                  disabled={readOnly}
                  data-testid={`switch-ev-${e.key}`}
                />
              </div>
            ))}
          </div>
        </div>
        <Separator />
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>عنوان المرسل</Label>
            <Input
              dir="ltr"
              value={String(draft.fromAddress ?? "")}
              onChange={(e) => setDraft({ ...draft, fromAddress: e.target.value })}
              disabled={readOnly}
              data-testid="input-from-address"
            />
          </div>
          <div>
            <Label>SMTP Host</Label>
            <Input
              dir="ltr"
              value={String(draft.smtpHost ?? "")}
              onChange={(e) => setDraft({ ...draft, smtpHost: e.target.value })}
              disabled={readOnly}
              data-testid="input-smtp-host"
            />
          </div>
          <div>
            <Label>SMTP Port</Label>
            <Input
              type="number"
              dir="ltr"
              value={Number(draft.smtpPort ?? 587)}
              onChange={(e) => setDraft({ ...draft, smtpPort: Number(e.target.value) })}
              disabled={readOnly}
              data-testid="input-smtp-port"
            />
          </div>
          <div>
            <Label>اسم مرسل SMS</Label>
            <Input
              dir="ltr"
              value={String(draft.smsSender ?? "")}
              onChange={(e) => setDraft({ ...draft, smsSender: e.target.value })}
              disabled={readOnly}
              data-testid="input-sms-sender"
            />
          </div>
        </div>
        {!readOnly && (
          <div className="flex justify-end">
            <Button onClick={() => save({ notifications: draft })} data-testid="btn-save-notifications">
              <Save className="ms-2 size-4" /> حفظ
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ====================== 10. LOCALIZATION ======================
/**
 * Localization tab — display preferences that affect every formatted
 * number/date in the app (does NOT change the UI translation language,
 * which is per-user via `useLanguage`).
 */
function LocalizationTab({ readOnly }: { readOnly: boolean }) {
  const [draft, setDraft] = useSettingsSection<SectionPayload>("localization", {
    dateFormat: "DD/MM/YYYY",
    timeFormat: "24h",
    numberFormat: "ar-SA",
    firstDayOfWeek: "sunday",
    currencyDisplay: "symbol",
    decimalPlaces: 2,
    secondaryCurrencies: "USD,AED",
  });
  const save = useSavePatch();
  const set = <K extends keyof typeof draft>(k: K, v: unknown) =>
    setDraft({ ...draft, [k]: v });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="size-5 text-primary" /> التوطين والعرض
        </CardTitle>
        <CardDescription>تنسيقات التاريخ والأرقام وأسلوب عرض العملات.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>تنسيق التاريخ</Label>
            <Input dir="ltr" value={String(draft.dateFormat ?? "")} onChange={(e) => set("dateFormat", e.target.value)} disabled={readOnly} placeholder="DD/MM/YYYY" data-testid="input-date-format" />
          </div>
          <div>
            <Label>تنسيق الوقت</Label>
            <Input dir="ltr" value={String(draft.timeFormat ?? "")} onChange={(e) => set("timeFormat", e.target.value)} disabled={readOnly} placeholder="24h | 12h" data-testid="input-time-format" />
          </div>
          <div>
            <Label>تنسيق الأرقام (locale)</Label>
            <Input dir="ltr" value={String(draft.numberFormat ?? "")} onChange={(e) => set("numberFormat", e.target.value)} disabled={readOnly} placeholder="ar-SA | en-US" data-testid="input-number-format" />
          </div>
          <div>
            <Label>أول أيام الأسبوع</Label>
            <Input dir="ltr" value={String(draft.firstDayOfWeek ?? "")} onChange={(e) => set("firstDayOfWeek", e.target.value)} disabled={readOnly} placeholder="sunday | saturday | monday" data-testid="input-first-day" />
          </div>
          <div>
            <Label>عرض العملة</Label>
            <Input dir="ltr" value={String(draft.currencyDisplay ?? "")} onChange={(e) => set("currencyDisplay", e.target.value)} disabled={readOnly} placeholder="symbol | code | name" data-testid="input-currency-display" />
          </div>
          <div>
            <Label>عدد الخانات العشرية</Label>
            <Input type="number" min={0} max={4} value={Number(draft.decimalPlaces ?? 2)} onChange={(e) => set("decimalPlaces", Number(e.target.value))} disabled={readOnly} data-testid="input-decimals" />
          </div>
          <div className="md:col-span-2">
            <Label>عملات ثانوية (مفصولة بفواصل)</Label>
            <Input dir="ltr" value={String(draft.secondaryCurrencies ?? "")} onChange={(e) => set("secondaryCurrencies", e.target.value)} disabled={readOnly} placeholder="USD,AED,EUR" data-testid="input-secondary-currencies" />
          </div>
        </div>
        {!readOnly && (
          <div className="flex justify-end">
            <Button onClick={() => save({ localization: draft })} data-testid="btn-save-localization">
              <Save className="ms-2 size-4" /> حفظ
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ====================== 11. NUMBERING SEQUENCES ======================
const NUMBERING_DOCS = [
  { key: "invoice", label: "فاتورة المبيعات", prefix: "INV-" },
  { key: "creditNote", label: "إشعار دائن", prefix: "CN-" },
  { key: "debitNote", label: "إشعار مدين", prefix: "DN-" },
  { key: "quotation", label: "عرض سعر", prefix: "QT-" },
  { key: "salesOrder", label: "أمر بيع", prefix: "SO-" },
  { key: "purchaseOrder", label: "أمر شراء", prefix: "PO-" },
  { key: "supplierInvoice", label: "فاتورة مورد", prefix: "SI-" },
  { key: "stockTransfer", label: "تحويل مخزون", prefix: "ST-" },
  { key: "journalEntry", label: "قيد محاسبي", prefix: "JE-" },
] as const;

/**
 * Numbering tab — per-document prefix + next-number sequences shown
 * to subscribers so they can match their preferred document numbering
 * scheme.
 */
function NumberingTab({ readOnly }: { readOnly: boolean }) {
  const initial = NUMBERING_DOCS.reduce<Record<string, { prefix: string; next: number; padding: number }>>((a, d) => {
    a[d.key] = { prefix: d.prefix, next: 1, padding: 6 };
    return a;
  }, {});
  const [draft, setDraft] = useSettingsSection<SectionPayload>("numbering", initial);
  const seq = (k: string) =>
    ((draft as Record<string, { prefix: string; next: number; padding: number }>)[k]) ??
    { prefix: "", next: 1, padding: 6 };
  const updateSeq = (k: string, patch: Partial<{ prefix: string; next: number; padding: number }>) =>
    setDraft({ ...draft, [k]: { ...seq(k), ...patch } });
  const save = useSavePatch();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hash className="size-5 text-primary" /> ترقيم المستندات
        </CardTitle>
        <CardDescription>اضبط بادئة كل مستند ورقم البداية والحشو (Padding).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {NUMBERING_DOCS.map((d) => {
          const s = seq(d.key);
          return (
            <div key={d.key} className="grid items-center gap-2 rounded-lg border p-3 md:grid-cols-4">
              <div className="text-sm font-medium">{d.label}</div>
              <div>
                <Label className="text-xs">البادئة</Label>
                <Input dir="ltr" value={String(s.prefix ?? "")} onChange={(e) => updateSeq(d.key, { prefix: e.target.value })} disabled={readOnly} data-testid={`input-prefix-${d.key}`} />
              </div>
              <div>
                <Label className="text-xs">الرقم التالي</Label>
                <Input type="number" min={1} value={Number(s.next ?? 1)} onChange={(e) => updateSeq(d.key, { next: Number(e.target.value) })} disabled={readOnly} data-testid={`input-next-${d.key}`} />
              </div>
              <div>
                <Label className="text-xs">عرض الرقم (Padding)</Label>
                <Input type="number" min={0} max={12} value={Number(s.padding ?? 6)} onChange={(e) => updateSeq(d.key, { padding: Number(e.target.value) })} disabled={readOnly} data-testid={`input-padding-${d.key}`} />
              </div>
              <div className="md:col-span-4 text-[11px] text-muted-foreground">
                مثال: <span className="font-mono">{`${s.prefix}${String(s.next).padStart(Number(s.padding) || 0, "0")}`}</span>
              </div>
            </div>
          );
        })}
        {!readOnly && (
          <div className="flex justify-end">
            <Button onClick={() => save({ numbering: draft })} data-testid="btn-save-numbering">
              <Save className="ms-2 size-4" /> حفظ
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ====================== 12. APPEARANCE ======================
/**
 * Appearance tab — global defaults for theme, density, accent and
 * sidebar behaviour. Individual users can still override via the
 * header theme/language toggles.
 */
function AppearanceTab({ readOnly }: { readOnly: boolean }) {
  const [draft, setDraft] = useSettingsSection<SectionPayload>("appearance", {
    theme: "auto",
    density: "comfortable",
    accentColor: "#10b981",
    sidebarCollapsed: false,
    showCompanyLogo: true,
    showWelcomeBanner: true,
  });
  const save = useSavePatch();
  const set = (k: string, v: unknown) => setDraft({ ...draft, [k]: v });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="size-5 text-primary" /> المظهر والتخصيص
        </CardTitle>
        <CardDescription>الإعدادات الافتراضية للمظهر التي تُطبق على كل المستخدمين الجدد.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>السمة الافتراضية</Label>
            <Input dir="ltr" value={String(draft.theme ?? "")} onChange={(e) => set("theme", e.target.value)} disabled={readOnly} placeholder="light | dark | auto" data-testid="input-theme" />
          </div>
          <div>
            <Label>الكثافة</Label>
            <Input dir="ltr" value={String(draft.density ?? "")} onChange={(e) => set("density", e.target.value)} disabled={readOnly} placeholder="comfortable | compact" data-testid="input-density" />
          </div>
          <div>
            <Label>اللون المميز (HEX)</Label>
            <div className="flex items-center gap-2">
              <Input dir="ltr" value={String(draft.accentColor ?? "")} onChange={(e) => set("accentColor", e.target.value)} disabled={readOnly} placeholder="#10b981" data-testid="input-accent" />
              <div className="size-9 rounded-md border" style={{ background: String(draft.accentColor ?? "#10b981") }} />
            </div>
          </div>
        </div>
        <Separator />
        <div className="grid gap-2 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <span className="text-sm">طي القائمة الجانبية افتراضياً</span>
            <Switch checked={Boolean(draft.sidebarCollapsed)} onCheckedChange={(v) => set("sidebarCollapsed", v)} disabled={readOnly} data-testid="switch-sidebar-collapsed" />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <span className="text-sm">إظهار شعار الشركة في الترويسة</span>
            <Switch checked={Boolean(draft.showCompanyLogo)} onCheckedChange={(v) => set("showCompanyLogo", v)} disabled={readOnly} data-testid="switch-show-logo" />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <span className="text-sm">إظهار شريط الترحيب في لوحة القيادة</span>
            <Switch checked={Boolean(draft.showWelcomeBanner)} onCheckedChange={(v) => set("showWelcomeBanner", v)} disabled={readOnly} data-testid="switch-show-welcome" />
          </div>
        </div>
        <Separator />
        <InsightModeRow />
        {!readOnly && (
          <div className="flex justify-end">
            <Button onClick={() => save({ appearance: draft })} data-testid="btn-save-appearance">
              <Save className="ms-2 size-4" /> حفظ
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Task #259 — per-user Insight Mode preference, surfaced alongside the
 * (tenant-wide) appearance defaults so the user sees one consistent
 * "look & feel" page.
 */
function InsightModeRow() {
  const { enabled, setMode } = useInsightMode();
  const { t } = useLanguage();
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="space-y-0.5">
        <div className="text-sm font-medium">
          {t("appearance_extra.insightModeTitle")}
        </div>
        <div className="text-xs text-muted-foreground">
          {t("appearance_extra.insightModeHint")}
        </div>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={(v) => void setMode(Boolean(v))}
        data-testid="switch-insight-mode"
      />
    </div>
  );
}

/**
 * Task #259 — Privacy & Consent tab. Per-user consent flags + a
 * "who viewed your trail" ledger from /security/audit-access. The
 * owner role bypasses redaction on the server side; we flag this to
 * the user so they understand the limits of their toggles.
 */
function PrivacyConsentTab() {
  const { t } = useLanguage();
  const { consent, setConsent, isLoading } = useAuditConsent();
  const { toast } = useToast();
  const ledger = useListAuditAccess({
    query: { queryKey: getListAuditAccessQueryKey(), staleTime: 30_000 },
  });

  const onToggle = (key: keyof typeof consent) => (v: boolean) => {
    setConsent({ [key]: v }).catch((e) =>
      toast({
        title: "Failed",
        description: String(e),
        variant: "destructive",
      }),
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            {t("privacy.title")}
          </CardTitle>
          <CardDescription>{t("privacy.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(
            [
              ["salesDetails", "privacy.salesDetails", "privacy.salesDetailsHint"],
              ["customerPii", "privacy.customerPii", "privacy.customerPiiHint"],
              [
                "locationContext",
                "privacy.locationContext",
                "privacy.locationContextHint",
              ],
            ] as const
          ).map(([key, labelKey, hintKey]) => (
            <div
              key={key}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="space-y-0.5">
                <div className="text-sm font-medium">{t(labelKey)}</div>
                <div className="text-xs text-muted-foreground">{t(hintKey)}</div>
              </div>
              <Switch
                checked={consent[key]}
                onCheckedChange={onToggle(key)}
                disabled={isLoading}
                data-testid={`switch-consent-${key}`}
              />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{t("privacy.ownerNote")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t("privacy.ledgerTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {!ledger.data || ledger.data.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              {t("privacy.ledgerEmpty")}
            </div>
          ) : (
            <ul className="space-y-1 text-xs">
              {ledger.data.slice(0, 50).map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between rounded border-b py-1"
                  data-testid={`row-audit-access-${row.id}`}
                >
                  <span className="font-medium">{row.userName}</span>
                  <span className="text-muted-foreground">
                    {row.action} · {row.entity}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


// ====================== 13. BACKUP & DATA ======================
/**
 * Backup tab — schedule + retention metadata for automatic backups.
 * Storage credentials (s3AccessKey/s3SecretKey/encryptionKey) are
 * redacted from non-admin responses by the API.
 */
function BackupTab({ readOnly }: { readOnly: boolean }) {
  const [draft, setDraft] = useSettingsSection<SectionPayload>("backup", {
    autoBackup: true,
    frequency: "daily",
    retentionDays: 30,
    includeAttachments: true,
    storageProvider: "replit",
    s3Bucket: "",
    s3Region: "me-south-1",
  });
  const save = useSavePatch();
  const set = (k: string, v: unknown) => setDraft({ ...draft, [k]: v });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="size-5 text-primary" /> النسخ الاحتياطي والبيانات
          </CardTitle>
          <CardDescription>اضبط الجدولة والاحتفاظ ومكان التخزين.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <div className="font-medium">تفعيل النسخ الاحتياطي التلقائي</div>
              <div className="text-xs text-muted-foreground">يأخذ النظام نسخة كاملة على الجدول المحدد.</div>
            </div>
            <Switch checked={Boolean(draft.autoBackup)} onCheckedChange={(v) => set("autoBackup", v)} disabled={readOnly} data-testid="switch-auto-backup" />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label>التكرار</Label>
              <Input dir="ltr" value={String(draft.frequency ?? "")} onChange={(e) => set("frequency", e.target.value)} disabled={readOnly} placeholder="daily | weekly | monthly" data-testid="input-frequency" />
            </div>
            <div>
              <Label>مدة الاحتفاظ (أيام)</Label>
              <Input type="number" min={1} value={Number(draft.retentionDays ?? 30)} onChange={(e) => set("retentionDays", Number(e.target.value))} disabled={readOnly} data-testid="input-retention" />
            </div>
            <div>
              <Label>مزود التخزين</Label>
              <Input dir="ltr" value={String(draft.storageProvider ?? "")} onChange={(e) => set("storageProvider", e.target.value)} disabled={readOnly} placeholder="replit | s3 | gcs" data-testid="input-storage-provider" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <span className="text-sm">شمل الملفات المرفقة (صور، PDFs)</span>
            <Switch checked={Boolean(draft.includeAttachments)} onCheckedChange={(v) => set("includeAttachments", v)} disabled={readOnly} data-testid="switch-include-attachments" />
          </div>
          <Separator />
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>S3 Bucket (اختياري)</Label>
              <Input dir="ltr" value={String(draft.s3Bucket ?? "")} onChange={(e) => set("s3Bucket", e.target.value)} disabled={readOnly} data-testid="input-s3-bucket" />
            </div>
            <div>
              <Label>S3 Region</Label>
              <Input dir="ltr" value={String(draft.s3Region ?? "")} onChange={(e) => set("s3Region", e.target.value)} disabled={readOnly} placeholder="me-south-1" data-testid="input-s3-region" />
            </div>
          </div>
          {!readOnly && (
            <div className="flex justify-end">
              <Button onClick={() => save({ backup: draft })} data-testid="btn-save-backup">
                <Save className="ms-2 size-4" /> حفظ
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ====================== 14. TEMPLATES ======================
/**
 * Templates tab — default terms, footers, signatures and email
 * boilerplate. Plain-text/HTML; the UI does not validate the inner
 * content, only the wrapping shape.
 */
function TemplatesTab({ readOnly }: { readOnly: boolean }) {
  const [draft, setDraft] = useSettingsSection<SectionPayload>("templates", {
    invoiceTermsAr: "تستحق الفاتورة الدفع خلال 30 يوماً من تاريخ الإصدار.",
    invoiceTermsEn: "Payment due within 30 days from invoice date.",
    invoiceFooterAr: "شكراً لتعاملكم معنا.",
    quotationTermsAr: "هذا العرض صالح لمدة 14 يوماً من تاريخ الإصدار.",
    poTermsAr: "يرجى تأكيد الاستلام خلال 3 أيام.",
    emailSignature: "إدارة حاسبة.AI",
    emailReplyTo: "support@hasba.ai",
  });
  const save = useSavePatch();
  const set = (k: string, v: string) => setDraft({ ...draft, [k]: v });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-5 text-primary" /> القوالب والشروط
        </CardTitle>
        <CardDescription>النصوص الافتراضية التي تظهر على المستندات والإيميلات الصادرة.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>شروط الفاتورة (عربي)</Label>
            <Textarea rows={3} value={String(draft.invoiceTermsAr ?? "")} onChange={(e) => set("invoiceTermsAr", e.target.value)} disabled={readOnly} data-testid="input-inv-terms-ar" />
          </div>
          <div>
            <Label>Invoice Terms (English)</Label>
            <Textarea rows={3} dir="ltr" value={String(draft.invoiceTermsEn ?? "")} onChange={(e) => set("invoiceTermsEn", e.target.value)} disabled={readOnly} data-testid="input-inv-terms-en" />
          </div>
          <div className="md:col-span-2">
            <Label>تذييل الفاتورة</Label>
            <Textarea rows={2} value={String(draft.invoiceFooterAr ?? "")} onChange={(e) => set("invoiceFooterAr", e.target.value)} disabled={readOnly} data-testid="input-inv-footer" />
          </div>
          <div>
            <Label>شروط عرض السعر</Label>
            <Textarea rows={2} value={String(draft.quotationTermsAr ?? "")} onChange={(e) => set("quotationTermsAr", e.target.value)} disabled={readOnly} data-testid="input-qt-terms" />
          </div>
          <div>
            <Label>شروط أمر الشراء</Label>
            <Textarea rows={2} value={String(draft.poTermsAr ?? "")} onChange={(e) => set("poTermsAr", e.target.value)} disabled={readOnly} data-testid="input-po-terms" />
          </div>
          <div>
            <Label>توقيع البريد الإلكتروني</Label>
            <Textarea rows={2} value={String(draft.emailSignature ?? "")} onChange={(e) => set("emailSignature", e.target.value)} disabled={readOnly} data-testid="input-email-signature" />
          </div>
          <div>
            <Label>عنوان الرد (Reply-To)</Label>
            <Input dir="ltr" value={String(draft.emailReplyTo ?? "")} onChange={(e) => set("emailReplyTo", e.target.value)} disabled={readOnly} data-testid="input-reply-to" />
          </div>
        </div>
        {!readOnly && (
          <div className="flex justify-end">
            <Button onClick={() => save({ templates: draft })} data-testid="btn-save-templates">
              <Save className="ms-2 size-4" /> حفظ
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ====================== SIDEBAR NAV ======================
const SETTINGS_NAV: Array<{
  label: string;
  items: Array<{ value: string; label: string; icon: typeof Building2 }>;
}> = [
  {
    label: "المنشأة",
    items: [
      { value: "company", label: "هوية المنشأة", icon: Building2 },
      { value: "branches", label: "الفروع والمخزون", icon: Boxes },
      { value: "localization", label: "التوطين", icon: Globe },
    ],
  },
  {
    label: "المالية والامتثال",
    items: [
      { value: "tax", label: "الضرائب", icon: Receipt },
      { value: "accounting", label: "المحاسبة", icon: Calculator },
      { value: "numbering", label: "الترقيم", icon: Hash },
    ],
  },
  {
    label: "العمليات",
    items: [
      { value: "pos", label: "نقاط البيع", icon: CreditCard },
      { value: "integrations", label: "الربط", icon: Plug },
      { value: "templates", label: "القوالب", icon: FileText },
      { value: "workflow", label: "الموافقات والحدود والأتمتة", icon: ShieldCheck },
      { value: "seller-policy", label: "سياسات البائع ووراثة الفرع", icon: Users },
    ],
  },
  {
    label: "النظام",
    items: [
      { value: "users", label: "المستخدمون والصلاحيات", icon: Users },
      { value: "notifications", label: "التنبيهات", icon: Bell },
      { value: "appearance", label: "المظهر", icon: Palette },
      { value: "backup", label: "النسخ الاحتياطي", icon: Database },
      { value: "security", label: "الأمان", icon: ShieldCheck },
      { value: "privacy", label: "الخصوصية والموافقة", icon: ShieldCheck },
    ],
  },
];

// ====================== PAGE SHELL ======================
export default function SettingsPage() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const { activeCompany, canSwitch } = useCurrentCompany();
  const readOnly = !isAdmin;
  const isMobile = useIsMobile();
  const { isRTL } = useLanguage();
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

      <Tabs
        defaultValue="company"
        className={`lg:flex lg:gap-6 ${isRTL ? "lg:flex-row-reverse" : "lg:flex-row"}`}
        orientation={isMobile ? "horizontal" : "vertical"}
      >
        {/* Sidebar (vertical on lg+, horizontal scroll on smaller screens) */}
        <TabsList
          className="
            sticky top-0 z-10 mb-4 flex h-auto w-full shrink-0 gap-1 overflow-x-auto
            rounded-xl border bg-card p-2 text-foreground shadow-sm
            lg:mb-0 lg:w-64 lg:flex-col lg:items-stretch lg:overflow-visible lg:p-3
          "
        >
          {SETTINGS_NAV.map((group, gi) => (
            <div key={gi} className="contents lg:block lg:w-full">
              {group.label && (
                <div className="hidden px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground first:pt-0 lg:block">
                  {group.label}
                </div>
              )}
              {group.items.filter(it => isAdmin || !["workflow", "seller-policy"].includes(it.value)).map((it) => (
                <TabsTrigger
                  key={it.value}
                  value={it.value}
                  data-testid={`tab-${it.value}`}
                  className="
                    h-9 shrink-0 justify-start gap-2 whitespace-nowrap rounded-lg px-3 text-sm
                    data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow
                    lg:w-full
                  "
                >
                  <it.icon className="size-4 shrink-0" />
                  <span className="truncate">{it.label}</span>
                </TabsTrigger>
              ))}
            </div>
          ))}
        </TabsList>

        <div className="min-w-0 flex-1 space-y-4">
        <TabsContent value="company" className="mt-0 space-y-4">
          <section aria-labelledby="settings-print-identity" data-testid="settings-company-print-profile">
            <h2 id="settings-print-identity" className="mb-2 text-lg font-bold">الهوية القانونية والطباعة (الإيصالات 58/80 مم)</h2>
            <CompanySettingsTab />
          </section>
          <CompanyTab readOnly={readOnly} />
        </TabsContent>
        <TabsContent value="tax"><TaxTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="branches"><BranchesTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="pos"><PosTab readOnly={readOnly} /></TabsContent>
        {isAdmin && <TabsContent value="workflow"><WorkflowTab /></TabsContent>}
        {isAdmin && <TabsContent value="seller-policy"><SellerCommissionsPanel /></TabsContent>}
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="accounting"><AccountingTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="integrations"><IntegrationsTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="notifications"><NotificationsTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="localization"><LocalizationTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="numbering"><NumberingTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="appearance"><AppearanceTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="backup"><BackupTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="templates"><TemplatesTab readOnly={readOnly} /></TabsContent>
        <TabsContent value="security"><SecurityTab /></TabsContent>
        <TabsContent value="privacy"><PrivacyConsentTab /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
