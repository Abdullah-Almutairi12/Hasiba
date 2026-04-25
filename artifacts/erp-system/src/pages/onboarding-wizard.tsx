import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Calculator,
  Building2,
  Sparkles,
  ShoppingCart,
  Package,
  FileText,
  Users,
  ChartBar,
  ChevronLeft,
  ChevronRight,
  Check,
  Wand2,
  Store,
  Briefcase,
  Coffee,
  Shirt,
  Wrench,
  Palette,
} from "lucide-react";

const STEPS = [
  { key: "business", title: "نوع نشاطك", description: "اختر القطاع المناسب لمنشأتك" },
  { key: "size", title: "حجم المنشأة", description: "حتى نختار لك الباقة المثلى" },
  { key: "modules", title: "الوحدات الأساسية", description: "فعّل ما يناسب احتياجاتك" },
  { key: "company", title: "بيانات الشركة", description: "معلومات أولية لتفعيل الفوترة" },
  { key: "done", title: "اكتمل الإعداد", description: "جاهز للانطلاق!" },
];

const BUSINESS_TYPES = [
  { key: "retail", icon: Store, name: "تجزئة / بقالة", color: "from-blue-500 to-cyan-500" },
  { key: "fb", icon: Coffee, name: "مطاعم وكافيهات", color: "from-amber-500 to-orange-500" },
  { key: "fashion", icon: Shirt, name: "أزياء ومستلزمات", color: "from-pink-500 to-rose-500" },
  { key: "services", icon: Wrench, name: "خدمات وصيانة", color: "from-purple-500 to-indigo-500" },
  { key: "wholesale", icon: Briefcase, name: "جملة وتوزيع", color: "from-emerald-500 to-teal-500" },
  { key: "creative", icon: Palette, name: "أعمال إبداعية", color: "from-fuchsia-500 to-purple-500" },
];

const SIZES = [
  { key: "solo", title: "أنا فقط", description: "مالك / فريلانسر", users: "1 مستخدم" },
  { key: "small", title: "فريق صغير", description: "2 - 10 موظفين", users: "حتى 10" },
  { key: "medium", title: "فريق متوسط", description: "11 - 50 موظف", users: "حتى 50" },
  { key: "large", title: "منشأة كبيرة", description: "+50 موظف", users: "غير محدود" },
];

const MODULES = [
  { key: "pos", icon: ShoppingCart, name: "نقطة البيع", description: "كاشير وفواتير لحظية", recommended: true },
  { key: "inventory", icon: Package, name: "المخزون", description: "تتبع المنتجات والمستودعات", recommended: true },
  { key: "invoicing", icon: FileText, name: "الفوترة وZATCA", description: "فواتير إلكترونية متوافقة", recommended: true },
  { key: "crm", icon: Users, name: "إدارة العملاء", description: "CRM ومتابعة فرص البيع", recommended: false },
  { key: "accounting", icon: Calculator, name: "المحاسبة", description: "قيود يومية ومراجعة", recommended: true },
  { key: "reports", icon: ChartBar, name: "تقارير AI", description: "رؤى ذكية وتنبؤات", recommended: false },
];

