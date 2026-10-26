import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/hooks/use-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, Plus, CheckCircle2 } from "lucide-react";
import { StocktakeScanner } from "@/components/stocktake-scanner";
import { countHeaders, countIntentKey } from "@/lib/stocktake-intent";
import { useAuth } from "@/hooks/use-auth";
import { useSelectedResponsibility } from "@/lib/workspace-responsibility";
import {StocktakeLineCounter} from "@/components/stocktake-line-counter";

interface StockTake {
  id: number;
  reference: string;
  warehouseId: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
}

interface StockTakeLine {
  id: number;
  productId: number;
  productName: string;
  sku: string | null;
  expectedQty: number;
  countedQty: number | null;
  countRevision: string;
  observationConfirmed: boolean;
}

interface Warehouse { id: number; nameAr: string }

export default function StockTakePage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [warehouseId, setWarehouseId] = useState<string>("");
  const [openId, setOpenId] = useState<number | null>(null);
  const selected=useSelectedResponsibility();

  const { data: takes = [] } = useQuery<StockTake[]>({
    queryKey: ["/inventory/stock-takes"],
    queryFn: () => apiGet("/inventory/stock-takes",countHeaders()),
  });
  const { data: warehouses = [] } = useQuery<Warehouse[]>({
    queryKey: ["/warehouses"],
    queryFn: () => apiGet("/warehouses"),
    enabled:!selected,
  });

  const start = useMutation({
    mutationFn: () => apiPost<{ id: number }>("/inventory/stock-takes", { warehouseId: Number(warehouseId) }),
    onSuccess: (data) => {
      toast({ title: "تم بدء جلسة الجرد" });
      qc.invalidateQueries({ queryKey: ["/inventory/stock-takes"] });
      setOpenId(data.id);
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const whName = (id: number) => warehouses.find((w) => w.id === id)?.nameAr ?? `#${id}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">جرد المخزون</h1>
          <p className="mt-1 text-muted-foreground">جلسات جرد دورية مع تعديلات تلقائية على الدفاتر</p>
        </div>
        <Link href="/inventory-revaluations" className="text-sm text-primary hover:underline" data-testid="link-revaluations">إعادة تقييم المخزون</Link>
      </div>

      {!selected&&<Card>
        <CardHeader><CardTitle>بدء جلسة جرد جديدة</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-2">
              <Label>المستودع</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger className="w-64"><SelectValue placeholder="اختر مستودعاً" /></SelectTrigger>
                <SelectContent>
                  {warehouses.map((w) => <SelectItem key={w.id} value={String(w.id)}>{w.nameAr}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => start.mutate()} disabled={!warehouseId || start.isPending}>
              <Plus className="ms-2 size-4" /> بدء الجرد
            </Button>
          </div>
        </CardContent>
      </Card>}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="size-5" /> جلسات الجرد</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المرجع</TableHead>
                <TableHead>المستودع</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>بدأت في</TableHead>
                <TableHead>إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {takes.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">لا توجد جلسات</TableCell></TableRow>
              ) : takes.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">{t.reference}</TableCell>
                  <TableCell>{whName(t.warehouseId)}</TableCell>
                  <TableCell>
                    <Badge variant={t.status === "done" ? "default" : "secondary"}>
                      {t.status === "in_progress" ? "جارٍ" : t.status === "done" ? "مكتمل" : t.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(t.startedAt).toLocaleString("ar-SA")}
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" onClick={() => setOpenId(t.id)}>فتح</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {openId && <StockTakeDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
function StockTakeDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [reviewReason,setReviewReason]=useState(""),[reviewPassword,setReviewPassword]=useState(""),
    [reviewToken,setReviewToken]=useState(""),[reviewRecovery,setReviewRecovery]=useState("");
  const { data, error, isLoading } = useQuery<{ id: number; reference: string; status: string; canCount:boolean;canComplete:boolean;
    canApprove:boolean;requiresExceptionProof:boolean;review:{approved:boolean;approvedBy:number}|null;
    varianceValue:{amount:string;currency:string}|null;
    hasCountParticipation:boolean;approvalBlockReason:string|null;lines: StockTakeLine[] }>({
    queryKey: [`/inventory/stock-takes/${id}`],
    queryFn: () => apiGet(`/inventory/stock-takes/${id}`,countHeaders()),
    refetchInterval: 15_000,
  });
  const approve=useMutation({
    mutationFn:()=>apiPost(`/inventory/stock-takes/${id}/approve`,{reason:reviewReason,
      ...(data?.requiresExceptionProof?{proof:{currentPassword:reviewPassword,
        ...(reviewToken?{token:reviewToken}:{}),...(reviewRecovery?{recoveryCode:reviewRecovery}:{})}}:{})}),
    onSuccess:()=>toast({title:"حُفظ اعتماد الفروق دون ترحيل؛ يمكن للمخوّل تنفيذ الترحيل"}),
    onError:(e:Error)=>toast({title:"لم يكتمل الاعتماد",description:e.message,variant:"destructive"}),
    onSettled:()=>{setReviewPassword("");setReviewToken("");setReviewRecovery("");
      void qc.invalidateQueries({queryKey:[`/inventory/stock-takes/${id}`]});},
  });

  const complete = useMutation({
    mutationFn: () => apiPost(`/inventory/stock-takes/${id}/complete`, {}),
    onSuccess: () => {
      toast({ title: "تم إقفال الجرد وتسجيل التعديلات" });
      qc.invalidateQueries({ queryKey: [`/inventory/stock-takes/${id}`] });
      qc.invalidateQueries({ queryKey: ["/inventory/stock-takes"] });
      onClose();
    },
    onError: (e: Error) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
    onSettled:()=>{void qc.invalidateQueries({queryKey:[`/inventory/stock-takes/${id}`]});},
  });

  if (isLoading) return <p role="status">جارٍ تحميل الجرد…</p>;
  if (error || !data) return <p role="alert">تعذر تحميل جلسة الجرد؛ تحقق من الاتصال والصلاحية.</p>;
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>جلسة الجرد {data.reference}</CardTitle>
          <div className="flex gap-2">
            {data.status !== "done" && data.canComplete && (
              <Button onClick={() => complete.mutate()} disabled={complete.isPending}>
                <CheckCircle2 className="ms-2 size-4" /> {data.review?"ترحيل الفروق المعتمدة":"إقفال وتسجيل التعديلات"}
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>إغلاق</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.status==="in_progress"&&data.varianceValue&&<p>
          قيمة الفروق المطلقة من الخادم: {data.varianceValue.amount} {data.varianceValue.currency}.
          لا تُقاص الزيادات والعجوزات لاختبار الحد. يعاد حساب القيمة والتحقق من الحدود عند الاعتماد والترحيل.
        </p>}
        {data.status==="in_progress"&&data.canApprove&&<div className="space-y-2 rounded-md border p-3">
          <Label htmlFor={`review-reason-${id}`}>سبب اعتماد فروق الجرد</Label>
          <Input id={`review-reason-${id}`} value={reviewReason} maxLength={500} onChange={e=>setReviewReason(e.target.value)} disabled={approve.isPending}/>
          {data.requiresExceptionProof&&<>
            <p>استثناء منشأة مفعّل: يلزم إذنك الصريح وحدّك المالي وتأكيد هويتك الحالية. لا يعالج ذلك هوية عد تاريخية مفقودة.</p>
            <Label htmlFor={`review-password-${id}`}>كلمة مرور الحساب لتأكيد الاستثناء</Label>
            <Input id={`review-password-${id}`} type="password" autoComplete="current-password" value={reviewPassword} onChange={e=>setReviewPassword(e.target.value)}/>
            <Label htmlFor={`review-token-${id}`}>رمز تطبيق المصادقة إن كان مفعّلًا</Label>
            <Input id={`review-token-${id}`} type="password" autoComplete="one-time-code" value={reviewToken} onChange={e=>setReviewToken(e.target.value)}/>
            <Label htmlFor={`review-recovery-${id}`}>رمز استعادة بدل رمز التطبيق</Label>
            <Input id={`review-recovery-${id}`} type="password" autoComplete="off" value={reviewRecovery} onChange={e=>setReviewRecovery(e.target.value)}/>
          </>}
          <Button disabled={approve.isPending||reviewReason.trim().length<3||(data.requiresExceptionProof&&!reviewPassword)}
            onClick={()=>approve.mutate()}>اعتماد الفروق دون ترحيل</Button>
        </div>}
        {data.status==="in_progress"&&data.review&&<p role="status">اعتماد مسجل بواسطة المستخدم {data.review.approvedBy}.
          يعاد التحقق من حقائق العد والتكلفة والسياسة وأهلية المعتمد عند الترحيل.</p>}
        {data.status==="in_progress"&&data.approvalBlockReason&&
          <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            {data.approvalBlockReason}
          </p>}
        {data.status==="in_progress"&&<p className="text-sm text-muted-foreground">
          الافتراضي: من سجّل أو عدّل أي كمية معدودة لا يعتمد فروق هذه الجلسة بالكامل، حتى لو كان مديرًا.
          إنشاء الجلسة أو مشاهدتها وحدهما لا يمنع الاعتماد؛ ويلزم دائمًا التخويل المستقل.
        </p>}
        <p className="text-sm">الحركة مسموحة أثناء الجرد. ابدأ عد كل صنف ثم أكده دون حركة متداخلة أثناء عده.
          المتوقّع هو رصيد نقطة العد؛ الحركات اللاحقة لا تُحسب فرقًا. العدد القديم بلا نقطة موثقة يحتاج إعادة عد.</p>
        {user?.companyId && <StocktakeScanner key={`${user.id}:${user.companyId}:${id}`} id={id}
          scope={countIntentKey(user.id,user.companyId,id)} disabled={data.status!=="in_progress"||!data.canCount}
          onConfirmed={()=>{void qc.invalidateQueries({queryKey:[`/inventory/stock-takes/${id}`]});}} />}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>المنتج</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>المتوقع عند العد</TableHead>
              <TableHead>المعدود</TableHead>
              <TableHead>الفرق</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.lines.map((l) => {
              const variance = l.countedQty == null ? null : l.countedQty - l.expectedQty;
              return (
                <TableRow key={l.id}>
                  <TableCell>{l.productName}</TableCell>
                  <TableCell className="font-mono text-xs">{l.sku}</TableCell>
                  <TableCell>{l.expectedQty}</TableCell>
                  <TableCell>
                    {user?.companyId&&<StocktakeLineCounter key={`${user.id}:${user.companyId}:${id}:${l.id}`}
                      takeId={id} line={l} scope={countIntentKey(user.id,user.companyId,id)}
                      disabled={data.status!=="in_progress"||!data.canCount}
                      onConfirmed={()=>void qc.invalidateQueries({queryKey:[`/inventory/stock-takes/${id}`]})}/>}
                    {l.countedQty!==null&&!l.observationConfirmed&&<p className="text-amber-700">عدد قديم يحتاج نقطة عد جديدة</p>}
                  </TableCell>
                  <TableCell className={variance == null ? "" : variance === 0 ? "text-muted-foreground" : variance > 0 ? "text-green-600" : "text-red-600"}>
                    {variance == null ? "—" : variance > 0 ? `+${variance}` : variance}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

