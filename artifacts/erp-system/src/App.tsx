import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
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

const queryClient = new QueryClient();

function Router() {
  const [location] = useLocation();

  // Automatically switch between dark and light mode based on the route
  useEffect(() => {
    if (location === "/") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [location]);

  return (
    <Switch>
      {/* POS has its own full-screen layout usually, but let's keep it consistent or use a separate layout */}
      <Route path="/pos" component={POS} />
      
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
