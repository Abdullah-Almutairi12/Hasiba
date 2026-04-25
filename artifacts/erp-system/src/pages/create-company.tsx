import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Calculator,
  Building2,
  Mail,
  Phone,
  User,
  Lock,
  Globe,
  Sparkles,
  Shield,
  Zap,
  Check,
  ChevronLeft,
} from "lucide-react";

const BENEFITS = [
  { icon: Sparkles, title: "ذكاء اصطناعي مدمج", description: "تنبؤات وتقارير تلقائية" },
  { icon: Shield, title: "متوافق NCA + ZATCA", description: "أمان من المستوى البنكي" },
  { icon: Zap, title: "إعداد خلال 5 دقائق", description: "ابدأ البيع اليوم" },
];

export default function CreateCompany() {
  const [, setLocation] = useLocation();
  const [form, setForm] = useState({
    companyName: "",
    ownerName: "",
    email: "",
    phone: "+966",
    password: "",
    industry: "",
  });
  const [agreed, setAgreed] = useState(false);

  const isValid =
    form.companyName.trim() &&
    form.ownerName.trim() &&
    form.email.includes("@") &&
    form.phone.length > 5 &&
    form.password.length >= 8 &&
    agreed;

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
          <Button variant="ghost" size="sm">
            لديك حساب؟ <span className="ms-1 font-bold text-primary">سجّل الدخول</span>
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 lg:grid-cols-2">
        {/* Right - Marketing */}
        <div className="order-2 space-y-8 lg:order-1">
          <div>
            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="size-3" />
              نظام ERP السعودي الأول بالذكاء الاصطناعي
            </div>
            <h1 className="text-4xl font-bold leading-tight text-slate-900 md:text-5xl">
              جاهز لإطلاق قدراتك المالية؟
            </h1>
            <p className="mt-4 text-lg text-slate-600">
              انضم لأكثر من <span className="font-bold text-slate-900">2,400 منشأة</span>{" "}
              سعودية تستخدم حاسبة.AI لإدارة محاسبتها، فواتيرها، ومخزونها.
            </p>
          </div>

          {/* Benefits */}
          <div className="space-y-4">
            {BENEFITS.map((b, i) => {
              const Icon = b.icon;
              return (
                <div key={i} className="flex items-start gap-4">
                  <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-cyan-500 text-white shadow-lg shadow-primary/20">
                    <Icon className="size-6" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">{b.title}</p>
                    <p className="mt-0.5 text-sm text-slate-600">{b.description}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Trust badges */}
          <Card className="border-emerald-200 bg-gradient-to-l from-emerald-50 to-teal-50">
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="grid size-10 place-items-center rounded-lg bg-emerald-500 text-white">
                  <Check className="size-5" />
                </div>
                <div>
                  <p className="font-bold text-emerald-900">تجربة مجانية 30 يوم</p>
                  <p className="text-xs text-emerald-700">
                    بدون بطاقة ائتمان • إلغاء في أي وقت • دعم عربي 24/7
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Quote */}
          <div className="rounded-2xl border border-slate-200 bg-white/60 p-5 backdrop-blur">
            <p className="text-sm italic leading-relaxed text-slate-700">
              "حاسبة.AI وفّرت علينا 14 ساعة عمل أسبوعياً في المحاسبة. التقارير الذكية
              ساعدتنا على اكتشاف مشاكل لم نكن لنلاحظها."
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs">
              <div className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-xs font-bold text-white">
                س.ق
              </div>
              <div>
                <p className="font-bold text-slate-900">سارة القحطاني</p>
                <p className="text-slate-500">المديرة المالية - مجموعة الخليج</p>
              </div>
            </div>
          </div>
        </div>

        {/* Left - Form */}
        <div className="order-1 lg:order-2">
          <Card className="border-slate-200 shadow-2xl">
            <CardContent className="p-8">
              <div className="mb-6 text-center">
                <h2 className="text-3xl font-bold text-slate-900">أنشئ حساب منشأتك</h2>
                <p className="mt-2 text-sm text-slate-600">
                  ابدأ في أقل من دقيقة - لا حاجة لبطاقة ائتمان
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-700">
                    اسم المنشأة
                  </label>
                  <div className="relative">
                    <Building2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={form.companyName}
                      onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                      placeholder="مؤسستك التجارية"
                      className="h-11 ps-10"
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-700">
                    الاسم الكامل للمالك
                  </label>
                  <div className="relative">
                    <User className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={form.ownerName}
                      onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
                      placeholder="عبدالله بن محمد"
                      className="h-11 ps-10"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-700">
                      البريد الإلكتروني
                    </label>
                    <div className="relative">
                      <Mail className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        placeholder="you@company.sa"
                        className="h-11 ps-10"
                        dir="ltr"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-slate-700">
                      رقم الجوال
                    </label>
                    <div className="relative">
                      <Phone className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        value={form.phone}
                        onChange={(e) => setForm({ ...form, phone: e.target.value })}
                        className="h-11 ps-10"
                        dir="ltr"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-bold text-slate-700">
                    كلمة المرور
                  </label>
                  <div className="relative">
                    <Lock className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      type="password"
                      value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })}
                      placeholder="8 أحرف على الأقل"
                      className="h-11 ps-10"
                    />
                  </div>
                  <div className="mt-2 flex gap-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full ${
                          form.password.length >= i * 2
                            ? form.password.length >= 10
                              ? "bg-emerald-500"
                              : "bg-amber-500"
                            : "bg-slate-200"
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <label className="flex cursor-pointer items-start gap-2 pt-1">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-0.5 size-4 rounded border-slate-300 text-primary focus:ring-primary"
                  />
                  <span className="text-xs text-slate-600">
                    أوافق على{" "}
                    <a className="font-bold text-primary hover:underline">شروط الخدمة</a> و{" "}
                    <a className="font-bold text-primary hover:underline">سياسة الخصوصية</a>
                  </span>
                </label>

                <Button
                  className="h-12 w-full bg-gradient-to-l from-primary to-cyan-500 text-base font-bold hover:from-blue-600 hover:to-cyan-600"
                  disabled={!isValid}
                  onClick={() => setLocation("/onboarding")}
                >
                  <Sparkles className="ms-2 size-4" />
                  أنشئ حسابي مجاناً
                  <ChevronLeft className="me-1 size-4" />
                </Button>

                <div className="relative pt-2">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200" />
                  </div>
                  <div className="relative flex justify-center">
                    <span className="bg-white px-3 text-xs text-slate-500">أو</span>
                  </div>
                </div>

                <Button variant="outline" className="h-11 w-full">
                  <Globe className="ms-2 size-4" />
                  المتابعة عبر النفاذ الوطني (Nafath)
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
