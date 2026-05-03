import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Money } from "@/components/riyal";
import { Plus, Trophy, X, Target } from "lucide-react";
import { useApiQuery, apiPost } from "@/hooks/use-api";
import { useToast } from "@/hooks/use-toast";
import { useListCustomers } from "@workspace/api-client-react";

interface Stage {
  id: number; name: string; nameAr: string; sequence: number; probability: number; isWon: boolean; isLost: boolean;
}
interface Opportunity {
  id: number; name: string; customerId: number | null; customerName: string | null;
  salesRepId: number | null; salesRepName: string | null;
  stageId: number; stageName: string | null; stageSequence: number;
  isWon: boolean; isLost: boolean;
  expectedRevenue: number; probability: number;
  expectedCloseDate: string | null; closedAt: string | null;
}
interface Pipeline {
  stages: Array<{ stageId: number; name: string; sequence: number; isWon: boolean; isLost: boolean; count: number; value: number; weighted: number }>;
}

async function patchOpp(id: number, body: unknown) {
  const res = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/crm/opportunities/${id}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

interface UserLite { id: number; name: string; }

export default function CrmPage() {
  const { data: stages } = useApiQuery<Stage[]>("/crm/stages");
  const { data: opps, refetch } = useApiQuery<Opportunity[]>("/crm/opportunities");
  const [repFilter, setRepFilter] = useState<string>("");
  const { data: pipeline, refetch: refetchPipeline } = useApiQuery<Pipeline>(
    `/crm/pipeline${repFilter ? `?salesRepId=${repFilter}` : ""}`,
  );
  const { data: reps } = useApiQuery<UserLite[]>("/crm/sales-reps");
  const [open, setOpen] = useState(false);
  const [reasonState, setReasonState] = useState<{ oppId: number; stageId: number; isWon: boolean } | null>(null);
  const { toast } = useToast();

  const totalWeighted = pipeline?.stages
    .filter((s) => !s.isWon && !s.isLost)
    .reduce((a, s) => a + s.weighted, 0) ?? 0;
  const wonValue = pipeline?.stages.find((s) => s.isWon)?.value ?? 0;

  return (
    <div className="space-y-6 pb-8 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">إدارة علاقات العملاء (CRM)</h1>
          <p className="text-muted-foreground">خط الفرص وإدارة المراحل من جديد إلى فوز</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="size-4" />فرصة جديدة</Button>
          </DialogTrigger>
          <OpportunityDialog stages={stages ?? []} onSuccess={() => { setOpen(false); refetch(); }} />
        </Dialog>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card><CardContent className="p-4">
          <div className="flex items-start justify-between"><div className="text-sm text-muted-foreground">الإيراد المتوقع المرجح</div><Target className="size-4 text-muted-foreground" /></div>
          <div className="text-2xl font-bold tabular-nums"><Money value={+totalWeighted.toFixed(2)} /></div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-start justify-between"><div className="text-sm text-muted-foreground">صفقات مفتوحة</div><Plus className="size-4 text-muted-foreground" /></div>
          <div className="text-2xl font-bold tabular-nums">{opps?.filter((o) => !o.isWon && !o.isLost).length ?? 0}</div>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <div className="flex items-start justify-between"><div className="text-sm text-muted-foreground">قيمة الفوز هذا الموسم</div><Trophy className="size-4 text-muted-foreground" /></div>
          <div className="text-2xl font-bold tabular-nums"><Money value={+wonValue.toFixed(2)} /></div>
        </CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted-foreground">قمع المبيعات لـ:</span>
          <Select value={repFilter || "all"} onValueChange={(v) => setRepFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">جميع المندوبين</SelectItem>
              {reps?.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <FunnelChart stages={pipeline?.stages ?? []} />

      <WinRateCard />


      <KanbanBoard stages={stages ?? []} opps={opps ?? []} onMove={async (oppId, stageId) => {
        const stage = stages?.find((s) => s.id === stageId);
        // For terminal stages (won/lost), open a small dialog so the rep
        // captures a reason — this feeds the win-rate report and helps
        // marketing close the loop on the originating campaign.
        if (stage?.isWon || stage?.isLost) {
          setReasonState({ oppId, stageId, isWon: !!stage.isWon });
          return;
        }
        try { await patchOpp(oppId, { stageId }); refetch(); refetchPipeline(); } catch (e) {
          toast({ title: "تعذر النقل", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
        }
      }} />

      <WinLossReasonDialog
        state={reasonState}
        onClose={() => setReasonState(null)}
        onSubmit={async (reason) => {
          if (!reasonState) return;
          try {
            await patchOpp(reasonState.oppId, { stageId: reasonState.stageId, winLossReason: reason || null });
            setReasonState(null);
            refetch(); refetchPipeline();
          } catch (e) {
            toast({ title: "خطأ", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
          }
        }}
      />
    </div>
  );
}

// Win-rate report — pulls /crm/reports/win-rate which counts opportunities
// that ended in won vs lost terminal stages and reports the % share of each
// stage so coaching can target where the funnel leaks.
type WinRate = {
  totalClosed: number;
  won: number;
  lost: number;
  winRate: number;
  byStage: Array<{ stageId: number; name: string; sequence: number; isWon: boolean; isLost: boolean; count: number; share: number }>;
};
function WinRateCard() {
  const { data } = useApiQuery<WinRate>("/crm/reports/win-rate");
  if (!data) return null;
  const closed = data.byStage.filter((s) => s.isWon || s.isLost);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Trophy className="size-4" />نسبة النجاح ومعدل الإغلاق</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">صفقات مغلقة</div><div className="text-xl font-bold tabular-nums">{data.totalClosed}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">فوز</div><div className="text-xl font-bold tabular-nums text-emerald-700">{data.won}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">خسارة</div><div className="text-xl font-bold tabular-nums text-destructive">{data.lost}</div></div>
          <div className="rounded-lg border p-3"><div className="text-xs text-muted-foreground">نسبة النجاح</div><div className="text-xl font-bold tabular-nums">{data.winRate}%</div></div>
        </div>
        {closed.length > 0 && (
          <div className="space-y-1">
            {closed.map((s) => (
              <div key={s.stageId} className="flex items-center gap-3 text-sm">
                <span className="w-32 truncate">{s.name}</span>
                <div className="flex-1 bg-muted rounded h-2 overflow-hidden">
                  <div className={`h-full ${s.isWon ? "bg-emerald-500" : "bg-destructive"}`} style={{ width: `${s.share}%` }} />
                </div>
                <span className="tabular-nums w-20 text-end">{s.count} ({s.share}%)</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WinLossReasonDialog({
  state, onClose, onSubmit,
}: {
  state: { oppId: number; stageId: number; isWon: boolean } | null;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  React.useEffect(() => { if (state) setReason(""); }, [state]);
  return (
    <Dialog open={!!state} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state?.isWon ? "سبب الفوز بالصفقة" : "سبب خسارة الصفقة"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <Label>السبب (اختياري)</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
            placeholder={state?.isWon ? "مثال: السعر التنافسي، علاقة قوية مع العميل" : "مثال: السعر، المنافسة، التوقيت"} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={() => onSubmit(reason)}>تأكيد النقل</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FunnelChart({
  stages,
}: {
  stages: Array<{ stageId: number; name: string; sequence: number; isWon: boolean; isLost: boolean; count: number; value: number; weighted: number }>;
}) {
  // Show open + won stages as a top-down funnel; "lost" is rendered separately
  // so it doesn't break the descending shape.
  const open = [...stages]
    .filter((s) => !s.isLost)
    .sort((a, b) => a.sequence - b.sequence);
  const lost = stages.find((s) => s.isLost);
  const maxValue = Math.max(1, ...open.map((s) => s.value));
  return (
    <Card>
      <CardHeader><CardTitle>قُمع المبيعات</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {open.map((s) => {
          const pct = Math.max(4, Math.round((s.value / maxValue) * 100));
          return (
            <div key={s.stageId} className="flex items-center gap-3">
              <div className="w-32 shrink-0 text-sm">{s.name}</div>
              <div className="flex-1 bg-muted/50 rounded h-7 overflow-hidden">
                <div
                  className={`h-full flex items-center justify-end px-2 text-xs text-primary-foreground tabular-nums ${
                    s.isWon ? "bg-green-600" : "bg-primary"
                  }`}
                  style={{ width: `${pct}%` }}
                >
                  {s.count}
                </div>
              </div>
              <div className="w-32 shrink-0 text-end text-sm tabular-nums">
                <Money value={+s.value.toFixed(2)} />
              </div>
            </div>
          );
        })}
        {lost && (
          <div className="flex items-center gap-3 pt-2 border-t border-border/50">
            <div className="w-32 shrink-0 text-sm text-destructive">{lost.name}</div>
            <div className="flex-1 text-xs text-muted-foreground">
              {lost.count} صفقات
            </div>
            <div className="w-32 shrink-0 text-end text-sm tabular-nums text-muted-foreground">
              <Money value={+lost.value.toFixed(2)} />
            </div>
          </div>
        )}
        {open.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-6">
            لا توجد فرص حالياً
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KanbanBoard({
  stages, opps, onMove,
}: {
  stages: Stage[];
  opps: Opportunity[];
  onMove: (oppId: number, stageId: number) => void;
}) {
  return (
    <div className="grid auto-cols-[18rem] grid-flow-col gap-3 overflow-x-auto pb-4">
      {stages.map((s) => {
        const cards = opps.filter((o) => o.stageId === s.id);
        const value = cards.reduce((a, o) => a + o.expectedRevenue, 0);
        return (
          <div
            key={s.id}
            className="bg-muted/40 rounded-lg p-3 min-h-[400px]"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const oppId = Number(e.dataTransfer.getData("text/plain"));
              if (oppId) onMove(oppId, s.id);
            }}
          >
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-border/50">
              <div className="font-semibold flex items-center gap-2">
                {s.isWon && <Trophy className="size-3 text-green-600" />}
                {s.isLost && <X className="size-3 text-destructive" />}
                {s.nameAr}
              </div>
              <Badge variant="outline" className="font-mono">{cards.length}</Badge>
            </div>
            <div className="text-xs text-muted-foreground mb-2 tabular-nums"><Money value={+value.toFixed(2)} /></div>
            <div className="space-y-2">
              {cards.map((o) => (
                <div key={o.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", String(o.id))}
                  className="bg-card rounded border border-border p-2 cursor-grab active:cursor-grabbing hover:shadow-sm">
                  <div className="text-sm font-medium line-clamp-2">{o.name}</div>
                  {o.customerName && <div className="text-xs text-muted-foreground mt-0.5">{o.customerName}</div>}
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs tabular-nums font-medium"><Money value={o.expectedRevenue} /></span>
                    <Badge variant="outline" className="text-[10px] h-4">{o.probability}%</Badge>
                  </div>
                  {o.expectedCloseDate && <div className="text-[10px] text-muted-foreground mt-0.5">إغلاق: {o.expectedCloseDate}</div>}
                </div>
              ))}
              {cards.length === 0 && <div className="text-xs text-muted-foreground text-center py-6">— فارغة —</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OpportunityDialog({ stages, onSuccess }: { stages: Stage[]; onSuccess: () => void }) {
  const { data: customers } = useListCustomers({});
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [stageId, setStageId] = useState<number | null>(stages[0]?.id ?? null);
  const [expectedRevenue, setExpectedRevenue] = useState(0);
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const submit = async () => {
    if (!name || !stageId) { toast({ title: "بيانات ناقصة", variant: "destructive" }); return; }
    try {
      await apiPost("/crm/opportunities", {
        name,
        customerId,
        stageId,
        expectedRevenue,
        expectedCloseDate: expectedCloseDate || null,
        notes,
      });
      toast({ title: "تم إنشاء الفرصة" });
      onSuccess();
    } catch (e) {
      toast({ title: "خطأ", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>فرصة جديدة</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>الاسم</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>العميل</Label>
            <Select value={customerId?.toString() ?? ""} onValueChange={(v) => setCustomerId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{customers?.map((c) => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>المرحلة</Label>
            <Select value={stageId?.toString() ?? ""} onValueChange={(v) => setStageId(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{stages.map((s) => <SelectItem key={s.id} value={s.id.toString()}>{s.nameAr}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>الإيراد المتوقع</Label><Input type="number" step="100" value={expectedRevenue} onChange={(e) => setExpectedRevenue(Number(e.target.value))} /></div>
          <div><Label>تاريخ الإغلاق المتوقع</Label><Input type="date" value={expectedCloseDate} onChange={(e) => setExpectedCloseDate(e.target.value)} /></div>
        </div>
        <div><Label>ملاحظات</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></div>
      </div>
      <DialogFooter><Button onClick={submit}>حفظ</Button></DialogFooter>
    </DialogContent>
  );
}
