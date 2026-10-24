import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useTheme } from "@/hooks/use-theme";
import { QueryClientProvider } from "@tanstack/react-query";
import { createAppQueryClient } from "@/lib/query-client";
import { Toaster } from "@/components/ui/toaster";
import {PdfDownloadStatus} from "@/components/pdf-download-status";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/layout";
import ProtectedRoute from "@/components/protected-route";
import { ErrorBoundary } from "@/components/error-boundary";

// Eagerly load the highest-traffic shells so the first paint of the
// app (Login + Dashboard + POS + public Welcome/Track) is not
// blocked on an extra chunk request. Everything else is lazy-loaded
// route-by-route so the initial JS bundle stays small on mobile.
import Dashboard from "@/pages/dashboard";
import Login from "@/pages/login";
import Welcome from "@/pages/welcome";
import NotFound from "@/pages/not-found";
import { useAuth } from "@/hooks/use-auth";
import { useSelectedResponsibility } from "@/lib/workspace-responsibility";


const LegacyPOS = lazy(() => import("@/pages/pos"));
const PosIconic = lazy(() => import("@/pages/pos-iconic"));

/**
 * Picks the POS layout from the active company's businessType
 * (resolved on /auth/me). `retail` → Iconic dense icon grid,
 * `fb` → Photo-tile menu, everything else (wholesale/services/null)
 * → legacy POS. Defaults to legacy until the auth payload arrives
 * so we never flash the wrong shell.
 */
function POS() {
  const { user } = useAuth();
  // Scoped members always get the iconic retail till (cash-only baseline).
  if (user?.role === "scoped") return <PosIconic variant="retail" />;
  const bt = user?.businessType;
  if (bt === "retail") return <PosIconic variant="retail" />;
  if (bt === "fb") return <PosIconic variant="fb" />;
  return <LegacyPOS />;
}
const Products = lazy(() => import("@/pages/products"));
const Invoices = lazy(() => import("@/pages/invoices"));
const Accounting = lazy(() => import("@/pages/accounting"));
const AccountingPeriodsPage = lazy(() => import("@/pages/accounting-periods"));
const Reports = lazy(() => import("@/pages/reports"));
const ReportsBuilder = lazy(() => import("@/pages/reports-builder"));
const ReportsSaved = lazy(() => import("@/pages/reports-saved"));
const MyDashboard = lazy(() => import("@/pages/my-dashboard"));
const Customers = lazy(() => import("@/pages/customers"));
const Suppliers = lazy(() => import("@/pages/suppliers"));
const Branches = lazy(() => import("@/pages/branches"));
const UsersPage = lazy(() => import("@/pages/users"));
const HrPage = lazy(() => import("@/pages/hr"));
const Settings = lazy(() => import("@/pages/settings"));
const ProjectsPage = lazy(() => import("@/pages/projects"));
const MarketingPage = lazy(() => import("@/pages/marketing"));
const AdminPage = lazy(() => import("@/pages/admin"));
const IntegrationsMarketplacesPage = lazy(() => import("@/pages/integrations-marketplaces"));
const AnomaliesPage = lazy(() => import("@/pages/anomalies"));
const InboxPage = lazy(() => import("@/pages/inbox"));
const TransfersPage = lazy(() => import("@/pages/transfers"));
const StockTakePage = lazy(() => import("@/pages/stocktake"));
const InventoryRevaluationsPage = lazy(() => import("@/pages/inventory-revaluations"));
const ReorderRulesPage = lazy(() => import("@/pages/reorder-rules"));
const ProcurementPage = lazy(() => import("@/pages/procurement"));
const SalesPage = lazy(() => import("@/pages/sales"));
const CrmPage = lazy(() => import("@/pages/crm"));
const ManufacturingPage = lazy(() => import("@/pages/manufacturing"));
const OnboardingWizard = lazy(() => import("@/pages/onboarding-wizard"));
const CreateCompany = lazy(() => import("@/pages/create-company"));
const InvoicePrint = lazy(() => import("@/pages/invoice-print"));
const TrackShipmentPage = lazy(() => import("@/pages/track-shipment"));
const DocumentsPage = lazy(() => import("@/pages/documents"));
const IntercompanyPage = lazy(() => import("@/pages/intercompany"));
const LiquidityPage = lazy(() => import("@/pages/liquidity"));
const CompliancePage = lazy(() => import("@/pages/compliance"));
const IntercompanyEmailActionPage = lazy(
  () => import("@/pages/intercompany-email-action"),
);
const ReturnsPage = lazy(() => import("@/pages/returns"));
const HelpPage = lazy(() => import("@/pages/help"));
const TeamSetupPage = lazy(() => import("@/pages/team-setup"));
const TeamActivatePage = lazy(() => import("@/pages/team-activate"));
const MyWorkPage = lazy(() => import("@/pages/my-work"));

/** Paths a scoped (responsibility-bound) member may open. */
const SCOPED_PATHS = new Set(["/my-work"]);

/**
 * Scoped members never see the global dashboard or legacy pages: any
 * other protected path sends them to /my-work. POS is only reachable
 * while a POS responsibility is selected. The server still enforces
 * every request; this only keeps the UI honest.
 */
function ScopedGate({ children, pos = false }: { children: React.ReactNode; pos?: boolean }) {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const selected = useSelectedResponsibility();
  const scoped = user?.role === "scoped";
  const posView = selected?.resource === "pos" && selected.actions.includes("pos.read");
  const allowed = !scoped || (pos ? posView : SCOPED_PATHS.has(location));
  useEffect(() => {
    if (!allowed) setLocation("/my-work", { replace: true });
  }, [allowed, setLocation]);
  if (!allowed) return null;
  return <>{children}</>;
}

