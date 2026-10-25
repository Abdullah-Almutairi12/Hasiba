import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useListApprovalRequests,
  useActOnApprovalRequest,
} from "@workspace/api-client-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { useToast } from "../hooks/use-toast";
import { Check, X, MessageSquare, ExternalLink } from "lucide-react";
import {apiPost} from "../hooks/use-api";

type Action = "approve" | "reject" | "request_changes";

export interface ApprovalActionsProps {
  docType: string;
  recordId: number;
  compact?: boolean;
  nativePurchaseOrder?: {id:number;recordId:number;currentStep:number;policyReviewRequired?:boolean;
    actionableSteps:Array<{sequence:number;stepToken:string}>}|null;
}

export function ApprovalActions({ docType, recordId, compact, nativePurchaseOrder }: ApprovalActionsProps) {
  const native=nativePurchaseOrder!==undefined;
  const { data, isLoading } = useListApprovalRequests({ docType, status: "pending" },{query:{enabled:!native}});
  const qc = useQueryClient();
  const act = useActOnApprovalRequest();
  const { toast } = useToast();
  const [open, setOpen] = useState<{ action: Action; id: number; stepToken: string; decisionId: string } | null>(null);
  const [selectedStepToken, setSelectedStepToken] = useState("");
  const [comment, setComment] = useState("");

  if (!native&&isLoading) return null;
  const list = data ?? [];
  const req = native?nativePurchaseOrder:list.find((r) => r.recordId === recordId);
  if (!req) return null;
  const available = req.actionableSteps ?? [];
  const selectedStep = available.find(s => s.stepToken === selectedStepToken) ?? available[0];
  const begin = (action: Action) => {
    if (!selectedStep) return;
    setOpen({ action, id: req.id, stepToken: selectedStep.stepToken, decisionId: crypto.randomUUID() });
  };

  const submit = async () => {
    if (!open) return;
    try {
      const payload={
        action: open.action, comment: comment || null, stepToken: open.stepToken, decisionId: open.decisionId,
      };
      const result = native?await apiPost<{finished:boolean}>(`/procurement/purchase-orders/${recordId}/approve`,payload):
        await act.mutateAsync({id:open.id,data:payload});
      toast({
        title:
          open.action === "approve" ? (result.finished ? "تم الاعتماد" : "اعتمدت الخطوة؛ المراجعة مستمرة") :
          open.action === "reject" ? "تم الرفض" : "تم طلب تعديلات",
      });
      setOpen(null);
      setComment("");
      if(native)await qc.invalidateQueries({queryKey:["procurement"]});
      await qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0] as string | undefined;
          return !!k && (k.includes("/workflow/") || k.includes(`/${docType.split("_")[0]}`) ||
            k.includes("/sales") || k.includes("/procurement") || k.includes("/hr") ||
            k.includes("/accounting"));
        },
      });
    } catch (err) {
      toast({ title: "خطأ", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  return (
    <div className={compact ? "inline-flex items-center gap-1" : "flex items-center gap-2"}>
      <Badge variant="outline" className="text-xs">بانتظار اعتماد · خطوة {req.currentStep}</Badge>
      {req.policyReviewRequired && <Badge variant="outline">يحتاج إعادة تقديم للمراجعة</Badge>}
      {available.length > 1 && <select aria-label="خطوة المراجعة" value={selectedStep?.stepToken ?? ""} onChange={e => setSelectedStepToken(e.target.value)}>
        {available.map(s => <option key={s.stepToken} value={s.stepToken}>الخطوة {s.sequence}</option>)}
      </select>}
      {!selectedStep && <span className="text-xs text-muted-foreground">لا يوجد إجراء متاح لصلاحيتك الحالية</span>}
      <Button size="sm" variant="default" disabled={req.policyReviewRequired || !selectedStep} onClick={() => begin("approve")}>
        <Check className="size-3" /> اعتماد
      </Button>
      <Button size="sm" variant="destructive" disabled={!selectedStep} onClick={() => begin("reject")}>
        <X className="size-3" /> رفض
      </Button>
      <Button size="sm" variant="outline" disabled={!selectedStep} onClick={() => begin("request_changes")}>
        <MessageSquare className="size-3" /> تعديل
      </Button>
      {!native&&<Link to={`/inbox?request=${req.id}`}>
        <Button size="sm" variant="ghost" title="فتح في صندوق الوارد">
          <ExternalLink className="size-3" />
        </Button>
      </Link>}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {open?.action === "approve" ? "اعتماد الطلب" :
               open?.action === "reject" ? "رفض الطلب" : "طلب تعديلات"}
            </DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="ملاحظات (اختياري)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(null)}>إلغاء</Button>
            <Button onClick={submit} disabled={act.isPending}>تأكيد</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
