import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  listScopedIntents,
  useActorScope,
  useDurableAction,
  useIntentStorageVersion,
  type DurableIntent,
  type DurableKind,
} from "@/hooks/use-returns-actions";
import { ErrorBox } from "@/components/returns/ui";
import { money, str } from "@/lib/returns/shared";

const KIND_LABEL: Record<DurableKind, string> = { request: "طلب إرجاع", payout: "صرف", expense: "مصروف نقدي" };

/**
 * Independent of the workspace lists: shows every unconfirmed attempt saved
 * by the current user in the current company, so it can be replayed even if
 * the note/invoice is no longer listed, nothing remains due, or the shift
 * has closed. The server answers idempotently with the original result.
 */
export function RecoveryPanel() {
  const scope = useActorScope();
  useIntentStorageVersion();
  const items = scope ? listScopedIntents(scope) : [];
  if (items.length === 0) return null;
  return (
    <section className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-800 dark:bg-amber-950/30" aria-live="polite">
      <h2 className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-100">
        <ShieldAlert className="size-5" /> عمليات مالية بنتيجة غير مؤكدة ({items.length})
      </h2>
      <p className="text-xs text-amber-900/80 dark:text-amber-100/80">
        لا تكرر هذه العمليات بطريقة أخرى ولا تسلّم نقدًا إضافيًا. أعد إرسال الطلب نفسه حتى يؤكد الخادم نتيجته؛ ستختفي من هنا بعد التأكيد فقط.
      </p>
      <ul className="space-y-2">
        {items.map((i) => <RecoveryRow key={`${i.kind}:${i.id}`} kind={i.kind} id={i.id} intent={i.intent} />)}
      </ul>
    </section>
  );
}

function RecoveryRow({ kind, id, intent }: { kind: DurableKind; id: string; intent: DurableIntent }) {
  const d = useDurableAction(kind, id);
  const { toast } = useToast();
  const b = intent.body;
  const target = kind === "request" ? `فاتورة #${str(b.invoiceId, id)}` : kind === "payout" ? `إشعار #${str(b.noteId, id)}` : `وردية #${str(b.sessionId, id)}`;
  return (
    <li className="space-y-2 rounded-xl border border-border bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">{KIND_LABEL[kind]}</span>
        <span className="text-muted-foreground">{target}</span>
        {kind !== "request" && <span className="tabular-nums">{money(b.amount)}</span>}
        {str(b.reference) && <span dir="ltr" className="text-xs">{str(b.reference)}</span>}
        {intent.savedAt && <span className="text-xs text-muted-foreground" dir="ltr">{intent.savedAt.replace("T", " ").slice(0, 19)}</span>}
        <Button size="sm" className="ms-auto" disabled={d.pending || !d.ready}
          onClick={async () => { if (await d.send(() => b)) toast({ title: `تأكدت نتيجة ${KIND_LABEL[kind]}` }); }}>
          {d.pending ? "جارٍ الإرسال..." : "إعادة إرسال نفس الطلب"}
        </Button>
      </div>
      <p className="font-mono text-[10px] text-muted-foreground" dir="ltr">key: {str(b.idempotencyKey)}</p>
      {d.error && <ErrorBox err={d.error} onClose={d.clearError} />}
    </li>
  );
}
