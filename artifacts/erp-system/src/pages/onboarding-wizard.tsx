import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ME_KEY } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Calculator,
  Sparkles,
  Check,
  ChevronLeft,
  ChevronRight,
  Store,
  Truck,
  UtensilsCrossed,
  Wrench,
  Info,
  Receipt,
  ArrowLeft,
  AlertCircle,
  Building2,
  Users,
  Settings as SettingsIcon,
  Package,
  TrendingUp,
} from "lucide-react";
import { VatSimulatorBody } from "@/components/vat-simulator-dialog";
import { useLanguage } from "@/hooks/use-language";
import { saveOnboardingBusinessType } from "@/lib/onboarding-save";

const BUSINESS_TYPES = [
  {
    key: "retail",
    icon: Store,
    title: "تجزئة وبيع",
    desc: "متاجر، بقالات، ملابس، إلكترونيات",
  },
  {
    key: "wholesale",
    icon: Truck,
    title: "جملة وتوزيع",
    desc: "موزّعون، مستودعات، B2B",
  },
  {
    key: "fb",
    icon: UtensilsCrossed,
    title: "مطاعم وكافيهات",
    desc: "F&B مع KOT وإدارة الطاولات",
  },
  {
    key: "services",
    icon: Wrench,
    title: "خدمات ومهنية",
    desc: "ورش، استشارات، صيانة",
  },
];

const NEXT_SCREENS = [
  { href: "/branches", icon: Building2, title: "الفروع والمستودعات", desc: "أضف كل فرع فعلياً من شاشة الفروع. لا يُنشئ المعالج أي فرع." },
  { href: "/team-setup", icon: Users, title: "الفريق والصلاحيات", desc: "ادعُ الموظفين وحدّد صلاحياتهم." },
  { href: "/settings", icon: SettingsIcon, title: "إعدادات المنشأة", desc: "العملة، قوالب الفواتير، والسياسة الضريبية." },
  { href: "/products", icon: Package, title: "المنتجات", desc: "أضف الأصناف قبل البدء في البيع." },
];

