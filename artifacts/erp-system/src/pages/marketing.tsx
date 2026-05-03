import { useState } from "react";
import { useApiQuery, useApiMutation } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Megaphone,
  Users as UsersIcon,
  Wallet,
  Target,
  Plus,
  Mail,
  Smartphone,
  Globe2,
  Hash,
  Sparkles,
} from "lucide-react";

type Campaign = {
  id: number;
  name: string;
  channel: string;
  status: string;
  budget: number;
  spent: number;
  reach: number;
  conversions: number;
  startDate: string | null;
  endDate: string | null;
};
type Lead = {
  id: number;
  fullName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  source: string;
  campaignName: string | null;
  status: string;
  estimatedValue: number;
  score: number;
};
type Summary = {
  totalCampaigns: number;
  activeCampaigns: number;
  totalLeads: number;
  wonLeads: number;
  pipelineValue: number;
  conversionRate: number;
};

const SAR = (n: number) =>
  new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR", maximumFractionDigits: 0 }).format(n);
const NUM = (n: number) => new Intl.NumberFormat("ar-SA").format(n);

const channelMeta: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  email: { label: "بريد", icon: Mail, cls: "bg-blue-100 text-blue-700" },
  social: { label: "تواصل", icon: Hash, cls: "bg-purple-100 text-purple-700" },
  sms: { label: "رسائل", icon: Smartphone, cls: "bg-emerald-100 text-emerald-700" },
  ads: { label: "إعلانات", icon: Globe2, cls: "bg-amber-100 text-amber-700" },
  event: { label: "فعاليات", icon: Sparkles, cls: "bg-rose-100 text-rose-700" },
};

const campaignStatus: Record<string, { label: string; cls: string }> = {
  draft: { label: "مسودة", cls: "bg-slate-100 text-slate-700" },
  scheduled: { label: "مجدولة", cls: "bg-blue-100 text-blue-700" },
  active: { label: "نشطة", cls: "bg-emerald-100 text-emerald-700" },
  paused: { label: "متوقفة", cls: "bg-amber-100 text-amber-700" },
  completed: { label: "مكتملة", cls: "bg-purple-100 text-purple-700" },
};

const leadStatus: Record<string, { label: string; cls: string }> = {
  new: { label: "جديد", cls: "bg-blue-100 text-blue-700" },
  contacted: { label: "تم التواصل", cls: "bg-purple-100 text-purple-700" },
  qualified: { label: "مؤهل", cls: "bg-amber-100 text-amber-700" },
  proposal: { label: "عرض", cls: "bg-indigo-100 text-indigo-700" },
  won: { label: "فوز", cls: "bg-emerald-100 text-emerald-700" },
  lost: { label: "خسارة", cls: "bg-rose-100 text-rose-700" },
};

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  iconClass,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  iconClass?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-xs font-bold text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-extrabold">{value}</p>
          {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        <div className={`grid size-12 place-items-center rounded-2xl ${iconClass ?? "bg-primary/10 text-primary"}`}>
          <Icon className="size-6" />
        </div>
      </CardContent>
    </Card>
  );
}

