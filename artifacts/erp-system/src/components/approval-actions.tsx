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

type Action = "approve" | "reject" | "request_changes";

export interface ApprovalActionsProps {
  docType: string;
  recordId: number;
  compact?: boolean;
}

export function ApprovalActions({ docType, recordId, compact }: ApprovalActionsProps) {
  const { data, isLoading } = useListApprovalRequests({ docType, status: "pending" });
  const qc = useQueryClient();
  const act = useActOnApprovalRequest();
  const { toast } = useToast();
  const [open, setOpen] = useState<{ action: Action; id: number } | null>(null);
  const [comment, setComment] = useState("");

  if (isLoading) return null;
  const list = (data ?? []) as Array<{ id: number; recordId: number; currentStep: number }>;
  const req = list.find((r) => r.recordId === recordId);
  if (!req) return null;

  const submit = async () => {
    if (!open) return;
    try {
      await act.mutateAsync({ id: open.id, data: { action: open.action, comment: comment || null } });
      toast({
        title:
          open.action === "approve" ? "تم الاعتماد" :
          open.action === "reject" ? "تم الرفض" : "تم طلب تعديلات",
      });
      setOpen(null);
      setComment("");
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
      <Button size="sm" variant="default" onClick={() => setOpen({ action: "approve", id: req.id })}>
        <Check className="size-3" /> اعتماد
      </Button>
      <Button size="sm" variant="destructive" onClick={() => setOpen({ action: "reject", id: req.id })}>
        <X className="size-3" /> رفض
      </Button>
      <Button size="sm" variant="outline" onClick={() => setOpen({ action: "request_changes", id: req.id })}>
        <MessageSquare className="size-3" /> تعديل
      </Button>
      <Link to={`/inbox?request=${req.id}`}>
        <Button size="sm" variant="ghost" title="فتح في صندوق الوارد">
          <ExternalLink className="size-3" />
        </Button>
      </Link>
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
