import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  FileText,
  Users,
  Calculator,
  BarChart3,
  Settings,
  Building2,
  ShieldCheck,
  FolderKanban,
  Megaphone,
  ArrowLeftRight,
  ClipboardList,
  TrendingDown,
  ShoppingBag,
  Receipt,
  Target,
  UserCog,
  Factory,
  Sun,
  Moon,
  Monitor,
  LogOut,
  Languages,
  User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme, type ThemeMode } from "@/hooks/use-theme";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/hooks/use-language";
import { usePermissions } from "@/hooks/use-permissions";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WorkflowInboxBell } from "@/components/workflow-inbox-bell";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const mainNavItems = [
  { key: "dashboard", url: "/", icon: LayoutDashboard },
  { key: "pos", url: "/pos", icon: ShoppingCart },
  { key: "products", url: "/products", icon: Package },
  { key: "sales", url: "/sales", icon: Receipt },
  { key: "crm", url: "/crm", icon: Target },
  { key: "invoices", url: "/invoices", icon: FileText },
  { key: "customers", url: "/customers", icon: Users },
] as const;

const financeNavItems = [
  { key: "accounting", url: "/accounting", icon: Calculator },
  { key: "reports", url: "/reports", icon: BarChart3 },
] as const;

const operationsNavItems = [
  { key: "procurement", url: "/procurement", icon: ShoppingBag },
  { key: "manufacturing", url: "/manufacturing", icon: Factory },
  { key: "transfers", url: "/inventory/transfers", icon: ArrowLeftRight },
  { key: "stocktake", url: "/inventory/stocktake", icon: ClipboardList },
  { key: "reorder", url: "/inventory/reorder", icon: TrendingDown },
  { key: "projects", url: "/projects", icon: FolderKanban },
  { key: "marketing", url: "/marketing", icon: Megaphone },
] as const;

const adminNavItems = [
  { key: "branches", url: "/branches", icon: Building2 },
  { key: "hr", url: "/hr", icon: UserCog },
  { key: "users", url: "/users", icon: Users },
  { key: "admin", url: "/admin", icon: ShieldCheck },
  { key: "settings", url: "/settings", icon: Settings },
] as const;

export function AppSidebar() {
  const [location] = useLocation();
  const { t, isRTL } = useLanguage();
  const { canSee } = usePermissions();

  const renderGroup = (
    label: string,
    items: ReadonlyArray<{ key: string; url: string; icon: React.ComponentType<{ className?: string }> }>,
  ) => {
    const visible = items.filter((i) => canSee(i.key));
    if (visible.length === 0) return null;
    return (
      <SidebarGroup>
        <SidebarGroupLabel>{label}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {visible.map((item) => {
              const title = t(`nav.${item.key}`);
              return (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    tooltip={title}
                  >
                    <Link href={item.url}>
                      <item.icon />
                      <span>{title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  return (
    <Sidebar side={isRTL ? "right" : "left"} className={`${isRTL ? "border-l" : "border-r"} border-border bg-sidebar`}>
      <SidebarHeader className="flex h-16 items-center justify-center border-b border-border/50 px-4">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Calculator className="size-5" />
          </div>
          <span className="bg-gradient-to-l from-primary to-cyan-400 bg-clip-text text-2xl font-bold text-transparent">
            حاسبة.AI
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {renderGroup(t("navGroups.main"), mainNavItems)}
        {renderGroup(t("navGroups.finance"), financeNavItems)}
        {renderGroup(t("navGroups.operations"), operationsNavItems)}
        {renderGroup(t("navGroups.admin"), adminNavItems)}
      </SidebarContent>
    </Sidebar>
  );
}

function ThemeToggle() {
  const { theme, cycle } = useTheme();
  const { t } = useLanguage();
  const meta: Record<
    ThemeMode,
    { icon: React.ComponentType<{ className?: string }>; labelKey: string }
  > = {
    light: { icon: Sun, labelKey: "header.themeLight" },
    dark: { icon: Moon, labelKey: "header.themeDark" },
    auto: { icon: Monitor, labelKey: "header.themeAuto" },
  };
  const { icon: Icon, labelKey } = meta[theme];
  const label = t(labelKey);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={cycle}
          className="rounded-full"
          data-testid="button-theme-toggle"
          aria-label={label}
        >
          <Icon className="size-5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function LanguageToggle() {
  const { language, toggleLanguage, t } = useLanguage();
  const label = t("header.switchLanguage");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleLanguage}
          className="relative rounded-full"
          data-testid="button-language-toggle"
          aria-label={label}
        >
          <Languages className="size-5" />
          <span className="absolute -bottom-0.5 -end-0.5 rounded bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground">
            {language.toUpperCase()}
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

function UserMenu() {
  const { user, logout, isLoggingOut } = useAuth();
  const [, setLocation] = useLocation();
  const { t, isRTL } = useLanguage();

  const initials = (user?.name ?? "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("");

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      setLocation("/login");
    }
  };

  const roleLabel = user?.role ? t(`roles.${user.role}`, { defaultValue: user.role }) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-10 gap-2 rounded-full px-2"
          data-testid="button-user-menu"
        >
          <div className="grid size-8 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {initials || <UserIcon className="size-4" />}
          </div>
          <span className="hidden text-sm font-medium md:inline">
            {user?.name ?? t("header.guest")}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={isRTL ? "start" : "end"} className="w-56">
        <DropdownMenuLabel className={isRTL ? "text-right" : "text-left"}>
          <div className="font-bold">{user?.name}</div>
          <div className="text-[11px] font-normal text-muted-foreground" dir="ltr">
            {user?.email}
          </div>
          {roleLabel && (
            <div className="mt-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
              {roleLabel}
            </div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setLocation("/settings")}>
          <Settings className="me-2 size-4" />
          {t("header.settings")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="text-rose-600 focus:bg-rose-50 focus:text-rose-700"
          data-testid="button-logout"
        >
          <LogOut className="me-2 size-4" />
          {isLoggingOut ? t("header.loggingOut") : t("header.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider defaultOpen>
      <div className="flex min-h-screen w-full bg-background text-foreground selection:bg-primary/30">
        <AppSidebar />
        <main className="flex flex-1 flex-col overflow-hidden">
          <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border/50 bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:gap-4 sm:px-6">
            <SidebarTrigger />
            <div className="flex flex-1 items-center justify-end gap-1 sm:gap-2">
              <WorkflowInboxBell />
              <LanguageToggle />
              <ThemeToggle />
              <UserMenu />
            </div>
          </header>
          <div className="flex-1 overflow-auto p-3 sm:p-4 md:p-6">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}