export default function OnboardingWizard() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { t } = useLanguage();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [businessType, setBusinessType] = useState<string>("retail");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    const result = await saveOnboardingBusinessType(import.meta.env.BASE_URL, businessType);
    if (!result.ok) {
      setSaveError(result.message);
      setSaving(false);
      return;
    }
    await qc.invalidateQueries({ queryKey: ME_KEY });
    setLocation("/");
  };

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30 font-sans text-neutral-900"
    >
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-[#2563EB] text-white shadow">
              <Calculator className="size-4" />
            </div>
            <div className="text-right leading-tight">
              <span className="block text-lg font-bold tracking-tight">
                حاسبة<span className="text-[#2563EB]">.</span>
              </span>
              <span className="text-[9px] font-medium uppercase tracking-wider text-neutral-500">
                Setup Wizard
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-neutral-500">
            <span className="hidden md:inline">يحفظ نوع النشاط فقط</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation("/")}
              className="text-neutral-500"
            >
              تخطي للوحة التحكم
            </Button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-[900px] px-4 py-8 sm:px-6 sm:py-10">
        {/* Step indicator */}
        <div className="mb-8">
          <div className="mx-auto flex max-w-md items-center justify-between">
            {[
              { n: 1, label: "نشاطك" },
              { n: 2, label: "الخطوات التالية" },
              { n: 3, label: "المراجعة والحفظ" },
            ].map((s, i, arr) => {
              const active = step === s.n;
              const done = step > s.n;
              return (
                <div key={s.n} className="flex flex-1 items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={`grid size-10 place-items-center rounded-full text-sm font-bold transition-all ${
                        active
                          ? "bg-[#2563EB] text-white shadow-lg shadow-blue-500/30 ring-4 ring-blue-100"
                          : done
                            ? "bg-emerald-500 text-white"
                            : "bg-white text-neutral-400 ring-1 ring-neutral-200"
                      }`}
                    >
                      {done ? <Check className="size-4" /> : s.n}
                    </div>
                    <span
                      className={`mt-2 max-w-[5.5rem] text-center text-[11px] leading-tight font-bold ${
                        active ? "text-neutral-900" : "text-neutral-400"
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                  {i < arr.length - 1 && (
                    <div
                      className={`mx-2 mt-[-22px] h-0.5 flex-1 ${
                        done ? "bg-emerald-500" : "bg-neutral-200"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Glass card */}
        <div className="min-w-0 rounded-3xl border border-white/60 bg-white/80 p-4 sm:rounded-[2.5rem] sm:p-8 shadow-xl shadow-blue-900/5 backdrop-blur-xl md:p-10">
          {/* Header */}
          <div className="mb-8 text-center">
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-[11px] font-bold text-[#1D4ED8]">
              <Sparkles className="size-3" />
              الخطوة {step} من 3
            </div>
            <h1 className="text-2xl font-extrabold leading-tight sm:text-3xl text-neutral-900">
              {step === 1
                ? "لنخصّص حاسبتك حسب نشاطك"
                : step === 2
                  ? "ما يُضبط من شاشاته الفعلية"
                  : "راجع ما سيُحفظ فعلاً"}
            </h1>
            <p className="mt-2 text-sm text-neutral-500">
              {step === 1
                ? "يحفظ هذا المعالج نوع النشاط فقط، ويُستخدم لتهيئة شكل نقطة البيع."
                : step === 2
                  ? "الفروع والعملة والفواتير والفريق لا تُحفظ هنا. اضبطها من شاشاتها بعد الحفظ."
                  : "سيُحفظ نوع النشاط فقط. بقية الإعداد يتم من الشاشات المخصصة."}
            </p>
          </div>

          {step === 1 && (
          <>
          {/* Section: Business type */}
          <section className="mb-8">
            <div className="mb-4 flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-blue-100 text-[#2563EB]">
                <Store className="size-4" />
              </span>
              <h2 className="text-sm font-bold text-neutral-900">نوع النشاط التجاري</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {BUSINESS_TYPES.map((b) => {
                const Icon = b.icon;
                const selected = businessType === b.key;
                return (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => setBusinessType(b.key)}
                    className={`group relative overflow-hidden rounded-2xl border-2 p-4 text-right transition-all ${
                      selected
                        ? "border-[#2563EB] bg-blue-50/70 shadow-md shadow-blue-200/50"
                        : "border-neutral-200 bg-white hover:border-neutral-300 hover:shadow-sm"
                    }`}
                  >
                    {selected && (
                      <div className="absolute left-2 top-2 grid size-5 place-items-center rounded-full bg-[#2563EB] text-white">
                        <Check className="size-3" />
                      </div>
                    )}
                    <div
                      className={`mb-3 grid size-10 place-items-center rounded-xl transition-colors ${
                        selected
                          ? "bg-[#2563EB] text-white"
                          : "bg-neutral-100 text-neutral-500 group-hover:bg-blue-100 group-hover:text-[#2563EB]"
                      }`}
                    >
                      <Icon className="size-5" />
                    </div>
                    <p className="text-sm font-bold text-neutral-900">{b.title}</p>
                    <p className="mt-1 text-[10px] leading-snug text-neutral-500">
                      {b.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Section: Tax settings */}
          <section className="mb-8">
            <div className="mb-4 flex items-center gap-2">
              <span className="grid size-7 place-items-center rounded-lg bg-blue-100 text-[#2563EB]">
                <Receipt className="size-4" />
              </span>
              <h2 className="text-sm font-bold text-neutral-900">إعدادات الضريبة</h2>
            </div>

            {/* Tax status is NOT decided here: the authoritative, proof-backed
                policy lives in Settings > Tax. Onboarding only guides there. */}
            <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/60 p-4" data-testid="panel-onboarding-tax-guide">
              <p className="text-xs font-bold text-neutral-800">حالة التسجيل الضريبي: غير محسومة بعد</p>
              <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">
                لا يحفظ هذا المعالج حالة التسجيل أو الرقم الضريبي أو تصنيف الأصناف. أعلنها مرة واحدة في السياسة الضريبية للمنشأة بتاريخ سريان وسبب وتأكيد هوية، وتبقى منشأتك غير محسومة حتى تفعل.
              </p>
              <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setLocation("/settings?tab=tax")} data-testid="button-onboarding-open-tax">
                فتح السياسة الضريبية
              </Button>
            </div>

            {/* Task #261 — "Will I need VAT?" simulator panel.
                Informational only: never auto-sets vatRegistrationStatus. */}
            <div
              className="mb-6 rounded-2xl border border-teal-200 bg-teal-50/40 p-4"
              data-testid="panel-onboarding-vat-simulator"
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-lg bg-teal-100 text-teal-700">
                  <TrendingUp className="size-4" />
                </span>
                <div>
                  <h3 className="text-sm font-bold text-neutral-900">
                    {t("vat.simulator.onboarding_title")}
                  </h3>
                  <p className="mt-0.5 text-[11px] leading-snug text-neutral-600">
                    {t("vat.simulator.onboarding_intro")}
                  </p>
                </div>
              </div>
              <div className="rounded-xl bg-white p-3">
                <VatSimulatorBody baseline={0} embedded />
              </div>
            </div>

          </section>

          {/* Info banner */}
          <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#2563EB] text-white">
              <Info className="size-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-blue-900">ما الذي يُحفظ هنا</p>
              <p className="mt-1 text-xs leading-relaxed text-blue-800">
                نوع النشاط فقط. لا يُنشئ المعالج فروعاً ولا يغيّر العملة أو نوع الفاتورة أو الحالة الضريبية.
              </p>
            </div>
          </div>
          </>
          )}

          {step === 2 && (
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2" data-testid="panel-onboarding-next-screens">
              {NEXT_SCREENS.map((n) => {
                const Icon = n.icon;
                return (
                  <button
                    key={n.href}
                    type="button"
                    onClick={() => setLocation(n.href)}
                    className="flex items-start gap-3 rounded-2xl border border-neutral-200 bg-white p-4 text-right transition-all hover:border-[#2563EB] hover:shadow-sm"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-blue-100 text-[#2563EB]">
                      <Icon className="size-5" />
                    </span>
                    <span>
                      <span className="block text-sm font-bold text-neutral-900">{n.title}</span>
                      <span className="mt-1 block text-[11px] leading-snug text-neutral-500">{n.desc}</span>
                    </span>
                  </button>
                );
              })}
              <p className="text-[11px] text-neutral-500 md:col-span-2">
                فتح أي شاشة الآن يغادر المعالج دون حفظ نوع النشاط.
              </p>
            </section>
          )}

          {step === 3 && (
            <section className="space-y-4">
              {[
                { label: "نوع النشاط", value: BUSINESS_TYPES.find((b) => b.key === businessType)?.title, saved: true },
                { label: "الفروع", value: "لا تُنشأ هنا — من شاشة الفروع", saved: false },
                { label: "العملة ونوع الفاتورة", value: "بدون تغيير — من الإعدادات", saved: false },
                { label: "ضريبة القيمة المضافة", value: "غير محسومة — من السياسة الضريبية", saved: false },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3"
                >
                  <span className={`text-sm font-bold ${row.saved ? "text-neutral-900" : "text-neutral-500"}`}>
                    {row.value}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {row.label} {row.saved ? "(سيُحفظ)" : "(لا يُحفظ هنا)"}
                  </span>
                </div>
              ))}
              <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-500 text-white">
                  <Info className="size-4" />
                </div>
                <p className="text-xs leading-relaxed text-amber-900">
                  حفظ النشاط لا يعني أن المتجر جاهز للبيع. أكمل الفروع والفريق والإعدادات والمنتجات من شاشاتها.
                </p>
              </div>
              {saveError && (
                <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4" data-testid="text-onboarding-save-error">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
                  <p className="text-xs font-bold leading-relaxed text-red-800">{saveError}</p>
                </div>
              )}
            </section>
          )}
        </div>

        {/* Footer actions */}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="ghost"
            disabled={step === 1 || saving}
            onClick={() => setStep((step - 1) as 1 | 2 | 3)}
            className="w-full text-neutral-500 hover:text-neutral-800 disabled:text-neutral-300 sm:w-auto"
            size="lg"
            data-testid="button-back"
          >
            <ChevronRight className="ms-1 size-4" />
            رجوع
          </Button>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
            <Button
              variant="ghost"
              size="lg"
              onClick={() => setLocation("/")}
              className="w-full text-neutral-500 hover:text-neutral-800 sm:w-auto"
              data-testid="button-skip"
            >
              تخطي الإعداد
            </Button>
            <Button
              size="lg"
              disabled={saving}
              aria-busy={saving}
              onClick={() => {
                if (step < 3) {
                  setStep((step + 1) as 1 | 2 | 3);
                  return;
                }
                void handleSave();
              }}
              className="h-12 w-full whitespace-normal bg-neutral-900 px-6 sm:w-auto font-bold text-white shadow-lg shadow-neutral-900/20 hover:bg-neutral-800"
              data-testid="button-next"
            >
              {step === 1
                ? "التالي: الخطوات التالية"
                : step === 2
                  ? "التالي: المراجعة"
                  : saving
                    ? "جارٍ الحفظ..."
                    : "حفظ نوع النشاط"}
              <ArrowLeft className="me-2 size-4" />
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
