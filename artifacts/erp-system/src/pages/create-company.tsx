import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Calculator,
  Building2,
  Mail,
  User,
  Lock,
  Shield,
  Sparkles,
  Check,
  ChevronLeft,
  Briefcase,
  UserCog,
  ShieldCheck,
  Cloud,
  KeyRound,
  Globe2,
  Eye,
  EyeOff,
  Wand2,
} from "lucide-react";

const COUNTRIES = [
  { code: "SA", name: "المملكة العربية السعودية" },
  { code: "AE", name: "الإمارات العربية المتحدة" },
  { code: "KW", name: "الكويت" },
  { code: "QA", name: "قطر" },
  { code: "BH", name: "البحرين" },
  { code: "OM", name: "عُمان" },
];

const TIMEZONES = [
  { value: "Asia/Riyadh", label: "(GMT+3) الرياض - مكة" },
  { value: "Asia/Dubai", label: "(GMT+4) دبي - أبوظبي" },
  { value: "Asia/Kuwait", label: "(GMT+3) الكويت" },
];

function strengthInfo(pw: string) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length >= 12) score++;
  const labels = ["ضعيفة", "ضعيفة", "متوسطة", "جيدة", "قوية", "قوية جداً"];
  const colors = [
    "bg-red-400",
    "bg-red-400",
    "bg-amber-400",
    "bg-amber-500",
    "bg-emerald-500",
    "bg-emerald-600",
  ];
  return { score, label: labels[score], color: colors[score] };
}

