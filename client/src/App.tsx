import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import NotFound from "@/pages/not-found";
import PropertiesPage from "@/pages/properties";
import OwnerLogin from "@/pages/owner-login";
import OwnerDashboard from "@/pages/owner-dashboard";
import SubscriptionPage from "@/pages/subscription";
import SuggestPage from "@/pages/suggest";
import RegisterPage from "@/pages/register";

function Router() {
  return (
    <Switch>
      <Route path="/" component={PropertiesPage} />
      <Route path="/owner/login" component={OwnerLogin} />
      <Route path="/owner/dashboard" component={OwnerDashboard} />
      <Route path="/owner/subscription" component={SubscriptionPage} />
      <Route path="/suggest" component={SuggestPage} />
      <Route path="/register" component={RegisterPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  const style = {
    "--sidebar-width": "20rem",
    "--sidebar-width-icon": "4rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SidebarProvider style={style as React.CSSProperties}>
          <div className="flex h-screen w-full">
            <AppSidebar />
            <div className="flex flex-col flex-1 min-w-0">
              <header className="flex items-center justify-between p-3 border-b border-border bg-card sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <h1 className="text-lg font-bold text-primary">مودي الذكي - العقارات</h1>
                </div>
              </header>
              <main className="flex-1 overflow-auto">
                <Router />
              </main>
            </div>
          </div>
        </SidebarProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
