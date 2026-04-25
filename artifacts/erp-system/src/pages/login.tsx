import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Calculator,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Sparkles,
  ShieldCheck,
  ArrowLeft,
  Fingerprint,
} from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setSubmitting(true);
    setTimeout(() => {
      setLocation("/");
    }, 600);
  };

  return (
    <div
      dir="rtl"
      className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30 font-sans text-neutral-900"
    >
      {/* Top bar */}
      <header className="border-b border-neutral-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <button
            onClick={() => setLocation("/")}
            className="flex items-center gap-3"
          >
            <div className="grid size-10 place-items-center rounded-xl bg-[#2563EB] text-white shadow-lg shadow-blue-500/30">
              <Calculator className="size-5" />
            </div>
            <div className="text-right leading-tight">
              <span className="block text-lg font-extrabold tracking-tight">
                حاسبة<span className="text-[#2563EB]">.</span>
              </span>
              <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                ERP &amp; Accounting Suite
              </span>
            </div>
          </button>

          <div className="flex items-center gap-4 text-sm">
            <span className="hidden text-neutral-500 md:inline">
              لا تملك حساباً؟
            </span>
            <Button
              variant="outline"
              size="sm"
              className="font-bold"
              onClick={() => setLocation("/signup")}
              data-testid="button-signup"
            >
              إنشاء حساب جديد
            </Button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto grid max-w-6xl items-stretch gap-6 px-6 py-12 lg:grid-cols-[5fr_7fr]">
        {/* Brand panel (right side in RTL) */}
        <aside className="order-2 hidden overflow-hidden rounded-3xl bg-gradient-to-br from-[#1D4ED8] via-[#2563EB] to-indigo-700 p-8 text-white shadow-2xl shadow-blue-900/20 lg:order-1 lg:block">
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold backdrop-blur">
            <Sparkles className="size-3" />
            AI-POWERED ERP
          </div>
          <h2 className="text-3xl font-extrabold leading-tight">
            مرحباً بعودتك إلى لوحة التحكم
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-blue-100">
            تابع مبيعاتك، فواتيرك، ومخزونك مع تحليلات الذكاء الاصطناعي ووضع
            الامتثال ZATCA في الوقت الفعلي.
          </p>

          <div className="mt-8 space-y-3">
            {[
              {
                icon: Sparkles,
                title: "تنبيهات ذكية",
                sub: "الذكاء الاصطناعي يكتشف الأنماط الشاذة لحظياً",
              },
              {
                icon: ShieldCheck,
                title: "أمان على مستوى البنوك",
                sub: "تشفير TLS 1.3 ومصادقة ثنائية اختيارية",
              },
              {
                icon: Fingerprint,
                title: "متوافق مع NCA + ZATCA",
                sub: "فوترة إلكترونية معتمدة من الهيئة",
              },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.title}
                  className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/10 p-3 backdrop-blur-sm"
                >
                  <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/20">
                    <Icon className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-bold">{f.title}</p>
                    <p className="mt-0.5 text-[11px] text-blue-100">{f.sub}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-8 grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-black/20 p-4 text-center backdrop-blur-sm">
            <div>
              <p className="text-2xl font-extrabold">99.9%</p>
              <p className="mt-1 text-[10px] text-blue-100">جاهزية</p>
            </div>
            <div className="border-x border-white/10">
              <p className="text-2xl font-extrabold">14h</p>
              <p className="mt-1 text-[10px] text-blue-100">توفير أسبوعي</p>
            </div>
            <div>
              <p className="text-2xl font-extrabold">+2.4K</p>
              <p className="mt-1 text-[10px] text-blue-100">منشأة</p>
            </div>
          </div>
        </aside>

        {/* Login form */}
        <div className="order-1 lg:order-2">
          <div className="rounded-3xl border border-white/60 bg-white/90 p-8 shadow-xl shadow-blue-900/5 backdrop-blur md:p-10">
            <div className="mb-8 text-right">
              <h1 className="text-3xl font-extrabold text-neutral-900">
                تسجيل الدخول إلى حاسبة<span className="text-[#2563EB]">.</span>
              </h1>
              <p className="mt-2 text-sm text-neutral-500">
                ادخل بريدك الإلكتروني وكلمة المرور للوصول إلى لوحة التحكم.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email */}
              <div>
                <label className="mb-1.5 block text-xs font-bold text-neutral-700">
                  البريد الإلكتروني
                </label>
                <div className="relative">
                  <Mail className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.sa"
                    className="h-12 pe-10 text-sm"
                    dir="ltr"
                    required
                    data-testid="input-email"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-bold text-neutral-700">
                    كلمة المرور
                  </label>
                  <button
                    type="button"
                    className="text-[11px] font-bold text-[#2563EB] hover:underline"
                    onClick={() =>
                      alert("سيتم إرسال رابط الاستعادة إلى بريدك الإلكتروني.")
                    }
                  >
                    نسيت كلمة المرور؟
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-neutral-400" />
                  <Input
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="h-12 px-10 text-sm"
                    dir="ltr"
                    required
                    data-testid="input-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                  >
                    {showPwd ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Remember + 2FA hint */}
              <div className="flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="size-4 rounded border-neutral-300 text-[#2563EB] focus:ring-[#2563EB]"
                  />
                  <span className="text-xs font-medium text-neutral-700">
                    تذكرني على هذا الجهاز
                  </span>
                </label>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
                  <ShieldCheck className="size-3" />
                  محمي بـ 2FA
                </span>
              </div>

              {/* Submit */}
              <Button
                type="submit"
                disabled={submitting || !email || !password}
                className="h-12 w-full gap-2 rounded-xl bg-[#2563EB] text-base font-bold text-white shadow-lg shadow-blue-500/30 transition-all active:scale-[0.99] hover:bg-[#1D4ED8] disabled:bg-neutral-300 disabled:shadow-none"
                data-testid="button-login"
              >
                <ArrowLeft className="size-4" />
                {submitting ? "جاري تسجيل الدخول..." : "تسجيل الدخول"}
              </Button>

              {/* Divider */}
              <div className="relative my-2 flex items-center justify-center">
                <div className="absolute inset-x-0 h-px bg-neutral-200" />
                <span className="relative bg-white px-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                  أو ادخل عبر
                </span>
              </div>

              {/* SSO */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white text-xs font-bold text-neutral-700 transition-colors hover:bg-neutral-50"
                  onClick={() => alert("قيد التطوير")}
                >
                  <svg className="size-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Google
                </button>
                <button
                  type="button"
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white text-xs font-bold text-neutral-700 transition-colors hover:bg-neutral-50"
                  onClick={() => alert("قيد التطوير")}
                >
                  <svg
                    className="size-4"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                  </svg>
                  Apple
                </button>
              </div>

              <p className="text-center text-[11px] leading-relaxed text-neutral-500">
                بتسجيل دخولك فإنك توافق على{" "}
                <a className="font-bold text-[#2563EB] hover:underline" href="#">
                  شروط الاستخدام
                </a>{" "}
                و{" "}
                <a className="font-bold text-[#2563EB] hover:underline" href="#">
                  سياسة الخصوصية
                </a>
                .
              </p>
            </form>
          </div>

          {/* Trust footer */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-[11px] text-neutral-500">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3 text-emerald-600" />
              تشفير TLS 1.3
            </span>
            <span>•</span>
            <span>متوافق NCA ECC</span>
            <span>•</span>
            <span>ZATCA Phase 2</span>
          </div>
        </div>
      </main>
    </div>
  );
}