export default function CreateCompany() {
  const [, setLocation] = useLocation();
  const [role, setRole] = useState<"owner" | "admin">("owner");
  const [form, setForm] = useState({
    companyName: "",
    crNumber: "",
    vatNumber: "",
    country: "SA",
    timezone: "Asia/Riyadh",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showPwd, setShowPwd] = useState(false);
  const [twoFA, setTwoFA] = useState(true);
  const [agreed, setAgreed] = useState(false);

  const pwInfo = strengthInfo(form.password);
  const passwordsMatch =
    form.password.length > 0 && form.password === form.confirmPassword;

  const isValid =
    form.companyName.trim() &&
    form.email.includes("@") &&
    form.password.length >= 8 &&
    passwordsMatch &&
    agreed;

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-[#F9FAFB] font-sans text-neutral-900"
    >
      {/* Top utility bar */}
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <button
            className="flex items-center gap-3"
            onClick={() => setLocation("/")}
            type="button"
          >
            <div className="grid size-9 place-items-center rounded-lg bg-[#2563EB] text-white shadow">
              <Calculator className="size-4" />
            </div>
            <div className="text-right leading-tight">
              <span className="block text-lg font-bold tracking-tight">
                حاسبة<span className="text-[#2563EB]">.</span>
              </span>
              <span className="text-[9px] font-medium uppercase tracking-wider text-neutral-500">
                ERP &amp; Accounting Suite
              </span>
            </div>
          </button>

          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-neutral-500 md:inline">
              لديك حساب بالفعل؟
            </span>
            <Button
              variant="outline"
              size="sm"
              className="font-bold"
              onClick={() => setLocation("/login")}
              data-testid="link-login"
            >
              تسجيل الدخول
            </Button>
          </div>
        </div>
      </header>

      {/* Step indicator (3 circles) */}
      <div className="mx-auto max-w-7xl px-6 pt-8">
        <div className="mx-auto flex max-w-md items-center justify-between">
          {[
            { n: 1, label: "إنشاء الحساب" },
            { n: 2, label: "إعداد الشركة" },
            { n: 3, label: "ابدأ الاستخدام" },
          ].map((s, i, arr) => (
            <div key={s.n} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`grid size-9 place-items-center rounded-full text-sm font-bold transition-all ${
                    s.n === 1
                      ? "bg-[#2563EB] text-white shadow-lg shadow-blue-500/30 ring-4 ring-blue-100"
                      : "bg-white text-neutral-400 ring-1 ring-neutral-200"
                  }`}
                >
                  {s.n}
                </div>
                <span
                  className={`mt-2 text-[11px] font-bold whitespace-nowrap ${
                    s.n === 1 ? "text-neutral-900" : "text-neutral-400"
                  }`}
                >
                  {s.label}
                </span>
              </div>
              {i < arr.length - 1 && (
                <div className="mx-2 mt-[-20px] h-0.5 flex-1 bg-neutral-200" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main grid */}
      <main className="mx-auto grid max-w-7xl grid-cols-12 gap-8 px-6 py-10">
        {/* LEFT - Form (col-span-7) */}
        <section className="col-span-12 lg:col-span-7">
          <div className="rounded-3xl border border-neutral-200 bg-white p-8 shadow-sm md:p-10">
            <div className="mb-8">
              <h1 className="text-3xl font-extrabold leading-tight text-neutral-900">
                أنشئ حسابك في حاسبة
                <span className="text-[#2563EB]">.</span>
              </h1>
              <p className="mt-2 text-sm text-neutral-500">
                ابدأ تجربتك المجانية لمدة 30 يوماً — بدون بطاقة ائتمان.
              </p>
            </div>

            {/* Role selection */}
            <div className="mb-8">
              <label className="mb-3 block text-xs font-bold uppercase tracking-wider text-neutral-500">
                دورك في المنشأة
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    key: "owner" as const,
                    icon: Briefcase,
                    title: "مالك / مؤسس",
                    sub: "أمتلك المنشأة وأديرها",
                  },
                  {
                    key: "admin" as const,
                    icon: UserCog,
                    title: "مدير حساب",
                    sub: "أدير النظام بتفويض من المالك",
                  },
                ].map((r) => {
                  const Icon = r.icon;
                  const selected = role === r.key;
                  return (
                    <button
                      key={r.key}
                      type="button"
                      onClick={() => setRole(r.key)}
                      className={`relative flex items-start gap-3 rounded-2xl border-2 p-4 text-right transition-all ${
                        selected
                          ? "border-[#2563EB] bg-blue-50/50 shadow-sm"
                          : "border-neutral-200 bg-white hover:border-neutral-300"
                      }`}
                    >
                      <div
                        className={`grid size-10 shrink-0 place-items-center rounded-lg ${
                          selected
                            ? "bg-[#2563EB] text-white"
                            : "bg-neutral-100 text-neutral-500"
                        }`}
                      >
                        <Icon className="size-5" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-bold text-neutral-900">
                          {r.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-neutral-500">
                          {r.sub}
                        </p>
                      </div>
                      <div
                        className={`absolute left-3 top-3 grid size-4 place-items-center rounded-full border-2 ${
                          selected
                            ? "border-[#2563EB] bg-[#2563EB]"
                            : "border-neutral-300 bg-white"
                        }`}
                      >
                        {selected && (
                          <div className="size-1.5 rounded-full bg-white" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Company info section */}
            <div className="mb-8">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-neutral-900">
                <span className="grid size-6 place-items-center rounded-md bg-blue-100 text-[#2563EB]">
                  <Building2 className="size-3.5" />
                </span>
                معلومات المنشأة
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-neutral-700">
                    الاسم التجاري للمنشأة <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={form.companyName}
                    onChange={(e) =>
                      setForm({ ...form, companyName: e.target.value })
                    }
                    placeholder="مؤسسة الرياض للتجارة"
                    className="h-11 border-neutral-200 bg-neutral-50 focus-visible:border-[#2563EB] focus-visible:ring-blue-200"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-neutral-700">
                      رقم السجل التجاري
                    </label>
                    <Input
                      value={form.crNumber}
                      onChange={(e) =>
                        setForm({ ...form, crNumber: e.target.value })
                      }
                      placeholder="1010xxxxxx"
                      dir="ltr"
                      className="h-11 border-neutral-200 bg-neutral-50 font-mono focus-visible:border-[#2563EB] focus-visible:ring-blue-200"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-neutral-700">
                      الرقم الضريبي (VAT)
                    </label>
                    <Input
                      value={form.vatNumber}
                      onChange={(e) =>
                        setForm({ ...form, vatNumber: e.target.value })
                      }
                      placeholder="3xxxxxxxxx00003"
                      dir="ltr"
                      className="h-11 border-neutral-200 bg-neutral-50 font-mono focus-visible:border-[#2563EB] focus-visible:ring-blue-200"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-neutral-700">
                      الدولة
                    </label>
                    <div className="relative">
                      <Globe2 className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                      <select
                        value={form.country}
                        onChange={(e) =>
                          setForm({ ...form, country: e.target.value })
                        }
                        className="h-11 w-full appearance-none rounded-md border border-neutral-200 bg-neutral-50 ps-9 pe-3 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-blue-200"
                      >
                        {COUNTRIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-neutral-700">
                      المنطقة الزمنية
                    </label>
                    <select
                      value={form.timezone}
                      onChange={(e) =>
                        setForm({ ...form, timezone: e.target.value })
                      }
                      className="h-11 w-full appearance-none rounded-md border border-neutral-200 bg-neutral-50 px-3 text-sm focus:border-[#2563EB] focus:outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      {TIMEZONES.map((tz) => (
                        <option key={tz.value} value={tz.value}>
                          {tz.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* Security section */}
            <div className="mb-6 border-t border-dashed border-neutral-200 pt-6">
              <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-neutral-900">
                <span className="grid size-6 place-items-center rounded-md bg-blue-100 text-[#2563EB]">
                  <KeyRound className="size-3.5" />
                </span>
                الحساب والأمان
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-neutral-700">
                    البريد الإلكتروني للمدير <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <Mail className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                    <Input
                      type="email"
                      dir="ltr"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      placeholder="ahmad@company.sa"
                      className="h-11 border-neutral-200 bg-neutral-50 ps-10 focus-visible:border-[#2563EB] focus-visible:ring-blue-200"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-neutral-700">
                      كلمة المرور <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Lock className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                      <Input
                        type={showPwd ? "text" : "password"}
                        value={form.password}
                        onChange={(e) =>
                          setForm({ ...form, password: e.target.value })
                        }
                        placeholder="8 أحرف على الأقل"
                        className="h-11 border-neutral-200 bg-neutral-50 ps-10 pe-9 focus-visible:border-[#2563EB] focus-visible:ring-blue-200"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPwd((v) => !v)}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
                      >
                        {showPwd ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                    {form.password && (
                      <div className="mt-2">
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <div
                              key={i}
                              className={`h-1 flex-1 rounded-full transition-colors ${
                                pwInfo.score >= i ? pwInfo.color : "bg-neutral-200"
                              }`}
                            />
                          ))}
                        </div>
                        <p className="mt-1 text-[10px] font-medium text-neutral-500">
                          قوة كلمة المرور: {pwInfo.label}
                        </p>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-neutral-700">
                      تأكيد كلمة المرور <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Lock className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                      <Input
                        type={showPwd ? "text" : "password"}
                        value={form.confirmPassword}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            confirmPassword: e.target.value,
                          })
                        }
                        placeholder="أعد إدخال كلمة المرور"
                        className={`h-11 border-neutral-200 bg-neutral-50 ps-10 focus-visible:border-[#2563EB] focus-visible:ring-blue-200 ${
                          form.confirmPassword && !passwordsMatch
                            ? "border-red-300 focus-visible:ring-red-200"
                            : ""
                        }`}
                      />
                    </div>
                    {form.confirmPassword && !passwordsMatch && (
                      <p className="mt-1 text-[10px] font-medium text-red-500">
                        كلمتا المرور غير متطابقتين
                      </p>
                    )}
                  </div>
                </div>

                {/* 2FA toggle */}
                <div className="flex items-center justify-between rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                  <div className="flex items-center gap-3">
                    <div className="grid size-9 place-items-center rounded-lg bg-emerald-100 text-emerald-600">
                      <ShieldCheck className="size-4" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-neutral-900">
                        التحقق بخطوتين (2FA)
                      </p>
                      <p className="text-[11px] text-neutral-500">
                        موصى به — يحمي حسابك بطبقة أمان إضافية
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTwoFA((v) => !v)}
                    className={`relative h-6 w-11 rounded-full transition-colors ${
                      twoFA ? "bg-[#2563EB]" : "bg-neutral-300"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                        twoFA ? "right-0.5 translate-x-0" : "right-5 translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Terms */}
            <label className="mb-6 flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 size-4 rounded border-neutral-300 text-[#2563EB] focus:ring-[#2563EB]"
              />
              <span className="text-xs leading-relaxed text-neutral-600">
                أوافق على{" "}
                <a className="font-bold text-[#2563EB] hover:underline">
                  شروط الاستخدام
                </a>{" "}
                و{" "}
                <a className="font-bold text-[#2563EB] hover:underline">
                  سياسة الخصوصية
                </a>
                ، وأقر بأن جميع البيانات التي أُدخلها تخص منشأتي.
              </span>
            </label>

            {/* CTAs */}
            <div className="flex flex-col gap-3 sm:flex-row-reverse">
              <Button
                disabled={!isValid}
                onClick={() => setLocation("/onboarding")}
                className="h-12 flex-1 bg-neutral-900 text-base font-bold text-white shadow-lg shadow-neutral-900/20 hover:bg-neutral-800 disabled:bg-neutral-300 disabled:shadow-none"
              >
                إنشاء الحساب
                <ChevronLeft className="me-1 size-4" />
              </Button>
              <Button
                variant="outline"
                onClick={() => setLocation("/onboarding")}
                className="h-12 border-neutral-200 bg-white font-bold text-neutral-700 hover:bg-neutral-50"
              >
                <Wand2 className="ms-2 size-4 text-[#2563EB]" />
                المعالج التلقائي
              </Button>
            </div>
          </div>

          {/* Trust footer */}
          <div className="mt-6 grid grid-cols-3 gap-3">
            {[
              { icon: ShieldCheck, label: "معتمد ZATCA", color: "text-emerald-600" },
              { icon: Lock, label: "تشفير SSL/TLS", color: "text-blue-600" },
              { icon: Cloud, label: "استضافة سحابية", color: "text-purple-600" },
            ].map((t, i) => {
              const Icon = t.icon;
              return (
                <div
                  key={i}
                  className="flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white p-3 text-xs"
                >
                  <Icon className={`size-4 ${t.color}`} />
                  <span className="font-bold text-neutral-700">{t.label}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* RIGHT - Brand gradient panel (col-span-5) */}
        <aside className="col-span-12 lg:col-span-5">
          <div className="sticky top-32 overflow-hidden rounded-3xl bg-gradient-to-br from-[#1E3A8A] via-[#1E40AF] to-[#2563EB] p-8 text-white shadow-2xl shadow-blue-900/30">
            <div className="absolute -right-16 -top-16 size-48 rounded-full bg-blue-400/30 blur-3xl" />
            <div className="absolute -bottom-20 -left-10 size-56 rounded-full bg-cyan-400/20 blur-3xl" />

            <div className="relative">
              <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur">
                <Sparkles className="size-3" />
                AI-Powered ERP
              </div>

              <h2 className="text-3xl font-extrabold leading-tight">
                نظام محاسبي متكامل مصمم خصيصاً للسوق السعودي
              </h2>

              <p className="mt-4 text-sm leading-relaxed text-blue-100/90">
                إدارة شاملة لمنشأتك من نقطة بيع، فواتير، مخزون، ومحاسبة — كل ذلك في
                لوحة واحدة مدعومة بالذكاء الاصطناعي.
              </p>

              <div className="mt-8 space-y-4">
                {[
                  {
                    icon: Sparkles,
                    title: "تقارير AI تنبؤية",
                    desc: "توقع المبيعات وكشف الاحتيال تلقائياً",
                  },
                  {
                    icon: ShieldCheck,
                    title: "متوافق مع NCA + ZATCA",
                    desc: "فوترة إلكترونية معتمدة من الهيئة",
                  },
                  {
                    icon: Building2,
                    title: "إدارة فروع متعددة",
                    desc: "مزامنة فورية بين كل الفروع والكاشيرات",
                  },
                ].map((b, i) => {
                  const Icon = b.icon;
                  return (
                    <div key={i} className="flex items-start gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-white/20 bg-white/10 backdrop-blur">
                        <Icon className="size-5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold">{b.title}</p>
                        <p className="mt-0.5 text-xs text-blue-100/80">{b.desc}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Stats card */}
              <div className="mt-8 grid grid-cols-3 gap-3 rounded-2xl border border-white/10 bg-black/20 p-4 backdrop-blur">
                <div className="text-center">
                  <p className="text-2xl font-extrabold">2.4K+</p>
                  <p className="mt-1 text-[10px] text-blue-200">منشأة</p>
                </div>
                <div className="border-x border-white/10 text-center">
                  <p className="text-2xl font-extrabold">14h</p>
                  <p className="mt-1 text-[10px] text-blue-200">توفير أسبوعي</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-extrabold">99.9%</p>
                  <p className="mt-1 text-[10px] text-blue-200">جاهزية</p>
                </div>
              </div>

              {/* Quote */}
              <Card className="mt-6 border-white/10 bg-white/10 backdrop-blur">
                <CardContent className="p-4">
                  <p className="text-xs leading-relaxed italic text-blue-50">
                    "حاسبة.AI غيّرت طريقة إدارتي للمنشأة كلياً. التقارير تكشف لي أمور
                    لم أكن لأنتبه لها."
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-orange-500 text-[10px] font-bold text-white">
                      س.ق
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold">سارة القحطاني</p>
                      <p className="text-[10px] text-blue-200">
                        المديرة المالية - مجموعة الخليج
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="mt-6 flex items-center gap-2 text-[10px] text-blue-200">
                <Check className="size-3.5 text-emerald-300" />
                <span>30 يوم مجاناً • بدون بطاقة ائتمان • إلغاء في أي وقت</span>
              </div>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