function LeadRow({ lead: l }: { lead: Lead }) {
  const convert = useApiMutation<{ stageId?: number }, { id: number }>(
    `/crm/leads/${l.id}/convert`,
    ["/marketing/leads", "/crm/opportunities", "/crm/pipeline"],
  );
  return (
    <TableRow data-testid={`row-lead-${l.id}`}>
      <TableCell>
        <div className="font-medium">{l.fullName}</div>
        {l.email && <div className="text-[11px] text-muted-foreground" dir="ltr">{l.email}</div>}
      </TableCell>
      <TableCell className="text-muted-foreground">{l.company ?? "—"}</TableCell>
      <TableCell className="text-muted-foreground">{l.campaignName ?? l.source}</TableCell>
      <TableCell className="text-center">
        <div className="inline-flex h-7 min-w-12 items-center justify-center rounded-full bg-primary/10 px-2 text-xs font-bold text-primary">
          {l.score}
        </div>
      </TableCell>
      <TableCell className="text-left font-bold">{SAR(l.estimatedValue)}</TableCell>
      <TableCell className="text-center">
        <Badge className={leadStatus[l.status]?.cls ?? ""}>
          {leadStatus[l.status]?.label ?? l.status}
        </Badge>
      </TableCell>
      <TableCell className="text-center">
        {l.status === "qualified" || l.status === "won" || l.status === "proposal" ? (
          <Badge variant="outline" className="text-[10px]">تم التحويل</Badge>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            disabled={convert.isPending}
            onClick={() => convert.mutate({})}
            data-testid={`btn-convert-lead-${l.id}`}
          >
            <Target className="size-3" />
            تحويل لفرصة
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function NewLeadDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fullName: "", company: "", email: "", phone: "", estimatedValue: "" });
  const create = useApiMutation<unknown, Lead>("/marketing/leads", ["/marketing/leads", "/marketing/summary"]);

  const submit = async () => {
    if (!form.fullName.trim()) return;
    await create.mutateAsync({
      fullName: form.fullName.trim(),
      company: form.company.trim() || undefined,
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : 0,
    });
    setForm({ fullName: "", company: "", email: "", phone: "", estimatedValue: "" });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2" data-testid="button-new-lead">
          <Plus className="size-4" />
          عميل محتمل جديد
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>عميل محتمل جديد</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-bold">الاسم</label>
            <Input
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              data-testid="input-lead-name"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold">الشركة</label>
            <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-bold">البريد</label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold">الجوال</label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold">القيمة المتوقعة (ر.س)</label>
            <Input
              type="number"
              value={form.estimatedValue}
              onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })}
              dir="ltr"
            />
          </div>
          {create.isError && <p className="text-xs text-rose-600">{(create.error as Error).message}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button onClick={submit} disabled={create.isPending} data-testid="button-save-lead">
            {create.isPending ? "جارِ الحفظ..." : "حفظ"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MarketingPage() {
  const { data: summary } = useApiQuery<Summary>("/marketing/summary");
  const { data: campaigns, isLoading: cmpLoading } = useApiQuery<Campaign[]>("/marketing/campaigns");
  const { data: leads, isLoading: leadsLoading } = useApiQuery<Lead[]>("/marketing/leads");

  return (
    <div className="mx-auto max-w-7xl space-y-6 pb-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">التسويق</h1>
          <p className="text-muted-foreground">إدارة الحملات وقمع المبيعات للعملاء المحتملين</p>
        </div>
        <NewLeadDialog />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Megaphone}
          label="الحملات"
          value={String(summary?.totalCampaigns ?? 0)}
          hint={`${summary?.activeCampaigns ?? 0} نشطة`}
        />
        <StatCard
          icon={UsersIcon}
          label="العملاء المحتملون"
          value={String(summary?.totalLeads ?? 0)}
          hint={`${summary?.wonLeads ?? 0} فوز`}
          iconClass="bg-blue-100 text-blue-700"
        />
        <StatCard
          icon={Wallet}
          label="قيمة قمع المبيعات"
          value={SAR(summary?.pipelineValue ?? 0)}
          iconClass="bg-emerald-100 text-emerald-700"
        />
        <StatCard
          icon={Target}
          label="معدل التحويل"
          value={`${summary?.conversionRate ?? 0}%`}
          iconClass="bg-purple-100 text-purple-700"
        />
      </div>

      <Tabs defaultValue="campaigns">
        <TabsList>
          <TabsTrigger value="campaigns" data-testid="tab-campaigns">الحملات</TabsTrigger>
          <TabsTrigger value="leads" data-testid="tab-leads">العملاء المحتملون</TabsTrigger>
        </TabsList>

        <TabsContent value="campaigns" className="mt-4">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">الحملات التسويقية</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>الحملة</TableHead>
                    <TableHead className="text-center">القناة</TableHead>
                    <TableHead className="text-center">الوصول</TableHead>
                    <TableHead className="text-center">التحويلات</TableHead>
                    <TableHead className="text-left">الميزانية</TableHead>
                    <TableHead className="text-left">المصروف</TableHead>
                    <TableHead className="text-center">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cmpLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={7}><Skeleton className="h-5 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : (campaigns ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                        لا توجد حملات. أنشئ أول حملة لبدء التتبع.
                      </TableCell>
                    </TableRow>
                  ) : (
                    campaigns!.map((c) => {
                      const ch = channelMeta[c.channel];
                      const Icon = ch?.icon ?? Megaphone;
                      return (
                        <TableRow key={c.id} data-testid={`row-campaign-${c.id}`}>
                          <TableCell className="font-medium">
                            <div>{c.name}</div>
                            {c.startDate && (
                              <div className="text-[11px] text-muted-foreground" dir="ltr">
                                {c.startDate} → {c.endDate ?? "—"}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge className={ch?.cls ?? ""}>
                              <Icon className="ms-1 size-3" />
                              {ch?.label ?? c.channel}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center font-medium">{NUM(c.reach)}</TableCell>
                          <TableCell className="text-center font-bold text-emerald-700">{NUM(c.conversions)}</TableCell>
                          <TableCell className="text-left">{SAR(c.budget)}</TableCell>
                          <TableCell className="text-left">{SAR(c.spent)}</TableCell>
                          <TableCell className="text-center">
                            <Badge className={campaignStatus[c.status]?.cls ?? ""}>
                              {campaignStatus[c.status]?.label ?? c.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="leads" className="mt-4">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">العملاء المحتملون</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>الاسم</TableHead>
                    <TableHead>الشركة</TableHead>
                    <TableHead>المصدر / الحملة</TableHead>
                    <TableHead className="text-center">النقاط</TableHead>
                    <TableHead className="text-left">القيمة المتوقعة</TableHead>
                    <TableHead className="text-center">الحالة</TableHead>
                    <TableHead className="text-center">إجراء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leadsLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={7}><Skeleton className="h-5 w-full" /></TableCell>
                      </TableRow>
                    ))
                  ) : (leads ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                        لا يوجد عملاء محتملون.
                      </TableCell>
                    </TableRow>
                  ) : (
                    leads!.map((l) => (
                      <LeadRow key={l.id} lead={l} />
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
