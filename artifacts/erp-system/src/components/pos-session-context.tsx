import type { PosSession } from "@workspace/api-client-react";

export function PosSessionContext({ session }: { session?: PosSession }) {
  if (!session) return null;
  return <div data-testid="pos-active-session-context" className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-2 text-xs text-muted-foreground">
    <span>{session.branchName || "تعذر تحديد الفرع"}</span>
    <span>{session.cashierName || "تعذر تحديد صاحب الوردية"}</span>
    <span dir="ltr">{session.sessionNumber}</span>
  </div>;
}
