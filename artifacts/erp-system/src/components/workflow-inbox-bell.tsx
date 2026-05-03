import { useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListInbox,
  useMarkInboxRead,
  useMarkAllInboxRead,
  getListInboxQueryKey,
} from "@workspace/api-client-react";

export function WorkflowInboxBell() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { data: items } = useListInbox(
    {},
    { query: { refetchInterval: 30_000, queryKey: getListInboxQueryKey({}) } },
  );
  const markRead = useMarkInboxRead();
  const markAllRead = useMarkAllInboxRead();

  const list = items ?? [];
  const unreadCount = list.filter((i) => !i.isRead).length;

  const invalidate = () =>
    qc.invalidateQueries({
      predicate: (q) => Array.isArray(q.queryKey) && (q.queryKey[0] as string)?.includes("/workflow/inbox"),
    });

  const onItemClick = async (id: number, link?: string | null) => {
    await markRead.mutateAsync({ id });
    void invalidate();
    setOpen(false);
    // Always route notification clicks through the universal /inbox page so
    // non-admin approvers can act on them. The inbox page deep-links into
    // the approval drawer via the request id embedded in the link.
    if (link?.includes("request=")) setLocation(link.replace(/^.*?(?=\?)/, "/inbox"));
    else setLocation("/inbox");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative rounded-full"
          aria-label="الإشعارات"
          data-testid="button-inbox"
        >
          <Bell className="size-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -end-0.5 grid min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-tight text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <div className="text-sm font-bold">الإشعارات</div>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={async () => {
                await markAllRead.mutateAsync();
                void invalidate();
              }}
            >
              <CheckCheck className="me-1 size-3" />
              تعليم الكل كمقروء
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-96">
          {list.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              لا توجد إشعارات بعد
            </div>
          ) : (
            <ul className="divide-y">
              {list.map((it) => (
                <li
                  key={it.id}
                  className={`cursor-pointer px-3 py-2 hover:bg-muted/50 ${
                    it.isRead ? "" : "bg-primary/5"
                  }`}
                  onClick={() => onItemClick(it.id, it.link)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{it.title}</div>
                      <div className="line-clamp-2 text-xs text-muted-foreground">
                        {it.message}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {new Date(it.createdAt).toLocaleString("ar-SA")}
                      </div>
                    </div>
                    <Badge variant={it.isRead ? "outline" : "default"} className="shrink-0 text-[10px]">
                      {it.type === "approval" ? "اعتماد" : it.type === "automation" ? "أتمتة" : "نظام"}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
