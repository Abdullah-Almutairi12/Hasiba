import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Calculator, Mail, CheckCircle2 } from "lucide-react";
import { portalApi, setPortalSession, type PortalKind } from "@/lib/portal-api";

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

export default function PortalLogin() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const initialPortal = (params.get("portal") as PortalKind) || "customer";
  const tokenInUrl = params.get("token");

  const [portal, setPortal] = useState<PortalKind>(initialPortal);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Auto-verify when arriving via magic link.
  useEffect(() => {
    if (!tokenInUrl) return;
    setVerifying(true);
    fetch(`${API_BASE}/portal/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenInUrl }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "تعذر التحقق");
        return r.json();
      })
      .then((d: { token: string; portal: PortalKind }) => {
        setPortalSession(d.token, d.portal);
        setLocation(`/portal/${d.portal}`);
      })
      .catch((e: Error) => {
        setError(e.message);
        setVerifying(false);
      });
  }, [tokenInUrl, setLocation]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setDevLink(null);
    try {
      const r = await portalApi.post<{ ok: boolean; devLink?: string }>(
        "/portal/auth/request-magic-link",
        { portal, email },
      );
      setSent(true);
      if (r.devLink) setDevLink(r.devLink);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950" dir="rtl">
        <Card className="w-full max-w-md">
          <CardContent className="py-12 text-center">
            <div className="text-muted-foreground">جاري التحقق من الرابط...</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-4" dir="rtl">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto flex aspect-square size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Calculator className="size-6" />
          </div>
          <CardTitle className="text-2xl">بوابة العملاء والموردين</CardTitle>
          <CardDescription>
            أدخل بريدك الإلكتروني وسنرسل لك رابط دخول آمن
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={portal} onValueChange={(v) => setPortal(v as PortalKind)}>
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="customer">عميل</TabsTrigger>
              <TabsTrigger value="supplier">مورد</TabsTrigger>
              <TabsTrigger value="employee">موظف</TabsTrigger>
            </TabsList>
            {(["customer", "supplier", "employee"] as const).map((k) => (
              <TabsContent key={k} value={k} className="pt-4 space-y-3">
                {sent ? (
                  <Alert>
                    <CheckCircle2 className="size-4" />
                    <AlertDescription>
                      إذا كان البريد <strong>{email}</strong> مسجلاً، سيصلك رابط الدخول خلال دقائق.
                      {devLink && (
                        <div className="mt-3 text-xs">
                          <div className="font-medium mb-1">[تطوير] رابط الدخول:</div>
                          <a
                            className="underline break-all text-primary"
                            href={devLink}
                          >
                            {devLink}
                          </a>
                        </div>
                      )}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <form onSubmit={submit} className="space-y-3">
                    <div className="relative">
                      <Mail className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                      <Input
                        type="email"
                        placeholder="البريد الإلكتروني"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        className="pr-10"
                      />
                    </div>
                    {error && (
                      <Alert variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                      </Alert>
                    )}
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading ? "جاري الإرسال..." : "أرسل رابط الدخول"}
                    </Button>
                  </form>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
