import { useLocation } from "wouter";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import {
  Calculator,
  ArrowLeft,
  User as UserIcon,
  QrCode,
  Percent,
  Wifi,
  ShieldCheck,
  ArrowUp,
  Bot,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Brain,
  Tag,
  Store,
  Wand2,
  CircleCheck,
  PlayCircle,
  Twitter,
  Linkedin,
  Instagram,
  Sparkles,
} from "lucide-react";

export default function Welcome() {
  const [, setLocation] = useLocation();
  const { isAuthenticated } = useAuth();

  // If already logged in, send to dashboard
  useEffect(() => {
    if (isAuthenticated) setLocation("/");
  }, [isAuthenticated, setLocation]);

  return (
    <div
      dir="rtl"
      className="min-h-screen overflow-x-hidden bg-neutral-50 text-neutral-900 selection:bg-blue-100 selection:text-blue-900"
      data-testid="welcome-page"
    >
      {/* Background blur orbs */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute right-0 top-0 h-[600px] w-[600px] rounded-full bg-blue-50/60 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-[500px] w-[500px] rounded-full bg-blue-100/40 blur-3xl" />
      </div>

      {/* Top Nav */}
      <nav className="relative z-40 mx-auto flex w-full max-w-[1440px] items-center justify-between border-b border-neutral-100 bg-white/80 px-6 py-5 backdrop-blur-sm md:px-12">
        <button
          onClick={() => setLocation("/welcome")}
          className="flex items-center gap-3"
        >
          <div className="grid size-10 place-items-center rounded-lg bg-[#2563EB] text-white shadow">
            <Calculator className="size-5" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-neutral-900">
            حاسبة<span className="text-[#2563EB]">.</span>
          </span>
        </button>

        <div className="hidden items-center gap-8 text-sm font-semibold text-neutral-600 md:flex">
          <a href="#features" className="transition-colors hover:text-[#2563EB]">
            المميزات
          </a>
          <a href="#how-it-works" className="transition-colors hover:text-[#2563EB]">
            كيف يعمل
          </a>
          <a href="#faq" className="transition-colors hover:text-[#2563EB]">
            الأسئلة الشائعة
          </a>
          <a href="#cta" className="transition-colors hover:text-[#2563EB]">
            ابدأ
          </a>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/login")}
            className="hidden font-bold text-neutral-700 sm:inline-flex"
            data-testid="welcome-login"
          >
            <UserIcon className="ms-1 size-4" />
            تسجيل دخول
          </Button>
          <Button
            size="sm"
            onClick={() => setLocation("/signup")}
            className="bg-[#2563EB] font-bold text-white shadow-lg shadow-blue-500/30 hover:bg-[#1D4ED8]"
            data-testid="welcome-signup"
          >
            ابدأ مجاناً
          </Button>
        </div>
      </nav>

      {/* Hero */}
      <main className="relative z-10 mx-auto w-full max-w-[1440px] px-6 pb-20 pt-12 md:px-12">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-12 lg:gap-16">
          {/* Hero text */}
          <div className="order-2 flex flex-col gap-6 text-right lg:order-1 lg:col-span-6 lg:gap-8">
            <div className="inline-flex items-center gap-2 self-start rounded-lg border border-blue-100 bg-white px-3 py-2 shadow-sm sm:px-4">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-[11px] font-semibold text-neutral-700 sm:text-xs">
                نظام محاسبي ذكي معتمد من هيئة الزكاة
              </span>
            </div>

            <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-neutral-900 sm:text-5xl md:text-6xl lg:text-7xl">
              حول أعمالك
              <br />
              إلى{" "}
              <span className="bg-gradient-to-br from-[#3B82F6] to-[#2563EB] bg-clip-text text-transparent">
                ذكاء مالي
              </span>
              <br />
              مستقل.
            </h1>

            <p className="max-w-2xl text-base font-normal leading-relaxed text-neutral-600 md:text-xl">
              حاسبة ليس مجرد كاشير. هو نظام ذكاء اصطناعي يقرأ الفواتير، يحلل
              المبيعات، ويكتشف الأخطاء المحاسبية قبل حدوثها. إدارة كاملة لفروعك
              بلا جهد.
            </p>

            {/* CTAs */}
            <div className="mt-2 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:gap-4">
              <Button
                size="lg"
                onClick={() => setLocation("/signup")}
                className="group h-14 gap-3 rounded-xl bg-[#2563EB] px-8 text-base font-bold text-white shadow-xl shadow-blue-500/30 transition-all hover:-translate-y-0.5 hover:bg-[#1D4ED8] hover:shadow-2xl"
                data-testid="hero-signup"
              >
                ابدأ تجربتك المجانية
                <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-1" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setLocation("/login")}
                className="h-14 gap-3 rounded-xl border-neutral-200 bg-white px-8 text-base font-semibold text-neutral-700 shadow-sm hover:border-neutral-300 hover:bg-neutral-50"
                data-testid="hero-login"
              >
                <UserIcon className="size-4" />
                تسجيل الدخول
              </Button>
            </div>

            {/* Trust indicators */}
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-neutral-200 pt-6 text-neutral-500 sm:gap-x-8">
              {[
                { icon: QrCode, label: "فاتورة إلكترونية" },
                { icon: Percent, label: "ضريبة 15%" },
                { icon: Wifi, label: "يعمل بدون إنترنت" },
                { icon: ShieldCheck, label: "سجل تدقيق آمن" },
              ].map((t) => (
                <div key={t.label} className="flex items-center gap-2">
                  <t.icon className="size-4 sm:size-5" />
                  <span className="text-xs font-medium sm:text-sm">{t.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Hero visual mockup */}
          <div className="relative order-1 lg:order-2 lg:col-span-6">
            <div className="relative z-20 rounded-2xl border border-neutral-100 bg-white p-2 shadow-2xl shadow-blue-900/10 transition-all duration-500 hover:shadow-blue-900/20">
              {/* Mockup chrome */}
              <div className="flex items-center justify-between rounded-t-xl border-b border-neutral-100 bg-neutral-50 p-3 sm:p-4">
                <div className="flex items-center gap-1.5">
                  <div className="size-3 rounded-full bg-rose-400" />
                  <div className="size-3 rounded-full bg-amber-400" />
                  <div className="size-3 rounded-full bg-emerald-400" />
                </div>
                <div className="hidden h-6 w-64 items-center rounded-md border border-neutral-200 bg-white px-3 sm:flex">
                  <span className="text-[10px] font-medium text-neutral-400">
                    hasba.app/dashboard
                  </span>
                </div>
                <div className="size-7 rounded-full bg-neutral-200 sm:size-8" />
              </div>

              {/* Mockup body */}
              <div className="rounded-b-xl bg-white p-4 sm:p-6">
                {/* Stats row */}
                <div className="mb-6 grid grid-cols-3 gap-2 sm:gap-4">
                  <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 sm:p-4">
                    <div className="mb-1 text-[10px] font-semibold text-blue-700 sm:text-xs">
                      إجمالي المبيعات
                    </div>
                    <div className="text-base font-extrabold text-neutral-900 sm:text-2xl">
                      24,500 ر.س
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-[10px] font-medium text-emerald-600 sm:text-xs">
                      <ArrowUp className="size-3" /> 12% نمو
                    </div>
                  </div>
                  <div className="rounded-lg border border-neutral-100 bg-white p-3 shadow-sm sm:p-4">
                    <div className="mb-1 text-[10px] font-semibold text-neutral-600 sm:text-xs">
                      صافي الربح
                    </div>
                    <div className="text-base font-extrabold text-neutral-900 sm:text-2xl">
                      8,240 ر.س
                    </div>
                    <div className="mt-2 flex items-center gap-1 text-[10px] font-medium text-emerald-600 sm:text-xs">
                      <ArrowUp className="size-3" /> 5% نمو
                    </div>
                  </div>
                  <div className="rounded-lg border border-neutral-100 bg-white p-3 shadow-sm sm:p-4">
                    <div className="mb-1 text-[10px] font-semibold text-neutral-600 sm:text-xs">
                      عدد الفواتير
                    </div>
                    <div className="text-base font-extrabold text-neutral-900 sm:text-2xl">
                      142
                    </div>
                    <div className="mt-2 text-[10px] font-medium text-neutral-400 sm:text-xs">
                      اليوم
                    </div>
                  </div>
                </div>

                {/* Mini chart */}
                <div className="mb-4 rounded-lg border border-neutral-100 bg-white p-3 shadow-sm sm:mb-6 sm:p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-neutral-800 sm:text-sm">
                      تحليل الأداء الأسبوعي
                    </h3>
                    <button className="rounded-md bg-blue-50 px-2 py-1 text-[10px] font-semibold text-[#2563EB] hover:bg-blue-100 sm:px-3 sm:py-1.5 sm:text-xs">
                      تصدير
                    </button>
                  </div>
                  <MiniChart />
                </div>

                {/* List items */}
                <div className="space-y-2 sm:space-y-3">
                  <div className="flex items-center justify-between rounded-lg border border-neutral-100 bg-neutral-50 p-2.5 sm:p-3">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="grid size-8 place-items-center rounded-lg bg-emerald-100 text-emerald-600">
                        <CheckCircle2 className="size-4" />
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-neutral-800 sm:text-xs">
                          تمت مطابقة الفاتورة #9281
                        </div>
                        <div className="text-[9px] text-neutral-500 sm:text-[10px]">
                          تم التأكد من المخزون والضريبة
                        </div>
                      </div>
                    </div>
                    <span className="font-mono text-[10px] text-neutral-600 sm:text-xs">
                      10:42
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-rose-100 bg-rose-50 p-2.5 sm:p-3">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="grid size-8 place-items-center rounded-lg bg-rose-100 text-rose-600">
                        <AlertTriangle className="size-4" />
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-neutral-800 sm:text-xs">
                          تنبيه: اختلاف في الجرد
                        </div>
                        <div className="text-[9px] text-neutral-500 sm:text-[10px]">
                          فرع الرياض - المستودع الرئيسي
                        </div>
                      </div>
                    </div>
                    <button className="rounded border border-rose-200 bg-white px-2 py-1 text-[10px] text-rose-600 shadow-sm sm:text-xs">
                      مراجعة
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Floating AI badge */}
            <div className="absolute -right-3 top-1/4 z-30 hidden animate-bounce rounded-2xl border border-neutral-100 bg-white p-3 shadow-xl sm:block sm:-right-12 sm:p-4" style={{ animationDuration: "3s" }}>
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-full bg-blue-100 text-[#2563EB]">
                  <Bot className="size-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-neutral-800">
                    المساعد الذكي
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    تم اكتشاف فرصة لزيادة الربح 5%
                  </div>
                </div>
              </div>
            </div>

            {/* Floating ZATCA badge */}
            <div className="absolute -left-3 bottom-1/4 z-30 hidden rounded-2xl border border-neutral-100 bg-white p-3 shadow-xl sm:block sm:-left-8">
              <div className="flex items-center gap-2">
                <div className="size-2 animate-pulse rounded-full bg-emerald-500" />
                <span className="text-xs font-bold text-neutral-700">
                  متصل بالهيئة (ZATCA)
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Features */}
      <section
        id="features"
        className="relative overflow-hidden bg-white py-16 sm:py-24"
      >
        <div className="mx-auto max-w-[1440px] px-6 md:px-12">
          <div className="mx-auto mb-12 max-w-3xl text-center sm:mb-20">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[#2563EB] sm:text-sm">
              لماذا حاسبة؟
            </span>
            <h2 className="mb-4 text-2xl font-bold text-neutral-900 sm:mb-6 sm:text-3xl md:text-5xl">
              نظام واحد يغنيك عن
              <br />
              <span className="text-slate-400 underline decoration-[#3B82F6] decoration-4 underline-offset-4">
                جيش من المحاسبين
              </span>
            </h2>
            <p className="text-base text-neutral-500 sm:text-lg">
              صمم خصيصاً للتجار الذين يريدون التركيز على النمو وترك الأرقام
              المعقدة للذكاء الاصطناعي.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:gap-8 md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: FileText,
                color: "text-[#2563EB]",
                border: "hover:border-blue-200",
                title: "قارئ فواتير ذكي",
                desc: "وداعاً للإدخال اليدوي. صور الفاتورة، وسيقوم النظام بقراءة 500 صنف في ثوانٍ وتخزينها بدقة 99%.",
                cta: "جرب الآن",
                ctaColor: "text-[#2563EB]",
              },
              {
                icon: Brain,
                color: "text-violet-600",
                border: "hover:border-violet-200",
                title: "محاسب آلي",
                desc: "يكتشف الأخطاء، يطابق القيود، وينبهك عند وجود تلاعب أو خلل في الحسابات فور حدوثه.",
                cta: "شاهد التفاصيل",
                ctaColor: "text-violet-600",
              },
              {
                icon: Tag,
                color: "text-amber-500",
                border: "hover:border-amber-200",
                title: "تسعير ذكي",
                desc: "لا تخمن الأسعار. النظام يحلل التكلفة والسوق ويقترح السعر الأمثل لزيادة هامش الربح.",
                cta: "اعرف المزيد",
                ctaColor: "text-amber-600",
              },
              {
                icon: Store,
                color: "text-emerald-600",
                border: "hover:border-emerald-200",
                title: "إدارة الفروع",
                desc: "تحكم بجميع فروعك ومستودعاتك من شاشة واحدة. نقل مخزون، مقارنة أداء، وضبط صلاحيات.",
                cta: "ابدأ الإدارة",
                ctaColor: "text-emerald-600",
              },
            ].map((f) => (
              <div
                key={f.title}
                className={`group relative rounded-3xl border border-slate-100 bg-slate-50 p-6 transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl sm:p-8 ${f.border}`}
              >
                <div
                  className={`mb-5 grid size-14 place-items-center rounded-2xl border border-slate-100 bg-white text-2xl shadow-sm transition-transform duration-300 group-hover:scale-110 sm:mb-6 ${f.color}`}
                >
                  <f.icon className="size-6" />
                </div>
                <h3 className="mb-3 text-lg font-bold text-neutral-900 sm:text-xl">
                  {f.title}
                </h3>
                <p className="mb-4 text-sm leading-relaxed text-slate-500">
                  {f.desc}
                </p>
                <div
                  className={`flex items-center gap-2 text-xs font-semibold opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100 ${f.ctaColor}`}
                >
                  <span>{f.cta}</span>
                  <ArrowLeft className="size-3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works (image right, text left in RTL) */}
      <section id="how-it-works" className="relative bg-slate-50 py-16 sm:py-24">
        <div className="mx-auto grid max-w-[1440px] grid-cols-1 items-center gap-10 px-6 md:px-12 lg:grid-cols-2 lg:gap-16">
          {/* Demo card */}
          <div className="relative order-2 lg:order-1">
            <div className="absolute inset-0 scale-90 rounded-full bg-gradient-to-tr from-blue-100 to-transparent opacity-50 blur-3xl" />
            <div className="relative z-10 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 p-5 sm:p-6">
                <h3 className="font-bold text-slate-800">تحليل الفاتورة الذكي</h3>
                <span className="rounded-md bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700">
                  AI Processing
                </span>
              </div>
              <div className="p-5 sm:p-8">
                <div className="flex gap-4 sm:gap-6">
                  <div className="hidden w-1/3 space-y-3 opacity-60 sm:block">
                    <div className="h-32 animate-pulse rounded-lg bg-slate-200" />
                    <div className="h-4 w-3/4 rounded bg-slate-200" />
                    <div className="h-4 w-1/2 rounded bg-slate-200" />
                  </div>
                  <div className="w-full space-y-4 sm:w-2/3">
                    <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                      <div className="grid size-8 place-items-center rounded-full bg-emerald-100 text-emerald-600">
                        <CheckCircle2 className="size-4" />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-bold text-slate-800">
                          تم التعرف على 42 صنف
                        </div>
                        <div className="text-xs text-slate-500">
                          دقة القراءة 99.8%
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {[
                        ["حليب المراعي 2 لتر", "14.50 ر.س"],
                        ["شاي ليبتون 100 كيس", "18.00 ر.س"],
                        ["سكر الأسرة 5 كيلو", "22.95 ر.س"],
                      ].map(([name, price]) => (
                        <div
                          key={name}
                          className="flex justify-between border-b border-slate-100 pb-2 text-sm"
                        >
                          <span className="text-slate-600">{name}</span>
                          <span className="font-bold text-slate-800">{price}</span>
                        </div>
                      ))}
                      <div className="flex justify-between pt-2 text-sm">
                        <span className="font-bold text-slate-800">
                          المجموع (شامل الضريبة)
                        </span>
                        <span className="text-lg font-bold text-[#2563EB]">
                          55.45 ر.س
                        </span>
                      </div>
                    </div>
                    <Button
                      onClick={() => setLocation("/signup")}
                      className="w-full bg-[#2563EB] text-sm font-semibold shadow-lg shadow-blue-500/20 hover:bg-[#1D4ED8]"
                    >
                      اعتماد وإدخال للمخزون
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Floating label */}
            <div className="absolute -left-3 top-12 z-20 hidden items-center gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-lg sm:-left-6 sm:flex">
              <div className="size-2 animate-pulse rounded-full bg-rose-500" />
              <span className="text-sm font-bold text-slate-700">
                توفير 4 ساعات عمل يومياً
              </span>
            </div>
          </div>

          {/* Text */}
          <div className="order-1 lg:order-2">
            <div className="mb-5 grid size-12 place-items-center rounded-2xl bg-blue-100 text-xl text-[#2563EB] sm:mb-6">
              <Wand2 className="size-5" />
            </div>
            <h2 className="mb-5 text-2xl font-bold leading-tight text-neutral-900 sm:mb-6 sm:text-3xl md:text-4xl">
              أدخل فواتير الموردين <br />
              <span className="text-[#2563EB]">بضغطة زر واحدة</span>
            </h2>
            <p className="mb-6 text-base leading-relaxed text-slate-600 sm:mb-8 sm:text-lg">
              عند إدخال فاتورة فيها 500 صنف يدوياً، نسبة الخطأ تصل إلى 10%. مع
              حاسبة، صور الفاتورة فقط. النظام يقرأ الأصناف، يطابقها مع قاعدة
              البيانات، يقترح تعريف الأصناف الجديدة، ويدخلها للمخزون فوراً.
            </p>
            <ul className="mb-6 space-y-3 sm:mb-8 sm:space-y-4">
              {[
                "دعم الفواتير الورقية والإلكترونية (PDF/Image)",
                "كشف التلاعب في الأسعار ومقارنتها بالسابق",
                "تنبيه فوري عند وجود اختلاف في الكميات",
              ].map((line) => (
                <li key={line} className="flex items-start gap-3">
                  <CircleCheck className="mt-1 size-4 shrink-0 text-[#2563EB]" />
                  <span className="text-sm text-slate-700 sm:text-base">{line}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setLocation("/signup")}
              className="flex items-center gap-2 font-bold text-[#2563EB] hover:text-[#1D4ED8] hover:underline hover:decoration-2 hover:underline-offset-4"
            >
              شاهد كيف يعمل
              <PlayCircle className="size-5" />
            </button>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="relative bg-white py-16 sm:py-24">
        <div className="mx-auto max-w-[1200px] px-6 md:px-12">
          <div className="mx-auto mb-10 max-w-3xl text-center sm:mb-14">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wide text-[#2563EB] sm:text-sm">
              قبل ما تبدأ
            </span>
            <h2 className="mb-4 text-2xl font-bold text-neutral-900 sm:mb-5 sm:text-3xl md:text-5xl">
              الأسئلة الشائعة
            </h2>
            <p className="text-base text-neutral-500 sm:text-lg">
              كل ما يسأل عنه العملاء قبل الاشتراك — الامتثال، الأمان، التهيئة، والدعم.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:gap-6 md:grid-cols-2">
            {[
              {
                q: "هل النظام معتمد من هيئة الزكاة والضريبة (ZATCA)؟",
                a: "نعم. نُصدر فواتير ضريبية إلكترونية متوافقة مع المرحلة الثانية، وتتضمن رمز QR وفق المواصفة السعودية، مع تكامل مباشر مع بوّابة فاتورة.",
              },
              {
                q: "كم تستغرق عملية التهيئة الأولى؟",
                a: "معالج تهيئة موجّه من 5 خطوات يكتمل عادة في أقل من 30 دقيقة: بيانات الشركة، الفروع، المخزون، المستخدمون، والربط الضريبي.",
              },
              {
                q: "هل تدعمون الفروع المتعدّدة والشركات المرتبطة؟",
                a: "نعم. عزل كامل لبيانات كل شركة، مع وحدة المعاملات بين الشركات التي تُنشئ القيد المُقابل آلياً في الشركة الأخرى وتربط المستندَين معاً.",
              },
              {
                q: "كيف تعمل ميزة استخراج فواتير الموردين بالذكاء الاصطناعي؟",
                a: "صوّر الفاتورة بالجوال أو ارفعها صورة، فيستخرج النموذج اسم المورّد، البنود، الضريبة والإجمالي خلال ثوانٍ — مع مراجعة المستخدم قبل الترحيل.",
              },
              {
                q: "هل بياناتي محميّة ومن يطّلع عليها؟",
                a: "نظام صلاحيات من 8 أدوار مع 14 حارساً على الخادم، جلسات مشفّرة، حماية CSRF، وسجل تدقيق كامل لكل عملية حسّاسة.",
              },
              {
                q: "هل أستطيع تجربة النظام قبل الاشتراك؟",
                a: "نعم. اشترك مجاناً، أنشئ شركة تجريبيّة، واستعرض كل الوحدات ببيانات وهمية. لا حاجة لبطاقة ائتمان للبدء.",
              },
              {
                q: "هل يعمل النظام بدون إنترنت؟",
                a: "شاشة نقطة البيع تواصل العمل في وضع عدم الاتصال وتزامن العمليات تلقائياً عند عودة الشبكة، حتى لا تتوقّف المبيعات أبداً.",
              },
              {
                q: "هل ينطبق على نشاطي؟ (تجزئة / مطاعم / خدمات / B2B)",
                a: "نعم — حاسبة مصممة كنظام ERP متعدّد القطاعات: نقطة بيع للتجزئة والمطاعم، فواتير وعروض أسعار لـ B2B، مشاريع وفوترة للخدمات.",
              },
              {
                q: "كيف يتم نقل بياناتي من نظامي الحالي؟",
                a: "ندعم استيراد المنتجات والعملاء والموردين عبر Excel/CSV، مع فريق دعم لمساعدتك في تنظيف ومطابقة البيانات قبل الإطلاق.",
              },
              {
                q: "ما هي خيارات الدعم الفني؟",
                a: "دعم باللغة العربية عبر تذاكر داخل النظام، قاعدة معرفة، وفريق فني خلال ساعات العمل السعودية. خطط Enterprise تشمل دعم على مدار الساعة.",
              },
              {
                q: "هل أستطيع الإلغاء في أي وقت؟",
                a: "نعم — لا عقود طويلة الأمد. تستطيع الترقية أو تخفيض الباقة أو الإلغاء من لوحة الإعدادات متى شئت، مع تصدير كامل لبياناتك.",
              },
              {
                q: "هل توجد ضرائب أو رسوم خفية؟",
                a: "لا. الأسعار شفافة وشاملة. تشمل التحديثات، الاستضافة، النسخ الاحتياطي، وامتثال ZATCA دون أي رسوم إضافية.",
              },
            ].map((item, i) => (
              <div
                key={item.q}
                className="group rounded-2xl border border-slate-100 bg-slate-50 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-blue-200 hover:bg-white hover:shadow-xl sm:p-6"
              >
                <div className="mb-3 flex items-start gap-3">
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-sm font-extrabold text-[#2563EB] shadow-sm">
                    {String(i + 1).padStart(2, "0")}
                  </div>
                  <h3 className="pt-1 text-base font-bold leading-snug text-neutral-900 sm:text-lg">
                    {item.q}
                  </h3>
                </div>
                <p className="text-sm leading-relaxed text-slate-600 sm:text-[15px]">
                  {item.a}
                </p>
              </div>
            ))}
          </div>

          <div className="mx-auto mt-12 max-w-2xl rounded-2xl border border-blue-100 bg-blue-50/60 p-6 text-center sm:mt-16">
            <p className="mb-4 text-sm font-semibold text-neutral-700 sm:text-base">
              لم تجد إجابتك؟ فريقنا جاهز للرد خلال ساعة عمل واحدة.
            </p>
            <Button
              onClick={() => setLocation("/signup")}
              className="h-11 bg-[#2563EB] px-6 font-bold text-white shadow-md shadow-blue-500/20 hover:bg-[#1D4ED8]"
            >
              تواصل معنا
            </Button>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section
        id="cta"
        className="relative overflow-hidden bg-slate-900 py-16 text-white sm:py-20"
      >
        <div className="absolute right-0 top-0 size-96 -translate-y-1/2 translate-x-1/2 rounded-full bg-blue-500/20 blur-3xl" />
        <div className="absolute bottom-0 left-0 size-96 -translate-x-1/2 translate-y-1/2 rounded-full bg-violet-500/20 blur-3xl" />

        <div className="relative z-10 mx-auto max-w-4xl px-6 text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-[11px] font-bold backdrop-blur">
            <Sparkles className="size-3" />
            انضم للثورة المالية
          </div>
          <h2 className="mb-5 text-3xl font-extrabold sm:mb-6 sm:text-4xl md:text-5xl">
            جاهز لتحويل أعمالك للمستقبل؟
          </h2>
          <p className="mx-auto mb-8 max-w-2xl text-base text-slate-300 sm:mb-10 sm:text-lg">
            انضم لأكثر من 5,000 تاجر يستخدمون حاسبة لإدارة فروعهم بذكاء. تجربة
            مجانية لمدة 14 يوم، لا تتطلب بطاقة ائتمان.
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row sm:gap-4">
            <Button
              size="lg"
              onClick={() => setLocation("/signup")}
              className="h-14 rounded-2xl bg-[#2563EB] px-8 text-base font-bold text-white shadow-xl shadow-blue-600/30 transition-all hover:scale-105 hover:bg-[#3B82F6] sm:text-lg"
              data-testid="final-signup"
            >
              ابدأ الآن مجاناً
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => setLocation("/login")}
              className="h-14 rounded-2xl border-slate-600 bg-transparent px-8 text-base font-bold text-white hover:bg-slate-800 hover:text-white sm:text-lg"
            >
              تواصل مع المبيعات
            </Button>
          </div>
          <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-slate-400 sm:mt-8 sm:gap-6 sm:text-sm">
            {[
              "بدون عقد التزام",
              "دعم فني 24/7",
              "بياناتك آمنة 100%",
            ].map((line) => (
              <span key={line} className="flex items-center gap-2">
                <CircleCheck className="size-3 text-emerald-400" /> {line}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-slate-50 pb-8 pt-12 sm:pt-16">
        <div className="mx-auto max-w-[1440px] px-6 md:px-12">
          <div className="mb-10 grid grid-cols-2 gap-8 sm:mb-12 md:grid-cols-4 lg:grid-cols-5">
            <div className="col-span-2 lg:col-span-2">
              <div className="mb-4 flex items-center gap-2 sm:mb-6">
                <div className="grid size-8 place-items-center rounded-lg bg-[#2563EB] text-white">
                  <Calculator className="size-4" />
                </div>
                <span className="text-xl font-bold text-slate-900">حاسبة.</span>
              </div>
              <p className="mb-5 max-w-xs text-sm leading-relaxed text-slate-500 sm:mb-6">
                نظام كاشير ومحاسبة سحابي ذكي، مصمم لتمكين تجار التجزئة من إدارة
                أعمالهم بكفاءة ودقة متناهية.
              </p>
              <div className="flex gap-3 sm:gap-4">
                {[Twitter, Linkedin, Instagram].map((Icon, i) => (
                  <a
                    key={i}
                    href="#"
                    className="grid size-9 place-items-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-blue-200 hover:text-[#2563EB] sm:size-10"
                  >
                    <Icon className="size-4" />
                  </a>
                ))}
              </div>
            </div>

            {[
              {
                title: "المنتج",
                items: ["المميزات", "الأسعار", "الأجهزة", "API المطورين"],
              },
              {
                title: "الشركة",
                items: ["عن حاسبة", "الوظائف", "المدونة", "تواصل معنا"],
              },
              {
                title: "الدعم",
                items: ["مركز المساعدة", "حالة النظام", "سياسة الخصوصية", "شروط الاستخدام"],
              },
            ].map((col) => (
              <div key={col.title}>
                <h4 className="mb-4 font-bold text-slate-900">{col.title}</h4>
                <ul className="space-y-2 text-sm text-slate-500 sm:space-y-3">
                  {col.items.map((it) => (
                    <li key={it}>
                      <a href="#" className="transition-colors hover:text-[#2563EB]">
                        {it}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 pt-6 sm:flex-row sm:gap-4">
            <p className="text-xs text-slate-400 sm:text-sm">
              © 2026 شركة حاسبة للتقنية. جميع الحقوق محفوظة.
            </p>
            <div className="flex items-center gap-2 text-xs text-slate-400 sm:text-sm">
              <ShieldCheck className="size-4 text-emerald-500" />
              مرخصة من وزارة الاتصالات
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Tiny inline SVG sparkline mock
function MiniChart() {
  const points = [22, 30, 26, 38, 32, 45, 50, 42, 58, 65, 60, 72];
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const w = 100;
  const h = 100;
  const step = w / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * step;
      const y = h - ((p - min) / range) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const fillPath = `${path} L${w},${h} L0,${h} Z`;
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="h-32 w-full sm:h-40"
    >
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill="url(#g)" />
      <path d={path} fill="none" stroke="#2563EB" strokeWidth="1.5" />
    </svg>
  );
}
