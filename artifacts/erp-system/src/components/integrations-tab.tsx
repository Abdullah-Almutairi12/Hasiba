import { useState, Fragment } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plug, ShieldCheck, CreditCard, Truck, MessageCircle, FileCheck2 } from "lucide-react";

const BASE = "/api";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${r.status}`);
  }
  return (await r.json()) as T;
}

interface Credential {
  id: number;
  provider: string;
  label: string | null;
  environment: string;
  isActive: boolean;
  branchId: number | null;
  lastUsedAt: string | null;
}

interface Gateway {
  id: number;
  provider: string;
  displayName: string;
  isEnabled: boolean;
  environment: string;
  branchId: number | null;
}

interface Carrier {
  id: number;
  provider: string;
  displayName: string;
  isEnabled: boolean;
  environment: string;
}

interface OutboundMessage {
  id: number;
  channel: string;
  provider: string;
  toNumber: string;
  body: string;
  status: string;
  templateName: string | null;
  variables: Record<string, string> | null;
  createdAt: string;
}

interface WhatsAppTemplate {
  id: number;
  branchId: number | null;
  name: string;
  languageCode: string;
  category: string;
  bodyTemplate: string;
  variableHints: Array<{ name: string; example: string }> | null;
  status: string;
  createdAt: string;
}

interface ZatcaCert {
  id: number;
  status: string;
  environment: string;
  csid: string | null;
  pcsid: string | null;
  createdAt: string;
}

const PROVIDER_LABEL: Record<string, string> = {
  zatca: "ZATCA (الفاتورة الإلكترونية)",
  moyasar: "Moyasar",
  tap: "Tap Payments",
  hyperpay: "HyperPay",
  stcpay: "STC Pay",
  mada: "Mada",
  paytabs: "PayTabs",
  smsa: "SMSA Express",
  aramex: "Aramex",
  saee: "Saee",
  naqel: "Naqel Express",
  whatsapp: "WhatsApp Business",
  unifonic: "Unifonic SMS",
  mobily: "Mobily SMS",
  taqnyat: "Taqnyat SMS",
};

function CredentialsCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: creds } = useQuery({
    queryKey: ["/integrations/credentials"],
    queryFn: () => api<Credential[]>("/integrations/credentials"),
  });

  const [provider, setProvider] = useState("moyasar");
  const [label, setLabel] = useState("");
  const [environment, setEnvironment] = useState<"sandbox" | "production">("sandbox");
  const [secretJson, setSecretJson] = useState('{"secretApiKey":"sk_test_..."}');

  const upsert = useMutation({
    mutationFn: async () => {
      const secret = JSON.parse(secretJson) as Record<string, string>;
      return api("/integrations/credentials", {
        method: "POST",
        body: JSON.stringify({ provider, environment, label: label || null, secret }),
      });
    },
    onSuccess: () => {
      toast({ title: "تم حفظ بيانات الاعتماد بنجاح" });
      setSecretJson("{}");
      qc.invalidateQueries({ queryKey: ["/integrations/credentials"] });
      qc.invalidateQueries({ queryKey: ["/integrations/overview"] });
    },
    onError: (e: Error) => toast({ title: "فشل الحفظ", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => api(`/integrations/credentials/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "تم الحذف" });
      qc.invalidateQueries({ queryKey: ["/integrations/credentials"] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-primary" />
          بيانات اعتماد المزودين
        </CardTitle>
        <CardDescription>
          مفاتيح API محفوظة بتشفير AES-256-GCM. لا تظهر مرة أخرى بعد الحفظ.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="text-xs">المزود</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(PROVIDER_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">التسمية (اختياري)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثال: فرع الرياض" />
          </div>
          <div>
            <Label className="text-xs">البيئة</Label>
            <Select value={environment} onValueChange={(v) => setEnvironment(v as "sandbox" | "production")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">تجريبي</SelectItem>
                <SelectItem value="production">إنتاج</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={() => upsert.mutate()} disabled={upsert.isPending} className="w-full">
              حفظ
            </Button>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <Label className="text-xs">السر (JSON)</Label>
            <textarea
              dir="ltr"
              className="mt-1 w-full rounded-md border bg-background p-2 font-mono text-xs"
              rows={3}
              value={secretJson}
              onChange={(e) => setSecretJson(e.target.value)}
            />
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المزود</TableHead>
              <TableHead>التسمية</TableHead>
              <TableHead>البيئة</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead className="text-end">إجراء</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {creds?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  لم تتم إضافة بيانات اعتماد بعد
                </TableCell>
              </TableRow>
            )}
            {creds?.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{PROVIDER_LABEL[c.provider] ?? c.provider}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.label ?? "—"}</TableCell>
                <TableCell><Badge variant="outline">{c.environment}</Badge></TableCell>
                <TableCell>
                  {c.isActive ? (
                    <Badge className="bg-emerald-100 text-emerald-700">نشط</Badge>
                  ) : (
                    <Badge variant="secondary">معطل</Badge>
                  )}
                </TableCell>
                <TableCell className="text-end">
                  <Button size="sm" variant="ghost" onClick={() => del.mutate(c.id)}>حذف</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PaymentsCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: gws } = useQuery({
    queryKey: ["/integrations/payment-gateways"],
    queryFn: () => api<Gateway[]>("/integrations/payment-gateways"),
  });
  const [form, setForm] = useState({
    provider: "moyasar" as "moyasar" | "tap" | "hyperpay" | "stcpay" | "mada" | "paytabs",
    displayName: "Moyasar",
    environment: "sandbox" as "sandbox" | "production",
    webhookSecret: "",
  });
  const create = useMutation({
    mutationFn: () => api("/integrations/payment-gateways", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => {
      toast({ title: "تم إنشاء بوابة الدفع" });
      qc.invalidateQueries({ queryKey: ["/integrations/payment-gateways"] });
    },
    onError: (e: Error) => toast({ title: "فشل", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="size-4 text-primary" />
          بوابات الدفع السعودية
        </CardTitle>
        <CardDescription>Mada · STC Pay · Tap · HyperPay · Moyasar · PayTabs</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-4">
          <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v as typeof form.provider })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="moyasar">Moyasar</SelectItem>
              <SelectItem value="tap">Tap</SelectItem>
              <SelectItem value="hyperpay">HyperPay</SelectItem>
              <SelectItem value="stcpay">STC Pay</SelectItem>
              <SelectItem value="mada">Mada</SelectItem>
              <SelectItem value="paytabs">PayTabs</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="اسم العرض"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
          <Input
            placeholder="webhook secret"
            value={form.webhookSecret}
            onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })}
          />
          <Button onClick={() => create.mutate()} disabled={create.isPending}>إنشاء</Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المزود</TableHead>
              <TableHead>الاسم</TableHead>
              <TableHead>البيئة</TableHead>
              <TableHead>الحالة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {gws?.map((g) => (
              <TableRow key={g.id}>
                <TableCell className="font-medium">{PROVIDER_LABEL[g.provider] ?? g.provider}</TableCell>
                <TableCell>{g.displayName}</TableCell>
                <TableCell><Badge variant="outline">{g.environment}</Badge></TableCell>
                <TableCell>
                  {g.isEnabled ? (
                    <Badge className="bg-emerald-100 text-emerald-700">مفعّل</Badge>
                  ) : (
                    <Badge variant="secondary">معطل</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {gws?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                  لم تُسجَّل بوابات بعد
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ShippingCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: carriers } = useQuery({
    queryKey: ["/integrations/shipping-carriers"],
    queryFn: () => api<Carrier[]>("/integrations/shipping-carriers"),
  });
  const [form, setForm] = useState({
    provider: "smsa" as "smsa" | "aramex" | "saee" | "naqel",
    displayName: "SMSA Express",
    environment: "sandbox" as "sandbox" | "production",
    accountNumber: "",
  });
  const create = useMutation({
    mutationFn: () => api("/integrations/shipping-carriers", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => {
      toast({ title: "تم إنشاء الناقل" });
      qc.invalidateQueries({ queryKey: ["/integrations/shipping-carriers"] });
    },
    onError: (e: Error) => toast({ title: "فشل", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Truck className="size-4 text-primary" />
          شركات الشحن
        </CardTitle>
        <CardDescription>SMSA · Aramex · Saee · Naqel</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-4">
          <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v as typeof form.provider })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="smsa">SMSA</SelectItem>
              <SelectItem value="aramex">Aramex</SelectItem>
              <SelectItem value="saee">Saee</SelectItem>
              <SelectItem value="naqel">Naqel</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="اسم العرض"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
          <Input
            placeholder="رقم الحساب لدى الناقل"
            value={form.accountNumber}
            onChange={(e) => setForm({ ...form, accountNumber: e.target.value })}
          />
          <Button onClick={() => create.mutate()} disabled={create.isPending}>إنشاء</Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المزود</TableHead>
              <TableHead>الاسم</TableHead>
              <TableHead>البيئة</TableHead>
              <TableHead>الحالة</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {carriers?.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{PROVIDER_LABEL[c.provider] ?? c.provider}</TableCell>
                <TableCell>{c.displayName}</TableCell>
                <TableCell><Badge variant="outline">{c.environment}</Badge></TableCell>
                <TableCell>
                  {c.isEnabled ? (
                    <Badge className="bg-emerald-100 text-emerald-700">مفعّل</Badge>
                  ) : (
                    <Badge variant="secondary">معطل</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {carriers?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                  لا توجد شركات شحن مُسجَّلة
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function MessagingCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: msgs } = useQuery({
    queryKey: ["/integrations/messages"],
    queryFn: () => api<OutboundMessage[]>("/integrations/messages"),
  });
  const [form, setForm] = useState({
    channel: "whatsapp" as "whatsapp" | "sms",
    provider: "whatsapp" as "whatsapp" | "unifonic" | "mobily" | "taqnyat",
    to: "",
    body: "مرحبًا، نشكرك على التعامل مع متجرنا.",
  });
  const send = useMutation({
    mutationFn: () => api("/integrations/messages", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => {
      toast({ title: "تم إرسال الرسالة" });
      qc.invalidateQueries({ queryKey: ["/integrations/messages"] });
    },
    onError: (e: Error) => toast({ title: "فشل الإرسال", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="size-4 text-primary" />
          رسائل العملاء (WhatsApp + SMS)
        </CardTitle>
        <CardDescription>WhatsApp Cloud API · Unifonic · Mobily · Taqnyat</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-4">
          <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v as typeof form.channel })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
            </SelectContent>
          </Select>
          <Select value={form.provider} onValueChange={(v) => setForm({ ...form, provider: v as typeof form.provider })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="whatsapp">WhatsApp Cloud</SelectItem>
              <SelectItem value="unifonic">Unifonic</SelectItem>
              <SelectItem value="mobily">Mobily</SelectItem>
              <SelectItem value="taqnyat">Taqnyat</SelectItem>
            </SelectContent>
          </Select>
          <Input
            dir="ltr"
            placeholder="+9665xxxxxxxx"
            value={form.to}
            onChange={(e) => setForm({ ...form, to: e.target.value })}
          />
          <Button onClick={() => send.mutate()} disabled={send.isPending || !form.to}>إرسال</Button>
          <Input
            className="sm:col-span-4"
            placeholder="نص الرسالة"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>القناة</TableHead>
              <TableHead>المرسل إليه</TableHead>
              <TableHead>القالب / المتغيّرات</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>التاريخ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {msgs?.slice(0, 10).map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <Badge variant="outline">{m.channel}</Badge>{" "}
                  <span className="text-xs text-muted-foreground">{PROVIDER_LABEL[m.provider] ?? m.provider}</span>
                </TableCell>
                <TableCell dir="ltr" className="font-mono text-xs">{m.toNumber}</TableCell>
                <TableCell className="max-w-[260px]">
                  {m.templateName ? (
                    <div className="space-y-1">
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {m.templateName}
                      </Badge>
                      {m.variables && Object.keys(m.variables).length > 0 && (
                        <div className="text-[10px] text-muted-foreground" dir="ltr">
                          {Object.entries(m.variables)
                            .slice(0, 3)
                            .map(([k, v]) => `${k}=${v}`)
                            .join(" · ")}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">نص حر</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge className={
                    m.status === "sent" ? "bg-emerald-100 text-emerald-700"
                      : m.status === "failed" ? "bg-rose-100 text-rose-700"
                      : "bg-amber-100 text-amber-700"
                  }>{m.status}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(m.createdAt).toLocaleString("ar-SA")}
                </TableCell>
              </TableRow>
            ))}
            {msgs?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  لم تُرسَل أي رسائل بعد
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TemplatesCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: templates } = useQuery({
    queryKey: ["/integrations/whatsapp-templates"],
    queryFn: () => api<WhatsAppTemplate[]>("/integrations/whatsapp-templates"),
  });

  const sync = useMutation({
    mutationFn: () =>
      api<{ inserted: number }>("/integrations/whatsapp-templates/sync", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (data) => {
      toast({
        title: "تم تحديث القوالب",
        description: `تمت إضافة ${data.inserted} قالب جديد.`,
      });
      qc.invalidateQueries({ queryKey: ["/integrations/whatsapp-templates"] });
    },
    onError: (e: Error) =>
      toast({ title: "فشل المزامنة", description: e.message, variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<WhatsAppTemplate> }) =>
      api(`/integrations/whatsapp-templates/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      toast({ title: "تم حفظ القالب" });
      qc.invalidateQueries({ queryKey: ["/integrations/whatsapp-templates"] });
    },
    onError: (e: Error) =>
      toast({ title: "فشل الحفظ", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) =>
      api(`/integrations/whatsapp-templates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "تم الحذف" });
      qc.invalidateQueries({ queryKey: ["/integrations/whatsapp-templates"] });
    },
  });

  const [edit, setEdit] = useState<{ id: number; body: string } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({
    name: "",
    languageCode: "ar",
    category: "UTILITY" as "UTILITY" | "MARKETING" | "AUTHENTICATION",
    bodyTemplate: "",
    variableHints: "",
  });

  const create = useMutation({
    mutationFn: () =>
      api("/integrations/whatsapp-templates", {
        method: "POST",
        body: JSON.stringify({
          name: newForm.name.trim(),
          languageCode: newForm.languageCode.trim() || "ar",
          category: newForm.category,
          bodyTemplate: newForm.bodyTemplate,
          variableHints: newForm.variableHints
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((name) => ({ name, example: "" })),
          status: "pending",
        }),
      }),
    onSuccess: () => {
      toast({ title: "تم تسجيل القالب" });
      setShowNew(false);
      setNewForm({
        name: "",
        languageCode: "ar",
        category: "UTILITY",
        bodyTemplate: "",
        variableHints: "",
      });
      qc.invalidateQueries({ queryKey: ["/integrations/whatsapp-templates"] });
    },
    onError: (e: Error) =>
      toast({ title: "فشل التسجيل", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="size-4 text-primary" />
          قوالب WhatsApp الجاهزة
        </CardTitle>
        <CardDescription>
          قوالب معتمدة من Meta تُرسَل تلقائياً عند الأحداث: إصدار فاتورة، شحن طلب، انخفاض المخزون.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="text-xs text-muted-foreground">
            القوالب الجاهزة: <span className="font-mono">invoice_issued</span> ·{" "}
            <span className="font-mono">shipment_dispatched</span> ·{" "}
            <span className="font-mono">low_stock_alert</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowNew((v) => !v)}>
              {showNew ? "إغلاق" : "تسجيل قالب جديد"}
            </Button>
            <Button size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
              مزامنة القوالب الافتراضية
            </Button>
          </div>
        </div>

        {showNew && (
          <div className="grid gap-3 rounded-lg border bg-background p-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">اسم القالب (يطابق Meta)</Label>
              <Input
                dir="ltr"
                placeholder="order_confirmation"
                value={newForm.name}
                onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">اللغة</Label>
              <Input
                dir="ltr"
                placeholder="ar"
                value={newForm.languageCode}
                onChange={(e) => setNewForm({ ...newForm, languageCode: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">الفئة</Label>
              <Select
                value={newForm.category}
                onValueChange={(v) =>
                  setNewForm({ ...newForm, category: v as typeof newForm.category })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="UTILITY">UTILITY</SelectItem>
                  <SelectItem value="MARKETING">MARKETING</SelectItem>
                  <SelectItem value="AUTHENTICATION">AUTHENTICATION</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">المتغيّرات (مفصولة بفاصلة)</Label>
              <Input
                dir="ltr"
                placeholder="customer_name, order_no, total"
                value={newForm.variableHints}
                onChange={(e) => setNewForm({ ...newForm, variableHints: e.target.value })}
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">نص القالب (استخدم {"{{variable_name}}"})</Label>
              <textarea
                dir="auto"
                className="w-full rounded-md border bg-background p-2 text-sm"
                rows={3}
                value={newForm.bodyTemplate}
                onChange={(e) => setNewForm({ ...newForm, bodyTemplate: e.target.value })}
              />
            </div>
            <div className="md:col-span-2">
              <Button
                size="sm"
                onClick={() => create.mutate()}
                disabled={
                  create.isPending ||
                  newForm.name.trim().length < 2 ||
                  newForm.bodyTemplate.trim().length < 2
                }
              >
                تسجيل القالب
              </Button>
            </div>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>الاسم</TableHead>
              <TableHead>اللغة</TableHead>
              <TableHead>الفئة</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>المتغيّرات</TableHead>
              <TableHead className="text-end">إجراء</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates?.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  لم تتم إضافة أي قالب بعد. اضغط "مزامنة القوالب الافتراضية".
                </TableCell>
              </TableRow>
            )}
            {templates?.map((t) => (
              <Fragment key={t.id}>
                <TableRow>
                  <TableCell className="font-mono text-xs">{t.name}</TableCell>
                  <TableCell><Badge variant="outline">{t.languageCode}</Badge></TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">{t.category}</Badge>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={t.status}
                      onValueChange={(v) => update.mutate({ id: t.id, patch: { status: v } as Partial<WhatsAppTemplate> })}
                    >
                      <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="approved">معتمد</SelectItem>
                        <SelectItem value="pending">قيد المراجعة</SelectItem>
                        <SelectItem value="paused">موقوف</SelectItem>
                        <SelectItem value="rejected">مرفوض</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-[10px] text-muted-foreground" dir="ltr">
                    {(t.variableHints ?? []).map((v) => v.name).join(", ") || "—"}
                  </TableCell>
                  <TableCell className="text-end">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEdit(edit?.id === t.id ? null : { id: t.id, body: t.bodyTemplate })
                      }
                    >
                      {edit?.id === t.id ? "إلغاء" : "تعديل"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => del.mutate(t.id)}>
                      حذف
                    </Button>
                  </TableCell>
                </TableRow>
                {edit?.id === t.id && (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-muted/30">
                      <div className="space-y-2 p-2">
                        <Label className="text-xs">نص القالب (استخدم {"{{variable_name}}"})</Label>
                        <textarea
                          dir="auto"
                          className="w-full rounded-md border bg-background p-2 text-sm"
                          rows={4}
                          value={edit.body}
                          onChange={(e) => setEdit({ id: t.id, body: e.target.value })}
                        />
                        <Button
                          size="sm"
                          onClick={() => {
                            update.mutate({ id: t.id, patch: { bodyTemplate: edit.body } as Partial<WhatsAppTemplate> });
                            setEdit(null);
                          }}
                        >
                          حفظ
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ZatcaCard() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: certs } = useQuery({
    queryKey: ["/integrations/zatca/certificates"],
    queryFn: () => api<ZatcaCert[]>("/integrations/zatca/certificates"),
  });

  const [form, setForm] = useState({
    commonName: "Hasiba ERP",
    vatNumber: "300000000000003",
    organizationName: "حاسبة AI",
    environment: "sandbox" as "sandbox" | "production",
  });

  const csr = useMutation({
    mutationFn: () => api<{ csrPem: string; id: number }>("/integrations/zatca/csr", {
      method: "POST",
      body: JSON.stringify(form),
    }),
    onSuccess: (data) => {
      toast({ title: "تم إنشاء CSR — حمّله إلى بوابة فاتورة" });
      qc.invalidateQueries({ queryKey: ["/integrations/zatca/certificates"] });
      void navigator.clipboard?.writeText(data.csrPem);
    },
    onError: (e: Error) => toast({ title: "فشل CSR", description: e.message, variant: "destructive" }),
  });

  const [submit, setSubmit] = useState({ invoiceId: "", invoiceType: "simplified" as "simplified" | "standard" });
  const submitInvoice = useMutation({
    mutationFn: () => api("/integrations/zatca/submit", {
      method: "POST",
      body: JSON.stringify({
        invoiceId: Number(submit.invoiceId),
        invoiceType: submit.invoiceType,
      }),
    }),
    onSuccess: (data: unknown) => {
      const r = data as { status: string; uuid: string };
      toast({ title: `حالة فاتورة ZATCA: ${r.status}`, description: `UUID: ${r.uuid}` });
    },
    onError: (e: Error) => toast({ title: "فشل التقديم", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FileCheck2 className="size-4 text-primary" />
          ZATCA Phase 2 — الفاتورة الإلكترونية
        </CardTitle>
        <CardDescription>
          إنشاء CSR، تخزين الشهادة، توقيع وتقديم الفواتير (Clearance / Reporting).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-4">
          <Input
            placeholder="اسم الشركة"
            value={form.organizationName}
            onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
          />
          <Input
            dir="ltr"
            placeholder="VAT (15 رقمًا)"
            value={form.vatNumber}
            onChange={(e) => setForm({ ...form, vatNumber: e.target.value })}
          />
          <Select value={form.environment} onValueChange={(v) => setForm({ ...form, environment: v as "sandbox" | "production" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sandbox">تجريبي</SelectItem>
              <SelectItem value="production">إنتاج</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => csr.mutate()} disabled={csr.isPending}>
            توليد CSR ونسخه
          </Button>
        </div>

        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-4">
          <Input
            placeholder="رقم الفاتورة (id)"
            value={submit.invoiceId}
            onChange={(e) => setSubmit({ ...submit, invoiceId: e.target.value })}
          />
          <Select value={submit.invoiceType} onValueChange={(v) => setSubmit({ ...submit, invoiceType: v as "simplified" | "standard" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="simplified">مبسطة (Reporting)</SelectItem>
              <SelectItem value="standard">ضريبية (Clearance)</SelectItem>
            </SelectContent>
          </Select>
          <Button
            className="sm:col-span-2"
            onClick={() => submitInvoice.mutate()}
            disabled={!submit.invoiceId || submitInvoice.isPending}
          >
            توقيع وتقديم إلى ZATCA
          </Button>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>الحالة</TableHead>
              <TableHead>CSID</TableHead>
              <TableHead>PCSID</TableHead>
              <TableHead>التاريخ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {certs?.map((c) => (
              <TableRow key={c.id}>
                <TableCell>{c.id}</TableCell>
                <TableCell>
                  <Badge variant="outline">{c.status}</Badge>{" "}
                  <span className="text-xs text-muted-foreground">{c.environment}</span>
                </TableCell>
                <TableCell className="font-mono text-xs">{c.csid ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">{c.pcsid ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(c.createdAt).toLocaleDateString("ar-SA")}
                </TableCell>
              </TableRow>
            ))}
            {certs?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                  لم يتم إنشاء أي شهادة بعد
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function IntegrationsTab() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-gradient-to-br from-indigo-50 to-white p-5 dark:from-indigo-950/30 dark:to-transparent">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-white p-2 shadow-sm">
            <Plug className="size-5 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-base font-bold">حزمة التكاملات السعودية</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              ZATCA Phase 2، 6 بوابات دفع محلية، 4 شركات شحن، WhatsApp Business، ومزودي SMS — بمصادقة مشفرة وسجل كامل لكل اتصال خارجي.
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="zatca" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="zatca">ZATCA</TabsTrigger>
          <TabsTrigger value="payments">المدفوعات</TabsTrigger>
          <TabsTrigger value="shipping">الشحن</TabsTrigger>
          <TabsTrigger value="messaging">الرسائل</TabsTrigger>
          <TabsTrigger value="templates">القوالب</TabsTrigger>
          <TabsTrigger value="credentials">بيانات الاعتماد</TabsTrigger>
        </TabsList>
        <TabsContent value="zatca"><ZatcaCard /></TabsContent>
        <TabsContent value="payments"><PaymentsCard /></TabsContent>
        <TabsContent value="shipping"><ShippingCard /></TabsContent>
        <TabsContent value="messaging"><MessagingCard /></TabsContent>
        <TabsContent value="templates"><TemplatesCard /></TabsContent>
        <TabsContent value="credentials"><CredentialsCard /></TabsContent>
      </Tabs>
    </div>
  );
}
