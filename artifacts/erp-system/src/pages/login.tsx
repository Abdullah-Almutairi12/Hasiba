import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import {
  Calculator,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Sparkles,
  ShieldCheck,
  ArrowLeft,
  ArrowRight,
  Fingerprint,
  AlertCircle,
  Languages,
} from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const { login, isLoggingIn, isAuthenticated } = useAuth();
  const { t, isRTL, toggleLanguage, language } = useLanguage();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) setLocation("/");
  }, [isAuthenticated, setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setError(null);
    try {
      await login({ email: email.trim().toLowerCase(), password });
      setLocation("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.loginFailed"));
    }
  };

  const ArrowIcon = isRTL ? ArrowLeft : ArrowRight;

  return (
    <div
      dir={isRTL ? "rtl" : "ltr"}
      className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/40 to-indigo-50/30 font-sans text-neutral-900"
    >
      {/* Top bar */}
      <header className="border-b border-neutral-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <button
            onClick={() => setLocation("/welcome")}
            className="flex items-center gap-2 sm:gap-3"
          >
            <div className="grid size-9 place-items-center rounded-xl bg-[#2563EB] text-white shadow-lg shadow-blue-500/30 sm:size-10">
              <Calculator className="size-4 sm:size-5" />
            </div>
            <div className={`${isRTL ? "text-right" : "text-left"} leading-tight`}>
              <span className="block text-base font-extrabold tracking-tight sm:text-lg">
                حاسبة<span className="text-[#2563EB]">.</span>
              </span>
              <span className="hidden text-[10px] font-medium uppercase tracking-wider text-neutral-500 sm:inline">
                {t("login.tagline")}
              </span>
            </div>
          </button>

          <div className="flex items-center gap-2 text-sm sm:gap-4">
            <button
              type="button"
              onClick={toggleLanguage}
              className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-bold text-neutral-700 transition-colors hover:bg-neutral-50"
              data-testid="button-login-language"
            >
              <Languages className="size-3.5" />
              {language === "ar" ? "EN" : "ع"}
            </button>
            <span className="hidden text-neutral-500 lg:inline">
              {t("login.noAccount")}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="font-bold"
              onClick={() => setLocation("/signup")}
              data-testid="button-signup"
            >
              {t("login.createAccount")}
            </Button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto grid max-w-6xl items-stretch gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[5fr_7fr]">
        {/* Brand panel */}
        <aside className={`hidden overflow-hidden rounded-3xl bg-gradient-to-br from-[#1D4ED8] via-[#2563EB] to-indigo-700 p-8 text-white shadow-2xl shadow-blue-900/20 lg:block ${isRTL ? "order-2 lg:order-1" : "order-2"}`}>
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold backdrop-blur">
            <Sparkles className="size-3" />
            {t("login.brandPill")}
          </div>
          <h2 className="text-3xl font-extrabold leading-tight">
            {t("login.brandTitle")}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-blue-100">
            {t("login.brandSubtitle")}
          </p>

          <div className="mt-8 space-y-3">
            {[
              { icon: Sparkles, title: t("login.feature1Title"), sub: t("login.feature1Sub") },
              { icon: ShieldCheck, title: t("login.feature2Title"), sub: t("login.feature2Sub") },
              { icon: Fingerprint, title: t("login.feature3Title"), sub: t("login.feature3Sub") },
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
              <p className="mt-1 text-[10px] text-blue-100">{t("login.statUptime")}</p>
            </div>
            <div className="border-x border-white/10">
              <p className="text-2xl font-extrabold">14h</p>
              <p className="mt-1 text-[10px] text-blue-100">{t("login.statSavings")}</p>
            </div>
            <div>
              <p className="text-2xl font-extrabold">+2.4K</p>
              <p className="mt-1 text-[10px] text-blue-100">{t("login.statCustomers")}</p>
            </div>
          </div>
        </aside>

        {/* Login form */}
        <div className={isRTL ? "order-1 lg:order-2" : "order-1"}>
          <div className="rounded-3xl border border-white/60 bg-white/90 p-6 shadow-xl shadow-blue-900/5 backdrop-blur sm:p-8 md:p-10">
            <div className={`mb-8 ${isRTL ? "text-right" : "text-left"}`}>
              <h1 className="text-2xl font-extrabold text-neutral-900 sm:text-3xl">
                {t("login.title")}<span className="text-[#2563EB]">.</span>
              </h1>
              <p className="mt-2 text-sm text-neutral-500">
                {t("login.subtitle")}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email */}
              <div>
                <label className="mb-1.5 block text-xs font-bold text-neutral-700">
                  {t("login.email")}
                </label>
                <div className="relative">
                  <Mail className={`absolute top-1/2 size-4 -translate-y-1/2 text-neutral-400 ${isRTL ? "right-3" : "left-3"}`} />
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.sa"
                    className={`h-12 text-sm ${isRTL ? "pe-10" : "ps-10"}`}
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
                    {t("login.password")}
                  </label>
                  <button
                    type="button"
                    className="text-[11px] font-bold text-[#2563EB] hover:underline"
                    onClick={() => alert(t("login.forgotPasswordAlert"))}
                  >
                    {t("login.forgotPassword")}
                  </button>
                </div>
                <div className="relative">
                  <Lock className={`absolute top-1/2 size-4 -translate-y-1/2 text-neutral-400 ${isRTL ? "right-3" : "left-3"}`} />
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
                    className={`absolute top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 ${isRTL ? "left-3" : "right-3"}`}
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="size-4 rounded border-neutral-300 text-[#2563EB] focus:ring-[#2563EB]"
                  />
                  <span className="text-xs font-medium text-neutral-700">
                    {t("login.rememberMe")}
                  </span>
                </label>
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
                  <ShieldCheck className="size-3" />
                  {t("login.twoFAProtected")}
                </span>
              </div>

              {/* Error message */}
              {error && (
                <div
                  className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700"
                  data-testid="login-error"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Submit */}
              <Button
                type="submit"
                disabled={isLoggingIn || !email || !password}
                className="h-12 w-full gap-2 rounded-xl bg-[#2563EB] text-base font-bold text-white shadow-lg shadow-blue-500/30 transition-all active:scale-[0.99] hover:bg-[#1D4ED8] disabled:bg-neutral-300 disabled:shadow-none"
                data-testid="button-login"
              >
                <ArrowIcon className="size-4" />
                {isLoggingIn ? t("login.loggingIn") : t("login.loginButton")}
              </Button>

              {/* Demo credentials hint */}
              <p className="rounded-xl bg-blue-50 p-3 text-center text-[11px] leading-relaxed text-blue-800">
                {t("login.demoHint")}{" "}
                <span className="font-mono font-bold">admin@hasba.ai</span> /{" "}
                <span className="font-mono font-bold">admin123</span>
              </p>

              {/* Divider */}
              <div className="relative my-2 flex items-center justify-center">
                <div className="absolute inset-x-0 h-px bg-neutral-200" />
                <span className="relative bg-white px-3 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                  {t("login.orLoginWith")}
                </span>
              </div>

              {/* SSO */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white text-xs font-bold text-neutral-700 transition-colors hover:bg-neutral-50"
                  onClick={() => alert(t("login.comingSoon"))}
                >
                  <svg className="size-4" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                  Google
                </button>
                <button
                  type="button"
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white text-xs font-bold text-neutral-700 transition-colors hover:bg-neutral-50"
                  onClick={() => alert(t("login.comingSoon"))}
                >
                  <svg className="size-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                  </svg>
                  Apple
                </button>
              </div>

              <p className="text-center text-[11px] leading-relaxed text-neutral-500">
                {t("login.termsPrefix")}{" "}
                <a className="font-bold text-[#2563EB] hover:underline" href="#">
                  {t("login.termsLink")}
                </a>{" "}
                {t("login.and")}{" "}
                <a className="font-bold text-[#2563EB] hover:underline" href="#">
                  {t("login.privacyLink")}
                </a>
                .
              </p>
            </form>
          </div>

          {/* Trust footer */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3 text-[11px] text-neutral-500 sm:gap-4">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="size-3 text-emerald-600" />
              {t("login.trustEncryption")}
            </span>
            <span>•</span>
            <span>{t("login.trustNCA")}</span>
            <span>•</span>
            <span>{t("login.trustZATCA")}</span>
          </div>
        </div>
      </main>
    </div>
  );
}
