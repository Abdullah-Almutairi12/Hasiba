import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useTheme } from "@/hooks/use-theme";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Layout from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import POS from "@/pages/pos";
import Products from "@/pages/products";
import Invoices from "@/pages/invoices";
import Accounting from "@/pages/accounting";
import Reports from "@/pages/reports";
import Customers from "@/pages/customers";
import Branches from "@/pages/branches";
import UsersPage from "@/pages/users";
import HrPage from "@/pages/hr";
import Settings from "@/pages/settings";
import ProjectsPage from "@/pages/projects";
import MarketingPage from "@/pages/marketing";
import AdminPage from "@/pages/admin";
import InboxPage from "@/pages/inbox";
import TransfersPage from "@/pages/transfers";
import StockTakePage from "@/pages/stocktake";
import ReorderRulesPage from "@/pages/reorder-rules";
import ProcurementPage from "@/pages/procurement";
import SalesPage from "@/pages/sales";
import CrmPage from "@/pages/crm";
import ManufacturingPage from "@/pages/manufacturing";
import OnboardingWizard from "@/pages/onboarding-wizard";
import CreateCompany from "@/pages/create-company";
import Login from "@/pages/login";
import Welcome from "@/pages/welcome";
import InvoicePrint from "@/pages/invoice-print";
import ProtectedRoute from "@/components/protected-route";
import { ErrorBoundary } from "@/components/error-boundary";

const queryClient = new QueryClient();

const DARK_ROUTES = new Set(["/", "/settings"]);

function Protected({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

function Router() {
  const [location] = useLocation();
  const { theme } = useTheme();

  // Apply theme: explicit user preference wins; "auto" falls back to per-route default
  useEffect(() => {
    let isDark: boolean;
    if (theme === "dark") isDark = true;
    else if (theme === "light") isDark = false;
    else isDark = DARK_ROUTES.has(location);

    if (isDark) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, [location, theme]);

  return (
    <Switch>
      {/* POS uses its own full-screen layout but still requires authentication */}
      <Route path="/pos">
        <ProtectedRoute><POS /></ProtectedRoute>
      </Route>

      {/* Public marketing landing page */}
      <Route path="/welcome" component={Welcome} />

      {/* Invoice print uses its own full-screen layout */}
      <Route path="/invoices/:id/print">
        <ProtectedRoute><InvoicePrint /></ProtectedRoute>
      </Route>

      {/* Auth + Onboarding flows are full-screen (no app shell) */}
      <Route path="/login" component={Login} />
      <Route path="/signup" component={CreateCompany} />
      <Route path="/onboarding" component={OnboardingWizard} />

      {/* All other routes wrapped in layout + auth guard */}
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
      <Route path="/reports">
        <Protected><Reports /></Protected>
      </Route>
      <Route path="/customers">
        <Protected><Customers /></Protected>
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
      <Route path="/inventory/reorder">
        <Protected><ReorderRulesPage /></Protected>
      </Route>
      <Route path="/procurement">
        <Protected><ProcurementPage /></Protected>
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
      <Route path="/admin">
        <Protected><AdminPage /></Protected>
      </Route>
      <Route path="/inbox">
        <Protected><InboxPage /></Protected>
      </Route>
      <Route path="/settings">
        <Protected><Settings /></Protected>
      </Route>
      <Route>
        <Protected><NotFound /></Protected>
      </Route>
    </Switch>
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
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
