import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";

import NotFound from "@/pages/not-found";
import PropertiesPage from "@/pages/properties";
import PropertyDetailsPage from "@/pages/property-details";
import OwnerLogin from "@/pages/owner-login";
import OwnerDashboard from "@/pages/owner-dashboard";
import OwnerImagesPage from "@/pages/owner-images";
import SubscriptionPage from "@/pages/subscription";
import SuggestPage from "@/pages/suggest";
import RegisterPage from "@/pages/register";

import { useSessionQuery } from "@/hooks/use-session";

function Router() {
  return (
    <Switch>
      <Route path="/" component={PropertiesPage} />
      <Route path="/property/:id" component={PropertyDetailsPage} />
      <Route path="/owner/login" component={OwnerLogin} />
      <Route path="/owner/dashboard" component={OwnerDashboard} />
      <Route path="/owner/images" component={OwnerImagesPage} />
      <Route path="/owner/subscription" component={SubscriptionPage} />
      <Route path="/suggest" component={SuggestPage} />
      <Route path="/register" component={RegisterPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  const [, setLocation] = useLocation();
  const { data: session } = useSessionQuery();

  const user = session?.user;
  const isLogged = !!user;

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/";
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <div className="min-h-screen flex flex-col bg-background">

          {/* ================= HEADER ================= */}
          <header className="bg-white border-b shadow-sm sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">

              {/* Logo */}
              <h1
                className="text-xl font-bold text-primary cursor-pointer"
                onClick={() => setLocation("/")}
              >
                مودي الذكي - العقارات
              </h1>

              {/* Action Buttons */}
              <div className="flex items-center gap-2">

                {!isLogged && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => setLocation("/owner/login")}
                      className="font-bold"
                    >
                      تسجيل الدخول
                    </Button>

                    <Button
                      variant="outline"
                      onClick={() => setLocation("/")}
                      className="font-bold"
                    >
                      الصفحة الرئيسية
                    </Button>
                  </>
                )}

                {isLogged && (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => setLocation("/owner/dashboard")}
                      className="font-bold"
                    >
                      لوحة التحكم
                    </Button>

                    <Button
                      variant="destructive"
                      onClick={logout}
                      className="font-bold"
                    >
                      تسجيل خروج
                    </Button>
                  </>
                )}

              </div>
            </div>
          </header>
          {/* ================ END HEADER ================ */}

          <main className="flex-1 overflow-auto">
            <Router />
          </main>

          <Toaster />
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
