import { useState } from "react";
import { useLocation } from "wouter";
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
  FileText,
  ArrowLeft,
} from "lucide-react";

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

const CURRENCIES = [
  { code: "SAR", label: "ريال سعودي (SAR)" },
  { code: "AED", label: "درهم إماراتي (AED)" },
  { code: "KWD", label: "دينار كويتي (KWD)" },
  { code: "USD", label: "دولار أمريكي (USD)" },
];

export default function OnboardingWizard() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [businessType, setBusinessType] = useState<string>("retail");
  const [vatType, setVatType] = useState<"standard" | "zero" | "exempt">(
    "standard"
  );
  const [vatRegStatus, setVatRegStatus] = useState<
    "registered" | "voluntary" | "not_registered"
  >("registered");
  const [vatNumber, setVatNumber] = useState("");
  const [invoiceType, setInvoiceType] = useState<"simplified" | "standard">(
    "simplified"
  );
  const [currency, setCurrency] = useState("SAR");
  const [branches, setBranches] = useState(3);

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30 font-sans text-neutral-900"
    >
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
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
            <span className="hidden md:inline">يحتاج 5 دقائق فقط</span>
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
      <main className="mx-auto max-w-[900px] px-6 py-10">
        {/* Step indicator */}
        <div className="mb-8">
          <div className="mx-auto flex max-w-md items-center justify-between">
            {[
              { n: 1, label: "نشاطك" },
              { n: 2, label: "الفروع" },
              { n: 3, label: "الإطلاق" },
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
                      className={`mt-2 whitespace-nowrap text-[11px] font-bold ${
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
        <div className="rounded-[2.5rem] border border-white/60 bg-white/80 p-8 shadow-xl shadow-blue-900/5 backdrop-blur-xl md:p-10">
          {/* Header */}
          <div className="mb-8 text-center">
            <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-[11px] font-bold text-[#1D4ED8]">
              <Sparkles className="size-3" />
              الخطوة {step} من 3
            </div>
            <h1 className="text-3xl font-extrabold leading-tight text-neutral-900">
              {step === 1
                ? "لنخصّص حاسبتك حسب نشاطك"
                : step === 2
                  ? "أضف فروعك ومستودعاتك"
                  : "كل شيء جاهز للإطلاق"}
            </h1>
            <p className="mt-2 text-sm text-neutral-500">
              {step === 1
                ? "اختياراتك تساعدنا على تجهيز الحسابات والوحدات المناسبة لمنشأتك تلقائياً."
                : step === 2
                  ? "حدّد عدد الفروع والمستودعات لتوزيع المخزون وإدارة الكاشيرات."
                  : "راجع الإعدادات ثم أطلق نظامك في دقائق."}
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

            {/* ZATCA SMB registration status — drives whether the system surfaces VAT */}
            <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50/40 p-4">
              <p className="mb-3 text-xs font-bold text-neutral-700">
                هل منشأتك مسجَّلة في ضريبة القيمة المضافة (ZATCA)؟
              </p>
              <div className="grid gap-2 md:grid-cols-3">
                {[
                  { key: "registered", label: "مسجَّلة إلزامي", sub: "مبيعات ≥ 375,000 ر.س / سنة" },
                  { key: "voluntary", label: "مسجَّلة اختياري", sub: "مبيعات بين 187.5K و 375K" },
                  { key: "not_registered", label: "غير مسجَّلة", sub: "مبيعات أقل من 187.5K" },
                ].map((opt) => {
                  const selected = vatRegStatus === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      data-testid={`button-vat-reg-${opt.key}`}
                      onClick={() => setVatRegStatus(opt.key as typeof vatRegStatus)}
                      className={`rounded-xl border-2 p-3 text-right text-xs transition-all ${
                        selected
                          ? "border-[#2563EB] bg-white shadow-sm"
                          : "border-neutral-200 bg-white hover:border-neutral-300"
                      }`}
                    >
                      <p className="font-bold text-neutral-900">{opt.label}</p>
                      <p className="mt-1 text-[10px] text-neutral-500">{opt.sub}</p>
                    </button>
                  );
                })}
              </div>
              {vatRegStatus !== "not_registered" && (
                <div className="mt-3">
                  <label className="block text-xs font-bold text-neutral-700">
                    الرقم الضريبي (15 رقمًا)
                  </label>
                  <input
                    value={vatNumber}
                    onChange={(e) => setVatNumber(e.target.value)}
                    placeholder="3xxxxxxxxxxxxxxx"
                    inputMode="numeric"
                    data-testid="input-vat-number"
                    className="mt-1 w-full rounded-lg border border-neutral-200 bg-white p-2 text-sm font-mono focus:border-[#2563EB] focus:outline-none"
                  />
                </div>
              )}
              {vatRegStatus === "not_registered" && (
                <p className="mt-2 text-[11px] text-neutral-600">
                  سيتم إخفاء حقول الضريبة من الفواتير ونقطة البيع، وعرض عدّاد تذكير عند الاقتراب من الحد الإلزامي.
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-bold text-neutral-700">
                  معدل ضريبة القيمة المضافة
                </p>
                <div className="space-y-2">
                  {[
                    { key: "standard", label: "قياسي 15%", sub: "غالبية السلع والخدمات" },
                    { key: "zero", label: "صفري 0%", sub: "صادرات وأدوية معينة" },
                    { key: "exempt", label: "معفى", sub: "خدمات تعليمية وصحية" },
                  ].map((opt) => {
                    const selected = vatType === opt.key;
                    return (
                      <label
                        key={opt.key}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all ${
                          selected
                            ? "border-[#2563EB] bg-blue-50/50"
                            : "border-neutral-200 bg-white hover:border-neutral-300"
                        }`}
                      >
                        <div
                          className={`grid size-5 place-items-center rounded-full border-2 ${
                            selected
                              ? "border-[#2563EB] bg-[#2563EB]"
                              : "border-neutral-300"
                          }`}
                        >
                          {selected && (
                            <div className="size-1.5 rounded-full bg-white" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-bold text-neutral-900">
                            {opt.label}
                          </p>
                          <p className="text-[11px] text-neutral-500">{opt.sub}</p>
                        </div>
                        <input
                          type="radio"
                          checked={selected}
                          onChange={() => setVatType(opt.key as typeof vatType)}
                          className="hidden"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-bold text-neutral-700">نوع الفاتورة</p>
                <div className="space-y-2">
                  {[
                    {
                      key: "simplified",
                      icon: Receipt,
                      label: "فاتورة مبسطة",
                      sub: "B2C — تجزئة ونقاط بيع",
                    },
                    {
                      key: "standard",
                      icon: FileText,
                      label: "فاتورة ضريبية قياسية",
                      sub: "B2B — مع بيانات المشتري",
                    },
                  ].map((opt) => {
                    const selected = invoiceType === opt.key;
                    const Icon = opt.icon;
                    return (
                      <label
                        key={opt.key}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-all ${
                          selected
                            ? "border-[#2563EB] bg-blue-50/50"
                            : "border-neutral-200 bg-white hover:border-neutral-300"
                        }`}
                      >
                        <div
                          className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                            selected
                              ? "bg-[#2563EB] text-white"
                              : "bg-neutral-100 text-neutral-500"
                          }`}
                        >
                          <Icon className="size-4" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-bold text-neutral-900">
                            {opt.label}
                          </p>
                          <p className="text-[11px] text-neutral-500">{opt.sub}</p>
                        </div>
                        <input
                          type="radio"
                          checked={selected}
                          onChange={() =>
                            setInvoiceType(opt.key as typeof invoiceType)
                          }
                          className="hidden"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* Section: currency + branches */}
          <section className="mb-8">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-xs font-bold text-neutral-700">
                  العملة الأساسية
                </label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="h-12 w-full appearance-none rounded-xl border border-neutral-200 bg-white px-4 text-sm font-medium focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-[11px] text-neutral-500">
                  يمكنك إضافة عملات أخرى لاحقاً من الإعدادات.
                </p>
              </div>

              <div>
                <label className="mb-2 flex items-center justify-between text-xs font-bold text-neutral-700">
                  <span>عدد الفروع المتوقع</span>
                  <span className="rounded-md bg-blue-100 px-2 py-0.5 font-mono text-[#1D4ED8]">
                    {branches}
                  </span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={20}
                  value={branches}
                  onChange={(e) => setBranches(Number(e.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-neutral-200 accent-[#2563EB]"
                />
                <div className="mt-1.5 flex justify-between text-[10px] text-neutral-400">
                  <span>1</span>
                  <span>10</span>
                  <span>20+</span>
                </div>
              </div>
            </div>
          </section>

          {/* Info banner */}
          <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#2563EB] text-white">
              <Info className="size-4" />
            </div>
            <div>
              <p className="text-sm font-bold text-blue-900">إعداد ذكي تلقائي</p>
              <p className="mt-1 text-xs leading-relaxed text-blue-800">
                بناءً على اختياراتك، سنقوم بإعداد دليل الحسابات، تجهيز قوالب الفواتير
                المتوافقة مع ZATCA، وتفعيل الوحدات المناسبة لنشاطك تلقائياً.
              </p>
            </div>
          </div>
          </>
          )}

          {step === 2 && (
            <section className="space-y-6">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {Array.from({ length: Math.min(branches, 6) }).map((_, idx) => (
                  <div
                    key={idx}
                    className="rounded-2xl border-2 border-dashed border-blue-200 bg-blue-50/40 p-5 text-right"
                  >
                    <div className="mb-3 grid size-10 place-items-center rounded-xl bg-[#2563EB] text-white">
                      <Store className="size-5" />
                    </div>
                    <p className="text-sm font-bold text-neutral-900">
                      الفرع #{idx + 1}
                    </p>
                    <p className="mt-1 text-[11px] text-neutral-500">
                      اضبط الاسم والعنوان والمستودع لاحقاً
                    </p>
                  </div>
                ))}
              </div>
              <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#2563EB] text-white">
                  <Info className="size-4" />
                </div>
                <p className="text-xs leading-relaxed text-blue-800">
                  سنُنشئ {branches} فرع/فروع افتراضياً. يمكنك تعديل التفاصيل وإضافة
                  مستودعات من شاشة الفروع لاحقاً.
                </p>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="space-y-4">
              {[
                { label: "نوع النشاط", value: BUSINESS_TYPES.find((b) => b.key === businessType)?.title },
                { label: "ضريبة القيمة المضافة", value: vatType === "standard" ? "قياسي 15%" : vatType === "zero" ? "صفري 0%" : "معفى" },
                { label: "نوع الفاتورة", value: invoiceType === "simplified" ? "فاتورة مبسطة" : "فاتورة قياسية" },
                { label: "العملة الأساسية", value: currency },
                { label: "عدد الفروع", value: `${branches} فرع` },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3"
                >
                  <span className="text-sm font-bold text-neutral-900">
                    {row.value}
                  </span>
                  <span className="text-xs text-neutral-500">{row.label}</span>
                </div>
              ))}
              <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4">
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white">
                  <Check className="size-4" />
                </div>
                <p className="text-xs leading-relaxed text-emerald-800">
                  جاهز للإطلاق. سننقلك إلى لوحة التحكم لبدء استخدام النظام.
                </p>
              </div>
            </section>
          )}
        </div>

        {/* Footer actions */}
        <div className="mt-6 flex items-center justify-between">
          <Button
            variant="ghost"
            disabled={step === 1}
            onClick={() => setStep((step - 1) as 1 | 2 | 3)}
            className="text-neutral-500 hover:text-neutral-800 disabled:text-neutral-300"
            size="lg"
            data-testid="button-back"
          >
            <ChevronRight className="ms-1 size-4" />
            رجوع
          </Button>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="lg"
              onClick={() => setLocation("/")}
              className="text-neutral-500 hover:text-neutral-800"
              data-testid="button-skip"
            >
              تخطي الإعداد
            </Button>
            <Button
              size="lg"
              onClick={() => {
                if (step < 3) {
                  setStep((step + 1) as 1 | 2 | 3);
                  return;
                }
                // Persist VAT registration choice before finishing.
                void fetch(`${import.meta.env.BASE_URL}api/vat/registration`, {
                  method: "PATCH",
                  credentials: "include",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    status: vatRegStatus,
                    vatNumber:
                      vatRegStatus === "not_registered"
                        ? null
                        : vatNumber || null,
                  }),
                }).finally(() => setLocation("/"));
              }}
              className="h-12 bg-neutral-900 px-6 font-bold text-white shadow-lg shadow-neutral-900/20 hover:bg-neutral-800"
              data-testid="button-next"
            >
              {step === 1
                ? "التالي: الفروع والمستودعات"
                : step === 2
                  ? "التالي: مراجعة وإطلاق"
                  : "ابدأ الاستخدام"}
              <ArrowLeft className="me-2 size-4" />
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
