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
import Settings from "@/pages/settings";
import OnboardingWizard from "@/pages/onboarding-wizard";
import CreateCompany from "@/pages/create-company";
import Login from "@/pages/login";

const queryClient = new QueryClient();

const DARK_ROUTES = new Set(["/", "/settings"]);

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
      {/* POS has its own full-screen layout usually, but let's keep it consistent or use a separate layout */}
      <Route path="/pos" component={POS} />

      {/* Auth + Onboarding flows are full-screen (no app shell) */}
      <Route path="/login" component={Login} />
      <Route path="/signup" component={CreateCompany} />
      <Route path="/onboarding" component={OnboardingWizard} />

      {/* All other routes wrapped in layout */}
      <Route path="/">
        <Layout><Dashboard /></Layout>
      </Route>
      <Route path="/products">
        <Layout><Products /></Layout>
      </Route>
      <Route path="/invoices">
        <Layout><Invoices /></Layout>
      </Route>
      <Route path="/accounting">
        <Layout><Accounting /></Layout>
      </Route>
      <Route path="/reports">
        <Layout><Reports /></Layout>
      </Route>
      <Route path="/customers">
        <Layout><Customers /></Layout>
      </Route>
      <Route path="/branches">
        <Layout><Branches /></Layout>
      </Route>
      <Route path="/users">
        <Layout><UsersPage /></Layout>
      </Route>
      <Route path="/settings">
        <Layout><Settings /></Layout>
      </Route>
      <Route>
        <Layout><NotFound /></Layout>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
