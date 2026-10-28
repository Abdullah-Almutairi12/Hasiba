import { Building2, Check, ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useCurrentCompany } from "@/hooks/use-current-company";
import { useLanguage } from "@/hooks/use-language";
import { useToast } from "@/hooks/use-toast";

/**
 * Header dropdown showing the active company. If the user belongs to only
 * one company, it renders a read-only badge instead of a switcher.
 */
export function CompanySwitcher() {
  const { companies, activeCompany, canSwitch, isSwitching, switchCompany } =
    useCurrentCompany();
  const { isRTL } = useLanguage();
  const { toast } = useToast();

  if (companies.length === 0) return null;

  const label = activeCompany?.name ?? companies[0]?.name ?? "—";

  if (!canSwitch) {
    return (
      <div
        className="hidden items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground md:inline-flex"
        data-testid="company-switcher-readonly"
      >
        <Building2 className="size-3.5" />
        {label}
      </div>
    );
  }

  const handleSwitch = async (id: number) => {
    try {
      if (await switchCompany(id) === false) return;
      const next = companies.find((c) => c.id === id);
      toast({
        title: "تم تبديل الشركة",
        description: next?.name ?? "",
      });
    } catch (err) {
      toast({
        title: "تعذّر التبديل",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 max-w-[200px] gap-2 rounded-full"
          disabled={isSwitching}
          data-testid="button-company-switcher"
        >
          {isSwitching ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Building2 className="size-4 text-primary" />
          )}
          <span className="truncate text-sm font-medium">{label}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={isRTL ? "start" : "end"}
        className="w-64"
      >
        <DropdownMenuLabel className={isRTL ? "text-right" : "text-left"}>
          الشركات المتاحة
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {companies.map((c) => {
          const isActive = c.id === activeCompany?.id;
          return (
            <DropdownMenuItem
              key={c.id}
              onClick={() => void handleSwitch(c.id)}
              disabled={!c.isActive || isSwitching}
              className="flex items-center justify-between gap-2"
              data-testid={`company-switcher-item-${c.id}`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Building2 className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {c.role}
                  </div>
                </div>
              </div>
              {isActive && (
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <Check className="size-3" /> النشطة
                </Badge>
              )}
              {!c.isActive && !isActive && (
                <Badge variant="outline" className="text-[10px]">
                  معطّلة
                </Badge>
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