export default function OnboardingWizard() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [businessType, setBusinessType] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [modules, setModules] = useState<Set<string>>(
    new Set(MODULES.filter((m) => m.recommended).map((m) => m.key))
  );
  const [company, setCompany] = useState({ name: "", vat: "", city: "" });

  const toggleModule = (key: string) => {
    setModules((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const canProceed = () => {
    if (step === 0) return !!businessType;
    if (step === 1) return !!size;
    if (step === 2) return modules.size > 0;
    if (step === 3) return company.name.trim().length > 0;
    return true;
  };

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-lg bg-primary text-white">
              <Calculator className="size-5" />
            </div>
            <span className="bg-gradient-to-l from-primary to-cyan-500 bg-clip-text text-2xl font-bold text-transparent">
              حاسبة.AI
            </span>
          </div>
          <Button variant="ghost" onClick={() => setLocation("/")}>
            تخطي للوحة القيادة
          </Button>
        </div>
      </header>

      {/* Progress bar */}
      <div className="mx-auto max-w-4xl px-6 pt-8">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-slate-600">
            الخطوة {step + 1} من {STEPS.length}
          </span>
          <span className="text-slate-500">
            {Math.round(((step + 1) / STEPS.length) * 100)}% مكتمل
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-gradient-to-l from-primary to-cyan-400 transition-all duration-500"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
        <div className="mt-6 flex items-center justify-between">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <div
                className={`grid size-8 place-items-center rounded-full text-xs font-bold transition-colors ${
                  i < step
                    ? "bg-emerald-500 text-white"
                    : i === step
                      ? "bg-primary text-white shadow-lg shadow-primary/30"
                      : "bg-slate-200 text-slate-500"
                }`}
              >
                {i < step ? <Check className="size-4" /> : i + 1}
              </div>
              <span
                className={`hidden text-xs font-medium md:inline ${
                  i === step ? "text-slate-900" : "text-slate-500"
                }`}
              >
                {s.title}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="mx-auto max-w-4xl px-6 py-10">
        <Card className="border-slate-200 shadow-xl">
          <CardContent className="p-8">
            <div className="mb-6 text-center">
              <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                <Wand2 className="size-3" />
                إعداد ذكي
              </div>
              <h2 className="text-3xl font-bold text-slate-900">{STEPS[step].title}</h2>
              <p className="mt-2 text-slate-600">{STEPS[step].description}</p>
            </div>

            {/* Step 0: Business type */}
            {step === 0 && (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {BUSINESS_TYPES.map((b) => {
                  const Icon = b.icon;
                  const selected = businessType === b.key;
                  return (
                    <button
                      key={b.key}
                      onClick={() => setBusinessType(b.key)}
                      className={`group relative overflow-hidden rounded-2xl border-2 p-5 text-right transition-all ${
                        selected
                          ? "border-primary bg-primary/5 shadow-lg shadow-primary/10"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:shadow-md"
                      }`}
                    >
                      {selected && (
                        <div className="absolute left-3 top-3 grid size-6 place-items-center rounded-full bg-primary text-white">
                          <Check className="size-4" />
                        </div>
                      )}
                      <div
                        className={`mb-3 grid size-12 place-items-center rounded-xl bg-gradient-to-br ${b.color} text-white shadow-md`}
                      >
                        <Icon className="size-6" />
                      </div>
                      <p className="font-bold text-slate-900">{b.name}</p>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Step 1: Size */}
            {step === 1 && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {SIZES.map((s) => {
                  const selected = size === s.key;
                  return (
                    <button
                      key={s.key}
                      onClick={() => setSize(s.key)}
                      className={`relative rounded-2xl border-2 p-6 text-right transition-all ${
                        selected
                          ? "border-primary bg-primary/5 shadow-lg shadow-primary/10"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-bold">{s.title}</h3>
                          <p className="mt-1 text-sm text-slate-600">{s.description}</p>
                        </div>
                        <Building2
                          className={`size-8 ${selected ? "text-primary" : "text-slate-300"}`}
                        />
                      </div>
                      <div className="mt-4 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                        {s.users}
                      </div>
                      {selected && (
                        <div className="absolute left-4 top-4 grid size-6 place-items-center rounded-full bg-primary text-white">
                          <Check className="size-4" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Step 2: Modules */}
            {step === 2 && (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {MODULES.map((m) => {
                  const Icon = m.icon;
                  const selected = modules.has(m.key);
                  return (
                    <button
                      key={m.key}
                      onClick={() => toggleModule(m.key)}
                      className={`flex items-center gap-3 rounded-xl border-2 p-4 text-right transition-all ${
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div
                        className={`grid size-11 shrink-0 place-items-center rounded-xl ${
                          selected ? "bg-primary text-white" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        <Icon className="size-5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-bold">{m.name}</p>
                          {m.recommended && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                              موصى به
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-slate-600">{m.description}</p>
                      </div>
                      <div
                        className={`grid size-5 place-items-center rounded-md border-2 ${
                          selected ? "border-primary bg-primary text-white" : "border-slate-300"
                        }`}
                      >
                        {selected && <Check className="size-3" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Step 3: Company info */}
            {step === 3 && (
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    اسم المنشأة *
                  </label>
                  <Input
                    value={company.name}
                    onChange={(e) => setCompany({ ...company, name: e.target.value })}
                    placeholder="مثال: مؤسسة الرياض التجارية"
                    className="h-12"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">
                      الرقم الضريبي (VAT)
                    </label>
                    <Input
                      value={company.vat}
                      onChange={(e) => setCompany({ ...company, vat: e.target.value })}
                      placeholder="3xxxxxxxxx"
                      dir="ltr"
                      className="h-12"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">
                      المدينة
                    </label>
                    <Input
                      value={company.city}
                      onChange={(e) => setCompany({ ...company, city: e.target.value })}
                      placeholder="الرياض"
                      className="h-12"
                    />
                  </div>
                </div>
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <div className="flex gap-3">
                    <Sparkles className="mt-0.5 size-5 shrink-0 text-blue-600" />
                    <div>
                      <p className="text-sm font-bold text-blue-900">جاهز للفوترة الإلكترونية</p>
                      <p className="mt-1 text-xs text-blue-700">
                        سنقوم تلقائياً بربط حسابك مع منصة فاتورة (ZATCA Phase 2) بعد إكمال الإعداد.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Done */}
            {step === 4 && (
              <div className="py-8 text-center">
                <div className="mx-auto mb-6 grid size-24 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 text-white shadow-2xl shadow-emerald-500/30">
                  <Check className="size-12" />
                </div>
                <h3 className="text-2xl font-bold text-slate-900">رائع! تم تجهيز حسابك</h3>
                <p className="mx-auto mt-3 max-w-md text-slate-600">
                  قمنا بتفعيل {modules.size} وحدات أساسية، إنشاء أول فرع، وربطك بـ ZATCA. أنت
                  الآن جاهز لاستقبال أول عملية بيع.
                </p>
                <div className="mx-auto mt-6 grid max-w-sm grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                    <p className="text-2xl font-bold text-primary">{modules.size}</p>
                    <p className="text-xs text-slate-600">وحدة مفعلة</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                    <p className="text-2xl font-bold text-emerald-600">1</p>
                    <p className="text-xs text-slate-600">فرع جاهز</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
                    <p className="text-2xl font-bold text-amber-600">∞</p>
                    <p className="text-xs text-slate-600">إمكانيات</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          <Button
            variant="outline"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            <ChevronRight className="ms-2 size-4" />
            السابق
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              disabled={!canProceed()}
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              className="bg-gradient-to-l from-primary to-cyan-500 hover:from-blue-600 hover:to-cyan-600"
            >
              التالي
              <ChevronLeft className="me-2 size-4" />
            </Button>
          ) : (
            <Button
              onClick={() => setLocation("/")}
              className="bg-gradient-to-l from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
            >
              <Sparkles className="ms-2 size-4" />
              ابدأ استخدام النظام
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