const queryClient = createAppQueryClient();

const DARK_ROUTES = new Set(["/"]);

/** Lightweight skeleton shown while a route chunk downloads. Avoids
 *  layout shift by reserving viewport height. */
function RouteFallback() {
  return (
    <div className="flex h-[60vh] items-center justify-center text-sm text-muted-foreground">
      <div className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <ScopedGate>
        <Layout>{children}</Layout>
      </ScopedGate>
    </ProtectedRoute>
  );
}

function Router() {
  const [location] = useLocation();
  const { theme } = useTheme();

  useEffect(() => {
    let isDark: boolean;
    if (theme === "dark") isDark = true;
    else if (theme === "light") isDark = false;
    else isDark = DARK_ROUTES.has(location);

    if (isDark) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, [location, theme]);

  return (
    <Suspense fallback={<RouteFallback />}>
      <Switch>
        <Route path="/pos">
          <ProtectedRoute><ScopedGate pos><POS /></ScopedGate></ProtectedRoute>
        </Route>

        <Route path="/welcome" component={Welcome} />
        <Route path="/team-activate" component={TeamActivatePage} />
        <Route path="/track/:awb" component={TrackShipmentPage} />

        <Route path="/invoices/:id/print">
          <ProtectedRoute><ScopedGate><InvoicePrint /></ScopedGate></ProtectedRoute>
        </Route>

        <Route path="/login" component={Login} />
        <Route path="/signup" component={CreateCompany} />
        <Route path="/onboarding" component={OnboardingWizard} />

        <Route path="/">
          <Protected><Dashboard /></Protected>
        </Route>
        <Route path="/products">
          <Protected><Products /></Protected>
        </Route>
        <Route path="/invoices">
          <Protected><Invoices /></Protected>
        </Route>
        <Route path="/accounting">
          <Protected><Accounting /></Protected>
        </Route>
        <Route path="/accounting/periods">
          <Protected><AccountingPeriodsPage /></Protected>
        </Route>
        <Route path="/reports">
          <Protected><Reports /></Protected>
        </Route>
        <Route path="/reports/builder">
          <Protected><ReportsBuilder /></Protected>
        </Route>
        <Route path="/reports/saved">
          <Protected><ReportsSaved /></Protected>
        </Route>
        <Route path="/my-dashboard">
          <Protected><MyDashboard /></Protected>
        </Route>
        <Route path="/customers">
          <Protected><Customers /></Protected>
        </Route>
        <Route path="/suppliers">
          <Protected><Suppliers /></Protected>
        </Route>
        <Route path="/branches">
          <Protected><Branches /></Protected>
        </Route>
        <Route path="/inventory/transfers">
          <Protected><TransfersPage /></Protected>
        </Route>
        <Route path="/inventory/stocktake">
          <Protected><StockTakePage /></Protected>
        </Route>
        <Route path="/inventory-revaluations">
          <Protected><InventoryRevaluationsPage /></Protected>
        </Route>
        <Route path="/inventory/reorder">
          <Protected><ReorderRulesPage /></Protected>
        </Route>
        <Route path="/procurement">
          <Protected><ProcurementPage /></Protected>
        </Route>
        <Route path="/returns">
          <Protected><ReturnsPage /></Protected>
        </Route>
        <Route path="/sales">
          <Protected><SalesPage /></Protected>
        </Route>
        <Route path="/crm">
          <Protected><CrmPage /></Protected>
        </Route>
        <Route path="/manufacturing">
          <Protected><ManufacturingPage /></Protected>
        </Route>
        <Route path="/projects">
          <Protected><ProjectsPage /></Protected>
        </Route>
        <Route path="/marketing">
          <Protected><MarketingPage /></Protected>
        </Route>
        <Route path="/users">
          <Protected><UsersPage /></Protected>
        </Route>
        <Route path="/hr">
          <Protected><HrPage /></Protected>
        </Route>
        <Route path="/documents">
          <Protected><DocumentsPage /></Protected>
        </Route>
        <Route path="/intercompany/email-action">
          <IntercompanyEmailActionPage />
        </Route>
        <Route path="/intercompany">
          <Protected><IntercompanyPage /></Protected>
        </Route>
        <Route path="/liquidity">
          <Protected><LiquidityPage /></Protected>
        </Route>
        <Route path="/compliance">
          <Protected><CompliancePage /></Protected>
        </Route>
        <Route path="/admin">
          <Protected><AdminPage /></Protected>
        </Route>
        <Route path="/integrations/marketplaces">
          <Protected><IntegrationsMarketplacesPage /></Protected>
        </Route>
        <Route path="/anomalies">
          <Protected><AnomaliesPage /></Protected>
        </Route>
        <Route path="/inbox">
          <Protected><InboxPage /></Protected>
        </Route>
        <Route path="/approvals">
          <Protected><InboxPage /></Protected>
        </Route>
        <Route path="/settings">
          <Protected><Settings /></Protected>
        </Route>
        <Route path="/team-setup">
          <Protected><TeamSetupPage /></Protected>
        </Route>
        <Route path="/my-work">
          <Protected><MyWorkPage /></Protected>
        </Route>
        <Route path="/help">
          <Protected><HelpPage /></Protected>
        </Route>
        <Route>
          <Protected><NotFound /></Protected>
        </Route>
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
          <PdfDownloadStatus/>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
